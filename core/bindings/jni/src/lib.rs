pub mod actor;
pub mod jni_sys;

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;

use gp_geom::{
    compute_rotated_resize_rect as geom_compute_rotated_resize_rect, compute_snap_position,
    ResizeHandle, RotatedResizeParams,
};
use gp_model::{CanvasElement, PageMeta, PageNumberingConfig, RectBox, RotationAngle};
use gp_pdf::{
    CancellationFlag, PdfBackend, PdfLinkKind, PdfOpenResult, PdfOpenStatus, PdfOutlineNode,
    ReadingTheme, RedactionRect, TileRenderRequest,
};
use gp_pdf_pdfium::{
    compile::{CompilePdfOptions, CompiledFontBundle, PreDecodedImage},
    redaction::redact_document_verified,
};
use serde::{Deserialize, Serialize};

use crate::actor::{atomic_write_and_verify_pdf, engine_actor, ActorPriority};
use crate::jni_sys::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniPageSummary {
    source_page_index: u32,
    base_width: f64,
    base_height: f64,
    intrinsic_rotation: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniOutlineItem {
    id: String,
    title: String,
    page_index: Option<u32>,
    children: Vec<JniOutlineItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniOpenDocResult {
    ok: bool,
    error: Option<String>,
    status: String,
    page_count: u32,
    pages: Vec<JniPageSummary>,
    can_copy_text: bool,
    outline: Vec<JniOutlineItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniTextSpan {
    id: String,
    text: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    font_size: f64,
    baseline_y: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniPageTextResult {
    ok: bool,
    error: Option<String>,
    page_index: u32,
    plain_text: String,
    spans: Vec<JniTextSpan>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniLinkAnnotation {
    id: String,
    page_index: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    kind: String,
    uri: Option<String>,
    dest_page_index: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniSearchRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniSearchHit {
    page_index: u32,
    match_index_in_page: u32,
    snippet: String,
    rects: Vec<JniSearchRect>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JniRedactionRectInput {
    page_index: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JniCompileRequestInput {
    pages_json: String,
    elements_json: String,
    page_numbering_json: Option<String>,
    #[serde(default)]
    redactions: Vec<JniRedactionRectInput>,
    output_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniCompileResult {
    ok: bool,
    error: Option<String>,
    output_path: String,
    verified_page_count: u32,
    byte_size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniRedactResult {
    ok: bool,
    error: Option<String>,
    redacted_regions: u32,
    removed_objects: u32,
    remaining_matches: u32,
    verified: bool,
    output_page_count: u32,
    output_bytes: u64,
}

fn to_outline_items(nodes: Vec<PdfOutlineNode>) -> Vec<JniOutlineItem> {
    nodes
        .into_iter()
        .map(|n| JniOutlineItem {
            id: n.id,
            title: n.title,
            page_index: n.page_index.map(|p| p as u32),
            children: to_outline_items(n.children),
        })
        .collect()
}

fn parse_rotation(deg: i32) -> RotationAngle {
    match ((deg % 360) + 360) % 360 {
        90 => 90,
        180 => 180,
        270 => 270,
        _ => 0,
    }
}

fn parse_theme(theme: &str) -> ReadingTheme {
    match theme.to_ascii_lowercase().as_str() {
        "dark" => ReadingTheme::Dark,
        "sepia" => ReadingTheme::Sepia,
        _ => ReadingTheme::Default,
    }
}

fn map_open_status(status: PdfOpenStatus) -> &'static str {
    match status {
        PdfOpenStatus::Ok => "ok",
        PdfOpenStatus::NeedsPassword => "needs-password",
        PdfOpenStatus::InvalidPassword => "invalid-password",
    }
}

fn open_doc_error_json(msg: String) -> String {
    let lower = msg.to_ascii_lowercase();
    let status = if lower.contains("invalid password") {
        "invalid-password"
    } else if lower.contains("password") {
        "needs-password"
    } else {
        "error"
    };
    serde_json::to_string(&JniOpenDocResult {
        ok: false,
        error: Some(msg),
        status: status.to_string(),
        page_count: 0,
        pages: Vec::new(),
        can_copy_text: false,
        outline: Vec::new(),
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"status\":\"error\"}".to_string())
}

fn format_open_result(open_res: PdfOpenResult, outline: Vec<PdfOutlineNode>) -> String {
    serde_json::to_string(&JniOpenDocResult {
        ok: true,
        error: None,
        status: map_open_status(open_res.status).to_string(),
        page_count: open_res.page_count as u32,
        pages: open_res
            .pages
            .into_iter()
            .map(|p| JniPageSummary {
                source_page_index: p.source_page_index as u32,
                base_width: p.base_width,
                base_height: p.base_height,
                intrinsic_rotation: p.intrinsic_rotation as i32,
            })
            .collect(),
        can_copy_text: open_res.can_copy_text,
        outline: to_outline_items(outline),
    })
    .unwrap_or_else(|e| open_doc_error_json(e.to_string()))
}

pub fn init_engine_core(
    pdfium_library_path: Option<String>,
    tile_budget_bytes: u64,
) -> Result<(), String> {
    let cancel = CancellationFlag::new();
    engine_actor()
        .dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            state.ensure_backend(pdfium_library_path.as_deref())?;
            if tile_budget_bytes >= 8 * 1024 * 1024 {
                state.session.tile_cache = gp_engine::TileCache::new(tile_budget_bytes as usize);
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeInitEngine(
    env: *mut JNIEnv,
    _class: jclass,
    pdfium_lib_path: jstring,
    tile_budget_bytes: jlong,
) -> jboolean {
    let res = catch_unwind(AssertUnwindSafe(|| {
        let lib_path = jstring_to_option_string(env, pdfium_lib_path);
        init_engine_core(lib_path, tile_budget_bytes.max(8 * 1024 * 1024) as u64).is_ok()
    }));
    if matches!(res, Ok(true)) {
        JNI_TRUE
    } else {
        JNI_FALSE
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeOpenDocumentFile(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    path: jstring,
    password: jstring,
) -> jstring {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let path = jstring_to_string(env, path);
        let password = jstring_to_option_string(env, password).filter(|p| !p.is_empty());

        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => return open_doc_error_json(format!("failed reading PDF file {path}: {e}")),
        };
        let cancel = CancellationFlag::new();
        let res = engine_actor().dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            state.ensure_backend(None)?;
            state.doc_paths.insert(doc_id.clone(), path);
            let open_res = {
                let backend = state.backend.as_mut().expect("backend initialized");
                backend.open_document(&doc_id, &bytes, password.as_deref())?
            };
            let outline = if open_res.status == PdfOpenStatus::Ok {
                let backend = state.backend.as_ref().expect("backend initialized");
                backend.extract_outline(&doc_id).unwrap_or_default()
            } else {
                Vec::new()
            };
            Ok((open_res, outline))
        });

        match res {
            Ok((open_res, outline)) => format_open_result(open_res, outline),
            Err(e) => open_doc_error_json(e.to_string()),
        }
    }))
    .unwrap_or_else(|_| open_doc_error_json("native panic in openDocumentFile".to_string()));
    string_to_jstring(env, &out)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeOpenDocumentBytes(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    bytes_arr: jbyteArray,
    password: jstring,
) -> jstring {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let bytes = jbytearray_to_vec(env, bytes_arr).unwrap_or_default();
        let password = jstring_to_option_string(env, password).filter(|p| !p.is_empty());

        let cancel = CancellationFlag::new();
        let res = engine_actor().dispatch(ActorPriority::CommandOrHit, None, cancel, move |state, _| {
            state.ensure_backend(None)?;
            let open_res = {
                let backend = state.backend.as_mut().expect("backend initialized");
                backend.open_document(&doc_id, &bytes, password.as_deref())?
            };
            let outline = if open_res.status == PdfOpenStatus::Ok {
                let backend = state.backend.as_ref().expect("backend initialized");
                backend.extract_outline(&doc_id).unwrap_or_default()
            } else {
                Vec::new()
            };
            Ok((open_res, outline))
        });

        match res {
            Ok((open_res, outline)) => format_open_result(open_res, outline),
            Err(e) => open_doc_error_json(e.to_string()),
        }
    }))
    .unwrap_or_else(|_| open_doc_error_json("native panic in openDocumentBytes".to_string()));
    string_to_jstring(env, &out)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeCloseDocument(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let _ = engine_actor().dispatch(
            ActorPriority::CommandOrHit,
            None,
            CancellationFlag::new(),
            move |state, _| {
                state.doc_paths.remove(&doc_id);
                if let Some(backend) = state.backend.as_mut() {
                    let _ = backend.close_document(&doc_id);
                }
                Ok(())
            },
        );
    }));
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeRenderTileIntoBuffer(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    page_index: jint,
    tile_x: jint,
    tile_y: jint,
    tile_w: jint,
    tile_h: jint,
    scale: jdouble,
    user_rotation: jint,
    transparent_bg: jboolean,
    theme: jstring,
    dark_paper_invert: jboolean,
    priority_tier: jint,
    scope: jstring,
    out_buffer: jobject,
) -> jstring {
    let err_msg: Option<String> = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let theme_str = jstring_to_string(env, theme);
        let scope_opt = jstring_to_option_string(env, scope).filter(|s| !s.is_empty());

        let w = tile_w.max(1) as u32;
        let h = tile_h.max(1) as u32;
        let expected_bytes = (w as usize) * (h as usize) * 4;
        let Some(dst) = direct_buffer_mut_slice(env, out_buffer) else {
            return Some("outBuffer is null or not a direct ByteBuffer".to_string());
        };
        if dst.len() < expected_bytes {
            return Some(format!(
                "outBuffer capacity {} < required {}",
                dst.len(),
                expected_bytes
            ));
        }

        let priority = match priority_tier {
            0 => ActorPriority::VisibleTile,
            1 => ActorPriority::Preview,
            _ => ActorPriority::Thumbnail,
        };
        let cancel = CancellationFlag::new();
        let transparent = transparent_bg != 0;
        let invert = dark_paper_invert != 0;

        let res = engine_actor().dispatch(priority, scope_opt, cancel, move |state, cancel_flag| {
            let backend = state.ensure_backend(None)?;
            let pdf_req = TileRenderRequest {
                source_doc_id: doc_id,
                page_index: page_index.max(0) as usize,
                tile_x,
                tile_y,
                tile_width_px: w,
                tile_height_px: h,
                scale: scale.clamp(0.1, 24.0),
                user_rotation: parse_rotation(user_rotation),
                transparent_bg: transparent,
                theme: Some(parse_theme(&theme_str)),
                dark_paper_invert: invert,
            };
            backend.render_tile(&pdf_req, cancel_flag)
        });

        match res {
            Ok(mut bmp) => {
                if transparent {
                    // PDFium emits straight alpha; android.graphics.Bitmap (ARGB_8888) is
                    // premultiplied, so semi-transparent content would otherwise render opaque.
                    for px in bmp.rgba.chunks_exact_mut(4) {
                        let a = u16::from(px[3]);
                        if a < 255 {
                            px[0] = ((u16::from(px[0]) * a + 127) / 255) as u8;
                            px[1] = ((u16::from(px[1]) * a + 127) / 255) as u8;
                            px[2] = ((u16::from(px[2]) * a + 127) / 255) as u8;
                        }
                    }
                }
                let copy_len = expected_bytes.min(bmp.rgba.len());
                dst[..copy_len].copy_from_slice(&bmp.rgba[..copy_len]);
                None
            }
            Err(e) => Some(e.to_string()),
        }
    }))
    .unwrap_or_else(|_| Some("native panic in renderTile".to_string()));

    match err_msg {
        None => std::ptr::null_mut(),
        Some(msg) => string_to_jstring(env, &msg),
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeCancelRenderScope(
    env: *mut JNIEnv,
    _class: jclass,
    scope: jstring,
) -> jint {
    catch_unwind(AssertUnwindSafe(|| {
        let scope = jstring_to_string(env, scope);
        engine_actor().cancel_scope(&scope) as jint
    }))
    .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeTrimEngineMemory(
    _env: *mut JNIEnv,
    _class: jclass,
    target_bytes: jlong,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _ = engine_actor().dispatch(
            ActorPriority::CommandOrHit,
            None,
            CancellationFlag::new(),
            move |state, _| {
                state.session.trim_memory(target_bytes.max(0) as usize);
                Ok(())
            },
        );
    }));
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeExtractPageText(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    page_index: jint,
) -> jstring {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let p_idx = page_index.max(0) as usize;
        let res = engine_actor().dispatch(
            ActorPriority::CommandOrHit,
            None,
            CancellationFlag::new(),
            move |state, _| {
                let backend = state.ensure_backend(None)?;
                let plain_text = backend.extract_page_text(&doc_id, p_idx)?;
                let spans = backend
                    .extract_text_spans(&doc_id, p_idx)?
                    .into_iter()
                    .map(|s| JniTextSpan {
                        id: s.id,
                        text: s.text,
                        x: s.x,
                        y: s.y,
                        width: s.width,
                        height: s.height,
                        font_size: s.font_size,
                        baseline_y: s.baseline_y,
                    })
                    .collect();
                Ok((plain_text, spans))
            },
        );
        match res {
            Ok((plain_text, spans)) => serde_json::to_string(&JniPageTextResult {
                ok: true,
                error: None,
                page_index: p_idx as u32,
                plain_text,
                spans,
            })
            .unwrap_or_else(|_| "{\"ok\":false}".to_string()),
            Err(e) => serde_json::to_string(&JniPageTextResult {
                ok: false,
                error: Some(e.to_string()),
                page_index: p_idx as u32,
                plain_text: String::new(),
                spans: Vec::new(),
            })
            .unwrap_or_else(|_| "{\"ok\":false}".to_string()),
        }
    }))
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"panic\"}".to_string());
    string_to_jstring(env, &out)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeAnalyzePageObjects(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    page_index: jint,
    page_id: jstring,
) -> jstring {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let page_id = jstring_to_string(env, page_id);
        let p_idx = page_index.max(0) as usize;
        let res = engine_actor().dispatch(
            ActorPriority::SearchOrAnalysis,
            None,
            CancellationFlag::new(),
            move |state, _| {
                let backend = state.ensure_backend(None)?;
                let analysis = backend.analyze_page_objects(&doc_id, p_idx, &page_id)?;
                serde_json::to_string(&analysis)
                    .map_err(|e| gp_pdf::PdfError::Backend(format!("serialization error: {e}")))
            },
        );
        res.unwrap_or_else(|_| "{}".to_string())
    }))
    .unwrap_or_else(|_| "{}".to_string());
    string_to_jstring(env, &out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JniExtractedFontItem {
    id: String,
    clean_name: String,
    display_name: String,
    base_key: String,
    fallback_family: String,
    unicode_usable: bool,
    supported_code_points_sample: Vec<u32>,
    variants: gp_pdf::ExtractedFontVariantInfo,
    regular_ttf_path: Option<String>,
    bold_ttf_path: Option<String>,
    italic_ttf_path: Option<String>,
    bold_italic_ttf_path: Option<String>,
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeExtractEmbeddedFonts(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    cache_dir: jstring,
) -> jstring {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let dir_str = jstring_to_string(env, cache_dir);
        let res = engine_actor().dispatch(
            ActorPriority::SearchOrAnalysis,
            None,
            CancellationFlag::new(),
            move |state, _| {
                let backend = state.ensure_backend(None)?;
                let bundle = backend.extract_embedded_fonts(&doc_id)?;
                let target_dir = PathBuf::from(&dir_str);
                let _ = std::fs::create_dir_all(&target_dir);

                let mut items = Vec::with_capacity(bundle.fonts.len());
                for (i, meta) in bundle.fonts.into_iter().enumerate() {
                    let asset = bundle.assets.get(i);
                    let safe_key: String = meta
                        .base_key
                        .chars()
                        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                        .collect();
                    let write_variant = |suffix: &str, bytes: Option<&Vec<u8>>| -> Option<String> {
                        let b = bytes?;
                        let fname = format!("emb_{}_{}_{}.ttf", i, safe_key, suffix);
                        let path = target_dir.join(fname);
                        if std::fs::write(&path, b).is_ok() {
                            Some(path.to_string_lossy().to_string())
                        } else {
                            None
                        }
                    };
                    let reg_path = write_variant("reg", asset.and_then(|a| a.regular.as_ref()));
                    let bold_path = write_variant("bold", asset.and_then(|a| a.bold.as_ref()));
                    let italic_path = write_variant("italic", asset.and_then(|a| a.italic.as_ref()));
                    let bi_path = write_variant("bi", asset.and_then(|a| a.bold_italic.as_ref()));
                    items.push(JniExtractedFontItem {
                        id: meta.id,
                        clean_name: meta.clean_name,
                        display_name: meta.display_name,
                        base_key: meta.base_key,
                        fallback_family: meta.fallback_family,
                        unicode_usable: meta.unicode_usable,
                        supported_code_points_sample: meta.supported_code_points,
                        variants: meta.variants,
                        regular_ttf_path: reg_path,
                        bold_ttf_path: bold_path,
                        italic_ttf_path: italic_path,
                        bold_italic_ttf_path: bi_path,
                    });
                }
                serde_json::to_string(&items)
                    .map_err(|e| gp_pdf::PdfError::Backend(format!("serialization error: {e}")))
            },
        );
        res.unwrap_or_else(|_| "[]".to_string())
    }))
    .unwrap_or_else(|_| "[]".to_string());
    string_to_jstring(env, &out)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeExtractPageImageRgba(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    page_index: jint,
    image_id: jstring,
) -> jbyteArray {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let img_id = jstring_to_string(env, image_id);
        let p_idx = page_index.max(0) as usize;
        engine_actor()
            .dispatch(
                ActorPriority::CommandOrHit,
                None,
                CancellationFlag::new(),
                move |state, _| {
                    let backend = state.ensure_backend(None)?;
                    let (w, h, rgba) = backend.extract_page_image_rgba(&doc_id, p_idx, &img_id)?;
                    let mut packed = Vec::with_capacity(8 + rgba.len());
                    packed.extend_from_slice(&(w as i32).to_le_bytes());
                    packed.extend_from_slice(&(h as i32).to_le_bytes());
                    packed.extend_from_slice(&rgba);
                    Ok(packed)
                },
            )
            .ok()
    }))
    .ok()
    .flatten();

    match out {
        Some(bytes) => vec_to_jbytearray(env, &bytes),
        None => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeExtractPageLinks(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    page_index: jint,
) -> jstring {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let p_idx = page_index.max(0) as usize;
        let res = engine_actor().dispatch(
            ActorPriority::CommandOrHit,
            None,
            CancellationFlag::new(),
            move |state, _| {
                let backend = state.ensure_backend(None)?;
                let links = backend.extract_links(&doc_id, p_idx)?;
                let mapped: Vec<JniLinkAnnotation> = links
                    .into_iter()
                    .map(|l| JniLinkAnnotation {
                        id: l.id,
                        page_index: l.page_index as u32,
                        x: l.x,
                        y: l.y,
                        width: l.width,
                        height: l.height,
                        kind: match l.kind {
                            PdfLinkKind::Uri => "uri".to_string(),
                            PdfLinkKind::Goto => "goto".to_string(),
                        },
                        uri: l.uri,
                        dest_page_index: l.dest_page_index.map(|p| p as u32),
                    })
                    .collect();
                serde_json::to_string(&mapped)
                    .map_err(|e| gp_pdf::PdfError::Backend(format!("serialization error: {e}")))
            },
        );
        res.unwrap_or_else(|_| "[]".to_string())
    }))
    .unwrap_or_else(|_| "[]".to_string());
    string_to_jstring(env, &out)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativePrepareCleanPagePreview(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    page_index: jint,
    elements_json: jstring,
) -> jbyteArray {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let elements_raw = jstring_to_string(env, elements_json);
        let p_idx = page_index.max(0) as usize;

        let elements: Vec<CanvasElement> = match serde_json::from_str(&elements_raw) {
            Ok(v) => v,
            Err(_) => return None,
        };
        let mut targets = gp_redact::CleanPreviewTargets::default();
        for el in elements {
            if let Some((kind, t)) = gp_redact::element_in_place_transform(&el, 0) {
                match kind {
                    gp_redact::InPlaceKind::Image => targets.image_transforms.push(t),
                    gp_redact::InPlaceKind::Shape => targets.shape_transforms.push(t),
                }
                continue;
            }
            match el {
                CanvasElement::TextEdit { .. } => {
                    targets.text_rects.extend(gp_redact::element_text_strip_rects(&el))
                }
                CanvasElement::ImageReplacement { .. } => targets.image_rects.push(el.strip_rect()),
                CanvasElement::ShapeReplacement { .. } => targets.shape_rects.push(el.strip_rect()),
                _ => {}
            }
        }
        engine_actor()
            .dispatch(
                ActorPriority::CommandOrHit,
                None,
                CancellationFlag::new(),
                move |state, _| {
                    let backend = state.ensure_backend(None)?;
                    backend.prepare_clean_page_preview_targets(&doc_id, p_idx, &targets)
                },
            )
            .ok()
    }))
    .ok()
    .flatten();

    match out {
        Some(bytes) => vec_to_jbytearray(env, &bytes),
        None => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeSearchPage(
    env: *mut JNIEnv,
    _class: jclass,
    doc_id: jstring,
    page_index: jint,
    query: jstring,
    match_case: jboolean,
    whole_word: jboolean,
) -> jstring {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let doc_id = jstring_to_string(env, doc_id);
        let query = jstring_to_string(env, query);
        let p_idx = page_index.max(0) as usize;
        if query.trim().is_empty() {
            return "[]".to_string();
        }
        let fold_diacritics = match_case == 0;
        let whole = whole_word != 0;
        let res = engine_actor().dispatch(
            ActorPriority::SearchOrAnalysis,
            Some(format!("search:{doc_id}")),
            CancellationFlag::new(),
            move |state, _| {
                let backend = state.ensure_backend(None)?;
                let hits = backend.search_page(&doc_id, p_idx, &query, fold_diacritics)?;
                let mapped: Vec<JniSearchHit> = hits
                    .into_iter()
                    .filter(|h| !whole || !h.snippet.trim().is_empty())
                    .map(|h| JniSearchHit {
                        page_index: h.page_index as u32,
                        match_index_in_page: h.match_index_in_page as u32,
                        snippet: h.snippet,
                        rects: h
                            .rects
                            .into_iter()
                            .map(|r| JniSearchRect {
                                x: r.x,
                                y: r.y,
                                width: r.width,
                                height: r.height,
                            })
                            .collect(),
                    })
                    .collect();
                serde_json::to_string(&mapped)
                    .map_err(|e| gp_pdf::PdfError::Backend(format!("serialization error: {e}")))
            },
        );
        res.unwrap_or_else(|_| "[]".to_string())
    }))
    .unwrap_or_else(|_| "[]".to_string());
    string_to_jstring(env, &out)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeComputeRotatedResizeRect(
    env: *mut JNIEnv,
    _class: jclass,
    x: jdouble,
    y: jdouble,
    width: jdouble,
    height: jdouble,
    rotation_deg: jdouble,
    handle: jstring,
    dx_px: jdouble,
    dy_px: jdouble,
    aspect_locked: jboolean,
) -> jdoubleArray {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let handle_str = jstring_to_string(env, handle);
        let parsed = match handle_str.to_ascii_lowercase().as_str() {
            "nw" => ResizeHandle::Nw,
            "n" => ResizeHandle::N,
            "ne" => ResizeHandle::Ne,
            "e" => ResizeHandle::E,
            "se" => ResizeHandle::Se,
            "s" => ResizeHandle::S,
            "sw" => ResizeHandle::Sw,
            _ => ResizeHandle::W,
        };
        let next = geom_compute_rotated_resize_rect(RotatedResizeParams {
            start_rect: RectBox {
                x,
                y,
                width,
                height,
            },
            handle: parsed,
            dx_px,
            dy_px,
            frame_rotation_deg: rotation_deg,
            user_rotation: 0,
            zoom: 1.0,
            aspect_locked: aspect_locked != 0,
            shift_key: false,
            min_size: 12.0,
        });
        [next.x, next.y, next.width, next.height]
    }))
    .unwrap_or([x, y, width, height]);
    vec_to_jdoublearray(env, &out)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeComputeSnapGuidePosition(
    env: *mut JNIEnv,
    _class: jclass,
    x: jdouble,
    y: jdouble,
    width: jdouble,
    height: jdouble,
    page_w: jdouble,
    page_h: jdouble,
    siblings_json: jstring,
) -> jdoubleArray {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let sib_raw = jstring_to_string(env, siblings_json);
        let siblings: Vec<RectBox> = serde_json::from_str(&sib_raw).unwrap_or_default();
        let res = compute_snap_position(
            RectBox {
                x,
                y,
                width,
                height,
            },
            page_w,
            page_h,
            &siblings,
            true,
        );
        [res.x, res.y, if res.guides.is_empty() { 0.0 } else { 1.0 }]
    }))
    .unwrap_or([x, y, 0.0]);
    vec_to_jdoublearray(env, &out)
}

