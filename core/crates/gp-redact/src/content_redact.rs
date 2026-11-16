use std::collections::HashMap;

use gp_pdf::{PdfError, RedactionRect};
use lopdf::{
    content::{Content, Operation},
    dictionary, Dictionary, Document, Object, ObjectId, Stream, StringFormat,
};

use crate::cmap::{DecodedGlyph, FontMetricsMap};

#[derive(Debug, Clone, Copy)]
pub(crate) struct Matrix2D {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Default for Matrix2D {
    fn default() -> Self {
        Self::identity()
    }
}

impl Matrix2D {
    pub fn identity() -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 0.0,
            f: 0.0,
        }
    }

    pub fn multiply(&self, rhs: &Self) -> Self {
        Self {
            a: self.a * rhs.a + self.b * rhs.c,
            b: self.a * rhs.b + self.b * rhs.d,
            c: self.c * rhs.a + self.d * rhs.c,
            d: self.c * rhs.b + self.d * rhs.d,
            e: self.e * rhs.a + self.f * rhs.c + rhs.e,
            f: self.e * rhs.b + self.f * rhs.d + rhs.f,
        }
    }

    pub fn translate(tx: f64, ty: f64) -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: tx,
            f: ty,
        }
    }

    pub fn transform_point(&self, x: f64, y: f64) -> (f64, f64) {
        (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)
    }
}

#[derive(Debug, Clone, Copy)]
struct BBox {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
}

