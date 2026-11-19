pub mod compile;
pub mod objects;
pub mod redaction;

#[cfg(test)]
mod compile_fidelity_tests;

use std::{collections::HashMap, path::Path};

use gp_model::{CanvasElement, PageMeta, RectBox, RotationAngle};
use gp_pdf::{
    CancellationFlag, PdfBackend, PdfError, PdfLinkAnnotation, PdfLinkKind, PdfOpenResult,
    PdfOpenStatus, PdfOutlineNode, PdfPageSummary, PdfSearchHit, PdfSearchRect, PdfTextCharBox,
    PdfTextSpan, ReadingTheme, RedactionRect, RedactionReport, RenderedBitmap, TileRenderRequest,
};
use gp_redact::extract_embedded_fonts_with_lopdf;
use gp_text::normalize_for_turkish_search;
use pdfium_render::prelude::*;

use crate::{
    compile::{compile_native_pdf_impl, CompilePdfOptions, CompiledFontBundle},
    objects::{
        analyze_page_objects_with_pdfium, extract_embedded_image_bitmap_with_pdfium,
        PageObjectAnalysis,
    },
    redaction::redact_document_verified,
};

pub(crate) struct StoredDoc {
    doc: PdfDocument<'static>,
    pub(crate) raw_bytes: Vec<u8>,
    pub(crate) password: Option<String>,
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
        // pdfium-render permits a single library binding per process, so every test backend
        // shares one leaked `Pdfium` instance (tests run in parallel threads).
        static SHARED: std::sync::OnceLock<Result<&'static Pdfium, String>> = std::sync::OnceLock::new();
        let shared = SHARED.get_or_init(|| {
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
            let bindings = match candidates.iter().find(|p| p.exists()) {
                Some(path) => Pdfium::bind_to_library(path),
                None => Pdfium::bind_to_system_library(),
            }
            .map_err(|e| format!("failed to bind PDFium library: {e}"))?;
            let leaked: &'static Pdfium = Box::leak(Box::new(Pdfium::new(bindings)));
            Ok(leaked)
        });
        match shared {
            Ok(pdfium) => Ok(Self {
                pdfium,
                docs: HashMap::new(),
            }),
            Err(e) => Err(PdfError::Backend(e.clone())),
        }
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

    pub fn extract_embedded_fonts(
        &self,
        doc_id: &str,
    ) -> Result<gp_pdf::ExtractedFontsBundle, PdfError> {
        let stored = self.get_doc(doc_id)?;
        extract_embedded_fonts_with_lopdf(doc_id, &stored.raw_bytes)
    }

    pub fn extract_page_image_rgba(
        &self,
        doc_id: &str,
        page_index: usize,
        image_id: &str,
    ) -> Result<(u32, u32, Vec<u8>), PdfError> {
        let stored = self.get_doc(doc_id)?;
        extract_embedded_image_bitmap_with_pdfium(&stored.doc, page_index, image_id)
    }

    pub fn prepare_clean_page_preview(
        &self,
        doc_id: &str,
        page_index: usize,
        text_rects: &[RectBox],
        image_rects: &[RectBox],
        shape_rects: &[RectBox],
    ) -> Result<Vec<u8>, PdfError> {
        self.prepare_clean_page_preview_targets(
            doc_id,
            page_index,
            &gp_redact::CleanPreviewTargets {
                text_rects: text_rects.to_vec(),
                image_rects: image_rects.to_vec(),
                shape_rects: shape_rects.to_vec(),
                ..Default::default()
            },
        )
    }

