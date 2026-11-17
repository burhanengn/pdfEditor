use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering as AtomicOrdering},
        mpsc, Condvar, Mutex, OnceLock,
    },
    thread,
};

use gp_engine::EngineSession;
use gp_model::{CanvasElement, PageMeta};
use gp_pdf::{
    CancellationFlag, PdfError, PdfInspectionPage, PdfOpenResult, PdfOutlineNode,
    PdfSearchHit, PdfTextCharBox, PdfTextSpan, ReadingTheme, RedactionRect, RenderedBitmap,
    TileRenderRequest,
};
use gp_pdf_pdfium::{objects::PageObjectAnalysis, PdfiumBackend};
use pdfium_render::prelude::*;

/// Task priority buckets enforcing UI responsiveness (D2, 04 §4.3):
/// Visible tiles always preempt background thumbnails, searches, and exports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ActorPriority {
    VisibleTile = 0,
    CommandOrHit = 1,
    Preview = 2,
    Thumbnail = 3,
    SearchOrAnalysis = 4,
    Compile = 5,
}

type JobFn = Box<dyn FnOnce(&mut ActorState) + Send + 'static>;

struct PrioritizedJob {
    priority: ActorPriority,
    seq: u64,
    scope: Option<String>,
    cancel: CancellationFlag,
    run: JobFn,
}

impl PartialEq for PrioritizedJob {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.seq == other.seq
    }
}

impl Eq for PrioritizedJob {}

impl PartialOrd for PrioritizedJob {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PrioritizedJob {
    fn cmp(&self, other: &Self) -> Ordering {
        // BinaryHeap is a max-heap: smaller priority enum value and smaller seq win first.
        (other.priority as u8)
            .cmp(&(self.priority as u8))
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

pub struct ActorState {
    pub backend: Option<PdfiumBackend>,
    pub backend_path: Option<String>,
    pub session: EngineSession,
    pub doc_paths: HashMap<String, String>,
}

impl ActorState {
    fn new(budget_bytes: usize) -> Self {
        Self {
            backend: None,
            backend_path: None,
            session: EngineSession::new(budget_bytes),
            doc_paths: HashMap::new(),
        }
    }

    pub fn ensure_backend(&mut self, preferred_path: Option<&str>) -> Result<&mut PdfiumBackend, PdfError> {
        if self.backend.is_some() {
            return Ok(self.backend.as_mut().expect("checked"));
        }
        let backend = open_pdfium_backend(preferred_path)?;
        self.backend_path = preferred_path.map(|s| s.to_string());
        self.backend = Some(backend);
        Ok(self.backend.as_mut().expect("just set"))
    }
}

fn open_pdfium_backend(preferred_path: Option<&str>) -> Result<PdfiumBackend, PdfError> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = preferred_path.filter(|s| !s.trim().is_empty()) {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(env_p) = std::env::var("PDFIUM_LIB_PATH") {
        if !env_p.trim().is_empty() {
            candidates.push(PathBuf::from(env_p));
        }
    }

    #[cfg(target_os = "android")]
    {
        candidates.push(PathBuf::from("libpdfium.so"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("pdfium.dll"));
            }
        }
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        if let Some(root) = manifest_dir.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
            candidates.push(root.join(".pdfium-cache").join("pdfium.dll"));
        }
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join(".pdfium-cache").join("pdfium.dll"));
            if let Some(parent) = cwd.parent() {
                candidates.push(parent.join(".pdfium-cache").join("pdfium.dll"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("libpdfium.dylib"));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("libpdfium.so"));
    }

    for path in &candidates {
        if let Ok(b) = PdfiumBackend::from_library_path(path) {
            return Ok(b);
        }
    }

    PdfiumBackend::from_system()
}

struct QueueInner {
    heap: BinaryHeap<PrioritizedJob>,
    scope_flags: HashMap<String, Vec<CancellationFlag>>,
}

pub struct PdfEngineActor {
    seq: AtomicU64,
    queue: Mutex<QueueInner>,
    cv: Condvar,
}

impl PdfEngineActor {
    fn spawn() -> Self {
        let queue = Mutex::new(QueueInner {
            heap: BinaryHeap::new(),
            scope_flags: HashMap::new(),
        });
        let cv = Condvar::new();
        Self {
            seq: AtomicU64::new(1),
            queue,
            cv,
        }
    }

    fn start_worker(&'static self) {
        thread::Builder::new()
            .name("gp-pdfium-engine".to_string())
            .spawn(move || {
                let mut state = ActorState::new(96 * 1024 * 1024);
                loop {
                    let job = {
                        let mut guard = self.queue.lock().expect("actor queue poisoned");
                        while guard.heap.is_empty() {
                            guard = self.cv.wait(guard).expect("actor cv poisoned");
                        }
                        guard.heap.pop().expect("non-empty heap")
                    };
                    if let Some(scope) = &job.scope {
                        let mut guard = self.queue.lock().expect("actor queue poisoned");
                        if let Some(list) = guard.scope_flags.get_mut(scope) {
                            list.retain(|f| !f.is_cancelled());
                            if list.is_empty() {
                                guard.scope_flags.remove(scope);
                            }
                        }
                    }
                    let _pre_cancelled = job.cancel.is_cancelled();
                    (job.run)(&mut state);
                }
            })
            .expect("failed to spawn gp-pdfium-engine thread");
    }

