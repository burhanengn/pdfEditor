use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use crate::{
    error::PdfError,
    types::{
        PdfLinkAnnotation, PdfOpenResult, PdfOutlineNode, PdfSearchHit, PdfTextCharBox,
        PdfTextSpan, RedactionRect, RedactionReport, RenderedBitmap, TileRenderRequest,
    },
};

#[derive(Debug, Clone, Default)]
pub struct CancellationFlag {
    cancelled: Arc<AtomicBool>,
}

impl CancellationFlag {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn check(&self) -> Result<(), PdfError> {
        if self.is_cancelled() {
            Err(PdfError::Cancelled)
        } else {
            Ok(())
        }
    }
}

/// Abstract single-thread PDF backend trait implemented by `gp-pdf-pdfium`
/// (native/FFI) and in-memory test doubles without leaking engine types into `gp-engine`.
pub trait PdfBackend {
    fn open_document(
        &mut self,
        doc_id: &str,
        bytes: &[u8],
        password: Option<&str>,
    ) -> Result<PdfOpenResult, PdfError>;

    fn close_document(&mut self, doc_id: &str) -> Result<(), PdfError>;

    fn render_tile(
        &self,
        req: &TileRenderRequest,
        cancel: &CancellationFlag,
    ) -> Result<RenderedBitmap, PdfError>;

    fn extract_text_chars(
        &self,
        doc_id: &str,
        page_index: usize,
    ) -> Result<Vec<PdfTextCharBox>, PdfError>;

    fn extract_text_spans(
        &self,
        doc_id: &str,
        page_index: usize,
    ) -> Result<Vec<PdfTextSpan>, PdfError>;

    fn extract_page_text(&self, doc_id: &str, page_index: usize) -> Result<String, PdfError>;

    fn extract_outline(&self, doc_id: &str) -> Result<Vec<PdfOutlineNode>, PdfError>;

    fn extract_links(
        &self,
        doc_id: &str,
        page_index: usize,
    ) -> Result<Vec<PdfLinkAnnotation>, PdfError>;

    fn search_page(
        &self,
        doc_id: &str,
        page_index: usize,
        query: &str,
        fold_diacritics: bool,
    ) -> Result<Vec<PdfSearchHit>, PdfError>;

    fn redact_and_save(
        &self,
        doc_id: &str,
        rects: &[RedactionRect],
    ) -> Result<(Vec<u8>, RedactionReport), PdfError>;
}
