use std::collections::HashMap;
use std::io::Cursor;

use gp_geom::{point_base_visual_to_pdf_user_space, stroke_dash_to_array};
use gp_model::{
    BaseElement, CanvasElement, NormalizedPoint, PageMeta, PageNumberingConfig, PositionedTextLine,
    RectBox, TextAlign,
    TextRun, TextScriptMode, VectorShapeType, VectorStrokeDash,
};
use gp_pdf::{PdfError, RedactionRect};
use gp_redact::{
    element_in_place_transform, element_text_strip_rects, redact_pdf_bytes_with_lopdf, InPlaceKind,
    RedactionOptions,
};
use gp_text::{
    build_wrapped_rich_lines, compute_page_number_layout, measure_ttf_text_width,
    ttf_font_supports_text, BuildWrappedRichLinesOptions,
};
use pdfium_render::prelude::*;

use crate::redaction::{redact_document_verified, strip_leftover_objects_with_pdfium};
use crate::{intrinsic_rotation_to_angle, to_pdfium_rotation, StoredDoc};

const KAPPA: f64 = 0.5522847498;

#[derive(Debug, Clone, Default)]
pub struct CompiledFontBundle<'a> {
    pub custom_ttf_bytes: Option<&'a [u8]>,
    pub regular_ttf_bytes: Option<&'a [u8]>,
    pub bold_ttf_bytes: Option<&'a [u8]>,
    pub italic_ttf_bytes: Option<&'a [u8]>,
    pub serif_ttf_bytes: Option<&'a [u8]>,
    pub mono_ttf_bytes: Option<&'a [u8]>,
}

#[derive(Debug, Clone)]
pub struct PreDecodedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct CompilePdfOptions<'a> {
    pub fonts: CompiledFontBundle<'a>,
    pub extra_named_ttf: Option<&'a HashMap<String, Vec<u8>>>,
    pub page_numbering: Option<&'a PageNumberingConfig>,
    pub embedded_images: Option<&'a HashMap<String, PreDecodedImage>>,
}

struct LoadedFonts<'a> {
    regular: PdfFontToken,
    bold: PdfFontToken,
    italic: PdfFontToken,
    serif: PdfFontToken,
    mono: PdfFontToken,
    custom: Option<PdfFontToken>,
    extra: HashMap<String, (PdfFontToken, &'a [u8])>,
    regular_bytes: Option<&'a [u8]>,
    bold_bytes: Option<&'a [u8]>,
    italic_bytes: Option<&'a [u8]>,
    serif_bytes: Option<&'a [u8]>,
    mono_bytes: Option<&'a [u8]>,
    custom_bytes: Option<&'a [u8]>,
}

/// Which fonts the elements being compiled can actually use. PDFium embeds every loaded
/// TrueType font in full, so loading unused families added ~1–2 MB to every save/print/share.
#[derive(Debug, Default, Clone)]
struct FontNeeds {
    any_text: bool,
    bold: bool,
    italic: bool,
    serif: bool,
    mono: bool,
    custom: bool,
    embedded_ids: std::collections::HashSet<String>,
}

impl FontNeeds {
    fn note_family(&mut self, family: &str) {
        let lower = family.to_ascii_lowercase();
        if is_serif_family_name(&lower) {
            self.serif = true;
        }
        if lower.contains("mono") || lower.contains("courier") {
            self.mono = true;
        }
        if lower.contains("custom") || lower.contains("user") {
            self.custom = true;
        }
    }

    fn scan(pages: &[PageMeta], elements: &[CanvasElement], numbering: Option<&PageNumberingConfig>) -> Self {
        let mut needs = Self::default();
        let page_ids: std::collections::HashSet<&str> = pages.iter().map(|p| p.id.as_str()).collect();
        for el in elements.iter().filter(|e| !e.is_deleted() && page_ids.contains(e.page_id())) {
            match el {
                CanvasElement::TextAdd { font_family, bold, italic, runs, embedded_font_id, .. }
                | CanvasElement::TextEdit { font_family, bold, italic, runs, embedded_font_id, .. } => {
                    needs.any_text = true;
                    needs.bold |= *bold;
                    needs.italic |= *italic;
                    for r in runs.iter().flatten() {
                        needs.bold |= r.bold.unwrap_or(false);
                        needs.italic |= r.italic.unwrap_or(false);
                    }
                    needs.note_family(font_family);
                    if let Some(id) = embedded_font_id.as_deref().filter(|s| !s.is_empty()) {
                        needs.embedded_ids.insert(id.to_string());
                    }
                }
                _ => {}
            }
        }
        if let Some(cfg) = numbering.filter(|c| c.enabled) {
            needs.any_text = true;
            needs.note_family(&cfg.font_family);
        }
        needs
    }
}

impl<'a> LoadedFonts<'a> {
    fn load(
        out_doc: &mut PdfDocument<'_>,
        bundle: CompiledFontBundle<'a>,
        extra_map: Option<&'a HashMap<String, Vec<u8>>>,
        needs: &FontNeeds,
    ) -> Self {
        let regular_bytes = bundle.regular_ttf_bytes.or(bundle.custom_ttf_bytes);
        let mut load_ttf = |bytes: Option<&'a [u8]>, wanted: bool| -> Option<PdfFontToken> {
            if !wanted {
                return None;
            }
            bytes.and_then(|b| out_doc.fonts_mut().load_true_type_from_bytes(b, true).ok())
        };
        let regular_loaded = load_ttf(regular_bytes, needs.any_text);
        let bold_loaded = load_ttf(bundle.bold_ttf_bytes, needs.any_text && needs.bold);
        let italic_loaded = load_ttf(bundle.italic_ttf_bytes, needs.any_text && needs.italic);
        let serif_loaded = load_ttf(bundle.serif_ttf_bytes, needs.any_text && needs.serif);
        let mono_loaded = load_ttf(bundle.mono_ttf_bytes, needs.any_text && needs.mono);
        let custom = load_ttf(bundle.custom_ttf_bytes, needs.any_text && needs.custom);
        let regular = regular_loaded.unwrap_or_else(|| out_doc.fonts_mut().helvetica());
        let bold = bold_loaded.unwrap_or(regular);
        let italic = italic_loaded.unwrap_or(regular);
        let serif = serif_loaded.unwrap_or_else(|| out_doc.fonts_mut().times_roman());
        let mono = mono_loaded.unwrap_or_else(|| out_doc.fonts_mut().courier());

        let mut extra = HashMap::new();
        if let Some(map) = extra_map {
            for (k, bytes) in map {
                let base_id = k.split('#').next().unwrap_or(k);
                if !needs.embedded_ids.contains(base_id) {
                    continue;
                }
                if bytes.len() >= 128 {
                    if let Ok(tok) = out_doc.fonts_mut().load_true_type_from_bytes(bytes, true) {
                        extra.insert(k.clone(), (tok, bytes.as_slice()));
                    }
                }
            }
        }

        Self {
            regular,
            bold,
            italic,
            serif,
            mono,
            custom,
            extra,
            regular_bytes,
            bold_bytes: bundle.bold_ttf_bytes.or(regular_bytes),
            italic_bytes: bundle.italic_ttf_bytes.or(regular_bytes),
            serif_bytes: bundle.serif_ttf_bytes.or(regular_bytes),
            mono_bytes: bundle.mono_ttf_bytes.or(regular_bytes),
            custom_bytes: bundle.custom_ttf_bytes,
        }
    }

    fn resolve(
        &self,
        family: &str,
        embedded_id: Option<&str>,
        bold: bool,
        italic: bool,
        text_for_glyph_check: &str,
    ) -> (PdfFontToken, Option<&'a [u8]>) {
        if let Some(emb_id) = embedded_id.filter(|s| !s.is_empty()) {
            let candidates = match (bold, italic) {
                (true, true) => vec![format!("{emb_id}#boldItalic"), format!("{emb_id}#bold"), emb_id.to_string()],
                (true, false) => vec![format!("{emb_id}#bold"), emb_id.to_string()],
                (false, true) => vec![format!("{emb_id}#italic"), emb_id.to_string()],
                (false, false) => vec![emb_id.to_string()],
            };
            for c in candidates {
                if let Some(&(tok, bytes)) = self.extra.get(&c) {
                    if text_for_glyph_check.is_empty() || ttf_font_supports_text(bytes, text_for_glyph_check) {
                        return (tok, Some(bytes));
                    }
                }
            }
        }
        let lower = family.to_ascii_lowercase();
        if (lower.contains("custom") || lower.contains("user")) && self.custom.is_some() {
            return (self.custom.unwrap(), self.custom_bytes);
        }
        if lower.contains("mono") || lower.contains("courier") {
            return (self.mono, self.mono_bytes);
        }
        if is_serif_family_name(&lower) {
            if bold && !lower.contains("times") {
                return (self.bold, self.bold_bytes);
            }
            return (self.serif, self.serif_bytes);
        }
        if bold {
            return (self.bold, self.bold_bytes);
        }
        if italic {
            return (self.italic, self.italic_bytes);
        }
        (self.regular, self.regular_bytes)
    }
}

