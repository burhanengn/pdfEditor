use gp_model::{PageNumberingConfig, PageNumberingFormat, PageNumberingPosition, TextAlign};
use serde::{Deserialize, Serialize};

const ROMAN_PAIRS: &[(usize, &str)] = &[
    (1000, "M"),
    (900, "CM"),
    (500, "D"),
    (400, "CD"),
    (100, "C"),
    (90, "XC"),
    (50, "L"),
    (40, "XL"),
    (10, "X"),
    (9, "IX"),
    (5, "V"),
    (4, "IV"),
    (1, "I"),
];

pub fn to_roman_numeral(num: usize, upper: bool) -> String {
    if num < 1 || num > 3999 {
        return num.to_string();
    }
    let mut rem = num;
    let mut out = String::new();
    for &(val, sym) in ROMAN_PAIRS {
        while rem >= val {
            out.push_str(sym);
            rem -= val;
        }
    }
    if upper {
        out
    } else {
        out.to_lowercase()
    }
}

pub fn format_page_number_label(
    page_index_zero_based: usize,
    total_pages: usize,
    config: &PageNumberingConfig,
) -> Option<String> {
    if !config.enabled {
        return None;
    }
    let one_based = page_index_zero_based + 1;
    let start_from = config.start_from_page.max(1);
    if one_based < start_from {
        return None;
    }
    let start_num = config.start_number.max(1);
    let display_num = start_num + (one_based - start_from);
    let display_total = display_num.max(total_pages - (start_from - 1) + (start_num - 1));

    Some(match config.format {
        PageNumberingFormat::Number => display_num.to_string(),
        PageNumberingFormat::NumberOfTotal => format!("{display_num} / {display_total}"),
        PageNumberingFormat::PageNumber => format!("Sayfa {display_num}"),
        PageNumberingFormat::PageNumberOfTotal => format!("Sayfa {display_num} / {display_total}"),
        PageNumberingFormat::RomanLower => to_roman_numeral(display_num, false),
        PageNumberingFormat::RomanUpper => to_roman_numeral(display_num, true),
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageNumberLayoutBox {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub align: TextAlign,
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

pub fn compute_page_number_layout(
    page_width: f64,
    page_height: f64,
    page_index_zero_based: usize,
    total_pages: usize,
    config: &PageNumberingConfig,
) -> Option<PageNumberLayoutBox> {
    let label = format_page_number_label(page_index_zero_based, total_pages, config)?;

    let mx = if config.margin_x > 0.0 {
        config.margin_x
    } else {
        36.0
    };
    let my = if config.margin_y > 0.0 {
        config.margin_y
    } else {
        26.0
    };
    let safe_margin_x = mx.min(page_width * 0.35).max(8.0);
    let safe_margin_y = my.min(page_height * 0.35).max(6.0);
    let fs = if config.font_size > 0.0 {
        config.font_size.clamp(6.0, 72.0)
    } else {
        10.0
    };

    let align = match config.position {
        PageNumberingPosition::BottomLeft | PageNumberingPosition::TopLeft => TextAlign::Left,
        PageNumberingPosition::BottomRight | PageNumberingPosition::TopRight => TextAlign::Right,
        PageNumberingPosition::BottomCenter | PageNumberingPosition::TopCenter => TextAlign::Center,
    };

    let is_top = matches!(
        config.position,
        PageNumberingPosition::TopLeft
            | PageNumberingPosition::TopCenter
            | PageNumberingPosition::TopRight
    );

    let height = round2(fs * 1.35);
    let y = if is_top {
        round2(safe_margin_y - fs * 0.25).max(4.0)
    } else {
        round2(page_height - safe_margin_y - fs * 0.95).max(4.0)
    };
    let width = round2(page_width - safe_margin_x * 2.0).max(40.0);

    Some(PageNumberLayoutBox {
        text: label,
        x: round2(safe_margin_x),
        y,
        width,
        height,
        align,
    })
}
