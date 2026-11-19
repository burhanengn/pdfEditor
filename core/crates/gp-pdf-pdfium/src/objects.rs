use std::collections::HashMap;

use gp_model::{RectBox, TextRun, TextScriptMode};
use gp_pdf::{DetectedImageObject, DetectedVectorShape, PdfError};
use gp_text::{
    build_detected_text_blocks, normalize_text_runs, parse_pdf_font_metadata, runs_to_plain_text,
    DetectedTextBlock, HorizontalRule, ParsedPdfFontInfo, RawExtractedLine, TableVectorBarriers,
    VerticalRule,
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

#[derive(Debug, Clone, Copy)]
struct TextZBox {
    z_order: usize,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone)]
struct CachedFontMeta {
    parsed: ParsedPdfFontInfo,
    font_source: String,
}

#[derive(Clone, Debug)]
struct CharRec {
    ch: char,
    vx: f64,
    vy: f64,
    vw: f64,
    vh: f64,
    baseline_y: f64,
    fs: f64,
    is_ws: bool,
    color: String,
    font_name: String,
    font_family: String,
    clean_font_name: String,
    is_custom_font: bool,
    font_source: String,
    horizontal_scale: f64,
    bold: bool,
    italic: bool,
    serif: bool,
    mono: bool,
}

#[derive(Clone, Debug)]
struct LineSeg {
    chars: Vec<CharRec>,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
    baseline_y: f64,
    fs: f64,
}

fn color_to_hex(color: PdfColor) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        color.red(),
        color.green(),
        color.blue()
    )
}

fn multiply_matrix(parent: PdfMatrix, local: PdfMatrix) -> PdfMatrix {
    PdfMatrix::new(
        local.a() * parent.a() + local.b() * parent.c(),
        local.a() * parent.b() + local.b() * parent.d(),
        local.c() * parent.a() + local.d() * parent.c(),
        local.c() * parent.b() + local.d() * parent.d(),
        local.e() * parent.a() + local.f() * parent.c() + parent.e(),
        local.e() * parent.b() + local.f() * parent.d() + parent.f(),
    )
}

fn bounds_to_visual(
    page_h: f64,
    rect: &PdfRect,
    parent_matrix: Option<PdfMatrix>,
) -> (f64, f64, f64, f64) {
    if let Some(pm) = parent_matrix {
        let (x0, y0) = pm.apply_to_points(rect.left(), rect.bottom());
        let (x1, y1) = pm.apply_to_points(rect.right(), rect.top());
        let vx0 = x0.value.min(x1.value) as f64;
        let vy0 = (page_h - y0.value.max(y1.value) as f64).max(0.0);
        let vw = (x1.value - x0.value).abs() as f64;
        let vh = (y1.value - y0.value).abs() as f64;
        (vx0, vy0, vw, vh)
    } else {
        pdfium_rect_to_visual(page_h, rect)
    }
}

fn decompose_image_transform(matrix: PdfMatrix) -> (f64, bool, bool) {
    let a = matrix.a() as f64;
    let b = matrix.b() as f64;
    let c = matrix.c() as f64;
    let d = matrix.d() as f64;
    let det = a * d - b * c;
    let (flip_x, flip_y, rot_rad) = if det < 0.0 {
        if a < 0.0 && d >= 0.0 {
            (true, false, b.atan2(-a))
        } else if d < 0.0 && a >= 0.0 {
            (false, true, (-b).atan2(a))
        } else {
            (true, false, b.atan2(-a))
        }
    } else {
        // Screen coordinates are Y-down so PDF Y-up CCW angle maps to clockwise -atan2(b, a).
        (false, false, (-b).atan2(a))
    };
    let mut deg = rot_rad.to_degrees();
    if deg.abs() < 0.05 || (deg.abs() - 360.0).abs() < 0.05 {
        deg = 0.0;
    }
    (deg, flip_x, flip_y)
}

fn rects_overlap_area(ax: f64, ay: f64, aw: f64, ah: f64, bx: f64, by: f64, bw: f64, bh: f64) -> f64 {
    let ox = (ax + aw).min(bx + bw) - ax.max(bx);
    let oy = (ay + ah).min(by + bh) - ay.max(by);
    if ox > 0.0 && oy > 0.0 {
        ox * oy
    } else {
        0.0
    }
}