/// Serif detection for the bundled fallback faces (kept identical to the Android editor).
fn is_serif_family_name(lower: &str) -> bool {
    [
        "serif", "times", "georgia", "book", "garamond", "cambria", "palatino", "baskerville",
        "century", "minion", "charter", "antiqua", "bodoni", "caslon",
    ]
    .iter()
    .any(|k| lower.contains(k))
        && !lower.contains("sans")
}

fn parse_hex_color(raw: &str, alpha: u8) -> Option<PdfColor> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("transparent") || trimmed.eq_ignore_ascii_case("none") {
        return None;
    }
    let h = trimmed.trim_start_matches('#');
    if h.len() == 3 {
        let r = u8::from_str_radix(&h[0..1], 16).ok()? * 17;
        let g = u8::from_str_radix(&h[1..2], 16).ok()? * 17;
        let b = u8::from_str_radix(&h[2..3], 16).ok()? * 17;
        return Some(PdfColor::new(r, g, b, alpha));
    }
    if h.len() >= 6 {
        let r = u8::from_str_radix(&h[0..2], 16).ok().unwrap_or(15);
        let g = u8::from_str_radix(&h[2..4], 16).ok().unwrap_or(23);
        let b = u8::from_str_radix(&h[4..6], 16).ok().unwrap_or(42);
        return Some(PdfColor::new(r, g, b, alpha));
    }
    None
}

fn opacity_alpha(opacity: f64) -> u8 {
    ((opacity.clamp(0.0, 1.0) * 255.0).round() as i32).clamp(0, 255) as u8
}

#[inline]
fn to_pdf_pt(vx: f64, vy: f64, pm: &PageMeta) -> (PdfPoints, PdfPoints) {
    let pt = point_base_visual_to_pdf_user_space(vx, vy, pm.crop_box, pm.intrinsic_rotation);
    (PdfPoints::new(pt.x as f32), PdfPoints::new(pt.y as f32))
}

fn rotate_visual_pt(vx: f64, vy: f64, cx: f64, cy: f64, angle_deg: f64) -> (f64, f64) {
    if angle_deg.abs() < 0.001 {
        return (vx, vy);
    }
    let rad = angle_deg.to_radians();
    let cos = rad.cos();
    let sin = rad.sin();
    let dx = vx - cx;
    let dy = vy - cy;
    (cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
}

#[inline]
fn to_pdf_pt_rot(vx: f64, vy: f64, base: &BaseElement, pm: &PageMeta) -> (PdfPoints, PdfPoints) {
    let cx = base.x + base.width * 0.5;
    let cy = base.y + base.height * 0.5;
    let (rx, ry) = rotate_visual_pt(vx, vy, cx, cy, base.rotation);
    to_pdf_pt(rx, ry, pm)
}

fn attach_object<'a>(
    out_page: &mut PdfPage<'a>,
    object: PdfPageObject<'a>,
    behind: bool,
    bg_cursor: &mut usize,
) {
    // Behind-content objects are emitted in a dedicated pass and their generated content stream
    // is moved in front of the original page content afterwards (see
    // `move_behind_streams_to_front`). Inserting at an index instead would force PDFium to
    // regenerate the original stream, which drops text-state operators such as `Tw` (justified
    // word spacing) and TJ kerning.
    let _ = behind;
    if out_page.objects_mut().add_object(object).is_ok() {
        *bg_cursor += 1;
    }
}

fn apply_dash(path: &mut PdfPagePathObject<'_>, dash: Option<VectorStrokeDash>, stroke_width: f64) {
    if let Some(arr) = stroke_dash_to_array(dash.unwrap_or(VectorStrokeDash::Solid), stroke_width) {
        let pdf_pts: Vec<PdfPoints> = arr.iter().map(|&v| PdfPoints::new(v as f32)).collect();
        let _ = path.set_dash_array(&pdf_pts, PdfPoints::ZERO);
    }
}

fn build_shape_path<'a>(
    out_doc: &'a PdfDocument<'_>,
    base: &BaseElement,
    pm: &PageMeta,
    shape_type: VectorShapeType,
    border_radius: f64,
    fill: Option<PdfColor>,
    stroke: Option<PdfColor>,
    stroke_width: f64,
    dash: Option<VectorStrokeDash>,
) -> Option<PdfPagePathObject<'a>> {
    let w = base.width.max(1.0);
    let h = base.height.max(1.0);
    let sw = if stroke.is_some() {
        Some(PdfPoints::new((stroke_width.max(0.5)) as f32))
    } else {
        None
    };

    let move_to_vis = |lx: f64, ly: f64| to_pdf_pt_rot(base.x + lx, base.y + ly, base, pm);

    let (sx, sy) = match shape_type {
        VectorShapeType::Rect => {
            let r = border_radius.max(0.0).min(w * 0.5).min(h * 0.5);
            if r > 0.25 {
                move_to_vis(r, 0.0)
            } else {
                move_to_vis(0.0, 0.0)
            }
        }
        VectorShapeType::Ellipse => move_to_vis(w * 0.5, 0.0),
        VectorShapeType::Triangle | VectorShapeType::Diamond => move_to_vis(w * 0.5, 0.0),
        VectorShapeType::Arrow => move_to_vis(0.0, h * 0.3),
    };

    let mut path = PdfPagePathObject::new(out_doc, sx, sy, stroke, sw, fill).ok()?;

    let line_v = |p: &mut PdfPagePathObject<'_>, lx: f64, ly: f64| {
        let (px, py) = move_to_vis(lx, ly);
        let _ = p.line_to(px, py);
    };
    let cubic_v = |p: &mut PdfPagePathObject<'_>,
                   c1x: f64,
                   c1y: f64,
                   c2x: f64,
                   c2y: f64,
                   ex: f64,
                   ey: f64| {
        let (pc1x, pc1y) = move_to_vis(c1x, c1y);
        let (pc2x, pc2y) = move_to_vis(c2x, c2y);
        let (pex, pey) = move_to_vis(ex, ey);
        let _ = p.bezier_to(pex, pey, pc1x, pc1y, pc2x, pc2y);
    };

    match shape_type {
        VectorShapeType::Rect => {
            let r = border_radius.max(0.0).min(w * 0.5).min(h * 0.5);
            if r <= 0.25 {
                line_v(&mut path, w, 0.0);
                line_v(&mut path, w, h);
                line_v(&mut path, 0.0, h);
            } else {
                let k = r * KAPPA;
                line_v(&mut path, w - r, 0.0);
                cubic_v(&mut path, w - r + k, 0.0, w, r - k, w, r);
                line_v(&mut path, w, h - r);
                cubic_v(&mut path, w, h - r + k, w - r + k, h, w - r, h);
                line_v(&mut path, r, h);
                cubic_v(&mut path, r - k, h, 0.0, h - r + k, 0.0, h - r);
                line_v(&mut path, 0.0, r);
                cubic_v(&mut path, 0.0, r - k, r - k, 0.0, r, 0.0);
            }
            let _ = path.close_path();
        }
        VectorShapeType::Ellipse => {
            let rx = w * 0.5;
            let ry = h * 0.5;
            let kx = rx * KAPPA;
            let ky = ry * KAPPA;
            cubic_v(&mut path, rx + kx, 0.0, w, ry - ky, w, ry);
            cubic_v(&mut path, w, ry + ky, rx + kx, h, rx, h);
            cubic_v(&mut path, rx - kx, h, 0.0, ry + ky, 0.0, ry);
            cubic_v(&mut path, 0.0, ry - ky, rx - kx, 0.0, rx, 0.0);
            let _ = path.close_path();
        }
        VectorShapeType::Triangle => {
            line_v(&mut path, w, h);
            line_v(&mut path, 0.0, h);
            let _ = path.close_path();
        }
        VectorShapeType::Diamond => {
            line_v(&mut path, w, h * 0.5);
            line_v(&mut path, w * 0.5, h);
            line_v(&mut path, 0.0, h * 0.5);
            let _ = path.close_path();
        }
        VectorShapeType::Arrow => {
            line_v(&mut path, w * 0.62, h * 0.3);
            line_v(&mut path, w * 0.62, 0.0);
            line_v(&mut path, w, h * 0.5);
            line_v(&mut path, w * 0.62, h);
            line_v(&mut path, w * 0.62, h * 0.7);
            line_v(&mut path, 0.0, h * 0.7);
            let _ = path.close_path();
        }
    }

    let _ = path.set_fill_and_stroke_mode(
        if fill.is_some() {
            PdfPathFillMode::Winding
        } else {
            PdfPathFillMode::None
        },
        stroke.is_some(),
    );
    let _ = path.set_line_join(PdfPageObjectLineJoin::Round);
    let _ = path.set_line_cap(PdfPageObjectLineCap::Round);
    apply_dash(&mut path, dash, stroke_width);
    Some(path)
}

