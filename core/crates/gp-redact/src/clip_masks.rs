use std::collections::HashMap;

use gp_pdf::PdfError;
use lopdf::{
    content::{Content, Operation},
    Document,
};
use serde::{Deserialize, Serialize};

use crate::content_redact::real_op;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum ClipPathCmd {
    MoveTo { x: f64, y: f64 },
    LineTo { x: f64, y: f64 },
    CurveTo {
        cx1: f64,
        cy1: f64,
        cx2: f64,
        cy2: f64,
        x: f64,
        y: f64,
    },
    Close,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipMaskPatch {
    pub page_index: usize,
    pub mark_name: String,
    #[serde(default)]
    pub even_odd: bool,
    pub commands: Vec<ClipPathCmd>,
}

/// Inserts vector `W n` / `W* n` PDF clipping paths around Marked Content (`BMC`..`EMC`)
/// regions created cleanly by PDFium (`FPDFPageObj_AddMark`).
pub fn apply_clip_masks_with_lopdf(
    pdf_bytes: &[u8],
    patches: &[ClipMaskPatch],
) -> Result<Vec<u8>, PdfError> {
    if patches.is_empty() {
        return Ok(pdf_bytes.to_vec());
    }

    let mut by_page: HashMap<usize, HashMap<Vec<u8>, &ClipMaskPatch>> = HashMap::new();
    for p in patches {
        if !p.commands.is_empty() {
            by_page
                .entry(p.page_index)
                .or_default()
                .insert(p.mark_name.as_bytes().to_vec(), p);
        }
    }

    let mut doc = Document::load_mem(pdf_bytes)
        .map_err(|e| PdfError::Backend(format!("failed loading PDF for clip masks: {e}")))?;

    for (page_num, page_id) in doc.get_pages() {
        let page_index = page_num as usize - 1;
        let Some(page_marks) = by_page.get(&page_index) else {
            continue;
        };

        let content_bytes = doc.get_page_content(page_id);
        if content_bytes.is_empty() {
            continue;
        }
        let Ok(decoded) = Content::decode(&content_bytes) else {
            continue;
        };

        let mut out_ops: Vec<Operation> = Vec::with_capacity(decoded.operations.len() + page_marks.len() * 12);
        let mut active_depth = 0usize;
        let mut modified = false;

        for op in &decoded.operations {
            match op.operator.as_str() {
                "BMC" | "BDC" => {
                    let tag = op
                        .operands
                        .first()
                        .and_then(|o| o.as_name().ok())
                        .map(|n| n.to_vec());
                    if let Some(tag_bytes) = tag {
                        if active_depth == 0 {
                            if let Some(patch) = page_marks.get(&tag_bytes) {
                                modified = true;
                                active_depth = 1;
                                out_ops.push(Operation::new("q", vec![]));
                                for cmd in &patch.commands {
                                    match cmd {
                                        ClipPathCmd::MoveTo { x, y } => {
                                            out_ops.push(Operation::new("m", vec![real_op(*x), real_op(*y)]));
                                        }
                                        ClipPathCmd::LineTo { x, y } => {
                                            out_ops.push(Operation::new("l", vec![real_op(*x), real_op(*y)]));
                                        }
                                        ClipPathCmd::CurveTo {
                                            cx1,
                                            cy1,
                                            cx2,
                                            cy2,
                                            x,
                                            y,
                                        } => {
                                            out_ops.push(Operation::new(
                                                "c",
                                                vec![
                                                    real_op(*cx1),
                                                    real_op(*cy1),
                                                    real_op(*cx2),
                                                    real_op(*cy2),
                                                    real_op(*x),
                                                    real_op(*y),
                                                ],
                                            ));
                                        }
                                        ClipPathCmd::Close => {
                                            out_ops.push(Operation::new("h", vec![]));
                                        }
                                    }
                                }
                                out_ops.push(Operation::new(
                                    if patch.even_odd { "W*" } else { "W" },
                                    vec![],
                                ));
                                out_ops.push(Operation::new("n", vec![]));
                                continue;
                            }
                        } else {
                            active_depth += 1;
                        }
                    } else if active_depth > 0 {
                        active_depth += 1;
                    }
                    out_ops.push(op.clone());
                }
                "EMC" if active_depth > 0 => {
                    active_depth -= 1;
                    if active_depth == 0 {
                        out_ops.push(Operation::new("Q", vec![]));
                    } else {
                        out_ops.push(op.clone());
                    }
                }
                _ => out_ops.push(op.clone()),
            }
        }

        if modified {
            if let Ok(encoded) = (Content { operations: out_ops }).encode() {
                let _ = doc.change_page_content(page_id, encoded);
            }
        }
    }

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| PdfError::Backend(format!("failed saving clipped PDF: {e}")))?;
    Ok(out)
}
