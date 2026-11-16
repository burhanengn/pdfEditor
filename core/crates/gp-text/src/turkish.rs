use unicode_normalization::UnicodeNormalization;

/// Normalizes Turkish decomposed dotted capital I (`I\u0307` -> `İ`) and dotless/dotted lowercase,
/// then applies Unicode NFC normalization so glyphs match embedded TrueType cmaps and Turkish orthography.
pub fn normalize_unicode_for_pdf(text: &str) -> String {
    let turkish = text.replace("I\u{0307}", "\u{0130}").replace("i\u{0307}", "i");
    turkish.nfc().collect()
}

/// Turkish-aware case and diacritic folding for document search (02 §3.5):
/// maps `İ`/`I`/`ı` -> `i`, and folds Turkish/Latin diacritics when `fold_diacritics` is true.
pub fn normalize_for_turkish_search(input: &str, fold_diacritics: bool) -> String {
    let nfc = normalize_unicode_for_pdf(input);
    let mut out = String::with_capacity(nfc.len());
    for ch in nfc.chars() {
        match ch {
            'İ' | 'I' | 'ı' => out.push('i'),
            'ğ' | 'Ğ' if fold_diacritics => out.push('g'),
            'ş' | 'Ş' if fold_diacritics => out.push('s'),
            'ç' | 'Ç' if fold_diacritics => out.push('c'),
            'ö' | 'Ö' if fold_diacritics => out.push('o'),
            'ü' | 'Ü' if fold_diacritics => out.push('u'),
            _ if fold_diacritics => {
                for decomposed in ch.nfd() {
                    let code = decomposed as u32;
                    if !(0x0300..=0x036F).contains(&code) {
                        for lc in decomposed.to_lowercase() {
                            out.push(if lc == 'ı' { 'i' } else { lc });
                        }
                    }
                }
            }
            _ => {
                for lc in ch.to_lowercase() {
                    out.push(lc);
                }
            }
        }
    }
    out
}

pub fn sanitize_for_winansi(text: &str) -> String {
    let normalized = normalize_unicode_for_pdf(text);
    let mut out = String::with_capacity(normalized.len());
    for ch in normalized.chars() {
        match ch {
            '\u{2018}' | '\u{2019}' => out.push('\''),
            '\u{201C}' | '\u{201D}' => out.push('"'),
            '\u{2013}' | '\u{2212}' => out.push('-'),
            '\u{2014}' => out.push_str("--"),
            '\u{2026}' => out.push_str("..."),
            '\u{00A0}' => out.push(' '),
            '\u{2713}' | '\u{2714}' => out.push_str("[v]"),
            '\u{2717}' => out.push_str("[x]"),
            '\u{2192}' => out.push_str("->"),
            '\u{2190}' => out.push_str("<-"),
            '\n' | '\r' | '\t' => out.push(ch),
            _ => {
                let code = ch as u32;
                if (0x20..=0x7E).contains(&code)
                    || (0xA0..=0xFF).contains(&code)
                    || code == 0x20AC
                    || code == 0x2022
                    || code == 0x2122
                {
                    out.push(ch);
                } else {
                    out.push('?');
                }
            }
        }
    }
    out
}
