use std::collections::BTreeMap;

use gp_model::{RectBox, RotationAngle};
use gp_pdf::{
    ExtractedFontBinaryAsset, ExtractedFontEntry, ExtractedFontVariantInfo, ExtractedFontsBundle,
    PdfError, PdfInspectionPage, PdfInspectionResult, PdfOpenStatus, RedactionRect,
};
use gp_text::{
    inspect_ttf_font, normalize_font_match_key, parse_pdf_font_metadata, sanitize_for_winansi,
    FontStyleVariant,
};
use lopdf::{
    content::{Content, Operation},
    dictionary, Document, Object, Stream,
};

use crate::content_redact::{
    read_rect_box, real_op, redact_pdf_bytes_with_lopdf, RedactionOptions,
};

fn normalize_angle(deg: i64) -> RotationAngle {
    match ((deg % 360) + 360) % 360 {
        90 => 90,
        180 => 180,
        270 => 270,
        _ => 0,
    }
}

/// Inspects raw PDF bytes via `lopdf` without instantiating MuPDF or pdf.js.
pub fn inspect_pdf_with_lopdf(
    bytes: &[u8],
    password: Option<&str>,
) -> Result<PdfInspectionResult, PdfError> {
    let mut doc = match Document::load_mem(bytes) {
        Ok(d) => d,
        Err(err) => {
            let msg = format!("{err:?}");
            if msg.contains("Encrypt") || msg.contains("Password") || msg.contains("decrypt") {
                return Ok(PdfInspectionResult {
                    status: if password.is_some() {
                        PdfOpenStatus::InvalidPassword
                    } else {
                        PdfOpenStatus::NeedsPassword
                    },
                    was_encrypted: true,
                    page_count: 0,
                    pages: Vec::new(),
                });
            }
            return Err(PdfError::Backend(format!("failed loading PDF: {err}")));
        }
    };

    let was_encrypted = doc.is_encrypted();
    if was_encrypted {
        let pw = password.unwrap_or("");
        if doc.decrypt(pw).is_err() {
            return Ok(PdfInspectionResult {
                status: if password.is_some() {
                    PdfOpenStatus::InvalidPassword
                } else {
                    PdfOpenStatus::NeedsPassword
                },
                was_encrypted: true,
                page_count: 0,
                pages: Vec::new(),
            });
        }
    }

    let pages_map = doc.get_pages();
    let mut pages = Vec::with_capacity(pages_map.len());
    for (idx, (_num, page_id)) in pages_map.into_iter().enumerate() {
        let dict = doc.get_dictionary(page_id).cloned().unwrap_or_default();
        let media_box = read_rect_box(&doc, &dict, b"MediaBox").unwrap_or([0.0, 0.0, 595.0, 842.0]);
        let crop_box = read_rect_box(&doc, &dict, b"CropBox").unwrap_or(media_box);
        let rot = normalize_angle(dict.get(b"Rotate").and_then(Object::as_i64).unwrap_or(0));

        let raw_w = (crop_box[2] - crop_box[0]).abs().max(1.0);
        let raw_h = (crop_box[3] - crop_box[1]).abs().max(1.0);
        let (base_width, base_height) = if rot == 90 || rot == 270 {
            (raw_h, raw_w)
        } else {
            (raw_w, raw_h)
        };

        pages.push(PdfInspectionPage {
            source_page_index: idx,
            base_width,
            base_height,
            intrinsic_rotation: rot,
            media_box,
            crop_box,
        });
    }

    Ok(PdfInspectionResult {
        status: PdfOpenStatus::Ok,
        was_encrypted,
        page_count: pages.len(),
        pages,
    })
}

/// Creates a blank multi-page PDF document purely in Rust.
pub fn create_blank_pdf_with_lopdf(
    width: f64,
    height: f64,
    page_count: usize,
) -> Result<Vec<u8>, PdfError> {
    let w = width.max(72.0);
    let h = height.max(72.0);
    let count = page_count.clamp(1, 500);

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::with_capacity(count);

    for _ in 0..count {
        let content_id = doc.add_object(Stream::new(dictionary! {}, Vec::new()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![real_op(0.0), real_op(0.0), real_op(w), real_op(h)],
            "Contents" => content_id,
        });
        kids.push(page_id.into());
    }

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => count as i64,
        }),
    );
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| PdfError::Backend(format!("failed saving blank PDF: {e}")))?;
    Ok(out)
}

