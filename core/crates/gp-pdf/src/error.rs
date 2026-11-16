use thiserror::Error;

#[derive(Debug, Error)]
pub enum PdfError {
    #[error("password required to open PDF document")]
    PasswordRequired,

    #[error("invalid password provided for PDF document")]
    InvalidPassword,

    #[error("source document '{0}' is not loaded")]
    DocumentNotFound(String),

    #[error("page index {page} is out of bounds (total pages: {total})")]
    PageOutOfBounds { page: usize, total: usize },

    #[error("operation cancelled")]
    Cancelled,

    #[error("invalid argument: {0}")]
    InvalidInput(String),

    #[error("render failed: {0}")]
    RenderFailed(String),

    #[error("redaction failed: {0}")]
    RedactionFailed(String),

    #[error("PDF backend error: {0}")]
    Backend(String),
}
