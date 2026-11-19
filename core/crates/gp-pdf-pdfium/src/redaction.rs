use std::collections::{HashMap, HashSet};

use gp_pdf::{PdfError, RedactionRect, RedactionReport};
use gp_redact::{redact_pdf_bytes_with_lopdf, RedactionOptions};
use pdfium_render::prelude::*;

use crate::visual_rect_to_pdfium_rect;

fn rects_intersect(a_l: f64, a_b: f64, a_r: f64, a_t: f64, b: &PdfRect) -> bool {
    let eps = 0.25_f64;
    a_r > (b.left().value as f64) + eps
        && a_l < (b.right().value as f64) - eps
        && a_t > (b.bottom().value as f64) + eps
        && a_b < (b.top().value as f64) - eps
}

fn rect_fully_contained_in_tol(obj: &PdfRect, box_l: f64, box_b: f64, box_r: f64, box_t: f64, tol: f64) -> bool {
    (obj.left().value as f64) >= box_l - tol
        && (obj.right().value as f64) <= box_r + tol
        && (obj.bottom().value as f64) >= box_b - tol
        && (obj.top().value as f64) <= box_t + tol
}

fn rect_fully_contained_in(obj: &PdfRect, box_l: f64, box_b: f64, box_r: f64, box_t: f64) -> bool {
    rect_fully_contained_in_tol(obj, box_l, box_b, box_r, box_t, 1.5_f64)
}

fn image_rect_matches(obj: &PdfRect, tgt: &PdfRect) -> bool {
    let ol = obj.left().value as f64;
    let ob = obj.bottom().value as f64;
    let or = obj.right().value as f64;
    let ot = obj.top().value as f64;
    let tl = tgt.left().value as f64;
    let tb = tgt.bottom().value as f64;
    let tr = tgt.right().value as f64;
    let tt = tgt.top().value as f64;
    let tol_x = 3.5_f64.max(0.08 * (or - ol).abs().max((tr - tl).abs()));
    let tol_y = 3.5_f64.max(0.08 * (ot - ob).abs().max((tt - tb).abs()));
    (ol - tl).abs() <= tol_x
        && (or - tr).abs() <= tol_x
        && (ob - tb).abs() <= tol_y
        && (ot - tt).abs() <= tol_y
}

fn count_non_space_chars_in_bounds(text_page: Option<&PdfPageText<'_>>, bounds: &PdfRect) -> usize {
    let Some(tp) = text_page else {
        return usize::MAX;
    };
    let mut count = 0usize;
    let bl = bounds.left().value as f64 - 0.5;
    let bb = bounds.bottom().value as f64 - 0.5;
    let br = bounds.right().value as f64 + 0.5;
    let bt = bounds.top().value as f64 + 0.5;
    for ch in tp.chars().iter() {
        let Some(uc) = ch.unicode_char() else {
            continue;
        };
        if uc.is_whitespace() || uc.is_control() {
            continue;
        }
        if let Ok(cb) = ch.tight_bounds().or_else(|_| ch.loose_bounds()) {
            if rects_intersect(bl, bb, br, bt, &cb) {
                count += 1;
                if count > 4 {
                    break;
                }
            }
        }
    }
    count
}

