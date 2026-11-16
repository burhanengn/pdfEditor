pub mod clip_masks;
pub mod cmap;
pub mod content_redact;
pub mod pdf_ops;

pub use clip_masks::{apply_clip_masks_with_lopdf, ClipMaskPatch, ClipPathCmd};
pub use cmap::{DecodedGlyph, FontMetricsMap};
pub use content_redact::{
    create_sample_pdf_with_text_lines, redact_pdf_bytes_with_lopdf, RedactionOptions,
    RedactionStreamStats,
};
pub use pdf_ops::{
    create_blank_pdf_with_lopdf, create_reference_pdf_with_lopdf, create_sample_pdf_with_lopdf,
    extract_embedded_fonts_with_lopdf, inspect_pdf_with_lopdf,
    prepare_clean_page_preview_with_lopdf,
};

#[cfg(test)]
mod tests {
    use super::*;
    use gp_pdf::RedactionRect;

    #[test]
    fn lopdf_content_stream_splits_and_strips_redacted_substrings() {
        // Page height 842; text baseline at PDF y = 742 => visual top ~ 842 - 742 - 11 = 89.
        let pdf = create_sample_pdf_with_text_lines(&[
            ("SECRET_KEY KEEP_THIS", 72.0, 742.0, 12.0),
            ("Unchanged Line", 72.0, 700.0, 12.0),
        ])
        .unwrap();

        // Redact only left half covering "SECRET_KEY" (x: 70..146, visual y: 80..112)
        let (redacted, stats) = redact_pdf_bytes_with_lopdf(
            &pdf,
            &[RedactionRect {
                page_index: 0,
                x: 70.0,
                y: 80.0,
                width: 76.0,
                height: 32.0,
            }],
            RedactionOptions::default(),
        )
        .unwrap();

        assert!(stats.removed_text_runs >= 1);
        assert!(stats.modified_streams >= 1);

        let doc = lopdf::Document::load_mem(&redacted).unwrap();
        let page_id = *doc.get_pages().values().next().unwrap();
        let text = doc.extract_text(&[1]).unwrap_or_default();
        let raw_content = String::from_utf8_lossy(&doc.get_page_content(page_id)).to_string();
        assert!(!text.contains("SECRET_KEY"), "extracted text still contained SECRET_KEY: {text}");
        assert!(text.contains("KEEP_THIS"), "non-redacted suffix should survive: {text}");
        assert!(text.contains("Unchanged Line"), "second line should survive: {text}");
        assert!(!raw_content.contains("SECRET_KEY"));
    }

    #[test]
    fn lopdf_builds_blank_sample_and_reference_pdfs_cleanly() {
        let blank = create_blank_pdf_with_lopdf(595.0, 842.0, 2).unwrap();
        let blank_info = inspect_pdf_with_lopdf(&blank, None).unwrap();
        assert_eq!(blank_info.page_count, 2);

        let sample = create_sample_pdf_with_lopdf(&[], 0, 0).unwrap();
        let sample_info = inspect_pdf_with_lopdf(&sample, None).unwrap();
        assert_eq!(sample_info.page_count, 3);
        assert_eq!(sample_info.pages[1].base_width, 792.0);

        let form_ref = create_reference_pdf_with_lopdf("form-1p", None, None).unwrap();
        assert_eq!(inspect_pdf_with_lopdf(&form_ref, None).unwrap().page_count, 1);

        // Prepare clean preview strips header banner rectangle cleanly and isolates 1 page
        let clean = prepare_clean_page_preview_with_lopdf(
            &sample,
            0,
            &[],
            &[],
            &[gp_model::RectBox {
                x: 46.0,
                y: 36.0,
                width: 520.0,
                height: 60.0,
            }],
        )
        .unwrap();
        assert_eq!(inspect_pdf_with_lopdf(&clean, None).unwrap().page_count, 1);
    }
}
