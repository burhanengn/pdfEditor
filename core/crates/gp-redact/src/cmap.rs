use std::collections::HashMap;

use lopdf::{Dictionary, Document, Object};

#[derive(Debug, Clone)]
pub struct FontMetricsMap {
    pub is_two_byte: bool,
    pub to_unicode: HashMap<u16, String>,
    pub widths_thousandths: HashMap<u16, f64>,
    pub default_width_thousandths: f64,
}

impl Default for FontMetricsMap {
    fn default() -> Self {
        Self {
            is_two_byte: false,
            to_unicode: HashMap::new(),
            widths_thousandths: HashMap::new(),
            default_width_thousandths: 520.0,
        }
    }
}

impl FontMetricsMap {
    /// Extracts glyph character map & advance widths (in 1/1000 em units) from a PDF font dict.
    pub fn from_font_dict(doc: &Document, font_dict: &Dictionary) -> Self {
        let mut map = Self::default();

        if let Ok(subtype) = font_dict.get(b"Subtype").and_then(Object::as_name) {
            if subtype == b"Type0" {
                map.is_two_byte = true;
            }
        }

        if let Ok(encoding) = font_dict.get(b"Encoding").and_then(Object::as_name) {
            if encoding.starts_with(b"Identity") {
                map.is_two_byte = true;
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

        if let Ok(first_char) = font_dict.get(b"FirstChar").and_then(Object::as_i64) {
            if let Some(widths) = font_dict
                .get(b"Widths")
                .ok()
                .and_then(|obj| doc.dereference(obj).ok())
                .and_then(|(_, o)| o.as_array().ok())
            {
                for (offset, w_obj) in widths.iter().enumerate() {
                    let w = match w_obj {
                        Object::Integer(v) => *v as f64,
                        Object::Real(v) => f64::from(*v),
                        _ => 520.0,
                    };
                    if let Ok(code) = u16::try_from(first_char + offset as i64) {
                        map.widths_thousandths.insert(code, w);
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
                    if let Ok(dw) = desc_dict.get(b"DW") {
                        map.default_width_thousandths = match dw {
                            Object::Integer(v) => *v as f64,
                            Object::Real(v) => f64::from(*v),
                            _ => 1000.0,
                        };
                    }
                    if let Some(w_arr) = desc_dict
                        .get(b"W")
                        .ok()
                        .and_then(|obj| doc.dereference(obj).ok())
                        .and_then(|(_, o)| o.as_array().ok())
                    {
                        parse_cid_widths_array(w_arr, &mut map.widths_thousandths);
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
                    .unwrap_or(self.default_width_thousandths);
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
                    .unwrap_or_else(|| (b as char).to_string());
                let w = self
                    .widths_thousandths
                    .get(&code)
                    .copied()
                    .unwrap_or_else(|| estimate_winansi_width_thousandths(b));
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

fn estimate_winansi_width_thousandths(b: u8) -> f64 {
    match b {
        b' ' => 278.0,
        b'i' | b'l' | b'I' | b'.' | b',' | b':' | b';' | b'!' | b'|' => 278.0,
        b'f' | b'j' | b'r' | b't' | b'-' => 333.0,
        b'm' | b'w' | b'M' | b'W' => 833.0,
        b'A'..=b'Z' => 667.0,
        b'0'..=b'9' => 556.0,
        _ => 540.0,
    }
}

fn parse_cid_widths_array(arr: &[Object], out: &mut HashMap<u16, f64>) {
    let mut i = 0;
    while i + 1 < arr.len() {
        let Ok(c_start) = arr[i].as_i64() else {
            i += 1;
            continue;
        };
        match &arr[i + 1] {
            Object::Array(widths) => {
                for (offset, w_obj) in widths.iter().enumerate() {
                    let w = match w_obj {
                        Object::Integer(v) => *v as f64,
                        Object::Real(v) => f64::from(*v),
                        _ => continue,
                    };
                    if let Ok(code) = u16::try_from(c_start + offset as i64) {
                        out.insert(code, w);
                    }
                }
                i += 2;
            }
            Object::Integer(c_end) if i + 2 < arr.len() => {
                let w = match &arr[i + 2] {
                    Object::Integer(v) => *v as f64,
                    Object::Real(v) => f64::from(*v),
                    _ => 520.0,
                };
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
    let tokens: Vec<&str> = text.split_whitespace().collect();
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
                        if let Some(base_str) = parse_hex_utf16_string(tokens[i + 2]) {
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
