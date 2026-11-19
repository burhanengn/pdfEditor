use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use ttf_parser::{name_id, Face};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtfFontMetadata {
    pub family_name: String,
    pub subfamily_name: String,
    pub full_name: String,
    pub postscript_name: String,
    pub units_per_em: u16,
    pub ascender: i16,
    pub descender: i16,
    pub supported_code_points: Vec<u32>,
}

fn read_name_record(face: &Face<'_>, id: u16) -> Option<String> {
    let mut fallback: Option<String> = None;
    for name in face.names() {
        if name.name_id != id {
            continue;
        }
        if let Some(decoded) = name.to_string() {
            let trimmed = decoded.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            if name.is_unicode() && name.language_id == 0x0409 {
                return Some(trimmed);
            }
            if fallback.is_none() {
                fallback = Some(trimmed);
            }
        }
    }
    fallback
}

/// Parses an OpenType / TrueType font buffer (`ttf` or `otf`) to extract family metadata
/// and complete Unicode codepoint coverage without `@pdf-lib/fontkit`.
pub fn inspect_ttf_font(bytes: &[u8]) -> Result<TtfFontMetadata, String> {
    let face = Face::parse(bytes, 0).map_err(|e| format!("Invalid TTF/OTF font: {e:?}"))?;

    let family_name = read_name_record(&face, name_id::TYPOGRAPHIC_FAMILY)
        .or_else(|| read_name_record(&face, name_id::FAMILY))
        .unwrap_or_else(|| "CustomFont".to_string());
    let subfamily_name = read_name_record(&face, name_id::TYPOGRAPHIC_SUBFAMILY)
        .or_else(|| read_name_record(&face, name_id::SUBFAMILY))
        .unwrap_or_else(|| "Regular".to_string());
    let full_name =
        read_name_record(&face, name_id::FULL_NAME).unwrap_or_else(|| family_name.clone());
    let postscript_name =
        read_name_record(&face, name_id::POST_SCRIPT_NAME).unwrap_or_else(|| family_name.clone());

    let mut codepoints = BTreeSet::new();
    if let Some(cmap) = face.tables().cmap {
        for subtable in cmap.subtables {
            if subtable.is_unicode() {
                subtable.codepoints(|cp| {
                    if cp >= 0x20 {
                        if let Some(ch) = char::from_u32(cp) {
                            if face.glyph_index(ch).map(|g| g.0 != 0).unwrap_or(false) {
                                codepoints.insert(cp);
                            }
                        }
                    }
                });
            }
        }
    }

    Ok(TtfFontMetadata {
        family_name,
        subfamily_name,
        full_name,
        postscript_name,
        units_per_em: face.units_per_em(),
        ascender: face.ascender(),
        descender: face.descender(),
        supported_code_points: codepoints.into_iter().collect(),
    })
}

/// Computes exact horizontal text advance in points using `ttf-parser` glyph advances.
pub fn measure_ttf_text_width(ttf_bytes: &[u8], text: &str, font_size: f64) -> Option<f64> {
    let face = Face::parse(ttf_bytes, 0).ok()?;
    let upm = f64::from(face.units_per_em()).max(1.0);
    let scale = font_size / upm;
    let mut total_units: i64 = 0;
    let min_space = (upm * 0.25).round() as i64;
    let space_adv = face
        .glyph_index(' ')
        .filter(|gid| gid.0 != 0)
        .and_then(|gid| face.glyph_hor_advance(gid))
        .map(|a| (a as i64).max(min_space))
        .unwrap_or(min_space);
    for ch in text.chars() {
        if ch == ' ' {
            total_units += space_adv;
            continue;
        }
        let adv = face
            .glyph_index(ch)
            .filter(|gid| gid.0 != 0)
            .and_then(|gid| face.glyph_hor_advance(gid))
            .map(|a| a as i64)
            .unwrap_or(space_adv);
        total_units += adv;
    }
    Some((total_units as f64) * scale)
}

/// Returns `true` if the TTF/OTF stream contains a non-zero glyph mapping for every printable character in `text`.
pub fn ttf_font_supports_text(ttf_bytes: &[u8], text: &str) -> bool {
    let Ok(face) = Face::parse(ttf_bytes, 0) else {
        return false;
    };
    for ch in text.chars() {
        if ch.is_whitespace() {
            continue;
        }
        match face.glyph_index(ch) {
            Some(gid) if gid.0 != 0 => {}
            _ => return false,
        }
    }
    true
}
