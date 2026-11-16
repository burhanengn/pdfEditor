use gp_pdf::{
    CancellationFlag, CompileProgress, PdfBackend, PdfError, RenderedBitmap, TileRenderRequest,
};

use crate::{EngineJobPayload, EngineSession, RenderPriority, TileCacheKey};

/// F3.3 Single-thread PDF engine runtime orchestrating `RenderQueue`, byte-budgeted
/// `TileCache`, `DocumentStore`, and any `PdfBackend` (native PDFium or test double).
pub struct EngineRuntime<B: PdfBackend> {
    pub session: EngineSession,
    pub backend: B,
}

#[derive(Debug, Clone)]
pub enum RuntimeStepOutcome {
    TileRendered {
        task_id: u64,
        page_index: usize,
        cache_hit: bool,
        bitmap: RenderedBitmap,
    },
    PageTextExtracted {
        task_id: u64,
        page_index: usize,
        text: String,
    },
    SearchCompleted {
        task_id: u64,
        page_index: usize,
        hit_count: usize,
    },
    Cancelled {
        task_id: u64,
    },
    Idle,
}

impl<B: PdfBackend> EngineRuntime<B> {
    pub fn new(backend: B, tile_cache_budget_bytes: usize) -> Self {
        Self {
            session: EngineSession::new(tile_cache_budget_bytes),
            backend,
        }
    }

    pub fn enqueue_visible_tile(&mut self, scope: &str, req: TileRenderRequest) -> (u64, CancellationFlag) {
        self.session.queue.enqueue(
            scope,
            RenderPriority::VisibleTile,
            EngineJobPayload::RenderTile(req),
        )
    }

    pub fn enqueue_thumbnail(&mut self, scope: &str, req: TileRenderRequest) -> (u64, CancellationFlag) {
        self.session.queue.enqueue(
            scope,
            RenderPriority::Thumbnail,
            EngineJobPayload::RenderTile(req),
        )
    }

    pub fn cancel_scope(&mut self, scope: &str) -> usize {
        self.session.queue.cancel_scope(scope)
    }

    pub fn trim_memory(&mut self, target_bytes: usize) {
        self.session.trim_memory(target_bytes);
    }

    /// Executes the single highest-priority pending task in strict D2 single-thread order.
    pub fn step_once(&mut self) -> Result<RuntimeStepOutcome, PdfError> {
        let Some(task) = self.session.queue.pop_next() else {
            return Ok(RuntimeStepOutcome::Idle);
        };
        let task_id = task.task_id;
        if task.cancel.is_cancelled() {
            self.session.queue.complete_task(task_id);
            return Ok(RuntimeStepOutcome::Cancelled { task_id });
        }

        let res = match task.payload {
            EngineJobPayload::RenderTile(req) => {
                let key = TileCacheKey {
                    doc_id: req.source_doc_id.clone(),
                    page_index: req.page_index,
                    scale_milli: (req.scale * 1000.0).round() as u32,
                    rotation: req.user_rotation,
                    tile_x: req.tile_x,
                    tile_y: req.tile_y,
                    tile_w: req.tile_width_px,
                    tile_h: req.tile_height_px,
                    theme_id: TileCacheKey::theme_to_id(req.theme),
                    dark_invert: req.dark_paper_invert,
                };
                if let Some(hit) = self.session.tile_cache.get(&key) {
                    Ok(RuntimeStepOutcome::TileRendered {
                        task_id,
                        page_index: req.page_index,
                        cache_hit: true,
                        bitmap: hit.clone(),
                    })
                } else {
                    match self.backend.render_tile(&req, &task.cancel) {
                        Ok(bmp) => {
                            self.session.tile_cache.insert(key, bmp.clone());
                            Ok(RuntimeStepOutcome::TileRendered {
                                task_id,
                                page_index: req.page_index,
                                cache_hit: false,
                                bitmap: bmp,
                            })
                        }
                        Err(PdfError::Cancelled) => Ok(RuntimeStepOutcome::Cancelled { task_id }),
                        Err(e) => Err(e),
                    }
                }
            }
            EngineJobPayload::ExtractPageText { doc_id, page_index } => {
                let text = self.backend.extract_page_text(&doc_id, page_index)?;
                Ok(RuntimeStepOutcome::PageTextExtracted {
                    task_id,
                    page_index,
                    text,
                })
            }
            EngineJobPayload::SearchPage {
                doc_id,
                page_index,
                query,
            } => {
                let hits = self.backend.search_page(&doc_id, page_index, &query, true)?;
                Ok(RuntimeStepOutcome::SearchCompleted {
                    task_id,
                    page_index,
                    hit_count: hits.len(),
                })
            }
        };

        self.session.queue.complete_task(task_id);
        res
    }

    /// Runs a cancellable batched export/redaction check with page progress reporting (F3.3).
    pub fn redact_with_progress<F>(
        &self,
        doc_id: &str,
        rects: &[gp_pdf::RedactionRect],
        cancel: &CancellationFlag,
        mut on_progress: F,
    ) -> Result<(Vec<u8>, gp_pdf::RedactionReport), PdfError>
    where
        F: FnMut(CompileProgress),
    {
        cancel.check()?;
        let total = rects.len().max(1);
        on_progress(CompileProgress {
            stage: "redacting".to_string(),
            current_page: 0,
            total_pages: total,
            percent: 15,
        });
        let result = self.backend.redact_and_save(doc_id, rects)?;
        cancel.check()?;
        on_progress(CompileProgress {
            stage: "verified".to_string(),
            current_page: total,
            total_pages: total,
            percent: 100,
        });
        Ok(result)
    }
}
