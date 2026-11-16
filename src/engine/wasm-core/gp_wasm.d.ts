/* tslint:disable */
/* eslint-disable */

export class WasmSession {
    free(): void;
    [Symbol.dispose](): void;
    apply_command_json(command_json: string): string;
    can_redo(): boolean;
    can_undo(): boolean;
    export_snapshot_json(): string;
    load_snapshot_json(json: string): void;
    constructor(tile_cache_budget_bytes: number);
    redo(): boolean;
    revision(): bigint;
    trim_memory(target_bytes: number): void;
    undo(): boolean;
}

export function build_detected_text_blocks(raw_lines: any, page_id: string, barriers: any): any;

export function build_page_offset_index(pages: any, zoom: number, metrics: any): any;

/**
 * Wraps rich text runs using an explicit serialized width table `{ "<bold>|<italic>|<script>|<text>": width }`
 * with character advance fallback, avoiding per-character Wasm-JS boundary crossings.
 */
export function build_wrapped_rich_lines(runs: any, max_width: number, width_map: any, char_advance_pt: number, base_bold: boolean, base_italic: boolean, options: any): any;

export function compute_page_number_layout(page_width: number, page_height: number, page_index_zero_based: number, total_pages: number, config: any): any;

export function compute_rotated_resize_rect(params: any): any;

export function compute_snap_position(moving_rect: any, page_width: number, page_height: number, siblings: any, enabled: boolean): any;

export function core_version(): string;

export function ensure_runs_from_element(text: string, runs: any, base_bold: boolean, base_italic: boolean): any;

export function flip_svg_path(d: string, width: number, height: number, flip_x: boolean, flip_y: boolean, decimals: number): string;

export function format_page_number_label(page_index_zero_based: number, total_pages: number, config: any): string | undefined;

export function get_rotated_bounding_box(rect: any, rotation_deg: number): any;

export function normalize_absolute_points(abs_points: any): any;

export function normalize_font_match_key(raw_name: string): any;

export function normalize_for_turkish_search(input: string, fold_diacritics: boolean): string;

export function normalize_text_runs(runs: any, base_bold: boolean, base_italic: boolean): any;

export function normalize_unicode_for_pdf(text: string): string;

export function parse_page_range_expression(input: string, total_pages: number): any;

export function parse_pdf_font_metadata(raw_name: string, is_serif: boolean, is_mono: boolean, is_bold: boolean, is_italic: boolean): any;

export function path_points_to_svg_path(points: any, width: number, height: number, closed: boolean, smooth: boolean): string;

export function point_in_rotated_rect(px: number, py: number, rect: any, rotation_deg: number, pad: number): boolean;

export function sanitize_for_winansi(text: string): string;

export function scale_svg_path(d: string, sx: number, sy: number, decimals: number): string;

export function shape_to_svg_path(shape_type: any, width: number, height: number, border_radius: number): string;

export function to_roman_numeral(num: number, upper: boolean): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmsession_free: (a: number, b: number) => void;
    readonly build_detected_text_blocks: (a: number, b: any, c: number, d: number, e: any) => void;
    readonly build_page_offset_index: (a: number, b: any, c: number, d: any) => void;
    readonly build_wrapped_rich_lines: (a: number, b: any, c: number, d: any, e: number, f: number, g: number, h: any) => void;
    readonly compute_page_number_layout: (a: number, b: number, c: number, d: number, e: number, f: any) => void;
    readonly compute_rotated_resize_rect: (a: number, b: any) => void;
    readonly compute_snap_position: (a: number, b: any, c: number, d: number, e: any, f: number) => void;
    readonly core_version: (a: number) => void;
    readonly ensure_runs_from_element: (a: number, b: number, c: number, d: any, e: number, f: number) => void;
    readonly flip_svg_path: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly format_page_number_label: (a: number, b: number, c: number, d: any) => void;
    readonly get_rotated_bounding_box: (a: number, b: any, c: number) => void;
    readonly normalize_absolute_points: (a: number, b: any) => void;
    readonly normalize_font_match_key: (a: number, b: number, c: number) => void;
    readonly normalize_for_turkish_search: (a: number, b: number, c: number, d: number) => void;
    readonly normalize_text_runs: (a: number, b: any, c: number, d: number) => void;
    readonly normalize_unicode_for_pdf: (a: number, b: number, c: number) => void;
    readonly parse_page_range_expression: (a: number, b: number, c: number, d: number) => void;
    readonly parse_pdf_font_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly path_points_to_svg_path: (a: number, b: any, c: number, d: number, e: number, f: number) => void;
    readonly point_in_rotated_rect: (a: number, b: number, c: number, d: any, e: number, f: number) => void;
    readonly sanitize_for_winansi: (a: number, b: number, c: number) => void;
    readonly scale_svg_path: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly shape_to_svg_path: (a: number, b: any, c: number, d: number, e: number) => void;
    readonly to_roman_numeral: (a: number, b: number, c: number) => void;
    readonly wasmsession_apply_command_json: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsession_can_redo: (a: number) => number;
    readonly wasmsession_can_undo: (a: number) => number;
    readonly wasmsession_export_snapshot_json: (a: number, b: number) => void;
    readonly wasmsession_load_snapshot_json: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsession_new: (a: number) => number;
    readonly wasmsession_redo: (a: number, b: number) => void;
    readonly wasmsession_revision: (a: number) => bigint;
    readonly wasmsession_trim_memory: (a: number, b: number) => void;
    readonly wasmsession_undo: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export4: (a: number) => void;
    readonly __wbindgen_export5: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export6: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