/// Surgical PDFium fallback object removal for images and deleted/edited text runs
/// that survived `lopdf` content-stream stripping (e.g. inline/unusual operators or metric drift).
/// Untouched pages and pages with zero removals do NOT call `regenerate_content()`.
pub(crate) fn strip_leftover_objects_with_pdfium(
    pdfium: &Pdfium,
    pdf_bytes: Vec<u8>,
    password: Option<&str>,
    image_only_rects: &[RedactionRect],
    deleted_text_rects: &[RedactionRect],
) -> Result<Vec<u8>, PdfError> {
    if image_only_rects.is_empty() && deleted_text_rects.is_empty() {
        return Ok(pdf_bytes);
    }

    let mut img_by_page: HashMap<usize, Vec<&RedactionRect>> = HashMap::new();
    for r in image_only_rects {
        if r.width > 0.0 && r.height > 0.0 {
            img_by_page.entry(r.page_index).or_default().push(r);
        }
    }
    let mut txt_by_page: HashMap<usize, Vec<&RedactionRect>> = HashMap::new();
    for r in deleted_text_rects {
        if r.width > 0.0 && r.height > 0.0 {
            txt_by_page.entry(r.page_index).or_default().push(r);
        }
    }
    if img_by_page.is_empty() && txt_by_page.is_empty() {
        return Ok(pdf_bytes);
    }

    let work_doc = pdfium
        .load_pdf_from_byte_vec(pdf_bytes.clone(), password)
        .map_err(|e| PdfError::RedactionFailed(format!("failed loading PDFium fallback doc: {e}")))?;

    let total_pages = work_doc.pages().len() as usize;
    let mut page_indices: HashSet<usize> = img_by_page.keys().copied().collect();
    page_indices.extend(txt_by_page.keys().copied());

    let mut total_removed = 0usize;

    for page_index in page_indices {
        if page_index >= total_pages {
            continue;
        }
        let mut page = work_doc
            .pages()
            .get(page_index as PdfPageIndex)
            .map_err(|e| PdfError::RedactionFailed(format!("failed opening fallback page {page_index}: {e}")))?;

        let img_targets: Vec<PdfRect> = img_by_page
            .get(&page_index)
            .map(|rs| rs.iter().map(|r| visual_rect_to_pdfium_rect(&page, r)).collect())
            .unwrap_or_default();
        let txt_targets: Vec<PdfRect> = txt_by_page
            .get(&page_index)
            .map(|rs| rs.iter().map(|r| visual_rect_to_pdfium_rect(&page, r)).collect())
            .unwrap_or_default();

        let text_page = if txt_targets.is_empty() {
            None
        } else {
            page.text().ok()
        };

        let mut indices_to_remove: HashSet<usize> = HashSet::new();
        for (idx, obj) in page.objects().iter().enumerate() {
            match obj {
                PdfPageObject::Image(_) if !img_targets.is_empty() => {
                    let Ok(quad) = obj.bounds() else {
                        continue;
                    };
                    let bounds = quad.to_rect();
                    let matched = img_targets.iter().any(|tgt| {
                        let tl = tgt.left().value as f64;
                        let tb = tgt.bottom().value as f64;
                        let tr = tgt.right().value as f64;
                        let tt = tgt.top().value as f64;
                        image_rect_matches(&bounds, tgt) || rect_fully_contained_in_tol(&bounds, tl, tb, tr, tt, 2.5)
                    });
                    if matched {
                        indices_to_remove.insert(idx);
                    }
                }
                PdfPageObject::Text(_) if !txt_targets.is_empty() => {
                    let Ok(quad) = obj.bounds() else {
                        continue;
                    };
                    let bounds = quad.to_rect();
                    let ol = bounds.left().value as f64;
                    let ob = bounds.bottom().value as f64;
                    let or = bounds.right().value as f64;
                    let ot = bounds.top().value as f64;
                    let mut remove = false;
                    for tgt in &txt_targets {
                        let tl = tgt.left().value as f64;
                        let tb = tgt.bottom().value as f64;
                        let tr = tgt.right().value as f64;
                        let tt = tgt.top().value as f64;
                        if rect_fully_contained_in_tol(&bounds, tl, tb, tr, tt, 2.5) {
                            remove = true;
                            break;
                        }
                        let vert_overlap = ot.min(tt) - ob.max(tb);
                        let tgt_h = (tt - tb).abs().max(4.0);
                        if vert_overlap >= tgt_h * 0.3
                            && ol >= tl - 2.5
                            && ol <= tr + 14.0
                            && or <= tr + 16.0
                            && (or - ol) <= 24.0
                            && count_non_space_chars_in_bounds(text_page.as_ref(), &bounds) <= 4
                        {
                            remove = true;
                            break;
                        }
                    }
                    if remove {
                        indices_to_remove.insert(idx);
                    }
                }
                _ => {}
            }
        }

        if !indices_to_remove.is_empty() {
            drop(text_page);
            let mut sorted: Vec<usize> = indices_to_remove.into_iter().collect();
            sorted.sort_unstable_by(|a, b| b.cmp(a));
            let mut removed_here = 0usize;
            for idx in sorted {
                if page.objects_mut().remove_object_at_index(idx).is_ok() {
                    removed_here += 1;
                }
            }
            if removed_here > 0 {
                total_removed += removed_here;
                let _ = page.regenerate_content();
            }
        }
    }

    if total_removed == 0 {
        return Ok(pdf_bytes);
    }

    work_doc
        .save_to_bytes()
        .map_err(|e| PdfError::RedactionFailed(format!("failed serializing PDFium fallback doc: {e}")))
}

