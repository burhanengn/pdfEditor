use gp_model::RotationAngle;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ReadingTheme {
    #[default]
    Default,
    Sepia,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PdfOpenStatus {
    Ok,
    NeedsPassword,
    InvalidPassword,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageSummary {
    pub source_page_index: usize,
    pub base_width: f64,
    pub base_height: f64,
    pub intrinsic_rotation: RotationAngle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOpenResult {
    pub status: PdfOpenStatus,
    pub page_count: usize,
    pub pages: Vec<PdfPageSummary>,
    pub can_copy_text: bool,
    pub permissions: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOutlineNode {
    pub id: String,
    pub title: String,
    pub page_index: Option<usize>,
    pub children: Vec<PdfOutlineNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PdfLinkKind {
    Uri,
    Goto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfLinkAnnotation {
    pub id: String,
    pub page_index: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub kind: PdfLinkKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dest_page_index: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfTextCharBox {
    pub unicode: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfTextSpan {
    pub id: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub font_size: f64,
    pub baseline_y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSearchRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSearchHit {
    pub page_index: usize,
    pub match_index_in_page: usize,
    pub snippet: String,
    pub rects: Vec<PdfSearchRect>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileRenderRequest {
    pub source_doc_id: String,
    pub page_index: usize,
    pub tile_x: i32,
    pub tile_y: i32,
    pub tile_width_px: u32,
    pub tile_height_px: u32,
    pub scale: f64,
    pub user_rotation: RotationAngle,
    #[serde(default)]
    pub transparent_bg: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<ReadingTheme>,
    #[serde(default)]
    pub dark_paper_invert: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedBitmap {
    pub width: u32,
    pub height: u32,
    /// Premultiplied RGBA8888 pixel buffer (`width * height * 4` bytes).
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionRect {
    pub page_index: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RedactionReport {
    pub redacted_regions: usize,
    pub removed_objects: usize,
    pub remaining_matches: usize,
    pub verified: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfInspectionPage {
    pub source_page_index: usize,
    pub base_width: f64,
    pub base_height: f64,
    pub intrinsic_rotation: RotationAngle,
    pub media_box: [f64; 4],
    pub crop_box: [f64; 4],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfInspectionResult {
    pub status: PdfOpenStatus,
    pub was_encrypted: bool,
    pub page_count: usize,
    pub pages: Vec<PdfInspectionPage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedImageObject {
    pub id: String,
    pub page_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    #[serde(default)]
    pub flip_x: bool,
    #[serde(default)]
    pub flip_y: bool,
    pub natural_width: u32,
    pub natural_height: u32,
    #[serde(default)]
    pub ctm: [f64; 6],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rgba: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedVectorShape {
    pub id: String,
    pub page_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub svg_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_color: Option<String>,
    #[serde(default)]
    pub stroke_width: f64,
    pub is_filled: bool,
    pub is_stroked: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedFontVariantInfo {
    pub regular: bool,
    pub bold: bool,
    pub italic: bool,
    pub bold_italic: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedFontEntry {
    pub id: String,
    pub source_doc_id: String,
    pub clean_name: String,
    pub display_name: String,
    pub base_key: String,
    pub css_family: String,
    pub fallback_family: String,
    pub variants: ExtractedFontVariantInfo,
    pub supported_code_points: Vec<u32>,
    pub unicode_usable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedFontBinaryAsset {
    pub family: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regular: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold_italic: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedFontsBundle {
    pub fonts: Vec<ExtractedFontEntry>,
    pub assets: Vec<ExtractedFontBinaryAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileProgress {
    pub stage: String,
    pub current_page: usize,
    pub total_pages: usize,
    pub percent: u8,
}
