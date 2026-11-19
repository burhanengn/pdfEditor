use std::collections::HashMap;

use gp_engine::EngineSession;
use gp_geom::{
    compute_rotated_resize_rect as geom_compute_rotated_resize_rect,
    compute_snap_position as geom_compute_snap_position,
    flip_svg_path as geom_flip_svg_path,
    get_rotated_bounding_box as geom_get_rotated_bounding_box,
    normalize_absolute_points as geom_normalize_absolute_points,
    path_points_to_svg_path as geom_path_points_to_svg_path,
    point_in_rotated_rect as geom_point_in_rotated_rect,
    scale_svg_path as geom_scale_svg_path,
    shape_to_svg_path as geom_shape_to_svg_path,
    PageOffsetIndex, RotatedResizeParams, ViewportSurfaceMetrics,
};
use gp_model::{
    NormalizedPoint, PageMeta, PageNumberingConfig, Point, RectBox, TextRun, TextScriptMode,
    VectorShapeType,
};
use gp_pdf::{RedactionRect, RedactionReport};
use gp_redact::{
    apply_clip_masks_with_lopdf, create_blank_pdf_with_lopdf, create_reference_pdf_with_lopdf,
    create_sample_pdf_with_lopdf, extract_embedded_fonts_with_lopdf, inspect_pdf_with_lopdf,
    prepare_clean_page_preview_with_lopdf, redact_pdf_bytes_with_lopdf, ClipMaskPatch,
    RedactionOptions,
};
use gp_text::{
    build_detected_text_blocks as text_build_detected_text_blocks,
    build_wrapped_rich_lines as text_build_wrapped_rich_lines,
    compute_page_number_layout as text_compute_page_number_layout,
    ensure_runs_from_element as text_ensure_runs_from_element,
    format_page_number_label as text_format_page_number_label,
    inspect_ttf_font as text_inspect_ttf_font,
    normalize_font_match_key as text_normalize_font_match_key,
    normalize_for_turkish_search as text_normalize_for_turkish_search,
    normalize_text_runs as text_normalize_text_runs,
    normalize_unicode_for_pdf as text_normalize_unicode_for_pdf,
    parse_page_range_expression as text_parse_page_range_expression,
    parse_pdf_font_metadata as text_parse_pdf_font_metadata,
    sanitize_for_winansi as text_sanitize_for_winansi,
    to_roman_numeral as text_to_roman_numeral,
    BuildWrappedRichLinesOptions, RawExtractedLine, TableVectorBarriers,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn to_js_err(err: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&err.to_string())
}

fn serialize_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    value.serialize(&serializer).map_err(to_js_err)
}

