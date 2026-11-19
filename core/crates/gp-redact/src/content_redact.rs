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

    pub fn scale(sx: f64, sy: f64) -> Self {
        Self {
            a: sx,
            b: 0.0,
            c: 0.0,
            d: sy,
            e: 0.0,
            f: 0.0,
        }
    }

    /// Counter-clockwise rotation in PDF user space (y axis pointing up).
    pub fn rotate_rad(theta: f64) -> Self {
        let (sin, cos) = theta.sin_cos();
        Self {
            a: cos,
            b: sin,
            c: -sin,
            d: cos,
            e: 0.0,
            f: 0.0,
        }
    }

    pub fn inverse(&self) -> Option<Self> {
        let det = self.a * self.d - self.b * self.c;
        if det.abs() < 1e-12 {
            return None;
        }
        let a = self.d / det;
        let b = -self.b / det;
        let c = -self.c / det;
        let d = self.a / det;
        Some(Self {
            a,
            b,
            c,
            d,
            e: -(self.e * a + self.f * c),
            f: -(self.e * b + self.f * d),
        })
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

    fn intersect(&self, other: &Self) -> Option<Self> {
        let x0 = self.x0.max(other.x0);
        let y0 = self.y0.max(other.y0);
        let x1 = self.x1.min(other.x1);
        let y1 = self.y1.min(other.y1);
        if x1 > x0 && y1 > y0 {
            Some(Self { x0, y0, x1, y1 })
        } else {
            None
        }
    }

    /// True when both boxes describe the same painted object (edges agree within a small
    /// tolerance). Used for targeted image/shape replacement so stripping one object never
    /// removes other images or vector paths that merely overlap it (e.g. a logo on a photo).
    fn matches(&self, other: &Self) -> bool {
        let (ax0, ax1) = (self.x0.min(self.x1), self.x0.max(self.x1));
        let (ay0, ay1) = (self.y0.min(self.y1), self.y0.max(self.y1));
        let (bx0, bx1) = (other.x0.min(other.x1), other.x0.max(other.x1));
        let (by0, by1) = (other.y0.min(other.y1), other.y0.max(other.y1));
        let tol_x = 3.5f64.max(0.08 * (ax1 - ax0).max(bx1 - bx0));
        let tol_y = 3.5f64.max(0.08 * (ay1 - ay0).max(by1 - by0));
        (ax0 - bx0).abs() <= tol_x
            && (ax1 - bx1).abs() <= tol_x
            && (ay0 - by0).abs() <= tol_y
            && (ay1 - by1).abs() <= tol_y
    }
}

/// Image strip targets: full redaction regions remove every intersecting image, while
/// replacement/delete targets only remove the image whose placement matches exactly.
#[derive(Debug, Clone, Default)]
struct ImageStripTargets {
    redact: Vec<BBox>,
    exact: Vec<BBox>,
    moves: Vec<(BBox, Matrix2D, ClipPolygon)>,
}

impl ImageStripTargets {
    fn should_strip(&self, img: &BBox) -> bool {
        self.redact.iter().any(|rb| img.intersects(rb)) || self.exact.iter().any(|eb| img.matches(eb))
    }

    fn move_for(&self, img: &BBox) -> Option<(&Matrix2D, &ClipPolygon)> {
        self.moves.iter().find(|(from, _, _)| img.matches(from)).map(|(_, m, c)| (m, c))
    }
}

#[derive(Debug, Clone)]
struct GraphicsState {
    ctm: Matrix2D,
    clip_bbox: Option<BBox>,
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
            clip_bbox: None,
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
    /// Images moved/resized/rotated/flipped IN PLACE (same paint order, original encoding).
    pub image_transforms: Vec<ObjectTransform>,
    /// Vector paths moved/resized/rotated IN PLACE (same paint order).
    pub shape_transforms: Vec<ObjectTransform>,
}

/// Re-places one original page object: the object whose placement matches `from` (visual page
/// rect, top-down points) is mapped onto `to`, applying the rotation/flip deltas about its centre.
#[derive(Debug, Clone, Copy)]
pub struct ObjectTransform {
    pub from: RedactionRect,
    pub to_x: f64,
    pub to_y: f64,
    pub to_width: f64,
    pub to_height: f64,
    /// Visual (clockwise, screen) rotation of the object before/after the edit, degrees.
    pub from_rotation_deg: f64,
    pub to_rotation_deg: f64,
    pub flip_x_changed: bool,
    pub flip_y_changed: bool,
    /// Optional crop window (visual page rect, rotated by `to_rotation_deg` about its centre):
    /// the re-placed object is clipped to it.
    pub clip: Option<RedactionRect>,
}

/// Which kind of original object an in-place edit targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InPlaceKind {
    Image,
    Shape,
}

/// In-place move for a replacement element (`inPlace: true`, not deleted), if any.
pub fn element_in_place_transform(
    el: &gp_model::CanvasElement,
    page_index: usize,
) -> Option<(InPlaceKind, ObjectTransform)> {
    use gp_model::CanvasElement;
    let (clip, kind, base, orig, rot0, fx_changed, fy_changed) = match el {
        CanvasElement::ImageReplacement {
            base,
            original_rect,
            in_place: Some(true),
            deleted,
            flip_x,
            flip_y,
            original_rotation,
            original_flip_x,
            original_flip_y,
            in_place_clip,
            ..
        } if !deleted.unwrap_or(false) => (
            in_place_clip.as_ref().map(|c| RedactionRect {
                page_index,
                x: c.x,
                y: c.y,
                width: c.width,
                height: c.height,
            }),
            InPlaceKind::Image,
            base,
            (*original_rect)?,
            original_rotation.unwrap_or(0.0),
            flip_x.unwrap_or(false) != original_flip_x.unwrap_or(false),
            flip_y.unwrap_or(false) != original_flip_y.unwrap_or(false),
        ),
        CanvasElement::ShapeReplacement {
            base,
            original_rect,
            in_place: Some(true),
            deleted,
            ..
        } if !deleted.unwrap_or(false) => (None, InPlaceKind::Shape, base, (*original_rect)?, 0.0, false, false),
        _ => return None,
    };
    Some((
        kind,
        ObjectTransform {
            from: RedactionRect {
                page_index,
                x: orig.x,
                y: orig.y,
                width: orig.width,
                height: orig.height,
            },
            to_x: base.x,
            to_y: base.y,
            to_width: base.width,
            to_height: base.height,
            from_rotation_deg: rot0,
            to_rotation_deg: base.rotation,
            flip_x_changed: fx_changed,
            flip_y_changed: fy_changed,
            clip,
        },
    ))
}