fn build_points_path<'a>(
    out_doc: &'a PdfDocument<'_>,
    base: &BaseElement,
    pm: &PageMeta,
    points: &[NormalizedPoint],
    closed: bool,
    smooth: bool,
    fill: Option<PdfColor>,
    stroke: Option<PdfColor>,
    stroke_width: f64,
    dash: Option<VectorStrokeDash>,
) -> Option<PdfPagePathObject<'a>> {
    if points.is_empty() {
        return None;
    }
    let w = base.width.max(1.0);
    let h = base.height.max(1.0);
    let abs: Vec<(f64, f64)> = points.iter().map(|p| (base.x + p.x * w, base.y + p.y * h)).collect();
    let sw = if stroke.is_some() {
        Some(PdfPoints::new((stroke_width.max(0.5)) as f32))
    } else {
        None
    };

    let n = abs.len();
    let is_smooth = |idx: usize| points[idx].smooth.unwrap_or(smooth);
    let has_any_smooth = if n < 3 {
        false
    } else if closed {
        (0..n).any(is_smooth)
    } else {
        (1..(n - 1)).any(is_smooth)
    };
    let pts_close = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs() < 1e-4 && (a.1 - b.1).abs() < 1e-4;
    let quad_to = |path: &mut PdfPagePathObject<'a>, start: (f64, f64), ctrl: (f64, f64), end: (f64, f64)| {
        let c1 = (start.0 + (2.0 / 3.0) * (ctrl.0 - start.0), start.1 + (2.0 / 3.0) * (ctrl.1 - start.1));
        let c2 = (end.0 + (2.0 / 3.0) * (ctrl.0 - end.0), end.1 + (2.0 / 3.0) * (ctrl.1 - end.1));
        let (pc1x, pc1y) = to_pdf_pt_rot(c1.0, c1.1, base, pm);
        let (pc2x, pc2y) = to_pdf_pt_rot(c2.0, c2.1, base, pm);
        let (pex, pey) = to_pdf_pt_rot(end.0, end.1, base, pm);
        let _ = path.bezier_to(pex, pey, pc1x, pc1y, pc2x, pc2y);
    };

    let initial_pt = if has_any_smooth && closed && is_smooth(0) {
        let prev = abs[n - 1];
        ((prev.0 + abs[0].0) / 2.0, (prev.1 + abs[0].1) / 2.0)
    } else {
        abs[0]
    };

    let (sx, sy) = to_pdf_pt_rot(initial_pt.0, initial_pt.1, base, pm);
    let mut path = PdfPagePathObject::new(out_doc, sx, sy, stroke, sw, if closed { fill } else { None }).ok()?;

    if n == 1 {
        let (ex, ey) = to_pdf_pt_rot(abs[0].0 + 0.5, abs[0].1 + 0.5, base, pm);
        let _ = path.line_to(ex, ey);
    } else if !has_any_smooth {
        for &(vx, vy) in abs.iter().skip(1) {
            let (px, py) = to_pdf_pt_rot(vx, vy, base, pm);
            let _ = path.line_to(px, py);
        }
    } else if !closed {
        let mut cursor = abs[0];
        let first_smooth = is_smooth(0);
        for i in 1..(n - 1) {
            if is_smooth(i) {
                let enter = if i == 1 && first_smooth {
                    abs[0]
                } else {
                    ((abs[i - 1].0 + abs[i].0) / 2.0, (abs[i - 1].1 + abs[i].1) / 2.0)
                };
                let exit = ((abs[i].0 + abs[i + 1].0) / 2.0, (abs[i].1 + abs[i + 1].1) / 2.0);
                if !pts_close(cursor, enter) {
                    let (px, py) = to_pdf_pt_rot(enter.0, enter.1, base, pm);
                    let _ = path.line_to(px, py);
                    cursor = enter;
                }
                quad_to(&mut path, cursor, abs[i], exit);
                cursor = exit;
            } else {
                if !pts_close(cursor, abs[i]) {
                    let (px, py) = to_pdf_pt_rot(abs[i].0, abs[i].1, base, pm);
                    let _ = path.line_to(px, py);
                }
                cursor = abs[i];
            }
        }
        let last = abs[n - 1];
        if !pts_close(cursor, last) {
            let (px, py) = to_pdf_pt_rot(last.0, last.1, base, pm);
            let _ = path.line_to(px, py);
        }
    } else {
        let mut enter = Vec::with_capacity(n);
        let mut exit = Vec::with_capacity(n);
        let mut smooth_flags = Vec::with_capacity(n);
        for i in 0..n {
            let prev = abs[(i + n - 1) % n];
            let curr = abs[i];
            let next = abs[(i + 1) % n];
            let sm = is_smooth(i);
            smooth_flags.push(sm);
            if sm {
                enter.push(((prev.0 + curr.0) / 2.0, (prev.1 + curr.1) / 2.0));
                exit.push(((curr.0 + next.0) / 2.0, (curr.1 + next.1) / 2.0));
            } else {
                enter.push(curr);
                exit.push(curr);
            }
        }
        let mut cursor = enter[0];
        for i in 0..n {
            if smooth_flags[i] {
                if !pts_close(cursor, enter[i]) {
                    let (px, py) = to_pdf_pt_rot(enter[i].0, enter[i].1, base, pm);
                    let _ = path.line_to(px, py);
                    cursor = enter[i];
                }
                quad_to(&mut path, cursor, abs[i], exit[i]);
                cursor = exit[i];
            } else {
                if !pts_close(cursor, abs[i]) {
                    let (px, py) = to_pdf_pt_rot(abs[i].0, abs[i].1, base, pm);
                    let _ = path.line_to(px, py);
                }
                cursor = abs[i];
            }
            let next_i = (i + 1) % n;
            if next_i != 0 && !pts_close(cursor, enter[next_i]) {
                let (px, py) = to_pdf_pt_rot(enter[next_i].0, enter[next_i].1, base, pm);
                let _ = path.line_to(px, py);
                cursor = enter[next_i];
            }
        }
        if !pts_close(cursor, enter[0]) {
            let (px, py) = to_pdf_pt_rot(enter[0].0, enter[0].1, base, pm);
            let _ = path.line_to(px, py);
        }
    }

    if closed {
        let _ = path.close_path();
    }
    let _ = path.set_fill_and_stroke_mode(
        if closed && fill.is_some() {
            PdfPathFillMode::Winding
        } else {
            PdfPathFillMode::None
        },
        stroke.is_some(),
    );
    let _ = path.set_line_join(PdfPageObjectLineJoin::Round);
    let _ = path.set_line_cap(PdfPageObjectLineCap::Round);
    apply_dash(&mut path, dash, stroke_width);
    Some(path)
}

#[derive(Debug)]
enum SvgTok {
    Cmd(char),
    Num(f64),
}

fn tokenize_svg_d(d: &str) -> Vec<SvgTok> {
    let mut out = Vec::new();
    let bytes = d.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_whitespace() || b == b',' {
            i += 1;
            continue;
        }
        if b.is_ascii_alphabetic() {
            out.push(SvgTok::Cmd(b as char));
            i += 1;
            continue;
        }
        let start = i;
        if b == b'-' || b == b'+' {
            i += 1;
        }
        let mut seen_dot = false;
        let mut seen_exp = false;
        while i < bytes.len() {
            let c = bytes[i];
            if c.is_ascii_digit() {
                i += 1;
            } else if c == b'.' && !seen_dot && !seen_exp {
                seen_dot = true;
                i += 1;
            } else if (c == b'e' || c == b'E') && !seen_exp {
                seen_exp = true;
                i += 1;
                if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
                    i += 1;
                }
            } else {
                break;
            }
        }
        if let Ok(n) = d[start..i].parse::<f64>() {
            out.push(SvgTok::Num(n));
        } else if i == start {
            i += 1;
        }
    }
    out
}