    pub fn prepare_clean_page_preview_targets(
        &self,
        doc_id: &str,
        page_index: usize,
        targets: &gp_redact::CleanPreviewTargets,
    ) -> Result<Vec<u8>, PdfError> {
        let stored = self.get_doc(doc_id)?;
        let stripped = gp_redact::prepare_clean_page_preview_targets(&stored.raw_bytes, page_index, targets)?;
        if targets.image_rects.is_empty() && targets.text_rects.is_empty() {
            return Ok(stripped);
        }
        let to_p0 = |r: &RectBox| gp_pdf::RedactionRect {
            page_index: 0,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
        };
        let img_p0: Vec<gp_pdf::RedactionRect> = targets.image_rects.iter().map(to_p0).collect();
        let txt_p0: Vec<gp_pdf::RedactionRect> = targets.text_rects.iter().map(to_p0).collect();
        redaction::strip_leftover_objects_with_pdfium(
            self.pdfium,
            stripped.clone(),
            stored.password.as_deref(),
            &img_p0,
            &txt_p0,
        )
        .or(Ok(stripped))
    }

    /// Compiles reordered/rotated pages, blank pages, and full Web-parity layer elements cleanly
    /// via PDFium native object APIs + D3 redaction verification (`FPDF_SaveAsCopy`).
    pub fn compile_native_pdf_with_options(
        &self,
        pages: &[PageMeta],
        elements: &[CanvasElement],
        redactions: &[RedactionRect],
        options: CompilePdfOptions<'_>,
    ) -> Result<Vec<u8>, PdfError> {
        compile_native_pdf_impl(self.pdfium, &self.docs, pages, elements, redactions, options)
    }

    pub fn compile_native_pdf(
        &self,
        pages: &[PageMeta],
        elements: &[CanvasElement],
        redactions: &[RedactionRect],
        truetype_font_bytes: Option<&[u8]>,
    ) -> Result<Vec<u8>, PdfError> {
        self.compile_native_pdf_with_options(
            pages,
            elements,
            redactions,
            CompilePdfOptions {
                fonts: CompiledFontBundle {
                    custom_ttf_bytes: truetype_font_bytes,
                    regular_ttf_bytes: truetype_font_bytes,
                    ..Default::default()
                },
                ..Default::default()
            },
        )
    }

