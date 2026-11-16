/**
 * Off-store binary registry for opened PDF source buffers.
 * Keeps multi-megabyte Uint8Array payloads completely out of Zustand state
 * and React subscription snapshots (F0.3).
 */
const sourceBytesMap = new Map<string, Uint8Array>();
const sourcePasswordsMap = new Map<string, string>();
const sourceFileHandlesMap = new Map<string, FileSystemFileHandle>();

export function setSourceDocBytes(sourceDocId: string, bytes: Uint8Array): void {
  sourceBytesMap.set(sourceDocId, bytes);
}

export function getSourceDocBytes(sourceDocId: string): Uint8Array | undefined {
  return sourceBytesMap.get(sourceDocId);
}

export function setSourceDocPassword(sourceDocId: string, password?: string): void {
  if (password) {
    sourcePasswordsMap.set(sourceDocId, password);
  } else {
    sourcePasswordsMap.delete(sourceDocId);
  }
}

export function getSourceDocPassword(sourceDocId: string): string | undefined {
  return sourcePasswordsMap.get(sourceDocId);
}

export function setSourceFileHandle(sourceDocId: string, handle: FileSystemFileHandle | null): void {
  if (handle) {
    sourceFileHandlesMap.set(sourceDocId, handle);
  } else {
    sourceFileHandlesMap.delete(sourceDocId);
  }
}

export function getSourceFileHandle(sourceDocId: string): FileSystemFileHandle | undefined {
  return sourceFileHandlesMap.get(sourceDocId);
}

export function hasSourceDocBytes(sourceDocId: string): boolean {
  return sourceBytesMap.has(sourceDocId);
}

export function deleteSourceDocBytes(sourceDocId: string): void {
  sourceBytesMap.delete(sourceDocId);
  sourcePasswordsMap.delete(sourceDocId);
  sourceFileHandlesMap.delete(sourceDocId);
}

export function clearSourceDocBytes(): void {
  sourceBytesMap.clear();
  sourcePasswordsMap.clear();
  sourceFileHandlesMap.clear();
}

export function getTotalRegisteredSourceBytes(): number {
  let total = 0;
  for (const buf of sourceBytesMap.values()) {
    total += buf.byteLength;
  }
  return total;
}
