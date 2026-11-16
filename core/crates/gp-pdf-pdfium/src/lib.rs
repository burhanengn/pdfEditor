pub mod objects;
pub mod redaction;

use std::{collections::HashMap, path::Path};

use gp_model::{CanvasElement, PageMeta, RotationAngle};
use gp_pdf::{
    CancellationFlag, PdfBackend, PdfError, PdfLinkAnnotation, PdfLinkKind, PdfOpenResult,
    PdfOpenStatus, PdfOutlineNode, PdfPageSummary, PdfSearchHit, PdfSearchRect, PdfTextCharBox,
    PdfTextSpan, ReadingTheme, RedactionRect, RedactionReport, RenderedBitmap, TileRenderRequest,
};
use gp_text::normalize_for_turkish_search;
use pdfium_render::prelude::*;

use crate::{
    objects::{analyze_page_objects_with_pdfium, PageObjectAnalysis},
    redaction::redact_document_verified,
};

struct StoredDoc {
    doc: PdfDocument<'static>,
    raw_bytes: Vec<u8>,
    password: Option<String>,
    pages: Vec<PdfPageSummary>,
}

/// Native single-thread PDFium backend implementing `gp_pdf::PdfBackend`.
pub struct PdfiumBackend {
    pdfium: &'static Pdfium,
    docs: HashMap<String, StoredDoc>,
}

impl PdfiumBackend {
    pub fn from_pdfium(pdfium: Pdfium) -> Self {
        let leaked: &'static Pdfium = Box::leak(Box::new(pdfium));
        Self {
            pdfium: leaked,
            docs: HashMap::new(),
        }
    }

    pub fn from_library_path(path: impl AsRef<Path>) -> Result<Self, PdfError> {
        let bindings = Pdfium::bind_to_library(path.as_ref())
            .map_err(|e| PdfError::Backend(format!("failed to bind PDFium library: {e}")))?;
        Ok(Self::from_pdfium(Pdfium::new(bindings)))
    }

    pub fn from_system() -> Result<Self, PdfError> {
        let bindings = Pdfium::bind_to_system_library()
            .map_err(|e| PdfError::Backend(format!("failed to bind system PDFium library: {e}")))?;
        Ok(Self::from_pdfium(Pdfium::new(bindings)))
    }