fn push_rect_fill(ops: &mut Vec<Operation>, x: f64, y: f64, w: f64, h: f64, r: f64, g: f64, b: f64) {
    ops.push(Operation::new("q", vec![]));
    ops.push(Operation::new("rg", vec![real_op(r), real_op(g), real_op(b)]));
    ops.push(Operation::new(
        "re",
        vec![real_op(x), real_op(y), real_op(w), real_op(h)],
    ));
    ops.push(Operation::new("f", vec![]));
    ops.push(Operation::new("Q", vec![]));
}

fn push_rect_outline(
    ops: &mut Vec<Operation>,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    fill: (f64, f64, f64),
    stroke: (f64, f64, f64),
    lw: f64,
) {
    ops.push(Operation::new("q", vec![]));
    ops.push(Operation::new("w", vec![real_op(lw)]));
    ops.push(Operation::new(
        "rg",
        vec![real_op(fill.0), real_op(fill.1), real_op(fill.2)],
    ));
    ops.push(Operation::new(
        "RG",
        vec![real_op(stroke.0), real_op(stroke.1), real_op(stroke.2)],
    ));
    ops.push(Operation::new(
        "re",
        vec![real_op(x), real_op(y), real_op(w), real_op(h)],
    ));
    ops.push(Operation::new("B", vec![]));
    ops.push(Operation::new("Q", vec![]));
}

fn push_text(
    ops: &mut Vec<Operation>,
    font_key: &str,
    size: f64,
    x: f64,
    y: f64,
    r: f64,
    g: f64,
    b: f64,
    text: &str,
) {
    let safe = sanitize_for_winansi(text);
    ops.push(Operation::new("BT", vec![]));
    ops.push(Operation::new("rg", vec![real_op(r), real_op(g), real_op(b)]));
    ops.push(Operation::new("Tf", vec![font_key.into(), real_op(size)]));
    ops.push(Operation::new(
        "Tm",
        vec![
            real_op(1.0),
            real_op(0.0),
            real_op(0.0),
            real_op(1.0),
            real_op(x),
            real_op(y),
        ],
    ));
    ops.push(Operation::new(
        "Tj",
        vec![Object::string_literal(safe.as_bytes())],
    ));
    ops.push(Operation::new("ET", vec![]));
}