/// Counts non-whitespace glyphs whose page bounds intersect any `RedactionRect` via `FPDFText_*`.
pub fn count_remaining_chars_in_redaction_rects(
    doc: &PdfDocument<'_>,
    rects: &[RedactionRect],
) -> Result<usize, PdfError> {
    let mut by_page: HashMap<usize, Vec<&RedactionRect>> = HashMap::new();
    for r in rects {
        if r.width > 0.0 && r.height > 0.0 {
            by_page.entry(r.page_index).or_default().push(r);
        }
    }

    let mut remaining = 0usize;
    let total_pages = doc.pages().len() as usize;

    for (page_index, page_rects) in by_page {
        if page_index >= total_pages {
            return Err(PdfError::PageOutOfBounds {
                page: page_index,
                total: total_pages,
            });
        }
        let page = doc
            .pages()
            .get(page_index as PdfPageIndex)
            .map_err(|e| PdfError::RedactionFailed(format!("failed loading redacted page: {e}")))?;
        let text_page = page
            .text()
            .map_err(|e| PdfError::RedactionFailed(format!("failed opening PDFium text page: {e}")))?;

        let target_pdf_rects: Vec<PdfRect> = page_rects
            .iter()
            .map(|r| visual_rect_to_pdfium_rect(&page, r))
            .collect();

        for ch in text_page.chars().iter() {
            let Some(unicode_ch) = ch.unicode_char() else {
                continue;
            };
            if unicode_ch.is_whitespace() || unicode_ch.is_control() {
                continue;
            }
            let bounds = ch
                .tight_bounds()
                .or_else(|_| ch.loose_bounds())
                .unwrap_or(PdfRect::ZERO);
            if bounds.width().value <= 0.01 && bounds.height().value <= 0.01 {
                continue;
            }
            for target in &target_pdf_rects {
                if rects_intersect(
                    target.left().value as f64,
                    target.bottom().value as f64,
                    target.right().value as f64,
                    target.top().value as f64,
                    &bounds,
                ) {
                    remaining += 1;
                    break;
                }
            }
        }
    }

    Ok(remaining)
}

