use gp_model::{RectBox, TextAlign, TextRun, TextScriptMode};
use serde::{Deserialize, Serialize};

use crate::{
    fonts::{is_builtin_font_family, parse_pdf_font_metadata},
    rich_text::{normalize_text_runs, runs_to_plain_text},
    turkish::normalize_unicode_for_pdf,
};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HorizontalRule {
    pub y: f64,
    pub x0: f64,
    pub x1: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerticalRule {
    pub x: f64,
    pub y0: f64,
    pub y1: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TableVectorBarriers {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal_rules: Option<Vec<HorizontalRule>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_rules: Option<Vec<VerticalRule>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_rects: Option<Vec<RectBox>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawExtractedLine {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runs: Option<Vec<TextRun>>,
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
    pub baseline_y: f64,
    pub font_size: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_width: Option<f64>,
    pub first_word_width: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_word_space: Option<f64>,
    pub color: String,
    pub font_family: String,
    pub raw_font_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_font_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_custom_font: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal_scale: Option<f64>,
    pub bold: bool,
    pub italic: bool,
    pub serif: bool,
    pub mono: bool,
    #[serde(default)]
    pub block_idx: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedTextBlock {
    pub id: String,
    pub page_id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runs: Option<Vec<TextRun>>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub font_size: f64,
    pub font_family: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_font_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_font_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_custom_font: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paragraph_width: Option<f64>,
    pub bold: bool,
    pub italic: bool,
    pub align: TextAlign,
    pub color: String,
    pub line_height: f64,
    pub baseline_offset: f64,
}

fn round_to(v: f64, decimals: u32) -> f64 {
    let factor = 10_f64.powi(decimals as i32);
    (v * factor).round() / factor
}

fn parse_hex_rgb(hex: &str) -> (i32, i32, i32) {
    let clean = hex.trim_start_matches('#');
    if clean.len() < 6 {
        return (0, 0, 0);
    }
    let r = i32::from_str_radix(&clean[0..2], 16).unwrap_or(0);
    let g = i32::from_str_radix(&clean[2..4], 16).unwrap_or(0);
    let b = i32::from_str_radix(&clean[4..6], 16).unwrap_or(0);
    (r, g, b)
}

fn are_colors_similar(a: &str, b: &str, max_channel_diff: i32) -> bool {
    if a == b {
        return true;
    }
    let (r1, g1, b1) = parse_hex_rgb(a);
    let (r2, g2, b2) = parse_hex_rgb(b);
    (r1 - r2).abs() <= max_channel_diff
        && (g1 - g2).abs() <= max_channel_diff
        && (b1 - b2).abs() <= max_channel_diff
}

fn has_horizontal_rule_between(
    prev: &RawExtractedLine,
    next: &RawExtractedLine,
    col_left: f64,
    col_right: f64,
    rules: Option<&[HorizontalRule]>,
) -> bool {
    let Some(rules) = rules else {
        return false;
    };
    if rules.is_empty() {
        return false;
    }
    let top_y = prev.baseline_y - prev.font_size * 0.1;
    let bot_y = next.baseline_y - next.font_size * 0.35;
    if bot_y <= top_y {
        return false;
    }
    let span_left = col_left.min(next.x0);
    let span_right = col_right.max(next.x1);
    let min_overlap = prev.font_size.min(next.font_size) * 1.2;
    let min_overlap = min_overlap.max(8.0);

    for r in rules {
        if r.y >= top_y && r.y <= bot_y {
            let overlap = r.x1.min(span_right) - r.x0.max(span_left);
            if overlap >= min_overlap {
                return true;
            }
        }
    }
    false
}

fn find_innermost_cell_index(cx: f64, cy: f64, cell_rects: Option<&[RectBox]>) -> isize {
    let Some(rects) = cell_rects else {
        return -1;
    };
    if rects.is_empty() {
        return -1;
    }
    let mut best_idx = -1isize;
    let mut best_area = f64::INFINITY;
    for (i, r) in rects.iter().enumerate() {
        if cx >= r.x - 1.0
            && cx <= r.x + r.width + 1.0
            && cy >= r.y - 1.0
            && cy <= r.y + r.height + 1.0
        {
            let area = r.width * r.height;
            if area < best_area {
                best_area = area;
                best_idx = i as isize;
            }
        }
    }
    best_idx
}

fn is_bullet_line_start(text: &str) -> bool {
    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return false;
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if matches!(
        first,
        '•' | '●' | '◦' | '▪' | '■' | '-' | '*' | '–' | '—'
    ) {
        return chars.next().map(|c| c.is_whitespace()).unwrap_or(false);
    }
    if first.is_ascii_digit() {
        let rest = trimmed.trim_start_matches(|c: char| c.is_ascii_digit());
        if let Some(after) = rest.strip_prefix('.').or_else(|| rest.strip_prefix(')')) {
            return after.chars().next().map(|c| c.is_whitespace()).unwrap_or(false);
        }
    }
    if first == '(' {
        if let Some(inner_end) = trimmed[1..].find(')') {
            let inner = &trimmed[1..1 + inner_end];
            if !inner.is_empty() && inner.chars().all(|c| c.is_ascii_alphanumeric()) {
                let after = &trimmed[2 + inner_end..];
                return after.chars().next().map(|c| c.is_whitespace()).unwrap_or(false);
            }
        }
    }
    false
}

fn ends_with_sentence_punct(trimmed_end: &str) -> bool {
    trimmed_end
        .chars()
        .last()
        .map(|c| matches!(c, '.' | '!' | '?' | ':' | '…' | '»' | '”' | ')'))
        .unwrap_or(false)
}

fn ends_with_gap_punct(trimmed_end: &str) -> bool {
    trimmed_end
        .chars()
        .last()
        .map(|c| matches!(c, '.' | '!' | '?' | '…' | '»' | '”' | ')'))
        .unwrap_or(false)
}

fn detect_paragraph_alignment(
    group: &[&RawExtractedLine],
    soft_wrapped_flags: &[bool],
    min_x: f64,
    max_r: f64,
) -> TextAlign {
    if group.len() < 2 {
        return TextAlign::Left;
    }
    let block_width = max_r - min_x;
    let fs = group[0].font_size;
    let tol = 2.5_f64.max(fs * 0.34);

    let mut justified_hits = 0usize;
    let mut soft_count = 0usize;
    let mut has_stretched_space = false;

    for i in 0..(group.len() - 1) {
        if !soft_wrapped_flags.get(i).copied().unwrap_or(false) {
            continue;
        }
        soft_count += 1;
        let line = group[i];
        let left_ok = (line.x0 - min_x).abs() <= tol
            || (i == 0 && line.x0 > min_x && line.x0 - min_x <= fs * 4.5);
        let right_ok = (line.x1 - max_r).abs() <= tol;
        if left_ok && right_ok {
            justified_hits += 1;
        }
        if line.max_word_space.unwrap_or(0.0) >= fs * 0.34 {
            has_stretched_space = true;
        }
    }

    if block_width >= fs * 10.0
        && soft_count >= 1
        && (justified_hits >= 2
            || (justified_hits == 1 && soft_count == 1 && has_stretched_space))
    {
        return TextAlign::Justify;
    }

    let block_center = (min_x + max_r) / 2.0;
    let mut min_x0 = f64::INFINITY;
    let mut max_x0 = f64::NEG_INFINITY;
    let mut min_x1 = f64::INFINITY;
    let mut max_x1 = f64::NEG_INFINITY;
    for l in group {
        min_x0 = min_x0.min(l.x0);
        max_x0 = max_x0.max(l.x0);
        min_x1 = min_x1.min(l.x1);
        max_x1 = max_x1.max(l.x1);
    }
    let x0_spread = max_x0 - min_x0;
    let x1_spread = max_x1 - min_x1;

    if x0_spread > fs * 0.5 {
        if group.iter().all(|l| (l.x1 - max_r).abs() <= tol) {
            return TextAlign::Right;
        }
        if group
            .iter()
            .all(|l| ((l.x0 + l.x1) / 2.0 - block_center).abs() <= tol)
            && x1_spread > fs * 0.5
        {
            return TextAlign::Center;
        }
    }

    TextAlign::Left
}

fn can_merge_into_group(
    group: &[&RawExtractedLine],
    candidate: &RawExtractedLine,
    barriers: &TableVectorBarriers,
) -> bool {
    let prev = group[group.len() - 1];
    let min_fs = prev.font_size.min(candidate.font_size);
    let max_fs = prev.font_size.max(candidate.font_size);

    let vertical_gap = candidate.baseline_y - prev.baseline_y;
    if vertical_gap <= min_fs * 0.4 || vertical_gap > max_fs * 2.3 {
        return false;
    }
    if candidate.y0 - prev.y1 > max_fs * 1.65 {
        return false;
    }

    if group.len() >= 2 {
        let mut sum_gap = 0.0;
        for i in 1..group.len() {
            sum_gap += group[i].baseline_y - group[i - 1].baseline_y;
        }
        let avg_leading = sum_gap / (group.len() - 1) as f64;
        if avg_leading > 0.0 && vertical_gap > avg_leading * 1.62 && vertical_gap > max_fs * 1.95 {
            return false;
        }
    }

    let mut col_left = f64::INFINITY;
    let mut col_right = f64::NEG_INFINITY;
    for l in group {
        col_left = col_left.min(l.x0);
        col_right = col_right.max(l.x1);
    }

    if has_horizontal_rule_between(
        prev,
        candidate,
        col_left,
        col_right,
        barriers.horizontal_rules.as_deref(),
    ) {
        return false;
    }

    if let Some(cell_rects) = barriers.cell_rects.as_deref() {
        if !cell_rects.is_empty() {
            let prev_cell = find_innermost_cell_index(
                (prev.x0 + prev.x1) / 2.0,
                (prev.y0 + prev.y1) / 2.0,
                Some(cell_rects),
            );
            let cand_cell = find_innermost_cell_index(
                (candidate.x0 + candidate.x1) / 2.0,
                (candidate.y0 + candidate.y1) / 2.0,
                Some(cell_rects),
            );
            if prev_cell != cand_cell {
                return false;
            }
        }
    }

    let prev_mid_x = (prev.x0 + prev.x1) / 2.0;
    let cand_mid_x = (candidate.x0 + candidate.x1) / 2.0;
    if (cand_mid_x - prev_mid_x).abs() > 2.0 {
        if let Some(v_rules) = barriers.vertical_rules.as_deref() {
            let lo_x = prev_mid_x.min(cand_mid_x);
            let hi_x = prev_mid_x.max(cand_mid_x);
            if v_rules
                .iter()
                .any(|v| v.x >= lo_x && v.x <= hi_x && v.y1 >= prev.y0 && v.y0 <= candidate.y1)
            {
                return false;
            }
        }
    }

    if (candidate.font_size - prev.font_size).abs() > 1.35_f64.max(min_fs * 0.14) {
        return false;
    }
    if !are_colors_similar(&candidate.color, &prev.color, 34) {
        return false;
    }
    if candidate.mono != prev.mono {
        return false;
    }
    if candidate.font_family != prev.font_family && candidate.serif != prev.serif {
        let same_left = (candidate.x0 - prev.x0).abs() <= max_fs * 0.8;
        let same_right = (candidate.x1 - prev.x1).abs() <= max_fs * 1.2;
        if !same_left && !same_right {
            return false;
        }
    }

    let overlap = candidate.x1.min(col_right) - candidate.x0.max(col_left);
    if overlap <= 0.0 {
        return false;
    }

    let col_center = (col_left + col_right) / 2.0;
    let cand_center = (candidate.x0 + candidate.x1) / 2.0;
    let left_aligned = (candidate.x0 - col_left).abs() <= max_fs * 1.8;
    let prev_left_aligned = (candidate.x0 - prev.x0).abs() <= max_fs * 1.8;
    let first_line_indented = group.len() == 1
        && prev.x0 > candidate.x0
        && prev.x0 - candidate.x0 <= max_fs * 4.5
        && candidate.x1 >= prev.x0;
    let hanging_indent = group.len() == 1
        && candidate.x0 > prev.x0
        && candidate.x0 - prev.x0 <= max_fs * 4.5
        && (is_bullet_line_start(&prev.text)
            || (candidate.x1 - prev.x1).abs() <= max_fs * 2.5
            || prev.x1 - prev.x0 >= max_fs * 8.0);
    let center_aligned = (cand_center - col_center).abs() <= max_fs * 1.25;
    let right_aligned = (candidate.x1 - col_right).abs() <= max_fs * 1.25;

    if !left_aligned
        && !prev_left_aligned
        && !first_line_indented
        && !hanging_indent
        && !center_aligned
        && !right_aligned
    {
        return false;
    }

    if group.len() == 1 && prev.bold && !candidate.bold {
        let expected_right = col_right.max(candidate.x1);
        let word_could_fit_on_prev = prev.x1 + prev.font_size * 0.35 + candidate.first_word_width
            < expected_right - prev.font_size * 1.2;
        if prev.x1 + prev.font_size * 1.5 < candidate.x1 && word_could_fit_on_prev {
            return false;
        }
    }

    let trimmed_prev = prev.text.trim_end();
    let mut sorted_rights: Vec<f64> = group.iter().map(|l| l.x1).collect();
    sorted_rights.sort_by(|a, b| a.total_cmp(b));
    let typical_right = if group.len() >= 3 {
        sorted_rights[sorted_rights.len() - 2]
    } else {
        col_right
    };
    if group.len() >= 2
        && ends_with_sentence_punct(trimmed_prev)
        && prev.x1 + prev.font_size * 0.35 + candidate.first_word_width
            < typical_right - prev.font_size * 1.65
    {
        return false;
    }

    true
}

/// Groups raw extracted horizontal text lines into coherent editable paragraphs/blocks,
/// inferring justification, leading, soft-wrap joins, and table barriers.
pub fn build_detected_text_blocks(
    raw_lines: &[RawExtractedLine],
    page_id: &str,
    barriers: Option<&TableVectorBarriers>,
) -> Vec<DetectedTextBlock> {
    if raw_lines.is_empty() {
        return Vec::new();
    }
    let default_barriers = TableVectorBarriers::default();
    let barriers = barriers.unwrap_or(&default_barriers);

    let mut ordered_lines: Vec<&RawExtractedLine> = raw_lines
        .iter()
        .filter(|l| !l.text.trim().is_empty())
        .collect();
    ordered_lines.sort_by(|a, b| {
        if (a.baseline_y - b.baseline_y).abs() > 0.5 {
            a.baseline_y.total_cmp(&b.baseline_y)
        } else {
            a.x0.total_cmp(&b.x0)
        }
    });

    let mut groups: Vec<Vec<&RawExtractedLine>> = Vec::new();
    let mut group_last_sorted_idx: Vec<usize> = Vec::new();

    for (i, cand) in ordered_lines.iter().enumerate() {
        let mut best_group_idx: Option<usize> = None;
        let mut best_score = f64::INFINITY;

        for g_idx in (0..groups.len()).rev() {
            let group = &groups[g_idx];
            let prev = group[group.len() - 1];
            if cand.baseline_y - prev.baseline_y > prev.font_size.max(cand.font_size) * 2.5 {
                continue;
            }
            if !can_merge_into_group(group, cand, barriers) {
                continue;
            }

            let last_line_idx = group_last_sorted_idx[g_idx];
            let span_min_x = prev.x0.min(cand.x0);
            let span_max_x = prev.x1.max(cand.x1);
            let mut blocked = false;
            for mid in &ordered_lines[(last_line_idx + 1)..i] {
                if mid.baseline_y > prev.baseline_y + 1.0 && mid.baseline_y < cand.baseline_y - 1.0
                {
                    let h_overlap = mid.x1.min(span_max_x) - mid.x0.max(span_min_x);
                    if h_overlap > 2.0 {
                        blocked = true;
                        break;
                    }
                }
            }
            if blocked {
                continue;
            }

            let score = (cand.x0 - prev.x0).abs() * 0.5 + (cand.baseline_y - prev.baseline_y);
            if score < best_score {
                best_score = score;
                best_group_idx = Some(g_idx);
            }
        }

        if let Some(g_idx) = best_group_idx {
            groups[g_idx].push(cand);
            group_last_sorted_idx[g_idx] = i;
        } else {
            groups.push(vec![cand]);
            group_last_sorted_idx.push(i);
        }
    }

    let mut blocks = Vec::new();

    for (blk_idx, group) in groups.into_iter().enumerate() {
        let first = group[0];
        let last = group[group.len() - 1];

        let mut min_x = f64::INFINITY;
        let mut min_y = first.baseline_y - first.font_size * 0.88;
        let mut max_r = f64::NEG_INFINITY;
        let mut max_b = last.baseline_y + last.font_size * 0.25;
        for l in &group {
            min_x = min_x.min(l.x0);
            min_y = min_y.min(l.y0);
            max_r = max_r.max(l.x1);
            max_b = max_b.max(l.y1);
        }

        let mut line_height = 1.2;
        if group.len() > 1 {
            let mut sum = 0.0;
            for i in 1..group.len() {
                sum += group[i].baseline_y - group[i - 1].baseline_y;
            }
            let avg_diff = sum / (group.len() - 1) as f64;
            line_height = round_to((avg_diff / first.font_size).clamp(1.0, 2.1), 2);
        }

        let bold_count = group.iter().filter(|l| l.bold).count();
        let italic_count = group.iter().filter(|l| l.italic).count();
        let dom_bold = bold_count * 2 > group.len();
        let dom_italic = italic_count * 2 > group.len();

        let line_runs = |l: &RawExtractedLine| -> Vec<TextRun> {
            if let Some(runs) = &l.runs {
                if !runs.is_empty() {
                    return runs.clone();
                }
            }
            vec![TextRun {
                text: l.text.trim().to_string(),
                bold: Some(l.bold),
                italic: Some(l.italic),
                script: Some(TextScriptMode::Normal),
            }]
        };

        let mut soft_wrapped_flags = Vec::with_capacity(group.len().saturating_sub(1));
        let mut merged_runs = line_runs(group[0]);

        for i in 0..(group.len() - 1) {
            let prev = group[i];
            let next = group[i + 1];
            let prev_trimmed = prev.text.trim_end();
            let next_trimmed = next.text.trim_start();
            let space_w = prev.font_size * 0.28;
            let first_word_w = next.first_word_width.max(prev.font_size * 0.75);
            let word_count = prev_trimmed.split_whitespace().count();
            let starts_bullet = is_bullet_line_start(next_trimmed);
            let is_short_label = prev_trimmed.ends_with(':')
                || (max_r - min_x < prev.font_size * 12.0 && word_count < 4);
            let is_sentence_end_with_gap = ends_with_gap_punct(prev_trimmed)
                && max_r - prev.x1 > first_word_w + prev.font_size * 1.4;

            let soft_wrapped = !starts_bullet
                && !is_short_label
                && !is_sentence_end_with_gap
                && prev.x1 + space_w + first_word_w >= max_r - prev.font_size * 0.95;

            soft_wrapped_flags.push(soft_wrapped);
            merged_runs.push(TextRun {
                text: if soft_wrapped {
                    " ".to_string()
                } else {
                    "\n".to_string()
                },
                bold: Some(dom_bold),
                italic: Some(dom_italic),
                script: Some(TextScriptMode::Normal),
            });
            merged_runs.extend(line_runs(next));
        }

        let normalized_runs = normalize_text_runs(&merged_runs, dom_bold, dom_italic);
        let final_text = runs_to_plain_text(&normalized_runs).trim().to_string();
        if final_text.is_empty() {
            continue;
        }

        let align = detect_paragraph_alignment(&group, &soft_wrapped_flags, min_x, max_r);
        let has_rich_variation = normalized_runs.iter().any(|r| {
            r.script.unwrap_or(TextScriptMode::Normal) != TextScriptMode::Normal
                || r.bold.unwrap_or(dom_bold) != dom_bold
                || r.italic.unwrap_or(dom_italic) != dom_italic
        });

        let parsed_dominant = parse_pdf_font_metadata(
            &first.raw_font_name,
            first.serif,
            first.mono,
            dom_bold,
            dom_italic,
        );
        let has_custom_font =
            group.iter().any(|l| l.is_custom_font.unwrap_or(false)) || parsed_dominant.is_custom_font;
        let avg_scale = group
            .iter()
            .map(|l| {
                l.horizontal_scale
                    .unwrap_or(parsed_dominant.estimated_horizontal_scale)
            })
            .sum::<f64>()
            / group.len() as f64;

        blocks.push(DetectedTextBlock {
            id: format!("txtblk_{blk_idx}_{}", page_id),
            page_id: page_id.to_string(),
            text: normalize_unicode_for_pdf(&final_text),
            runs: if has_rich_variation {
                Some(normalized_runs)
            } else {
                None
            },
            x: min_x,
            y: min_y,
            width: 10.0_f64.max(max_r - min_x),
            height: (first.font_size * 1.15).max(max_b - min_y),
            font_size: round_to(first.font_size, 3),
            font_family: first.font_family.clone(),
            fallback_font_family: Some(if is_builtin_font_family(&first.font_family) {
                first.font_family.clone()
            } else {
                parsed_dominant.font_family
            }),
            font_source: Some("builtin".to_string()),
            raw_font_name: Some(first.raw_font_name.clone()),
            original_font_name: Some(
                first
                    .original_font_name
                    .clone()
                    .unwrap_or(parsed_dominant.clean_font_name),
            ),
            is_custom_font: Some(has_custom_font),
            horizontal_scale: Some(round_to(avg_scale, 3)),
            letter_spacing: Some(0.0),
            paragraph_width: Some(round_to(max_r - min_x, 2)),
            bold: dom_bold,
            italic: dom_italic,
            align,
            color: first.color.clone(),
            line_height,
            baseline_offset: first.baseline_y - min_y,
        });
    }

    blocks
}
