//! Derives a `unicode -> glyph id` mapping for an embedded PDF font from the PDF's own
//! resources (`/ToUnicode`, `/Encoding` + `/Differences`, `/CIDToGIDMap`) so subset fonts whose
//! internal `cmap` only knows private character codes can be re-exposed with a Unicode `cmap`.

use std::collections::{BTreeMap, HashMap};

use gp_text::font_unicode::{
    existing_unicode_glyph_map, glyph_count, glyph_for_simple_font_code,
    rebuild_ttf_with_unicode_cmap,
};
use lopdf::{Dictionary, Document, Object};

fn resolve<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Object> {
    match obj {
        Object::Reference(id) => doc.get_object(*id).ok(),
        other => Some(other),
    }
}

#[derive(Debug, PartialEq)]
enum Tok {
    Hex(Vec<u8>),
    Open,
    Close,
    Word(String),
}

fn tokenize_cmap(bytes: &[u8]) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'<' if bytes.get(i + 1) != Some(&b'<') => {
                let mut j = i + 1;
                let mut hex = Vec::new();
                while j < bytes.len() && bytes[j] != b'>' {
                    if bytes[j].is_ascii_hexdigit() {
                        hex.push(bytes[j]);
                    }
                    j += 1;
                }
                if hex.len() % 2 == 1 {
                    hex.push(b'0');
                }
                let decoded = hex
                    .chunks(2)
                    .filter_map(|c| u8::from_str_radix(std::str::from_utf8(c).ok()?, 16).ok())
                    .collect();
                out.push(Tok::Hex(decoded));
                i = j + 1;
            }
            b'[' => {
                out.push(Tok::Open);
                i += 1;
            }
            b']' => {
                out.push(Tok::Close);
                i += 1;
            }
            b'%' => {
                while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' {
                    i += 1;
                }
            }
            b'(' => {
                // Literal strings are not used for code mappings; skip them balanced.
                let mut depth = 0;
                while i < bytes.len() {
                    match bytes[i] {
                        b'\\' => i += 1,
                        b'(' => depth += 1,
                        b')' => {
                            depth -= 1;
                            if depth == 0 {
                                i += 1;
                                break;
                            }
                        }
                        _ => {}
                    }
                    i += 1;
                }
            }
            c if c.is_ascii_whitespace() => i += 1,
            _ => {
                let mut j = i;
                while j < bytes.len()
                    && !bytes[j].is_ascii_whitespace()
                    && !matches!(bytes[j], b'<' | b'>' | b'[' | b']' | b'(' | b'/' | b'%')
                {
                    j += 1;
                }
                if j == i {
                    j += 1;
                }
                out.push(Tok::Word(String::from_utf8_lossy(&bytes[i..j]).to_string()));
                i = j;
            }
        }
    }
    out
}

fn be_code(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0u32, |acc, &b| (acc << 8) | u32::from(b))
}

