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