fn build_svg_d_path<'a>(
    out_doc: &'a PdfDocument<'_>,
    base: &BaseElement,
    pm: &PageMeta,
    d: &str,
    vb_w: f64,
    vb_h: f64,
    fill: Option<PdfColor>,
    stroke: Option<PdfColor>,
    stroke_width: f64,
) -> Option<PdfPagePathObject<'a>> {
    let toks = tokenize_svg_d(d);
    if toks.is_empty() {
        return None;
    }
    let sx_scale = base.width.max(1.0) / vb_w.max(1.0);
    let sy_scale = base.height.max(1.0) / vb_h.max(1.0);
    let map_vis = |ux: f64, uy: f64| -> (PdfPoints, PdfPoints) {
        to_pdf_pt_rot(base.x + ux * sx_scale, base.y + uy * sy_scale, base, pm)
    };

    let (init_x, init_y) = map_vis(0.0, 0.0);
    let sw = if stroke.is_some() {
        Some(PdfPoints::new((stroke_width.max(0.5)) as f32))
    } else {
        None
    };
    let mut path = PdfPagePathObject::new(out_doc, init_x, init_y, stroke, sw, fill).ok()?;

    let mut idx = 0usize;
    let mut cmd = '\0';
    let mut cur_x = 0.0_f64;
    let mut cur_y = 0.0_f64;
    let mut sub_x = 0.0_f64;
    let mut sub_y = 0.0_f64;
    let mut has_segments = false;

    let read_num = |toks: &[SvgTok], pos: &mut usize| -> Option<f64> {
        if let Some(SvgTok::Num(v)) = toks.get(*pos) {
            *pos += 1;
            Some(*v)
        } else {
            None
        }
    };

    while idx < toks.len() {
        match &toks[idx] {
            SvgTok::Cmd(c) => {
                cmd = *c;
                idx += 1;
                if cmd == 'Z' || cmd == 'z' {
                    let _ = path.close_path();
                    cur_x = sub_x;
                    cur_y = sub_y;
                }
            }
            SvgTok::Num(_) => {
                match cmd {
                    'M' | 'm' => {
                        let (Some(x), Some(y)) = (read_num(&toks, &mut idx), read_num(&toks, &mut idx)) else { break };
                        let (nx, ny) = if cmd == 'm' { (cur_x + x, cur_y + y) } else { (x, y) };
                        let (px, py) = map_vis(nx, ny);
                        let _ = path.move_to(px, py);
                        cur_x = nx;
                        cur_y = ny;
                        sub_x = nx;
                        sub_y = ny;
                        cmd = if cmd == 'm' { 'l' } else { 'L' };
                    }
                    'L' | 'l' => {
                        let (Some(x), Some(y)) = (read_num(&toks, &mut idx), read_num(&toks, &mut idx)) else { break };
                        let (nx, ny) = if cmd == 'l' { (cur_x + x, cur_y + y) } else { (x, y) };
                        let (px, py) = map_vis(nx, ny);
                        let _ = path.line_to(px, py);
                        cur_x = nx;
                        cur_y = ny;
                        has_segments = true;
                    }
                    'H' | 'h' => {
                        let Some(x) = read_num(&toks, &mut idx) else { break };
                        let nx = if cmd == 'h' { cur_x + x } else { x };
                        let (px, py) = map_vis(nx, cur_y);
                        let _ = path.line_to(px, py);
                        cur_x = nx;
                        has_segments = true;
                    }
                    'V' | 'v' => {
                        let Some(y) = read_num(&toks, &mut idx) else { break };
                        let ny = if cmd == 'v' { cur_y + y } else { y };
                        let (px, py) = map_vis(cur_x, ny);
                        let _ = path.line_to(px, py);
                        cur_y = ny;
                        has_segments = true;
                    }
                    'C' | 'c' => {
                        let (Some(x1), Some(y1), Some(x2), Some(y2), Some(x), Some(y)) = (
                            read_num(&toks, &mut idx),
                            read_num(&toks, &mut idx),
                            read_num(&toks, &mut idx),
                            read_num(&toks, &mut idx),
                            read_num(&toks, &mut idx),
                            read_num(&toks, &mut idx),
                        ) else { break };
                        let rel = cmd == 'c';
                        let (ax1, ay1) = if rel { (cur_x + x1, cur_y + y1) } else { (x1, y1) };
                        let (ax2, ay2) = if rel { (cur_x + x2, cur_y + y2) } else { (x2, y2) };
                        let (ax, ay) = if rel { (cur_x + x, cur_y + y) } else { (x, y) };
                        let (p1x, p1y) = map_vis(ax1, ay1);
                        let (p2x, p2y) = map_vis(ax2, ay2);
                        let (px, py) = map_vis(ax, ay);
                        let _ = path.bezier_to(px, py, p1x, p1y, p2x, p2y);
                        cur_x = ax;
                        cur_y = ay;
                        has_segments = true;
                    }
                    'Q' | 'q' => {
                        let (Some(qx), Some(qy), Some(x), Some(y)) = (
                            read_num(&toks, &mut idx),
                            read_num(&toks, &mut idx),
                            read_num(&toks, &mut idx),
                            read_num(&toks, &mut idx),
                        ) else { break };
                        let rel = cmd == 'q';
                        let (aqx, aqy) = if rel { (cur_x + qx, cur_y + qy) } else { (qx, qy) };
                        let (ax, ay) = if rel { (cur_x + x, cur_y + y) } else { (x, y) };
                        let c1x = cur_x + (2.0 / 3.0) * (aqx - cur_x);
                        let c1y = cur_y + (2.0 / 3.0) * (aqy - cur_y);
                        let c2x = ax + (2.0 / 3.0) * (aqx - ax);
                        let c2y = ay + (2.0 / 3.0) * (aqy - ay);
                        let (p1x, p1y) = map_vis(c1x, c1y);
                        let (p2x, p2y) = map_vis(c2x, c2y);
                        let (px, py) = map_vis(ax, ay);
                        let _ = path.bezier_to(px, py, p1x, p1y, p2x, p2y);
                        cur_x = ax;
                        cur_y = ay;
                        has_segments = true;
                    }
                    _ => {
                        idx += 1;
                    }
                }
            }
        }
    }

    if !has_segments {
        return None;
    }
    let _ = path.set_fill_and_stroke_mode(
        if fill.is_some() {
            PdfPathFillMode::EvenOdd
        } else {
            PdfPathFillMode::None
        },
        stroke.is_some(),
    );
    let _ = path.set_line_join(PdfPageObjectLineJoin::Round);
    let _ = path.set_line_cap(PdfPageObjectLineCap::Round);
    Some(path)
}

struct TextRenderParams<'a> {
    text: &'a str,
    runs: Option<&'a [TextRun]>,
    font_family: &'a str,
    embedded_font_id: Option<&'a str>,
    font_size: f64,
    color: &'a str,
    bg_color: Option<&'a str>,
    bold: bool,
    italic: bool,
    underline: bool,
    strikethrough: bool,
    script_mode: TextScriptMode,
    align: TextAlign,
    line_height: f64,
    horizontal_scale: Option<f64>,
    letter_spacing: Option<f64>,
}

fn draw_text_decoration_line<'a>(
    out_doc: &'a PdfDocument<'_>,
    out_page: &mut PdfPage<'a>,
    base: &BaseElement,
    pm: &PageMeta,
    x0: f64,
    x1: f64,
    vis_y: f64,
    col: PdfColor,
    stroke_w: f64,
    behind: bool,
    bg_cursor: &mut usize,
) {
    if x1 - x0 < 1.0 {
        return;
    }
    let (p0x, p0y) = to_pdf_pt_rot(x0, vis_y, base, pm);
    let (p1x, p1y) = to_pdf_pt_rot(x1, vis_y, base, pm);
    if let Ok(mut p) = PdfPagePathObject::new(
        out_doc,
        p0x,
        p0y,
        Some(col),
        Some(PdfPoints::new(stroke_w.max(0.5) as f32)),
        None,
    ) {
        let _ = p.line_to(p1x, p1y);
        let _ = p.set_fill_and_stroke_mode(PdfPathFillMode::None, true);
        attach_object(out_page, PdfPageObject::Path(p), behind, bg_cursor);
    }
}