    pub(crate) fn get_doc(&self, doc_id: &str) -> Result<&StoredDoc, PdfError> {
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

pub(crate) fn intrinsic_rotation_to_angle(rot: Result<PdfPageRenderRotation, PdfiumError>) -> RotationAngle {
    match rot {
        Ok(PdfPageRenderRotation::Degrees90) => 90,
        Ok(PdfPageRenderRotation::Degrees180) => 180,
        Ok(PdfPageRenderRotation::Degrees270) => 270,
        _ => 0,
    }
}

pub(crate) fn to_pdfium_rotation(deg: RotationAngle) -> PdfPageRenderRotation {
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

        // Render directly into `rgba` with reverse byte order (RGBA), avoiding 2 extra intermediate buffer allocations & copies.
        {
            let mut bitmap = PdfBitmap::from_bytes(w as Pixels, h as Pixels, PdfBitmapFormat::BGRA, &mut rgba)
                .map_err(|e| PdfError::RenderFailed(format!("failed creating PDFium bitmap: {e}")))?;

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
                    underline: None,
                    strikethrough: None,
                    script_mode: None,
                    embedded_font_id: None,
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

    #[test]
    fn phase3_compiles_shapes_images_signatures_paths_text_edit_and_page_numbers() {
        let mut backend = PdfiumBackend::new_for_test().unwrap();
        let src_pdf = gp_redact::create_sample_pdf_with_text_lines(&[
            ("OLD_ORIGINAL_TITLE", 72.0, 742.0, 14.0),
            ("STATIC_FOOTER", 72.0, 100.0, 11.0),
        ])
        .unwrap();
        backend.open_document("src-rich", &src_pdf, None).unwrap();

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

        let mut img_map = std::collections::HashMap::new();
        img_map.insert(
            "img-1".to_string(),
            crate::compile::PreDecodedImage {
                width: 4,
                height: 4,
                rgba: vec![37, 99, 235, 255].repeat(16),
            },
        );

        let page_meta = PageMeta {
            id: "p1".to_string(),
            source_doc_id: "src-rich".to_string(),
            source_page_index: 0,
            base_width: 595.0,
            base_height: 842.0,
            intrinsic_rotation: 0,
            user_rotation: 0,
            media_box: [0.0, 0.0, 595.0, 842.0],
            crop_box: [0.0, 0.0, 595.0, 842.0],
        };

        let base = |id: &str, x: f64, y: f64, w: f64, h: f64| gp_model::BaseElement {
            id: id.to_string(),
            page_id: "p1".to_string(),
            x,
            y,
            width: w,
            height: h,
            rotation: 0.0,
            opacity: 1.0,
            z_index: 1,
            locked: None,
            is_background_layer: None,
            layer_tier: None,
            group_id: None,
        };

        let elements = vec![
            CanvasElement::TextEdit {
                base: base("te-1", 68.0, 84.0, 260.0, 28.0),
                source_block_id: "blk-1".to_string(),
                original_rect: None,
                original_text: "OLD_ORIGINAL_TITLE".to_string(),
                text: "YENİ BAŞLIK: Çağrı".to_string(),
                runs: None,
                font_family: "DejaVuSans".to_string(),
                font_size: 14.0,
                color: "#0F172A".to_string(),
                background_color: None,
                bold: true,
                italic: false,
                underline: Some(true),
                strikethrough: None,
                script_mode: None,
                embedded_font_id: None,
                align: gp_model::TextAlign::Justify,
                line_height: 1.25,
                horizontal_scale: None,
                letter_spacing: None,
                deleted: None,
                strip_rects: None,
                layout_lines: None,
            },
            CanvasElement::VectorShape {
                base: base("shp-arrow", 80.0, 200.0, 140.0, 48.0),
                shape_type: gp_model::VectorShapeType::Arrow,
                fill_color: "#2563EB".to_string(),
                stroke_color: "#1E3A8A".to_string(),
                stroke_width: 2.0,
                border_radius: None,
                stroke_dash: Some(gp_model::VectorStrokeDash::Dashed),
                behind_content: Some(false),
            },
            CanvasElement::VectorPath {
                base: base("path-1", 80.0, 280.0, 160.0, 60.0),
                points: vec![
                    gp_model::NormalizedPoint { x: 0.0, y: 0.5, pressure: None, smooth: None },
                    gp_model::NormalizedPoint { x: 0.5, y: 0.1, pressure: None, smooth: None },
                    gp_model::NormalizedPoint { x: 1.0, y: 0.9, pressure: None, smooth: None },
                ],
                closed: false,
                smooth: Some(true),
                fill_color: "transparent".to_string(),
                stroke_color: "#DC2626".to_string(),
                stroke_width: 2.5,
                stroke_dash: None,
                behind_content: None,
            },
            CanvasElement::ImageAdd {
                base: base("img-1", 300.0, 200.0, 64.0, 64.0),
                name: "logo.png".to_string(),
                mime_type: "image/png".to_string(),
                preview_url: String::new(),
                natural_width: 4.0,
                natural_height: 4.0,
                aspect_locked: true,
                behind_content: Some(true),
                crop_rect: None,
                clip_mask: None,
                repeat_across_pages: None,
                flip_x: None,
                flip_y: None,
            },
            CanvasElement::Signature {
                base: base("sig-1", 320.0, 500.0, 140.0, 60.0),
                signature_id: "vault-1".to_string(),
                data_url: String::new(),
                aspect_locked: true,
                realistic_ink: Some(true),
                svg_paths: Some(vec![gp_model::SignatureVectorPath {
                    d: "M 10 80 Q 120 10 280 90".to_string(),
                    fill: None,
                    stroke: Some("#1D4ED8".to_string()),
                    stroke_width: Some(2.5),
                }]),
                view_box_width: Some(300.0),
                view_box_height: Some(120.0),
            },
        ];

        let num_cfg = gp_model::PageNumberingConfig {
            enabled: true,
            position: gp_model::PageNumberingPosition::BottomCenter,
            format: gp_model::PageNumberingFormat::PageNumberOfTotal,
            font_family: "DejaVuSans".to_string(),
            font_size: 11.0,
            color: "#334155".to_string(),
            margin_x: 36.0,
            margin_y: 24.0,
            start_from_page: 1,
            start_number: 1,
            opacity: 1.0,
        };

        let compiled = backend
            .compile_native_pdf_with_options(
                &[page_meta],
                &elements,
                &[],
                crate::compile::CompilePdfOptions {
                    fonts: crate::compile::CompiledFontBundle {
                        regular_ttf_bytes: Some(&font_bytes),
                        bold_ttf_bytes: Some(&font_bytes),
                        ..Default::default()
                    },
                    page_numbering: Some(&num_cfg),
                    embedded_images: Some(&img_map),
                    ..Default::default()
                },
            )
            .unwrap();

        backend.open_document("out-rich", &compiled, None).unwrap();
        let text = backend.extract_page_text("out-rich", 0).unwrap();
        assert!(!text.contains("OLD_ORIGINAL_TITLE"), "Old text remained: {text}");
        assert!(text.contains("YENİ BAŞLIK: Çağrı"), "New Turkish edit missing: {text}");
        assert!(text.contains("Sayfa 1 / 1"), "Dynamic page number missing: {text}");
        let analysis = backend.analyze_page_objects("out-rich", 0, "p1").unwrap();
        assert!(!analysis.images.is_empty(), "Embedded RGBA image missing in output PDF");
        assert!(!analysis.shapes.is_empty(), "Vector shape/path missing in output PDF");
    }

    #[test]
    fn f34_ctm_scaled_font_size_xobject_form_and_justify_rich_compile() {
        use lopdf::{dictionary, Document, Object, Stream};

        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });

        // 2x2 RGB raw image XObject placed inside a Form XObject
        let img_pixels: Vec<u8> = vec![
            220, 40, 40, 40, 180, 40,
            40, 80, 220, 240, 200, 40,
        ];
        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 2,
                "Height" => 2,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            img_pixels,
        ));

