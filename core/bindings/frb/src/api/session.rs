use std::collections::HashMap;
use std::path::PathBuf;

use flutter_rust_bridge::frb;
use gp_geom::{
    compute_rotated_resize_rect as geom_compute_rotated_resize_rect, compute_snap_position,
    ResizeHandle, RotatedResizeParams,
};
use gp_model::{CanvasElement, PageMeta, PageNumberingConfig, RectBox, RotationAngle};
use gp_pdf::{
    CancellationFlag, PdfBackend, PdfLinkKind, PdfOpenStatus, PdfOutlineNode, ReadingTheme,
    RedactionRect, TileRenderRequest,
};
use gp_pdf_pdfium::{
    compile::{CompilePdfOptions, CompiledFontBundle, PreDecodedImage},
    redaction::redact_document_verified,
};
use gp_redact::extract_embedded_fonts_with_lopdf;

use crate::{
    actor::{atomic_write_and_verify_pdf, engine_actor, ActorPriority},
    frb_generated::StreamSink,
};

#[frb(init)]
pub fn init_frb_app() {
    flutter_rust_bridge::setup_default_user_utils();
}

#[derive(Debug, Clone)]
pub struct FrbPageSummary {
    pub source_page_index: u32,
    pub base_width: f64,
    pub base_height: f64,
    pub intrinsic_rotation: i32,
}

#[derive(Debug, Clone)]
pub struct FrbOutlineItem {
    pub id: String,
    pub title: String,
    pub page_index: Option<u32>,
    pub children: Vec<FrbOutlineItem>,
}

#[derive(Debug, Clone)]
pub struct FrbOpenDocResult {
    pub status: String,
    pub page_count: u32,
    pub pages: Vec<FrbPageSummary>,
    pub can_copy_text: bool,
    pub outline: Vec<FrbOutlineItem>,
}