    #[cfg(test)]
    pub(crate) fn new_for_test() -> Result<Self, PdfError> {
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(env_path) = std::env::var("PDFIUM_LIB_PATH") {
            candidates.push(std::path::PathBuf::from(env_path));
        }
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        if let Some(root) = manifest_dir.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
            candidates.push(root.join(".pdfium-cache").join("pdfium.dll"));
            candidates.push(root.join(".pdfium-cache").join("libpdfium.so"));
            candidates.push(root.join(".pdfium-cache").join("libpdfium.dylib"));
        }
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            candidates.push(
                std::path::PathBuf::from(home)
                    .join(".cache")
                    .join("pdfium-bundled")
                    .join("pdfium-8066")
                    .join("pdfium.dll"),
            );
        }
        for path in &candidates {
            if path.exists() {
                return Self::from_library_path(path);
            }
        }
        Self::from_system()
    }

    pub fn pdfium(&self) -> &'static Pdfium {
        self.pdfium
    }

    pub fn analyze_page_objects(
        &self,
        doc_id: &str,
        page_index: usize,
        page_id: &str,
    ) -> Result<PageObjectAnalysis, PdfError> {
        let stored = self.get_doc(doc_id)?;
        analyze_page_objects_with_pdfium(&stored.doc, page_index, page_id)
    }

    /// Compiles reordered/rotated pages, blank pages, and new TrueType/path elements cleanly
    /// via PDFium native object APIs + D3 redaction verification (`FPDF_SaveAsCopy`).
    pub fn compile_native_pdf(
        &self,
        pages: &[PageMeta],
        elements: &[CanvasElement],
        redactions: &[RedactionRect],
        truetype_font_bytes: Option<&[u8]>,
    ) -> Result<Vec<u8>, PdfError> {
        let mut out_doc = self
            .pdfium
            .create_new_pdf()
            .map_err(|e| PdfError::Backend(format!("failed creating output PDF: {e}")))?;

        let ttf_token = truetype_font_bytes
            .and_then(|bytes| out_doc.fonts_mut().load_true_type_from_bytes(bytes, true).ok());
        let fallback_font = out_doc.fonts_mut().helvetica();

        // Build source document working map after any required redactions on source docs
        let mut redacted_sources: HashMap<String, Vec<u8>> = HashMap::new();
        for (doc_id, stored) in &self.docs {
            let doc_redactions: Vec<RedactionRect> = redactions
                .iter()
                .filter(|r| {
                    pages.iter().any(|p| {
                        p.source_doc_id == *doc_id && p.source_page_index == r.page_index
                    })
                })
                .copied()
                .collect();
            if doc_redactions.is_empty() {
                redacted_sources.insert(doc_id.clone(), stored.raw_bytes.clone());
            } else {
                let (clean_bytes, _) = redact_document_verified(
                    self.pdfium,
                    stored.raw_bytes.clone(),
                    stored.password.as_deref(),
                    &doc_redactions,
                )?;
                redacted_sources.insert(doc_id.clone(), clean_bytes);
            }
        }

        let mut loaded_sources: HashMap<String, PdfDocument<'_>> = HashMap::new();
        for (doc_id, bytes) in redacted_sources {
            let pw = self.docs.get(&doc_id).and_then(|s| s.password.as_deref());
            if let Ok(d) = self.pdfium.load_pdf_from_byte_vec(bytes, pw) {
                loaded_sources.insert(doc_id, d);
            }
        }

        for (out_idx, pm) in pages.iter().enumerate() {
            if let Some(src_doc) = loaded_sources.get(&pm.source_doc_id) {
                let src_idx = pm.source_page_index as PdfPageIndex;
                out_doc
                    .pages_mut()
                    .copy_page_from_document(src_doc, src_idx, out_idx as PdfPageIndex)
                    .map_err(|e| PdfError::Backend(format!("failed importing page {src_idx}: {e}")))?;
            } else {
                out_doc
                    .pages_mut()
                    .create_page_at_index(
                        PdfPagePaperSize::Custom(
                            PdfPoints::new(pm.base_width as f32),
                            PdfPoints::new(pm.base_height as f32),
                        ),
                        out_idx as PdfPageIndex,
                    )
                    .map_err(|e| PdfError::Backend(format!("failed creating blank page: {e}")))?;
            }

            let mut out_page = out_doc
                .pages()
                .get(out_idx as PdfPageIndex)
                .map_err(|e| PdfError::Backend(format!("failed opening output page: {e}")))?;
            let page_h = out_page.height().value as f64;

            for el in elements {
                if el.page_id() != pm.id || el.is_deleted() {
                    continue;
                }
                match el {
                    CanvasElement::TextAdd {
                        base,
                        text,
                        font_size,
                        ..
                    }
                    | CanvasElement::TextEdit {
                        base,
                        text,
                        font_size,
                        ..
                    } => {
                        let font = ttf_token.unwrap_or(fallback_font);
                        let pdf_y = (page_h - base.y - font_size).max(8.0);
                        let _ = out_page.objects_mut().create_text_object(
                            PdfPoints::new(base.x as f32),
                            PdfPoints::new(pdf_y as f32),
                            text,
                            font,
                            PdfPoints::new(*font_size as f32),
                        );
                    }
                    _ => {}
                }
            }
            let _ = out_page.regenerate_content();
        }

        out_doc
            .save_to_bytes()
            .map_err(|e| PdfError::Backend(format!("failed saving compiled PDF: {e}")))
    }

    fn get_doc(&self, doc_id: &str) -> Result<&StoredDoc, PdfError> {
        self.docs
            .get(doc_id)
            .ok_or_else(|| PdfError::DocumentNotFound(doc_id.to_string()))
    }
}

pub(crate) fn visual_rect_to_pdfium_rect(page: &PdfPage<'_>, rect: &RedactionRect) -> PdfRect {
    let page_w = page.width().value as f64;
    let page_h = page.height().value as f64;
    let x0 = rect.x.clamp(0.0, page_w);
    let x1 = (rect.x + rect.width).clamp(0.0, page_w);
    let y_top = (page_h - rect.y).clamp(0.0, page_h);
    let y_bot = (page_h - (rect.y + rect.height)).clamp(0.0, page_h);
    PdfRect::new(
        PdfPoints::new(y_bot.min(y_top) as f32),
        PdfPoints::new(x0.min(x1) as f32),
        PdfPoints::new(y_top.max(y_bot) as f32),
        PdfPoints::new(x1.max(x0) as f32),
    )
}

fn pdfium_rect_to_visual(page_h: f64, rect: &PdfRect) -> (f64, f64, f64, f64) {
    let left = rect.left().value as f64;
    let right = rect.right().value as f64;
    let top = rect.top().value as f64;
    let bottom = rect.bottom().value as f64;
    let x = left.min(right);
    let y = (page_h - top.max(bottom)).max(0.0);
    let w = (right - left).abs();
    let h = (top - bottom).abs();
    (x, y, w, h)
}

