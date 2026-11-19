//! Rewrites the `cmap` table of an embedded (usually subset) TrueType/OpenType font so it maps
//! real Unicode code points to glyph ids.
//!
//! PDF producers frequently embed subset fonts whose internal `cmap` maps the PDF's private
//! character codes (Mac Roman / symbol `(3,0)` / identity CIDs) instead of Unicode. Platform text
//! engines (Android `Typeface`, browsers) look glyphs up by Unicode, so such fonts silently fall
//! back to a system face and the edited paragraph no longer looks like the original. Given a
//! `unicode -> glyph id` mapping derived from the PDF (`ToUnicode` + encoding/CIDToGIDMap), this
//! module emits a new font with Windows Unicode BMP `(3,1)` / `(0,3)` format 4 and, when needed,
//! full-repertoire `(3,10)` format 12 subtables. All other tables are copied byte-for-byte.

use std::collections::BTreeMap;

/// Returns the existing Unicode -> glyph id mappings exposed by the font's Unicode `cmap`
/// subtables (platform 0, or platform 3 encodings 1/10).
pub fn existing_unicode_glyph_map(ttf: &[u8]) -> BTreeMap<u32, u16> {
    let mut out = BTreeMap::new();
    let Ok(face) = ttf_parser::Face::parse(ttf, 0) else {
        return out;
    };
    if let Some(cmap) = face.tables().cmap {
        for sub in cmap.subtables {
            if !sub.is_unicode() {
                continue;
            }
            sub.codepoints(|cp| {
                if let Some(g) = sub.glyph_index(cp) {
                    if g.0 != 0 {
                        out.entry(cp).or_insert(g.0);
                    }
                }
            });
        }
    }
    out
}

/// Looks up `code` in the font's non-Unicode cmap subtables the way PDF consumers resolve
/// simple TrueType fonts: `(3,0)` symbol (raw code or `0xF000 + code`), then `(1,0)` Mac Roman.
pub fn glyph_for_simple_font_code(ttf: &[u8], code: u8) -> Option<u16> {
    let face = ttf_parser::Face::parse(ttf, 0).ok()?;
    let cmap = face.tables().cmap?;
    let code = u32::from(code);
    let mut mac: Option<u16> = None;
    for sub in cmap.subtables {
        let pid = sub.platform_id;
        if pid == ttf_parser::PlatformId::Windows && sub.encoding_id == 0 {
            for probe in [code, 0xF000 + code, 0xF100 + code, 0xF200 + code] {
                if let Some(g) = sub.glyph_index(probe) {
                    if g.0 != 0 {
                        return Some(g.0);
                    }
                }
            }
        } else if pid == ttf_parser::PlatformId::Macintosh && sub.encoding_id == 0 && mac.is_none() {
            if let Some(g) = sub.glyph_index(code) {
                if g.0 != 0 {
                    mac = Some(g.0);
                }
            }
        }
    }
    mac
}

/// Number of glyphs declared by the font's `maxp` table.
pub fn glyph_count(ttf: &[u8]) -> u16 {
    ttf_parser::Face::parse(ttf, 0)
        .map(|f| f.number_of_glyphs())
        .unwrap_or(0)
}

fn be16(v: u16, out: &mut Vec<u8>) {
    out.extend_from_slice(&v.to_be_bytes());
}

fn be32(v: u32, out: &mut Vec<u8>) {
    out.extend_from_slice(&v.to_be_bytes());
}

fn build_format4(map: &BTreeMap<u32, u16>) -> Vec<u8> {
    // Segments of consecutive code points whose glyph ids are also consecutive (idDelta form).
    let mut segs: Vec<(u16, u16, u16)> = Vec::new(); // (start, end, delta)
    for (&cp, &gid) in map.iter().filter(|(&cp, _)| cp < 0xFFFF) {
        let cp = cp as u16;
        let delta = gid.wrapping_sub(cp);
        if let Some(last) = segs.last_mut() {
            if last.1.wrapping_add(1) == cp && last.2 == delta {
                last.1 = cp;
                continue;
            }
        }
        segs.push((cp, cp, delta));
    }
    segs.push((0xFFFF, 0xFFFF, 1));

    let seg_count = segs.len() as u16;
    let mut pow = 1u16;
    let mut entry_selector = 0u16;
    while pow * 2 <= seg_count {
        pow *= 2;
        entry_selector += 1;
    }
    let search_range = pow * 2;
    let range_shift = seg_count * 2 - search_range;
    let length = 16 + 8 * seg_count as usize;

    let mut out = Vec::with_capacity(length);
    be16(4, &mut out);
    be16(length as u16, &mut out);
    be16(0, &mut out);
    be16(seg_count * 2, &mut out);
    be16(search_range, &mut out);
    be16(entry_selector, &mut out);
    be16(range_shift, &mut out);
    for s in &segs {
        be16(s.1, &mut out);
    }
    be16(0, &mut out); // reservedPad
    for s in &segs {
        be16(s.0, &mut out);
    }
    for s in &segs {
        be16(s.2, &mut out);
    }
    for _ in &segs {
        be16(0, &mut out); // idRangeOffset
    }
    out
}