#[derive(Debug, Clone)]
pub struct FrbTileRequest {
    pub doc_id: String,
    pub page_index: u32,
    pub tile_x: i32,
    pub tile_y: i32,
    pub tile_width_px: u32,
    pub tile_height_px: u32,
    pub scale: f64,
    pub user_rotation: i32,
    pub transparent_bg: bool,
    /// `"light"`, `"dark"`, or `"sepia"`
    pub theme: String,
    pub dark_paper_invert: bool,
    /// `0 = visible tile`, `1 = preview`, `2 = thumbnail`
    pub priority_tier: u8,
    pub scope: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FrbTileBitmap {
    pub width: u32,
    pub height: u32,
    /// Premultiplied RGBA8888 pixels ready for Dart `ui.ImageDescriptor.raw`.
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct FrbTextSpan {
    pub id: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub font_size: f64,
    pub baseline_y: f64,
}

#[derive(Debug, Clone)]
pub struct FrbPageText {
    pub page_index: u32,
    pub plain_text: String,
    pub spans: Vec<FrbTextSpan>,
}

#[derive(Debug, Clone)]
pub struct FrbSearchRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
pub struct FrbSearchHit {
    pub page_index: u32,
    pub match_index_in_page: u32,
    pub snippet: String,
    pub rects: Vec<FrbSearchRect>,
}

#[derive(Debug, Clone)]
pub struct FrbSearchProgress {
    pub scanned_pages: u32,
    pub total_pages: u32,
    pub done: bool,
    pub hits: Vec<FrbSearchHit>,
}

#[derive(Debug, Clone)]
pub struct FrbRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
pub struct FrbSnapResult {
    pub x: f64,
    pub y: f64,
    pub snapped: bool,
}

#[derive(Debug, Clone)]
pub struct FrbRedactionRect {
    pub page_index: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
pub struct FrbRedactionVerifyResult {
    pub redacted_regions: u32,
    pub removed_objects: u32,
    pub remaining_matches: u32,
    pub verified: bool,
    pub output_page_count: u32,
    pub output_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct FrbEmbeddedImage {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct FrbLinkAnnotation {
    pub id: String,
    pub page_index: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// `"uri"` | `"goto"`
    pub kind: String,
    pub uri: Option<String>,
    pub dest_page_index: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct FrbCompileSaveRequest {
    pub pages_json: String,
    pub elements_json: String,
    pub page_numbering_json: Option<String>,
    pub redactions: Vec<FrbRedactionRect>,
    pub output_path: String,
    pub custom_ttf_bytes: Option<Vec<u8>>,
    pub font_regular_ttf: Option<Vec<u8>>,
    pub font_bold_ttf: Option<Vec<u8>>,
    pub font_italic_ttf: Option<Vec<u8>>,
    pub font_serif_ttf: Option<Vec<u8>>,
    pub font_mono_ttf: Option<Vec<u8>>,
    pub embedded_images: Vec<FrbEmbeddedImage>,
}

#[derive(Debug, Clone)]
pub struct FrbCompileSaveResult {
    pub output_path: String,
    pub verified_page_count: u32,
    pub byte_size: u64,
}

fn to_outline_items(nodes: Vec<PdfOutlineNode>) -> Vec<FrbOutlineItem> {
    nodes
        .into_iter()
        .map(|n| FrbOutlineItem {
            id: n.id,
            title: n.title,
            page_index: n.page_index.map(|p| p as u32),
            children: to_outline_items(n.children),
        })
        .collect()
}

fn parse_rotation(deg: i32) -> RotationAngle {
    match ((deg % 360) + 360) % 360 {
        90 => 90,
        180 => 180,
        270 => 270,
        _ => 0,
    }
}

fn parse_theme(theme: &str) -> ReadingTheme {
    match theme.to_ascii_lowercase().as_str() {
        "dark" => ReadingTheme::Dark,
        "sepia" => ReadingTheme::Sepia,
        _ => ReadingTheme::Default,
    }
}

fn map_open_status(status: PdfOpenStatus) -> &'static str {
    match status {
        PdfOpenStatus::Ok => "ok",
        PdfOpenStatus::NeedsPassword => "needs-password",
        PdfOpenStatus::InvalidPassword => "invalid-password",
    }
}

/// Initializes the dedicated single-thread PDFium engine actor (00 -> D2).
pub fn init_engine(pdfium_library_path: Option<String>, tile_budget_bytes: u64) -> Result<(), String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            state.ensure_backend(pdfium_library_path.as_deref())?;
            if tile_budget_bytes >= 8 * 1024 * 1024 {
                state.session.tile_cache = gp_engine::TileCache::new(tile_budget_bytes as usize);
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
}

/// Opens a PDF working copy from the device filesystem without duplicating RAM buffers in Dart.
pub fn open_document_file(
    doc_id: String,
    path: String,
    password: Option<String>,
) -> Result<FrbOpenDocResult, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("failed reading PDF file {path}: {e}"))?;
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            state.ensure_backend(None)?;
            state.doc_paths.insert(doc_id.clone(), path);
            let open_res = {
                let backend = state.backend.as_mut().expect("backend initialized");
                backend.open_document(&doc_id, &bytes, password.as_deref())?
            };
            let outline = if open_res.status == PdfOpenStatus::Ok {
                let backend = state.backend.as_ref().expect("backend initialized");
                backend.extract_outline(&doc_id).unwrap_or_default()
            } else {
                Vec::new()
            };
            Ok(FrbOpenDocResult {
                status: map_open_status(open_res.status).to_string(),
                page_count: open_res.page_count as u32,
                pages: open_res
                    .pages
                    .into_iter()
                    .map(|p| FrbPageSummary {
                        source_page_index: p.source_page_index as u32,
                        base_width: p.base_width,
                        base_height: p.base_height,
                        intrinsic_rotation: p.intrinsic_rotation as i32,
                    })
                    .collect(),
                can_copy_text: open_res.can_copy_text,
                outline: to_outline_items(outline),
            })
        })
        .map_err(|e| e.to_string())
}

pub fn open_document_bytes(
    doc_id: String,
    bytes: Vec<u8>,
    password: Option<String>,
) -> Result<FrbOpenDocResult, String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            state.ensure_backend(None)?;
            let open_res = {
                let backend = state.backend.as_mut().expect("backend initialized");
                backend.open_document(&doc_id, &bytes, password.as_deref())?
            };
            let outline = if open_res.status == PdfOpenStatus::Ok {
                let backend = state.backend.as_ref().expect("backend initialized");
                backend.extract_outline(&doc_id).unwrap_or_default()
            } else {
                Vec::new()
            };
            Ok(FrbOpenDocResult {
                status: map_open_status(open_res.status).to_string(),
                page_count: open_res.page_count as u32,
                pages: open_res
                    .pages
                    .into_iter()
                    .map(|p| FrbPageSummary {
                        source_page_index: p.source_page_index as u32,
                        base_width: p.base_width,
                        base_height: p.base_height,
                        intrinsic_rotation: p.intrinsic_rotation as i32,
                    })
                    .collect(),
                can_copy_text: open_res.can_copy_text,
                outline: to_outline_items(outline),
            })
        })
        .map_err(|e| e.to_string())
}

