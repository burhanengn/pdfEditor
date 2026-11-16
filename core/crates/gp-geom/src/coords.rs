use gp_model::{Point, RectBox, RotationAngle};
use serde::{Deserialize, Serialize};

pub const VIEWPORT_PAGE_GAP: f64 = 44.0;
pub const VIEWPORT_MIN_ZOOM: f64 = 0.25;
pub const VIEWPORT_MAX_ZOOM: f64 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResizeHandle {
    Nw,
    N,
    Ne,
    E,
    Se,
    S,
    Sw,
    W,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotatedResizeParams {
    pub start_rect: RectBox,
    pub handle: ResizeHandle,
    pub dx_px: f64,
    pub dy_px: f64,
    pub frame_rotation_deg: f64,
    pub user_rotation: RotationAngle,
    pub zoom: f64,
    pub aspect_locked: bool,
    #[serde(default)]
    pub shift_key: bool,
    #[serde(default = "default_min_size")]
    pub min_size: f64,
}

fn default_min_size() -> f64 {
    12.0
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dimensions {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayFrame {
    pub cx: f64,
    pub cy: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportSurfaceMetrics {
    pub max_page_scaled_width: f64,
    pub viewport_margin_x: f64,
    pub viewport_margin_y: f64,
    pub surface_width: f64,
}

pub fn normalize_rotation(deg: f64) -> RotationAngle {
    let rounded = (deg / 90.0).round() as i32 * 90;
    let norm = rounded.rem_euclid(360) as u16;
    match norm {
        90 | 180 | 270 => norm,
        _ => 0,
    }
}

pub fn get_display_dimensions(
    base_width: f64,
    base_height: f64,
    user_rotation: RotationAngle,
    zoom: f64,
) -> Dimensions {
    let swapped = user_rotation == 90 || user_rotation == 270;
    Dimensions {
        width: (if swapped { base_height } else { base_width }) * zoom,
        height: (if swapped { base_width } else { base_height }) * zoom,
    }
}

pub fn point_base_to_display(
    vx: f64,
    vy: f64,
    base_width: f64,
    base_height: f64,
    user_rotation: RotationAngle,
    zoom: f64,
) -> Point {
    let (rx, ry) = match user_rotation {
        90 => (base_height - vy, vx),
        180 => (base_width - vx, base_height - vy),
        270 => (vy, base_width - vx),
        _ => (vx, vy),
    };
    Point {
        x: rx * zoom,
        y: ry * zoom,
    }
}

pub fn point_display_to_base(
    dx: f64,
    dy: f64,
    base_width: f64,
    base_height: f64,
    user_rotation: RotationAngle,
    zoom: f64,
) -> Point {
    let px = dx / zoom;
    let py = dy / zoom;
    match user_rotation {
        90 => Point {
            x: py,
            y: base_height - px,
        },
        180 => Point {
            x: base_width - px,
            y: base_height - py,
        },
        270 => Point {
            x: base_width - py,
            y: px,
        },
        _ => Point { x: px, y: py },
    }
}

pub fn delta_display_to_base(
    dx: f64,
    dy: f64,
    user_rotation: RotationAngle,
    zoom: f64,
) -> Point {
    let sx = dx / zoom;
    let sy = dy / zoom;
    match user_rotation {
        90 => Point { x: sy, y: -sx },
        180 => Point { x: -sx, y: -sy },
        270 => Point { x: -sy, y: sx },
        _ => Point { x: sx, y: sy },
    }
}

pub fn rect_base_to_display_frame(
    rect: RectBox,
    element_rotation: f64,
    base_width: f64,
    base_height: f64,
    user_rotation: RotationAngle,
    zoom: f64,
) -> DisplayFrame {
    let center = point_base_to_display(
        rect.x + rect.width / 2.0,
        rect.y + rect.height / 2.0,
        base_width,
        base_height,
        user_rotation,
        zoom,
    );
    DisplayFrame {
        cx: center.x,
        cy: center.y,
        width: rect.width * zoom,
        height: rect.height * zoom,
        rotation: element_rotation + user_rotation as f64,
    }
}

pub fn axis_aligned_rect_base_to_display(
    rect: RectBox,
    base_width: f64,
    base_height: f64,
    user_rotation: RotationAngle,
    zoom: f64,
) -> RectBox {
    let p1 = point_base_to_display(rect.x, rect.y, base_width, base_height, user_rotation, zoom);
    let p2 = point_base_to_display(
        rect.x + rect.width,
        rect.y + rect.height,
        base_width,
        base_height,
        user_rotation,
        zoom,
    );
    let min_x = p1.x.min(p2.x);
    let min_y = p1.y.min(p2.y);
    let max_x = p1.x.max(p2.x);
    let max_y = p1.y.max(p2.y);
    RectBox {
        x: min_x,
        y: min_y,
        width: max_x - min_x,
        height: max_y - min_y,
    }
}

pub fn point_base_visual_to_pdf_user_space(
    vx: f64,
    vy: f64,
    crop_box: [f64; 4],
    intrinsic_rotation: RotationAngle,
) -> Point {
    let [cx0, cy0, cx1, cy1] = crop_box;
    match intrinsic_rotation {
        90 => Point {
            x: cx0 + vy,
            y: cy0 + vx,
        },
        180 => Point {
            x: cx1 - vx,
            y: cy0 + vy,
        },
        270 => Point {
            x: cx1 - vy,
            y: cy1 - vx,
        },
        _ => Point {
            x: cx0 + vx,
            y: cy1 - vy,
        },
    }
}

pub fn rect_base_visual_to_pdf_user_space(
    rect: RectBox,
    crop_box: [f64; 4],
    intrinsic_rotation: RotationAngle,
) -> [f64; 4] {
    let p1 = point_base_visual_to_pdf_user_space(rect.x, rect.y, crop_box, intrinsic_rotation);
    let p2 = point_base_visual_to_pdf_user_space(
        rect.x + rect.width,
        rect.y + rect.height,
        crop_box,
        intrinsic_rotation,
    );
    [
        p1.x.min(p2.x),
        p1.y.min(p2.y),
        p1.x.max(p2.x),
        p1.y.max(p2.y),
    ]
}

pub fn get_rotated_bounding_box(rect: RectBox, rotation_deg: f64) -> RectBox {
    if (rotation_deg % 360.0).abs() < 1e-6 {
        return rect;
    }
    let rad = rotation_deg.to_radians();
    let cos = rad.cos().abs();
    let sin = rad.sin().abs();
    let cx = rect.x + rect.width / 2.0;
    let cy = rect.y + rect.height / 2.0;
    let w = rect.width * cos + rect.height * sin;
    let h = rect.width * sin + rect.height * cos;
    RectBox {
        x: cx - w / 2.0,
        y: cy - h / 2.0,
        width: w,
        height: h,
    }
}

pub fn point_in_rotated_rect(
    px: f64,
    py: f64,
    rect: RectBox,
    rotation_deg: f64,
    pad: f64,
) -> bool {
    let cx = rect.x + rect.width / 2.0;
    let cy = rect.y + rect.height / 2.0;
    let dx = px - cx;
    let dy = py - cy;
    let (lx, ly) = if (rotation_deg % 360.0).abs() < 1e-4 {
        (dx, dy)
    } else {
        let rad = (-rotation_deg).to_radians();
        let cos = rad.cos();
        let sin = rad.sin();
        (dx * cos - dy * sin, dx * sin + dy * cos)
    };
    lx.abs() <= rect.width / 2.0 + pad && ly.abs() <= rect.height / 2.0 + pad
}

pub fn compute_rotated_resize_cursor(handle: ResizeHandle, total_rotation_deg: f64) -> &'static str {
    const CURSORS: [&str; 8] = [
        "n-resize",
        "ne-resize",
        "e-resize",
        "se-resize",
        "s-resize",
        "sw-resize",
        "w-resize",
        "nw-resize",
    ];
    let base = match handle {
        ResizeHandle::N => 0.0,
        ResizeHandle::Ne => 45.0,
        ResizeHandle::E => 90.0,
        ResizeHandle::Se => 135.0,
        ResizeHandle::S => 180.0,
        ResizeHandle::Sw => 225.0,
        ResizeHandle::W => 270.0,
        ResizeHandle::Nw => 315.0,
    };
    let angle = (base + total_rotation_deg).rem_euclid(360.0);
    let idx = (((angle + 22.5) / 45.0).floor() as usize) % 8;
    CURSORS[idx]
}

pub fn compute_rotated_resize_rect(params: RotatedResizeParams) -> RectBox {
    let start_rect = params.start_rect;
    let start_cx = start_rect.x + start_rect.width / 2.0;
    let start_cy = start_rect.y + start_rect.height / 2.0;
    let is_corner = matches!(
        params.handle,
        ResizeHandle::Nw | ResizeHandle::Ne | ResizeHandle::Se | ResizeHandle::Sw
    );
    let aspect_ratio = start_rect.width / start_rect.height.max(1.0);

    let disp_rad = params.frame_rotation_deg.to_radians();
    let cos = disp_rad.cos();
    let sin = disp_rad.sin();
    let local_dx = (params.dx_px * cos + params.dy_px * sin) / params.zoom;
    let local_dy = (-params.dx_px * sin + params.dy_px * cos) / params.zoom;

    let dir_x = match params.handle {
        ResizeHandle::Ne | ResizeHandle::E | ResizeHandle::Se => 1.0,
        ResizeHandle::Nw | ResizeHandle::W | ResizeHandle::Sw => -1.0,
        ResizeHandle::N | ResizeHandle::S => 0.0,
    };
    let dir_y = match params.handle {
        ResizeHandle::Sw | ResizeHandle::S | ResizeHandle::Se => 1.0,
        ResizeHandle::Nw | ResizeHandle::N | ResizeHandle::Ne => -1.0,
        ResizeHandle::W | ResizeHandle::E => 0.0,
    };

    let mut dw = dir_x * local_dx;
    let mut dh = dir_y * local_dy;

    let preserve_aspect = is_corner && (params.aspect_locked || params.shift_key);
    if preserve_aspect {
        if (dw.abs() / aspect_ratio) >= dh.abs() {
            dh = dw / aspect_ratio;
        } else {
            dw = dh * aspect_ratio;
        }
    }

    let min_size = params.min_size.max(1.0);
    let mut next_w = (start_rect.width + dw).max(min_size);
    let mut next_h = (start_rect.height + dh).max(min_size);
    if preserve_aspect {
        if next_w / aspect_ratio < min_size {
            next_h = min_size;
            next_w = next_h * aspect_ratio;
        } else {
            next_h = next_w / aspect_ratio;
        }
    }

    let actual_dw = next_w - start_rect.width;
    let actual_dh = next_h - start_rect.height;

    let local_shift_x = (dir_x * actual_dw) / 2.0;
    let local_shift_y = (dir_y * actual_dh) / 2.0;
    let disp_shift_x = (local_shift_x * cos - local_shift_y * sin) * params.zoom;
    let disp_shift_y = (local_shift_x * sin + local_shift_y * cos) * params.zoom;

    let base_shift = delta_display_to_base(disp_shift_x, disp_shift_y, params.user_rotation, params.zoom);
    let next_cx = start_cx + base_shift.x;
    let next_cy = start_cy + base_shift.y;

    RectBox {
        x: next_cx - next_w / 2.0,
        y: next_cy - next_h / 2.0,
        width: next_w,
        height: next_h,
    }
}

pub fn compute_viewport_surface_metrics(
    pages: &[gp_model::PageMeta],
    container_width: f64,
    container_height: f64,
    zoom: f64,
    is_mobile: bool,
) -> ViewportSurfaceMetrics {
    let mut max_page_scaled_width: f64 = 0.0;
    for p in pages {
        let dims = get_display_dimensions(p.base_width, p.base_height, p.user_rotation, zoom);
        if dims.width > max_page_scaled_width {
            max_page_scaled_width = dims.width;
        }
    }
    let safe_w = container_width.max(1.0);
    let safe_h = container_height.max(1.0);
    let is_zoomed_horiz = max_page_scaled_width + 32.0 > safe_w || zoom > 1.05;
    let viewport_margin_x = if is_zoomed_horiz {
        (safe_w * 0.35).round().max(48.0)
    } else {
        ((safe_w - max_page_scaled_width) / 2.0).floor().max(16.0)
    };
    let viewport_margin_y = (safe_h * 0.35)
        .round()
        .max(if is_mobile { 140.0 } else { 64.0 });
    let surface_width = safe_w.max((max_page_scaled_width + viewport_margin_x * 2.0).ceil());
    ViewportSurfaceMetrics {
        max_page_scaled_width,
        viewport_margin_x,
        viewport_margin_y,
        surface_width,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOffsetIndex {
    pub count: usize,
    pub row_tops: Vec<f64>,
    pub row_heights: Vec<f64>,
    pub row_lefts: Vec<f64>,
    pub page_widths: Vec<f64>,
    pub page_heights: Vec<f64>,
    pub total_height: f64,
}

impl PageOffsetIndex {
    pub fn build(pages: &[gp_model::PageMeta], zoom: f64, metrics: &ViewportSurfaceMetrics) -> Self {
        let count = pages.len();
        let mut row_tops = Vec::with_capacity(count);
        let mut row_heights = Vec::with_capacity(count);
        let mut row_lefts = Vec::with_capacity(count);
        let mut page_widths = Vec::with_capacity(count);
        let mut page_heights = Vec::with_capacity(count);
        let mut y = metrics.viewport_margin_y;
        for p in pages {
            let dims = get_display_dimensions(p.base_width, p.base_height, p.user_rotation, zoom);
            let row_h = dims.height + VIEWPORT_PAGE_GAP;
            row_tops.push(y);
            row_heights.push(row_h);
            page_widths.push(dims.width);
            page_heights.push(dims.height);
            row_lefts.push(
                metrics
                    .viewport_margin_x
                    .max((metrics.surface_width - dims.width) / 2.0),
            );
            y += row_h;
        }
        Self {
            count,
            row_tops,
            row_heights,
            row_lefts,
            page_widths,
            page_heights,
            total_height: y + metrics.viewport_margin_y,
        }
    }

    pub fn find_page_at_surface_y(&self, surface_y: f64) -> isize {
        if self.count == 0 {
            return -1;
        }
        if surface_y <= self.row_tops[0] {
            return 0;
        }
        let last = self.count - 1;
        if surface_y >= self.row_tops[last] + self.row_heights[last] {
            return last as isize;
        }
        let mut lo = 0usize;
        let mut hi = last;
        while lo <= hi {
            let mid = (lo + hi) >> 1;
            let top = self.row_tops[mid];
            let bot = top + self.row_heights[mid];
            if surface_y < top {
                if mid == 0 {
                    break;
                }
                hi = mid - 1;
            } else if surface_y >= bot {
                lo = mid + 1;
            } else {
                return mid as isize;
            }
        }
        lo.min(last) as isize
    }
}