fn collect_object_recursive(
    page_index: usize,
    page_id: &str,
    page_h: f64,
    obj: &PdfPageObject<'_>,
    parent_matrix: Option<PdfMatrix>,
    id_prefix: &str,
    z_counter: &mut usize,
    text_z_boxes: &mut Vec<TextZBox>,
    analysis: &mut PageObjectAnalysis,
) {
    match obj {
        PdfPageObject::Text(txt) => {
            let z_order = *z_counter;
            *z_counter += 1;
            if let Ok(quad) = txt.bounds() {
                let (x, y, width, height) = bounds_to_visual(page_h, &quad.to_rect(), parent_matrix);
                if width > 0.5 && height > 0.5 {
                    text_z_boxes.push(TextZBox {
                        z_order,
                        x,
                        y,
                        width,
                        height,
                    });
                }
            }
        }
        PdfPageObject::Image(img) => {
            let z_order = *z_counter;
            *z_counter += 1;
            let Ok(quad) = img.bounds() else {
                return;
            };
            let rect = quad.to_rect();
            let (x, y, width, height) = bounds_to_visual(page_h, &rect, parent_matrix);
            if width < 4.0 || height < 4.0 {
                return;
            }
            let local_m = img.matrix().unwrap_or(PdfMatrix::IDENTITY);
            let matrix = if let Some(pm) = parent_matrix {
                multiply_matrix(pm, local_m)
            } else {
                local_m
            };
            // Read image stream metadata directly so analysis does not force full bitmap decoding.
            let nat_w = img
                .width()
                .ok()
                .map(|p| p as u32)
                .filter(|&w| w > 0)
                .unwrap_or_else(|| width.round().max(1.0) as u32);
            let nat_h = img
                .height()
                .ok()
                .map(|p| p as u32)
                .filter(|&h| h > 0)
                .unwrap_or_else(|| height.round().max(1.0) as u32);

            let (rotation, flip_x, flip_y) = decompose_image_transform(matrix);
            analysis.images.push(DetectedImageObject {
                id: format!("img_{page_index}_{id_prefix}"),
                page_id: page_id.to_string(),
                x,
                y,
                width,
                height,
                rotation,
                flip_x,
                flip_y,
                natural_width: nat_w.max(1),
                natural_height: nat_h.max(1),
                z_order,
                behind_content: false,
                is_background_layer: false,
                opacity: 1.0,
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
            let z_order = *z_counter;
            *z_counter += 1;
            let Ok(quad) = path.bounds() else {
                return;
            };
            let rect = quad.to_rect();
            let (bx, by, bw, bh) = bounds_to_visual(page_h, &rect, parent_matrix);

            let is_filled = path
                .fill_mode()
                .map(|m| m != PdfPathFillMode::None)
                .unwrap_or(false);
            let is_stroked = path.is_stroked().unwrap_or(false);
            if !is_filled && !is_stroked {
                return;
            }

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
                let local_m = path.matrix().unwrap_or(PdfMatrix::IDENTITY);
                let matrix = if let Some(pm) = parent_matrix {
                    multiply_matrix(pm, local_m)
                } else {
                    local_m
                };
                let mut d = String::new();
                for seg in path.segments().transform(matrix).iter() {
                    let sx = (seg.x().value as f64 - bx).max(0.0);
                    let sy = ((page_h - seg.y().value as f64) - by).max(0.0);
                    match seg.segment_type() {
                        PdfPathSegmentType::MoveTo => {
                            d.push_str(&format!("M {sx:.2} {sy:.2} "));
                        }
                        PdfPathSegmentType::LineTo | PdfPathSegmentType::BezierTo => {
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
                    let fill_col_opt = if is_filled { path.fill_color().ok() } else { None };
                    let stroke_col_opt = if is_stroked { path.stroke_color().ok() } else { None };
                    let opacity = fill_col_opt
                        .or(stroke_col_opt)
                        .map(|c| {
                            let a = c.alpha();
                            if a == 0 {
                                1.0
                            } else {
                                (a as f64 / 255.0).clamp(0.05, 1.0)
                            }
                        })
                        .unwrap_or(1.0);
                    analysis.shapes.push(DetectedVectorShape {
                        id: format!("shp_{page_index}_{id_prefix}"),
                        page_id: page_id.to_string(),
                        x: bx,
                        y: by,
                        width: bw.max(1.0),
                        height: bh.max(1.0),
                        svg_path: d_trimmed.to_string(),
                        stroke_color: stroke_col_opt.map(color_to_hex),
                        fill_color: fill_col_opt.map(color_to_hex),
                        stroke_width: path.stroke_width().map(|p| p.value as f64).unwrap_or(1.0),
                        is_filled,
                        is_stroked,
                        z_order,
                        behind_content: false,
                        is_background_layer: false,
                        opacity,
                    });
                }
            }
        }
        PdfPageObject::XObjectForm(form) => {
            let form_m = form.matrix().unwrap_or(PdfMatrix::IDENTITY);
            let combined = if let Some(pm) = parent_matrix {
                Some(multiply_matrix(pm, form_m))
            } else if form_m != PdfMatrix::IDENTITY {
                Some(form_m)
            } else {
                None
            };
            for (c_idx, child) in form.iter().enumerate() {
                collect_object_recursive(
                    page_index,
                    page_id,
                    page_h,
                    &child,
                    combined,
                    &format!("{id_prefix}_{c_idx}"),
                    z_counter,
                    text_z_boxes,
                    analysis,
                );
            }
        }
        _ => {
            *z_counter += 1;
        }
    }
}

fn classify_layer_depths(
    page_w: f64,
    page_h: f64,
    text_z_boxes: &[TextZBox],
    analysis: &mut PageObjectAnalysis,
) {
    let page_area = (page_w * page_h).max(1.0);
    let first_text_z = text_z_boxes.iter().map(|t| t.z_order).min().unwrap_or(usize::MAX);

    // Every painted object (text, vector shapes, images) with its paint order, so an image or
    // shape that is overdrawn by ANY later content (not only text) is classified as behind it.
    let mut painted: Vec<TextZBox> = text_z_boxes.to_vec();
    painted.extend(analysis.shapes.iter().map(|s| TextZBox {
        z_order: s.z_order,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
    }));
    painted.extend(analysis.images.iter().map(|i| TextZBox {
        z_order: i.z_order,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
    }));

    // Opaque page-covering objects (e.g. a full-page white/colour rectangle or a full-page
    // photo). An object painted ABOVE such a cover cannot be treated as "behind content": the
    // editor/exporter place behind objects beneath the whole original page, where the cover would
    // hide them. Those objects are kept in the foreground layer instead.
    let mut covers: Vec<TextZBox> = Vec::new();
    covers.extend(
        analysis
            .shapes
            .iter()
            .filter(|s| s.is_filled && s.opacity >= 0.9 && s.width * s.height >= page_area * 0.55)
            .map(|s| TextZBox { z_order: s.z_order, x: s.x, y: s.y, width: s.width, height: s.height }),
    );
    covers.extend(
        analysis
            .images
            .iter()
            .filter(|i| i.width * i.height >= page_area * 0.55)
            .map(|i| TextZBox { z_order: i.z_order, x: i.x, y: i.y, width: i.width, height: i.height }),
    );
    let sits_on_opaque_cover = |z: usize, x: f64, y: f64, w: f64, h: f64| -> bool {
        covers.iter().any(|c| {
            c.z_order < z && rects_overlap_area(x, y, w, h, c.x, c.y, c.width, c.height) >= (w * h) * 0.5
        })
    };

    let overlapped_by_later = |z: usize, x: f64, y: f64, w: f64, h: f64| -> bool {
        painted.iter().any(|p| {
            if p.z_order <= z {
                return false;
            }
            let ov = rects_overlap_area(x, y, w, h, p.x, p.y, p.width, p.height);
            let smaller = (w * h).min(p.width * p.height).max(1.0);
            ov > 1.0 && (ov >= 4.0 || ov >= smaller * 0.5)
        })
    };

    let mut image_flags = Vec::with_capacity(analysis.images.len());
    for img in &analysis.images {
        let img_area = img.width * img.height;
        let overlaps_later = overlapped_by_later(img.z_order, img.x, img.y, img.width, img.height);
        let overlaps_any_text = analysis.text_blocks.iter().any(|tb| {
            rects_overlap_area(
                img.x, img.y, img.width, img.height, tb.x, tb.y, tb.width, tb.height,
            ) > 1.0
        });
        let covers_most_page = img_area >= page_area * 0.55;
        let is_bg = covers_most_page
            || (img.z_order <= first_text_z
                && img_area >= page_area * 0.25
                && (overlaps_later || overlaps_any_text));
        let on_cover = sits_on_opaque_cover(img.z_order, img.x, img.y, img.width, img.height);
        image_flags.push((is_bg && !on_cover, (is_bg || overlaps_later) && !on_cover));
    }
    for (img, (is_bg, behind)) in analysis.images.iter_mut().zip(image_flags) {
        img.is_background_layer = is_bg;
        img.behind_content = behind;
    }

    let mut shape_flags = Vec::with_capacity(analysis.shapes.len());
    for shp in &analysis.shapes {
        let shp_area = shp.width * shp.height;
        let overlaps_later = overlapped_by_later(shp.z_order, shp.x, shp.y, shp.width, shp.height);
        let covers_most_page = shp_area >= page_area * 0.55;
        let is_bg = covers_most_page
            || (shp.z_order <= first_text_z && shp_area >= page_area * 0.25 && overlaps_later);
        let on_cover = sits_on_opaque_cover(shp.z_order, shp.x, shp.y, shp.width, shp.height);
        shape_flags.push((is_bg && !on_cover, (is_bg || overlaps_later) && !on_cover));
    }
    for (shp, (is_bg, behind)) in analysis.shapes.iter_mut().zip(shape_flags) {
        shp.is_background_layer = is_bg;
        shp.behind_content = behind;
    }
}

pub fn extract_embedded_image_bitmap_with_pdfium(
    doc: &PdfDocument<'_>,
    page_index: usize,
    target_id: &str,
) -> Result<(u32, u32, Vec<u8>), PdfError> {
    let page = doc
        .pages()
        .get(page_index as PdfPageIndex)
        .map_err(|e| PdfError::Backend(format!("page load error: {e}")))?;

    fn find_img(
        doc: &PdfDocument<'_>,
        page_index: usize,
        id_prefix: &str,
        obj: &PdfPageObject<'_>,
        target_id: &str,
    ) -> Option<(u32, u32, Vec<u8>)> {
        match obj {
            PdfPageObject::Image(img) => {
                let candidate_id = format!("img_{page_index}_{id_prefix}");
                if candidate_id == target_id {
                    if let Ok(bmp) = img
                        .get_processed_bitmap(doc)
                        .or_else(|_| img.get_raw_bitmap())
                    {
                        return Some((
                            bmp.width() as u32,
                            bmp.height() as u32,
                            bmp.as_rgba_bytes().to_vec(),
                        ));
                    }
                }
                None
            }
            PdfPageObject::XObjectForm(form) => {
                for (c_idx, child) in form.iter().enumerate() {
                    if let Some(found) =
                        find_img(doc, page_index, &format!("{id_prefix}_{c_idx}"), &child, target_id)
                    {
                        return Some(found);
                    }
                }
                None
            }
            _ => None,
        }
    }

    for (idx, obj) in page.objects().iter().enumerate() {
        if let Some(found) = find_img(doc, page_index, &idx.to_string(), &obj, target_id) {
            return Ok(found);
        }
    }
    Err(PdfError::Backend(format!("embedded image not found: {target_id}")))
}

fn median_f64(mut vals: Vec<f64>, fallback: f64) -> f64 {
    if vals.is_empty() {
        return fallback;
    }
    vals.sort_by(|a, b| a.total_cmp(b));
    vals[vals.len() / 2]
}

fn compute_seg_metrics(chars: &[CharRec]) -> Option<LineSeg> {
    let mut first_printable = None;
    let mut last_printable = None;
    for (i, c) in chars.iter().enumerate() {
        if !c.is_ws {
            if first_printable.is_none() {
                first_printable = Some(i);
            }
            last_printable = Some(i);
        }
    }
    let (start, end) = (first_printable?, last_printable?);
    let trimmed = chars[start..=end].to_vec();
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut fs_samples = Vec::with_capacity(trimmed.len());
    let mut base_samples = Vec::with_capacity(trimmed.len());
    for c in &trimmed {
        min_x = min_x.min(c.vx);
        min_y = min_y.min(c.vy);
        max_x = max_x.max(c.vx + c.vw);
        max_y = max_y.max(c.vy + c.vh);
        if !c.is_ws {
            fs_samples.push(c.fs);
            base_samples.push(c.baseline_y);
        }
    }
    if max_x <= min_x {
        return None;
    }
    let fs = median_f64(fs_samples, 12.0);
    let baseline_y = median_f64(base_samples, max_y);
    Some(LineSeg {
        chars: trimmed,
        min_x,
        min_y,
        max_x,
        max_y,
        baseline_y,
        fs,
    })
}

fn has_vertical_barrier_between(
    x_left: f64,
    x_right: f64,
    y_min: f64,
    y_max: f64,
    barriers: &TableVectorBarriers,
) -> bool {
    if x_right <= x_left {
        return false;
    }
    if let Some(vrules) = barriers.vertical_rules.as_ref() {
        for vr in vrules {
            if vr.x >= x_left && vr.x <= x_right && vr.y0 <= y_max + 2.0 && vr.y1 >= y_min - 2.0 {
                return true;
            }
        }
    }
    if let Some(cells) = barriers.cell_rects.as_ref() {
        let mid_y = (y_min + y_max) * 0.5;
        let find_cell = |px: f64| -> Option<usize> {
            cells.iter().position(|c| {
                px >= c.x - 1.0 && px <= c.x + c.width + 1.0 && mid_y >= c.y - 1.0 && mid_y <= c.y + c.height + 1.0
            })
        };
        let left_cell = find_cell(x_left);
        let right_cell = find_cell(x_right);
        if left_cell != right_cell && (left_cell.is_some() || right_cell.is_some()) {
            return true;
        }
    }
    false
}

fn split_line_chars_at_barriers_and_columns(
    mut chars: Vec<CharRec>,
    barriers: &TableVectorBarriers,
) -> Vec<LineSeg> {
    let has_backtrack = chars.windows(2).any(|w| w[1].vx + 1.0 < w[0].vx);
    if has_backtrack {
        chars.sort_by(|a, b| a.vx.total_cmp(&b.vx));
    }
    let Some(whole) = compute_seg_metrics(&chars) else {
        return Vec::new();
    };
    let line_fs = whole.fs;
    let line_min_y = whole.min_y;
    let line_max_y = whole.max_y;

    let mut out = Vec::new();
    let mut start_idx = 0usize;
    let mut last_non_ws_idx: Option<usize> = None;

    for i in 0..whole.chars.len() {
        if whole.chars[i].is_ws {
            continue;
        }
        if let Some(prev_idx) = last_non_ws_idx {
            let prev = &whole.chars[prev_idx];
            let curr = &whole.chars[i];
            let gap = curr.vx - (prev.vx + prev.vw);
            let mid_l = prev.vx + prev.vw * 0.5;
            let mid_r = curr.vx + curr.vw * 0.5;
            let barrier = gap >= line_fs * 0.35
                && has_vertical_barrier_between(mid_l, mid_r, line_min_y, line_max_y, barriers);
            let wide_col_gap = gap >= line_fs * 1.85;
            if barrier || wide_col_gap {
                if let Some(seg) = compute_seg_metrics(&whole.chars[start_idx..i]) {
                    out.push(seg);
                }
                start_idx = i;
            }
        }
        last_non_ws_idx = Some(i);
    }
    if start_idx < whole.chars.len() {
        if let Some(seg) = compute_seg_metrics(&whole.chars[start_idx..]) {
            out.push(seg);
        }
    }
    out
}

fn merge_orphan_script_segments(
    segments: Vec<LineSeg>,
    barriers: &TableVectorBarriers,
) -> Vec<LineSeg> {
    if segments.len() < 2 {
        return segments;
    }
    let mut segs = segments;
    let mut i = 0;
    while i < segs.len() {
        let non_ws_count = segs[i].chars.iter().filter(|c| !c.is_ws).count();
        if non_ws_count <= 4 {
            let mut merged_into: Option<usize> = None;
            if i > 0 {
                let prev = &segs[i - 1];
                let cur = &segs[i];
                let gap = cur.min_x - prev.max_x;
                let same_band =
                    cur.max_y >= prev.min_y - prev.fs * 0.45 && cur.min_y <= prev.max_y + prev.fs * 0.25;
                if cur.fs <= prev.fs * 0.85
                    && gap >= -prev.fs * 0.35
                    && gap <= prev.fs * 0.85
                    && same_band
                    && !has_vertical_barrier_between(
                        prev.max_x - prev.fs * 0.2,
                        cur.min_x + cur.fs * 0.2,
                        prev.min_y.min(cur.min_y),
                        prev.max_y.max(cur.max_y),
                        barriers,
                    )
                {
                    merged_into = Some(i - 1);
                }
            }
            if merged_into.is_none() && i + 1 < segs.len() {
                let cur = &segs[i];
                let next = &segs[i + 1];
                let gap = next.min_x - cur.max_x;
                let same_band =
                    cur.max_y >= next.min_y - next.fs * 0.45 && cur.min_y <= next.max_y + next.fs * 0.25;
                if cur.fs <= next.fs * 0.85
                    && gap >= -next.fs * 0.35
                    && gap <= next.fs * 0.85
                    && same_band
                    && !has_vertical_barrier_between(
                        cur.max_x - cur.fs * 0.2,
                        next.min_x + next.fs * 0.2,
                        cur.min_y.min(next.min_y),
                        cur.max_y.max(next.max_y),
                        barriers,
                    )
                {
                    merged_into = Some(i + 1);
                }
            }
            if let Some(target_idx) = merged_into {
                let orphan = segs.remove(i);
                let adj_idx = if target_idx > i { target_idx - 1 } else { target_idx };
                let mut combined = segs[adj_idx].chars.clone();
                combined.extend(orphan.chars);
                combined.sort_by(|a, b| a.vx.total_cmp(&b.vx));
                if let Some(updated) = compute_seg_metrics(&combined) {
                    segs[adj_idx] = updated;
                }
                i = adj_idx.saturating_add(1).min(segs.len());
                continue;
            }
        }
        i += 1;
    }
    segs
}

fn merge_same_baseline_segments(
    mut segments: Vec<LineSeg>,
    barriers: &TableVectorBarriers,
) -> Vec<LineSeg> {
    if segments.len() < 2 {
        return segments;
    }
    segments.sort_by(|a, b| {
        let base_bucket_a = (a.baseline_y / 3.0).round();
        let base_bucket_b = (b.baseline_y / 3.0).round();
        base_bucket_a
            .total_cmp(&base_bucket_b)
            .then_with(|| a.min_x.total_cmp(&b.min_x))
    });
    let mut merged: Vec<LineSeg> = Vec::with_capacity(segments.len());
    for seg in segments {
        if let Some(last) = merged.last_mut() {
            let ref_fs = last.fs.max(seg.fs).max(4.0);
            let fs_ratio = last.fs.min(seg.fs) / ref_fs;
            let gap = seg.min_x - last.max_x;
            let baseline_diff = (last.baseline_y - seg.baseline_y).abs();
            if baseline_diff <= ref_fs * 0.26
                && fs_ratio >= 0.68
                && gap >= -ref_fs * 0.35
                && gap <= ref_fs * 1.40
                && !has_vertical_barrier_between(
                    last.max_x - ref_fs * 0.15,
                    seg.min_x + ref_fs * 0.15,
                    last.min_y.min(seg.min_y),
                    last.max_y.max(seg.max_y),
                    barriers,
                )
            {
                let mut combined = last.chars.clone();
                combined.extend_from_slice(&seg.chars);
                if let Some(updated) = compute_seg_metrics(&combined) {
                    *last = updated;
                    continue;
                }
            }
        }
        merged.push(seg);
    }
    merged
}

fn segment_to_raw_line(seg: &LineSeg, block_idx: usize) -> Option<RawExtractedLine> {
    if seg.chars.is_empty() {
        return None;
    }

    // Weight dominant style by printable character count so an inline bold prefix does not make the whole line bold.
    let mut font_counts: HashMap<&str, usize> = HashMap::new();
    let mut color_counts: HashMap<&str, usize> = HashMap::new();
    let mut bold_count = 0usize;
    let mut italic_count = 0usize;
    let mut printable_count = 0usize;
    let mut main_fs_samples: Vec<f64> = Vec::new();
    let mut main_base_samples: Vec<f64> = Vec::new();

    for c in &seg.chars {
        if c.is_ws {
            continue;
        }
        printable_count += 1;
        *font_counts.entry(c.font_name.as_str()).or_insert(0) += 1;
        *color_counts.entry(c.color.as_str()).or_insert(0) += 1;
        if c.bold {
            bold_count += 1;
        }
        if c.italic {
            italic_count += 1;
        }
        main_fs_samples.push(c.fs);
        main_base_samples.push(c.baseline_y);
    }
    if printable_count == 0 {
        return None;
    }

    let dominant_font_name = font_counts
        .into_iter()
        .max_by_key(|(_, cnt)| *cnt)
        .map(|(k, _)| k)
        .unwrap_or("Helvetica");
    let dominant_color = color_counts
        .into_iter()
        .max_by_key(|(_, cnt)| *cnt)
        .map(|(k, _)| k.to_string())
        .unwrap_or_else(|| "#0f172a".to_string());

    let rep = seg
        .chars
        .iter()
        .find(|c| !c.is_ws && c.font_name == dominant_font_name)
        .or_else(|| seg.chars.iter().find(|c| !c.is_ws))?;

    let base_bold = bold_count * 2 >= printable_count;
    let base_italic = italic_count * 2 >= printable_count;

    // Exclude small super/subscript outliers when determining the main line font size & baseline.
    let raw_med_fs = median_f64(main_fs_samples.clone(), seg.fs);
    let normal_fs_samples: Vec<f64> = main_fs_samples
        .iter()
        .copied()
        .filter(|&f| f > raw_med_fs * 0.80)
        .collect();
    let eff_fs = if normal_fs_samples.is_empty() {
        raw_med_fs
    } else {
        median_f64(normal_fs_samples, raw_med_fs)
    };
    let normal_base_samples: Vec<f64> = seg
        .chars
        .iter()
        .filter(|c| !c.is_ws && c.fs > eff_fs * 0.80)
        .map(|c| c.baseline_y)
        .collect();
    let eff_baseline = median_f64(normal_base_samples, seg.baseline_y);

    let mut runs: Vec<TextRun> = Vec::new();
    let mut push_run_char = |ch: char, bold: bool, italic: bool, script: TextScriptMode| {
        if let Some(last) = runs.last_mut() {
            if last.bold == Some(bold)
                && last.italic == Some(italic)
                && last.script == Some(script)
            {
                last.text.push(ch);
                return;
            }
        }
        runs.push(TextRun {
            text: ch.to_string(),
            bold: Some(bold),
            italic: Some(italic),
            underline: None,
            strikethrough: None,
            script: Some(script),
        });
    };

    let mut prev_non_ws_right: Option<f64> = None;
    let mut crossed_explicit_space = false;
    let mut last_emitted_ws = false;
    let mut first_word_end: Option<f64> = None;
    let mut max_word_space = 0.0_f64;
    let mut space_widths: Vec<f64> = Vec::new();

    for c in &seg.chars {
        if c.is_ws {
            crossed_explicit_space = true;
            if prev_non_ws_right.is_some() && !last_emitted_ws {
                push_run_char(' ', c.bold, c.italic, TextScriptMode::Normal);
                last_emitted_ws = true;
            }
            continue;
        }

        if let Some(prev_r) = prev_non_ws_right {
            let word_gap = c.vx - prev_r;
            let is_word_break = crossed_explicit_space || word_gap > eff_fs * 0.20;
            if is_word_break {
                if first_word_end.is_none() {
                    first_word_end = Some(prev_r);
                }
                if !last_emitted_ws && word_gap > eff_fs * 0.20 {
                    push_run_char(' ', c.bold, c.italic, TextScriptMode::Normal);
                }
                if word_gap > 0.0 && word_gap < eff_fs * 2.5 {
                    max_word_space = max_word_space.max(word_gap);
                    if word_gap < eff_fs * 0.72 {
                        space_widths.push(word_gap);
                    }
                }
            }
        }

        let script = if c.fs <= eff_fs * 0.82 && (eff_baseline - c.baseline_y) >= eff_fs * 0.14 {
            TextScriptMode::Super
        } else if c.fs <= eff_fs * 0.82 && (c.baseline_y - eff_baseline) >= eff_fs * 0.10 {
            TextScriptMode::Sub
        } else {
            TextScriptMode::Normal
        };
        push_run_char(c.ch, c.bold, c.italic, script);
        prev_non_ws_right = Some(c.vx + c.vw);
        crossed_explicit_space = false;
        last_emitted_ws = false;
    }

    let normalized_runs = normalize_text_runs(&runs, base_bold, base_italic);
    let text = runs_to_plain_text(&normalized_runs);
    if text.trim().is_empty() {
        return None;
    }

    let first_word_w = first_word_end
        .map(|end_x| (end_x - seg.min_x).max(eff_fs * 0.4))
        .unwrap_or_else(|| (seg.max_x - seg.min_x).max(eff_fs * 0.4));
    let space_w = if space_widths.is_empty() {
        eff_fs * 0.28
    } else {
        median_f64(space_widths, eff_fs * 0.28)
    };

    Some(RawExtractedLine {
        text,
        runs: Some(normalized_runs),
        x0: seg.min_x,
        y0: seg.min_y,
        x1: seg.max_x,
        y1: seg.max_y,
        baseline_y: eff_baseline,
        font_size: eff_fs,
        space_width: Some(space_w),
        first_word_width: first_word_w,
        max_word_space: if max_word_space > 0.0 {
            Some(max_word_space)
        } else {
            None
        },
        color: dominant_color,
        font_family: rep.font_family.clone(),
        raw_font_name: rep.font_name.clone(),
        original_font_name: Some(rep.clean_font_name.clone()),
        is_custom_font: Some(rep.is_custom_font),
        font_source: Some(rep.font_source.clone()),
        horizontal_scale: Some(rep.horizontal_scale),
        bold: base_bold,
        italic: base_italic,
        serif: rep.serif
            || rep.font_family.contains("Times")
            || rep.font_family.contains("Serif"),
        mono: rep.mono
            || rep.font_family.contains("Courier")
            || rep.font_family.contains("Mono"),
        block_idx,
    })
}

/// Extracts raster images, vector table barriers/shapes (including inside Form XObjects),
/// Z-order/background layer classification, accurate typography + inline runs, and grouped
/// editable text blocks natively via PDFium.
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
    let page_w = page.width().value as f64;
    let page_h = page.height().value as f64;

    let mut analysis = PageObjectAnalysis {
        page_id: page_id.to_string(),
        ..PageObjectAnalysis::default()
    };

    let mut z_counter = 0usize;
    let mut text_z_boxes: Vec<TextZBox> = Vec::new();
    for (idx, obj) in page.objects().iter().enumerate() {
        collect_object_recursive(
            page_index,
            page_id,
            page_h,
            &obj,
            None,
            &idx.to_string(),
            &mut z_counter,
            &mut text_z_boxes,
            &mut analysis,
        );
    }

    let text_page = page
        .text()
        .map_err(|e| PdfError::Backend(format!("text page error: {e}")))?;

    let mut font_meta_cache: HashMap<(String, bool, bool, bool, bool), CachedFontMeta> =
        HashMap::new();
    let mut embedded_cache: HashMap<String, bool> = HashMap::new();

    let mut grouped_char_lines: Vec<Vec<CharRec>> = Vec::new();
    let mut cur_chars: Vec<CharRec> = Vec::new();
    let mut cur_fs = 12.0_f64;
    let mut seg_baseline = 0.0_f64;
    let mut prev_min_y = 0.0_f64;
    let mut prev_max_y = 0.0_f64;
    let mut max_x = f64::NEG_INFINITY;

    for ch in text_page.chars().iter() {
        let Some(uc) = ch.unicode_char() else {
            continue;
        };
        if uc == '\r' || uc == '\n' {
            if !cur_chars.is_empty() {
                grouped_char_lines.push(std::mem::take(&mut cur_chars));
            }
            continue;
        }
        let is_ws = uc.is_whitespace() || matches!(uc, '\u{00A0}' | '\u{2007}' | '\u{202F}');
        let bounds = ch
            .loose_bounds()
            .or_else(|_| ch.tight_bounds())
            .unwrap_or(PdfRect::ZERO);
        let (vx, vy, vw, vh) = pdfium_rect_to_visual(page_h, &bounds);
        let scaled_fs = ch.scaled_font_size().value as f64;
        let visual_tall_fs = if uc.is_ascii_uppercase()
            || uc.is_ascii_digit()
            || matches!(uc, 'b' | 'd' | 'f' | 'h' | 'k' | 'l' | 't')
        {
            ch.tight_bounds().ok().and_then(|tb| {
                let th = tb.height().value as f64;
                if th > 1.5 {
                    Some(th / 0.72)
                } else {
                    None
                }
            })
        } else {
            None
        };
        let fs = match visual_tall_fs {
            Some(vf) if scaled_fs <= 2.0 || scaled_fs > vf * 1.65 || scaled_fs < vf * 0.55 => {
                vf.clamp(4.0, 144.0)
            }
            _ => scaled_fs.clamp(4.0, 144.0),
        };
        let w = if is_ws && vw < 0.5 { fs * 0.28 } else { vw };
        let h = if vh < 1.0 { fs } else { vh };
        let baseline_y = ch
            .origin()
            .ok()
            .map(|(_ox, oy)| page_h - oy.value as f64)
            .filter(|by| by.is_finite() && *by >= vy - 2.0 && *by <= page_h + 2.0)
            .unwrap_or(vy + h * 0.80);

        if !cur_chars.is_empty() {
            let dy_base = (baseline_y - seg_baseline).abs();
            let dx = vx - max_x;
            let vert_overlap = vy < prev_max_y + 2.0 && (vy + h) > prev_min_y - 2.0;
            let same_line_base = dy_base <= cur_fs.max(fs) * 0.62
                || (vert_overlap && dx >= -cur_fs * 0.25 && dx <= cur_fs.max(fs) * 2.5);
            if !same_line_base || dx > cur_fs.max(fs) * 3.0 || dx < -cur_fs * 1.25 {
                grouped_char_lines.push(std::mem::take(&mut cur_chars));
            }
        }

        let raw_font_name = {
            let n = ch.font_name();
            if n.is_empty() {
                "Helvetica".to_string()
            } else {
                n
            }
        };
        let is_serif = ch.font_is_serif();
        let is_mono = ch.font_is_fixed_pitch();
        let weight_bold = matches!(
            ch.font_weight(),
            Some(
                PdfFontWeight::Weight600
                    | PdfFontWeight::Weight700Bold
                    | PdfFontWeight::Weight800
                    | PdfFontWeight::Weight900
            )
        ) || matches!(ch.font_weight(), Some(PdfFontWeight::Custom(wt)) if wt >= 600);
        let is_bold_flag = ch.font_is_bold_reenforced() || weight_bold;
        let is_italic_flag = ch.font_is_italic();

        let meta = font_meta_cache
            .entry((
                raw_font_name.clone(),
                is_serif,
                is_mono,
                is_bold_flag,
                is_italic_flag,
            ))
            .or_insert_with(|| {
                let parsed = parse_pdf_font_metadata(
                    &raw_font_name,
                    is_serif,
                    is_mono,
                    is_bold_flag,
                    is_italic_flag,
                );
                let is_emb = *embedded_cache.entry(raw_font_name.clone()).or_insert_with(|| {
                    ch.text_object()
                        .ok()
                        .and_then(|to| to.font().is_embedded().ok())
                        .unwrap_or(false)
                });
                let font_source = if is_emb {
                    "embedded".to_string()
                } else if !parsed.is_custom_font {
                    "builtin".to_string()
                } else {
                    "missing".to_string()
                };
                CachedFontMeta {
                    parsed,
                    font_source,
                }
            })
            .clone();

        let color = if matches!(ch.render_mode(), Ok(PdfPageTextRenderMode::StrokedUnfilled)) {
            ch.stroke_color()
        } else {
            ch.fill_color()
        }
        .map(color_to_hex)
        .unwrap_or_else(|_| "#0f172a".to_string());

        let rec = CharRec {
            ch: if is_ws { ' ' } else { uc },
            vx,
            vy,
            vw: w,
            vh: h,
            baseline_y,
            fs,
            is_ws,
            color,
            font_name: raw_font_name,
            font_family: meta.parsed.font_family.clone(),
            clean_font_name: meta.parsed.clean_font_name.clone(),
            is_custom_font: meta.parsed.is_custom_font,
            font_source: meta.font_source.clone(),
            horizontal_scale: meta.parsed.estimated_horizontal_scale,
            bold: meta.parsed.bold,
            italic: meta.parsed.italic,
            serif: is_serif,
            mono: is_mono,
        };

        if cur_chars.is_empty() {
            cur_fs = fs;
            seg_baseline = baseline_y;
            prev_min_y = vy;
            prev_max_y = vy + h;
            max_x = vx + w;
        } else {
            if !is_ws {
                // Anchor seg_baseline & cur_fs to the first tall printable char rather than leading bullets/super-digits.
                if cur_chars.iter().all(|c| c.is_ws) || (cur_chars.len() <= 2 && fs > cur_fs * 1.15) {
                    cur_fs = fs;
                    seg_baseline = baseline_y;
                }
            }
            prev_min_y = prev_min_y.min(vy);
            prev_max_y = prev_max_y.max(vy + h);
            max_x = max_x.max(vx + w);
        }
        cur_chars.push(rec);
    }
    if !cur_chars.is_empty() {
        grouped_char_lines.push(cur_chars);
    }

    let barriers = TableVectorBarriers {
        horizontal_rules: Some(analysis.horizontal_rules.clone()),
        vertical_rules: Some(analysis.vertical_rules.clone()),
        cell_rects: Some(analysis.cell_rects.clone()),
    };

    let mut segments: Vec<LineSeg> = Vec::new();
    for chars in grouped_char_lines {
        segments.extend(split_line_chars_at_barriers_and_columns(chars, &barriers));
    }
    segments = merge_orphan_script_segments(segments, &barriers);
    segments = merge_same_baseline_segments(segments, &barriers);

    let mut raw_lines: Vec<RawExtractedLine> = Vec::with_capacity(segments.len());
    for seg in &segments {
        if let Some(line) = segment_to_raw_line(seg, raw_lines.len()) {
            raw_lines.push(line);
        }
    }

    analysis.text_blocks = build_detected_text_blocks(&raw_lines, page_id, Some(&barriers));
    classify_layer_depths(page_w, page_h, &text_z_boxes, &mut analysis);
    Ok(analysis)
}
