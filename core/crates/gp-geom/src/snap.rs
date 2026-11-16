use gp_model::RectBox;
use serde::{Deserialize, Serialize};

const SNAP_THRESHOLD: f64 = 5.0;
const PAGE_MARGIN: f64 = 36.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GuideOrientation {
    Vertical,
    Horizontal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapGuide {
    pub orientation: GuideOrientation,
    pub position: f64,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapResult {
    pub x: f64,
    pub y: f64,
    pub guides: Vec<SnapGuide>,
}

struct TargetLine {
    value: f64,
    start: f64,
    end: f64,
}

pub fn compute_snap_position(
    moving_rect: RectBox,
    page_width: f64,
    page_height: f64,
    siblings: &[RectBox],
    enabled: bool,
) -> SnapResult {
    if !enabled {
        return SnapResult {
            x: moving_rect.x,
            y: moving_rect.y,
            guides: Vec::new(),
        };
    }

    let mut x_targets = vec![
        TargetLine { value: PAGE_MARGIN, start: 0.0, end: page_height },
        TargetLine { value: page_width / 2.0, start: 0.0, end: page_height },
        TargetLine { value: page_width - PAGE_MARGIN, start: 0.0, end: page_height },
    ];
    let mut y_targets = vec![
        TargetLine { value: PAGE_MARGIN, start: 0.0, end: page_width },
        TargetLine { value: page_height / 2.0, start: 0.0, end: page_width },
        TargetLine { value: page_height - PAGE_MARGIN, start: 0.0, end: page_width },
    ];

    for sib in siblings {
        let min_y = moving_rect.y.min(sib.y) - 12.0;
        let max_y = (moving_rect.y + moving_rect.height).max(sib.y + sib.height) + 12.0;
        x_targets.push(TargetLine { value: sib.x, start: min_y, end: max_y });
        x_targets.push(TargetLine { value: sib.x + sib.width / 2.0, start: min_y, end: max_y });
        x_targets.push(TargetLine { value: sib.x + sib.width, start: min_y, end: max_y });

        let min_x = moving_rect.x.min(sib.x) - 12.0;
        let max_x = (moving_rect.x + moving_rect.width).max(sib.x + sib.width) + 12.0;
        y_targets.push(TargetLine { value: sib.y, start: min_x, end: max_x });
        y_targets.push(TargetLine { value: sib.y + sib.height / 2.0, start: min_x, end: max_x });
        y_targets.push(TargetLine { value: sib.y + sib.height, start: min_x, end: max_x });
    }

    let moving_x = [
        moving_rect.x,
        moving_rect.x + moving_rect.width / 2.0,
        moving_rect.x + moving_rect.width,
    ];
    let mut best_dx = 0.0;
    let mut best_x_dist = SNAP_THRESHOLD + 1.0;
    let mut best_x_guide: Option<SnapGuide> = None;

    for edge in moving_x {
        for target in &x_targets {
            let dist = (target.value - edge).abs();
            if dist < best_x_dist {
                best_x_dist = dist;
                best_dx = target.value - edge;
                best_x_guide = Some(SnapGuide {
                    orientation: GuideOrientation::Vertical,
                    position: target.value,
                    start: target.start,
                    end: target.end,
                });
            }
        }
    }

    let moving_y = [
        moving_rect.y,
        moving_rect.y + moving_rect.height / 2.0,
        moving_rect.y + moving_rect.height,
    ];
    let mut best_dy = 0.0;
    let mut best_y_dist = SNAP_THRESHOLD + 1.0;
    let mut best_y_guide: Option<SnapGuide> = None;

    for edge in moving_y {
        for target in &y_targets {
            let dist = (target.value - edge).abs();
            if dist < best_y_dist {
                best_y_dist = dist;
                best_dy = target.value - edge;
                best_y_guide = Some(SnapGuide {
                    orientation: GuideOrientation::Horizontal,
                    position: target.value,
                    start: target.start,
                    end: target.end,
                });
            }
        }
    }

    let mut guides = Vec::new();
    let x = if best_x_dist <= SNAP_THRESHOLD {
        if let Some(g) = best_x_guide {
            guides.push(g);
        }
        moving_rect.x + best_dx
    } else {
        moving_rect.x
    };
    let y = if best_y_dist <= SNAP_THRESHOLD {
        if let Some(g) = best_y_guide {
            guides.push(g);
        }
        moving_rect.y + best_dy
    } else {
        moving_rect.y
    };

    SnapResult { x, y, guides }
}
