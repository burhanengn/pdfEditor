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
                        codepoints.insert(cp);
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