/// Runs D3 two-phase redaction (PDFium object-level removal -> `lopdf` content-stream partial rewrite fallback)
/// followed by mandatory `FPDFText_*` assertion verification on the serialized output PDF.
pub fn redact_document_verified(
    pdfium: &Pdfium,
    source_bytes: Vec<u8>,
    password: Option<&str>,
    rects: &[RedactionRect],
) -> Result<(Vec<u8>, RedactionReport), PdfError> {
    if rects.is_empty() {
        return Ok((
            source_bytes,
            RedactionReport {
                redacted_regions: 0,
                removed_objects: 0,
                remaining_matches: 0,
                verified: true,
            },
        ));
    }

    let work_doc = pdfium
        .load_pdf_from_byte_vec(source_bytes, password)
        .map_err(|e| PdfError::RedactionFailed(format!("failed loading working PDF: {e}")))?;

    let mut by_page: HashMap<usize, Vec<&RedactionRect>> = HashMap::new();
    for r in rects {
        if r.width > 0.0 && r.height > 0.0 {
            by_page.entry(r.page_index).or_default().push(r);
        }
    }

    let total_pages = work_doc.pages().len() as usize;
    let mut removed_objects = 0usize;
    let mut needs_stream_rewrite = false;

    for (&page_index, page_rects) in &by_page {
        if page_index >= total_pages {
            return Err(PdfError::PageOutOfBounds {
                page: page_index,
                total: total_pages,
            });
        }
        let mut page = work_doc
            .pages()
            .get(page_index as PdfPageIndex)
            .map_err(|e| PdfError::RedactionFailed(format!("failed loading page {page_index}: {e}")))?;

        let pdf_targets: Vec<PdfRect> = page_rects
            .iter()
            .map(|r| visual_rect_to_pdfium_rect(&page, r))
            .collect();

        // Phase 1: Collect indices of fully covered objects so we remove whole operators cleanly via PDFium.
        let mut indices_to_remove: HashSet<usize> = HashSet::new();
        for (idx, obj) in page.objects().iter().enumerate() {
            let Ok(quad) = obj.bounds() else {
                continue;
            };
            let bounds = quad.to_rect();
            for target in &pdf_targets {
                let tl = target.left().value as f64;
                let tb = target.bottom().value as f64;
                let tr = target.right().value as f64;
                let tt = target.top().value as f64;

                if rects_intersect(tl, tb, tr, tt, &bounds) {
                    if rect_fully_contained_in(&bounds, tl, tb, tr, tt) {
                        indices_to_remove.insert(idx);
                    } else {
                        // Partial overlap across a text/form object requires sub-glyph splitting in content stream.
                        needs_stream_rewrite = true;
                    }
                }
            }
        }

        if !indices_to_remove.is_empty() {
            let mut sorted_indices: Vec<usize> = indices_to_remove.into_iter().collect();
            sorted_indices.sort_unstable_by(|a, b| b.cmp(a));
            for idx in sorted_indices {
                if page.objects_mut().remove_object_at_index(idx).is_ok() {
                    removed_objects += 1;
                } else {
                    needs_stream_rewrite = true;
                }
            }
            let _ = page.regenerate_content();
        }
    }

    let mut candidate_bytes = work_doc
        .save_to_bytes()
        .map_err(|e| PdfError::RedactionFailed(format!("failed serializing PDFium document: {e}")))?;

    // Check PDFium text extraction BEFORE fallback to see if partial/nested objects kept glyphs.
    let pre_check_remaining = {
        let check_doc = pdfium
            .load_pdf_from_byte_vec(candidate_bytes.clone(), password)
            .map_err(|e| PdfError::RedactionFailed(format!("failed reloading candidate PDF: {e}")))?;
        count_remaining_chars_in_redaction_rects(&check_doc, rects)?
    };

    if needs_stream_rewrite || pre_check_remaining > 0 {
        let (rewritten, stats) = redact_pdf_bytes_with_lopdf(
            &candidate_bytes,
            rects,
            RedactionOptions {
                draw_redaction_boxes: false,
                shape_rects: Vec::new(),
                ..RedactionOptions::default()
            },
        )?;
        candidate_bytes = rewritten;
        removed_objects += stats.removed_text_runs;
    }

    // Mandatory post-redaction FPDFText_* verification gate (01 §5.5 #4)
    let verify_doc = pdfium
        .load_pdf_from_byte_vec(candidate_bytes.clone(), password)
        .map_err(|e| PdfError::RedactionFailed(format!("failed loading redacted PDF for verification: {e}")))?;
    let remaining_matches = count_remaining_chars_in_redaction_rects(&verify_doc, rects)?;
    if remaining_matches > 0 {
        return Err(PdfError::RedactionFailed(format!(
            "verification failed: {remaining_matches} character(s) remain inside redacted region(s)"
        )));
    }

    Ok((
        candidate_bytes,
        RedactionReport {
            redacted_regions: rects.len(),
            removed_objects,
            remaining_matches: 0,
            verified: true,
        },
    ))
}
