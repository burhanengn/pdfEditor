pub mod coords;
pub mod image_mask;
pub mod snap;
pub mod vector_shapes;

pub use coords::*;
pub use image_mask::*;
pub use snap::*;
pub use vector_shapes::*;

#[cfg(test)]
mod tests {
    use super::*;
    use gp_model::{NormalizedPoint, PageMeta, Point, RectBox, VectorShapeType};

    #[test]
    fn rotated_resize_pins_opposite_corner_and_preserves_aspect() {
        let start = RectBox {
            x: 100.0,
            y: 120.0,
            width: 160.0,
            height: 80.0,
        };
        let next = compute_rotated_resize_rect(RotatedResizeParams {
            start_rect: start,
            handle: ResizeHandle::Se,
            dx_px: 40.0,
            dy_px: 10.0,
            frame_rotation_deg: 0.0,
            user_rotation: 0,
            zoom: 1.0,
            aspect_locked: true,
            shift_key: false,
            min_size: 12.0,
        });
        assert!((next.x - 100.0).abs() < 1e-6);
        assert!((next.y - 120.0).abs() < 1e-6);
        assert!((next.width / next.height - 2.0).abs() < 1e-6);
        assert!((next.width - 200.0).abs() < 1e-6);

        assert_eq!(compute_rotated_resize_cursor(ResizeHandle::Nw, 90.0), "ne-resize");
    }

    #[test]
    fn snap_position_aligns_to_siblings_and_margins() {
        let moving = RectBox {
            x: 38.0,
            y: 100.0,
            width: 50.0,
            height: 20.0,
        };
        let sib = RectBox {
            x: 200.0,
            y: 102.0,
            width: 80.0,
            height: 20.0,
        };
        let res = compute_snap_position(moving, 595.0, 842.0, &[sib], true);
        assert!((res.x - 36.0).abs() < 1e-6);
        assert!((res.y - 102.0).abs() < 1e-6);
        assert_eq!(res.guides.len(), 2);
    }

    #[test]
    fn vector_path_and_svg_mask_helpers_match_parity() {
        let rect_d = shape_to_svg_path(VectorShapeType::Rect, 100.0, 40.0, 0.0);
        assert_eq!(rect_d, "M 0 0 L 100.00 0 L 100.00 40.00 L 0 40.00 Z");
        let flipped = flip_svg_path(&rect_d, 100.0, 40.0, true, false, 2);
        assert_eq!(flipped, "M 100 0 L 0 0 L 0 40 L 100 40 Z");

        let smooth_d = path_points_to_svg_path(
            &[
                NormalizedPoint { x: 0.0, y: 0.0, pressure: None },
                NormalizedPoint { x: 0.5, y: 1.0, pressure: None },
                NormalizedPoint { x: 1.0, y: 0.0, pressure: None },
            ],
            100.0,
            100.0,
            false,
            true,
        );
        assert!(smooth_d.contains("Q 50.00 100.00"));
        let norm = normalize_absolute_points(&[Point { x: 50.0, y: 100.0 }, Point { x: 50.0, y: 200.0 }]);
        assert!((norm.rect.width - 12.0).abs() < 1e-6);
    }

    #[test]
    fn page_offset_binary_search_finds_target_page() {
        let pages: Vec<PageMeta> = (0..100)
            .map(|i| PageMeta {
                id: format!("p{i}"),
                source_doc_id: "d".to_string(),
                source_page_index: i,
                base_width: 595.0,
                base_height: 842.0,
                intrinsic_rotation: 0,
                user_rotation: 0,
                media_box: [0.0, 0.0, 595.0, 842.0],
                crop_box: [0.0, 0.0, 595.0, 842.0],
            })
            .collect();
        let metrics = compute_viewport_surface_metrics(&pages, 800.0, 900.0, 1.0, false);
        let idx = PageOffsetIndex::build(&pages, 1.0, &metrics);
        let page50_mid = idx.row_tops[50] + 100.0;
        assert_eq!(idx.find_page_at_surface_y(page50_mid), 50);
    }
}