fn utf16be_to_string(bytes: &[u8]) -> Option<String> {
    if bytes.len() == 1 {
        return char::from_u32(u32::from(bytes[0])).map(|c| c.to_string());
    }
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = bytes.chunks(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
    String::from_utf16(&units).ok()
}

/// Parses a `/ToUnicode` CMap into `code -> unicode string`.
pub(crate) fn parse_to_unicode(bytes: &[u8]) -> HashMap<u32, String> {
    let toks = tokenize_cmap(bytes);
    let mut out = HashMap::new();
    let mut i = 0;
    while i < toks.len() {
        match &toks[i] {
            Tok::Word(w) if w == "beginbfchar" => {
                i += 1;
                while i + 1 < toks.len() {
                    if matches!(&toks[i], Tok::Word(w) if w == "endbfchar") {
                        break;
                    }
                    if let (Tok::Hex(src), Tok::Hex(dst)) = (&toks[i], &toks[i + 1]) {
                        if let Some(s) = utf16be_to_string(dst) {
                            out.insert(be_code(src), s);
                        }
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
            }
            Tok::Word(w) if w == "beginbfrange" => {
                i += 1;
                while i + 2 < toks.len() {
                    if matches!(&toks[i], Tok::Word(w) if w == "endbfrange") {
                        break;
                    }
                    let (Tok::Hex(lo), Tok::Hex(hi)) = (&toks[i], &toks[i + 1]) else {
                        i += 1;
                        continue;
                    };
                    let (lo, hi) = (be_code(lo), be_code(hi));
                    if hi < lo || hi - lo > 0xFFFF {
                        i += 3;
                        continue;
                    }
                    match &toks[i + 2] {
                        Tok::Hex(dst) => {
                            if dst.len() >= 2 && dst.len() % 2 == 0 {
                                let mut units: Vec<u16> =
                                    dst.chunks(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                                let last = units.len() - 1;
                                let base = units[last];
                                for off in 0..=(hi - lo) {
                                    units[last] = base.wrapping_add(off as u16);
                                    if let Ok(s) = String::from_utf16(&units) {
                                        out.insert(lo + off, s);
                                    }
                                }
                            } else if dst.len() == 1 {
                                for off in 0..=(hi - lo) {
                                    if let Some(c) = char::from_u32(u32::from(dst[0]) + off) {
                                        out.insert(lo + off, c.to_string());
                                    }
                                }
                            }
                            i += 3;
                        }
                        Tok::Open => {
                            let mut j = i + 3;
                            let mut code = lo;
                            while j < toks.len() && toks[j] != Tok::Close {
                                if let Tok::Hex(dst) = &toks[j] {
                                    if let Some(s) = utf16be_to_string(dst) {
                                        out.insert(code, s);
                                    }
                                    code += 1;
                                }
                                j += 1;
                            }
                            i = j + 1;
                        }
                        _ => i += 3,
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }
    out
}

const WIN_ANSI_80_9F: [u32; 32] = [
    0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039,
    0x0152, 0, 0x017D, 0, 0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC,
    0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178,
];

fn win_ansi_unicode(code: u8) -> Option<u32> {
    match code {
        0x20..=0x7E => Some(u32::from(code)),
        0x80..=0x9F => Some(WIN_ANSI_80_9F[(code - 0x80) as usize]).filter(|&u| u != 0),
        0xA0..=0xFF => Some(u32::from(code)),
        _ => None,
    }
}

fn glyph_name_unicode(name: &str) -> Option<u32> {
    if name.len() == 1 {
        let c = name.chars().next()?;
        if c.is_ascii_alphabetic() {
            return Some(c as u32);
        }
    }
    if let Some(hex) = name.strip_prefix("uni") {
        if hex.len() >= 4 {
            return u32::from_str_radix(&hex[..4], 16).ok();
        }
    }
    if let Some(hex) = name.strip_prefix('u') {
        if (4..=6).contains(&hex.len()) {
            if let Ok(v) = u32::from_str_radix(hex, 16) {
                return Some(v);
            }
        }
    }
    let known: &[(&str, u32)] = &[
        ("space", 0x20), ("exclam", 0x21), ("quotedbl", 0x22), ("numbersign", 0x23),
        ("dollar", 0x24), ("percent", 0x25), ("ampersand", 0x26), ("quotesingle", 0x27),
        ("parenleft", 0x28), ("parenright", 0x29), ("asterisk", 0x2A), ("plus", 0x2B),
        ("comma", 0x2C), ("hyphen", 0x2D), ("period", 0x2E), ("slash", 0x2F), ("zero", 0x30),
        ("one", 0x31), ("two", 0x32), ("three", 0x33), ("four", 0x34), ("five", 0x35),
        ("six", 0x36), ("seven", 0x37), ("eight", 0x38), ("nine", 0x39), ("colon", 0x3A),
        ("semicolon", 0x3B), ("less", 0x3C), ("equal", 0x3D), ("greater", 0x3E),
        ("question", 0x3F), ("at", 0x40), ("bracketleft", 0x5B), ("backslash", 0x5C),
        ("bracketright", 0x5D), ("asciicircum", 0x5E), ("underscore", 0x5F), ("grave", 0x60),
        ("braceleft", 0x7B), ("bar", 0x7C), ("braceright", 0x7D), ("asciitilde", 0x7E),
        ("quoteleft", 0x2018), ("quoteright", 0x2019), ("quotedblleft", 0x201C),
        ("quotedblright", 0x201D), ("endash", 0x2013), ("emdash", 0x2014), ("bullet", 0x2022),
        ("ellipsis", 0x2026), ("Euro", 0x20AC), ("degree", 0xB0), ("section", 0xA7),
        ("copyright", 0xA9), ("registered", 0xAE), ("trademark", 0x2122), ("fi", 0xFB01),
        ("fl", 0xFB02), ("gbreve", 0x011F), ("Gbreve", 0x011E), ("scedilla", 0x015F),
        ("Scedilla", 0x015E), ("dotlessi", 0x0131), ("Idotaccent", 0x0130), ("Idot", 0x0130),
        ("odieresis", 0xF6), ("Odieresis", 0xD6), ("udieresis", 0xFC), ("Udieresis", 0xDC),
        ("ccedilla", 0xE7), ("Ccedilla", 0xC7), ("adieresis", 0xE4), ("Adieresis", 0xC4),
        ("aacute", 0xE1), ("eacute", 0xE9), ("iacute", 0xED), ("oacute", 0xF3),
        ("uacute", 0xFA), ("agrave", 0xE0), ("egrave", 0xE8), ("acircumflex", 0xE2),
        ("ecircumflex", 0xEA), ("icircumflex", 0xEE), ("ocircumflex", 0xF4),
        ("ucircumflex", 0xFB), ("Acircumflex", 0xC2), ("germandbls", 0xDF), ("nbspace", 0xA0),
    ];
    known.iter().find(|(n, _)| *n == name).map(|(_, u)| *u)
}

fn simple_font_encoding(doc: &Document, font_dict: &Dictionary) -> HashMap<u8, u32> {
    let mut map: HashMap<u8, u32> = HashMap::new();
    for code in 0u8..=255 {
        if let Some(u) = win_ansi_unicode(code) {
            map.insert(code, u);
        }
    }
    let Some(enc) = font_dict.get(b"Encoding").ok().and_then(|o| resolve(doc, o)) else {
        return map;
    };
    if let Object::Dictionary(enc_dict) = enc {
        if let Some(Object::Array(diffs)) = enc_dict.get(b"Differences").ok().and_then(|o| resolve(doc, o)) {
            let mut code: i64 = 0;
            for item in diffs {
                match item {
                    Object::Integer(c) => code = *c,
                    Object::Name(n) => {
                        if (0..=255).contains(&code) {
                            if let Some(u) = glyph_name_unicode(&String::from_utf8_lossy(n)) {
                                map.insert(code as u8, u);
                            }
                        }
                        code += 1;
                    }
                    _ => {}
                }
            }
        }
    }
    map
}

/// Computes `unicode -> glyph id` for the glyphs this PDF font actually displays.
pub(crate) fn pdf_font_unicode_glyph_map(
    doc: &Document,
    font_dict: &Dictionary,
    ttf: &[u8],
) -> BTreeMap<u32, u16> {
    let mut out = BTreeMap::new();
    let n_glyphs = glyph_count(ttf);
    if n_glyphs == 0 {
        return out;
    }
    let to_unicode = font_dict
        .get(b"ToUnicode")
        .ok()
        .and_then(|o| resolve(doc, o))
        .and_then(|o| match o {
            Object::Stream(s) => s.decompressed_content().ok(),
            _ => None,
        })
        .map(|b| parse_to_unicode(&b))
        .unwrap_or_default();

    let single_char = |s: &str| -> Option<u32> {
        let mut it = s.chars();
        let c = it.next()?;
        if it.next().is_some() {
            return None;
        }
        Some(c as u32).filter(|&u| u >= 0x20 && u != 0xFFFD)
    };

    let subtype = font_dict.get(b"Subtype").and_then(Object::as_name).unwrap_or(b"");
    if subtype == b"Type0" {
        let encoding_ok = font_dict
            .get(b"Encoding")
            .and_then(Object::as_name)
            .map(|n| n.starts_with(b"Identity"))
            .unwrap_or(false);
        if !encoding_ok {
            return out;
        }
        let Some(desc) = font_dict
            .get(b"DescendantFonts")
            .ok()
            .and_then(|o| resolve(doc, o))
            .and_then(|o| o.as_array().ok())
            .and_then(|a| a.first())
            .and_then(|o| resolve(doc, o))
            .and_then(|o| o.as_dict().ok())
        else {
            return out;
        };
        let cid_to_gid: Option<Vec<u8>> = desc
            .get(b"CIDToGIDMap")
            .ok()
            .and_then(|o| resolve(doc, o))
            .and_then(|o| match o {
                Object::Stream(s) => s.decompressed_content().ok(),
                _ => None,
            });
        for (&code, uni) in &to_unicode {
            let Some(u) = single_char(uni) else {
                continue;
            };
            let gid = match &cid_to_gid {
                Some(map) => {
                    let idx = code as usize * 2;
                    if idx + 1 >= map.len() {
                        continue;
                    }
                    u16::from_be_bytes([map[idx], map[idx + 1]])
                }
                None => match u16::try_from(code) {
                    Ok(g) => g,
                    Err(_) => continue,
                },
            };
            if gid != 0 && gid < n_glyphs {
                out.entry(u).or_insert(gid);
            }
        }
        return out;
    }

    if subtype != b"TrueType" {
        return out;
    }
    let encoding = simple_font_encoding(doc, font_dict);
    for code in 0u8..=255 {
        let uni = to_unicode
            .get(&u32::from(code))
            .and_then(|s| single_char(s))
            .or_else(|| if to_unicode.is_empty() { encoding.get(&code).copied() } else { None });
        let Some(u) = uni else {
            continue;
        };
        if let Some(gid) = glyph_for_simple_font_code(ttf, code) {
            if gid < n_glyphs {
                out.entry(u).or_insert(gid);
            }
        }
    }
    out
}

/// Returns font bytes whose `cmap` exposes every glyph the PDF displays under its Unicode value
/// (rebuilding the table when the embedded subset only mapped private character codes).
pub(crate) fn unicode_ready_font_bytes(doc: &Document, font_dict: &Dictionary, ttf: Vec<u8>) -> Vec<u8> {
    let derived = pdf_font_unicode_glyph_map(doc, font_dict, &ttf);
    if derived.is_empty() {
        return ttf;
    }
    let mut merged = existing_unicode_glyph_map(&ttf);
    let mut changed = false;
    for (cp, gid) in derived {
        if merged.insert(cp, gid) != Some(gid) {
            changed = true;
        }
    }
    if !changed {
        return ttf;
    }
    rebuild_ttf_with_unicode_cmap(&ttf, &merged).unwrap_or(ttf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bfchar_and_bfrange_without_spaces() {
        let cmap = b"/CIDInit /ProcSet findresource begin 2 beginbfchar <01><0042> <0002> <011F> endbfchar\n1 beginbfrange <10><12><0061> endbfrange 1 beginbfrange <20> <21> [<015F> <0131>] endbfrange end";
        let m = parse_to_unicode(cmap);
        assert_eq!(m.get(&1).map(String::as_str), Some("B"));
        assert_eq!(m.get(&2).map(String::as_str), Some("ğ"));
        assert_eq!(m.get(&0x10).map(String::as_str), Some("a"));
        assert_eq!(m.get(&0x12).map(String::as_str), Some("c"));
        assert_eq!(m.get(&0x20).map(String::as_str), Some("ş"));
        assert_eq!(m.get(&0x21).map(String::as_str), Some("ı"));
    }
}
