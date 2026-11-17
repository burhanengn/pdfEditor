pub mod actor;
pub mod api;
#[allow(clippy::all, dead_code)]
mod frb_generated;

#[cfg(test)]
mod tests {
    use gp_pdf_pdfium::PdfiumBackend;
    use pdfium_render::prelude::PdfPageObjectsCommon;

    use crate::{
        actor::{atomic_write_and_verify_pdf, engine_actor, ActorPriority},
        api::session::{
            close_document, compute_rotated_resize_rect, init_engine, open_document_file,
            redact_file_verified, render_tile, trim_engine_memory, FrbRedactionRect,
            FrbTileRequest,
        },
    };
    use gp_pdf::CancellationFlag;

    #[test]
    fn frb_single_thread_actor_renders_tiles_and_verifies_atomic_redaction_save() {
        init_engine(None, 32 * 1024 * 1024).expect("PDFium init should succeed via .pdfium-cache");

        // Create a valid 1-page PDF with secret text using backend helper on the actor thread
        let tmp_dir = std::env::temp_dir().join(format!("gp_frb_test_{}", std::process::id()));
        std::fs::create_dir_all(&tmp_dir).unwrap();
        let src_pdf = tmp_dir.join("input.pdf");
        let redacted_pdf = tmp_dir.join("redacted.pdf");

        engine_actor()
            .dispatch(ActorPriority::CommandOrHit, None, CancellationFlag::new(), {
                let src_pdf = src_pdf.clone();
                move |state, _| {
                    let backend = state.ensure_backend(None)?;
                    let mut doc = backend.pdfium().create_new_pdf().unwrap();
                    let font = doc.fonts_mut().helvetica();
                    let mut page = doc
                        .pages_mut()
                        .create_page_at_index(pdfium_render::prelude::PdfPagePaperSize::a4(), 0)
                        .unwrap();
                    page.objects_mut()
                        .create_text_object(
                            pdfium_render::prelude::PdfPoints::new(72.0),
                            pdfium_render::prelude::PdfPoints::new(720.0),
                            "PUBLIC_LINE",
                            font,
                            pdfium_render::prelude::PdfPoints::new(14.0),
                        )
                        .unwrap();
                    page.objects_mut()
                        .create_text_object(
                            pdfium_render::prelude::PdfPoints::new(72.0),
                            pdfium_render::prelude::PdfPoints::new(660.0),
                            "SECRET_MOBILE_99",
                            font,
                            pdfium_render::prelude::PdfPoints::new(14.0),
                        )
                        .unwrap();
                    let bytes = doc.save_to_bytes().unwrap();
                    atomic_write_and_verify_pdf(backend.pdfium(), &src_pdf, &bytes)?;
                    Ok(())
                }
            })
            .unwrap();

        let opened =
            open_document_file("doc-test".to_string(), src_pdf.to_string_lossy().into_owned(), None)
                .unwrap();
        assert_eq!(opened.status, "ok");
        assert_eq!(opened.page_count, 1);

        let tile = render_tile(FrbTileRequest {
            doc_id: "doc-test".to_string(),
            page_index: 0,
            tile_x: 0,
            tile_y: 0,
            tile_width_px: 256,
            tile_height_px: 256,
            scale: 1.0,
            user_rotation: 0,
            transparent_bg: false,
            theme: "light".to_string(),
            dark_paper_invert: false,
            priority_tier: 0,
            scope: Some("test-zoom".to_string()),
        })
        .unwrap();
        assert_eq!(tile.width, 256);
        assert_eq!(tile.height, 256);
        assert_eq!(tile.rgba.len(), 256 * 256 * 4);

        let verify = redact_file_verified(
            src_pdf.to_string_lossy().into_owned(),
            redacted_pdf.to_string_lossy().into_owned(),
            None,
            vec![FrbRedactionRect {
                page_index: 0,
                x: 60.0,
                y: 842.0 - 678.0,
                width: 220.0,
                height: 30.0,
            }],
        )
        .unwrap();
        assert!(verify.verified);
        assert_eq!(verify.remaining_matches, 0);
        assert_eq!(verify.output_page_count, 1);

        let resized = compute_rotated_resize_rect(
            100.0, 120.0, 160.0, 80.0, 0.0, "se".to_string(), 40.0, 20.0, true,
        );
        assert!((resized.width - 200.0).abs() < 1e-4);

        trim_engine_memory(16 * 1024 * 1024).unwrap();
        close_document("doc-test".to_string()).unwrap();
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[allow(dead_code)]
    fn _ensure_backend_type(_: &PdfiumBackend) {}
}