/// Original-text regions a text edit removes: only its changed lines when the editor sent
/// them, otherwise the whole original paragraph box.
pub fn element_text_strip_rects(el: &gp_model::CanvasElement) -> Vec<gp_model::RectBox> {
    match el {
        gp_model::CanvasElement::TextEdit { strip_rects: Some(rects), deleted, .. }
            if !deleted.unwrap_or(false) =>
        {
            rects.clone()
        }
        gp_model::CanvasElement::TextEdit { .. } => vec![el.strip_rect()],
        _ => Vec::new(),
    }
}

/// Builds the user-space matrix `A` with `new_placement = old_placement then A`.
fn object_transform_matrix(t: &ObjectTransform, crop_box: [f64; 4], rotation: i64) -> Option<(BBox, Matrix2D)> {
    object_transform_with_clip(t, crop_box, rotation).map(|(b, m, _)| (b, m))
}

/// Visual (top-down page points) -> PDF user space for a page with `crop_box` and `/Rotate`.
fn visual_point_to_user(vx: f64, vy: f64, crop_box: [f64; 4], rotation: i64) -> (f64, f64) {
    let [cx0, cy0, cx1, cy1] = crop_box;
    match ((rotation % 360) + 360) % 360 {
        90 => (cx0 + vy, cy0 + vx),
        180 => (cx1 - vx, cy0 + vy),
        270 => (cx1 - vy, cy1 - vx),
        _ => (cx0 + vx, cy1 - vy),
    }
}

/// Clip polygon (user space) of a crop window rotated clockwise by `rot_deg` about its centre.
fn clip_polygon_user(clip: &RedactionRect, rot_deg: f64, crop_box: [f64; 4], rotation: i64) -> [(f64, f64); 4] {
    let cx = clip.x + clip.width * 0.5;
    let cy = clip.y + clip.height * 0.5;
    let (s, c) = rot_deg.to_radians().sin_cos();
    let hw = clip.width * 0.5;
    let hh = clip.height * 0.5;
    let local = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)];
    let mut out = [(0.0, 0.0); 4];
    for (i, (lx, ly)) in local.iter().enumerate() {
        // y-down visual space: clockwise rotation keeps the usual matrix form.
        let vx = cx + lx * c - ly * s;
        let vy = cy + lx * s + ly * c;
        out[i] = visual_point_to_user(vx, vy, crop_box, rotation);
    }
    out
}

type ClipPolygon = Option<[(f64, f64); 4]>;

fn object_transform_with_clip(
    t: &ObjectTransform,
    crop_box: [f64; 4],
    rotation: i64,
) -> Option<(BBox, Matrix2D, ClipPolygon)> {
    let clip = t
        .clip
        .filter(|c| c.width > 0.01 && c.height > 0.01)
        .map(|c| clip_polygon_user(&c, t.to_rotation_deg, crop_box, rotation));
    let (from, m) = object_transform_matrix_inner(t, crop_box, rotation)?;
    Some((from, m, clip))
}

fn object_transform_matrix_inner(t: &ObjectTransform, crop_box: [f64; 4], rotation: i64) -> Option<(BBox, Matrix2D)> {
    let from = visual_rect_to_user_bbox(&t.from, crop_box, rotation);
    let to_rect = RedactionRect {
        page_index: t.from.page_index,
        x: t.to_x,
        y: t.to_y,
        width: t.to_width,
        height: t.to_height,
    };
    let to = visual_rect_to_user_bbox(&to_rect, crop_box, rotation);
    let fw = (from.x1 - from.x0).abs();
    let fh = (from.y1 - from.y0).abs();
    if fw < 0.01 || fh < 0.01 {
        return None;
    }
    let sx = (to.x1 - to.x0).abs() / fw;
    let sy = (to.y1 - to.y0).abs() / fh;
    let c0 = ((from.x0 + from.x1) * 0.5, (from.y0 + from.y1) * 0.5);
    let c1 = ((to.x0 + to.x1) * 0.5, (to.y0 + to.y1) * 0.5);
    let page_quarter_turn = matches!(((rotation % 360) + 360) % 360, 90 | 270);
    let (flip_ux, flip_uy) = if page_quarter_turn {
        (t.flip_y_changed, t.flip_x_changed)
    } else {
        (t.flip_x_changed, t.flip_y_changed)
    };
    // Visual clockwise rotation == counter-clockwise negative rotation in y-up user space.
    let r0 = -t.from_rotation_deg.to_radians();
    let r1 = -t.to_rotation_deg.to_radians();
    let m = Matrix2D::translate(-c0.0, -c0.1)
        .multiply(&Matrix2D::rotate_rad(-r0))
        .multiply(&Matrix2D::scale(
            if flip_ux { -sx } else { sx },
            if flip_uy { -sy } else { sy },
        ))
        .multiply(&Matrix2D::rotate_rad(r1))
        .multiply(&Matrix2D::translate(c1.0, c1.1));
    Some((from, m))
}

/// Local `cm` to insert right before an object painted under `ctm` so it lands at `ctm then a`.
fn local_move_matrix(ctm: &Matrix2D, a: &Matrix2D) -> Option<Matrix2D> {
    Some(ctm.multiply(a).multiply(&ctm.inverse()?))
}