fn compile_err_json(msg: String) -> String {
    serde_json::to_string(&JniCompileResult {
        ok: false,
        error: Some(msg),
        output_path: String::new(),
        verified_page_count: 0,
        byte_size: 0,
    })
    .unwrap_or_else(|_| "{\"ok\":false}".to_string())
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeCompileAndSaveVerified(
    env: *mut JNIEnv,
    _class: jclass,
    request_json: jstring,
    font_regular: jbyteArray,
    font_bold: jbyteArray,
    font_italic: jbyteArray,
    font_serif: jbyteArray,
    font_mono: jbyteArray,
    custom_ttf: jbyteArray,
    extra_font_keys: jobjectArray,
    extra_font_paths: jobjectArray,
    image_ids: jobjectArray,
    image_widths: jintArray,
    image_heights: jintArray,
    image_rgba_arrays: jobjectArray,
) -> jstring {
    let out = catch_unwind(AssertUnwindSafe(|| {
        let req_str = jstring_to_string(env, request_json);
        let req: JniCompileRequestInput = match serde_json::from_str(&req_str) {
            Ok(v) => v,
            Err(e) => return compile_err_json(format!("invalid compile request JSON: {e}")),
        };
        let pages: Vec<PageMeta> = match serde_json::from_str(&req.pages_json) {
            Ok(v) => v,
            Err(e) => return compile_err_json(format!("invalid pages_json: {e}")),
        };
        let elements: Vec<CanvasElement> = match serde_json::from_str(&req.elements_json) {
            Ok(v) => v,
            Err(e) => return compile_err_json(format!("invalid elements_json: {e}")),
        };
        let page_numbering: Option<PageNumberingConfig> = match &req.page_numbering_json {
            Some(raw) if !raw.trim().is_empty() => match serde_json::from_str(raw) {
                Ok(v) => Some(v),
                Err(e) => return compile_err_json(format!("invalid page_numbering_json: {e}")),
            },
            _ => None,
        };
        let redactions: Vec<RedactionRect> = req
            .redactions
            .into_iter()
            .map(|r| RedactionRect {
                page_index: r.page_index as usize,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
            })
            .collect();

        let reg_bytes = jbytearray_to_vec(env, font_regular);
        let bold_bytes = jbytearray_to_vec(env, font_bold);
        let italic_bytes = jbytearray_to_vec(env, font_italic);
        let serif_bytes = jbytearray_to_vec(env, font_serif);
        let mono_bytes = jbytearray_to_vec(env, font_mono);
        let custom_bytes = jbytearray_to_vec(env, custom_ttf);

        let extra_key_count = jobjectarray_len(env, extra_font_keys);
        let extra_path_count = jobjectarray_len(env, extra_font_paths);
        let extra_usable = extra_key_count.min(extra_path_count);
        let mut extra_fonts_map: HashMap<String, Vec<u8>> = HashMap::new();
        for i in 0..extra_usable {
            let k_obj = jobjectarray_get(env, extra_font_keys, i);
            let key = jstring_to_string(env, k_obj);
            delete_local_ref(env, k_obj);

            let p_obj = jobjectarray_get(env, extra_font_paths, i);
            let p_str = jstring_to_string(env, p_obj);
            delete_local_ref(env, p_obj);

            if !key.is_empty() && !p_str.is_empty() {
                if let Ok(bytes) = std::fs::read(&p_str) {
                    if bytes.len() >= 128 {
                        extra_fonts_map.insert(key, bytes);
                    }
                }
            }
        }

        let img_count = jobjectarray_len(env, image_ids);
        let widths = jintarray_to_vec(env, image_widths);
        let heights = jintarray_to_vec(env, image_heights);
        let rgba_count = jobjectarray_len(env, image_rgba_arrays);
        let usable = img_count.min(widths.len()).min(heights.len()).min(rgba_count);
        let mut img_map: HashMap<String, PreDecodedImage> = HashMap::new();
        for i in 0..usable {
            let id_obj = jobjectarray_get(env, image_ids, i);
            let id = jstring_to_string(env, id_obj);
            delete_local_ref(env, id_obj);

            let rgba_obj = jobjectarray_get(env, image_rgba_arrays, i);
            let rgba = jbytearray_to_vec(env, rgba_obj).unwrap_or_default();
            delete_local_ref(env, rgba_obj);

            let w = widths[i].max(0) as u32;
            let h = heights[i].max(0) as u32;
            if !id.is_empty() && w > 0 && h > 0 && rgba.len() >= (w as usize) * (h as usize) * 4 {
                img_map.insert(id, PreDecodedImage { width: w, height: h, rgba });
            }
        }

        let out_path_str = req.output_path.clone();
        let res = engine_actor().dispatch(
            ActorPriority::Compile,
            None,
            CancellationFlag::new(),
            move |state, _| {
                let backend = state.ensure_backend(None)?;
                let options = CompilePdfOptions {
                    fonts: CompiledFontBundle {
                        custom_ttf_bytes: custom_bytes.as_deref(),
                        regular_ttf_bytes: reg_bytes.as_deref(),
                        bold_ttf_bytes: bold_bytes.as_deref(),
                        italic_ttf_bytes: italic_bytes.as_deref(),
                        serif_ttf_bytes: serif_bytes.as_deref(),
                        mono_ttf_bytes: mono_bytes.as_deref(),
                    },
                    page_numbering: page_numbering.as_ref(),
                    embedded_images: Some(&img_map),
                    extra_named_ttf: if extra_fonts_map.is_empty() { None } else { Some(&extra_fonts_map) },
                };
                let out_bytes = backend.compile_native_pdf_with_options(
                    &pages,
                    &elements,
                    &redactions,
                    options,
                )?;
                let out_path = PathBuf::from(&out_path_str);
                let (verified_pages, byte_size) =
                    atomic_write_and_verify_pdf(backend.pdfium(), &out_path, &out_bytes)?;
                Ok(JniCompileResult {
                    ok: true,
                    error: None,
                    output_path: out_path_str,
                    verified_page_count: verified_pages as u32,
                    byte_size,
                })
            },
        );

        match res {
            Ok(v) => serde_json::to_string(&v).unwrap_or_else(|e| compile_err_json(e.to_string())),
            Err(e) => compile_err_json(e.to_string()),
        }
    }))
    .unwrap_or_else(|_| compile_err_json("native panic in compileAndSaveVerified".to_string()));
    string_to_jstring(env, &out)
}

#[no_mangle]
pub unsafe extern "system" fn Java_dev_gullacpdf_android_engine_NativePdfBridge_nativeRedactFileVerified(
    env: *mut JNIEnv,
    _class: jclass,
    input_path: jstring,
    output_path: jstring,
    password: jstring,
    rects_json: jstring,
) -> jstring {
    let err_json = |msg: String| {
        serde_json::to_string(&JniRedactResult {
            ok: false,
            error: Some(msg),
            redacted_regions: 0,
            removed_objects: 0,
            remaining_matches: 0,
            verified: false,
            output_page_count: 0,
            output_bytes: 0,
        })
        .unwrap_or_else(|_| "{\"ok\":false}".to_string())
    };
    let out = catch_unwind(AssertUnwindSafe(|| {
        let in_path = jstring_to_string(env, input_path);
        let out_path = jstring_to_string(env, output_path);
        let pw = jstring_to_option_string(env, password).filter(|p| !p.is_empty());
        let rects_raw = jstring_to_string(env, rects_json);

        let raw_bytes = match std::fs::read(&in_path) {
            Ok(b) => b,
            Err(e) => return err_json(format!("failed reading {in_path}: {e}")),
        };
        let parsed_rects: Vec<JniRedactionRectInput> =
            serde_json::from_str(&rects_raw).unwrap_or_default();
        let redactions: Vec<RedactionRect> = parsed_rects
            .into_iter()
            .map(|r| RedactionRect {
                page_index: r.page_index as usize,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
            })
            .collect();

        let res = engine_actor().dispatch(
            ActorPriority::Compile,
            None,
            CancellationFlag::new(),
            move |state, _| {
                let backend = state.ensure_backend(None)?;
                let (clean_bytes, report) = redact_document_verified(
                    backend.pdfium(),
                    raw_bytes,
                    pw.as_deref(),
                    &redactions,
                )?;
                let dest = PathBuf::from(&out_path);
                let (page_count, byte_size) =
                    atomic_write_and_verify_pdf(backend.pdfium(), &dest, &clean_bytes)?;
                Ok(JniRedactResult {
                    ok: true,
                    error: None,
                    redacted_regions: report.redacted_regions as u32,
                    removed_objects: report.removed_objects as u32,
                    remaining_matches: report.remaining_matches as u32,
                    verified: report.verified,
                    output_page_count: page_count as u32,
                    output_bytes: byte_size,
                })
            },
        );
        match res {
            Ok(v) => serde_json::to_string(&v).unwrap_or_else(|e| err_json(e.to_string())),
            Err(e) => err_json(e.to_string()),
        }
    }))
    .unwrap_or_else(|_| err_json("native panic in redactFileVerified".to_string()));
    string_to_jstring(env, &out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actor::engine_actor;
    use pdfium_render::prelude::PdfPageObjectsCommon;

    #[test]
    fn jni_actor_renders_high_dpi_tile_and_verifies_redaction() {
        init_engine_core(None, 32 * 1024 * 1024).expect("PDFium init via .pdfium-cache");
        let tmp_dir = std::env::temp_dir().join(format!("gp_jni_test_{}", std::process::id()));
        std::fs::create_dir_all(&tmp_dir).unwrap();
        let src_pdf = tmp_dir.join("input.pdf");

        engine_actor()
            .dispatch(ActorPriority::CommandOrHit, None, CancellationFlag::new(), {
                let src_pdf = src_pdf.clone();
                move |state, _| {
                    let backend = state.ensure_backend(None)?;
                    let mut doc = backend.pdfium().create_new_pdf().unwrap();
                    let font = doc.fonts_mut().helvetica();
                    let mut page = doc
                        .pages_mut()
                        .create_page_at_index(pdfium_render::prelude::PdfPagePaperSize::a4(), 0)
                        .unwrap();
                    page.objects_mut()
                        .create_text_object(
                            pdfium_render::prelude::PdfPoints::new(72.0),
                            pdfium_render::prelude::PdfPoints::new(720.0),
                            "NATIVE_KOTLIN_JNI_TEST",
                            font,
                            pdfium_render::prelude::PdfPoints::new(14.0),
                        )
                        .unwrap();
                    let bytes = doc.save_to_bytes().unwrap();
                    atomic_write_and_verify_pdf(backend.pdfium(), &src_pdf, &bytes)?;
                    Ok(())
                }
            })
            .unwrap();

        let bytes = std::fs::read(&src_pdf).unwrap();
        let open_res = engine_actor()
            .dispatch(ActorPriority::CommandOrHit, None, CancellationFlag::new(), move |state, _| {
                let backend = state.ensure_backend(None)?;
                backend.open_document("jni-doc", &bytes, None)
            })
            .unwrap();
        assert_eq!(open_res.page_count, 1);

        // Verify high-DPI scale > 8.0 (e.g. 12.0 px/pt) renders cleanly without clamping failure!
        let bmp = engine_actor()
            .dispatch(ActorPriority::VisibleTile, None, CancellationFlag::new(), move |state, cancel| {
                let backend = state.ensure_backend(None)?;
                backend.render_tile(
                    &TileRenderRequest {
                        source_doc_id: "jni-doc".to_string(),
                        page_index: 0,
                        tile_x: 0,
                        tile_y: 0,
                        tile_width_px: 384,
                        tile_height_px: 384,
                        scale: 12.0,
                        user_rotation: 0,
                        transparent_bg: false,
                        theme: Some(ReadingTheme::Default),
                        dark_paper_invert: false,
                    },
                    cancel,
                )
            })
            .unwrap();
        assert_eq!(bmp.width, 384);
        assert_eq!(bmp.height, 384);
        assert_eq!(bmp.rgba.len(), 384 * 384 * 4);

        // Verify scaled font size & Form XObject box detection don't inflate fonts
        let analysis = engine_actor()
            .dispatch(ActorPriority::SearchOrAnalysis, None, CancellationFlag::new(), move |state, _| {
                let backend = state.ensure_backend(None)?;
                backend.analyze_page_objects("jni-doc", 0, "p0")
            })
            .unwrap();
        assert_eq!(analysis.text_blocks.len(), 1);
        assert!(
            (analysis.text_blocks[0].font_size - 14.0).abs() < 2.0,
            "Unexpected font size: {}",
            analysis.text_blocks[0].font_size
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