impl BBox {
    fn from_points(pts: &[(f64, f64)]) -> Self {
        let mut x0 = f64::INFINITY;
        let mut y0 = f64::INFINITY;
        let mut x1 = f64::NEG_INFINITY;
        let mut y1 = f64::NEG_INFINITY;
        for &(x, y) in pts {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        Self { x0, y0, x1, y1 }
    }

    fn intersects(&self, other: &Self) -> bool {
        let eps = 0.25;
        self.x1 > other.x0 + eps
            && self.x0 < other.x1 - eps
            && self.y1 > other.y0 + eps
            && self.y0 < other.y1 - eps
    }
}

#[derive(Debug, Clone)]
struct GraphicsState {
    ctm: Matrix2D,
    font_name: Option<Vec<u8>>,
    font_size: f64,
    char_spacing: f64,
    word_spacing: f64,
    horiz_scale: f64,
    leading: f64,
    rise: f64,
}

impl Default for GraphicsState {
    fn default() -> Self {
        Self {
            ctm: Matrix2D::identity(),
            font_name: None,
            font_size: 12.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            horiz_scale: 100.0,
            leading: 0.0,
            rise: 0.0,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct RedactionOptions {
    /// Draws an opaque fill rectangle over removed areas when visual confirmation blacking is desired.
    pub draw_redaction_boxes: bool,
    /// Optional vector shape regions whose matching stroked/filled path sequences should be stripped.
    pub shape_rects: Vec<RedactionRect>,
    /// Text-only regions whose text runs should be stripped without deleting background images.
    pub text_only_rects: Vec<RedactionRect>,
    /// Image-only regions whose image XObjects should be stripped without deleting foreground text.
    pub image_only_rects: Vec<RedactionRect>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RedactionStreamStats {
    pub removed_text_runs: usize,
    pub removed_shapes: usize,
    pub modified_streams: usize,
}

pub(crate) fn num_arg(obj: Option<&Object>) -> Option<f64> {
    match obj? {
        Object::Integer(v) => Some(*v as f64),
        Object::Real(v) => Some(f64::from(*v)),
        _ => None,
    }
}

pub(crate) fn read_rect_box(doc: &Document, dict: &Dictionary, key: &[u8]) -> Option<[f64; 4]> {
    let arr = dict
        .get(key)
        .ok()
        .and_then(|o| doc.dereference(o).ok())
        .and_then(|(_, o)| o.as_array().ok())?;
    if arr.len() < 4 {
        return None;
    }
    Some([
        num_arg(arr.first())?,
        num_arg(arr.get(1))?,
        num_arg(arr.get(2))?,
        num_arg(arr.get(3))?,
    ])
}

fn visual_rect_to_user_bbox(rect: &RedactionRect, crop_box: [f64; 4], rotation: i64) -> BBox {
    let [cx0, cy0, cx1, cy1] = crop_box;
    let rot = ((rotation % 360) + 360) % 360;
    let corners = [
        (rect.x, rect.y),
        (rect.x + rect.width, rect.y),
        (rect.x, rect.y + rect.height),
        (rect.x + rect.width, rect.y + rect.height),
    ];
    let mapped: Vec<(f64, f64)> = corners
        .into_iter()
        .map(|(vx, vy)| match rot {
            90 => (cx0 + vy, cy0 + vx),
            180 => (cx1 - vx, cy0 + vy),
            270 => (cx1 - vy, cy1 - vx),
            _ => (cx0 + vx, cy1 - vy),
        })
        .collect();
    BBox::from_points(&mapped)
}

fn resolve_page_fonts(doc: &Document, resources: Option<&Dictionary>) -> HashMap<Vec<u8>, FontMetricsMap> {
    let mut out = HashMap::new();
    let Some(res) = resources else {
        return out;
    };
    let font_dict_opt = res.get(b"Font").ok().and_then(|o| match doc.dereference(o) {
        Ok((_, Object::Dictionary(d))) => Some(d),
        _ => None,
    });
    let Some(font_dict) = font_dict_opt else {
        return out;
    };
    for (name, val) in font_dict.iter() {
        if let Ok((_, Object::Dictionary(fd))) = doc.dereference(val) {
            out.insert(name.clone(), FontMetricsMap::from_font_dict(doc, fd));
        }
    }
    out
}

fn resolve_page_xobjects(doc: &Document, resources: Option<&Dictionary>) -> HashMap<Vec<u8>, ObjectId> {
    let mut out = HashMap::new();
    let Some(res) = resources else {
        return out;
    };
    let xobj_dict_opt = res.get(b"XObject").ok().and_then(|o| match doc.dereference(o) {
        Ok((_, Object::Dictionary(d))) => Some(d),
        _ => None,
    });
    let Some(xobj_dict) = xobj_dict_opt else {
        return out;
    };
    for (name, val) in xobj_dict.iter() {
        if let Object::Reference(id) = val {
            out.insert(name.clone(), *id);
        }
    }
    out
}

pub(crate) fn real_op(v: f64) -> Object {
    Object::Real(v as f32)
}

fn pdf_string_object(bytes: Vec<u8>) -> Object {
    Object::String(bytes, StringFormat::Hexadecimal)
}

struct SurvivingSpan {
    tm: Matrix2D,
    raw_bytes: Vec<u8>,
}

/// Applies object/operator-level content-stream redaction onto raw PDF bytes.
pub fn redact_pdf_bytes_with_lopdf(
    pdf_bytes: &[u8],
    rects: &[RedactionRect],
    options: RedactionOptions,
) -> Result<(Vec<u8>, RedactionStreamStats), PdfError> {
    let mut doc = Document::load_mem(pdf_bytes)
        .map_err(|e| PdfError::RedactionFailed(format!("failed to parse PDF for redaction: {e}")))?;
    let pages = doc.get_pages();

    let mut by_page: HashMap<usize, Vec<RedactionRect>> = HashMap::new();
    for &r in rects {
        if r.width > 0.0 && r.height > 0.0 {
            by_page.entry(r.page_index).or_default().push(r);
        }
    }

    let mut text_only_by_page: HashMap<usize, Vec<RedactionRect>> = HashMap::new();
    for &r in &options.text_only_rects {
        if r.width > 0.0 && r.height > 0.0 {
            text_only_by_page.entry(r.page_index).or_default().push(r);
        }
    }

    let mut image_only_by_page: HashMap<usize, Vec<RedactionRect>> = HashMap::new();
    for &r in &options.image_only_rects {
        if r.width > 0.0 && r.height > 0.0 {
            image_only_by_page.entry(r.page_index).or_default().push(r);
        }
    }

    let mut shapes_by_page: HashMap<usize, Vec<RedactionRect>> = HashMap::new();
    for &r in &options.shape_rects {
        if r.width > 0.0 && r.height > 0.0 {
            shapes_by_page.entry(r.page_index).or_default().push(r);
        }
    }

    let mut stats = RedactionStreamStats::default();

    for (page_num_one_based, page_id) in pages {
        let page_index = page_num_one_based as usize - 1;
        let page_rects = by_page.get(&page_index).map(|v| v.as_slice()).unwrap_or(&[]);
        let page_text_only = text_only_by_page
            .get(&page_index)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);
        let page_image_only = image_only_by_page
            .get(&page_index)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);
        let page_shape_rects = shapes_by_page
            .get(&page_index)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);
        if page_rects.is_empty()
            && page_text_only.is_empty()
            && page_image_only.is_empty()
            && page_shape_rects.is_empty()
        {
            continue;
        }

        let page_dict = doc
            .get_object(page_id)
            .and_then(Object::as_dict)
            .cloned()
            .map_err(|e| PdfError::RedactionFailed(format!("invalid page dictionary: {e}")))?;

        let media_box = read_rect_box(&doc, &page_dict, b"MediaBox").unwrap_or([0.0, 0.0, 595.0, 842.0]);
        let crop_box = read_rect_box(&doc, &page_dict, b"CropBox").unwrap_or(media_box);
        let rotation = page_dict.get(b"Rotate").and_then(Object::as_i64).unwrap_or(0);

        let redact_boxes: Vec<BBox> = page_rects
            .iter()
            .map(|r| visual_rect_to_user_bbox(r, crop_box, rotation))
            .collect();
        let mut text_boxes: Vec<BBox> = redact_boxes.clone();
        text_boxes.extend(
            page_text_only
                .iter()
                .map(|r| visual_rect_to_user_bbox(r, crop_box, rotation)),
        );
        let mut image_boxes: Vec<BBox> = redact_boxes.clone();
        image_boxes.extend(
            page_image_only
                .iter()
                .map(|r| visual_rect_to_user_bbox(r, crop_box, rotation)),
        );
        let shape_boxes: Vec<BBox> = page_shape_rects
            .iter()
            .map(|r| visual_rect_to_user_bbox(r, crop_box, rotation))
            .collect();

        let (resources_opt, _) = doc
            .get_page_resources(page_id)
            .unwrap_or((None, Vec::new()));
        let resources_owned = resources_opt.cloned();
        let fonts = resolve_page_fonts(&doc, resources_owned.as_ref());
        let xobjects = resolve_page_xobjects(&doc, resources_owned.as_ref());

        let content_bytes = doc.get_page_content(page_id);
        if content_bytes.is_empty() && !options.draw_redaction_boxes {
            continue;
        }

        let decoded = Content::decode(&content_bytes)
            .map_err(|e| PdfError::RedactionFailed(format!("failed decoding content stream: {e}")))?;

        let (mut new_ops, changed_here) = rewrite_operations(
            &mut doc,
            &decoded.operations,
            Matrix2D::identity(),
            &text_boxes,
            &image_boxes,
            &shape_boxes,
            &fonts,
            &xobjects,
            &mut stats,
        )?;

        if options.draw_redaction_boxes {
            for b in &redact_boxes {
                let w = (b.x1 - b.x0).max(0.5);
                let h = (b.y1 - b.y0).max(0.5);
                new_ops.push(Operation::new("q", vec![]));
                new_ops.push(Operation::new(
                    "rg",
                    vec![real_op(0.0), real_op(0.0), real_op(0.0)],
                ));
                new_ops.push(Operation::new(
                    "re",
                    vec![real_op(b.x0), real_op(b.y0), real_op(w), real_op(h)],
                ));
                new_ops.push(Operation::new("f", vec![]));
                new_ops.push(Operation::new("Q", vec![]));
            }
        }

        if changed_here || options.draw_redaction_boxes {
            let encoded = Content {
                operations: new_ops,
            }
            .encode()
            .map_err(|e| PdfError::RedactionFailed(format!("failed encoding redacted stream: {e}")))?;
            if doc.change_page_content(page_id, encoded).is_ok() {
                stats.modified_streams += 1;
            }
        }
    }

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| PdfError::RedactionFailed(format!("failed saving redacted PDF: {e}")))?;
    Ok((out, stats))
}

#[allow(clippy::too_many_arguments)]
fn rewrite_operations(
    doc: &mut Document,
    ops: &[Operation],
    initial_ctm: Matrix2D,
    text_boxes: &[BBox],
    image_boxes: &[BBox],
    shape_boxes: &[BBox],
    fonts: &HashMap<Vec<u8>, FontMetricsMap>,
    xobjects: &HashMap<Vec<u8>, ObjectId>,
    stats: &mut RedactionStreamStats,
) -> Result<(Vec<Operation>, bool), PdfError> {
    let mut stack: Vec<GraphicsState> = Vec::new();
    let mut gs = GraphicsState {
        ctm: initial_ctm,
        ..GraphicsState::default()
    };
    let mut tm = Matrix2D::identity();
    let mut tlm = Matrix2D::identity();
    let mut in_text = false;
    let mut modified = false;
    let mut out_ops: Vec<Operation> = Vec::with_capacity(ops.len());
    let default_font = FontMetricsMap::default();

    // Path construction tracking for vector shape/banner removal (`shape_boxes`).
    let mut pending_path_ops: Vec<Operation> = Vec::new();
    let mut pending_path_pts: Vec<(f64, f64)> = Vec::new();
    let mut is_clip_next = false;

    let flush_path_default = |out_ops: &mut Vec<Operation>,
                              pending_ops: &mut Vec<Operation>,
                              pending_pts: &mut Vec<(f64, f64)>| {
        if !pending_ops.is_empty() {
            out_ops.append(pending_ops);
            pending_pts.clear();
        }
    };

    for op in ops {
        let operator = op.operator.as_str();
        match operator {
            "m" | "l" if !in_text && op.operands.len() >= 2 => {
                if let (Some(x), Some(y)) =
                    (num_arg(op.operands.first()), num_arg(op.operands.get(1)))
                {
                    pending_path_pts.push(gs.ctm.transform_point(x, y));
                }
                pending_path_ops.push(op.clone());
            }
            "c" if !in_text && op.operands.len() >= 6 => {
                for pair in [(0, 1), (2, 3), (4, 5)] {
                    if let (Some(x), Some(y)) = (
                        num_arg(op.operands.get(pair.0)),
                        num_arg(op.operands.get(pair.1)),
                    ) {
                        pending_path_pts.push(gs.ctm.transform_point(x, y));
                    }
                }
                pending_path_ops.push(op.clone());
            }
            "v" | "y" if !in_text && op.operands.len() >= 4 => {
                for pair in [(0, 1), (2, 3)] {
                    if let (Some(x), Some(y)) = (
                        num_arg(op.operands.get(pair.0)),
                        num_arg(op.operands.get(pair.1)),
                    ) {
                        pending_path_pts.push(gs.ctm.transform_point(x, y));
                    }
                }
                pending_path_ops.push(op.clone());
            }
            "re" if !in_text && op.operands.len() >= 4 => {
                if let (Some(x), Some(y), Some(w), Some(h)) = (
                    num_arg(op.operands.first()),
                    num_arg(op.operands.get(1)),
                    num_arg(op.operands.get(2)),
                    num_arg(op.operands.get(3)),
                ) {
                    pending_path_pts.push(gs.ctm.transform_point(x, y));
                    pending_path_pts.push(gs.ctm.transform_point(x + w, y));
                    pending_path_pts.push(gs.ctm.transform_point(x, y + h));
                    pending_path_pts.push(gs.ctm.transform_point(x + w, y + h));
                }
                pending_path_ops.push(op.clone());
            }
            "h" if !in_text => {
                pending_path_ops.push(op.clone());
            }
            "W" | "W*" if !in_text => {
                is_clip_next = true;
                pending_path_ops.push(op.clone());
            }
            "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n" if !in_text => {
                let mut strip = false;
                if operator != "n" && !is_clip_next && !shape_boxes.is_empty() && !pending_path_pts.is_empty() {
                    let path_bbox = BBox::from_points(&pending_path_pts);
                    if shape_boxes.iter().any(|sb| {
                        let overlap_w = (path_bbox.x1.min(sb.x1) - path_bbox.x0.max(sb.x0)).max(0.0);
                        let overlap_h = (path_bbox.y1.min(sb.y1) - path_bbox.y0.max(sb.y0)).max(0.0);
                        let sb_area = ((sb.x1 - sb.x0).abs() * (sb.y1 - sb.y0).abs()).max(1.0);
                        let path_area = ((path_bbox.x1 - path_bbox.x0).abs() * (path_bbox.y1 - path_bbox.y0).abs()).max(1.0);
                        let overlap_area = overlap_w * overlap_h;
                        path_bbox.intersects(sb)
                            && (overlap_area / sb_area.min(path_area)) >= 0.45
                    }) {
                        strip = true;
                    }
                }
                if strip {
                    modified = true;
                    stats.removed_shapes += 1;
                    pending_path_ops.clear();
                    pending_path_pts.clear();
                } else {
                    flush_path_default(&mut out_ops, &mut pending_path_ops, &mut pending_path_pts);
                    out_ops.push(op.clone());
                }
                is_clip_next = false;
            }
            "q" => {
                flush_path_default(&mut out_ops, &mut pending_path_ops, &mut pending_path_pts);
                is_clip_next = false;
                stack.push(gs.clone());
                out_ops.push(op.clone());
            }
            "Q" => {
                flush_path_default(&mut out_ops, &mut pending_path_ops, &mut pending_path_pts);
                is_clip_next = false;
                if let Some(prev) = stack.pop() {
                    gs = prev;
                }
                out_ops.push(op.clone());
            }
            "cm" if op.operands.len() >= 6 => {
                flush_path_default(&mut out_ops, &mut pending_path_ops, &mut pending_path_pts);
                if let (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) = (
                    num_arg(op.operands.first()),
                    num_arg(op.operands.get(1)),
                    num_arg(op.operands.get(2)),
                    num_arg(op.operands.get(3)),
                    num_arg(op.operands.get(4)),
                    num_arg(op.operands.get(5)),
                ) {
                    let m = Matrix2D { a, b, c, d, e, f };
                    gs.ctm = m.multiply(&gs.ctm);
                }
                out_ops.push(op.clone());
            }
            "BT" => {
                flush_path_default(&mut out_ops, &mut pending_path_ops, &mut pending_path_pts);
                in_text = true;
                tm = Matrix2D::identity();
                tlm = Matrix2D::identity();
                out_ops.push(op.clone());
            }
            "ET" => {
                in_text = false;
                out_ops.push(op.clone());
            }
            "Tf" if op.operands.len() >= 2 => {
                if let Ok(name) = op.operands[0].as_name() {
                    gs.font_name = Some(name.to_vec());
                }
                if let Some(sz) = num_arg(op.operands.get(1)) {
                    gs.font_size = sz;
                }
                out_ops.push(op.clone());
            }
            "Tc" if !op.operands.is_empty() => {
                if let Some(v) = num_arg(op.operands.first()) {
                    gs.char_spacing = v;
                }
                out_ops.push(op.clone());
            }
            "Tw" if !op.operands.is_empty() => {
                if let Some(v) = num_arg(op.operands.first()) {
                    gs.word_spacing = v;
                }
                out_ops.push(op.clone());
            }
            "Tz" if !op.operands.is_empty() => {
                if let Some(v) = num_arg(op.operands.first()) {
                    gs.horiz_scale = v;
                }
                out_ops.push(op.clone());
            }
            "TL" if !op.operands.is_empty() => {
                if let Some(v) = num_arg(op.operands.first()) {
                    gs.leading = v;
                }
                out_ops.push(op.clone());
            }
            "Ts" if !op.operands.is_empty() => {
                if let Some(v) = num_arg(op.operands.first()) {
                    gs.rise = v;
                }
                out_ops.push(op.clone());
            }
            "Tm" if op.operands.len() >= 6 => {
                if let (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) = (
                    num_arg(op.operands.first()),
                    num_arg(op.operands.get(1)),
                    num_arg(op.operands.get(2)),
                    num_arg(op.operands.get(3)),
                    num_arg(op.operands.get(4)),
                    num_arg(op.operands.get(5)),
                ) {
                    tm = Matrix2D { a, b, c, d, e, f };
                    tlm = tm;
                }
                out_ops.push(op.clone());
            }
            "Td" if op.operands.len() >= 2 => {
                if let (Some(tx), Some(ty)) =
                    (num_arg(op.operands.first()), num_arg(op.operands.get(1)))
                {
                    tlm = Matrix2D::translate(tx, ty).multiply(&tlm);
                    tm = tlm;
                }
                out_ops.push(op.clone());
            }
            "TD" if op.operands.len() >= 2 => {
                if let (Some(tx), Some(ty)) =
                    (num_arg(op.operands.first()), num_arg(op.operands.get(1)))
                {
                    gs.leading = -ty;
                    tlm = Matrix2D::translate(tx, ty).multiply(&tlm);
                    tm = tlm;
                }
                out_ops.push(op.clone());
            }
            "T*" => {
                tlm = Matrix2D::translate(0.0, -gs.leading).multiply(&tlm);
                tm = tlm;
                out_ops.push(op.clone());
            }
            "Tj" | "TJ" | "'" | "\"" if in_text => {
                let mut prepended_ops: Vec<Operation> = Vec::new();
                let items: Vec<Object> = match operator {
                    "Tj" => op.operands.clone(),
                    "TJ" => op
                        .operands
                        .first()
                        .and_then(|o| o.as_array().ok())
                        .cloned()
                        .unwrap_or_default(),
                    "'" => {
                        tlm = Matrix2D::translate(0.0, -gs.leading).multiply(&tlm);
                        tm = tlm;
                        prepended_ops.push(Operation::new("T*", vec![]));
                        op.operands.clone()
                    }
                    "\"" if op.operands.len() >= 3 => {
                        if let (Some(aw), Some(ac)) =
                            (num_arg(op.operands.first()), num_arg(op.operands.get(1)))
                        {
                            gs.word_spacing = aw;
                            gs.char_spacing = ac;
                            prepended_ops.push(Operation::new("Tw", vec![real_op(aw)]));
                            prepended_ops.push(Operation::new("Tc", vec![real_op(ac)]));
                        }
                        tlm = Matrix2D::translate(0.0, -gs.leading).multiply(&tlm);
                        tm = tlm;
                        prepended_ops.push(Operation::new("T*", vec![]));
                        vec![op.operands[2].clone()]
                    }
                    _ => Vec::new(),
                };

                let font = gs
                    .font_name
                    .as_ref()
                    .and_then(|n| fonts.get(n))
                    .unwrap_or(&default_font);

                let fs = gs.font_size;
                let th = gs.horiz_scale / 100.0;
                let mut hit_any = false;
                let mut spans: Vec<SurvivingSpan> = Vec::new();
                let mut cur_bytes: Vec<u8> = Vec::new();
                let mut cur_start_tm = tm;

                let flush_span = |cur_bytes: &mut Vec<u8>,
                                  start_tm: Matrix2D,
                                  spans: &mut Vec<SurvivingSpan>| {
                    if !cur_bytes.is_empty() {
                        spans.push(SurvivingSpan {
                            tm: start_tm,
                            raw_bytes: std::mem::take(cur_bytes),
                        });
                    }
                };

                for item in &items {
                    match item {
                        Object::Integer(kern) => {
                            let dx = (-*kern as f64 / 1000.0) * fs * th;
                            tm = Matrix2D::translate(dx, 0.0).multiply(&tm);
                            if !cur_bytes.is_empty() && dx.abs() > fs.abs() * 0.15 {
                                flush_span(&mut cur_bytes, cur_start_tm, &mut spans);
                            }
                        }
                        Object::Real(kern) => {
                            let dx = (-f64::from(*kern) / 1000.0) * fs * th;
                            tm = Matrix2D::translate(dx, 0.0).multiply(&tm);
                            if !cur_bytes.is_empty() && dx.abs() > fs.abs() * 0.15 {
                                flush_span(&mut cur_bytes, cur_start_tm, &mut spans);
                            }
                        }
                        Object::String(raw, _) => {
                            let glyphs: Vec<DecodedGlyph> = font.decode_glyphs(raw);
                            for glyph in glyphs {
                                let glyph_advance = glyph_user_advance(
                                    &glyph,
                                    fs,
                                    gs.char_spacing,
                                    gs.word_spacing,
                                    th,
                                );
                                let glyph_bbox =
                                    glyph_page_bbox(&gs.ctm, &tm, glyph_advance, fs, gs.rise);
                                let redacted =
                                    text_boxes.iter().any(|rb| glyph_bbox.intersects(rb));
                                if redacted {
                                    hit_any = true;
                                    flush_span(&mut cur_bytes, cur_start_tm, &mut spans);
                                } else {
                                    if cur_bytes.is_empty() {
                                        cur_start_tm = tm;
                                    }
                                    cur_bytes.extend_from_slice(&glyph.raw_bytes);
                                }
                                tm = Matrix2D::translate(glyph_advance, 0.0).multiply(&tm);
                            }
                        }
                        _ => {}
                    }
                }
                flush_span(&mut cur_bytes, cur_start_tm, &mut spans);

                if !hit_any {
                    out_ops.push(op.clone());
                } else {
                    modified = true;
                    stats.removed_text_runs += 1;
                    out_ops.extend(prepended_ops);
                    for span in spans {
                        out_ops.push(Operation::new(
                            "Tm",
                            vec![
                                real_op(span.tm.a),
                                real_op(span.tm.b),
                                real_op(span.tm.c),
                                real_op(span.tm.d),
                                real_op(span.tm.e),
                                real_op(span.tm.f),
                            ],
                        ));
                        out_ops.push(Operation::new("Tj", vec![pdf_string_object(span.raw_bytes)]));
                    }
                }
            }
            "Do" if !op.operands.is_empty() => {
                flush_path_default(&mut out_ops, &mut pending_path_ops, &mut pending_path_pts);
                let mut keep_do = true;
                if let Ok(name) = op.operands[0].as_name() {
                    if let Some(&obj_id) = xobjects.get(name) {
                        if let Ok(Object::Stream(stream)) = doc.get_object(obj_id).cloned() {
                            let is_form = stream
                                .dict
                                .get(b"Subtype")
                                .and_then(Object::as_name)
                                .map(|s| s == b"Form")
                                .unwrap_or(false);
                            let is_image = stream
                                .dict
                                .get(b"Subtype")
                                .and_then(Object::as_name)
                                .map(|s| s == b"Image")
                                .unwrap_or(false);

                            if is_image {
                                let pts = [
                                    gs.ctm.transform_point(0.0, 0.0),
                                    gs.ctm.transform_point(1.0, 0.0),
                                    gs.ctm.transform_point(0.0, 1.0),
                                    gs.ctm.transform_point(1.0, 1.0),
                                ];
                                let img_bbox = BBox::from_points(&pts);
                                if image_boxes.iter().any(|rb| img_bbox.intersects(rb)) {
                                    keep_do = false;
                                    modified = true;
                                }
                            } else if is_form {
                                if let Ok(form_bytes) = stream.decompressed_content() {
                                    if let Ok(form_content) = Content::decode(&form_bytes) {
                                        let form_res = stream
                                            .dict
                                            .get(b"Resources")
                                            .ok()
                                            .and_then(|o| doc.dereference(o).ok())
                                            .and_then(|(_, o)| o.as_dict().ok())
                                            .cloned();
                                        let form_fonts = resolve_page_fonts(doc, form_res.as_ref());
                                        let merged_fonts = merge_fonts(fonts, &form_fonts);
                                        let form_xobjs = resolve_page_xobjects(doc, form_res.as_ref());
                                        let (form_new_ops, form_changed) = rewrite_operations(
                                            doc,
                                            &form_content.operations,
                                            gs.ctm,
                                            text_boxes,
                                            image_boxes,
                                            shape_boxes,
                                            &merged_fonts,
                                            &form_xobjs,
                                            stats,
                                        )?;
                                        if form_changed {
                                            modified = true;
                                            let encoded = Content {
                                                operations: form_new_ops,
                                            }
                                            .encode()
                                            .map_err(|e| {
                                                PdfError::RedactionFailed(format!(
                                                    "failed encoding redacted Form XObject: {e}"
                                                ))
                                            })?;
                                            if let Ok(Object::Stream(mut target)) =
                                                doc.get_object(obj_id).cloned()
                                            {
                                                target.set_plain_content(encoded);
                                                let _ = target.compress();
                                                doc.objects.insert(obj_id, Object::Stream(target));
                                                stats.modified_streams += 1;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if keep_do {
                    out_ops.push(op.clone());
                }
            }
            _ => {
                flush_path_default(&mut out_ops, &mut pending_path_ops, &mut pending_path_pts);
                out_ops.push(op.clone());
            }
        }
    }

    flush_path_default(&mut out_ops, &mut pending_path_ops, &mut pending_path_pts);
    Ok((out_ops, modified))
}

fn merge_fonts(
    outer: &HashMap<Vec<u8>, FontMetricsMap>,
    inner: &HashMap<Vec<u8>, FontMetricsMap>,
) -> HashMap<Vec<u8>, FontMetricsMap> {
    let mut combined = outer.clone();
    for (k, v) in inner {
        combined.insert(k.clone(), v.clone());
    }
    combined
}

fn glyph_user_advance(
    glyph: &DecodedGlyph,
    font_size: f64,
    char_spacing: f64,
    word_spacing: f64,
    horiz_scale: f64,
) -> f64 {
    let is_space = glyph.raw_bytes.len() == 1 && glyph.raw_bytes[0] == b' ';
    let tw = if is_space { word_spacing } else { 0.0 };
    ((glyph.width_thousandths / 1000.0) * font_size + char_spacing + tw) * horiz_scale
}

fn glyph_page_bbox(
    ctm: &Matrix2D,
    tm: &Matrix2D,
    advance_x: f64,
    font_size: f64,
    rise: f64,
) -> BBox {
    let total = tm.multiply(ctm);
    let abs_fs = font_size.abs().max(1.0);
    let w = advance_x.max(abs_fs * 0.25);
    let y_bot = rise - abs_fs * 0.28;
    let y_top = rise + abs_fs * 0.88;
    let corners = [
        total.transform_point(0.0, y_bot),
        total.transform_point(w, y_bot),
        total.transform_point(0.0, y_top),
        total.transform_point(w, y_top),
    ];
    BBox::from_points(&corners)
}

pub fn create_sample_pdf_with_text_lines(lines: &[(&str, f64, f64, f64)]) -> Result<Vec<u8>, PdfError> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let resources_id = doc.add_object(dictionary! {
        "Font" => dictionary! {
            "F1" => font_id,
        },
    });

    let mut ops = Vec::new();
    for &(text, x, y, size) in lines {
        ops.push(Operation::new("BT", vec![]));
        ops.push(Operation::new("Tf", vec!["F1".into(), real_op(size)]));
        ops.push(Operation::new(
            "Tm",
            vec![
                real_op(1.0),
                real_op(0.0),
                real_op(0.0),
                real_op(1.0),
                real_op(x),
                real_op(y),
            ],
        ));
        ops.push(Operation::new(
            "Tj",
            vec![Object::string_literal(text.as_bytes())],
        ));
        ops.push(Operation::new("ET", vec![]));
    }
    let content = Content { operations: ops }.encode().map_err(|e| {
        PdfError::Backend(format!("failed encoding test PDF content: {e}"))
    })?;
    let content_id = doc.add_object(Stream::new(dictionary! {}, content));

    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        "Resources" => resources_id,
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
    doc.compress();
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| PdfError::Backend(format!("failed saving test PDF: {e}")))?;
    Ok(out)
}