fn intrinsic_rotation_to_angle(rot: Result<PdfPageRenderRotation, PdfiumError>) -> RotationAngle {
    match rot {
        Ok(PdfPageRenderRotation::Degrees90) => 90,
        Ok(PdfPageRenderRotation::Degrees180) => 180,
        Ok(PdfPageRenderRotation::Degrees270) => 270,
        _ => 0,
    }
}

fn to_pdfium_rotation(deg: RotationAngle) -> PdfPageRenderRotation {
    match ((deg % 360) + 360) % 360 {
        90 => PdfPageRenderRotation::Degrees90,
        180 => PdfPageRenderRotation::Degrees180,
        270 => PdfPageRenderRotation::Degrees270,
        _ => PdfPageRenderRotation::None,
    }
}

fn apply_reading_theme(rgba: &mut [u8], theme: Option<ReadingTheme>, dark_paper_invert: bool) {
    let Some(t) = theme else {
        return;
    };
    match t {
        ReadingTheme::Default => {}
        ReadingTheme::Sepia => {
            for px in rgba.chunks_exact_mut(4) {
                let r = px[0] as f32;
                let g = px[1] as f32;
                let b = px[2] as f32;
                px[0] = (r * 0.96).min(255.0) as u8;
                px[1] = (g * 0.91).min(255.0) as u8;
                px[2] = (b * 0.80).min(255.0) as u8;
            }
        }
        ReadingTheme::Dark if dark_paper_invert => {
            for px in rgba.chunks_exact_mut(4) {
                if px[3] == 0 {
                    continue;
                }
                px[0] = 255 - px[0];
                px[1] = 255 - px[1];
                px[2] = 255 - px[2];
            }
        }
        ReadingTheme::Dark => {}
    }
}

impl PdfBackend for PdfiumBackend {
    fn open_document(
        &mut self,
        doc_id: &str,
        bytes: &[u8],
        password: Option<&str>,
    ) -> Result<PdfOpenResult, PdfError> {
        let raw_bytes = bytes.to_vec();
        let doc_res = self.pdfium.load_pdf_from_byte_vec(raw_bytes.clone(), password);
        let doc = match doc_res {
            Ok(d) => d,
            Err(err) => {
                let msg = format!("{err:?}");
                if msg.contains("Password") {
                    return if password.is_some() {
                        Err(PdfError::InvalidPassword)
                    } else {
                        Err(PdfError::PasswordRequired)
                    };
                }
                return Err(PdfError::Backend(format!("failed opening PDF: {err}")));
            }
        };

        let mut pages = Vec::with_capacity(doc.pages().len() as usize);
        for (idx, page) in doc.pages().iter().enumerate() {
            pages.push(PdfPageSummary {
                source_page_index: idx,
                base_width: page.width().value as f64,
                base_height: page.height().value as f64,
                intrinsic_rotation: intrinsic_rotation_to_angle(page.rotation()),
            });
        }

        let perms = doc.permissions();
        let can_copy_text = perms.can_extract_text_and_graphics().unwrap_or(true);
        let mut permissions: u32 = 0;
        if perms.can_print_high_quality().unwrap_or(true) {
            permissions |= 1 << 2;
        }
        if perms.can_assemble_document().unwrap_or(true) {
            permissions |= 1 << 10;
        }
        if can_copy_text {
            permissions |= 1 << 4;
        }
        let page_count = pages.len();

        let summary_pages = pages.clone();
        self.docs.insert(
            doc_id.to_string(),
            StoredDoc {
                doc,
                raw_bytes,
                password: password.map(|s| s.to_string()),
                pages,
            },
        );

        Ok(PdfOpenResult {
            status: PdfOpenStatus::Ok,
            page_count,
            pages: summary_pages,
            can_copy_text,
            permissions,
        })
    }

    fn close_document(&mut self, doc_id: &str) -> Result<(), PdfError> {
        self.docs.remove(doc_id);
        Ok(())
    }

