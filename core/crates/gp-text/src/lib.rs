pub mod font_parse;
pub mod font_unicode;
pub mod fonts;
pub mod layout;
pub mod page_numbers;
pub mod page_range;
pub mod rich_text;
pub mod turkish;

pub use font_parse::{
    inspect_ttf_font, measure_ttf_text_width, ttf_font_supports_text, TtfFontMetadata,
};
pub use fonts::{
    font_family_label, is_builtin_font_family, normalize_font_match_key,
    parse_pdf_font_metadata, FontStyleVariant, NormalizedFontKey, ParsedPdfFontInfo,
};
pub use layout::{
    build_detected_text_blocks, DetectedTextBlock, DetectedTextLine, HorizontalRule, RawExtractedLine,
    TableVectorBarriers, VerticalRule,
};
pub use page_numbers::{
    compute_page_number_layout, format_page_number_label, to_roman_numeral, PageNumberLayoutBox,
};
pub use page_range::{parse_page_range_expression, PageRangeParseResult, ParsedRangeGroup};
pub use rich_text::{
    build_wrapped_rich_lines, ensure_runs_from_element, normalize_text_runs, runs_to_plain_text,
    BuildWrappedRichLinesOptions, RunPiece, WrappedRichLine,
};
pub use turkish::{
    normalize_for_turkish_search, normalize_unicode_for_pdf, sanitize_for_winansi,
};

#[cfg(test)]
mod tests {
    use super::*;
    use gp_model::{
        PageNumberingConfig, PageNumberingFormat, PageNumberingPosition, TextRun, TextScriptMode,
    };

    #[test]
    fn turkish_search_normalization_and_folding() {
        assert_eq!(normalize_for_turkish_search("İstanbul Işık", false), "istanbul işik");
        assert_eq!(normalize_for_turkish_search("I\u{0307}stanbul", false), "istanbul");
        assert_eq!(
            normalize_for_turkish_search("Çağrı Şeker Özge Ümit Işık", true),
            "cagri seker ozge umit isik"
        );
    }

    #[test]
    fn unicode_pdf_normalization_maps_turkish_and_winansi() {
        assert_eq!(normalize_unicode_for_pdf("I\u{0307}stanbul"), "İstanbul");
        assert_eq!(sanitize_for_winansi("“test”\u{00A0}—ok"), "\"test\" --ok");
    }

    #[test]
    fn pdf_font_metadata_strips_subset_and_detects_style() {
        let info = parse_pdf_font_metadata(
            "ABCDEF+TimesNewRomanPS-BoldItalicMT",
            false,
            false,
            false,
            false,
        );
        assert_eq!(info.font_family, "TimesRoman");
        assert!(info.bold);
        assert!(info.italic);
        assert_eq!(info.clean_font_name, "TimesNewRomanPS-BoldItalicMT");

        let key = normalize_font_match_key("XYZABC+DejaVuSans-Bold");
        assert_eq!(key.base_key, "dejavusans");
        assert!(key.bold);
        assert!(!key.italic);
        assert_eq!(key.variant, FontStyleVariant::Bold);
    }

    #[test]
    fn page_range_parser_parses_single_ranges_and_deduplicates() {
        let parsed = parse_page_range_expression("1-3, 2, 5, 8-6", 10);
        assert!(parsed.error.is_none());
        assert_eq!(parsed.all_indices, vec![0, 1, 2, 4, 7, 6, 5]);
        assert_eq!(parsed.groups.len(), 4);
    }

    #[test]
    fn page_number_formatting_and_layout() {
        assert_eq!(to_roman_numeral(14, true), "XIV");
        assert_eq!(to_roman_numeral(9, false), "ix");
        let cfg = PageNumberingConfig {
            enabled: true,
            position: PageNumberingPosition::BottomRight,
            format: PageNumberingFormat::RomanUpper,
            font_family: "Helvetica".to_string(),
            font_size: 12.0,
            color: "#000000".to_string(),
            margin_x: 36.0,
            margin_y: 28.0,
            start_from_page: 1,
            start_number: 1,
            opacity: 0.92,
        };
        let label = format_page_number_label(1, 5, &cfg).unwrap();
        assert_eq!(label, "II");
        let layout = compute_page_number_layout(595.0, 842.0, 1, 5, &cfg).unwrap();
        assert_eq!(layout.text, "II");
        assert_eq!(layout.x, 36.0);
        assert_eq!(layout.width, 523.0);
        assert_eq!(layout.align, gp_model::TextAlign::Right);
        assert!(layout.y > 700.0);
    }