fn render_text_block<'a>(
    out_doc: &'a PdfDocument<'_>,
    out_page: &mut PdfPage<'a>,
    fonts: &LoadedFonts<'_>,
    base: &BaseElement,
    pm: &PageMeta,
    params: TextRenderParams<'_>,
    behind: bool,
    bg_cursor: &mut usize,
) {
    let alpha = opacity_alpha(base.opacity);
    if let Some(bg_hex) = params.bg_color {
        if let Some(fill) = parse_hex_color(bg_hex, alpha) {
            if let Some(rect_obj) = build_shape_path(
                out_doc,
                base,
                pm,
                VectorShapeType::Rect,
                0.0,
                Some(fill),
                None,
                0.0,
                None,
            ) {
                attach_object(out_page, PdfPageObject::Path(rect_obj), behind, bg_cursor);
            }
        }
    }

    let fs = params.font_size.clamp(4.0, 144.0);
    let lh_ratio = if params.line_height > 0.5 { params.line_height } else { 1.25 };
    let line_step = fs * lh_ratio;
    let h_scale = params.horizontal_scale.unwrap_or(1.0).clamp(0.5, 2.0);
    let l_spacing_pt = params.letter_spacing.unwrap_or(0.0) * fs;

    let effective_runs: Vec<TextRun> = if let Some(r) = params.runs {
        if r.is_empty() {
            vec![TextRun {
                text: params.text.to_string(),
                bold: Some(params.bold),
                italic: Some(params.italic),
                underline: if params.underline { Some(true) } else { None },
                strikethrough: if params.strikethrough { Some(true) } else { None },
                script: Some(params.script_mode),
            }]
        } else {
            r.to_vec()
        }
    } else {
        vec![TextRun {
            text: params.text.to_string(),
            bold: Some(params.bold),
            italic: Some(params.italic),
            underline: if params.underline { Some(true) } else { None },
            strikethrough: if params.strikethrough { Some(true) } else { None },
            script: Some(params.script_mode),
        }]
    };

    let measure_piece = |piece: &str, p_bold: bool, p_italic: bool, p_script: TextScriptMode| -> f64 {
        let eff_script = if p_script != TextScriptMode::Normal { p_script } else { params.script_mode };
        let piece_fs = if eff_script != TextScriptMode::Normal { fs * 0.66 } else { fs };
        let (_, bytes_opt) = fonts.resolve(params.font_family, params.embedded_font_id, p_bold, p_italic, piece);
        let base_w = bytes_opt
            .and_then(|b| measure_ttf_text_width(b, piece, piece_fs))
            .unwrap_or_else(|| piece.chars().count() as f64 * piece_fs * 0.55);
        let spacing_w = if piece.chars().count() > 1 {
            (piece.chars().count() - 1) as f64 * l_spacing_pt
        } else {
            0.0
        };
        (base_w + spacing_w).max(0.0) * h_scale
    };

    let box_w = base.width.max(12.0);
    let wrapped = build_wrapped_rich_lines(
        &effective_runs,
        box_w,
        |p, b, i, s| measure_piece(p, b, i, s),
        params.bold,
        params.italic,
        Some(BuildWrappedRichLinesOptions::default()),
    );

    let fill_col = parse_hex_color(params.color, alpha).unwrap_or(PdfColor::new(15, 23, 42, alpha));
    let cx = base.x + base.width * 0.5;
    let cy = base.y + base.height * 0.5;

    for (line_idx, wline) in wrapped.iter().enumerate() {
        if wline.pieces.is_empty() {
            continue;
        }
        let justify_extra = if params.align == TextAlign::Justify
            && !wline.ends_paragraph
            && wline.space_count > 0
            && wline.natural_width < box_w * 0.995
        {
            ((box_w - wline.natural_width) / wline.space_count as f64).clamp(0.0, fs * 2.2)
        } else {
            0.0
        };
        let x_start = match params.align {
            TextAlign::Center => ((box_w - wline.natural_width) * 0.5).max(0.0),
            TextAlign::Right => (box_w - wline.natural_width).max(0.0),
            TextAlign::Left | TextAlign::Justify => 0.0,
        };

        let mut cur_x = base.x + x_start;
        let baseline_vis_y = base.y + fs * 0.88 + (line_idx as f64) * line_step;

        for piece in &wline.pieces {
            let pw = measure_piece(&piece.text, piece.bold, piece.italic, piece.script);
            if piece.is_space {
                if params.underline || piece.underline {
                    let y_ul = baseline_vis_y + fs * 0.14;
                    let extra = justify_extra * piece.text.chars().count() as f64;
                    draw_text_decoration_line(out_doc, out_page, base, pm, cur_x, cur_x + pw + extra, y_ul, fill_col, (fs * 0.06).max(0.5), behind, bg_cursor);
                }
                cur_x += pw + justify_extra * piece.text.chars().count() as f64;
                continue;
            }

            let eff_script = if piece.script != TextScriptMode::Normal { piece.script } else { params.script_mode };
            let (piece_fs, y_shift) = match eff_script {
                TextScriptMode::Super => (fs * 0.66, -fs * 0.34),
                TextScriptMode::Sub => (fs * 0.66, fs * 0.22),
                TextScriptMode::Normal => (fs, 0.0),
            };
            let (font_token, _) = fonts.resolve(
                params.font_family,
                params.embedded_font_id,
                piece.bold,
                piece.italic,
                &piece.text,
            );
            let py_vis = baseline_vis_y + y_shift;
            let (r_vx, r_vy) = rotate_visual_pt(cur_x, py_vis, cx, cy, base.rotation);
            let (pdf_x, pdf_y) = to_pdf_pt(r_vx, r_vy, pm);

            if let Ok(mut txt_obj) = PdfPageTextObject::new(out_doc, &piece.text, font_token, PdfPoints::new(piece_fs as f32)) {
                let _ = txt_obj.set_fill_color(fill_col);
                if (h_scale - 1.0).abs() > 0.02 {
                    let _ = txt_obj.scale(h_scale as f32, 1.0);
                }
                let net_rot = base.rotation - (pm.intrinsic_rotation as f64);
                if net_rot.abs() > 0.01 {
                    let _ = txt_obj.rotate_clockwise_degrees(net_rot as f32);
                }
                let _ = txt_obj.translate(pdf_x, pdf_y);
                attach_object(out_page, PdfPageObject::Text(txt_obj), behind, bg_cursor);
            }

            if params.underline || piece.underline {
                draw_text_decoration_line(
                    out_doc,
                    out_page,
                    base,
                    pm,
                    cur_x,
                    cur_x + pw,
                    py_vis + piece_fs * 0.14,
                    fill_col,
                    (piece_fs * 0.06).max(0.5),
                    behind,
                    bg_cursor,
                );
            }
            if params.strikethrough || piece.strikethrough {
                draw_text_decoration_line(
                    out_doc,
                    out_page,
                    base,
                    pm,
                    cur_x,
                    cur_x + pw,
                    py_vis - piece_fs * 0.30,
                    fill_col,
                    (piece_fs * 0.06).max(0.5),
                    behind,
                    bg_cursor,
                );
            }

            cur_x += pw;
        }
    }
}

/// Draws editor-positioned text lines exactly where the editor placed them (no re-flow), so the
/// exported page matches the on-screen editor glyph for glyph. Segments flagged `fallback` hold
/// characters missing from the embedded subset font and use the fallback family instead.
#[allow(clippy::too_many_arguments)]
fn render_positioned_text_lines<'a>(
    out_doc: &'a PdfDocument<'_>,
    out_page: &mut PdfPage<'a>,
    fonts: &LoadedFonts<'_>,
    base: &BaseElement,
    pm: &PageMeta,
    font_family: &str,
    embedded_font_id: Option<&str>,
    font_size: f64,
    color: &str,
    horizontal_scale: Option<f64>,
    lines: &[PositionedTextLine],
    behind: bool,
    bg_cursor: &mut usize,
) {
    let alpha = opacity_alpha(base.opacity);
    let fs = font_size.clamp(1.0, 400.0);
    let h_scale = horizontal_scale.unwrap_or(1.0).clamp(0.3, 3.0);
    let fill_col = parse_hex_color(color, alpha).unwrap_or(PdfColor::new(15, 23, 42, alpha));
    for line in lines {
        for seg in &line.segments {
            if seg.text.trim().is_empty() {
                continue;
            }
            let (font_token, _) = if seg.fallback {
                fonts.resolve(font_family, None, seg.bold, seg.italic, &seg.text)
            } else {
                // The editor already split the text where the embedded font lacks glyphs.
                fonts.resolve(font_family, embedded_font_id, seg.bold, seg.italic, "")
            };
            let seg_fs = if seg.size > 0.0 { seg.size } else { fs };
            let seg_baseline = line.baseline + seg.rise;
            let (pdf_x, pdf_y) = to_pdf_pt(seg.x, seg_baseline, pm);
            if let Ok(mut txt_obj) =
                PdfPageTextObject::new(out_doc, &seg.text, font_token, PdfPoints::new(seg_fs as f32))
            {
                let _ = txt_obj.set_fill_color(fill_col);
                if (h_scale - 1.0).abs() > 0.005 {
                    let _ = txt_obj.scale(h_scale as f32, 1.0);
                }
                let page_rot = -(pm.intrinsic_rotation as f64);
                if page_rot.abs() > 0.01 {
                    let _ = txt_obj.rotate_clockwise_degrees(page_rot as f32);
                }
                let _ = txt_obj.translate(pdf_x, pdf_y);
                attach_object(out_page, PdfPageObject::Text(txt_obj), behind, bg_cursor);
            }
            let thickness = (seg_fs * 0.06).max(0.5);
            if seg.underline && seg.width > 0.0 {
                draw_text_decoration_line(
                    out_doc, out_page, base, pm, seg.x, seg.x + seg.width,
                    seg_baseline + seg_fs * 0.14, fill_col, thickness, behind, bg_cursor,
                );
            }
            if seg.strikethrough && seg.width > 0.0 {
                draw_text_decoration_line(
                    out_doc, out_page, base, pm, seg.x, seg.x + seg.width,
                    seg_baseline - seg_fs * 0.30, fill_col, thickness, behind, bg_cursor,
                );
            }
        }
    }
}