    fn render_tile(
        &self,
        req: &TileRenderRequest,
        cancel: &CancellationFlag,
    ) -> Result<RenderedBitmap, PdfError> {
        cancel.check()?;
        let stored = self.get_doc(&req.source_doc_id)?;
        if req.page_index >= stored.pages.len() {
            return Err(PdfError::PageOutOfBounds {
                page: req.page_index,
                total: stored.pages.len(),
            });
        }

        let w = req.tile_width_px.max(1);
        let h = req.tile_height_px.max(1);
        let page = stored
            .doc
            .pages()
            .get(req.page_index as PdfPageIndex)
            .map_err(|e| PdfError::RenderFailed(format!("page load failed: {e}")))?;

        let rot = req.user_rotation % 360;
        let base_meta = &stored.pages[req.page_index];
        let (target_w_px, target_h_px) = if rot == 90 || rot == 270 {
            (
                ((base_meta.base_height * req.scale).round().max(1.0)) as Pixels,
                ((base_meta.base_width * req.scale).round().max(1.0)) as Pixels,
            )
        } else {
            (
                ((base_meta.base_width * req.scale).round().max(1.0)) as Pixels,
                ((base_meta.base_height * req.scale).round().max(1.0)) as Pixels,
            )
        };

        cancel.check()?;

        let mut rgba = if req.transparent_bg {
            vec![0u8; (w as usize) * (h as usize) * 4]
        } else {
            vec![255u8; (w as usize) * (h as usize) * 4]
        };

        // Allocate PDFium BGRA bitmap sized strictly to the requested tile (`w x h`), shifted by `set_origin`.
        let mut bitmap = PdfBitmap::empty(w as Pixels, h as Pixels, PdfBitmapFormat::BGRA)
            .map_err(|e| PdfError::RenderFailed(format!("failed creating PDFium bitmap: {e}")))?;

        {
            let clear = if req.transparent_bg {
                PdfColor::new(0, 0, 0, 0)
            } else {
                PdfColor::WHITE
            };
            let mut config = PdfRenderConfig::new()
                .set_target_size(target_w_px, target_h_px)
                .set_origin(-req.tile_x, -req.tile_y)
                .set_format(PdfBitmapFormat::BGRA)
                .clear_before_rendering(true)
                .set_clear_color(clear);

            let rot_enum = to_pdfium_rotation(rot);
            if rot_enum != PdfPageRenderRotation::None {
                config = config.rotate(rot_enum, true);
            }

            page.render_into_bitmap_with_config(&mut bitmap, &config)
                .map_err(|e| PdfError::RenderFailed(format!("PDFium tile render failed: {e}")))?;
        }

        cancel.check()?;
        let rendered = bitmap.as_rgba_bytes();
        let copy_len = rgba.len().min(rendered.len());
        rgba[..copy_len].copy_from_slice(&rendered[..copy_len]);
        apply_reading_theme(&mut rgba, req.theme, req.dark_paper_invert);

        Ok(RenderedBitmap {
            width: w,
            height: h,
            rgba,
        })
    }

    fn extract_text_chars(
        &self,
        doc_id: &str,
        page_index: usize,
    ) -> Result<Vec<PdfTextCharBox>, PdfError> {
        let stored = self.get_doc(doc_id)?;
        let total = stored.pages.len();
        if page_index >= total {
            return Err(PdfError::PageOutOfBounds { page: page_index, total });
        }
        let page_h = stored.pages[page_index].base_height;
        let page = stored
            .doc
            .pages()
            .get(page_index as PdfPageIndex)
            .map_err(|e| PdfError::Backend(format!("page load error: {e}")))?;
        let text_page = page
            .text()
            .map_err(|e| PdfError::Backend(format!("text page error: {e}")))?;

        let mut chars = Vec::new();
        for ch in text_page.chars().iter() {
            let Some(uc) = ch.unicode_char() else {
                continue;
            };
            let code = uc as u32;
            let bounds = ch
                .loose_bounds()
                .or_else(|_| ch.tight_bounds())
                .unwrap_or(PdfRect::ZERO);
            let (x, y, width, height) = pdfium_rect_to_visual(page_h, &bounds);
            chars.push(PdfTextCharBox {
                unicode: code,
                x,
                y,
                width,
                height,
            });
        }
        Ok(chars)
    }