fn matrix_op(m: &Matrix2D) -> Operation {
    Operation::new(
        "cm",
        vec![real_op(m.a), real_op(m.b), real_op(m.c), real_op(m.d), real_op(m.e), real_op(m.f)],
    )
}

/// Vector path strip/move targets.
#[derive(Debug, Clone, Default)]
struct ShapeTargets {
    strip: Vec<BBox>,
    moves: Vec<(BBox, Matrix2D)>,
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
    let page_count = pages.len();

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

    let mut image_moves_by_page: HashMap<usize, Vec<ObjectTransform>> = HashMap::new();
    for t in &options.image_transforms {
        image_moves_by_page.entry(t.from.page_index).or_default().push(*t);
    }
    let mut shape_moves_by_page: HashMap<usize, Vec<ObjectTransform>> = HashMap::new();
    for t in &options.shape_transforms {
        shape_moves_by_page.entry(t.from.page_index).or_default().push(*t);
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
        let page_image_moves = image_moves_by_page
            .get(&page_index)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);
        let page_shape_moves = shape_moves_by_page
            .get(&page_index)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);
        if page_rects.is_empty()
            && page_text_only.is_empty()
            && page_image_only.is_empty()
            && page_shape_rects.is_empty()
            && page_image_moves.is_empty()
            && page_shape_moves.is_empty()
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
        let image_targets = ImageStripTargets {
            redact: redact_boxes.clone(),
            exact: page_image_only
                .iter()
                .map(|r| visual_rect_to_user_bbox(r, crop_box, rotation))
                .collect(),
            moves: page_image_moves
                .iter()
                .filter_map(|t| object_transform_with_clip(t, crop_box, rotation))
                .collect(),
        };
        let shape_boxes = ShapeTargets {
            strip: page_shape_rects
                .iter()
                .map(|r| visual_rect_to_user_bbox(r, crop_box, rotation))
                .collect(),
            moves: page_shape_moves
                .iter()
                .filter_map(|t| object_transform_matrix(t, crop_box, rotation))
                .collect(),
        };

        let (resources_opt, resource_ids) = doc
            .get_page_resources(page_id)
            .unwrap_or((None, Vec::new()));
        // `/Resources` given by reference (very common) is reported via the id list, not inline.
        let resources_owned = resources_opt.cloned().or_else(|| {
            resource_ids
                .iter()
                .find_map(|id| doc.get_dictionary(*id).ok().cloned())
        });
        let fonts = resolve_page_fonts(&doc, resources_owned.as_ref());
        let xobjects = resolve_page_xobjects(&doc, resources_owned.as_ref());
        let resources_shared = resource_ids
            .iter()
            .any(|id| count_object_references(&doc, *id) > 1)
            || (resources_opt.is_none() && resource_ids.is_empty() && page_count > 1);

        let content_bytes = doc.get_page_content(page_id);
        if content_bytes.is_empty() && !options.draw_redaction_boxes {
            continue;
        }

        let decoded = Content::decode(&content_bytes)
            .map_err(|e| PdfError::RedactionFailed(format!("failed decoding content stream: {e}")))?;

        let mut added_page_xobjects: HashMap<Vec<u8>, ObjectId> = HashMap::new();
        let mut clone_seq = 0usize;
        let (mut new_ops, changed_here) = rewrite_operations(
            &mut doc,
            &decoded.operations,
            Matrix2D::identity(),
            None,
            &text_boxes,
            &image_targets,
            &shape_boxes,
            &fonts,
            &xobjects,
            resources_shared,
            &mut added_page_xobjects,
            &mut clone_seq,
            &mut stats,
        )?;

        if !added_page_xobjects.is_empty() {
            attach_xobjects_to_page(&mut doc, page_id, &added_page_xobjects);
        }

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

fn attach_xobjects_to_dict(
    doc: &mut Document,
    dict_id: ObjectId,
    added: &HashMap<Vec<u8>, ObjectId>,
) {
    if added.is_empty() {
        return;
    }
    let owner_obj = match doc.get_object(dict_id).cloned() {
        Ok(o) => o,
        Err(_) => return,
    };
    let res_obj_opt = match &owner_obj {
        Object::Dictionary(d) => d.get(b"Resources").ok().cloned(),
        Object::Stream(s) => s.dict.get(b"Resources").ok().cloned(),
        _ => return,
    };
    if let Some(Object::Reference(res_id)) = res_obj_opt {
        if let Ok(mut res_dict) = doc.get_dictionary(res_id).cloned() {
            let xobj_ref = res_dict.get(b"XObject").ok().and_then(|o| o.as_reference().ok());
            if let Some(xid) = xobj_ref {
                if let Ok(mut xd) = doc.get_dictionary(xid).cloned() {
                    for (k, &v) in added {
                        xd.set(k.clone(), Object::Reference(v));
                    }
                    doc.objects.insert(xid, Object::Dictionary(xd));
                    return;
                }
            }
            let mut xd = res_dict
                .get(b"XObject")
                .ok()
                .and_then(|o| o.as_dict().ok())
                .cloned()
                .unwrap_or_default();
            for (k, &v) in added {
                xd.set(k.clone(), Object::Reference(v));
            }
            res_dict.set(b"XObject", Object::Dictionary(xd));
            doc.objects.insert(res_id, Object::Dictionary(res_dict));
            return;
        }
    }

    let merge_into_dict = |owner_dict: &mut Dictionary| {
        let mut res_dict = owner_dict
            .get(b"Resources")
            .ok()
            .and_then(|o| doc.dereference(o).ok())
            .and_then(|(_, o)| o.as_dict().ok())
            .cloned()
            .unwrap_or_default();
        let mut xd = res_dict
            .get(b"XObject")
            .ok()
            .and_then(|o| doc.dereference(o).ok())
            .and_then(|(_, o)| o.as_dict().ok())
            .cloned()
            .unwrap_or_default();
        for (k, &v) in added {
            xd.set(k.clone(), Object::Reference(v));
        }
        res_dict.set(b"XObject", Object::Dictionary(xd));
        owner_dict.set(b"Resources", Object::Dictionary(res_dict));
    };

    match owner_obj {
        Object::Dictionary(mut owner_dict) => {
            merge_into_dict(&mut owner_dict);
            doc.objects.insert(dict_id, Object::Dictionary(owner_dict));
        }
        Object::Stream(mut stream) => {
            merge_into_dict(&mut stream.dict);
            doc.objects.insert(dict_id, Object::Stream(stream));
        }
        _ => {}
    }
}

