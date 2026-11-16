pub mod queue;
pub mod session;
pub mod tile_cache;

pub use queue::{EngineJobPayload, QueuedEngineTask, RenderPriority, RenderQueue};
pub use session::{EngineError, EngineSession};
pub use tile_cache::{TileCache, TileCacheKey};

#[cfg(test)]
mod tests {
    use super::*;
    use gp_model::{BaseElement, CanvasElement, Command, TextAlign};
    use gp_pdf::{RenderedBitmap, TileRenderRequest};

    fn dummy_tile_req(page_index: usize) -> TileRenderRequest {
        TileRenderRequest {
            source_doc_id: "doc-1".to_string(),
            page_index,
            tile_x: 0,
            tile_y: 0,
            tile_width_px: 256,
            tile_height_px: 256,
            scale: 1.5,
            user_rotation: 0,
            transparent_bg: false,
            theme: None,
            dark_paper_invert: false,
        }
    }

    #[test]
    fn queue_orders_by_priority_and_respects_cancellation() {
        let mut q = RenderQueue::new();
        let (t1, _) = q.enqueue(
            "zoom-1",
            RenderPriority::Thumbnail,
            EngineJobPayload::RenderTile(dummy_tile_req(0)),
        );
        let (t2, _) = q.enqueue(
            "zoom-1",
            RenderPriority::VisibleTile,
            EngineJobPayload::RenderTile(dummy_tile_req(1)),
        );
        let (t3, _) = q.enqueue(
            "zoom-2",
            RenderPriority::VisibleTile,
            EngineJobPayload::RenderTile(dummy_tile_req(2)),
        );

        assert_eq!(q.cancel_scope("zoom-1"), 2);
        let first = q.pop_next().unwrap();
        assert_eq!(first.task_id, t3);
        assert!(q.pop_next().is_none());
        let _ = (t1, t2);
    }

    #[test]
    fn tile_cache_enforces_byte_budget_and_lru() {
        let mut cache = TileCache::new(1024 * 1024);
        let make_key = |x: i32| TileCacheKey {
            doc_id: "d".to_string(),
            page_index: 0,
            scale_milli: 1000,
            rotation: 0,
            tile_x: x,
            tile_y: 0,
            tile_w: 256,
            tile_h: 256,
            theme_id: 0,
            dark_invert: false,
        };
        let half_mb = RenderedBitmap {
            width: 512,
            height: 256,
            rgba: vec![255; 512 * 1024],
        };
        let k1 = make_key(0);
        let k2 = make_key(256);
        let k3 = make_key(512);

        cache.insert(k1.clone(), half_mb.clone());
        cache.insert(k2.clone(), half_mb.clone());
        assert!(cache.get(&k1).is_some()); // touch k1 so k2 is LRU
        cache.insert(k3.clone(), half_mb);
        assert!(cache.used_bytes() <= 1024 * 1024);
        assert!(cache.get(&k1).is_some());
        assert!(cache.get(&k2).is_none());
        assert!(cache.get(&k3).is_some());

        cache.trim(512 * 1024);
        assert!(cache.used_bytes() <= 512 * 1024);
    }

    #[test]
    fn session_command_undo_redo_and_snapshot_roundtrip() {
        let mut session = EngineSession::default();
        let el = CanvasElement::TextAdd {
            base: BaseElement {
                id: "txt-1".to_string(),
                page_id: "p-1".to_string(),
                x: 10.0,
                y: 20.0,
                width: 120.0,
                height: 30.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 1,
                locked: None,
                is_background_layer: None,
                layer_tier: Some(3),
                group_id: None,
            },
            text: "Merhaba".to_string(),
            runs: None,
            font_family: "Helvetica".to_string(),
            font_size: 14.0,
            color: "#111111".to_string(),
            background_color: None,
            bold: false,
            italic: false,
            align: TextAlign::Left,
            line_height: 1.3,
            horizontal_scale: None,
            letter_spacing: None,
        };
        let cmd_json = serde_json::to_string(&Command::AddElements { elements: vec![el] }).unwrap();
        session.apply_command_json(&cmd_json).unwrap();
        assert_eq!(session.store.snapshot.elements.len(), 1);
        assert!(session.undo().unwrap());
        assert_eq!(session.store.snapshot.elements.len(), 0);
        assert!(session.redo().unwrap());
        assert_eq!(session.store.snapshot.elements.len(), 1);
    }
}