    fn extract_text_spans(
        &self,
        doc_id: &str,
        page_index: usize,
    ) -> Result<Vec<PdfTextSpan>, PdfError> {
        let stored = self.get_doc(doc_id)?;
        let total = stored.pages.len();
        if page_index >= total {
            return Err(PdfError::PageOutOfBounds { page: page_index, total });
        }
        let page_h = stored.pages[page_index].base_height;
        let page = stored
            .doc
            .pages()
            .get(page_index as PdfPageIndex)
            .map_err(|e| PdfError::Backend(format!("page load error: {e}")))?;
        let text_page = page
            .text()
            .map_err(|e| PdfError::Backend(format!("text page error: {e}")))?;

        let mut spans: Vec<PdfTextSpan> = Vec::new();
        let mut cur_text = String::new();
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        let mut cur_fs = 12.0_f64;

        let flush = |spans: &mut Vec<PdfTextSpan>,
                     cur_text: &mut String,
                     min_x: &mut f64,
                     min_y: &mut f64,
                     max_x: &mut f64,
                     max_y: &mut f64,
                     cur_fs: f64| {
            let trimmed = cur_text.trim_end();
            if !trimmed.is_empty() && *max_x > *min_x {
                spans.push(PdfTextSpan {
                    id: format!("span_{page_index}_{}", spans.len()),
                    text: trimmed.to_string(),
                    x: *min_x,
                    y: *min_y,
                    width: (*max_x - *min_x).max(1.0),
                    height: (*max_y - *min_y).max(4.0),
                    font_size: cur_fs,
                    baseline_y: *max_y,
                });
            }
            cur_text.clear();
            *min_x = f64::INFINITY;
            *min_y = f64::INFINITY;
            *max_x = f64::NEG_INFINITY;
            *max_y = f64::NEG_INFINITY;
        };

        for ch in text_page.chars().iter() {
            let Some(uc) = ch.unicode_char() else {
                continue;
            };
            if uc == '\r' || uc == '\n' {
                flush(
                    &mut spans,
                    &mut cur_text,
                    &mut min_x,
                    &mut min_y,
                    &mut max_x,
                    &mut max_y,
                    cur_fs,
                );
                continue;
            }
            let bounds = ch
                .loose_bounds()
                .or_else(|_| ch.tight_bounds())
                .unwrap_or(PdfRect::ZERO);
            let (vx, vy, vw, vh) = pdfium_rect_to_visual(page_h, &bounds);
            let fs = (ch.unscaled_font_size().value as f64).max(4.0);
            let w = if uc == ' ' && vw < 0.5 { fs * 0.28 } else { vw };
            let h = if vh < 1.0 { fs } else { vh };

            if !cur_text.is_empty() {
                let gap_y = (vy + h - max_y).abs();
                let gap_x = vx - max_x;
                if gap_y > cur_fs.max(fs) * 0.6 || gap_x > cur_fs.max(fs) * 2.5 || gap_x < -cur_fs {
                    flush(
                        &mut spans,
                        &mut cur_text,
                        &mut min_x,
                        &mut min_y,
                        &mut max_x,
                        &mut max_y,
                        cur_fs,
                    );
                }
            }
            if cur_text.is_empty() {
                min_x = vx;
                min_y = vy;
                max_x = vx + w;
                max_y = vy + h;
                cur_fs = fs;
            } else {
                min_x = min_x.min(vx);
                min_y = min_y.min(vy);
                max_x = max_x.max(vx + w);
                max_y = max_y.max(vy + h);
            }
            cur_text.push(uc);
        }
        flush(
            &mut spans,
            &mut cur_text,
            &mut min_x,
            &mut min_y,
            &mut max_x,
            &mut max_y,
            cur_fs,
        );
        Ok(spans)
    }

    fn extract_page_text(&self, doc_id: &str, page_index: usize) -> Result<String, PdfError> {
        let stored = self.get_doc(doc_id)?;
        let total = stored.pages.len();
        if page_index >= total {
            return Err(PdfError::PageOutOfBounds { page: page_index, total });
        }
        let page = stored
            .doc
            .pages()
            .get(page_index as PdfPageIndex)
            .map_err(|e| PdfError::Backend(format!("page load error: {e}")))?;
        let text_page = page
            .text()
            .map_err(|e| PdfError::Backend(format!("text page error: {e}")))?;
        Ok(text_page.all())
    }

    fn extract_outline(&self, doc_id: &str) -> Result<Vec<PdfOutlineNode>, PdfError> {
        let stored = self.get_doc(doc_id)?;
        let mut nodes = Vec::new();
        for (idx, bookmark) in stored.doc.bookmarks().iter().enumerate() {
            let title = bookmark.title().unwrap_or_default();
            let page_index = bookmark
                .destination()
                .and_then(|d| d.page_index().ok())
                .map(|p| p as usize);
            nodes.push(PdfOutlineNode {
                id: format!("bm_{idx}"),
                title,
                page_index,
                children: Vec::new(),
            });
        }
        Ok(nodes)
    }

