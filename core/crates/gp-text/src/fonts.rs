use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontStyleVariant {
    Regular,
    Bold,
    Italic,
    BoldItalic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedFontKey {
    pub clean_name: String,
    pub exact_key: String,
    pub base_key: String,
    pub bold: bool,
    pub italic: bool,
    pub variant: FontStyleVariant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPdfFontInfo {
    pub font_family: String,
    pub bold: bool,
    pub italic: bool,
    pub clean_font_name: String,
    pub is_custom_font: bool,
    pub matched_label: String,
    pub estimated_horizontal_scale: f64,
}

fn strip_subset_prefix(raw: &str) -> &str {
    let bytes = raw.as_bytes();
    if bytes.len() > 7
        && bytes[6] == b'+'
        && bytes[..6].iter().all(|b| b.is_ascii_uppercase())
    {
        &raw[7..]
    } else {
        raw
    }
}

fn strip_font_extension(name: &str) -> &str {
    let lower = name.to_ascii_lowercase();
    for ext in [".woff2", ".woff", ".ttf", ".otf"] {
        if lower.ends_with(ext) {
            return &name[..name.len() - ext.len()];
        }
    }
    name
}

const KNOWN_SUFFIXES: &[&str] = &[
    "bolditalic",
    "boldoblique",
    "bold italic",
    "bold oblique",
    "semibold",
    "demibold",
    "extrabold",
    "ultrabold",
    "extralight",
    "ultralight",
    "semi bold",
    "demi bold",
    "extra bold",
    "ultra bold",
    "extra light",
    "ultra light",
    "condensed",
    "expanded",
    "narrow",
    "extended",
    "regular",
    "normal",
    "book",
    "roman",
    "italic",
    "oblique",
    "slant",
    "bold",
    "black",
    "heavy",
    "medium",
    "light",
    "thin",
    "mt",
    "ps",
    "std",
    "pro",
    "lt",
    "bd",
    "bi",
    "it",
    "rg",
];

fn has_delimiter_token(lower: &str, tokens: &[&str]) -> bool {
    for part in lower.split(|c: char| !c.is_ascii_alphanumeric()) {
        if tokens.contains(&part) {
            return true;
        }
    }
    false
}

pub fn normalize_font_match_key(raw_name: &str) -> NormalizedFontKey {
    let without_ext = strip_font_extension(raw_name);
    let clean_name = strip_subset_prefix(without_ext).trim().to_string();
    let lower = clean_name.to_lowercase();

    let bold = lower.contains("bold")
        || lower.contains("black")
        || lower.contains("heavy")
        || lower.contains("semibold")
        || lower.contains("demi")
        || lower.contains("extrabold")
        || has_delimiter_token(&lower, &["bd", "b", "bi"]);

    let italic = lower.contains("italic")
        || lower.contains("oblique")
        || lower.contains("slant")
        || has_delimiter_token(&lower, &["it", "i", "ob", "bi"]);

    let variant = match (bold, italic) {
        (true, true) => FontStyleVariant::BoldItalic,
        (true, false) => FontStyleVariant::Bold,
        (false, true) => FontStyleVariant::Italic,
        (false, false) => FontStyleVariant::Regular,
    };

    let mut base = clean_name.clone();
    for _ in 0..4 {
        let lower_base = base.to_ascii_lowercase();
        let mut stripped = None;
        for suf in KNOWN_SUFFIXES {
            if lower_base.ends_with(suf) && base.len() > suf.len() {
                let candidate = base[..base.len() - suf.len()]
                    .trim_end_matches(|c: char| matches!(c, '-' | '_' | ',' | '.' | ' '))
                    .trim()
                    .to_string();
                if !candidate.is_empty() {
                    stripped = Some(candidate);
                    break;
                }
            }
        }
        if let Some(next) = stripped {
            base = next;
        } else {
            break;
        }
    }

    let exact_key: String = lower.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let base_alnum: String = base
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let base_key = if base_alnum.is_empty() {
        exact_key.clone()
    } else {
        base_alnum
    };

    NormalizedFontKey {
        clean_name: if clean_name.is_empty() {
            "Custom Font".to_string()
        } else {
            clean_name
        },
        exact_key,
        base_key,
        bold,
        italic,
        variant,
    }
}

pub fn font_family_label(family: &str) -> &'static str {
    match family {
        "Helvetica" => "Helvetica / Arial",
        "Calibri" => "Calibri (Carlito)",
        "Inter" => "Inter / Modern Sans",
        "DejaVuSans" => "DejaVu Sans",
        "DejaVuSansCondensed" => "DejaVu Sans Condensed",
        "Verdana" => "Verdana / Tahoma (Sans)",
        "TimesRoman" => "Times New Roman",
        "Cambria" => "Cambria (Caladea)",
        "Merriweather" => "Merriweather (Serif)",
        "Georgia" => "Georgia (Serif)",
        "Garamond" => "Garamond / Palatino",
        "DejaVuSerif" => "DejaVu Serif",
        "DejaVuSerifCondensed" => "DejaVu Serif Condensed",
        "Courier" => "Courier New",
        "JetBrainsMono" => "JetBrains Mono",
        "DejaVuSansMono" => "DejaVu Sans Mono",
        "GreatVibes" => "Great Vibes (Script)",
        "Caveat" => "Caveat (Hand)",
        _ => "Helvetica / Arial",
    }
}

pub fn is_builtin_font_family(family: &str) -> bool {
    matches!(
        family,
        "Helvetica"
            | "Calibri"
            | "Inter"
            | "DejaVuSans"
            | "DejaVuSansCondensed"
            | "Verdana"
            | "TimesRoman"
            | "Cambria"
            | "Merriweather"
            | "Georgia"
            | "Garamond"
            | "DejaVuSerif"
            | "DejaVuSerifCondensed"
            | "Courier"
            | "JetBrainsMono"
            | "DejaVuSansMono"
            | "GreatVibes"
            | "Caveat"
    )
}

pub fn parse_pdf_font_metadata(
    raw_font_name: &str,
    is_serif: bool,
    is_mono: bool,
    is_bold: bool,
    is_italic: bool,
) -> ParsedPdfFontInfo {
    let norm = normalize_font_match_key(raw_font_name);
    let clean_font_name = strip_subset_prefix(raw_font_name).trim().to_string();
    let lower = clean_font_name.to_lowercase();

    let bold = is_bold || norm.bold;
    let italic = is_italic || norm.italic;

    let is_condensed = lower.contains("condensed")
        || lower.contains("narrow")
        || lower.contains("compressed")
        || has_delimiter_token(&lower, &["cn", "cond"]);
    let is_expanded = lower.contains("expanded") || lower.contains("extended");

    let font_family = if lower.contains("dejavu") && lower.contains("mono") {
        "DejaVuSansMono"
    } else if lower.contains("dejavu") && lower.contains("sans") && lower.contains("cond") {
        "DejaVuSansCondensed"
    } else if lower.contains("dejavu") && lower.contains("sans") {
        "DejaVuSans"
    } else if lower.contains("dejavu") && lower.contains("serif") && lower.contains("cond") {
        "DejaVuSerifCondensed"
    } else if lower.contains("dejavu") && lower.contains("serif") {
        "DejaVuSerif"
    } else if is_mono
        || lower.contains("courier")
        || lower.contains("mono")
        || lower.contains("consolas")
        || lower.contains("cousine")
        || lower.contains("firacode")
        || lower.contains("inconsolata")
        || lower.contains("menlo")
        || lower.contains("monaco")
        || lower.contains("code")
    {
        if lower.contains("jetbrains") || lower.contains("fira") {
            "JetBrainsMono"
        } else {
            "Courier"
        }
    } else if lower.contains("calibri") || lower.contains("carlito") {
        "Calibri"
    } else if lower.contains("cambria") || lower.contains("caladea") {
        "Cambria"
    } else if lower.contains("merriweather") {
        "Merriweather"
    } else if lower.contains("georgia") {
        "Georgia"
    } else if lower.contains("garamond") || lower.contains("palatino") {
        "Garamond"
    } else if lower.contains("verdana") || lower.contains("tahoma") {
        "Verdana"
    } else if lower.contains("inter")
        || lower.contains("roboto")
        || lower.contains("opensans")
        || lower.contains("open sans")
        || lower.contains("lato")
        || lower.contains("montserrat")
    {
        "Inter"
    } else if lower.contains("sans-serif")
        || lower.contains("sansserif")
        || lower.contains("sans")
        || lower.contains("helvetica")
        || lower.contains("arial")
        || lower.contains("arimo")
        || lower.contains("liberationsans")
        || lower.contains("liberation-sans")
        || lower.contains("nimbussan")
        || lower.contains("segoe")
        || lower.contains("frutiger")
        || lower.contains("myriad")
        || lower.contains("futura")
        || lower.contains("avenir")
        || lower.contains("proxima")
    {
        "Helvetica"
    } else if is_serif
        || lower.contains("times")
        || lower.contains("tinos")
        || lower.contains("liberationserif")
        || lower.contains("liberation-serif")
        || lower.contains("nimbusrom")
        || lower.contains("serif")
        || lower.contains("baskerville")
        || lower.contains("minion")
        || lower.contains("playfair")
        || lower.contains("century")
        || lower.contains("book")
        || lower.contains("roman")
    {
        "TimesRoman"
    } else if lower.contains("script") || lower.contains("brush") || lower.contains("chancery") {
        "GreatVibes"
    } else {
        "Helvetica"
    };

    let known_prefixes = [
        "helvetica",
        "arial",
        "arimo",
        "liberation sans",
        "liberation-sans",
        "liberation_sans",
        "liberationsans",
        "calibri",
        "carlito",
        "cambria",
        "caladea",
        "times new roman",
        "times-new-roman",
        "times_new_roman",
        "timesroman",
        "times-roman",
        "times_roman",
        "timesps",
        "times-ps",
        "times_ps",
        "times",
        "tinos",
        "liberation serif",
        "liberation-serif",
        "liberation_serif",
        "liberationserif",
        "courier new",
        "courier-new",
        "courier_new",
        "courierps",
        "courier-ps",
        "courier_ps",
        "courier",
        "cousine",
        "liberation mono",
        "liberation-mono",
        "liberation_mono",
        "liberationmono",
        "dejavu sans condensed",
        "dejavu-sans-condensed",
        "dejavu_sans_condensed",
        "dejavu sans mono",
        "dejavu-sans-mono",
        "dejavu_sans_mono",
        "dejavu sans",
        "dejavu-sans",
        "dejavu_sans",
        "dejavu serif condensed",
        "dejavu-serif-condensed",
        "dejavu_serif_condensed",
        "dejavu serif",
        "dejavu-serif",
        "dejavu_serif",
        "inter",
        "merriweather",
        "jetbrains mono",
        "jetbrains-mono",
        "jetbrains_mono",
    ];
    let matches_equiv = |candidate: &str| -> bool {
        let low = candidate.to_lowercase();
        known_prefixes.iter().any(|p| {
            if let Some(rest) = low.strip_prefix(p) {
                rest.is_empty()
                    || matches!(
                        rest.chars().next(),
                        Some('-') | Some('_') | Some(',') | Some('.') | Some(' ') | Some('\t')
                    )
            } else {
                false
            }
        })
    };
    let strip_suffix_token = |name: &str| -> String {
        let mut s = name.trim().to_string();
        let suffixes = [
            "mt", "ps", "std", "pro", "lt", "regular", "bold", "italic", "oblique",
            "bolditalic", "boldoblique", "semibold", "medium", "light", "bd", "it", "bi",
        ];
        loop {
            let low = s.to_lowercase();
            let mut trimmed = None;
            for suf in &suffixes {
                if low.ends_with(suf) && low.len() > suf.len() {
                    let boundary = low[..low.len() - suf.len()].chars().last();
                    if matches!(boundary, Some('-') | Some('_') | Some(',') | Some('.') | Some(' ')) {
                        trimmed = Some(s[..s.len() - suf.len()].trim_end_matches(&['-', '_', ',', '.', ' '][..]).to_string());
                        break;
                    }
                }
            }
            if let Some(next) = trimmed {
                s = next;
            } else {
                break;
            }
        }
        s
    };
    let base_token = strip_suffix_token(&clean_font_name);
    let is_generic_id = {
        let low = clean_font_name.to_lowercase();
        (low.starts_with("g_d") && low.contains("_f"))
            || (low.starts_with('f') && low[1..].chars().all(|c| c.is_ascii_digit()) && low.len() > 1)
    };
    let is_metric_matched =
        !is_generic_id && (matches_equiv(&clean_font_name) || matches_equiv(&base_token));
    let is_custom_font = !clean_font_name.is_empty() && !is_metric_matched;

    ParsedPdfFontInfo {
        font_family: font_family.to_string(),
        bold,
        italic,
        clean_font_name: if clean_font_name.is_empty() {
            "Embedded Font".to_string()
        } else {
            clean_font_name
        },
        is_custom_font,
        matched_label: font_family_label(font_family).to_string(),
        estimated_horizontal_scale: if is_condensed {
            0.85
        } else if is_expanded {
            1.15
        } else {
            1.0
        },
    }
}
