use std::collections::HashMap;

use lopdf::{Dictionary, Document, Object};
use ttf_parser::{Face, GlyphId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StandardFontFamily {
    Helvetica,
    HelveticaBold,
    Times,
    Courier,
    Other,
}

#[derive(Debug, Clone)]
pub struct FontMetricsMap {
    pub is_two_byte: bool,
    pub to_unicode: HashMap<u16, String>,
    pub widths_thousandths: HashMap<u16, f64>,
    pub default_width_thousandths: f64,
    family: StandardFontFamily,
}

impl Default for FontMetricsMap {
    fn default() -> Self {
        Self {
            is_two_byte: false,
            to_unicode: HashMap::new(),
            widths_thousandths: HashMap::new(),
            default_width_thousandths: 520.0,
            family: StandardFontFamily::Other,
        }
    }
}

fn classify_standard_font(font_dict: &Dictionary) -> StandardFontFamily {
    let Ok(base) = font_dict.get(b"BaseFont").and_then(Object::as_name) else {
        return StandardFontFamily::Other;
    };
    let name = String::from_utf8_lossy(base).to_ascii_lowercase();
    if name.contains("courier") || name.contains("mono") {
        StandardFontFamily::Courier
    } else if name.contains("times") {
        StandardFontFamily::Times
    } else if (name.contains("helvetica") || name.contains("arial")) && (name.contains("bold") || name.contains("-bd")) {
        StandardFontFamily::HelveticaBold
    } else if name.contains("helvetica") || name.contains("arial") {
        StandardFontFamily::Helvetica
    } else {
        StandardFontFamily::Other
    }
}

fn resolve_dict<'a>(doc: &'a Document, dict: &'a Dictionary, key: &[u8]) -> Option<&'a Dictionary> {
    dict.get(key)
        .ok()
        .and_then(|obj| doc.dereference(obj).ok())
        .and_then(|(_, o)| o.as_dict().ok())
}

fn read_number(doc: &Document, obj: &Object) -> Option<f64> {
    let resolved = match obj {
        Object::Reference(id) => doc.get_object(*id).ok()?,
        other => other,
    };
    match resolved {
        Object::Integer(v) => Some(*v as f64),
        Object::Real(v) => Some(f64::from(*v)),
        _ => None,
    }
}

fn load_font_file2_bytes(doc: &Document, descriptor: &Dictionary) -> Option<Vec<u8>> {
    let ff_obj = descriptor.get(b"FontFile2").ok()?;
    let (_, resolved) = doc.dereference(ff_obj).ok()?;
    let stream = resolved.as_stream().ok()?;
    stream.decompressed_content().ok().or_else(|| Some(stream.content.clone()))
}

impl FontMetricsMap {
    /// Extracts glyph character map & advance widths (in 1/1000 em units) from a PDF font dict.
    pub fn from_font_dict(doc: &Document, font_dict: &Dictionary) -> Self {
        let mut map = Self::default();
        map.family = classify_standard_font(font_dict);

        if let Ok(subtype) = font_dict.get(b"Subtype").and_then(Object::as_name) {
            if subtype == b"Type0" {
                map.is_two_byte = true;
                // PDF spec 1.7 Section 9.7.4: default DW for CIDFonts is 1000.
                map.default_width_thousandths = 1000.0;
            }
        }

        if let Ok(encoding) = font_dict.get(b"Encoding").and_then(Object::as_name) {
            if encoding.starts_with(b"Identity") {
                map.is_two_byte = true;
                map.default_width_thousandths = 1000.0;
            }
        }

        if let Ok(to_uni_obj) = font_dict.get(b"ToUnicode") {
            let resolved = match to_uni_obj {
                Object::Reference(id) => doc.get_object(*id).ok(),
                other => Some(other),
            };
            if let Some(Object::Stream(stream)) = resolved {
                if let Ok(bytes) = stream.decompressed_content() {
                    parse_tounicode_cmap(&bytes, &mut map.to_unicode);
                }
            }
        }

        if let Some(desc_dict) = resolve_dict(doc, font_dict, b"FontDescriptor") {
            if let Ok(mw) = desc_dict.get(b"MissingWidth") {
                if let Some(v) = read_number(doc, mw) {
                    if v > 0.0 {
                        map.default_width_thousandths = v;
                    }
                }
            }
        }

        if let Ok(first_char) = font_dict.get(b"FirstChar").and_then(Object::as_i64) {
            if let Some(widths) = font_dict
                .get(b"Widths")
                .ok()
                .and_then(|obj| doc.dereference(obj).ok())
                .and_then(|(_, o)| o.as_array().ok())
            {
                for (offset, w_obj) in widths.iter().enumerate() {
                    let Some(w) = read_number(doc, w_obj) else {
                        continue;
                    };
                    if let Ok(code) = u16::try_from(first_char + offset as i64) {
                        map.widths_thousandths.insert(code, w);
                    }
                }
            }
        }

        // Fill simple-font missing widths from embedded FontFile2 if available.
        if !map.is_two_byte {
            if let Some(desc_dict) = resolve_dict(doc, font_dict, b"FontDescriptor") {
                if let Some(ttf_bytes) = load_font_file2_bytes(doc, desc_dict) {
                    if let Ok(face) = Face::parse(&ttf_bytes, 0) {
                        let upm = f64::from(face.units_per_em().max(1));
                        for b in 0u16..=255u16 {
                            if map.widths_thousandths.contains_key(&b) {
                                continue;
                            }
                            let ch = map
                                .to_unicode
                                .get(&b)
                                .and_then(|s| s.chars().next())
                                .or_else(|| winansi_byte_to_char(b as u8));
                            if let Some(c) = ch {
                                if let Some(gid) = face.glyph_index(c) {
                                    if let Some(adv) = face.glyph_hor_advance(gid) {
                                        map.widths_thousandths.insert(b, (f64::from(adv) * 1000.0) / upm);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(desc_arr) = font_dict
            .get(b"DescendantFonts")
            .ok()
            .and_then(|obj| doc.dereference(obj).ok())
            .and_then(|(_, o)| o.as_array().ok())
        {
            if let Some(first_desc) = desc_arr.first() {
                if let Ok((_, Object::Dictionary(desc_dict))) = doc.dereference(first_desc) {
                    if map.family == StandardFontFamily::Other {
                        map.family = classify_standard_font(desc_dict);
                    }
                    let cid_descriptor = resolve_dict(doc, desc_dict, b"FontDescriptor");
                    if let Some(fd) = cid_descriptor {
                        if let Ok(mw) = fd.get(b"MissingWidth") {
                            if let Some(v) = read_number(doc, mw) {
                                if v > 0.0 {
                                    map.default_width_thousandths = v;
                                }
                            }
                        }
                    }
                    if let Ok(dw) = desc_dict.get(b"DW") {
                        map.default_width_thousandths = read_number(doc, dw).unwrap_or(1000.0);
                    }
                    if let Some(w_arr) = desc_dict
                        .get(b"W")
                        .ok()
                        .and_then(|obj| doc.dereference(obj).ok())
                        .and_then(|(_, o)| o.as_array().ok())
                    {
                        parse_cid_widths_array(doc, w_arr, &mut map.widths_thousandths);
                    }

                    // Fallback to embedded TTF hmtx widths when /W leaves gaps or uses Identity/Stream CIDToGIDMap.
                    if let Some(fd) = cid_descriptor {
                        if let Some(ttf_bytes) = load_font_file2_bytes(doc, fd) {
                            if let Ok(face) = Face::parse(&ttf_bytes, 0) {
                                let upm = f64::from(face.units_per_em().max(1));
                                let gid_stream_bytes = desc_dict
                                    .get(b"CIDToGIDMap")
                                    .ok()
                                    .and_then(|obj| doc.dereference(obj).ok())
                                    .and_then(|(_, o)| o.as_stream().ok().cloned())
                                    .and_then(|s| s.decompressed_content().ok().or(Some(s.content)));
                                let is_identity_map = desc_dict
                                    .get(b"CIDToGIDMap")
                                    .and_then(Object::as_name)
                                    .map(|n| n == b"Identity")
                                    .unwrap_or(gid_stream_bytes.is_none());

                                if is_identity_map || gid_stream_bytes.is_some() {
                                    let max_cid = face.number_of_glyphs();
                                    let keys: Vec<u16> = map.to_unicode.keys().copied().collect();
                                    for code in keys {
                                        if map.widths_thousandths.contains_key(&code) {
                                            continue;
                                        }
                                        let gid = if let Some(ref table) = gid_stream_bytes {
                                            let off = (code as usize) * 2;
                                            if off + 1 < table.len() {
                                                u16::from_be_bytes([table[off], table[off + 1]])
                                            } else {
                                                code
                                            }
                                        } else {
                                            code
                                        };
                                        if gid < max_cid {
                                            if let Some(adv) = face.glyph_hor_advance(GlyphId(gid)) {
                                                map.widths_thousandths
                                                    .insert(code, (f64::from(adv) * 1000.0) / upm);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        map
    }

    /// Splits a PDF literal/hex string operand into raw code tokens + Unicode estimates + advance (1/1000 em).
    pub fn decode_glyphs(&self, raw: &[u8]) -> Vec<DecodedGlyph> {
        let mut out = Vec::new();
        if self.is_two_byte {
            for chunk in raw.chunks(2) {
                let code = if chunk.len() == 2 {
                    u16::from_be_bytes([chunk[0], chunk[1]])
                } else {
                    chunk[0] as u16
                };
                let text = self
                    .to_unicode
                    .get(&code)
                    .cloned()
                    .unwrap_or_else(|| char::from_u32(code as u32).map(|c| c.to_string()).unwrap_or_default());
                let w = self
                    .widths_thousandths
                    .get(&code)
                    .copied()
                    .unwrap_or_else(|| {
                        if let Some(ch) = text.chars().next() {
                            if let Some(est) = estimate_standard_char_width(self.family, ch) {
                                return est;
                            }
                        }
                        self.default_width_thousandths
                    });
                out.push(DecodedGlyph {
                    raw_bytes: chunk.to_vec(),
                    unicode: text,
                    width_thousandths: w,
                });
            }
        } else {
            for &b in raw {
                let code = b as u16;
                let text = self
                    .to_unicode
                    .get(&code)
                    .cloned()
                    .unwrap_or_else(|| {
                        winansi_byte_to_char(b)
                            .unwrap_or(b as char)
                            .to_string()
                    });
                let w = self
                    .widths_thousandths
                    .get(&code)
                    .copied()
                    .unwrap_or_else(|| {
                        if self.family != StandardFontFamily::Other {
                            if let Some(ch) = text.chars().next() {
                                if let Some(est) = estimate_standard_char_width(self.family, ch) {
                                    return est;
                                }
                            }
                        }
                        estimate_winansi_width_thousandths(self.family, b)
                    });
                out.push(DecodedGlyph {
                    raw_bytes: vec![b],
                    unicode: text,
                    width_thousandths: w,
                });
            }
        }
        out
    }
}

#[derive(Debug, Clone)]
pub struct DecodedGlyph {
    pub raw_bytes: Vec<u8>,
    pub unicode: String,
    pub width_thousandths: f64,
}

fn winansi_byte_to_char(b: u8) -> Option<char> {
    let ch = match b {
        0x80 => '\u{20AC}',
        0x85 => '\u{2026}',
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201C}',
        0x94 => '\u{201D}',
        0x95 => '\u{2022}',
        0x96 => '\u{2013}',
        0x97 => '\u{2014}',
        0xD0 => 'Ğ',
        0xDD => 'İ',
        0xDE => 'Ş',
        0xF0 => 'ğ',
        0xFD => 'ı',
        0xFE => 'ş',
        _ => return Some(b as char),
    };
    Some(ch)
}

fn estimate_standard_char_width(family: StandardFontFamily, ch: char) -> Option<f64> {
    if family == StandardFontFamily::Courier {
        return Some(600.0);
    }
    if family == StandardFontFamily::Times {
        let w = match ch {
            ' ' => 250.0,
            '!' | '|' | '\'' | '`' | '.' | ',' | ':' | ';' | 'i' | 'l' | 'j' | 'ı' => 278.0,
            'f' | 'r' | 't' | '-' | '(' | ')' | '[' | ']' | '/' => 333.0,
            'a' | 'e' | 'c' | 's' | 'z' | 'ç' | 'ş' => 444.0,
            'b' | 'd' | 'g' | 'h' | 'k' | 'n' | 'o' | 'p' | 'q' | 'u' | 'v' | 'x' | 'y'
            | 'ğ' | 'ö' | 'ü' | '0'..='9' => 500.0,
            'w' => 722.0,
            'm' => 778.0,
            'I' | 'İ' => 333.0,
            'J' | 'L' | 'F' | 'E' | 'S' | 'P' | 'T' | 'Z' | 'Ş' => 611.0,
            'A' | 'B' | 'C' | 'D' | 'G' | 'H' | 'K' | 'N' | 'O' | 'Q' | 'R' | 'U' | 'V' | 'X' | 'Y'
            | 'Ç' | 'Ğ' | 'Ö' | 'Ü' => 722.0,
            'M' | 'W' => 944.0,
            _ => return None,
        };
        return Some(w);
    }
    let scale = if family == StandardFontFamily::HelveticaBold {
        1.04
    } else {
        1.0
    };
    let w = match ch {
        ' ' | '!' | '|' | '\'' | '`' | '.' | ',' | ':' | ';' => 278.0,
        'i' | 'l' | 'j' | 'ı' => 222.0,
        'f' | 't' | '-' | '/' => 278.0,
        'r' | '(' | ')' | '[' | ']' => 333.0,
        'c' | 'k' | 's' | 'v' | 'x' | 'z' | 'ç' | 'ş' => 500.0,
        'a' | 'b' | 'd' | 'e' | 'g' | 'h' | 'n' | 'o' | 'p' | 'q' | 'u' | 'y'
        | 'ğ' | 'ö' | 'ü' | '0'..='9' => 556.0,
        'w' => 722.0,
        'm' => 833.0,
        'I' | 'İ' => 278.0,
        'J' => 500.0,
        'L' => 556.0,
        'F' | 'T' | 'Z' => 611.0,
        'B' | 'E' | 'K' | 'P' | 'S' | 'Ş' => 667.0,
        'A' | 'C' | 'D' | 'H' | 'N' | 'R' | 'U' | 'V' | 'X' | 'Y' | 'Ç' | 'Ü' => 722.0,
        'G' | 'O' | 'Q' | 'Ğ' | 'Ö' => 778.0,
        'M' => 833.0,
        'W' => 944.0,
        _ => return None,
    };
    Some(w * scale)
}

fn estimate_winansi_width_thousandths(family: StandardFontFamily, b: u8) -> f64 {
    if let Some(ch) = winansi_byte_to_char(b) {
        if let Some(w) = estimate_standard_char_width(
            if family == StandardFontFamily::Other {
                StandardFontFamily::Helvetica
            } else {
                family
            },
            ch,
        ) {
            return w;
        }
    }
    556.0
}

fn parse_cid_widths_array(doc: &Document, arr: &[Object], out: &mut HashMap<u16, f64>) {
    let mut i = 0;
    while i + 1 < arr.len() {
        let Some(c_start) = doc
            .dereference(&arr[i])
            .ok()
            .and_then(|(_, o)| o.as_i64().ok())
            .or_else(|| arr[i].as_i64().ok())
        else {
            i += 1;
            continue;
        };
        let next_resolved = doc
            .dereference(&arr[i + 1])
            .map(|(_, o)| o)
            .unwrap_or(&arr[i + 1]);
        match next_resolved {
            Object::Array(widths) => {
                for (offset, w_obj) in widths.iter().enumerate() {
                    let Some(w) = read_number(doc, w_obj) else {
                        continue;
                    };
                    if let Ok(code) = u16::try_from(c_start + offset as i64) {
                        out.insert(code, w);
                    }
                }
                i += 2;
            }
            Object::Integer(c_end) if i + 2 < arr.len() => {
                let w = read_number(doc, &arr[i + 2]).unwrap_or(1000.0);
                for c in c_start..=*c_end {
                    if let Ok(code) = u16::try_from(c) {
                        out.insert(code, w);
                    }
                }
                i += 3;
            }
            _ => i += 1,
        }
    }
}

fn parse_tounicode_cmap(bytes: &[u8], out: &mut HashMap<u16, String>) {
    let text = String::from_utf8_lossy(bytes);
    // Split keeping `[` and `]` separated so `beginbfrange` array forms parse cleanly.
    let normalized = text.replace('[', " [ ").replace(']', " ] ");
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    let mut i = 0;
    while i < tokens.len() {
        match tokens[i] {
            "beginbfchar" => {
                i += 1;
                while i + 1 < tokens.len() && tokens[i] != "endbfchar" {
                    if let (Some(src), Some(dst)) =
                        (parse_hex_u16(tokens[i]), parse_hex_utf16_string(tokens[i + 1]))
                    {
                        out.insert(src, dst);
                    }
                    i += 2;
                }
            }
            "beginbfrange" => {
                i += 1;
                while i + 2 < tokens.len() && tokens[i] != "endbfrange" {
                    if let (Some(lo), Some(hi)) =
                        (parse_hex_u16(tokens[i]), parse_hex_u16(tokens[i + 1]))
                    {
                        if tokens[i + 2] == "[" {
                            let mut j = i + 3;
                            let mut offset = 0u16;
                            while j < tokens.len() && tokens[j] != "]" {
                                if lo + offset <= hi {
                                    if let Some(dst) = parse_hex_utf16_string(tokens[j]) {
                                        out.insert(lo + offset, dst);
                                    }
                                }
                                offset = offset.saturating_add(1);
                                j += 1;
                            }
                            i = if j < tokens.len() { j + 1 } else { j };
                            continue;
                        } else if let Some(base_str) = parse_hex_utf16_string(tokens[i + 2]) {
                            let mut base_chars: Vec<u16> = base_str.encode_utf16().collect();
                            if let Some(&start_last) = base_chars.last() {
                                let last_idx = base_chars.len() - 1;
                                for offset in 0..=(hi.saturating_sub(lo)) {
                                    base_chars[last_idx] = start_last.saturating_add(offset);
                                    out.insert(
                                        lo + offset,
                                        String::from_utf16_lossy(&base_chars),
                                    );
                                }
                            }
                        }
                    }
                    i += 3;
                }
            }
            _ => i += 1,
        }
    }
}

fn parse_hex_u16(tok: &str) -> Option<u16> {
    let hex = tok.strip_prefix('<')?.strip_suffix('>')?;
    u16::from_str_radix(hex, 16).ok()
}

fn parse_hex_utf16_string(tok: &str) -> Option<String> {
    let hex = tok.strip_prefix('<')?.strip_suffix('>')?;
    if hex.len() == 2 {
        let b = u8::from_str_radix(hex, 16).ok()?;
        return Some((b as char).to_string());
    }
    if hex.len() % 4 != 0 || hex.is_empty() {
        return None;
    }
    let mut units = Vec::with_capacity(hex.len() / 4);
    for chunk in hex.as_bytes().chunks_exact(4) {
        let s = std::str::from_utf8(chunk).ok()?;
        units.push(u16::from_str_radix(s, 16).ok()?);
    }
    Some(String::from_utf16_lossy(&units))
}
