import { ensureRustCoreReady } from './rustCoreBridge';

export type ReferenceDocKind =
  | 'form-1p'
  | 'text-120p'
  | 'scanned-300p'
  | 'vector-dense'
  | 'rtl-cjk';

export interface ReferenceDocOptions {
  /** Override page count for multi-page fixtures in lightweight unit tests. */
  pageCount?: number;
  /** Number of vector strokes/primitives for vector-dense fixture. */
  vectorSegments?: number;
}

export async function generateReferencePdf(
  kind: ReferenceDocKind,
  options: ReferenceDocOptions = {},
): Promise<Uint8Array> {
  const wasm = await ensureRustCoreReady();
  return wasm.create_reference_pdf_bytes(kind, options.pageCount, options.vectorSegments);
}