    pub fn cancel_scope(&self, scope: &str) -> usize {
        let mut guard = self.queue.lock().expect("actor queue poisoned");
        let Some(flags) = guard.scope_flags.remove(scope) else {
            return 0;
        };
        let mut cancelled = 0usize;
        for f in flags {
            if !f.is_cancelled() {
                f.cancel();
                cancelled += 1;
            }
        }
        cancelled
    }

    pub fn dispatch<T: Send + 'static>(
        &self,
        priority: ActorPriority,
        scope: Option<String>,
        cancel: CancellationFlag,
        f: impl FnOnce(&mut ActorState, &CancellationFlag) -> Result<T, PdfError> + Send + 'static,
    ) -> Result<T, PdfError> {
        let (tx, rx) = mpsc::sync_channel::<Result<T, PdfError>>(1);
        let cancel_clone = cancel.clone();
        let seq = self.seq.fetch_add(1, AtomicOrdering::Relaxed);
        let job = PrioritizedJob {
            priority,
            seq,
            scope: scope.clone(),
            cancel: cancel.clone(),
            run: Box::new(move |state: &mut ActorState| {
                let out = if cancel_clone.is_cancelled() {
                    Err(PdfError::Cancelled)
                } else {
                    f(state, &cancel_clone)
                };
                let _ = tx.send(out);
            }),
        };

        {
            let mut guard = self.queue.lock().expect("actor queue poisoned");
            if let Some(sc) = scope {
                guard.scope_flags.entry(sc).or_default().push(cancel);
            }
            guard.heap.push(job);
            self.cv.notify_one();
        }

        rx.recv()
            .map_err(|e| PdfError::Backend(format!("engine actor channel dropped: {e}")))?
    }
}

pub fn engine_actor() -> &'static PdfEngineActor {
    static INSTANCE: OnceLock<PdfEngineActor> = OnceLock::new();
    static STARTED: OnceLock<()> = OnceLock::new();
    let actor = INSTANCE.get_or_init(PdfEngineActor::spawn);
    STARTED.get_or_init(|| actor.start_worker());
    actor
}

/// Safe atomic write helper for native mobile & desktop saves (04 §6.2-1):
/// writes to `<dest>.tmp.<pid>`, verifies PDFium opens & counts pages cleanly,
/// then atomically replaces `<dest>` (preserving original if anything fails).
pub fn atomic_write_and_verify_pdf(
    pdfium: &Pdfium,
    dest_path: &Path,
    bytes: &[u8],
) -> Result<(usize, u64), PdfError> {
    if bytes.is_empty() {
        return Err(PdfError::RenderFailed("compiled PDF output is empty".to_string()));
    }
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| PdfError::Backend(format!("failed creating output dir: {e}")))?;
    }

    let file_name = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("output.pdf");
    let tmp_path = dest_path.with_file_name(format!(".{file_name}.tmp.{}", std::process::id()));

    std::fs::write(&tmp_path, bytes)
        .map_err(|e| PdfError::Backend(format!("failed writing temp PDF {}: {e}", tmp_path.display())))?;

    // Re-open the written temporary file via PDFium to verify integrity before swapping.
    let verified_bytes = std::fs::read(&tmp_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        PdfError::Backend(format!("failed verifying temp PDF: {e}"))
    })?;

    let verified_doc = match pdfium.load_pdf_from_byte_vec(verified_bytes, None) {
        Ok(doc) => doc,
        Err(err) => {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(PdfError::Backend(format!(
                "compiled PDF failed post-write verification: {err}"
            )));
        }
    };
    let page_count = verified_doc.pages().len() as usize;
    drop(verified_doc);

    if page_count == 0 {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(PdfError::Backend(
            "compiled PDF verification failed: page count is zero".to_string(),
        ));
    }

    #[cfg(target_os = "windows")]
    if dest_path.exists() {
        let backup = dest_path.with_file_name(format!(".{file_name}.bak.{}", std::process::id()));
        if std::fs::rename(dest_path, &backup).is_ok() {
            if let Err(err) = std::fs::rename(&tmp_path, dest_path) {
                let _ = std::fs::rename(&backup, dest_path);
                let _ = std::fs::remove_file(&tmp_path);
                return Err(PdfError::Backend(format!("failed committing verified PDF: {err}")));
            }
            let _ = std::fs::remove_file(&backup);
            return Ok((page_count, bytes.len() as u64));
        }
    }

    std::fs::rename(&tmp_path, dest_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        PdfError::Backend(format!("failed committing verified PDF: {e}"))
    })?;

    Ok((page_count, bytes.len() as u64))
}

pub fn serialize_compiled_and_inspect(
    state: &mut ActorState,
    pages: &[PageMeta],
    elements: &[CanvasElement],
    redactions: &[RedactionRect],
    font_bytes: Option<&[u8]>,
) -> Result<Vec<u8>, PdfError> {
    let backend = state.ensure_backend(None)?;
    backend.compile_native_pdf(pages, elements, redactions, font_bytes)
}

#[allow(dead_code)]
fn _touch_types(
    _: (
        PdfOpenResult,
        PdfOutlineNode,
        PdfSearchHit,
        PdfTextCharBox,
        PdfTextSpan,
        ReadingTheme,
        RenderedBitmap,
        TileRenderRequest,
        PdfInspectionPage,
        PageObjectAnalysis,
    ),
) {
}