fn attach_rgba_image<'a>(
    out_doc: &'a PdfDocument<'_>,
    out_page: &mut PdfPage<'a>,
    img: &PreDecodedImage,
    base: &BaseElement,
    pm: &PageMeta,
    flip_x: bool,
    flip_y: bool,
    behind: bool,
    bg_cursor: &mut usize,
) {
    let w_px = img.width as usize;
    let h_px = img.height as usize;
    if w_px == 0 || h_px == 0 || img.rgba.len() < w_px * h_px * 4 {
        return;
    }
    let alpha_scale = base.opacity.clamp(0.0, 1.0);
    let mut bgra = vec![0u8; w_px * h_px * 4];
    for sy in 0..h_px {
        let dy = if flip_y { h_px - 1 - sy } else { sy };
        for sx in 0..w_px {
            let dx = if flip_x { w_px - 1 - sx } else { sx };
            let s_idx = (sy * w_px + sx) * 4;
            let d_idx = (dy * w_px + dx) * 4;
            let r = img.rgba[s_idx];
            let g = img.rgba[s_idx + 1];
            let b = img.rgba[s_idx + 2];
            let a = ((img.rgba[s_idx + 3] as f64) * alpha_scale).round().clamp(0.0, 255.0) as u8;
            bgra[d_idx] = b;
            bgra[d_idx + 1] = g;
            bgra[d_idx + 2] = r;
            bgra[d_idx + 3] = a;
        }
    }

    let Ok(bitmap) = PdfBitmap::from_bytes(img.width as i32, img.height as i32, PdfBitmapFormat::BGRA, &mut bgra) else {
        return;
    };
    let Ok(mut img_obj) = PdfPageImageObject::new(out_doc) else {
        return;
    };
    if img_obj.set_bitmap(&bitmap).is_err() {
        return;
    }
    let bw = base.width.max(4.0);
    let bh = base.height.max(4.0);
    let _ = img_obj.scale(bw as f32, bh as f32);
    let cx_vis = base.x + bw * 0.5;
    let cy_vis = base.y + bh * 0.5;
    let (cx_pdf, cy_pdf) = to_pdf_pt(cx_vis, cy_vis, pm);
    let _ = img_obj.translate(PdfPoints::new(-(bw as f32) * 0.5), PdfPoints::new(-(bh as f32) * 0.5));
    let net_rot = base.rotation - (pm.intrinsic_rotation as f64);
    if net_rot.abs() > 0.01 {
        let _ = img_obj.rotate_clockwise_degrees(net_rot as f32);
    }
    let _ = img_obj.translate(cx_pdf, cy_pdf);
    attach_object(out_page, PdfPageObject::Image(img_obj), behind, bg_cursor);
}

fn decode_base64_str(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity((input.len() * 3) / 4);
    let mut buf = 0u32;
    let mut bits = 0u8;
    for b in input.bytes() {
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' | b' ' | b'\t' => continue,
            _ => return None,
        };
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1u32 << bits) - 1;
        }
    }
    Some(out)
}

fn attach_jpeg_data_url_if_any<'a>(
    out_doc: &'a PdfDocument<'_>,
    out_page: &mut PdfPage<'a>,
    data_url: &str,
    base: &BaseElement,
    pm: &PageMeta,
    behind: bool,
    bg_cursor: &mut usize,
) -> bool {
    let Some(comma) = data_url.find(',') else {
        return false;
    };
    let header = &data_url[..comma];
    if !header.contains("jpeg") && !header.contains("jpg") {
        return false;
    }
    let Some(bytes) = decode_base64_str(&data_url[(comma + 1)..]) else {
        return false;
    };
    let Ok(mut img_obj) = PdfPageImageObject::new_from_jpeg_reader(out_doc, Cursor::new(bytes)) else {
        return false;
    };
    let bw = base.width.max(4.0);
    let bh = base.height.max(4.0);
    let _ = img_obj.scale(bw as f32, bh as f32);
    let (cx_pdf, cy_pdf) = to_pdf_pt(base.x + bw * 0.5, base.y + bh * 0.5, pm);
    let _ = img_obj.translate(PdfPoints::new(-(bw as f32) * 0.5), PdfPoints::new(-(bh as f32) * 0.5));
    let net_rot = base.rotation - (pm.intrinsic_rotation as f64);
    if net_rot.abs() > 0.01 {
        let _ = img_obj.rotate_clockwise_degrees(net_rot as f32);
    }
    let _ = img_obj.translate(cx_pdf, cy_pdf);
    attach_object(out_page, PdfPageObject::Image(img_obj), behind, bg_cursor);
    true
}