/// Creates the 3-page interactive sample PDF cleanly via `lopdf` (zero `pdf-lib` dependency).
pub fn create_sample_pdf_with_lopdf(
    banner_rgb: &[u8],
    img_w: u32,
    img_h: u32,
) -> Result<Vec<u8>, PdfError> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let f_reg = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let f_bold = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica-Bold",
        "Encoding" => "WinAnsiEncoding",
    });
    let f_times = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Times-Italic",
        "Encoding" => "WinAnsiEncoding",
    });
    let f_mono = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Courier",
        "Encoding" => "WinAnsiEncoding",
    });

    let (w, h, rgb_data) = if img_w > 0 && img_h > 0 && banner_rgb.len() >= (img_w * img_h * 3) as usize {
        (img_w, img_h, banner_rgb[..(img_w * img_h * 3) as usize].to_vec())
    } else {
        // Generate deterministic 120x70 gradient RGB bitmap cleanly
        let gw = 120u32;
        let gh = 70u32;
        let mut buf = Vec::with_capacity((gw * gh * 3) as usize);
        for row in 0..gh {
            for col in 0..gw {
                let t = col as f64 / gw as f64;
                let s = row as f64 / gh as f64;
                buf.push(((1.0 - t) * 29.0 + t * 16.0) as u8);
                buf.push(((1.0 - t) * 78.0 + t * 185.0) as u8);
                buf.push(((1.0 - s) * 216.0 + s * 129.0) as u8);
            }
        }
        (gw, gh, buf)
    };

    let mut img_stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => w as i64,
            "Height" => h as i64,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
        },
        rgb_data,
    );
    let _ = img_stream.compress();
    let img_id = doc.add_object(img_stream);

    let resources_id = doc.add_object(dictionary! {
        "Font" => dictionary! {
            "F1" => f_reg,
            "F2" => f_bold,
            "F3" => f_times,
            "F4" => f_mono,
        },
        "XObject" => dictionary! {
            "Im1" => img_id,
        },
    });

    // Page 1
    let mut ops1 = Vec::new();
    push_rect_fill(&mut ops1, 48.0, 700.0, 516.0, 54.0, 0.08, 0.14, 0.28);
    push_text(&mut ops1, "F2", 20.0, 64.0, 722.0, 1.0, 1.0, 1.0, "Q4 Product Architecture Brief");
    push_text(
        &mut ops1,
        "F1",
        12.0,
        48.0,
        660.0,
        0.2,
        0.25,
        0.35,
        "Click any text block to edit in-place or drag the embedded graphic below.",
    );
    push_text(
        &mut ops1,
        "F2",
        15.0,
        48.0,
        615.0,
        0.07,
        0.24,
        0.56,
        "Client-Side Wasm Pipeline Summary",
    );
    push_text(
        &mut ops1,
        "F1",
        11.0,
        48.0,
        590.0,
        0.15,
        0.18,
        0.25,
        "All PDF rendering, operator extraction, and content-stream rewriting run inside Web Workers.",
    );
    // Embedded raster image at (48, 410) size (240, 140)
    ops1.push(Operation::new("q", vec![]));
    ops1.push(Operation::new(
        "cm",
        vec![
            real_op(240.0),
            real_op(0.0),
            real_op(0.0),
            real_op(140.0),
            real_op(48.0),
            real_op(410.0),
        ],
    ));
    ops1.push(Operation::new("Do", vec!["Im1".into()]));
    ops1.push(Operation::new("Q", vec![]));

    push_text(
        &mut ops1,
        "F4",
        11.0,
        315.0,
        525.0,
        0.12,
        0.35,
        0.22,
        "Document Reference: GULLAC-2026-04",
    );
    push_text(
        &mut ops1,
        "F3",
        11.0,
        315.0,
        500.0,
        0.3,
        0.3,
        0.35,
        "Prepared for internal review & digital signature.",
    );
    push_rect_outline(
        &mut ops1,
        48.0,
        120.0,
        260.0,
        90.0,
        (0.97, 0.98, 1.0),
        (0.65, 0.72, 0.82),
        1.0,
    );
    push_text(
        &mut ops1,
        "F2",
        10.0,
        60.0,
        190.0,
        0.35,
        0.42,
        0.55,
        "Authorized Signature Area",
    );

    let c1_id = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops1 }.encode().unwrap()));
    let p1_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Resources" => resources_id,
        "Contents" => c1_id,
    });

    // Page 2 (landscape 792x612)
    let mut ops2 = Vec::new();
    push_text(
        &mut ops2,
        "F2",
        18.0,
        48.0,
        550.0,
        0.1,
        0.15,
        0.25,
        "Page 2 - Performance & Privacy Verification",
    );
    push_text(
        &mut ops2,
        "F1",
        12.0,
        48.0,
        515.0,
        0.25,
        0.3,
        0.4,
        "Try rotating, reordering, duplicating, or splitting this page using the left sidebar.",
    );
    let c2_id = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops2 }.encode().unwrap()));
    let p2_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 792.into(), 612.into()],
        "Resources" => resources_id,
        "Contents" => c2_id,
    });

    // Page 3 (sign-off 612x792)
    let mut ops3 = Vec::new();
    push_text(
        &mut ops3,
        "F2",
        18.0,
        48.0,
        720.0,
        0.1,
        0.15,
        0.25,
        "Page 3 - Appendix & Export Check",
    );
    push_text(
        &mut ops3,
        "F1",
        11.0,
        48.0,
        685.0,
        0.2,
        0.25,
        0.35,
        "Original text edits remove the underlying PDF text operator rather than painting over it.",
    );
    let c3_id = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops3 }.encode().unwrap()));
    let p3_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Resources" => resources_id,
        "Contents" => c3_id,
    });

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![p1_id.into(), p2_id.into(), p3_id.into()],
            "Count" => 3,
        }),
    );
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);
    doc.compress();

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| PdfError::Backend(format!("failed saving sample PDF: {e}")))?;
    Ok(out)
}