    #[test]
    fn rich_text_keeps_atomic_superscript_clusters_together() {
        let runs = vec![
            TextRun {
                text: "Alan 25 m".to_string(),
                bold: None,
                italic: None,
                underline: None,
                strikethrough: None,
                script: None,
            },
            TextRun {
                text: "2".to_string(),
                bold: None,
                italic: None,
                underline: None,
                strikethrough: None,
                script: Some(TextScriptMode::Super),
            },
            TextRun {
                text: " oldu".to_string(),
                bold: None,
                italic: None,
                underline: None,
                strikethrough: None,
                script: None,
            },
        ];
        // Fixed-width 8pt/char metric, max_width=70 -> "Alan 25" fits (7*8=56 <= 73.75),
        // adding " m2" (3*8=24) pushes to 88 > 73.75, so "m" + superscript "2" move together cleanly.
        let lines = build_wrapped_rich_lines(
            &runs,
            70.0,
            |text, _, _, _| text.chars().count() as f64 * 8.0,
            false,
            false,
            None,
        );
        assert_eq!(lines.len(), 2);
        let first_text: String = lines[0].pieces.iter().map(|p| p.text.as_str()).collect();
        let second_text: String = lines[1].pieces.iter().map(|p| p.text.as_str()).collect();
        assert_eq!(first_text, "Alan 25");
        assert_eq!(second_text, "m2 oldu");
        assert!(!lines[0].ends_paragraph);
        assert!(lines[1].ends_paragraph);
    }

    #[test]
    fn layout_groups_soft_wrapped_lines_and_respects_horizontal_table_barriers() {
        let make_line = |text: &str, baseline_y: f64, x1: f64| RawExtractedLine {
            text: text.to_string(),
            runs: None,
            x0: 72.0,
            y0: baseline_y - 10.0,
            x1,
            y1: baseline_y + 2.0,
            baseline_y,
            font_size: 12.0,
            space_width: None,
            first_word_width: 48.0,
            max_word_space: None,
            color: "#000000".to_string(),
            font_family: "Helvetica".to_string(),
            raw_font_name: "Helvetica".to_string(),
            original_font_name: None,
            is_custom_font: Some(false),
            font_source: None,
            horizontal_scale: Some(1.0),
            bold: false,
            italic: false,
            serif: false,
            mono: false,
            block_idx: 0,
        };
        let lines = vec![
            make_line("Bu ilk satır devam ediyor", 100.0, 480.0),
            make_line("ikinci satırda bitiyor.", 116.0, 260.0),
            make_line("Tablo altı metni", 132.0, 240.0),
        ];
        let barriers = TableVectorBarriers {
            horizontal_rules: Some(vec![HorizontalRule {
                y: 120.0,
                x0: 70.0,
                x1: 500.0,
            }]),
            vertical_rules: None,
            cell_rects: None,
        };
        let blocks = build_detected_text_blocks(&lines, "page-1", Some(&barriers));
        assert_eq!(blocks.len(), 2);
        assert_eq!(
            blocks[0].text,
            "Bu ilk satır devam ediyor ikinci satırda bitiyor."
        );
        assert_eq!(blocks[1].text, "Tablo altı metni");
    }

    #[test]
    fn layout_keeps_toc_sections_dotted_leaders_and_page_numbers_separate() {
        let mut idx = 0usize;
        let mut mk = |text: &str, x0: f64, x1: f64, y: f64, bold: bool| {
            idx += 1;
            RawExtractedLine {
                text: text.to_string(),
                runs: None,
                x0,
                y0: y - 10.0,
                x1,
                y1: y + 2.0,
                baseline_y: y,
                font_size: 11.0,
                space_width: None,
                first_word_width: 30.0,
                max_word_space: None,
                color: "#000000".to_string(),
                font_family: "Helvetica".to_string(),
                raw_font_name: "Helvetica".to_string(),
                original_font_name: None,
                is_custom_font: Some(false),
                font_source: None,
                horizontal_scale: Some(1.0),
                bold,
                italic: false,
                serif: false,
                mono: false,
                block_idx: idx,
            }
        };
        let lines = vec![
            mk("İÇİNDEKİLER", 240.0, 350.0, 90.0, true),
            mk("1. KURULUŞ VE GENEL BİLGİLER", 72.0, 290.0, 130.0, true),
            mk("1", 518.0, 524.0, 130.0, false),
            mk("1.1. Proje Tanımı ....................................... 2", 86.0, 524.0, 146.0, false),
            mk("2.2.1. Kapasite Raporu .................................. 7", 98.0, 524.0, 162.0, false),
            mk("7", 518.0, 524.0, 178.0, false),
            mk("16", 512.0, 524.0, 194.0, false),
            mk("Şekil 1. Yerleşim Planı ................................. 9", 72.0, 524.0, 210.0, false),
        ];
        let blocks = build_detected_text_blocks(&lines, "page-3", None);
        assert_eq!(blocks.len(), lines.len());
    }
}