fn build_format12(map: &BTreeMap<u32, u16>) -> Vec<u8> {
    let mut groups: Vec<(u32, u32, u32)> = Vec::new();
    for (&cp, &gid) in map {
        let gid = u32::from(gid);
        if let Some(last) = groups.last_mut() {
            if last.1 + 1 == cp && last.2 + (cp - last.0) == gid {
                last.1 = cp;
                continue;
            }
        }
        groups.push((cp, cp, gid));
    }
    let length = 16 + 12 * groups.len();
    let mut out = Vec::with_capacity(length);
    be16(12, &mut out);
    be16(0, &mut out);
    be32(length as u32, &mut out);
    be32(0, &mut out);
    be32(groups.len() as u32, &mut out);
    for g in &groups {
        be32(g.0, &mut out);
        be32(g.1, &mut out);
        be32(g.2, &mut out);
    }
    out
}

fn build_cmap_table(map: &BTreeMap<u32, u16>) -> Vec<u8> {
    let f4 = build_format4(map);
    let needs_f12 = map.keys().any(|&cp| cp > 0xFFFF);
    let f12 = if needs_f12 { Some(build_format12(map)) } else { None };

    let num_records: u16 = if needs_f12 { 4 } else { 2 };
    let header_len = 4 + 8 * num_records as u32;
    let f4_off = header_len;
    let f12_off = f4_off + f4.len() as u32;

    let mut out = Vec::new();
    be16(0, &mut out);
    be16(num_records, &mut out);
    // Encoding records must be sorted by (platformID, encodingID).
    be16(0, &mut out);
    be16(3, &mut out);
    be32(f4_off, &mut out);
    if needs_f12 {
        be16(0, &mut out);
        be16(4, &mut out);
        be32(f12_off, &mut out);
    }
    be16(3, &mut out);
    be16(1, &mut out);
    be32(f4_off, &mut out);
    if needs_f12 {
        be16(3, &mut out);
        be16(10, &mut out);
        be32(f12_off, &mut out);
    }
    out.extend_from_slice(&f4);
    if let Some(f12) = f12 {
        out.extend_from_slice(&f12);
    }
    out
}

fn table_checksum(data: &[u8]) -> u32 {
    let mut sum = 0u32;
    let mut chunks = data.chunks(4);
    for c in &mut chunks {
        let mut b = [0u8; 4];
        b[..c.len()].copy_from_slice(c);
        sum = sum.wrapping_add(u32::from_be_bytes(b));
    }
    sum
}