fn attach_xobjects_to_page(
    doc: &mut Document,
    page_id: ObjectId,
    added: &HashMap<Vec<u8>, ObjectId>,
) {
    attach_xobjects_to_dict(doc, page_id, added);
}

#[allow(clippy::too_many_arguments)]
fn rewrite_operations(
    doc: &mut Document,
    ops: &[Operation],
    initial_ctm: Matrix2D,
    initial_clip: Option<BBox>,
    text_boxes: &[BBox],
    image_boxes: &ImageStripTargets,
    shape_boxes: &ShapeTargets,
    fonts: &HashMap<Vec<u8>, FontMetricsMap>,
    xobjects: &HashMap<Vec<u8>, ObjectId>,
    resources_shared: bool,
    parent_added_xobjects: &mut HashMap<Vec<u8>, ObjectId>,
    clone_seq: &mut usize,
    stats: &mut RedactionStreamStats,
) -> Result<(Vec<Operation>, bool), PdfError> {
    let mut stack: Vec<GraphicsState> = Vec::new();
    let mut gs = GraphicsState {
        ctm: initial_ctm,
        clip_bbox: initial_clip,
        ..GraphicsState::default()
    };
    let mut tm = Matrix2D::identity();
    let mut tlm = Matrix2D::identity();
    let mut in_text = false;
    let mut modified = false;
    let mut out_ops: Vec<Operation> = Vec::with_capacity(ops.len());
    let default_font = FontMetricsMap::default();
    let mut recent_redacted: Option<(BBox, f64)> = None;

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
                let mut move_m: Option<Matrix2D> = None;
                if is_clip_next && !pending_path_pts.is_empty() {
                    let clip = BBox::from_points(&pending_path_pts);
                    gs.clip_bbox = Some(match gs.clip_bbox {
                        Some(existing) => existing.intersect(&clip).unwrap_or(clip),
                        None => clip,
                    });
                }
                if operator != "n" && !is_clip_next && !pending_path_pts.is_empty() {
                    let path_bbox = BBox::from_points(&pending_path_pts);
                    if shape_boxes.strip.iter().any(|sb| path_bbox.matches(sb)) {
                        strip = true;
                    } else if let Some((_, a)) = shape_boxes.moves.iter().find(|(from, _)| path_bbox.matches(from)) {
                        move_m = local_move_matrix(&gs.ctm, a);
                    }
                }
                if strip {
                    modified = true;
                    stats.removed_shapes += 1;
                    pending_path_ops.clear();
                    pending_path_pts.clear();
                } else if let Some(local) = move_m {
                    modified = true;
                    out_ops.push(Operation::new("q", vec![]));
                    out_ops.push(matrix_op(&local));
                    out_ops.append(&mut pending_path_ops);
                    pending_path_pts.clear();
                    out_ops.push(op.clone());
                    out_ops.push(Operation::new("Q", vec![]));
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
                recent_redacted = None;
                out_ops.push(op.clone());
            }
            "ET" => {
                in_text = false;
                recent_redacted = None;
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
                recent_redacted = None;
                out_ops.push(op.clone());
            }
            "Td" if op.operands.len() >= 2 => {
                if let (Some(tx), Some(ty)) =
                    (num_arg(op.operands.first()), num_arg(op.operands.get(1)))
                {
                    tlm = Matrix2D::translate(tx, ty).multiply(&tlm);
                    tm = tlm;
                }
                recent_redacted = None;
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
                recent_redacted = None;
                out_ops.push(op.clone());
            }
            "T*" => {
                tlm = Matrix2D::translate(0.0, -gs.leading).multiply(&tlm);
                tm = tlm;
                recent_redacted = None;
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

                struct EmittedGlyph {
                    raw_bytes: Vec<u8>,
                    unicode: String,
                    start_tm: Matrix2D,
                    bbox: BBox,
                    hit_rb_idx: Option<usize>,
                    redacted: bool,
                    big_jump_before: bool,
                }

                let mut emitted: Vec<EmittedGlyph> = Vec::new();
                let mut pending_jump_from_prev = false;

                for item in &items {
                    match item {
                        Object::Integer(kern) => {
                            let dx = (-*kern as f64 / 1000.0) * fs * th;
                            tm = Matrix2D::translate(dx, 0.0).multiply(&tm);
                            if !emitted.is_empty() && dx.abs() > fs.abs() * 0.15 {
                                pending_jump_from_prev = true;
                            }
                        }
                        Object::Real(kern) => {
                            let dx = (-f64::from(*kern) / 1000.0) * fs * th;
                            tm = Matrix2D::translate(dx, 0.0).multiply(&tm);
                            if !emitted.is_empty() && dx.abs() > fs.abs() * 0.15 {
                                pending_jump_from_prev = true;
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
                                let hit_rb_idx =
                                    text_boxes.iter().position(|rb| glyph_bbox.intersects(rb));
                                emitted.push(EmittedGlyph {
                                    raw_bytes: glyph.raw_bytes,
                                    unicode: glyph.unicode,
                                    start_tm: tm,
                                    bbox: glyph_bbox,
                                    hit_rb_idx,
                                    redacted: hit_rb_idx.is_some(),
                                    big_jump_before: pending_jump_from_prev,
                                });
                                pending_jump_from_prev = false;
                                tm = Matrix2D::translate(glyph_advance, 0.0).multiply(&tm);
                            }
                        }
                        _ => {}
                    }
                }

                // Drifted-tail & unspaced continuation cleanup: cumulative width estimation
                // drift inside long Tj/TJ strings or immediately-following Tj calls without
                // repositioning can push trailing punctuation (`.`, `,`, `;`) or the last 1-3
                // chars slightly past `rb` while in reality they rendered inside the deleted box.
                let eff_fs = effective_page_font_size(&gs.ctm, &tm, fs);
                if let Some((prev_rb, prev_fs)) = recent_redacted {
                    if !emitted.is_empty()
                        && emitted.len() <= 4
                        && !emitted.iter().any(|g| g.redacted)
                        && emitted.iter().all(|g| {
                            is_drifted_tail_candidate(&g.bbox, &prev_rb, prev_fs)
                        })
                    {
                        for g in &mut emitted {
                            g.redacted = true;
                        }
                    }
                }

                let is_tail_punct = |u: &str| {
                    let s = u.trim();
                    !s.is_empty()
                        && s.chars().all(|c| {
                            matches!(
                                c,
                                '.' | ','
                                    | ';'
                                    | ':'
                                    | '!'
                                    | '?'
                                    | ')'
                                    | ']'
                                    | '}'
                                    | '%'
                                    | '-'
                                    | '–'
                                    | '—'
                                    | '\''
                                    | '"'
                                    | '’'
                                    | '”'
                            )
                        })
                };

                let mut i = 0;
                while i < emitted.len() {
                    if let Some(rb_idx) = emitted[i].hit_rb_idx {
                        let rb = text_boxes[rb_idx];
                        let mut j = i + 1;
                        while j < emitted.len()
                            && !emitted[j].redacted
                            && !emitted[j].big_jump_before
                        {
                            let is_space = emitted[j].unicode.trim().is_empty();
                            if is_space {
                                // Only absorb a space if it's immediately followed by short trailing punctuation at the end.
                                let rest = &emitted[(j + 1)..];
                                if !rest.is_empty()
                                    && rest.len() <= 2
                                    && rest.iter().all(|g| {
                                        !g.big_jump_before
                                            && is_tail_punct(&g.unicode)
                                            && is_drifted_tail_candidate(&g.bbox, &rb, eff_fs)
                                    })
                                {
                                    for k in j..emitted.len() {
                                        emitted[k].redacted = true;
                                    }
                                }
                                break;
                            }
                            j += 1;
                        }
                        let tail_len = j - (i + 1);
                        let terminated_at_word_end =
                            j == emitted.len() || emitted[j].unicode.trim().is_empty() || emitted[j].big_jump_before;
                        if tail_len > 0 && tail_len <= 4 && terminated_at_word_end {
                            let all_near_and_aligned = emitted[(i + 1)..j]
                                .iter()
                                .all(|g| is_drifted_tail_candidate(&g.bbox, &rb, eff_fs));
                            let only_punct = emitted[(i + 1)..j]
                                .iter()
                                .all(|g| is_tail_punct(&g.unicode));
                            if all_near_and_aligned && (tail_len <= 3 || only_punct) {
                                for g in &mut emitted[(i + 1)..j] {
                                    g.redacted = true;
                                }
                            }
                        }
                    }
                    i += 1;
                }

                if let Some(last_hit) = emitted.iter().rposition(|g| g.hit_rb_idx.is_some()) {
                    if last_hit + 1 == emitted.len()
                        || emitted[(last_hit + 1)..].iter().all(|g| g.redacted)
                    {
                        if let Some(rb_idx) = emitted[last_hit].hit_rb_idx {
                            recent_redacted = Some((text_boxes[rb_idx], eff_fs));
                        }
                    } else {
                        recent_redacted = None;
                    }
                } else if !emitted.iter().all(|g| g.redacted) {
                    recent_redacted = None;
                }

                let hit_any = emitted.iter().any(|g| g.redacted);
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

                for g in emitted {
                    if g.redacted {
                        flush_span(&mut cur_bytes, cur_start_tm, &mut spans);
                    } else {
                        if g.big_jump_before {
                            flush_span(&mut cur_bytes, cur_start_tm, &mut spans);
                        }
                        if cur_bytes.is_empty() {
                            cur_start_tm = g.start_tm;
                        }
                        cur_bytes.extend_from_slice(&g.raw_bytes);
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
                                let raw_bbox = BBox::from_points(&pts);
                                let clipped_bbox = gs
                                    .clip_bbox
                                    .and_then(|c| raw_bbox.intersect(&c))
                                    .unwrap_or(raw_bbox);
                                let strip_img = image_boxes.should_strip(&raw_bbox)
                                    || image_boxes.should_strip(&clipped_bbox);
                                if strip_img {
                                    keep_do = false;
                                    modified = true;
                                } else if let Some((a, clip)) = image_boxes
                                    .move_for(&raw_bbox)
                                    .or_else(|| image_boxes.move_for(&clipped_bbox))
                                {
                                    if let Some(local) = local_move_matrix(&gs.ctm, a) {
                                        keep_do = false;
                                        modified = true;
                                        out_ops.push(Operation::new("q", vec![]));
                                        if let (Some(poly), Some(inv)) = (clip, gs.ctm.inverse()) {
                                            // Path coordinates are read under the current CTM.
                                            for (i, (ux, uy)) in poly.iter().enumerate() {
                                                let (px, py) = inv.transform_point(*ux, *uy);
                                                out_ops.push(Operation::new(
                                                    if i == 0 { "m" } else { "l" },
                                                    vec![real_op(px), real_op(py)],
                                                ));
                                            }
                                            out_ops.push(Operation::new("h", vec![]));
                                            out_ops.push(Operation::new("W", vec![]));
                                            out_ops.push(Operation::new("n", vec![]));
                                        }
                                        out_ops.push(matrix_op(&local));
                                        out_ops.push(op.clone());
                                        out_ops.push(Operation::new("Q", vec![]));
                                    }
                                }
                            } else if is_form {
                                if let Ok(form_bytes) = stream.decompressed_content() {
                                    if let Ok(form_content) = Content::decode(&form_bytes) {
                                        let form_matrix =
                                            read_matrix_from_dict(&stream.dict, b"Matrix")
                                                .unwrap_or_else(Matrix2D::identity);
                                        let form_ctm = form_matrix.multiply(&gs.ctm);
                                        let form_res = stream
                                            .dict
                                            .get(b"Resources")
                                            .ok()
                                            .and_then(|o| doc.dereference(o).ok())
                                            .and_then(|(_, o)| o.as_dict().ok())
                                            .cloned();
                                        let form_fonts = resolve_page_fonts(doc, form_res.as_ref());
                                        let merged_fonts = merge_fonts(fonts, &form_fonts);
                                        let own_form_xobjs =
                                            resolve_page_xobjects(doc, form_res.as_ref());
                                        let merged_xobjs = merge_xobjects(xobjects, &own_form_xobjs);
                                        let form_resources_shared = stream
                                            .dict
                                            .get(b"Resources")
                                            .ok()
                                            .and_then(|o| o.as_reference().ok())
                                            .map(|id| count_object_references(doc, id) > 1)
                                            .unwrap_or(resources_shared);
                                        let mut inner_added_xobjects: HashMap<Vec<u8>, ObjectId> =
                                            HashMap::new();
                                        let (form_new_ops, form_changed) = rewrite_operations(
                                            doc,
                                            &form_content.operations,
                                            form_ctm,
                                            gs.clip_bbox,
                                            text_boxes,
                                            image_boxes,
                                            shape_boxes,
                                            &merged_fonts,
                                            &merged_xobjs,
                                            form_resources_shared,
                                            &mut inner_added_xobjects,
                                            clone_seq,
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
                                                let same_stream_uses = ops
                                                    .iter()
                                                    .filter(|o| {
                                                        o.operator == "Do"
                                                            && o.operands
                                                                .first()
                                                                .and_then(|x| x.as_name().ok())
                                                                == Some(name)
                                                    })
                                                    .count();
                                                let shared_in_doc = same_stream_uses > 1
                                                    || count_object_references(doc, obj_id) > 1
                                                    || resources_shared;
                                                if shared_in_doc {
                                                    *clone_seq += 1;
                                                    let new_name =
                                                        format!("GpRedForm{}", *clone_seq)
                                                            .into_bytes();
                                                    let new_id =
                                                        doc.add_object(Object::Stream(target));
                                                    if !inner_added_xobjects.is_empty() {
                                                        attach_xobjects_to_dict(
                                                            doc,
                                                            new_id,
                                                            &inner_added_xobjects,
                                                        );
                                                    }
                                                    parent_added_xobjects
                                                        .insert(new_name.clone(), new_id);
                                                    keep_do = false;
                                                    out_ops.push(Operation::new(
                                                        "Do",
                                                        vec![Object::Name(new_name)],
                                                    ));
                                                } else {
                                                    doc.objects
                                                        .insert(obj_id, Object::Stream(target));
                                                    if !inner_added_xobjects.is_empty() {
                                                        attach_xobjects_to_dict(
                                                            doc,
                                                            obj_id,
                                                            &inner_added_xobjects,
                                                        );
                                                    }
                                                }
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

fn merge_xobjects(
    outer: &HashMap<Vec<u8>, ObjectId>,
    inner: &HashMap<Vec<u8>, ObjectId>,
) -> HashMap<Vec<u8>, ObjectId> {
    let mut combined = outer.clone();
    for (k, v) in inner {
        combined.insert(k.clone(), *v);
    }
    combined
}

fn read_matrix_from_dict(dict: &Dictionary, key: &[u8]) -> Option<Matrix2D> {
    let arr = dict.get(key).ok()?.as_array().ok()?;
    if arr.len() < 6 {
        return None;
    }
    Some(Matrix2D {
        a: num_arg(arr.first())?,
        b: num_arg(arr.get(1))?,
        c: num_arg(arr.get(2))?,
        d: num_arg(arr.get(3))?,
        e: num_arg(arr.get(4))?,
        f: num_arg(arr.get(5))?,
    })
}

fn count_object_references(doc: &Document, target: ObjectId) -> usize {
    fn count_in_obj(obj: &Object, target: ObjectId) -> usize {
        match obj {
            Object::Reference(id) => usize::from(*id == target),
            Object::Array(arr) => arr.iter().map(|o| count_in_obj(o, target)).sum(),
            Object::Dictionary(dict) => dict.iter().map(|(_, v)| count_in_obj(v, target)).sum(),
            Object::Stream(stream) => stream
                .dict
                .iter()
                .map(|(_, v)| count_in_obj(v, target))
                .sum(),
            _ => 0,
        }
    }
    doc.objects.values().map(|o| count_in_obj(o, target)).sum()
}

fn effective_page_font_size(ctm: &Matrix2D, tm: &Matrix2D, font_size: f64) -> f64 {
    let total = tm.multiply(ctm);
    let scale = total.a.hypot(total.b).max(total.c.hypot(total.d)).max(1e-6);
    (font_size.abs().max(1e-4) * scale).max(2.0)
}

fn is_drifted_tail_candidate(glyph_bbox: &BBox, rb: &BBox, eff_fs: f64) -> bool {
    let vert_overlap = glyph_bbox.y1.min(rb.y1) - glyph_bbox.y0.max(rb.y0);
    let glyph_h = (glyph_bbox.y1 - glyph_bbox.y0).max(eff_fs * 0.5);
    if vert_overlap < glyph_h * 0.2 {
        return false;
    }
    let dx_gap = if glyph_bbox.x0 > rb.x1 {
        glyph_bbox.x0 - rb.x1
    } else if rb.x0 > glyph_bbox.x1 {
        rb.x0 - glyph_bbox.x1
    } else {
        0.0
    };
    dx_gap <= (eff_fs * 2.5).max(16.0)
}

fn glyph_page_bbox(
    ctm: &Matrix2D,
    tm: &Matrix2D,
    advance_x: f64,
    font_size: f64,
    rise: f64,
) -> BBox {
    let total = tm.multiply(ctm);
    let abs_fs = font_size.abs().max(1e-4);
    let w = advance_x.max(abs_fs * 0.18);
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

#[cfg(test)]
mod image_target_tests {
    use super::*;

    /// One page with a full-page background image and a small logo image drawn on top of it.
    fn two_image_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let img = |doc: &mut Document| {
            doc.add_object(Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => 1,
                    "Height" => 1,
                    "ColorSpace" => "DeviceRGB",
                    "BitsPerComponent" => 8,
                },
                vec![255, 0, 0],
            ))
        };
        let bg = img(&mut doc);
        let logo = img(&mut doc);
        let resources_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "Bg" => bg, "Logo" => logo },
        });
        let ops = vec![
            Operation::new("q", vec![]),
            Operation::new("cm", vec![595.into(), 0.into(), 0.into(), 842.into(), 0.into(), 0.into()]),
            Operation::new("Do", vec!["Bg".into()]),
            Operation::new("Q", vec![]),
            Operation::new("q", vec![]),
            Operation::new("cm", vec![100.into(), 0.into(), 0.into(), 100.into(), 400.into(), 600.into()]),
            Operation::new("Do", vec!["Logo".into()]),
            Operation::new("Q", vec![]),
        ];
        let content_id = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => resources_id,
            "Contents" => content_id,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    fn drawn_xobjects(pdf: &[u8]) -> Vec<String> {
        let doc = Document::load_mem(pdf).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let content = Content::decode(&doc.get_page_content(page_id)).unwrap();
        content
            .operations
            .iter()
            .filter(|op| op.operator == "Do")
            .filter_map(|op| op.operands.first()?.as_name().ok().map(|n| String::from_utf8_lossy(n).to_string()))
            .collect()
    }

    fn strip_image(pdf: &[u8], x: f64, y: f64, w: f64, h: f64) -> Vec<u8> {
        redact_pdf_bytes_with_lopdf(
            pdf,
            &[],
            RedactionOptions {
                image_only_rects: vec![RedactionRect { page_index: 0, x, y, width: w, height: h }],
                ..Default::default()
            },
        )
        .unwrap()
        .0
    }

    #[test]
    fn stripping_logo_keeps_overlapping_background_image() {
        // Logo visual rect: x=400, top = 842 - 700 = 142.
        let out = strip_image(&two_image_pdf(), 400.0, 142.0, 100.0, 100.0);
        assert_eq!(drawn_xobjects(&out), vec!["Bg".to_string()]);
    }

    /// Visits every image `Do` with its effective user-space bbox, in paint order.
    fn painted_images(pdf: &[u8]) -> Vec<(String, BBox)> {
        let doc = Document::load_mem(pdf).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let content = Content::decode(&doc.get_page_content(page_id)).unwrap();
        let mut stack = vec![Matrix2D::identity()];
        let mut out = Vec::new();
        for op in &content.operations {
            match op.operator.as_str() {
                "q" => stack.push(*stack.last().unwrap()),
                "Q" => {
                    stack.pop();
                }
                "cm" => {
                    let v: Vec<f64> = op.operands.iter().map(|o| num_arg(Some(o)).unwrap()).collect();
                    let m = Matrix2D { a: v[0], b: v[1], c: v[2], d: v[3], e: v[4], f: v[5] };
                    let top = stack.last_mut().unwrap();
                    *top = m.multiply(top);
                }
                "Do" => {
                    let ctm = stack.last().unwrap();
                    let pts = [
                        ctm.transform_point(0.0, 0.0),
                        ctm.transform_point(1.0, 0.0),
                        ctm.transform_point(0.0, 1.0),
                        ctm.transform_point(1.0, 1.0),
                    ];
                    let name = String::from_utf8_lossy(op.operands[0].as_name().unwrap()).to_string();
                    out.push((name, BBox::from_points(&pts)));
                }
                _ => {}
            }
        }
        out
    }

    #[test]
    fn moving_background_in_place_keeps_it_beneath_the_logo() {
        let out = redact_pdf_bytes_with_lopdf(
            &two_image_pdf(),
            &[],
            RedactionOptions {
                image_transforms: vec![ObjectTransform {
                    from: RedactionRect { page_index: 0, x: 0.0, y: 0.0, width: 595.0, height: 842.0 },
                    to_x: 40.0,
                    to_y: 30.0,
                    to_width: 297.5,
                    to_height: 421.0,
                    from_rotation_deg: 0.0,
                    to_rotation_deg: 0.0,
                    flip_x_changed: false,
                    flip_y_changed: false,
                    clip: None,
                }],
                ..Default::default()
            },
        )
        .unwrap()
        .0;
        let painted = painted_images(&out);
        assert_eq!(painted.iter().map(|p| p.0.as_str()).collect::<Vec<_>>(), vec!["Bg", "Logo"]);
        let bg = painted[0].1;
        // Visual (40,30,297.5x421) => user x 40..337.5, y 842-451=391..812.
        assert!((bg.x0 - 40.0).abs() < 0.05 && (bg.x1 - 337.5).abs() < 0.05, "{bg:?}");
        assert!((bg.y0 - 391.0).abs() < 0.05 && (bg.y1 - 812.0).abs() < 0.05, "{bg:?}");
        let logo = painted[1].1;
        assert!((logo.x0 - 400.0).abs() < 0.01 && (logo.y0 - 600.0).abs() < 0.01, "{logo:?}");
    }

    #[test]
    fn cropping_background_in_place_clips_it_and_keeps_layer_order() {
        // Full page image re-placed at the same spot but clipped to the top-left quarter.
        let out = redact_pdf_bytes_with_lopdf(
            &two_image_pdf(),
            &[],
            RedactionOptions {
                image_transforms: vec![ObjectTransform {
                    from: RedactionRect { page_index: 0, x: 0.0, y: 0.0, width: 595.0, height: 842.0 },
                    to_x: 0.0,
                    to_y: 0.0,
                    to_width: 595.0,
                    to_height: 842.0,
                    from_rotation_deg: 0.0,
                    to_rotation_deg: 0.0,
                    flip_x_changed: false,
                    flip_y_changed: false,
                    clip: Some(RedactionRect { page_index: 0, x: 10.0, y: 20.0, width: 200.0, height: 100.0 }),
                }],
                ..Default::default()
            },
        )
        .unwrap()
        .0;
        let painted = painted_images(&out);
        assert_eq!(painted.iter().map(|p| p.0.as_str()).collect::<Vec<_>>(), vec!["Bg", "Logo"]);
        let doc = Document::load_mem(&out).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let ops = Content::decode(&doc.get_page_content(page_id)).unwrap().operations;
        let w = ops.iter().position(|o| o.operator == "W").expect("clip operator");
        let bg_do = ops.iter().position(|o| o.operator == "Do").unwrap();
        assert!(w < bg_do, "clip must precede the background Do");
        // First clip vertex: visual (10,20) -> user (10, 842-20), emitted under the image's
        // own CTM (595 0 0 842 0 0), i.e. in unit-square coordinates.
        let m = ops.iter().position(|o| o.operator == "m").unwrap();
        let x = num_arg(ops[m].operands.first()).unwrap() * 595.0;
        let y = num_arg(ops[m].operands.get(1)).unwrap() * 842.0;
        assert!((x - 10.0).abs() < 0.05 && (y - 822.0).abs() < 0.05, "({x},{y})");
    }

    #[test]
    fn stripping_background_keeps_logo_drawn_on_top() {
        let out = strip_image(&two_image_pdf(), 0.0, 0.0, 595.0, 842.0);
        assert_eq!(drawn_xobjects(&out), vec!["Logo".to_string()]);
    }

    #[test]
    fn stripping_image_inside_translated_form_xobject_respects_matrix() {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let img = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 1,
                "Height" => 1,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            vec![0, 255, 0],
        ));
        let form = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 100.into(), 50.into()],
                "Matrix" => vec![1.into(), 0.into(), 0.into(), 1.into(), 120.into(), 600.into()],
                "Resources" => dictionary! {
                    "XObject" => dictionary! { "ImInner" => img },
                },
            },
            Content {
                operations: vec![
                    Operation::new("q", vec![]),
                    Operation::new("cm", vec![100.into(), 0.into(), 0.into(), 50.into(), 0.into(), 0.into()]),
                    Operation::new("Do", vec!["ImInner".into()]),
                    Operation::new("Q", vec![]),
                ],
            }
            .encode()
            .unwrap(),
        ));
        let resources_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "Fm1" => form },
        });
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            Content {
                operations: vec![Operation::new("Do", vec!["Fm1".into()])],
            }
            .encode()
            .unwrap(),
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => resources_id,
            "Contents" => content_id,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut pdf = Vec::new();
        doc.save_to(&mut pdf).unwrap();

        // Image user-space bbox is x=120..220, y=600..650 => visual y = 842 - 650 = 192.
        let out = strip_image(&pdf, 120.0, 192.0, 100.0, 50.0);
        let out_doc = Document::load_mem(&out).unwrap();
        let out_form = match out_doc.get_object(form).unwrap() {
            Object::Stream(s) => s,
            other => panic!("expected Stream, got {other:?}"),
        };
        let form_ops = Content::decode(&out_form.decompressed_content().unwrap()).unwrap();
        assert!(
            !form_ops.operations.iter().any(|op| op.operator == "Do"),
            "inner image Do should be stripped when Form /Matrix is applied: {:?}",
            form_ops.operations
        );
    }

    #[test]
    fn stripping_clipped_image_matches_visible_clip_rect() {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let img = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 1,
                "Height" => 1,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            vec![0, 0, 255],
        ));
        let resources_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "ClippedImg" => img },
        });
        let ops = vec![
            Operation::new("q", vec![]),
            Operation::new("re", vec![100.into(), 500.into(), 60.into(), 40.into()]),
            Operation::new("W", vec![]),
            Operation::new("n", vec![]),
            Operation::new("cm", vec![200.into(), 0.into(), 0.into(), 200.into(), 50.into(), 450.into()]),
            Operation::new("Do", vec!["ClippedImg".into()]),
            Operation::new("Q", vec![]),
        ];
        let content_id = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => resources_id,
            "Contents" => content_id,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut pdf = Vec::new();
        doc.save_to(&mut pdf).unwrap();

        // Visible clip user-space bbox is (100, 500..540) => visual y = 842 - 540 = 302.
        let out = strip_image(&pdf, 100.0, 302.0, 60.0, 40.0);
        assert!(drawn_xobjects(&out).is_empty());
    }

    #[test]
    fn stripping_text_does_not_leave_trailing_period_due_to_metric_drift() {
        let pdf = create_sample_pdf_with_text_lines(&[("Merhaba dunya.", 72.0, 700.0, 12.0)]).unwrap();
        // Deliberately stop redaction rect 5pt short of the trailing period so drift leaves `.` outside.
        let (out, _) = redact_pdf_bytes_with_lopdf(
            &pdf,
            &[],
            RedactionOptions {
                text_only_rects: vec![RedactionRect {
                    page_index: 0,
                    x: 72.0,
                    y: 842.0 - 712.0,
                    width: 72.0,
                    height: 16.0,
                }],
                ..Default::default()
            },
        )
        .unwrap();
        let doc = Document::load_mem(&out).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let content = Content::decode(&doc.get_page_content(page_id)).unwrap();
        assert!(
            !content.operations.iter().any(|op| op.operator == "Tj" || op.operator == "TJ"),
            "trailing punctuation should not be left behind: {:?}",
            content.operations
        );
    }
}