        // Form XObject containing a bordered rectangle + nested image
        let form_ops = b"q 0.9 0.9 0.95 rg 0.1 0.2 0.8 RG 2 w 10 10 180 90 re B Q q 60 0 0 60 20 20 cm /Im1 Do Q";
        let form_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 220.into(), 120.into()],
                "Resources" => dictionary! {
                    "XObject" => dictionary! {
                        "Im1" => img_id,
                    },
                },
            },
            form_ops.to_vec(),
        ));

        // Page content:
        // 1) CTM-scaled text: 0.3x matrix * 30 Tf => 9pt effective visual size
        // 2) Multi-line justified block spanning x=[72..472] with wide word spacing
        // 3) Form XObject placement
        let content_str = concat!(
            "q 0.3 0 0 0.3 72 720 cm BT /F1 30 Tf 0 0 Td (Scaled nine point line) Tj ET Q\n",
            "BT /F1 12 Tf ",
            "72 620 Td 18 Tw (Alpha beta gamma delta epsilon) Tj ",
            "0 Tw 0 -18 Td 14 Tw (Zeta eta theta iota kappa) Tj ",
            "0 Tw 0 -18 Td (Short last line.) Tj ET\n",
            "q 1 0 0 1 100 320 cm /Fm1 Do Q\n"
        );
        let content_id = doc.add_object(Stream::new(dictionary! {}, content_str.as_bytes().to_vec()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_id },
                "XObject" => dictionary! { "Fm1" => form_id },
            },
            "Contents" => content_id,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);

        let mut pdf_bytes = Vec::new();
        doc.save_to(&mut pdf_bytes).unwrap();

        let mut backend = PdfiumBackend::new_for_test().unwrap();
        backend.open_document("ctm-form", &pdf_bytes, None).unwrap();
        let analysis = backend.analyze_page_objects("ctm-form", 0, "p1").unwrap();

        let scaled_blk = analysis
            .text_blocks
            .iter()
            .find(|b| b.text.contains("Scaled"))
            .expect("Expected CTM-scaled text block");
        assert!(
            scaled_blk.font_size >= 7.5 && scaled_blk.font_size <= 11.5,
            "Expected CTM-scaled ~9pt font size, got {}",
            scaled_blk.font_size
        );

        assert!(
            !analysis.images.is_empty(),
            "Expected raster image detected inside XObject Form"
        );
        assert!(
            !analysis.shapes.is_empty(),
            "Expected bordered rectangle shape detected inside XObject Form"
        );
        let justified_blk = analysis
            .text_blocks
            .iter()
            .find(|b| b.text.contains("Alpha"));
        assert!(
            justified_blk.map(|b| matches!(b.align, gp_model::TextAlign::Justify)).unwrap_or(false),
            "Expected justified block detection, got {:?}",
            justified_blk.map(|b| b.align)
        );

        // Now verify compiling rich styles (justify + underline + strikethrough + inline super/sub)
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

        let page_meta = PageMeta {
            id: "p1".to_string(),
            source_doc_id: "ctm-form".to_string(),
            source_page_index: 0,
            base_width: 612.0,
            base_height: 792.0,
            intrinsic_rotation: 0,
            user_rotation: 0,
            media_box: [0.0, 0.0, 612.0, 792.0],
            crop_box: [0.0, 0.0, 612.0, 792.0],
        };
        let elements = vec![CanvasElement::TextAdd {
            base: gp_model::BaseElement {
                id: "rich-add".to_string(),
                page_id: "p1".to_string(),
                x: 72.0,
                y: 200.0,
                width: 320.0,
                height: 90.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 3,
                locked: None,
                is_background_layer: None,
                layer_tier: Some(3),
                group_id: None,
            },
            text: "Normal Underline Strike H2O x2".to_string(),
            runs: Some(vec![
                gp_model::TextRun {
                    text: "Normal ".to_string(),
                    ..Default::default()
                },
                gp_model::TextRun {
                    text: "Underline".to_string(),
                    bold: Some(true),
                    underline: Some(true),
                    ..Default::default()
                },
                gp_model::TextRun {
                    text: " Strike ".to_string(),
                    italic: Some(true),
                    strikethrough: Some(true),
                    ..Default::default()
                },
                gp_model::TextRun {
                    text: "2".to_string(),
                    script: Some(gp_model::TextScriptMode::Sub),
                    ..Default::default()
                },
            ]),
            font_size: 12.0,
            font_family: "DejaVuSans".to_string(),
            bold: false,
            italic: false,
            underline: None,
            strikethrough: None,
            script_mode: None,
            embedded_font_id: None,
            color: "#111827".to_string(),
            background_color: None,
            align: gp_model::TextAlign::Justify,
            line_height: 1.25,
            letter_spacing: Some(0.2),
            horizontal_scale: None,
        }];
        let compiled = backend
            .compile_native_pdf_with_options(
                &[page_meta],
                &elements,
                &[],
                crate::compile::CompilePdfOptions {
                    fonts: crate::compile::CompiledFontBundle {
                        regular_ttf_bytes: Some(&font_bytes),
                        bold_ttf_bytes: Some(&font_bytes),
                        italic_ttf_bytes: Some(&font_bytes),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            )
            .unwrap();
        backend.open_document("out-rich-2", &compiled, None).unwrap();
        let txt = backend.extract_page_text("out-rich-2", 0).unwrap();
        assert!(txt.contains("Underline") && txt.contains("Strike"), "Missing compiled rich text: {txt}");
    }

    #[test]
    fn analysis_detects_behind_image_and_inline_runs_and_strips_original_rect() {
        use lopdf::{dictionary, Document, Object, Stream};

        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_reg = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let font_bold = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica-Bold",
        });
        let img_pixels: Vec<u8> = vec![
            200, 210, 220, 200, 210, 220,
            200, 210, 220, 200, 210, 220,
        ];
        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 2,
                "Height" => 2,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            img_pixels,
        ));
        // Background image drawn BEFORE text spanning almost the full page + inline Bold/Regular run.
        let content_str = concat!(
            "q 500 0 0 700 45 45 cm /BgIm Do Q\n",
            "BT /FB 12 Tf 72 640 Td (Note: ) Tj /F1 12 Tf (regular body words on the same line) Tj ET\n"
        );
        let content_id = doc.add_object(Stream::new(dictionary! {}, content_str.as_bytes().to_vec()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_reg, "FB" => font_bold },
                "XObject" => dictionary! { "BgIm" => img_id },
            },
            "Contents" => content_id,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);

        let mut pdf_bytes = Vec::new();
        doc.save_to(&mut pdf_bytes).unwrap();

        let mut backend = PdfiumBackend::new_for_test().unwrap();
        backend.open_document("bg-src", &pdf_bytes, None).unwrap();
        let analysis = backend.analyze_page_objects("bg-src", 0, "p1").unwrap();

        let bg_img = analysis.images.first().expect("expected analyzed image");
        assert!(bg_img.behind_content, "image drawn under text must be flagged behind_content");
        assert!(bg_img.is_background_layer, "large page-covering behind image must be flagged background");

        let blk = analysis
            .text_blocks
            .iter()
            .find(|b| b.text.contains("Note:"))
            .expect("expected mixed inline run text block");
        assert!(!blk.bold, "dominant block weight should remain regular when only short prefix is bold");
        let runs = blk.runs.as_ref().expect("expected inline TextRuns");
        assert!(runs.iter().any(|r| r.bold == Some(true) && r.text.contains("Note:")), "expected bold prefix run: {runs:?}");
        assert!(runs.iter().any(|r| r.bold != Some(true) && r.text.contains("regular body")), "expected regular body run: {runs:?}");
        assert_eq!(blk.font_source.as_deref(), Some("builtin"));

        let moved_deleted_img = CanvasElement::ImageReplacement {
            base: gp_model::BaseElement {
                id: "del-bg".to_string(),
                page_id: "p1".to_string(),
                x: 200.0,
                y: 250.0,
                width: 80.0,
                height: 80.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 1,
                locked: None,
                is_background_layer: Some(true),
                layer_tier: Some(1),
                group_id: None,
            },
            source_image_id: bg_img.id.clone(),
            original_rect: Some(gp_model::RectBox {
                x: bg_img.x,
                y: bg_img.y,
                width: bg_img.width,
                height: bg_img.height,
            }),
            mime_type: "image/png".to_string(),
            preview_url: String::new(),
            natural_width: 2.0,
            natural_height: 2.0,
            aspect_locked: true,
            deleted: Some(true),
            behind_content: Some(true),
            crop_rect: None,
            clip_mask: None,
            flip_x: None,
            flip_y: None,
            in_place: None,
            original_rotation: None,
            original_flip_x: None,
            original_flip_y: None,
        };
        assert_eq!(moved_deleted_img.strip_rect().x, bg_img.x);
        assert_eq!(moved_deleted_img.strip_rect().width, bg_img.width);

        let cleaned = gp_redact::prepare_clean_page_preview_with_lopdf(
            &pdf_bytes,
            0,
            &[],
            &[moved_deleted_img.strip_rect()],
            &[],
        )
        .unwrap();
        backend.open_document("bg-cleaned", &cleaned, None).unwrap();
        let cleaned_analysis = backend.analyze_page_objects("bg-cleaned", 0, "p1").unwrap();
        assert!(
            cleaned_analysis.images.is_empty(),
            "original image must be stripped at originalRect even after move+delete"
        );
    }
}