    fn extract_links(
        &self,
        doc_id: &str,
        page_index: usize,
    ) -> Result<Vec<PdfLinkAnnotation>, PdfError> {
        let stored = self.get_doc(doc_id)?;
        let total = stored.pages.len();
        if page_index >= total {
            return Err(PdfError::PageOutOfBounds { page: page_index, total });
        }
        let page_h = stored.pages[page_index].base_height;
        let page = stored
            .doc
            .pages()
            .get(page_index as PdfPageIndex)
            .map_err(|e| PdfError::Backend(format!("page load error: {e}")))?;

        let mut links = Vec::new();
        for (idx, link) in page.links().iter().enumerate() {
            let Ok(rect) = link.rect() else {
                continue;
            };
            let (x, y, width, height) = pdfium_rect_to_visual(page_h, &rect);
            if width <= 1.0 || height <= 1.0 {
                continue;
            }
            if let Some(dest) = link.destination() {
                if let Ok(dest_page) = dest.page_index() {
                    links.push(PdfLinkAnnotation {
                        id: format!("link_{page_index}_{idx}"),
                        page_index,
                        x,
                        y,
                        width,
                        height,
                        kind: PdfLinkKind::Goto,
                        uri: None,
                        dest_page_index: Some(dest_page as usize),
                    });
                    continue;
                }
            }
            if let Some(action) = link.action() {
                if let Some(uri_action) = action.as_uri_action() {
                    if let Ok(uri) = uri_action.uri() {
                        links.push(PdfLinkAnnotation {
                            id: format!("link_{page_index}_{idx}"),
                            page_index,
                            x,
                            y,
                            width,
                            height,
                            kind: PdfLinkKind::Uri,
                            uri: Some(uri),
                            dest_page_index: None,
                        });
                    }
                }
            }
        }
        Ok(links)
    }

    fn search_page(
        &self,
        doc_id: &str,
        page_index: usize,
        query: &str,
        fold_diacritics: bool,
    ) -> Result<Vec<PdfSearchHit>, PdfError> {
        let trimmed_q = query.trim();
        if trimmed_q.is_empty() {
            return Ok(Vec::new());
        }
        let needle = normalize_for_turkish_search(trimmed_q, fold_diacritics);
        if needle.is_empty() {
            return Ok(Vec::new());
        }

        let chars = self.extract_text_chars(doc_id, page_index)?;
        let mut normalized_str = String::with_capacity(chars.len());
        let mut byte_to_char_idx: Vec<usize> = Vec::with_capacity(chars.len());

        for (idx, ch_box) in chars.iter().enumerate() {
            let Some(raw_ch) = char::from_u32(ch_box.unicode) else {
                continue;
            };
            let norm_part = if raw_ch == '\r' || raw_ch == '\n' {
                " ".to_string()
            } else {
                let mut s = [0u8; 4];
                normalize_for_turkish_search(raw_ch.encode_utf8(&mut s), fold_diacritics)
            };
            for _ in norm_part.bytes() {
                byte_to_char_idx.push(idx);
            }
            normalized_str.push_str(&norm_part);
        }

        let mut hits = Vec::new();
        let mut search_from = 0usize;
        let mut match_idx = 0usize;

        while let Some(rel) = normalized_str[search_from..].find(&needle) {
            let start_byte = search_from + rel;
            let end_byte = start_byte + needle.len();
            let first_char = byte_to_char_idx[start_byte];
            let last_char = byte_to_char_idx[end_byte.saturating_sub(1)];

            let slice = &chars[first_char..=last_char];
            let mut min_x = f64::INFINITY;
            let mut min_y = f64::INFINITY;
            let mut max_r = f64::NEG_INFINITY;
            let mut max_b = f64::NEG_INFINITY;
            let mut snippet = String::new();

            for c in slice {
                if let Some(rc) = char::from_u32(c.unicode) {
                    snippet.push(rc);
                }
                if c.width > 0.0 && c.height > 0.0 {
                    min_x = min_x.min(c.x);
                    min_y = min_y.min(c.y);
                    max_r = max_r.max(c.x + c.width);
                    max_b = max_b.max(c.y + c.height);
                }
            }

            if max_r > min_x && max_b > min_y {
                hits.push(PdfSearchHit {
                    page_index,
                    match_index_in_page: match_idx,
                    snippet,
                    rects: vec![PdfSearchRect {
                        x: min_x,
                        y: min_y,
                        width: max_r - min_x,
                        height: max_b - min_y,
                    }],
                });
                match_idx += 1;
            }
            search_from = end_byte.max(start_byte + 1);
        }

        Ok(hits)
    }