/// Generates any of the 5 F0.1 reference PDF profiles (`form-1p`, `text-120p`, `scanned-300p`,
/// `vector-dense`, `rtl-cjk`) purely in Rust.
pub fn create_reference_pdf_with_lopdf(
    kind: &str,
    page_count_override: Option<usize>,
    vector_segments_override: Option<usize>,
) -> Result<Vec<u8>, PdfError> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let f_reg = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let f_bold = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica-Bold",
        "Encoding" => "WinAnsiEncoding",
    });
    let f_times = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Times-Roman",
        "Encoding" => "WinAnsiEncoding",
    });

    let img_stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => 2,
            "Height" => 2,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
        },
        vec![29, 78, 216, 14, 165, 233, 16, 185, 129, 30, 41, 59],
    );
    let img_id = doc.add_object(img_stream);

    let resources_id = doc.add_object(dictionary! {
        "Font" => dictionary! {
            "F1" => f_reg,
            "F2" => f_bold,
            "F3" => f_times,
        },
        "XObject" => dictionary! {
            "Im1" => img_id,
        },
    });

    let mut kids = Vec::new();
    match kind {
        "form-1p" => {
            let mut ops = Vec::new();
            push_rect_fill(&mut ops, 42.0, 740.0, 511.0, 52.0, 0.11, 0.22, 0.44);
            push_text(
                &mut ops,
                "F2",
                16.0,
                56.0,
                760.0,
                1.0,
                1.0,
                1.0,
                "gullacpdf Enterprise Form - Reference 1P",
            );
            ops.push(Operation::new("q", vec![]));
            ops.push(Operation::new(
                "cm",
                vec![
                    real_op(96.0),
                    real_op(0.0),
                    real_op(0.0),
                    real_op(96.0),
                    real_op(450.0),
                    real_op(620.0),
                ],
            ));
            ops.push(Operation::new("Do", vec!["Im1".into()]));
            ops.push(Operation::new("Q", vec![]));

            for row in 0..=5 {
                let y = 660.0 - row as f64 * 36.0;
                ops.push(Operation::new("w", vec![real_op(1.0)]));
                ops.push(Operation::new("m", vec![real_op(42.0), real_op(y)]));
                ops.push(Operation::new("l", vec![real_op(430.0), real_op(y)]));
                ops.push(Operation::new("S", vec![]));
            }
            for x in [42.0, 210.0, 430.0] {
                ops.push(Operation::new("m", vec![real_op(x), real_op(480.0)]));
                ops.push(Operation::new("l", vec![real_op(x), real_op(660.0)]));
                ops.push(Operation::new("S", vec![]));
            }
            let rows = [
                ("Field Name", "Sample Value"),
                ("Applicant ID", "GP-2026-0041"),
                ("Department", "Core Architecture"),
                ("Status", "Verified Baseline"),
                ("Confidential Tag", "SECRET-TOKEN-ALPHA"),
            ];
            for (idx, (k, v)) in rows.iter().enumerate() {
                let y = 636.0 - idx as f64 * 36.0;
                push_text(&mut ops, "F2", 11.0, 50.0, y, 0.1, 0.12, 0.18, k);
                push_text(&mut ops, "F1", 11.0, 220.0, y, 0.15, 0.2, 0.28, v);
            }
            let cid = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
            let pid = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Resources" => resources_id,
                "Contents" => cid,
            });
            kids.push(pid.into());
        }
        "scanned-300p" => {
            let count = page_count_override.unwrap_or(300).max(1);
            for p in 0..count {
                let mut ops = Vec::new();
                ops.push(Operation::new("q", vec![]));
                ops.push(Operation::new(
                    "cm",
                    vec![
                        real_op(515.0),
                        real_op(0.0),
                        real_op(0.0),
                        real_op(700.0),
                        real_op(40.0),
                        real_op(70.0),
                    ],
                ));
                ops.push(Operation::new("Do", vec!["Im1".into()]));
                ops.push(Operation::new("Q", vec![]));
                push_text(
                    &mut ops,
                    "F1",
                    9.0,
                    48.0,
                    36.0,
                    0.4,
                    0.4,
                    0.45,
                    &format!("Scanned Page {} / {count}", p + 1),
                );
                let cid = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
                let pid = doc.add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                    "Resources" => resources_id,
                    "Contents" => cid,
                });
                kids.push(pid.into());
            }
        }
        "vector-dense" => {
            let segs = vector_segments_override.unwrap_or(500).max(10);
            let mut ops = Vec::new();
            push_text(
                &mut ops,
                "F2",
                14.0,
                40.0,
                800.0,
                0.1,
                0.15,
                0.25,
                "CAD / Diagram Vector-Dense Benchmark",
            );
            for i in 0..segs {
                let t = i as f64 / segs as f64;
                let x1 = 40.0 + ((i * 37) % 510) as f64;
                let y1 = 60.0 + ((i * 53) % 700) as f64;
                let x2 = 40.0 + (((i + 19) * 41) % 510) as f64;
                let y2 = 60.0 + (((i + 23) * 61) % 700) as f64;
                ops.push(Operation::new(
                    "RG",
                    vec![real_op(t), real_op(0.35), real_op(1.0 - t)],
                ));
                ops.push(Operation::new("w", vec![real_op(0.6)]));
                ops.push(Operation::new("m", vec![real_op(x1), real_op(y1)]));
                ops.push(Operation::new("l", vec![real_op(x2), real_op(y2)]));
                ops.push(Operation::new("S", vec![]));
            }
            let cid = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
            let pid = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Resources" => resources_id,
                "Contents" => cid,
            });
            kids.push(pid.into());
        }
        "rtl-cjk" => {
            let mut ops = Vec::new();
            push_text(
                &mut ops,
                "F2",
                14.0,
                48.0,
                770.0,
                0.1,
                0.15,
                0.25,
                "gullacpdf Encoding & Directionality Reference",
            );
            push_text(
                &mut ops,
                "F1",
                12.0,
                48.0,
                730.0,
                0.15,
                0.18,
                0.22,
                "Turkish folded fallback tokens: Istanbul - Cagri - Seker - Ozge",
            );
            push_text(
                &mut ops,
                "F3",
                12.0,
                48.0,
                700.0,
                0.2,
                0.2,
                0.25,
                "Bidi markers: [LTR prefix] - [12345-67890] - [Mixed token ABC123]",
            );
            let cid = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
            let pid = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Resources" => resources_id,
                "Contents" => cid,
            });
            kids.push(pid.into());
        }
        _ => {
            // text-120p default
            let count = page_count_override.unwrap_or(120).max(1);
            for p in 0..count {
                let mut ops = Vec::new();
                push_text(
                    &mut ops,
                    "F2",
                    13.0,
                    50.0,
                    790.0,
                    0.08,
                    0.15,
                    0.35,
                    &format!("Chapter {} - Enterprise PDF Rendering Benchmark", p + 1),
                );
                for line in 0..22 {
                    let y = 755.0 - line as f64 * 28.0;
                    push_text(
                        &mut ops,
                        if line % 2 == 0 { "F1" } else { "F3" },
                        10.5,
                        50.0,
                        y,
                        0.15,
                        0.18,
                        0.24,
                        &format!(
                            "Page {} Paragraph {}: High-throughput client-side rendering with bounded tile LRU.",
                            p + 1,
                            line + 1
                        ),
                    );
                }
                let cid = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
                let pid = doc.add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                    "Resources" => resources_id,
                    "Contents" => cid,
                });
                kids.push(pid.into());
            }
        }
    }

    let total_count = kids.len() as i64;
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => total_count,
        }),
    );
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);
    doc.compress();

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| PdfError::Backend(format!("failed saving reference PDF: {e}")))?;
    Ok(out)
}

