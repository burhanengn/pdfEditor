use gp_model::{NormalizedPoint, Point, RectBox, VectorShapeType, VectorStrokeDash};
use serde::{Deserialize, Serialize};

const KAPPA: f64 = 0.5522847498;
const MIN_PATH_BOX_DIM: f64 = 12.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPathResult {
    pub rect: RectBox,
    pub points: Vec<NormalizedPoint>,
}

pub fn shape_to_svg_path(shape_type: VectorShapeType, width: f64, height: f64, border_radius: f64) -> String {
    let w = width.max(1.0);
    let h = height.max(1.0);
    match shape_type {
        VectorShapeType::Rect => {
            let r = border_radius.max(0.0).min(w / 2.0).min(h / 2.0);
            if r <= 0.1 {
                return format!("M 0 0 L {w:.2} 0 L {w:.2} {h:.2} L 0 {h:.2} Z");
            }
            let k = r * KAPPA;
            format!(
                "M {:.2} 0 L {:.2} 0 C {:.2} 0 {:.2} {:.2} {:.2} {:.2} L {:.2} {:.2} C {:.2} {:.2} {:.2} {:.2} {:.2} {:.2} L {:.2} {:.2} C {:.2} {:.2} 0 {:.2} 0 {:.2} L 0 {:.2} C 0 {:.2} {:.2} 0 {:.2} 0 Z",
                r, w - r,
                w - r + k, w, r - k, w, r,
                w, h - r,
                w, h - r + k, w - r + k, h, w - r, h,
                r, h,
                r - k, h, h - r + k, 0.0_f64.max(h - r),
                r,
                r - k, r - k, r
            )
        }
        VectorShapeType::Ellipse => {
            let rx = w / 2.0;
            let ry = h / 2.0;
            let kx = rx * KAPPA;
            let ky = ry * KAPPA;
            format!(
                "M {:.2} 0 C {:.2} 0 {:.2} {:.2} {:.2} {:.2} C {:.2} {:.2} {:.2} {:.2} {:.2} {:.2} C {:.2} {:.2} 0 {:.2} 0 {:.2} C 0 {:.2} {:.2} 0 {:.2} 0 Z",
                rx,
                rx + kx, w, ry - ky, w, ry,
                w, ry + ky, rx + kx, h, rx, h,
                rx - kx, h, ry + ky, ry,
                ry - ky, rx - kx, rx
            )
        }
        VectorShapeType::Triangle => {
            format!("M {:.2} 0 L {:.2} {:.2} L 0 {:.2} Z", w / 2.0, w, h, h)
        }
        VectorShapeType::Diamond => {
            format!(
                "M {:.2} 0 L {:.2} {:.2} L {:.2} {:.2} L 0 {:.2} Z",
                w / 2.0, w, h / 2.0, w / 2.0, h, h / 2.0
            )
        }
        VectorShapeType::Arrow => {
            format!(
                "M 0 {:.2} L {:.2} {:.2} L {:.2} 0 L {:.2} {:.2} L {:.2} {:.2} L {:.2} {:.2} L 0 {:.2} Z",
                h * 0.3, w * 0.62, h * 0.3, w * 0.62, w, h * 0.5, w * 0.62, h, w * 0.62, h * 0.7, h * 0.7
            )
        }
    }
}

pub fn path_points_to_svg_path(
    points: &[NormalizedPoint],
    width: f64,
    height: f64,
    closed: bool,
    smooth: bool,
) -> String {
    if points.is_empty() {
        return String::new();
    }
    let bw = width.max(1.0);
    let bh = height.max(1.0);
    let abs: Vec<Point> = points
        .iter()
        .map(|p| Point {
            x: p.x * bw,
            y: p.y * bh,
        })
        .collect();

    if abs.len() == 1 {
        return format!(
            "M {:.2} {:.2} L {:.2} {:.2}",
            abs[0].x,
            abs[0].y,
            abs[0].x + 0.5,
            abs[0].y + 0.5
        );
    }

    if !smooth || abs.len() < 3 {
        let mut segs = Vec::with_capacity(abs.len() + 1);
        segs.push(format!("M {:.2} {:.2}", abs[0].x, abs[0].y));
        for pt in &abs[1..] {
            segs.push(format!("L {:.2} {:.2}", pt.x, pt.y));
        }
        if closed {
            segs.push("Z".to_string());
        }
        return segs.join(" ");
    }

    if !closed {
        let mut d = format!("M {:.2} {:.2}", abs[0].x, abs[0].y);
        for i in 1..(abs.len() - 1) {
            let mid_x = (abs[i].x + abs[i + 1].x) / 2.0;
            let mid_y = (abs[i].y + abs[i + 1].y) / 2.0;
            d.push_str(&format!(
                " Q {:.2} {:.2} {:.2} {:.2}",
                abs[i].x, abs[i].y, mid_x, mid_y
            ));
        }
        let last = abs[abs.len() - 1];
        d.push_str(&format!(" L {:.2} {:.2}", last.x, last.y));
        return d;
    }

    let last = abs[abs.len() - 1];
    let mid0_x = (last.x + abs[0].x) / 2.0;
    let mid0_y = (last.y + abs[0].y) / 2.0;
    let mut d = format!("M {:.2} {:.2}", mid0_x, mid0_y);
    for i in 0..abs.len() {
        let next = abs[(i + 1) % abs.len()];
        let mid_x = (abs[i].x + next.x) / 2.0;
        let mid_y = (abs[i].y + next.y) / 2.0;
        d.push_str(&format!(
            " Q {:.2} {:.2} {:.2} {:.2}",
            abs[i].x, abs[i].y, mid_x, mid_y
        ));
    }
    d.push_str(" Z");
    d
}

pub fn stroke_dash_to_array(dash: VectorStrokeDash, stroke_width: f64) -> Option<[f64; 2]> {
    let sw = stroke_width.max(1.0);
    let round2 = |v: f64| (v * 100.0).round() / 100.0;
    match dash {
        VectorStrokeDash::Solid => None,
        VectorStrokeDash::Dashed => Some([round2((sw * 3.0).max(4.0)), round2((sw * 2.0).max(3.0))]),
        VectorStrokeDash::Dotted => Some([round2(sw), round2((sw * 2.0).max(2.5))]),
    }
}

pub fn normalize_absolute_points(abs_points: &[Point]) -> NormalizedPathResult {
    if abs_points.is_empty() {
        return NormalizedPathResult {
            rect: RectBox {
                x: 0.0,
                y: 0.0,
                width: MIN_PATH_BOX_DIM,
                height: MIN_PATH_BOX_DIM,
            },
            points: Vec::new(),
        };
    }

    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for p in abs_points {
        min_x = min_x.min(p.x);
        max_x = max_x.max(p.x);
        min_y = min_y.min(p.y);
        max_y = max_y.max(p.y);
    }

    let raw_w = max_x - min_x;
    let raw_h = max_y - min_y;
    let width = raw_w.max(MIN_PATH_BOX_DIM);
    let height = raw_h.max(MIN_PATH_BOX_DIM);
    let x = if raw_w < MIN_PATH_BOX_DIM {
        (min_x + max_x) / 2.0 - width / 2.0
    } else {
        min_x
    };
    let y = if raw_h < MIN_PATH_BOX_DIM {
        (min_y + max_y) / 2.0 - height / 2.0
    } else {
        min_y
    };

    let points = abs_points
        .iter()
        .map(|p| NormalizedPoint {
            x: (p.x - x) / width,
            y: (p.y - y) / height,
            pressure: None,
        })
        .collect();

    NormalizedPathResult {
        rect: RectBox { x, y, width, height },
        points,
    }
}