/// Rebuilds `ttf` with a fresh Unicode `cmap` built from `map` (`unicode -> glyph id`).
/// Returns `None` when the input is not a parseable sfnt or the mapping is empty.
pub fn rebuild_ttf_with_unicode_cmap(ttf: &[u8], map: &BTreeMap<u32, u16>) -> Option<Vec<u8>> {
    if map.is_empty() || ttf.len() < 12 {
        return None;
    }
    // Validate with ttf-parser first so we never emit a broken font.
    ttf_parser::Face::parse(ttf, 0).ok()?;

    let sfnt_version = u32::from_be_bytes(ttf[0..4].try_into().ok()?);
    let num_tables = u16::from_be_bytes(ttf[4..6].try_into().ok()?) as usize;
    if ttf.len() < 12 + num_tables * 16 {
        return None;
    }

    let mut tables: Vec<([u8; 4], Vec<u8>)> = Vec::with_capacity(num_tables + 1);
    for i in 0..num_tables {
        let rec = &ttf[12 + i * 16..12 + (i + 1) * 16];
        let tag: [u8; 4] = rec[0..4].try_into().ok()?;
        let offset = u32::from_be_bytes(rec[8..12].try_into().ok()?) as usize;
        let length = u32::from_be_bytes(rec[12..16].try_into().ok()?) as usize;
        if &tag == b"cmap" || &tag == b"DSIG" {
            continue;
        }
        let end = offset.checked_add(length)?;
        if end > ttf.len() {
            return None;
        }
        tables.push((tag, ttf[offset..end].to_vec()));
    }
    tables.push((*b"cmap", build_cmap_table(map)));
    tables.sort_by(|a, b| a.0.cmp(&b.0));

    let n = tables.len() as u16;
    let mut pow = 1u16;
    let mut entry_selector = 0u16;
    while pow * 2 <= n {
        pow *= 2;
        entry_selector += 1;
    }
    let search_range = pow * 16;
    let range_shift = n * 16 - search_range;

    let mut out = Vec::with_capacity(ttf.len() + 4096);
    be32(sfnt_version, &mut out);
    be16(n, &mut out);
    be16(search_range, &mut out);
    be16(entry_selector, &mut out);
    be16(range_shift, &mut out);

    let dir_len = 12 + 16 * tables.len();
    let mut offset = dir_len;
    let mut head_offset: Option<usize> = None;
    let mut records = Vec::with_capacity(tables.len() * 16);
    let mut body = Vec::new();
    for (tag, data) in &mut tables {
        if tag == b"head" && data.len() >= 12 {
            data[8..12].copy_from_slice(&[0, 0, 0, 0]); // checkSumAdjustment recomputed below
            head_offset = Some(offset);
        }
        records.extend_from_slice(tag);
        be32(table_checksum(data), &mut records);
        be32(offset as u32, &mut records);
        be32(data.len() as u32, &mut records);
        body.extend_from_slice(data);
        let pad = (4 - data.len() % 4) % 4;
        body.extend(std::iter::repeat(0u8).take(pad));
        offset += data.len() + pad;
    }
    out.extend_from_slice(&records);
    out.extend_from_slice(&body);

    if let Some(ho) = head_offset {
        let adj = 0xB1B0_AFBAu32.wrapping_sub(table_checksum(&out));
        out[ho + 8..ho + 12].copy_from_slice(&adj.to_be_bytes());
    }

    // Final sanity check: the rebuilt font must parse and resolve a mapped code point.
    let face = ttf_parser::Face::parse(&out, 0).ok()?;
    let (&probe_cp, &probe_gid) = map.iter().next()?;
    let ch = char::from_u32(probe_cp)?;
    if face.glyph_index(ch).map(|g| g.0) != Some(probe_gid) {
        return None;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dejavu() -> Option<Vec<u8>> {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = manifest.parent()?.parent()?.parent()?;
        std::fs::read(root.join("android/app/src/main/assets/fonts/DejaVuSans.ttf")).ok()
    }

    #[test]
    fn rebuilt_cmap_maps_unicode_to_requested_glyphs() {
        let Some(font) = dejavu() else {
            return;
        };
        let face = ttf_parser::Face::parse(&font, 0).unwrap();
        let g_a = face.glyph_index('A').unwrap().0;
        let g_s = face.glyph_index('ş').unwrap().0;
        // Deliberately remap: 'Z' shows the glyph of 'A', 'ğ' shows the glyph of 'ş'.
        let mut map = BTreeMap::new();
        map.insert('Z' as u32, g_a);
        map.insert('ğ' as u32, g_s);
        map.insert(0x1F600, g_a); // forces a format 12 subtable
        let rebuilt = rebuild_ttf_with_unicode_cmap(&font, &map).expect("rebuilt font");
        let f2 = ttf_parser::Face::parse(&rebuilt, 0).unwrap();
        assert_eq!(f2.glyph_index('Z').map(|g| g.0), Some(g_a));
        assert_eq!(f2.glyph_index('ğ').map(|g| g.0), Some(g_s));
        assert_eq!(f2.glyph_index('\u{1F600}').map(|g| g.0), Some(g_a));
        assert!(f2.glyph_index('A').is_none());
        assert_eq!(f2.number_of_glyphs(), face.number_of_glyphs());
    }
}