pub(crate) fn compile_native_pdf_impl(
    pdfium: &'static Pdfium,
    docs: &HashMap<String, StoredDoc>,
    pages: &[PageMeta],
    elements: &[CanvasElement],
    redactions: &[RedactionRect],
    options: CompilePdfOptions<'_>,
) -> Result<Vec<u8>, PdfError> {
    let mut out_doc = pdfium
        .create_new_pdf()
        .map_err(|e| PdfError::Backend(format!("failed creating output PDF: {e}")))?;

    let font_needs = FontNeeds::scan(pages, elements, options.page_numbering);
    let fonts = LoadedFonts::load(&mut out_doc, options.fonts, options.extra_named_ttf, &font_needs);

    let mut clean_sources: HashMap<String, Vec<u8>> = HashMap::new();
    for (doc_id, stored) in docs {
        // Skip documents no output page references (clean-preview scratch docs, closed merges).
        if !pages.iter().any(|p| p.source_doc_id == *doc_id) {
            continue;
        }
        let mut doc_redactions: Vec<RedactionRect> = redactions
            .iter()
            .filter(|r| {
                pages
                    .iter()
                    .any(|p| p.source_doc_id == *doc_id && p.source_page_index == r.page_index)
            })
            .copied()
            .collect();

        let mut text_only_rects = Vec::new();
        let mut image_only_rects = Vec::new();
        let mut shape_rects = Vec::new();
        let mut image_transforms = Vec::new();
        let mut shape_transforms = Vec::new();

        for pm in pages.iter().filter(|p| p.source_doc_id == *doc_id) {
            for el in elements.iter().filter(|e| e.page_id() == pm.id) {
                let to_rr = |sr: RectBox| RedactionRect {
                    page_index: pm.source_page_index,
                    x: sr.x,
                    y: sr.y,
                    width: sr.width,
                    height: sr.height,
                };
                if let Some((kind, t)) = element_in_place_transform(el, pm.source_page_index) {
                    match kind {
                        InPlaceKind::Image => image_transforms.push(t),
                        InPlaceKind::Shape => shape_transforms.push(t),
                    }
                    continue;
                }
                match el {
                    CanvasElement::Highlight { shape, .. } if shape == "redact" => {
                        doc_redactions.push(to_rr(el.strip_rect()));
                    }
                    CanvasElement::TextEdit { .. } => {
                        text_only_rects.extend(element_text_strip_rects(el).into_iter().map(to_rr));
                    }
                    CanvasElement::ImageReplacement { .. } => image_only_rects.push(to_rr(el.strip_rect())),
                    CanvasElement::ShapeReplacement { .. } => shape_rects.push(to_rr(el.strip_rect())),
                    _ => {}
                }
            }
        }

        let mut working_bytes = stored.raw_bytes.clone();
        if !text_only_rects.is_empty()
            || !image_only_rects.is_empty()
            || !shape_rects.is_empty()
            || !image_transforms.is_empty()
            || !shape_transforms.is_empty()
        {
            let fallback_images = image_only_rects.clone();
            let fallback_text = text_only_rects.clone();
            if let Ok((stripped, _)) = redact_pdf_bytes_with_lopdf(
                &working_bytes,
                &[],
                RedactionOptions {
                    draw_redaction_boxes: false,
                    text_only_rects,
                    image_only_rects,
                    shape_rects,
                    image_transforms,
                    shape_transforms,
                },
            ) {
                working_bytes = stripped;
            }
            if !fallback_images.is_empty() || !fallback_text.is_empty() {
                if let Ok(cleaned) = strip_leftover_objects_with_pdfium(
                    pdfium,
                    working_bytes.clone(),
                    stored.password.as_deref(),
                    &fallback_images,
                    &fallback_text,
                ) {
                    working_bytes = cleaned;
                }
            }
        }
        if !doc_redactions.is_empty() {
            let (clean_bytes, _) = redact_document_verified(
                pdfium,
                working_bytes,
                stored.password.as_deref(),
                &doc_redactions,
            )?;
            working_bytes = clean_bytes;
        }
        clean_sources.insert(doc_id.clone(), working_bytes);
    }

    let mut loaded_sources: HashMap<String, PdfDocument<'_>> = HashMap::new();
    for (doc_id, bytes) in clean_sources {
        let pw = docs.get(&doc_id).and_then(|s| s.password.as_deref());
        if let Ok(d) = pdfium.load_pdf_from_byte_vec(bytes, pw) {
            loaded_sources.insert(doc_id, d);
        }
    }

    let empty_img_map = HashMap::new();
    let img_map = options.embedded_images.unwrap_or(&empty_img_map);
    let mut behind_pages: Vec<BehindStreamPage> = Vec::new();

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

        let mut page_elements: Vec<&CanvasElement> = elements
            .iter()
            .filter(|el| el.page_id() == pm.id && !el.is_deleted())
            // In-place edits already live inside the (rewritten) original content stream.
            .filter(|el| element_in_place_transform(el, 0).is_none())
            .collect();
        page_elements.sort_by_key(|el| (el.effective_layer_tier(), el.base().z_index));

        out_page.set_content_regeneration_strategy(PdfPageContentRegenerationStrategy::Manual);
        let page_has_behind = page_elements.iter().any(|el| el.effective_layer_tier() <= 1);
        let mut bg_cursor = 0usize;
        let mut behind_objects_added = 0usize;

        for pass_behind in [true, false] {
            if pass_behind && !page_has_behind {
                continue;
            }
            let before_pass = bg_cursor;
            for el in page_elements
                .iter()
                .copied()
                .filter(|el| (el.effective_layer_tier() <= 1) == pass_behind)
            {
                let behind = el.effective_layer_tier() <= 1;
                let alpha = opacity_alpha(el.base().opacity);

            match el {
                    CanvasElement::TextEdit {
                        base,
                        layout_lines: Some(lines),
                        font_family,
                        font_size,
                        color,
                        background_color,
                        embedded_font_id,
                        horizontal_scale,
                        ..
                    } => {
                        if let Some(fill) = background_color.as_deref().and_then(|c| parse_hex_color(c, alpha)) {
                            if let Some(rect_obj) = build_shape_path(
                                &out_doc, base, pm, VectorShapeType::Rect, 0.0, Some(fill), None, 0.0, None,
                            ) {
                                attach_object(&mut out_page, PdfPageObject::Path(rect_obj), behind, &mut bg_cursor);
                            }
                        }
                        render_positioned_text_lines(
                            &out_doc,
                            &mut out_page,
                            &fonts,
                            base,
                            pm,
                            font_family,
                            embedded_font_id.as_deref(),
                            *font_size,
                            color,
                            *horizontal_scale,
                            lines,
                            behind,
                            &mut bg_cursor,
                        );
                    }
                    CanvasElement::TextAdd {
                        base,
                        text,
                        runs,
                        font_family,
                        font_size,
                        color,
                        background_color,
                        bold,
                        italic,
                        underline,
                        strikethrough,
                        script_mode,
                        embedded_font_id,
                        align,
                        line_height,
                        horizontal_scale,
                        letter_spacing,
                    }
                    | CanvasElement::TextEdit {
                        base,
                        text,
                        runs,
                        font_family,
                        font_size,
                        color,
                        background_color,
                        bold,
                        italic,
                        underline,
                        strikethrough,
                        script_mode,
                        embedded_font_id,
                        align,
                        line_height,
                        horizontal_scale,
                        letter_spacing,
                        ..
                    } => {
                        render_text_block(
                            &out_doc,
                            &mut out_page,
                            &fonts,
                            base,
                            pm,
                            TextRenderParams {
                                text,
                                runs: runs.as_deref(),
                                font_family,
                                embedded_font_id: embedded_font_id.as_deref(),
                                font_size: *font_size,
                                color,
                                bg_color: background_color.as_deref(),
                                bold: *bold,
                                italic: *italic,
                                underline: underline.unwrap_or(false),
                                strikethrough: strikethrough.unwrap_or(false),
                                script_mode: script_mode.unwrap_or(TextScriptMode::Normal),
                                align: *align,
                                line_height: *line_height,
                                horizontal_scale: *horizontal_scale,
                                letter_spacing: *letter_spacing,
                            },
                            behind,
                            &mut bg_cursor,
                        );
                    }
                    CanvasElement::Highlight {
                        base,
                        fill_color,
                        shape,
                    } => {
                        let col = if shape == "redact" {
                            Some(PdfColor::BLACK)
                        } else {
                            parse_hex_color(fill_color, alpha.clamp(40, 190))
                        };
                        if let Some(col) = col {
                            if let Some(p) = build_shape_path(
                                &out_doc,
                                base,
                                pm,
                                VectorShapeType::Rect,
                                0.0,
                                Some(col),
                                None,
                                0.0,
                                None,
                            ) {
                                attach_object(&mut out_page, PdfPageObject::Path(p), behind, &mut bg_cursor);
                            }
                        }
                    }
                    CanvasElement::VectorShape {
                        base,
                        shape_type,
                        fill_color,
                        stroke_color,
                        stroke_width,
                        border_radius,
                        stroke_dash,
                        ..
                    } => {
                        let fill = parse_hex_color(fill_color, alpha);
                        let stroke = parse_hex_color(stroke_color, alpha);
                        if let Some(p) = build_shape_path(
                            &out_doc,
                            base,
                            pm,
                            *shape_type,
                            border_radius.unwrap_or(0.0),
                            fill,
                            stroke,
                            *stroke_width,
                            *stroke_dash,
                        ) {
                            attach_object(&mut out_page, PdfPageObject::Path(p), behind, &mut bg_cursor);
                        }
                    }
                    CanvasElement::ShapeReplacement {
                        base,
                        fill_color,
                        stroke_color,
                        stroke_width,
                        svg_path,
                        ..
                    } => {
                        let fill = parse_hex_color(fill_color, alpha);
                        let stroke = parse_hex_color(stroke_color, alpha);
                        let obj = if !svg_path.trim().is_empty() {
                            build_svg_d_path(
                                &out_doc,
                                base,
                                pm,
                                svg_path,
                                base.width.max(1.0),
                                base.height.max(1.0),
                                fill,
                                stroke,
                                *stroke_width,
                            )
                        } else {
                            None
                        }
                        .or_else(|| {
                            build_shape_path(
                                &out_doc,
                                base,
                                pm,
                                VectorShapeType::Rect,
                                0.0,
                                fill,
                                stroke,
                                *stroke_width,
                                None,
                            )
                        });
                        if let Some(p) = obj {
                            attach_object(&mut out_page, PdfPageObject::Path(p), behind, &mut bg_cursor);
                        }
                    }
                    CanvasElement::VectorPath {
                        base,
                        points,
                        closed,
                        smooth,
                        fill_color,
                        stroke_color,
                        stroke_width,
                        stroke_dash,
                        ..
                    } => {
                        let fill = parse_hex_color(fill_color, alpha);
                        let stroke = parse_hex_color(stroke_color, alpha);
                        if let Some(p) = build_points_path(
                            &out_doc,
                            base,
                            pm,
                            points,
                            *closed,
                            smooth.unwrap_or(true),
                            fill,
                            stroke,
                            *stroke_width,
                            *stroke_dash,
                        ) {
                            attach_object(&mut out_page, PdfPageObject::Path(p), behind, &mut bg_cursor);
                        }
                    }
                    CanvasElement::Stroke {
                        base,
                        points,
                        color,
                        stroke_width,
                    } => {
                        let stroke = parse_hex_color(color, alpha).or(Some(PdfColor::new(29, 78, 216, alpha)));
                        if let Some(p) = build_points_path(
                            &out_doc,
                            base,
                            pm,
                            points,
                            false,
                            true,
                            None,
                            stroke,
                            *stroke_width,
                            None,
                        ) {
                            attach_object(&mut out_page, PdfPageObject::Path(p), behind, &mut bg_cursor);
                        }
                    }
                    CanvasElement::ImageAdd {
                        base,
                        preview_url,
                        flip_x,
                        flip_y,
                        ..
                    }
                    | CanvasElement::ImageReplacement {
                        base,
                        preview_url,
                        flip_x,
                        flip_y,
                        ..
                    } => {
                        if let Some(img) = img_map.get(&base.id) {
                            attach_rgba_image(
                                &out_doc,
                                &mut out_page,
                                img,
                                base,
                                pm,
                                flip_x.unwrap_or(false),
                                flip_y.unwrap_or(false),
                                behind,
                                &mut bg_cursor,
                            );
                        } else if !preview_url.is_empty() {
                            attach_jpeg_data_url_if_any(
                                &out_doc,
                                &mut out_page,
                                preview_url,
                                base,
                                pm,
                                behind,
                                &mut bg_cursor,
                            );
                        }
                    }
                    CanvasElement::Signature {
                        base,
                        data_url,
                        svg_paths,
                        view_box_width,
                        view_box_height,
                        ..
                    } => {
                        let mut drew_svg = false;
                        if let Some(paths) = svg_paths {
                            let vb_w = view_box_width.unwrap_or(300.0).max(1.0);
                            let vb_h = view_box_height.unwrap_or(180.0).max(1.0);
                            for sp in paths {
                                let fill = sp.fill.as_deref().and_then(|c| parse_hex_color(c, alpha));
                                let stroke = sp.stroke.as_deref().and_then(|c| parse_hex_color(c, alpha));
                                if fill.is_none() && stroke.is_none() {
                                    continue;
                                }
                                if let Some(p) = build_svg_d_path(
                                    &out_doc,
                                    base,
                                    pm,
                                    &sp.d,
                                    vb_w,
                                    vb_h,
                                    fill,
                                    stroke,
                                    sp.stroke_width.unwrap_or(2.0),
                                ) {
                                    attach_object(&mut out_page, PdfPageObject::Path(p), behind, &mut bg_cursor);
                                    drew_svg = true;
                                }
                            }
                        }
                        if !drew_svg {
                            if let Some(img) = img_map.get(&base.id) {
                                attach_rgba_image(
                                    &out_doc,
                                    &mut out_page,
                                    img,
                                    base,
                                    pm,
                                    false,
                                    false,
                                    behind,
                                    &mut bg_cursor,
                                );
                            } else if !data_url.is_empty() {
                                attach_jpeg_data_url_if_any(
                                    &out_doc,
                                    &mut out_page,
                                    data_url,
                                    base,
                                    pm,
                                    behind,
                                    &mut bg_cursor,
                                );
                            }
                        }
                    }
                }
            }
            if pass_behind {
                behind_objects_added = bg_cursor - before_pass;
                if behind_objects_added > 0 {
                    // Flush behind objects into their own content stream before foreground ones.
                    let _ = out_page.regenerate_content();
                }
            }
        }

        if let Some(cfg) = options.page_numbering {
            if let Some(box_layout) = compute_page_number_layout(
                pm.base_width,
                pm.base_height,
                out_idx,
                pages.len(),
                cfg,
            ) {
                let nb = BaseElement {
                    id: format!("pn_{out_idx}"),
                    page_id: pm.id.clone(),
                    x: box_layout.x,
                    y: box_layout.y,
                    width: box_layout.width,
                    height: box_layout.height,
                    rotation: 0.0,
                    opacity: cfg.opacity,
                    z_index: 9999,
                    locked: None,
                    is_background_layer: None,
                    layer_tier: Some(4),
                    group_id: None,
                };
                render_text_block(
                    &out_doc,
                    &mut out_page,
                    &fonts,
                    &nb,
                    pm,
                    TextRenderParams {
                        text: &box_layout.text,
                        runs: None,
                        font_family: &cfg.font_family,
                        embedded_font_id: None,
                        font_size: cfg.font_size,
                        color: &cfg.color,
                        bg_color: None,
                        bold: false,
                        italic: false,
                        underline: false,
                        strikethrough: false,
                        script_mode: TextScriptMode::Normal,
                        align: box_layout.align,
                        line_height: 1.2,
                        horizontal_scale: None,
                        letter_spacing: None,
                    },
                    false,
                    &mut bg_cursor,
                );
            }
        }

        if pm.user_rotation != 0 {
            let cur = intrinsic_rotation_to_angle(Ok(out_page.rotation().unwrap_or(PdfPageRenderRotation::None)));
            out_page.set_rotation(to_pdfium_rotation((cur + pm.user_rotation) % 360));
        }

        let _ = out_page.regenerate_content();
        if behind_objects_added > 0 {
            behind_pages.push(BehindStreamPage {
                page_index: out_idx,
                has_foreground_stream: bg_cursor > behind_objects_added,
            });
        }
    }

    let bytes = out_doc
        .save_to_bytes()
        .map_err(|e| PdfError::Backend(format!("failed saving compiled PDF: {e}")))?;
    Ok(move_behind_streams_to_front(bytes, &behind_pages))
}