pub fn close_document(doc_id: String) -> Result<(), String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            state.doc_paths.remove(&doc_id);
            if let Some(backend) = state.backend.as_mut() {
                let _ = backend.close_document(&doc_id);
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
}

pub fn render_tile(req: FrbTileRequest) -> Result<FrbTileBitmap, String> {
    let priority = match req.priority_tier {
        0 => ActorPriority::VisibleTile,
        1 => ActorPriority::Preview,
        _ => ActorPriority::Thumbnail,
    };
    let cancel = CancellationFlag::new();
    let scope = req.scope.clone();

    engine_actor()
        .dispatch(priority, scope, cancel, move |state, cancel_flag| {
            let backend = state.ensure_backend(None)?;
            let pdf_req = TileRenderRequest {
                source_doc_id: req.doc_id,
                page_index: req.page_index as usize,
                tile_x: req.tile_x,
                tile_y: req.tile_y,
                tile_width_px: req.tile_width_px.max(1),
                tile_height_px: req.tile_height_px.max(1),
                scale: req.scale.clamp(0.1, 8.0),
                user_rotation: parse_rotation(req.user_rotation),
                transparent_bg: req.transparent_bg,
                theme: Some(parse_theme(&req.theme)),
                dark_paper_invert: req.dark_paper_invert,
            };
            let mut bmp = backend.render_tile(&pdf_req, cancel_flag)?;
            if req.transparent_bg {
                for px in bmp.rgba.chunks_exact_mut(4) {
                    let a = px[3] as u16;
                    if a < 255 {
                        px[0] = ((px[0] as u16 * a) / 255) as u8;
                        px[1] = ((px[1] as u16 * a) / 255) as u8;
                        px[2] = ((px[2] as u16 * a) / 255) as u8;
                    }
                }
            }
            Ok(FrbTileBitmap {
                width: bmp.width,
                height: bmp.height,
                rgba: bmp.rgba,
            })
        })
        .map_err(|e| e.to_string())
}

pub fn cancel_render_scope(scope: String) -> u32 {
    engine_actor().cancel_scope(&scope) as u32
}

pub fn trim_engine_memory(target_bytes: u64) -> Result<(), String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            state.session.trim_memory(target_bytes as usize);
            Ok(())
        })
        .map_err(|e| e.to_string())
}

pub fn extract_page_text(doc_id: String, page_index: u32) -> Result<FrbPageText, String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            let backend = state.ensure_backend(None)?;
            let plain_text = backend.extract_page_text(&doc_id, page_index as usize)?;
            let spans = backend
                .extract_text_spans(&doc_id, page_index as usize)?
                .into_iter()
                .map(|s| FrbTextSpan {
                    id: s.id,
                    text: s.text,
                    x: s.x,
                    y: s.y,
                    width: s.width,
                    height: s.height,
                    font_size: s.font_size,
                    baseline_y: s.baseline_y,
                })
                .collect();
            Ok(FrbPageText {
                page_index,
                plain_text,
                spans,
            })
        })
        .map_err(|e| e.to_string())
}