#[derive(Default)]
struct FamilyBucket {
    clean_name: String,
    base_key: String,
    fallback_family: String,
    regular: Option<Vec<u8>>,
    bold: Option<Vec<u8>>,
    italic: Option<Vec<u8>>,
    bold_italic: Option<Vec<u8>>,
    codepoints: std::collections::BTreeSet<u32>,
}

/// Extracts embedded `/FontFile2` TrueType streams from a PDF using `lopdf` and `ttf-parser`.
pub fn extract_embedded_fonts_with_lopdf(
    source_doc_id: &str,
    bytes: &[u8],
) -> Result<ExtractedFontsBundle, PdfError> {
    let mut doc = Document::load_mem(bytes)
        .map_err(|e| PdfError::Backend(format!("failed parsing PDF for embedded fonts: {e}")))?;
    if doc.is_encrypted() {
        let _ = doc.decrypt("");
    }

    let mut visited_streams = std::collections::HashSet::new();
    let mut buckets: BTreeMap<String, FamilyBucket> = BTreeMap::new();

    for (_id, obj) in doc.objects.iter() {
        let Ok(dict) = obj.as_dict() else {
            continue;
        };
        let is_font = dict
            .get(b"Type")
            .and_then(Object::as_name)
            .map(|n| n == b"Font")
            .unwrap_or(false);
        if !is_font {
            continue;
        }

        let base_font = dict
            .get(b"BaseFont")
            .and_then(Object::as_name)
            .map(|n| String::from_utf8_lossy(n).to_string())
            .unwrap_or_default();

        // Check direct FontDescriptor OR DescendantFonts[0]/FontDescriptor
        let mut descriptor_ref = dict.get(b"FontDescriptor").ok();
        if descriptor_ref.is_none() {
            if let Ok((_, Object::Array(desc_arr))) =
                dict.get(b"DescendantFonts").and_then(|o| doc.dereference(o))
            {
                if let Some(first_desc) = desc_arr.first() {
                    if let Ok((_, Object::Dictionary(dd))) = doc.dereference(first_desc) {
                        descriptor_ref = dd.get(b"FontDescriptor").ok();
                    }
                }
            }
        }
        let Some(desc_obj) = descriptor_ref else {
            continue;
        };
        let Ok((_, Object::Dictionary(desc_dict))) = doc.dereference(desc_obj) else {
            continue;
        };
        let Ok(ff2_ref) = desc_dict.get(b"FontFile2") else {
            continue;
        };
        if let Object::Reference(sid) = ff2_ref {
            if !visited_streams.insert(*sid) {
                continue;
            }
        }
        let Ok((_, Object::Stream(font_stream))) = doc.dereference(ff2_ref) else {
            continue;
        };
        let Ok(ttf_bytes) = font_stream.decompressed_content() else {
            continue;
        };
        if ttf_bytes.len() < 128 {
            continue;
        }

        let Ok(ttf_meta) = inspect_ttf_font(&ttf_bytes) else {
            continue;
        };

        let effective_name = if !base_font.is_empty() {
            base_font.clone()
        } else {
            ttf_meta.full_name.clone()
        };
        let norm = normalize_font_match_key(&effective_name);
        let parsed = parse_pdf_font_metadata(&effective_name, false, false, norm.bold, norm.italic);
        let key = if norm.base_key.is_empty() {
            norm.clean_name.to_lowercase()
        } else {
            norm.base_key.clone()
        };

        let bucket = buckets.entry(key.clone()).or_insert_with(|| FamilyBucket {
            clean_name: parsed.clean_font_name.clone(),
            base_key: key.clone(),
            fallback_family: parsed.font_family.clone(),
            ..FamilyBucket::default()
        });

        for cp in ttf_meta.supported_code_points {
            bucket.codepoints.insert(cp);
        }
        match norm.variant {
            FontStyleVariant::Regular if bucket.regular.is_none() => {
                bucket.regular = Some(ttf_bytes)
            }
            FontStyleVariant::Bold if bucket.bold.is_none() => bucket.bold = Some(ttf_bytes),
            FontStyleVariant::Italic if bucket.italic.is_none() => bucket.italic = Some(ttf_bytes),
            FontStyleVariant::BoldItalic if bucket.bold_italic.is_none() => {
                bucket.bold_italic = Some(ttf_bytes)
            }
            _ => {
                if bucket.regular.is_none() {
                    bucket.regular = Some(ttf_bytes);
                }
            }
        }
    }

    let mut fonts = Vec::new();
    let mut assets = Vec::new();

    for (idx, (_key, bucket)) in buckets.into_iter().enumerate() {
        let supported: Vec<u32> = bucket.codepoints.into_iter().collect();
        let has_latin_letters = (b'A'..=b'z').any(|c| supported.contains(&(c as u32)));
        let unicode_usable = has_latin_letters && supported.len() >= 20;
        let id = format!("embedded:{source_doc_id}:{idx}:{}", bucket.base_key);

        fonts.push(ExtractedFontEntry {
            id: id.clone(),
            source_doc_id: source_doc_id.to_string(),
            clean_name: bucket.clean_name.clone(),
            display_name: bucket.clean_name.clone(),
            base_key: bucket.base_key.clone(),
            css_family: format!("gp-emb-{idx}-{}", bucket.base_key),
            fallback_family: bucket.fallback_family,
            variants: ExtractedFontVariantInfo {
                regular: bucket.regular.is_some(),
                bold: bucket.bold.is_some(),
                italic: bucket.italic.is_some(),
                bold_italic: bucket.bold_italic.is_some(),
            },
            supported_code_points: supported,
            unicode_usable,
        });
        assets.push(ExtractedFontBinaryAsset {
            family: id,
            regular: bucket.regular,
            bold: bucket.bold,
            italic: bucket.italic,
            bold_italic: bucket.bold_italic,
        });
    }

    Ok(ExtractedFontsBundle { fonts, assets })
}

