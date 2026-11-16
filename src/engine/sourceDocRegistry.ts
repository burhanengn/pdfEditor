/**
 * Off-store binary registry for opened PDF source buffers.
 * Keeps multi-megabyte Uint8Array payloads completely out of Zustand state
 * and React subscription snapshots (F0.3).
 */
const sourceBytesMap = new Map<string, Uint8Array>();

export function setSourceDocBytes(sourceDocId: string, bytes: Uint8Array): void {
  sourceBytesMap.set(sourceDocId, bytes);
}

export function getSourceDocBytes(sourceDocId: string): Uint8Array | undefined {
  return sourceBytesMap.get(sourceDocId);
}

export function hasSourceDocBytes(sourceDocId: string): boolean {
  return sourceBytesMap.has(sourceDocId);
}

export function deleteSourceDocBytes(sourceDocId: string): void {
  sourceBytesMap.delete(sourceDocId);
}

export function clearSourceDocBytes(): void {
  sourceBytesMap.clear();
}

export function getTotalRegisteredSourceBytes(): number {
  let total = 0;
  for (const buf of sourceBytesMap.values()) {
    total += buf.byteLength;
  }
  return total;
}