pub fn extract_document_outline(doc_id: String) -> Result<Vec<FrbOutlineItem>, String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            let backend = state.ensure_backend(None)?;
            let nodes = backend.extract_outline(&doc_id)?;
            Ok(to_outline_items(nodes))
        })
        .map_err(|e| e.to_string())
}

pub fn analyze_page_objects_json(
    doc_id: String,
    page_index: u32,
    page_id: String,
) -> Result<String, String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::SearchOrAnalysis, None, cancel, move |state, _| {
            let backend = state.ensure_backend(None)?;
            let analysis = backend.analyze_page_objects(&doc_id, page_index as usize, &page_id)?;
            serde_json::to_string(&analysis)
                .map_err(|e| gp_pdf::PdfError::Backend(format!("serialization error: {e}")))
        })
        .map_err(|e| e.to_string())
}

pub fn extract_page_links(
    doc_id: String,
    page_index: u32,
) -> Result<Vec<FrbLinkAnnotation>, String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            let backend = state.ensure_backend(None)?;
            let links = backend.extract_links(&doc_id, page_index as usize)?;
            Ok(links
                .into_iter()
                .map(|l| FrbLinkAnnotation {
                    id: l.id,
                    page_index: l.page_index as u32,
                    x: l.x,
                    y: l.y,
                    width: l.width,
                    height: l.height,
                    kind: match l.kind {
                        PdfLinkKind::Uri => "uri".to_string(),
                        PdfLinkKind::Goto => "goto".to_string(),
                    },
                    uri: l.uri,
                    dest_page_index: l.dest_page_index.map(|p| p as u32),
                })
                .collect())
        })
        .map_err(|e| e.to_string())
}

pub fn prepare_clean_page_preview(
    doc_id: String,
    page_index: u32,
    elements_json: String,
) -> Result<Vec<u8>, String> {
    let elements: Vec<CanvasElement> =
        serde_json::from_str(&elements_json).map_err(|e| format!("invalid elements_json: {e}"))?;
    let mut text_rects = Vec::new();
    let mut image_rects = Vec::new();
    let mut shape_rects = Vec::new();
    for el in elements {
        let b = el.base();
        let box_rect = RectBox {
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
        };
        match el {
            CanvasElement::TextEdit { .. } => text_rects.push(box_rect),
            CanvasElement::ImageReplacement { .. } => image_rects.push(box_rect),
            CanvasElement::ShapeReplacement { .. } => shape_rects.push(box_rect),
            _ => {}
        }
    }

    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            let backend = state.ensure_backend(None)?;
            backend.prepare_clean_page_preview(
                &doc_id,
                page_index as usize,
                &text_rects,
                &image_rects,
                &shape_rects,
            )
        })
        .map_err(|e| e.to_string())
}

/// Sliced Turkish/Unicode-folded search executing page by page via the D2 actor so
/// visible viewport tiles always preempt search work (04 §4.3).
pub fn search_document_stream(
    doc_id: String,
    query: String,
    match_case: bool,
    whole_word: bool,
    sink: StreamSink<FrbSearchProgress>,
) -> Result<(), String> {
    let total_pages = engine_actor()
        .dispatch(
            ActorPriority::SearchOrAnalysis,
            None,
            CancellationFlag::new(),
            {
                let doc_id = doc_id.clone();
                move |state, _| {
                    let backend = state.ensure_backend(None)?;
                    // Inspect page count by querying outline or page 0 bounds check
                    let mut count = 0usize;
                    while backend.extract_page_text(&doc_id, count).is_ok() {
                        count += 1;
                    }
                    Ok(count)
                }
            },
        )
        .map_err(|e| e.to_string())?;

    if total_pages == 0 || query.trim().is_empty() {
        let _ = sink.add(FrbSearchProgress {
            scanned_pages: 0,
            total_pages: total_pages as u32,
            done: true,
            hits: Vec::new(),
        });
        return Ok(());
    }

    for page_idx in 0..total_pages {
        let q = query.clone();
        let d_id = doc_id.clone();
        let page_hits = engine_actor()
            .dispatch(
                ActorPriority::SearchOrAnalysis,
                Some(format!("search:{doc_id}")),
                CancellationFlag::new(),
                move |state, _| {
                    let backend = state.ensure_backend(None)?;
                    let hits = backend.search_page(&d_id, page_idx, &q, !match_case)?;
                    if !whole_word {
                        return Ok(hits);
                    }
                    Ok(hits
                        .into_iter()
                        .filter(|h| !h.snippet.trim().is_empty())
                        .collect())
                },
            )
            .map_err(|e| e.to_string())?;

        let frb_hits: Vec<FrbSearchHit> = page_hits
            .into_iter()
            .map(|h| FrbSearchHit {
                page_index: h.page_index as u32,
                match_index_in_page: h.match_index_in_page as u32,
                snippet: h.snippet,
                rects: h
                    .rects
                    .into_iter()
                    .map(|r| FrbSearchRect {
                        x: r.x,
                        y: r.y,
                        width: r.width,
                        height: r.height,
                    })
                    .collect(),
            })
            .collect();

        let _ = sink.add(FrbSearchProgress {
            scanned_pages: (page_idx + 1) as u32,
            total_pages: total_pages as u32,
            done: page_idx + 1 == total_pages,
            hits: frb_hits,
        });
    }

    Ok(())
}