/// Redacts specified text, image, and vector shape rectangles on a single page and extracts
/// ONLY that single page cleanly for live Editor preview without MuPDF.
pub fn prepare_clean_page_preview_with_lopdf(
    pdf_bytes: &[u8],
    source_page_index: usize,
    text_rects: &[RectBox],
    image_rects: &[RectBox],
    shape_rects: &[RectBox],
) -> Result<Vec<u8>, PdfError> {
    let to_redact_rect = |r: &RectBox| RedactionRect {
        page_index: source_page_index,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
    };

    let (redacted_full, _) = redact_pdf_bytes_with_lopdf(
        pdf_bytes,
        &[],
        RedactionOptions {
            draw_redaction_boxes: false,
            text_only_rects: text_rects.iter().map(to_redact_rect).collect(),
            image_only_rects: image_rects.iter().map(to_redact_rect).collect(),
            shape_rects: shape_rects.iter().map(to_redact_rect).collect(),
        },
    )?;

    let mut single_doc = Document::load_mem(&redacted_full)
        .map_err(|e| PdfError::Backend(format!("failed loading redacted clean preview: {e}")))?;
    let pages = single_doc.get_pages();
    let target_page_num = (source_page_index + 1) as u32;
    let to_delete: Vec<u32> = pages
        .keys()
        .copied()
        .filter(|&num| num != target_page_num)
        .collect();
    if !to_delete.is_empty() {
        single_doc.delete_pages(&to_delete);
        single_doc.prune_objects();
    }

    let mut out = Vec::new();
    single_doc
        .save_to(&mut out)
        .map_err(|e| PdfError::Backend(format!("failed serializing clean page preview: {e}")))?;
    Ok(out)
}
