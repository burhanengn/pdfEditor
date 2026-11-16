use gp_model::{TextRun, TextScriptMode};
use serde::{Deserialize, Serialize};

use crate::turkish::normalize_unicode_for_pdf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPiece {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub script: TextScriptMode,
    pub is_space: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedRichLine {
    pub pieces: Vec<RunPiece>,
    pub natural_width: f64,
    pub space_count: usize,
    pub ends_paragraph: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildWrappedRichLinesOptions {
    #[serde(default)]
    pub disable_soft_wrap: bool,
    #[serde(default = "default_tolerance_ratio")]
    pub width_tolerance_ratio: f64,
    #[serde(default = "default_tolerance_pt")]
    pub width_tolerance_pt: f64,
}

fn default_tolerance_ratio() -> f64 {
    0.025
}

fn default_tolerance_pt() -> f64 {
    2.0
}

impl Default for BuildWrappedRichLinesOptions {
    fn default() -> Self {
        Self {
            disable_soft_wrap: false,
            width_tolerance_ratio: 0.025,
            width_tolerance_pt: 2.0,
        }
    }
}

pub fn normalize_text_runs(runs: &[TextRun], base_bold: bool, base_italic: bool) -> Vec<TextRun> {
    let mut result: Vec<TextRun> = Vec::new();
    for run in runs {
        let text = normalize_unicode_for_pdf(&run.text);
        if text.is_empty() {
            continue;
        }
        let bold = run.bold.unwrap_or(base_bold);
        let italic = run.italic.unwrap_or(base_italic);
        let script = run.script.unwrap_or(TextScriptMode::Normal);

        if let Some(prev) = result.last_mut() {
            if prev.bold.unwrap_or(base_bold) == bold
                && prev.italic.unwrap_or(base_italic) == italic
                && prev.script.unwrap_or(TextScriptMode::Normal) == script
            {
                prev.text.push_str(&text);
                continue;
            }
        }
        result.push(TextRun {
            text,
            bold: Some(bold),
            italic: Some(italic),
            script: Some(script),
        });
    }
    result
}

pub fn runs_to_plain_text(runs: &[TextRun]) -> String {
    let mut out = String::new();
    for r in runs {
        out.push_str(&r.text);
    }
    out
}

pub fn ensure_runs_from_element(
    text: &str,
    runs: Option<&[TextRun]>,
    base_bold: bool,
    base_italic: bool,
) -> Vec<TextRun> {
    let normalized_text = normalize_unicode_for_pdf(text);
    if let Some(raw_runs) = runs {
        if !raw_runs.is_empty() {
            let norm = normalize_text_runs(raw_runs, base_bold, base_italic);
            if runs_to_plain_text(&norm) == normalized_text {
                return norm;
            }
        }
    }
    normalize_text_runs(
        &[TextRun {
            text: normalized_text,
            bold: Some(base_bold),
            italic: Some(base_italic),
            script: Some(TextScriptMode::Normal),
        }],
        base_bold,
        base_italic,
    )
}

#[derive(Debug, Clone)]
struct AtomicUnit {
    is_space: bool,
    pieces: Vec<RunPiece>,
}

#[derive(Debug, Clone)]
struct ParaSeg {
    text: String,
    bold: bool,
    italic: bool,
    script: TextScriptMode,
}

fn split_whitespace_segments(text: &str) -> Vec<(&str, bool)> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut current_ws: Option<bool> = None;

    for (idx, ch) in text.char_indices() {
        let is_ws = ch.is_whitespace();
        match current_ws {
            None => {
                current_ws = Some(is_ws);
                start = idx;
            }
            Some(prev_ws) if prev_ws != is_ws => {
                if idx > start {
                    parts.push((&text[start..idx], prev_ws));
                }
                start = idx;
                current_ws = Some(is_ws);
            }
            _ => {}
        }
    }
    if let Some(last_ws) = current_ws {
        if start < text.len() {
            parts.push((&text[start..], last_ws));
        }
    }
    parts
}

fn split_paragraph_runs_to_atomic_units(para_pieces: &[ParaSeg]) -> Vec<AtomicUnit> {
    let mut units = Vec::new();
    let mut active_word: Vec<RunPiece> = Vec::new();

    let flush_word = |word: &mut Vec<RunPiece>, out: &mut Vec<AtomicUnit>| {
        if !word.is_empty() {
            out.push(AtomicUnit {
                is_space: false,
                pieces: std::mem::take(word),
            });
        }
    };

    for seg in para_pieces {
        for (part, is_ws) in split_whitespace_segments(&seg.text) {
            if part.is_empty() {
                continue;
            }
            if is_ws {
                flush_word(&mut active_word, &mut units);
                units.push(AtomicUnit {
                    is_space: true,
                    pieces: vec![RunPiece {
                        text: part.to_string(),
                        bold: seg.bold,
                        italic: seg.italic,
                        script: seg.script,
                        is_space: true,
                    }],
                });
            } else {
                active_word.push(RunPiece {
                    text: part.to_string(),
                    bold: seg.bold,
                    italic: seg.italic,
                    script: seg.script,
                    is_space: false,
                });
            }
        }
    }
    flush_word(&mut active_word, &mut units);
    units
}

/// Splits normalized rich-text runs into explicit paragraphs by `\n` and wraps each paragraph
/// across `max_width`, keeping atomic word+superscript/subscript clusters unbroken.
pub fn build_wrapped_rich_lines<F>(
    runs: &[TextRun],
    max_width: f64,
    mut measure_piece: F,
    base_bold: bool,
    base_italic: bool,
    options: Option<BuildWrappedRichLinesOptions>,
) -> Vec<WrappedRichLine>
where
    F: FnMut(&str, bool, bool, TextScriptMode) -> f64,
{
    let opts = options.unwrap_or_default();
    let safe_max_width =
        (max_width * (1.0 + opts.width_tolerance_ratio) + opts.width_tolerance_pt).max(12.0);
    let norm = normalize_text_runs(runs, base_bold, base_italic);

    let mut paragraphs: Vec<Vec<ParaSeg>> = vec![Vec::new()];
    for run in &norm {
        let clean = run.text.replace("\r\n", "\n");
        let parts: Vec<&str> = clean.split('\n').collect();
        for (i, part) in parts.iter().enumerate() {
            if i > 0 {
                paragraphs.push(Vec::new());
            }
            if !part.is_empty() {
                if let Some(last_para) = paragraphs.last_mut() {
                    last_para.push(ParaSeg {
                        text: (*part).to_string(),
                        bold: run.bold.unwrap_or(base_bold),
                        italic: run.italic.unwrap_or(base_italic),
                        script: run.script.unwrap_or(TextScriptMode::Normal),
                    });
                }
            }
        }
    }

    let mut output: Vec<WrappedRichLine> = Vec::new();

    for para in paragraphs {
        if para.is_empty() {
            output.push(WrappedRichLine {
                pieces: Vec::new(),
                natural_width: 0.0,
                space_count: 0,
                ends_paragraph: true,
            });
            continue;
        }

        let units = split_paragraph_runs_to_atomic_units(&para);
        let mut line_units: Vec<AtomicUnit> = Vec::new();
        let mut line_width = 0.0;

        let flush_line = |line_units: &mut Vec<AtomicUnit>,
                          line_width: &mut f64,
                          ends_paragraph: bool,
                          out: &mut Vec<WrappedRichLine>,
                          measure: &mut F| {
            let mut start = 0;
            while start < line_units.len() && line_units[start].is_space {
                start += 1;
            }
            let mut end = line_units.len();
            while end > start && line_units[end - 1].is_space {
                end -= 1;
            }

            let mut pieces = Vec::new();
            let mut w = 0.0;
            let mut space_count = 0usize;
            for u in &line_units[start..end] {
                for p in &u.pieces {
                    w += measure(&p.text, p.bold, p.italic, p.script);
                    if p.is_space {
                        space_count += p.text.chars().count();
                    }
                    pieces.push(p.clone());
                }
            }
            out.push(WrappedRichLine {
                pieces,
                natural_width: w,
                space_count,
                ends_paragraph,
            });
            line_units.clear();
            *line_width = 0.0;
        };

        for unit in units {
            if line_units.is_empty() && unit.is_space {
                continue;
            }
            if opts.disable_soft_wrap {
                line_units.push(unit);
                continue;
            }

            let mut uw = 0.0;
            for p in &unit.pieces {
                uw += measure_piece(&p.text, p.bold, p.italic, p.script);
            }

            if unit.is_space {
                line_units.push(unit);
                line_width += uw;
                continue;
            }

            let mut trimmed_width = line_width;
            if let Some(last) = line_units.last() {
                if last.is_space {
                    let has_non_space = line_units.iter().any(|u| !u.is_space);
                    if !has_non_space {
                        trimmed_width = 0.0;
                    }
                }
            }

            if line_units.is_empty() || trimmed_width + uw <= safe_max_width + 0.01 {
                line_units.push(unit);
                line_width += uw;
            } else {
                flush_line(
                    &mut line_units,
                    &mut line_width,
                    false,
                    &mut output,
                    &mut measure_piece,
                );
                if unit.is_space {
                    continue;
                }
                if uw > safe_max_width {
                    let mut chunk_pieces: Vec<RunPiece> = Vec::new();
                    let mut chunk_width = 0.0;
                    for piece in &unit.pieces {
                        for ch in piece.text.chars() {
                            let mut buf = [0u8; 4];
                            let ch_str = ch.encode_utf8(&mut buf);
                            let cw = measure_piece(ch_str, piece.bold, piece.italic, piece.script);
                            if !chunk_pieces.is_empty() && chunk_width + cw > safe_max_width {
                                output.push(WrappedRichLine {
                                    pieces: chunk_pieces,
                                    natural_width: chunk_width,
                                    space_count: 0,
                                    ends_paragraph: false,
                                });
                                chunk_pieces = vec![RunPiece {
                                    text: ch_str.to_string(),
                                    bold: piece.bold,
                                    italic: piece.italic,
                                    script: piece.script,
                                    is_space: false,
                                }];
                                chunk_width = cw;
                            } else {
                                if let Some(last) = chunk_pieces.last_mut() {
                                    if last.bold == piece.bold
                                        && last.italic == piece.italic
                                        && last.script == piece.script
                                    {
                                        last.text.push(ch);
                                    } else {
                                        chunk_pieces.push(RunPiece {
                                            text: ch_str.to_string(),
                                            bold: piece.bold,
                                            italic: piece.italic,
                                            script: piece.script,
                                            is_space: false,
                                        });
                                    }
                                } else {
                                    chunk_pieces.push(RunPiece {
                                        text: ch_str.to_string(),
                                        bold: piece.bold,
                                        italic: piece.italic,
                                        script: piece.script,
                                        is_space: false,
                                    });
                                }
                                chunk_width += cw;
                            }
                        }
                    }
                    if !chunk_pieces.is_empty() {
                        line_units = vec![AtomicUnit {
                            is_space: false,
                            pieces: chunk_pieces,
                        }];
                        line_width = chunk_width;
                    }
                } else {
                    line_units = vec![unit];
                    line_width = uw;
                }
            }
        }

        flush_line(
            &mut line_units,
            &mut line_width,
            true,
            &mut output,
            &mut measure_piece,
        );
    }

    if output.is_empty() {
        output.push(WrappedRichLine {
            pieces: Vec::new(),
            natural_width: 0.0,
            space_count: 0,
            ends_paragraph: true,
        });
    }
    output
}