/// Pure Rust rotated resize computation shared cleanly with Flutter overlays (gp-geom).
#[frb(sync)]
pub fn compute_rotated_resize_rect(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation_deg: f64,
    handle: String,
    dx_px: f64,
    dy_px: f64,
    aspect_locked: bool,
) -> FrbRect {
    let parsed_handle = match handle.to_ascii_lowercase().as_str() {
        "nw" => ResizeHandle::Nw,
        "n" => ResizeHandle::N,
        "ne" => ResizeHandle::Ne,
        "e" => ResizeHandle::E,
        "se" => ResizeHandle::Se,
        "s" => ResizeHandle::S,
        "sw" => ResizeHandle::Sw,
        _ => ResizeHandle::W,
    };
    let next = geom_compute_rotated_resize_rect(RotatedResizeParams {
        start_rect: RectBox {
            x,
            y,
            width,
            height,
        },
        handle: parsed_handle,
        dx_px,
        dy_px,
        frame_rotation_deg: rotation_deg,
        user_rotation: 0,
        zoom: 1.0,
        aspect_locked,
        shift_key: false,
        min_size: 12.0,
    });
    FrbRect {
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
    }
}

/// Pure Rust smart snap guide alignment (gp-geom).
#[frb(sync)]
pub fn compute_snap_guide_position(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    page_w: f64,
    page_h: f64,
    siblings_json: String,
) -> FrbSnapResult {
    let siblings: Vec<RectBox> = serde_json::from_str(&siblings_json).unwrap_or_default();
    let res = compute_snap_position(
        RectBox {
            x,
            y,
            width,
            height,
        },
        page_w,
        page_h,
        &siblings,
        true,
    );
    FrbSnapResult {
        x: res.x,
        y: res.y,
        snapped: !res.guides.is_empty(),
    }
}

/// Applies an immutable JSON command via `gp-engine::EngineSession` and returns updated session JSON.
pub fn apply_session_command(snapshot_json: Option<String>, command_json: String) -> Result<String, String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            if let Some(snap) = snapshot_json {
                state
                    .session
                    .load_snapshot_json(&snap)
                    .map_err(|e| gp_pdf::PdfError::Backend(e.to_string()))?;
            }
            state
                .session
                .apply_command_json(&command_json)
                .map_err(|e| gp_pdf::PdfError::Backend(e.to_string()))
        })
        .map_err(|e| e.to_string())
}

pub fn extract_embedded_fonts_json(file_path: String) -> Result<String, String> {
    let bytes = std::fs::read(&file_path).map_err(|e| format!("failed reading {file_path}: {e}"))?;
    let bundle = extract_embedded_fonts_with_lopdf(&file_path, &bytes)
        .map_err(|e| format!("font extract failed: {e}"))?;
    serde_json::to_string(&bundle).map_err(|e| e.to_string())
}

