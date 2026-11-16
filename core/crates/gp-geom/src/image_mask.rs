use gp_model::{Point, RectBox, RotateCopyPivot};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgPathCommand {
    pub cmd: char,
    pub nums: Vec<f64>,
}

pub fn normalize_angle_360(deg: f64) -> f64 {
    deg.rem_euclid(360.0)
}

pub fn element_local_to_page(lx: f64, ly: f64, box_rect: RectBox, rotation_deg: f64) -> Point {
    let cx = box_rect.x + box_rect.width / 2.0;
    let cy = box_rect.y + box_rect.height / 2.0;
    let rel_x = lx - box_rect.width / 2.0;
    let rel_y = ly - box_rect.height / 2.0;
    if (rotation_deg % 360.0).abs() < 1e-4 {
        return Point {
            x: cx + rel_x,
            y: cy + rel_y,
        };
    }
    let rad = rotation_deg.to_radians();
    let cos = rad.cos();
    let sin = rad.sin();
    Point {
        x: cx + rel_x * cos - rel_y * sin,
        y: cy + rel_x * sin + rel_y * cos,
    }
}

pub fn page_to_element_local(px: f64, py: f64, box_rect: RectBox, rotation_deg: f64) -> Point {
    let cx = box_rect.x + box_rect.width / 2.0;
    let cy = box_rect.y + box_rect.height / 2.0;
    let dx = px - cx;
    let dy = py - cy;
    if (rotation_deg % 360.0).abs() < 1e-4 {
        return Point {
            x: dx + box_rect.width / 2.0,
            y: dy + box_rect.height / 2.0,
        };
    }
    let rad = (-rotation_deg).to_radians();
    let cos = rad.cos();
    let sin = rad.sin();
    Point {
        x: dx * cos - dy * sin + box_rect.width / 2.0,
        y: dx * sin + dy * cos + box_rect.height / 2.0,
    }
}

pub fn get_element_pivot_on_page(rect: RectBox, rotation: f64, pivot: RotateCopyPivot) -> Point {
    match pivot {
        RotateCopyPivot::TopCenter => element_local_to_page(rect.width / 2.0, 0.0, rect, rotation),
        RotateCopyPivot::BottomCenter => {
            element_local_to_page(rect.width / 2.0, rect.height, rect, rotation)
        }
        RotateCopyPivot::LeftCenter => element_local_to_page(0.0, rect.height / 2.0, rect, rotation),
        RotateCopyPivot::RightCenter => {
            element_local_to_page(rect.width, rect.height / 2.0, rect, rotation)
        }
        RotateCopyPivot::Center => Point {
            x: rect.x + rect.width / 2.0,
            y: rect.y + rect.height / 2.0,
        },
    }
}

pub fn rotate_rect_around_pivot(
    rect: RectBox,
    rotation_deg: f64,
    delta_deg: f64,
    pivot_pt: Point,
) -> (f64, f64, f64) {
    let cx = rect.x + rect.width / 2.0;
    let cy = rect.y + rect.height / 2.0;
    let rad = delta_deg.to_radians();
    let cos = rad.cos();
    let sin = rad.sin();
    let dx = cx - pivot_pt.x;
    let dy = cy - pivot_pt.y;
    let next_cx = pivot_pt.x + dx * cos - dy * sin;
    let next_cy = pivot_pt.y + dx * sin + dy * cos;
    (
        next_cx - rect.width / 2.0,
        next_cy - rect.height / 2.0,
        normalize_angle_360(rotation_deg + delta_deg),
    )
}

pub fn parse_svg_path_commands(d: &str) -> Vec<SvgPathCommand> {
    let mut cmds = Vec::new();
    let mut cur_cmd: Option<char> = None;
    let mut buf = String::new();

    let flush = |cmd_opt: Option<char>, raw: &mut String, out: &mut Vec<SvgPathCommand>| {
        if let Some(c) = cmd_opt {
            let nums = raw
                .split(|ch: char| ch.is_whitespace() || ch == ',')
                .filter(|s| !s.is_empty())
                .filter_map(|s| s.parse::<f64>().ok())
                .collect();
            out.push(SvgPathCommand { cmd: c, nums });
        }
        raw.clear();
    };

    for ch in d.chars() {
        let up = ch.to_ascii_uppercase();
        if matches!(up, 'M' | 'L' | 'Q' | 'C' | 'Z') {
            flush(cur_cmd, &mut buf, &mut cmds);
            cur_cmd = Some(up);
        } else {
            buf.push(ch);
        }
    }
    flush(cur_cmd, &mut buf, &mut cmds);
    cmds
}

pub fn serialize_svg_path_commands(cmds: &[SvgPathCommand], decimals: usize) -> String {
    let factor = 10_f64.powi(decimals as i32);
    cmds.iter()
        .map(|c| {
            if c.cmd == 'Z' {
                "Z".to_string()
            } else {
                let parts: Vec<String> = c
                    .nums
                    .iter()
                    .map(|n| {
                        let rounded = (n * factor).round() / factor;
                        format!("{rounded}")
                    })
                    .collect();
                format!("{} {}", c.cmd, parts.join(" "))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn flip_svg_path(d: &str, width: f64, height: f64, flip_x: bool, flip_y: bool, decimals: usize) -> String {
    if !flip_x && !flip_y {
        return d.to_string();
    }
    let cmds = parse_svg_path_commands(d);
    let mapped: Vec<SvgPathCommand> = cmds
        .into_iter()
        .map(|c| {
            if c.cmd == 'Z' {
                return c;
            }
            let mut nums = Vec::with_capacity(c.nums.len());
            for pair in c.nums.chunks_exact(2) {
                nums.push(if flip_x { width - pair[0] } else { pair[0] });
                nums.push(if flip_y { height - pair[1] } else { pair[1] });
            }
            SvgPathCommand { cmd: c.cmd, nums }
        })
        .collect();
    serialize_svg_path_commands(&mapped, decimals)
}

pub fn scale_svg_path(d: &str, sx: f64, sy: f64, decimals: usize) -> String {
    if (sx - 1.0).abs() < 1e-6 && (sy - 1.0).abs() < 1e-6 {
        return d.to_string();
    }
    let cmds = parse_svg_path_commands(d);
    let mapped: Vec<SvgPathCommand> = cmds
        .into_iter()
        .map(|c| {
            if c.cmd == 'Z' {
                return c;
            }
            let mut nums = Vec::with_capacity(c.nums.len());
            for pair in c.nums.chunks_exact(2) {
                nums.push(pair[0] * sx);
                nums.push(pair[1] * sy);
            }
            SvgPathCommand { cmd: c.cmd, nums }
        })
        .collect();
    serialize_svg_path_commands(&mapped, decimals)
}