#[derive(Debug, Clone, Copy)]
struct BehindStreamPage {
    page_index: usize,
    has_foreground_stream: bool,
}

/// Moves the PDFium-generated behind-content stream of each listed page to the front of the
/// page's `/Contents` array so it paints beneath the untouched original content.
fn move_behind_streams_to_front(pdf: Vec<u8>, pages: &[BehindStreamPage]) -> Vec<u8> {
    use lopdf::{content::Content, Document, Object};

    if pages.is_empty() {
        return pdf;
    }
    let Ok(mut doc) = Document::load_mem(&pdf) else {
        return pdf;
    };
    let page_ids = doc.get_pages();
    let mut changed = false;
    for bp in pages {
        let Some(&page_id) = page_ids.get(&((bp.page_index + 1) as u32)) else {
            continue;
        };
        let contents_obj = match doc.get_object(page_id).and_then(Object::as_dict) {
            Ok(d) => match d.get(b"Contents") {
                Ok(o) => o.clone(),
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        let mut arr = match contents_obj {
            Object::Array(a) => a,
            Object::Reference(r) => match doc.get_object(r) {
                Ok(Object::Array(a)) => a.clone(),
                _ => continue, // single stream: nothing precedes the behind content
            },
            _ => continue,
        };
        let from_end = if bp.has_foreground_stream { 2 } else { 1 };
        if arr.len() <= from_end {
            continue;
        }
        let behind = arr.remove(arr.len() - from_end);
        if let Object::Reference(sid) = behind {
            // PDFium prefixes generated streams with the inverse of the CTM left over by the
            // original content; at the front of the page the CTM is the identity, so drop it.
            if let Ok(Object::Stream(stream)) = doc.get_object(sid) {
                let mut stream = stream.clone();
                if let Ok(raw) = stream.decompressed_content() {
                    if let Ok(mut content) = Content::decode(&raw) {
                        let leading_cm = content.operations.len() > 1
                            && content.operations[0].operator == "q"
                            && content.operations[1].operator == "cm";
                        if leading_cm {
                            content.operations.remove(1);
                            if let Ok(encoded) = content.encode() {
                                stream.set_plain_content(encoded);
                                let _ = stream.compress();
                                doc.objects.insert(sid, Object::Stream(stream));
                            }
                        }
                    }
                }
            }
        }
        arr.insert(0, behind);
        if let Ok(Object::Dictionary(d)) = doc.get_object_mut(page_id) {
            d.set("Contents", Object::Array(arr));
            changed = true;
        }
    }
    if !changed {
        return pdf;
    }
    let mut out = Vec::with_capacity(pdf.len());
    if doc.save_to(&mut out).is_ok() {
        out
    } else {
        pdf
    }
}
