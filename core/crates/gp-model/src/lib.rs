pub mod command;
pub mod types;

pub use command::*;
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_page(id: &str) -> PageMeta {
        PageMeta {
            id: id.to_string(),
            source_doc_id: "doc1".to_string(),
            source_page_index: 0,
            base_width: 595.0,
            base_height: 842.0,
            intrinsic_rotation: 0,
            user_rotation: 0,
            media_box: [0.0, 0.0, 595.0, 842.0],
            crop_box: [0.0, 0.0, 595.0, 842.0],
        }
    }

    fn sample_text(id: &str, page_id: &str, text: &str) -> CanvasElement {
        CanvasElement::TextAdd {
            base: BaseElement {
                id: id.to_string(),
                page_id: page_id.to_string(),
                x: 40.0,
                y: 80.0,
                width: 180.0,
                height: 28.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 10,
                locked: None,
                is_background_layer: None,
                layer_tier: None,
                group_id: None,
            },
            text: text.to_string(),
            runs: None,
            font_family: "Helvetica".to_string(),
            font_size: 14.0,
            color: "#111827".to_string(),
            background_color: None,
            bold: false,
            italic: false,
            underline: None,
            strikethrough: None,
            script_mode: None,
            embedded_font_id: None,
            align: TextAlign::Left,
            line_height: 1.25,
            horizontal_scale: None,
            letter_spacing: None,
        }
    }

    #[test]
    fn command_history_inverse_undo_redo_and_serde_roundtrip() {
        let mut store = DocumentStore::new(DocumentSnapshot {
            pages: vec![sample_page("p1")],
            ..Default::default()
        });

        let txt = sample_text("el_1", "p1", "Merhaba İstanbul ŞİĞÜ");
        store
            .execute(Command::AddElements {
                elements: vec![txt.clone()],
            })
            .unwrap();
        assert_eq!(store.snapshot.elements.len(), 1);
        assert!(store.is_dirty());

        store
            .execute(Command::TransformElements {
                updates: vec![ElementGeometryUpdate {
                    id: "el_1".to_string(),
                    rect: RectBox {
                        x: 120.0,
                        y: 160.0,
                        width: 240.0,
                        height: 40.0,
                    },
                    rotation: 45.0,
                    opacity: 0.85,
                    z_index: 12,
                }],
            })
            .unwrap();
        assert_eq!(store.snapshot.elements[0].base().x, 120.0);
        assert_eq!(store.snapshot.elements[0].base().rotation, 45.0);

        // Undo transform -> reverts geometry cleanly
        assert!(store.undo().unwrap());
        assert_eq!(store.snapshot.elements[0].base().x, 40.0);
        assert_eq!(store.snapshot.elements[0].base().rotation, 0.0);

        // Redo transform -> reapplies
        assert!(store.redo().unwrap());
        assert_eq!(store.snapshot.elements[0].base().x, 120.0);

        // Undo transform then undo add -> back to 0 elements
        assert!(store.undo().unwrap());
        assert!(store.undo().unwrap());
        assert_eq!(store.snapshot.elements.len(), 0);

        // Redo add & verify JSON serialization compatible with TS types
        assert!(store.redo().unwrap());
        let json = store.to_json().unwrap();
        assert!(json.contains("\"kind\":\"text-add\""));
        assert!(json.contains("Merhaba İstanbul ŞİĞÜ"));
        let restored = DocumentStore::from_json(&json).unwrap();
        assert_eq!(restored.snapshot, store.snapshot);
    }

    #[test]
    fn rotate_pages_command_inverts_cleanly() {
        let mut store = DocumentStore::new(DocumentSnapshot {
            pages: vec![sample_page("p1")],
            ..Default::default()
        });
        store
            .execute(Command::RotatePages {
                page_ids: vec!["p1".to_string()],
                delta_deg: 90,
            })
            .unwrap();
        assert_eq!(store.snapshot.pages[0].user_rotation, 90);
        store.undo().unwrap();
        assert_eq!(store.snapshot.pages[0].user_rotation, 0);
        store.redo().unwrap();
        assert_eq!(store.snapshot.pages[0].user_rotation, 90);
    }
}