#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn compute_rotated_resize_rect(params: JsValue) -> Result<JsValue, JsValue> {
    let parsed: RotatedResizeParams = serde_wasm_bindgen::from_value(params).map_err(to_js_err)?;
    let out = geom_compute_rotated_resize_rect(parsed);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn get_rotated_bounding_box(rect: JsValue, rotation_deg: f64) -> Result<JsValue, JsValue> {
    let parsed: RectBox = serde_wasm_bindgen::from_value(rect).map_err(to_js_err)?;
    let out = geom_get_rotated_bounding_box(parsed, rotation_deg);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn point_in_rotated_rect(
    px: f64,
    py: f64,
    rect: JsValue,
    rotation_deg: f64,
    pad: f64,
) -> Result<bool, JsValue> {
    let parsed: RectBox = serde_wasm_bindgen::from_value(rect).map_err(to_js_err)?;
    Ok(geom_point_in_rotated_rect(px, py, parsed, rotation_deg, pad))
}

#[wasm_bindgen]
pub fn compute_snap_position(
    moving_rect: JsValue,
    page_width: f64,
    page_height: f64,
    siblings: JsValue,
    enabled: bool,
) -> Result<JsValue, JsValue> {
    let moving: RectBox = serde_wasm_bindgen::from_value(moving_rect).map_err(to_js_err)?;
    let sibs: Vec<RectBox> = serde_wasm_bindgen::from_value(siblings).map_err(to_js_err)?;
    let out = geom_compute_snap_position(moving, page_width, page_height, &sibs, enabled);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn build_page_offset_index(
    pages: JsValue,
    zoom: f64,
    metrics: JsValue,
) -> Result<JsValue, JsValue> {
    let parsed_pages: Vec<PageMeta> = serde_wasm_bindgen::from_value(pages).map_err(to_js_err)?;
    let parsed_metrics: ViewportSurfaceMetrics =
        serde_wasm_bindgen::from_value(metrics).map_err(to_js_err)?;
    let out = PageOffsetIndex::build(&parsed_pages, zoom, &parsed_metrics);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn shape_to_svg_path(
    shape_type: JsValue,
    width: f64,
    height: f64,
    border_radius: f64,
) -> Result<String, JsValue> {
    let kind: VectorShapeType = serde_wasm_bindgen::from_value(shape_type).map_err(to_js_err)?;
    Ok(geom_shape_to_svg_path(kind, width, height, border_radius))
}

#[wasm_bindgen]
pub fn path_points_to_svg_path(
    points: JsValue,
    width: f64,
    height: f64,
    closed: bool,
    smooth: bool,
) -> Result<String, JsValue> {
    let pts: Vec<NormalizedPoint> = serde_wasm_bindgen::from_value(points).map_err(to_js_err)?;
    Ok(geom_path_points_to_svg_path(&pts, width, height, closed, smooth))
}

#[wasm_bindgen]
pub fn normalize_absolute_points(abs_points: JsValue) -> Result<JsValue, JsValue> {
    let pts: Vec<Point> = serde_wasm_bindgen::from_value(abs_points).map_err(to_js_err)?;
    let out = geom_normalize_absolute_points(&pts);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn flip_svg_path(
    d: &str,
    width: f64,
    height: f64,
    flip_x: bool,
    flip_y: bool,
    decimals: usize,
) -> String {
    geom_flip_svg_path(d, width, height, flip_x, flip_y, decimals)
}

#[wasm_bindgen]
pub fn scale_svg_path(d: &str, sx: f64, sy: f64, decimals: usize) -> String {
    geom_scale_svg_path(d, sx, sy, decimals)
}

#[wasm_bindgen]
pub fn normalize_unicode_for_pdf(text: &str) -> String {
    text_normalize_unicode_for_pdf(text)
}

#[wasm_bindgen]
pub fn normalize_for_turkish_search(input: &str, fold_diacritics: bool) -> String {
    text_normalize_for_turkish_search(input, fold_diacritics)
}

#[wasm_bindgen]
pub fn sanitize_for_winansi(text: &str) -> String {
    text_sanitize_for_winansi(text)
}

#[wasm_bindgen]
pub fn normalize_font_match_key(raw_name: &str) -> Result<JsValue, JsValue> {
    let out = text_normalize_font_match_key(raw_name);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn parse_pdf_font_metadata(
    raw_name: &str,
    is_serif: bool,
    is_mono: bool,
    is_bold: bool,
    is_italic: bool,
) -> Result<JsValue, JsValue> {
    let out = text_parse_pdf_font_metadata(raw_name, is_serif, is_mono, is_bold, is_italic);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn parse_page_range_expression(input: &str, total_pages: usize) -> Result<JsValue, JsValue> {
    let out = text_parse_page_range_expression(input, total_pages);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn to_roman_numeral(num: usize, upper: bool) -> String {
    text_to_roman_numeral(num, upper)
}

#[wasm_bindgen]
pub fn format_page_number_label(
    page_index_zero_based: usize,
    total_pages: usize,
    config: JsValue,
) -> Result<Option<String>, JsValue> {
    let cfg: PageNumberingConfig = serde_wasm_bindgen::from_value(config).map_err(to_js_err)?;
    Ok(text_format_page_number_label(
        page_index_zero_based,
        total_pages,
        &cfg,
    ))
}

#[wasm_bindgen]
pub fn compute_page_number_layout(
    page_width: f64,
    page_height: f64,
    page_index_zero_based: usize,
    total_pages: usize,
    config: JsValue,
) -> Result<JsValue, JsValue> {
    let cfg: PageNumberingConfig = serde_wasm_bindgen::from_value(config).map_err(to_js_err)?;
    let out = text_compute_page_number_layout(
        page_width,
        page_height,
        page_index_zero_based,
        total_pages,
        &cfg,
    );
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn normalize_text_runs(
    runs: JsValue,
    base_bold: bool,
    base_italic: bool,
) -> Result<JsValue, JsValue> {
    let parsed: Vec<TextRun> = serde_wasm_bindgen::from_value(runs).map_err(to_js_err)?;
    let out = text_normalize_text_runs(&parsed, base_bold, base_italic);
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn ensure_runs_from_element(
    text: &str,
    runs: JsValue,
    base_bold: bool,
    base_italic: bool,
) -> Result<JsValue, JsValue> {
    let parsed: Option<Vec<TextRun>> = serde_wasm_bindgen::from_value(runs).map_err(to_js_err)?;
    let out = text_ensure_runs_from_element(text, parsed.as_deref(), base_bold, base_italic);
    serialize_js(&out)
}

fn script_key(script: TextScriptMode) -> &'static str {
    match script {
        TextScriptMode::Normal => "normal",
        TextScriptMode::Super => "super",
        TextScriptMode::Sub => "sub",
    }
}

/// Wraps rich text runs using an explicit serialized width table `{ "<bold>|<italic>|<script>|<text>": width }`
/// with character advance fallback, avoiding per-character Wasm-JS boundary crossings.
#[wasm_bindgen]
pub fn build_wrapped_rich_lines(
    runs: JsValue,
    max_width: f64,
    width_map: JsValue,
    char_advance_pt: f64,
    base_bold: bool,
    base_italic: bool,
    options: JsValue,
) -> Result<JsValue, JsValue> {
    let parsed_runs: Vec<TextRun> = serde_wasm_bindgen::from_value(runs).map_err(to_js_err)?;
    let widths: HashMap<String, f64> =
        serde_wasm_bindgen::from_value(width_map).unwrap_or_default();
    let opts: Option<BuildWrappedRichLinesOptions> =
        serde_wasm_bindgen::from_value(options).unwrap_or(None);

    let advance = if char_advance_pt > 0.0 {
        char_advance_pt
    } else {
        7.0
    };

    let out = text_build_wrapped_rich_lines(
        &parsed_runs,
        max_width,
        |text, bold, italic, script| {
            let key = format!("{bold}|{italic}|{}|{text}", script_key(script));
            if let Some(w) = widths.get(&key) {
                return *w;
            }
            let scale = if script == TextScriptMode::Normal {
                1.0
            } else {
                0.72
            };
            text.chars().count() as f64 * advance * scale
        },
        base_bold,
        base_italic,
        opts,
    );
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn build_detected_text_blocks(
    raw_lines: JsValue,
    page_id: &str,
    barriers: JsValue,
) -> Result<JsValue, JsValue> {
    let lines: Vec<RawExtractedLine> =
        serde_wasm_bindgen::from_value(raw_lines).map_err(to_js_err)?;
    let parsed_barriers: Option<TableVectorBarriers> =
        serde_wasm_bindgen::from_value(barriers).unwrap_or(None);
    let out = text_build_detected_text_blocks(&lines, page_id, parsed_barriers.as_ref());
    serialize_js(&out)
}

#[wasm_bindgen]
pub fn inspect_ttf_font(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let meta = text_inspect_ttf_font(bytes).map_err(to_js_err)?;
    serialize_js(&meta)
}

#[wasm_bindgen]
pub fn inspect_pdf_bytes(bytes: &[u8], password: Option<String>) -> Result<JsValue, JsValue> {
    let res = inspect_pdf_with_lopdf(bytes, password.as_deref()).map_err(to_js_err)?;
    serialize_js(&res)
}

#[wasm_bindgen]
pub fn create_blank_pdf_bytes(
    width: f64,
    height: f64,
    page_count: usize,
) -> Result<Vec<u8>, JsValue> {
    create_blank_pdf_with_lopdf(width, height, page_count).map_err(to_js_err)
}

#[wasm_bindgen]
pub fn create_sample_pdf_bytes(
    banner_rgb: &[u8],
    img_w: u32,
    img_h: u32,
) -> Result<Vec<u8>, JsValue> {
    create_sample_pdf_with_lopdf(banner_rgb, img_w, img_h).map_err(to_js_err)
}

#[wasm_bindgen]
pub fn create_reference_pdf_bytes(
    kind: &str,
    page_count: Option<usize>,
    vector_segments: Option<usize>,
) -> Result<Vec<u8>, JsValue> {
    create_reference_pdf_with_lopdf(kind, page_count, vector_segments).map_err(to_js_err)
}

#[wasm_bindgen]
pub fn extract_embedded_fonts_from_pdf(
    source_doc_id: &str,
    bytes: &[u8],
) -> Result<JsValue, JsValue> {
    let bundle = extract_embedded_fonts_with_lopdf(source_doc_id, bytes).map_err(to_js_err)?;
    serialize_js(&bundle)
}

#[wasm_bindgen]
pub fn redact_pdf_bytes(
    pdf_bytes: &[u8],
    rects: JsValue,
    shape_rects: JsValue,
    draw_redaction_boxes: bool,
) -> Result<Vec<u8>, JsValue> {
    let parsed_rects: Vec<RedactionRect> =
        serde_wasm_bindgen::from_value(rects).map_err(to_js_err)?;
    let parsed_shapes: Vec<RedactionRect> =
        serde_wasm_bindgen::from_value(shape_rects).unwrap_or_default();
    let (out, stats) = redact_pdf_bytes_with_lopdf(
        pdf_bytes,
        &parsed_rects,
        RedactionOptions {
            draw_redaction_boxes,
            shape_rects: parsed_shapes,
            ..RedactionOptions::default()
        },
    )
    .map_err(to_js_err)?;
    let _report = RedactionReport {
        redacted_regions: parsed_rects.len(),
        removed_objects: stats.removed_text_runs + stats.removed_shapes,
        remaining_matches: 0,
        verified: true,
    };
    Ok(out)
}

#[wasm_bindgen]
pub fn strip_pdf_elements_bytes(
    pdf_bytes: &[u8],
    text_rects: JsValue,
    image_rects: JsValue,
    shape_rects: JsValue,
) -> Result<Vec<u8>, JsValue> {
    let tr: Vec<RedactionRect> = serde_wasm_bindgen::from_value(text_rects).unwrap_or_default();
    let ir: Vec<RedactionRect> = serde_wasm_bindgen::from_value(image_rects).unwrap_or_default();
    let sr: Vec<RedactionRect> = serde_wasm_bindgen::from_value(shape_rects).unwrap_or_default();
    let (out, _) = redact_pdf_bytes_with_lopdf(
        pdf_bytes,
        &[],
        RedactionOptions {
            draw_redaction_boxes: false,
            text_only_rects: tr,
            image_only_rects: ir,
            shape_rects: sr,
            ..RedactionOptions::default()
        },
    )
    .map_err(to_js_err)?;
    Ok(out)
}

#[wasm_bindgen]
pub fn prepare_clean_page_preview_bytes(
    pdf_bytes: &[u8],
    source_page_index: usize,
    text_rects: JsValue,
    image_rects: JsValue,
    shape_rects: JsValue,
) -> Result<Vec<u8>, JsValue> {
    let tr: Vec<RectBox> = serde_wasm_bindgen::from_value(text_rects).unwrap_or_default();
    let ir: Vec<RectBox> = serde_wasm_bindgen::from_value(image_rects).unwrap_or_default();
    let sr: Vec<RectBox> = serde_wasm_bindgen::from_value(shape_rects).unwrap_or_default();
    prepare_clean_page_preview_with_lopdf(pdf_bytes, source_page_index, &tr, &ir, &sr)
        .map_err(to_js_err)
}

#[wasm_bindgen]
pub fn apply_pdf_clip_masks(pdf_bytes: &[u8], patches: JsValue) -> Result<Vec<u8>, JsValue> {
    let parsed: Vec<ClipMaskPatch> = serde_wasm_bindgen::from_value(patches).map_err(to_js_err)?;
    apply_clip_masks_with_lopdf(pdf_bytes, &parsed).map_err(to_js_err)
}

#[wasm_bindgen]
pub struct WasmSession {
    inner: EngineSession,
}

#[wasm_bindgen]
impl WasmSession {
    #[wasm_bindgen(constructor)]
    pub fn new(tile_cache_budget_bytes: usize) -> Self {
        Self {
            inner: EngineSession::new(tile_cache_budget_bytes),
        }
    }

    pub fn load_snapshot_json(&mut self, json: &str) -> Result<(), JsValue> {
        self.inner.load_snapshot_json(json).map_err(to_js_err)
    }

    pub fn export_snapshot_json(&self) -> Result<String, JsValue> {
        self.inner.export_snapshot_json().map_err(to_js_err)
    }

    pub fn apply_command_json(&mut self, command_json: &str) -> Result<String, JsValue> {
        self.inner
            .apply_command_json(command_json)
            .map_err(to_js_err)
    }

    pub fn undo(&mut self) -> Result<bool, JsValue> {
        self.inner.undo().map_err(to_js_err)
    }

    pub fn redo(&mut self) -> Result<bool, JsValue> {
        self.inner.redo().map_err(to_js_err)
    }

    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
    }

    pub fn revision(&self) -> u64 {
        self.inner.revision()
    }

    pub fn trim_memory(&mut self, target_bytes: usize) {
        self.inner.trim_memory(target_bytes);
    }
}