    fn redact_and_save(
        &self,
        doc_id: &str,
        rects: &[RedactionRect],
    ) -> Result<(Vec<u8>, RedactionReport), PdfError> {
        let stored = self.get_doc(doc_id)?;
        redact_document_verified(
            self.pdfium,
            stored.raw_bytes.clone(),
            stored.password.as_deref(),
            rects,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gp_redact::create_sample_pdf_with_text_lines;

    #[test]
    fn d3_spike_whole_object_and_partial_glyph_redaction_verified_by_pdfium_text() {
        let mut backend = PdfiumBackend::new_for_test().expect("prebuilt PDFium required");

        let pdf = create_sample_pdf_with_text_lines(&[
            ("FULL_REDACT_BLOCK", 72.0, 770.0, 12.0),
            ("PARTIAL_SECRET_12345 KEEP_PUBLIC_TEXT", 72.0, 720.0, 12.0),
            ("FOOTER_PRESERVED", 72.0, 670.0, 12.0),
        ])
        .unwrap();

        backend.open_document("d3-test", &pdf, None).unwrap();

        // Find exact character/word bounding boxes from PDFium's own search!
        let full_hits = backend
            .search_page("d3-test", 0, "FULL_REDACT_BLOCK", false)
            .unwrap();
        let partial_hits = backend
            .search_page("d3-test", 0, "PARTIAL_SECRET_12345", false)
            .unwrap();
        assert_eq!(full_hits.len(), 1);
        assert_eq!(partial_hits.len(), 1);

        let full_box = full_hits[0].rects[0];
        let partial_box = partial_hits[0].rects[0];

        let rects = vec![
            RedactionRect {
                page_index: 0,
                x: full_box.x - 1.0,
                y: full_box.y - 1.0,
                width: full_box.width + 2.0,
                height: full_box.height + 2.0,
            },
            RedactionRect {
                page_index: 0,
                x: partial_box.x - 1.0,
                y: partial_box.y - 1.0,
                width: partial_box.width + 2.0,
                height: partial_box.height + 2.0,
            },
        ];

        let (redacted_bytes, report) = backend.redact_and_save("d3-test", &rects).unwrap();
        assert!(report.verified);
        assert_eq!(report.remaining_matches, 0);
        assert_eq!(report.redacted_regions, 2);

        // Reload redacted PDF into fresh PDFium document handle and prove zero leaked text
        backend
            .open_document("d3-after", &redacted_bytes, None)
            .unwrap();
        let extracted = backend.extract_page_text("d3-after", 0).unwrap();
        assert!(
            !extracted.contains("FULL_REDACT_BLOCK"),
            "FPDFText still extracted redacted block: {extracted}"
        );
        assert!(
            !extracted.contains("PARTIAL_SECRET_12345"),
            "FPDFText still extracted redacted substring: {extracted}"
        );
        assert!(
            !extracted.contains("12345"),
            "FPDFText leaked digits of redacted token: {extracted}"
        );
        assert!(
            extracted.contains("KEEP_PUBLIC_TEXT"),
            "Non-redacted trailing half was lost: {extracted}"
        );
        assert!(
            extracted.contains("FOOTER_PRESERVED"),
            "Unrelated line was lost: {extracted}"
        );
    }

    #[test]
    fn pdfium_backend_renders_tiles_and_folds_turkish_search() {
        let mut backend = PdfiumBackend::new_for_test().expect("prebuilt PDFium required");
        let pdf = create_sample_pdf_with_text_lines(&[
            ("Merhaba gullacpdf Okuyucu", 72.0, 740.0, 14.0),
        ])
        .unwrap();

        let open = backend.open_document("tile-doc", &pdf, None).unwrap();
        assert_eq!(open.page_count, 1);

        let tile = backend
            .render_tile(
                &TileRenderRequest {
                    source_doc_id: "tile-doc".to_string(),
                    page_index: 0,
                    tile_x: 0,
                    tile_y: 0,
                    tile_width_px: 256,
                    tile_height_px: 256,
                    scale: 1.0,
                    user_rotation: 0,
                    transparent_bg: false,
                    theme: None,
                    dark_paper_invert: false,
                },
                &CancellationFlag::new(),
            )
            .unwrap();
        assert_eq!(tile.width, 256);
        assert_eq!(tile.height, 256);
        assert_eq!(tile.rgba.len(), 256 * 256 * 4);
        let dark_pixels = tile
            .rgba
            .chunks_exact(4)
            .filter(|px| px[0] < 200 || px[1] < 200 || px[2] < 200)
            .count();
        assert!(dark_pixels > 20, "Rendered tile was unexpectedly blank");

        let hits = backend.search_page("tile-doc", 0, "GULLACPDF", true).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn d3_spike_turkish_truetype_partial_line_redaction_leaves_zero_leaked_glyphs() {
        let mut backend = PdfiumBackend::new_for_test().unwrap();
        let pdfium = backend.pdfium();

        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let font_path = root
            .join("node_modules")
            .join("dejavu-fonts-ttf")
            .join("ttf")
            .join("DejaVuSans.ttf");
        let font_bytes = std::fs::read(&font_path).expect("DejaVuSans.ttf required");

        // Build a real TrueType CID PDF containing full Turkish Unicode glyphs via PDFium itself!
        let mut doc = pdfium.create_new_pdf().unwrap();
        let font = doc.fonts_mut().load_true_type_from_bytes(&font_bytes, true).unwrap();
        {
            let mut page = doc.pages_mut().create_page_at_start(PdfPagePaperSize::a4()).unwrap();
            page.objects_mut()
                .create_text_object(
                    PdfPoints::new(72.0),
                    PdfPoints::new(740.0),
                    "KAMU: Çağrı — GİZLİ_99 — SON: İğne",
                    font,
                    PdfPoints::new(13.0),
                )
                .unwrap();
            page.regenerate_content().unwrap();
        }
        let pdf = doc.save_to_bytes().unwrap();

        backend.open_document("tr-d3", &pdf, None).unwrap();
        let hits = backend.search_page("tr-d3", 0, "GİZLİ_99", false).unwrap();
        assert_eq!(hits.len(), 1, "Expected 1 hit for Turkish TrueType run");
        let rb = hits[0].rects[0];

        let (redacted_bytes, report) = backend
            .redact_and_save(
                "tr-d3",
                &[RedactionRect {
                    page_index: 0,
                    x: rb.x - 0.5,
                    y: rb.y - 1.5,
                    width: rb.width + 1.0,
                    height: rb.height + 3.0,
                }],
            )
            .unwrap();
        assert!(report.verified);
        assert_eq!(report.remaining_matches, 0);

        backend.open_document("tr-after", &redacted_bytes, None).unwrap();
        let remaining_text = backend.extract_page_text("tr-after", 0).unwrap();
        assert!(
            !remaining_text.contains("GİZLİ"),
            "Leaked Turkish GİZLİ: {remaining_text}"
        );
        assert!(
            !remaining_text.contains("99"),
            "Leaked digits 99: {remaining_text}"
        );
        assert!(
            remaining_text.contains("KAMU"),
            "Prefix lost: {remaining_text}"
        );
        assert!(
            remaining_text.contains("Çağrı"),
            "Turkish prefix lost: {remaining_text}"
        );
        assert!(
            remaining_text.contains("İğne"),
            "Turkish suffix lost: {remaining_text}"
        );
    }

    #[test]
    fn f32_analyzes_page_objects_and_compiles_with_rotation_and_turkish_ttf() {
        let mut backend = PdfiumBackend::new_for_test().unwrap();
        let sample = gp_redact::create_sample_pdf_with_lopdf(&[], 0, 0).unwrap();
        backend.open_document("sample", &sample, None).unwrap();

        let analysis = backend.analyze_page_objects("sample", 0, "p1").unwrap();
        assert!(!analysis.images.is_empty(), "Expected raster image on sample page 1");
        assert!(!analysis.shapes.is_empty(), "Expected banner/box vector shape");
        assert!(
            !analysis.text_blocks.is_empty(),
            "Expected grouped text blocks"
        );

        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let font_bytes = std::fs::read(
            root.join("node_modules")
                .join("dejavu-fonts-ttf")
                .join("ttf")
                .join("DejaVuSans.ttf"),
        )
        .unwrap();

        let compiled = backend
            .compile_native_pdf(
                &[PageMeta {
                    id: "p1".to_string(),
                    source_doc_id: "sample".to_string(),
                    source_page_index: 0,
                    base_width: 612.0,
                    base_height: 792.0,
                    intrinsic_rotation: 0,
                    user_rotation: 0,
                    media_box: [0.0, 0.0, 612.0, 792.0],
                    crop_box: [0.0, 0.0, 612.0, 792.0],
                }],
                &[CanvasElement::TextAdd {
                    base: gp_model::BaseElement {
                        id: "tr-added".to_string(),
                        page_id: "p1".to_string(),
                        x: 72.0,
                        y: 420.0,
                        width: 240.0,
                        height: 30.0,
                        rotation: 0.0,
                        opacity: 1.0,
                        z_index: 2,
                        locked: None,
                        is_background_layer: None,
                        layer_tier: Some(3),
                        group_id: None,
                    },
                    text: "Çağrı İğne Şeker 2026".to_string(),
                    runs: None,
                    font_family: "DejaVuSans".to_string(),
                    font_size: 14.0,
                    color: "#0f172a".to_string(),
                    background_color: None,
                    bold: false,
                    italic: false,
                    align: gp_model::TextAlign::Left,
                    line_height: 1.25,
                    horizontal_scale: None,
                    letter_spacing: None,
                }],
                &[],
                Some(&font_bytes),
            )
            .unwrap();

        backend.open_document("compiled-out", &compiled, None).unwrap();
        let extracted = backend.extract_page_text("compiled-out", 0).unwrap();
        assert!(
            extracted.contains("Çağrı İğne Şeker"),
            "Compiled Turkish text missing: {extracted}"
        );
    }
}