/// Compiles edited PDF via PDFium + verified D3 redactions, writes temp file, re-opens to verify
/// page count/integrity, and atomically replaces `output_path` (04 §6.2-1).
pub fn compile_and_save_verified(req: FrbCompileSaveRequest) -> Result<FrbCompileSaveResult, String> {
    let pages: Vec<PageMeta> = serde_json::from_str(&req.pages_json)
        .map_err(|e| format!("invalid pages_json: {e}"))?;
    let elements: Vec<CanvasElement> = serde_json::from_str(&req.elements_json)
        .map_err(|e| format!("invalid elements_json: {e}"))?;
    let page_numbering: Option<PageNumberingConfig> = match &req.page_numbering_json {
        Some(raw) if !raw.trim().is_empty() => Some(
            serde_json::from_str(raw)
                .map_err(|e| format!("invalid page_numbering_json: {e}"))?,
        ),
        _ => None,
    };
    let redactions: Vec<RedactionRect> = req
        .redactions
        .into_iter()
        .map(|r| RedactionRect {
            page_index: r.page_index as usize,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
        })
        .collect();
    let mut img_map: HashMap<String, PreDecodedImage> = HashMap::new();
    for img in req.embedded_images {
        img_map.insert(
            img.id,
            PreDecodedImage {
                width: img.width,
                height: img.height,
                rgba: img.rgba,
            },
        );
    }

    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::Compile, None, cancel, move |state, _| {
            let backend = state.ensure_backend(None)?;
            let options = CompilePdfOptions {
                fonts: CompiledFontBundle {
                    custom_ttf_bytes: req.custom_ttf_bytes.as_deref(),
                    regular_ttf_bytes: req.font_regular_ttf.as_deref(),
                    bold_ttf_bytes: req.font_bold_ttf.as_deref(),
                    italic_ttf_bytes: req.font_italic_ttf.as_deref(),
                    serif_ttf_bytes: req.font_serif_ttf.as_deref(),
                    mono_ttf_bytes: req.font_mono_ttf.as_deref(),
                },
                page_numbering: page_numbering.as_ref(),
                embedded_images: Some(&img_map),
                ..Default::default()
            };
            let out_bytes = backend.compile_native_pdf_with_options(
                &pages,
                &elements,
                &redactions,
                options,
            )?;
            let out_path = PathBuf::from(&req.output_path);
            let (verified_pages, byte_size) =
                atomic_write_and_verify_pdf(backend.pdfium(), &out_path, &out_bytes)?;
            Ok(FrbCompileSaveResult {
                output_path: req.output_path,
                verified_page_count: verified_pages as u32,
                byte_size,
            })
        })
        .map_err(|e| e.to_string())
}

/// Standalone D3 verified content-stream redaction on file + atomic write + verification.
pub fn redact_file_verified(
    input_path: String,
    output_path: String,
    password: Option<String>,
    rects: Vec<FrbRedactionRect>,
) -> Result<FrbRedactionVerifyResult, String> {
    let raw_bytes =
        std::fs::read(&input_path).map_err(|e| format!("failed reading input {input_path}: {e}"))?;
    let redactions: Vec<RedactionRect> = rects
        .into_iter()
        .map(|r| RedactionRect {
            page_index: r.page_index as usize,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
        })
        .collect();

    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::Compile, None, cancel, move |state, _| {
            let backend = state.ensure_backend(None)?;
            let (clean_bytes, report) = redact_document_verified(
                backend.pdfium(),
                raw_bytes,
                password.as_deref(),
                &redactions,
            )?;
            let dest = PathBuf::from(&output_path);
            let (page_count, byte_size) =
                atomic_write_and_verify_pdf(backend.pdfium(), &dest, &clean_bytes)?;
            Ok(FrbRedactionVerifyResult {
                redacted_regions: report.redacted_regions as u32,
                removed_objects: report.removed_objects as u32,
                remaining_matches: report.remaining_matches as u32,
                verified: report.verified,
                output_page_count: page_count as u32,
                output_bytes: byte_size,
            })
        })
        .map_err(|e| e.to_string())
}
