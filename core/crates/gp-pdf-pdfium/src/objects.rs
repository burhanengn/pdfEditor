use gp_model::RectBox;
use gp_pdf::{DetectedImageObject, DetectedVectorShape, PdfError};
use gp_text::{
    build_detected_text_blocks, parse_pdf_font_metadata, DetectedTextBlock, HorizontalRule,
    RawExtractedLine, TableVectorBarriers, VerticalRule,
};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};

use crate::pdfium_rect_to_visual;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PageObjectAnalysis {
    pub page_id: String,
    pub images: Vec<DetectedImageObject>,
    pub horizontal_rules: Vec<HorizontalRule>,
    pub vertical_rules: Vec<VerticalRule>,
    pub cell_rects: Vec<RectBox>,
    pub shapes: Vec<DetectedVectorShape>,
    pub text_blocks: Vec<DetectedTextBlock>,
}

fn color_to_hex(color: PdfColor) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        color.red(),
        color.green(),
        color.blue()
    )
}

/// Extracts raster images, vector table barriers/shapes, and grouped editable text blocks
/// natively via PDFium without `pdfjs-dist` or `mupdf` (F3.2).
pub fn analyze_page_objects_with_pdfium(
    doc: &PdfDocument<'_>,
    page_index: usize,
    page_id: &str,
) -> Result<PageObjectAnalysis, PdfError> {
    let total = doc.pages().len() as usize;
    if page_index >= total {
        return Err(PdfError::PageOutOfBounds {
            page: page_index,
            total,
        });
    }

    let page = doc
        .pages()
        .get(page_index as PdfPageIndex)
        .map_err(|e| PdfError::Backend(format!("page load error: {e}")))?;
    let page_h = page.height().value as f64;

    let mut analysis = PageObjectAnalysis {
        page_id: page_id.to_string(),
        ..PageObjectAnalysis::default()
    };

    for (idx, obj) in page.objects().iter().enumerate() {
        match obj {
            PdfPageObject::Image(img) => {
                let Ok(quad) = img.bounds() else {
                    continue;
                };
                let (x, y, width, height) = pdfium_rect_to_visual(page_h, &quad.to_rect());
                if width < 2.0 || height < 2.0 {
                    continue;
                }
                let matrix = img.matrix().unwrap_or(PdfMatrix::IDENTITY);
                let (nat_w, nat_h) = img
                    .get_processed_bitmap(doc)
                    .map(|b| (b.width() as u32, b.height() as u32))
                    .unwrap_or((width.round() as u32, height.round() as u32));

                let rot_rad = (matrix.b() as f64).atan2(matrix.a() as f64);
                let rotation = rot_rad.to_degrees();
                analysis.images.push(DetectedImageObject {
                    id: format!("img_{page_index}_{idx}"),
                    page_id: page_id.to_string(),
                    x,
                    y,
                    width,
                    height,
                    rotation,
                    flip_x: matrix.a() < 0.0,
                    flip_y: matrix.d() < 0.0,
                    natural_width: nat_w.max(1),
                    natural_height: nat_h.max(1),
                    ctm: [
                        matrix.a() as f64,
                        matrix.b() as f64,
                        matrix.c() as f64,
                        matrix.d() as f64,
                        matrix.e() as f64,
                        matrix.f() as f64,
                    ],
                    rgba: None,
                });
            }
            PdfPageObject::Path(path) => {
                let Ok(quad) = path.bounds() else {
                    continue;
                };
                let (bx, by, bw, bh) = pdfium_rect_to_visual(page_h, &quad.to_rect());
                let is_filled = path
                    .fill_mode()
                    .map(|m| m != PdfPathFillMode::None)
                    .unwrap_or(false);
                let is_stroked = path.is_stroked().unwrap_or(false);
                if !is_filled && !is_stroked {
                    continue;
                }

                // Detect clean horizontal and vertical table rules for gp-text barrier alignment
                if bh <= 3.5 && bw >= 16.0 {
                    analysis.horizontal_rules.push(HorizontalRule {
                        y: by + bh / 2.0,
                        x0: bx,
                        x1: bx + bw,
                    });
                } else if bw <= 3.5 && bh >= 12.0 {
                    analysis.vertical_rules.push(VerticalRule {
                        x: bx + bw / 2.0,
                        y0: by,
                        y1: by + bh,
                    });
                } else if is_stroked && !is_filled && bw >= 20.0 && bh >= 12.0 {
                    analysis.cell_rects.push(RectBox {
                        x: bx,
                        y: by,
                        width: bw,
                        height: bh,
                    });
                }

                if bw >= 4.0 || bh >= 4.0 {
                    let matrix = path.matrix().unwrap_or(PdfMatrix::IDENTITY);
                    let mut d = String::new();
                    for seg in path.segments().transform(matrix).iter() {
                        let sx = (seg.x().value as f64 - bx).max(0.0);
                        let sy = ((page_h - seg.y().value as f64) - by).max(0.0);
                        match seg.segment_type() {
                            PdfPathSegmentType::MoveTo => {
                                d.push_str(&format!("M {sx:.2} {sy:.2} "));
                            }
                            PdfPathSegmentType::LineTo => {
                                d.push_str(&format!("L {sx:.2} {sy:.2} "));
                            }
                            PdfPathSegmentType::BezierTo => {
                                d.push_str(&format!("L {sx:.2} {sy:.2} "));
                            }
                            _ => {}
                        }
                        if seg.is_close() {
                            d.push_str("Z ");
                        }
                    }
                    let d_trimmed = d.trim();
                    if !d_trimmed.is_empty() {
                        analysis.shapes.push(DetectedVectorShape {
                            id: format!("shp_{page_index}_{idx}"),
                            page_id: page_id.to_string(),
                            x: bx,
                            y: by,
                            width: bw.max(1.0),
                            height: bh.max(1.0),
                            svg_path: d_trimmed.to_string(),
                            stroke_color: if is_stroked {
                                path.stroke_color().ok().map(color_to_hex)
                            } else {
                                None
                            },
                            fill_color: if is_filled {
                                path.fill_color().ok().map(color_to_hex)
                            } else {
                                None
                            },
                            stroke_width: path.stroke_width().map(|p| p.value as f64).unwrap_or(1.0),
                            is_filled,
                            is_stroked,
                        });
                    }
                }
            }
            _ => {}
        }
    }

    // Group PDFium text chars per horizontal line into RawExtractedLine -> gp-text layout engine
    let text_page = page
        .text()
        .map_err(|e| PdfError::Backend(format!("text page error: {e}")))?;

    let mut raw_lines: Vec<RawExtractedLine> = Vec::new();
    let mut cur_text = String::new();
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut cur_fs = 12.0_f64;
    let mut cur_font_name = "Helvetica".to_string();
    let mut cur_is_serif = false;
    let mut cur_is_mono = false;
    let mut cur_is_bold = false;
    let mut cur_is_italic = false;
    let mut cur_color = "#0f172a".to_string();

    let flush_line = |raw_lines: &mut Vec<RawExtractedLine>,
                      cur_text: &mut String,
                      min_x: f64,
                      min_y: f64,
                      max_x: f64,
                      max_y: f64,
                      cur_fs: f64,
                      cur_font_name: &str,
                      is_serif: bool,
                      is_mono: bool,
                      is_bold: bool,
                      is_italic: bool,
                      color: &str| {
        let trimmed = cur_text.trim();
        if !trimmed.is_empty() && max_x > min_x {
            let parsed = parse_pdf_font_metadata(
                cur_font_name,
                is_serif,
                is_mono,
                is_bold,
                is_italic,
            );
            let first_word_len = trimmed.split_whitespace().next().unwrap_or("").chars().count();
            raw_lines.push(RawExtractedLine {
                text: trimmed.to_string(),
                runs: None,
                x0: min_x,
                y0: min_y,
                x1: max_x,
                y1: max_y,
                baseline_y: max_y,
                font_size: cur_fs,
                space_width: Some(cur_fs * 0.28),
                first_word_width: (first_word_len as f64 * cur_fs * 0.52).max(cur_fs),
                max_word_space: None,
                color: color.to_string(),
                font_family: parsed.font_family.clone(),
                raw_font_name: cur_font_name.to_string(),
                original_font_name: Some(parsed.clean_font_name),
                is_custom_font: Some(parsed.is_custom_font),
                horizontal_scale: Some(parsed.estimated_horizontal_scale),
                bold: parsed.bold,
                italic: parsed.italic,
                serif: is_serif || parsed.font_family.contains("Times") || parsed.font_family.contains("Serif"),
                mono: is_mono || parsed.font_family.contains("Courier") || parsed.font_family.contains("Mono"),
                block_idx: raw_lines.len(),
            });
        }
        cur_text.clear();
    };

    for ch in text_page.chars().iter() {
        let Some(uc) = ch.unicode_char() else {
            continue;
        };
        if uc == '\r' || uc == '\n' {
            flush_line(
                &mut raw_lines,
                &mut cur_text,
                min_x,
                min_y,
                max_x,
                max_y,
                cur_fs,
                &cur_font_name,
                cur_is_serif,
                cur_is_mono,
                cur_is_bold,
                cur_is_italic,
                &cur_color,
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
            let dy = (vy + h - max_y).abs();
            let dx = vx - max_x;
            if dy > cur_fs.max(fs) * 0.55 || dx > cur_fs.max(fs) * 3.0 || dx < -cur_fs {
                flush_line(
                    &mut raw_lines,
                    &mut cur_text,
                    min_x,
                    min_y,
                    max_x,
                    max_y,
                    cur_fs,
                    &cur_font_name,
                    cur_is_serif,
                    cur_is_mono,
                    cur_is_bold,
                    cur_is_italic,
                    &cur_color,
                );
            }
        }
        if cur_text.is_empty() {
            min_x = vx;
            min_y = vy;
            max_x = vx + w;
            max_y = vy + h;
            cur_fs = fs;
            let name = ch.font_name();
            cur_font_name = if name.is_empty() {
                "Helvetica".to_string()
            } else {
                name
            };
            cur_is_serif = ch.font_is_serif();
            cur_is_mono = ch.font_is_fixed_pitch();
            cur_is_bold = ch.font_is_bold_reenforced();
            cur_is_italic = ch.font_is_italic();
            cur_color = ch.fill_color().map(color_to_hex).unwrap_or_else(|_| "#0f172a".to_string());
        } else {
            min_x = min_x.min(vx);
            min_y = min_y.min(vy);
            max_x = max_x.max(vx + w);
            max_y = max_y.max(vy + h);
        }
        cur_text.push(uc);
    }
    flush_line(
        &mut raw_lines,
        &mut cur_text,
        min_x,
        min_y,
        max_x,
        max_y,
        cur_fs,
        &cur_font_name,
        cur_is_serif,
        cur_is_mono,
        cur_is_bold,
        cur_is_italic,
        &cur_color,
    );

    let barriers = TableVectorBarriers {
        horizontal_rules: Some(analysis.horizontal_rules.clone()),
        vertical_rules: Some(analysis.vertical_rules.clone()),
        cell_rects: Some(analysis.cell_rects.clone()),
    };
    analysis.text_blocks = build_detected_text_blocks(&raw_lines, page_id, Some(&barriers));
    Ok(analysis)
}
