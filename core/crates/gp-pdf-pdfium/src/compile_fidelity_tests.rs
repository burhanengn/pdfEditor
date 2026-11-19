//! Regression tests guarding original content-stream fidelity during native compile.
//!
//! PDFium's content generator drops text-state operators such as `Tw` (word spacing) when it
//! regenerates a page's original stream, which collapses justified paragraphs on export/print.
//! Compiling overlays must therefore leave the original page content untouched.

use std::collections::HashMap;

use gp_model::{CanvasElement, PageMeta};
use gp_pdf::PdfBackend;
use lopdf::{content::Content, content::Operation, dictionary, Document, Object, Stream};

use crate::compile::CompilePdfOptions;
use crate::PdfiumBackend;

fn justified_sample_pdf() -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let resources_id = doc.add_object(dictionary! {
        "Font" => dictionary! { "F1" => font_id },
    });
    let ops = vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec!["F1".into(), 12.into()]),
        Operation::new("Tw", vec![Object::Real(4.25)]),
        Operation::new("Td", vec![72.into(), 700.into()]),
        Operation::new("Tj", vec![Object::string_literal("Justified words keep spacing")]),
        Operation::new("ET", vec![]),
    ];
    let content_id = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        "Resources" => resources_id,
        "Contents" => content_id,
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn page_content_bytes(pdf: &[u8]) -> Vec<u8> {
    let doc = Document::load_mem(pdf).unwrap();
    let page_id = *doc.get_pages().get(&1).unwrap();
    doc.get_page_content(page_id)
}

fn shape_element(id: &str, behind: bool) -> CanvasElement {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "pageId": "p0",
        "kind": "shape",
        "shapeType": "rect",
        "x": 60.0, "y": 60.0, "width": 120.0, "height": 80.0,
        "rotation": 0.0, "opacity": 1.0,
        "zIndex": if behind { 1 } else { 8 },
        "strokeColor": "#2563eb", "strokeWidth": 2.0, "fillColor": "#fde68a",
        "behindContent": behind,
        "layerTier": if behind { 1 } else { 3 },
    }))
    .expect("valid shape element json")
}

fn compile_with(elements: &[CanvasElement]) -> Vec<u8> {
    let mut backend = PdfiumBackend::new_for_test().expect("prebuilt PDFium required");
    let src = justified_sample_pdf();
    backend.open_document("fid", &src, None).unwrap();
    let pages = vec![PageMeta {
        id: "p0".into(),
        source_doc_id: "fid".into(),
        source_page_index: 0,
        base_width: 595.0,
        base_height: 842.0,
        intrinsic_rotation: 0,
        user_rotation: 0,
        media_box: [0.0, 0.0, 595.0, 842.0],
        crop_box: [0.0, 0.0, 595.0, 842.0],
    }];
    let imgs = HashMap::new();
    backend
        .compile_native_pdf_with_options(
            &pages,
            elements,
            &[],
            CompilePdfOptions {
                embedded_images: Some(&imgs),
                ..Default::default()
            },
        )
        .expect("compile ok")
}

#[test]
fn foreground_overlay_keeps_original_word_spacing() {
    let out = compile_with(&[shape_element("fg", false)]);
    let content = page_content_bytes(&out);
    let text = String::from_utf8_lossy(&content);
    assert!(text.contains("Tw"), "original Tw operator lost after foreground overlay: {text}");
}

#[test]
fn behind_overlay_keeps_original_word_spacing_and_stays_behind() {
    let out = compile_with(&[shape_element("bg", true)]);
    let content = page_content_bytes(&out);
    let text = String::from_utf8_lossy(&content);
    assert!(text.contains("Tw"), "original Tw operator lost after behind overlay: {text}");
    // #fde68a fill colour of the behind rectangle as emitted by PDFium.
    let fill_pos = text.find(".99215686").expect("behind rect path emitted");
    let text_pos = text.find("Tj").or_else(|| text.find("TJ")).expect("original text kept");
    assert!(fill_pos < text_pos, "behind overlay must be painted before original text: {text}");
}

#[test]
fn unused_fonts_are_not_embedded_in_output() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap()
        .to_path_buf();
    let Ok(font) = std::fs::read(root.join("android/app/src/main/assets/fonts/DejaVuSans.ttf")) else {
        return;
    };
    let mut backend = PdfiumBackend::new_for_test().expect("prebuilt PDFium required");
    backend.open_document("fonts", &justified_sample_pdf(), None).unwrap();
    let pages = vec![PageMeta {
        id: "p0".into(),
        source_doc_id: "fonts".into(),
        source_page_index: 0,
        base_width: 595.0,
        base_height: 842.0,
        intrinsic_rotation: 0,
        user_rotation: 0,
        media_box: [0.0, 0.0, 595.0, 842.0],
        crop_box: [0.0, 0.0, 595.0, 842.0],
    }];
    let imgs = HashMap::new();
    let out = backend
        .compile_native_pdf_with_options(
            &pages,
            &[shape_element("only-shape", false)],
            &[],
            CompilePdfOptions {
                fonts: crate::compile::CompiledFontBundle {
                    regular_ttf_bytes: Some(&font),
                    bold_ttf_bytes: Some(&font),
                    italic_ttf_bytes: Some(&font),
                    serif_ttf_bytes: Some(&font),
                    mono_ttf_bytes: Some(&font),
                    custom_ttf_bytes: None,
                },
                embedded_images: Some(&imgs),
                ..Default::default()
            },
        )
        .expect("compile ok");
    assert!(
        out.len() < 64 * 1024,
        "shape-only compile should not embed fonts, got {} bytes",
        out.len()
    );
}
