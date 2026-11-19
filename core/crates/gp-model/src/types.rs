use serde::{Deserialize, Serialize};

pub type RotationAngle = u16; // 0 | 90 | 180 | 270
pub type LayerTier = u8; // 1 | 2 | 3 | 4

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RectBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One run of glyphs drawn at an exact position (visual page coordinates, points).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PositionedTextSegment {
    pub text: String,
    pub x: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub strikethrough: bool,
    /// Glyphs missing from the document's embedded font: draw with the fallback family.
    #[serde(default)]
    pub fallback: bool,
    /// Font size override in points (superscript/subscript); 0 = element font size.
    #[serde(default)]
    pub size: f64,
    /// Baseline offset in points (visual, positive = down) for super/subscript.
    #[serde(default)]
    pub rise: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PositionedTextLine {
    /// Baseline y in visual page coordinates (top-down, points).
    pub baseline: f64,
    pub segments: Vec<PositionedTextSegment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPoint {
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pressure: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smooth: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
    Justify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TextScriptMode {
    #[default]
    Normal,
    Super,
    Sub,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<TextScriptMode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub id: String,
    pub source_doc_id: String,
    pub source_page_index: usize,
    pub base_width: f64,
    pub base_height: f64,
    pub intrinsic_rotation: RotationAngle,
    pub user_rotation: RotationAngle,
    #[serde(default = "default_crop_box")]
    pub media_box: [f64; 4],
    #[serde(default = "default_crop_box")]
    pub crop_box: [f64; 4],
}

fn default_crop_box() -> [f64; 4] {
    [0.0, 0.0, 595.0, 842.0]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PageNumberingPosition {
    #[default]
    BottomCenter,
    BottomLeft,
    BottomRight,
    TopLeft,
    TopCenter,
    TopRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PageNumberingFormat {
    #[default]
    Number,
    NumberOfTotal,
    PageNumber,
    PageNumberOfTotal,
    RomanLower,
    RomanUpper,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageNumberingConfig {
    pub enabled: bool,
    pub position: PageNumberingPosition,
    pub format: PageNumberingFormat,
    pub font_family: String,
    pub font_size: f64,
    pub color: String,
    pub margin_x: f64,
    pub margin_y: f64,
    pub start_from_page: usize,
    pub start_number: usize,
    pub opacity: f64,
}

impl Default for PageNumberingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            position: PageNumberingPosition::BottomCenter,
            format: PageNumberingFormat::Number,
            font_family: "Helvetica".to_string(),
            font_size: 10.0,
            color: "#334155".to_string(),
            margin_x: 36.0,
            margin_y: 26.0,
            start_from_page: 1,
            start_number: 1,
            opacity: 0.92,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum VectorShapeType {
    #[default]
    Rect,
    Ellipse,
    Triangle,
    Diamond,
    Arrow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum VectorStrokeDash {
    #[default]
    Solid,
    Dashed,
    Dotted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum RotateCopyPivot {
    #[default]
    Center,
    TopCenter,
    BottomCenter,
    LeftCenter,
    RightCenter,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedCropRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageClipMask {
    pub svg_path: String,
    pub view_box_width: f64,
    pub view_box_height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask_source_element_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureVectorPath {
    pub d: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseElement {
    pub id: String,
    pub page_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "default_one")]
    pub opacity: f64,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_background_layer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_tier: Option<LayerTier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

fn default_one() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum CanvasElement {
    #[serde(rename = "text-edit", rename_all = "camelCase")]
    TextEdit {
        #[serde(flatten)]
        base: BaseElement,
        source_block_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        original_rect: Option<RectBox>,
        original_text: String,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        runs: Option<Vec<TextRun>>,
        font_family: String,
        font_size: f64,
        color: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        background_color: Option<String>,
        bold: bool,
        italic: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        underline: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        strikethrough: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        script_mode: Option<TextScriptMode>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        embedded_font_id: Option<String>,
        align: TextAlign,
        line_height: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        horizontal_scale: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        letter_spacing: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        deleted: Option<bool>,
        /// Only these regions of the original text are stripped (the lines that really changed);
        /// untouched lines stay byte-for-byte original. Falls back to `original_rect` when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        strip_rects: Option<Vec<RectBox>>,
        /// Editor-computed, exactly positioned replacement lines (visual page coordinates). When
        /// present, export draws these instead of re-flowing the paragraph, so the saved/printed
        /// text matches the on-screen editor glyph for glyph.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        layout_lines: Option<Vec<PositionedTextLine>>,
    },
    #[serde(rename = "text-add", rename_all = "camelCase")]
    TextAdd {
        #[serde(flatten)]
        base: BaseElement,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        runs: Option<Vec<TextRun>>,
        font_family: String,
        font_size: f64,
        color: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        background_color: Option<String>,
        bold: bool,
        italic: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        underline: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        strikethrough: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        script_mode: Option<TextScriptMode>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        embedded_font_id: Option<String>,
        align: TextAlign,
        line_height: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        horizontal_scale: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        letter_spacing: Option<f64>,
    },
    #[serde(rename = "image", rename_all = "camelCase")]
    ImageAdd {
        #[serde(flatten)]
        base: BaseElement,
        name: String,
        mime_type: String,
        #[serde(default)]
        preview_url: String,
        natural_width: f64,
        natural_height: f64,
        aspect_locked: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        behind_content: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        crop_rect: Option<NormalizedCropRect>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        clip_mask: Option<ImageClipMask>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        repeat_across_pages: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flip_x: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flip_y: Option<bool>,
    },
    #[serde(rename = "image-replacement", rename_all = "camelCase")]
    ImageReplacement {
        #[serde(flatten)]
        base: BaseElement,
        source_image_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        original_rect: Option<RectBox>,
        mime_type: String,
        #[serde(default)]
        preview_url: String,
        natural_width: f64,
        natural_height: f64,
        aspect_locked: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        deleted: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        behind_content: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        crop_rect: Option<NormalizedCropRect>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        clip_mask: Option<ImageClipMask>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flip_x: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flip_y: Option<bool>,
        /// Move/resize/rotate/flip the ORIGINAL image object inside the content stream (keeps its
        /// layer order and original encoding) instead of stripping and re-drawing it on top.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        in_place: Option<bool>,
        /// In-place crop: the visible window (visual page rect, rotated by the element rotation
        /// about its own centre). `base` then describes the FULL uncropped image placement.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        in_place_clip: Option<RectBox>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        original_rotation: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        original_flip_x: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        original_flip_y: Option<bool>,
    },
    #[serde(rename = "shape-replacement", rename_all = "camelCase")]
    ShapeReplacement {
        #[serde(flatten)]
        base: BaseElement,
        source_shape_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        original_rect: Option<RectBox>,
        fill_color: String,
        stroke_color: String,
        stroke_width: f64,
        #[serde(default)]
        svg_path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        deleted: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        behind_content: Option<bool>,
        /// Move/resize/rotate the ORIGINAL vector path in place (keeps layer order).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        in_place: Option<bool>,
    },
    #[serde(rename = "shape", rename_all = "camelCase")]
    VectorShape {
        #[serde(flatten)]
        base: BaseElement,
        shape_type: VectorShapeType,
        fill_color: String,
        stroke_color: String,
        stroke_width: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        border_radius: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stroke_dash: Option<VectorStrokeDash>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        behind_content: Option<bool>,
    },
    #[serde(rename = "path", rename_all = "camelCase")]
    VectorPath {
        #[serde(flatten)]
        base: BaseElement,
        points: Vec<NormalizedPoint>,
        closed: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        smooth: Option<bool>,
        fill_color: String,
        stroke_color: String,
        stroke_width: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stroke_dash: Option<VectorStrokeDash>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        behind_content: Option<bool>,
    },
    #[serde(rename = "signature", rename_all = "camelCase")]
    Signature {
        #[serde(flatten)]
        base: BaseElement,
        signature_id: String,
        data_url: String,
        aspect_locked: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        realistic_ink: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        svg_paths: Option<Vec<SignatureVectorPath>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view_box_width: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view_box_height: Option<f64>,
    },
    #[serde(rename = "stroke", rename_all = "camelCase")]
    Stroke {
        #[serde(flatten)]
        base: BaseElement,
        points: Vec<NormalizedPoint>,
        color: String,
        stroke_width: f64,
    },
    #[serde(rename = "highlight", rename_all = "camelCase")]
    Highlight {
        #[serde(flatten)]
        base: BaseElement,
        fill_color: String,
        shape: String, // "highlight" | "redact"
    },
}

impl CanvasElement {
    pub fn base(&self) -> &BaseElement {
        match self {
            Self::TextEdit { base, .. }
            | Self::TextAdd { base, .. }
            | Self::ImageAdd { base, .. }
            | Self::ImageReplacement { base, .. }
            | Self::ShapeReplacement { base, .. }
            | Self::VectorShape { base, .. }
            | Self::VectorPath { base, .. }
            | Self::Signature { base, .. }
            | Self::Stroke { base, .. }
            | Self::Highlight { base, .. } => base,
        }
    }

    pub fn base_mut(&mut self) -> &mut BaseElement {
        match self {
            Self::TextEdit { base, .. }
            | Self::TextAdd { base, .. }
            | Self::ImageAdd { base, .. }
            | Self::ImageReplacement { base, .. }
            | Self::ShapeReplacement { base, .. }
            | Self::VectorShape { base, .. }
            | Self::VectorPath { base, .. }
            | Self::Signature { base, .. }
            | Self::Stroke { base, .. }
            | Self::Highlight { base, .. } => base,
        }
    }

    pub fn id(&self) -> &str {
        &self.base().id
    }

    pub fn page_id(&self) -> &str {
        &self.base().page_id
    }

    pub fn default_layer_tier(&self) -> LayerTier {
        match self {
            Self::ImageAdd {
                behind_content,
                base,
                ..
            }
            | Self::ImageReplacement {
                behind_content,
                base,
                ..
            }
            | Self::ShapeReplacement {
                behind_content,
                base,
                ..
            } => {
                if behind_content.unwrap_or(false) || base.is_background_layer.unwrap_or(false) {
                    1
                } else {
                    2
                }
            }
            Self::VectorShape {
                behind_content,
                base,
                ..
            }
            | Self::VectorPath {
                behind_content,
                base,
                ..
            } => {
                if behind_content.unwrap_or(false) || base.is_background_layer.unwrap_or(false) {
                    1
                } else {
                    4
                }
            }
            Self::TextEdit { .. } | Self::TextAdd { .. } => 3,
            Self::Signature { .. } | Self::Stroke { .. } | Self::Highlight { .. } => 4,
        }
    }

    pub fn effective_layer_tier(&self) -> LayerTier {
        self.base()
            .layer_tier
            .unwrap_or_else(|| self.default_layer_tier())
    }

    pub fn is_deleted(&self) -> bool {
        match self {
            Self::TextEdit { deleted, .. }
            | Self::ImageReplacement { deleted, .. }
            | Self::ShapeReplacement { deleted, .. } => deleted.unwrap_or(false),
            _ => false,
        }
    }

    pub fn strip_rect(&self) -> RectBox {
        let orig = match self {
            Self::TextEdit { original_rect, .. }
            | Self::ImageReplacement { original_rect, .. }
            | Self::ShapeReplacement { original_rect, .. } => *original_rect,
            _ => None,
        };
        orig.unwrap_or_else(|| {
            let b = self.base();
            RectBox {
                x: b.x,
                y: b.y,
                width: b.width,
                height: b.height,
            }
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub pages: Vec<PageMeta>,
    pub elements: Vec<CanvasElement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_numbering: Option<PageNumberingConfig>,
    #[serde(default)]
    pub selected_element_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_page_id: Option<String>,
}
