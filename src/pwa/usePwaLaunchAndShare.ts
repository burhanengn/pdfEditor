import { useEffect } from 'react';
import { openPdfBytes } from '@/engine/documentController';

interface LaunchParams {
  targetURL?: string;
  files?: ReadonlyArray<FileSystemHandle>;
}

interface LaunchQueue {
  setConsumer: (consumer: (launchParams: LaunchParams) => void | Promise<void>) => void;
}

declare global {
  interface Window {
    launchQueue?: LaunchQueue;
  }
}

const GP_SHARE_CACHE = 'gp-share-target-v1';
const GP_SHARE_REQUEST_KEY = './__gp_shared_pdf__';

export async function consumePendingSharedPdf(): Promise<boolean> {
  if (typeof window === 'undefined' || !('caches' in window)) return false;
  try {
    const url = new URL(window.location.href);
    const hasShareFlag = url.searchParams.get('shared-pdf') === '1';
    const cache = await caches.open(GP_SHARE_CACHE);
    const res = await cache.match(GP_SHARE_REQUEST_KEY);
    if (!res) {
      if (hasShareFlag) {
        url.searchParams.delete('shared-pdf');
        window.history.replaceState({}, '', url.toString());
      }
      return false;
    }

    const rawHeader = res.headers.get('X-File-Name') ?? 'shared.pdf';
    let fileName = 'shared.pdf';
    try {
      fileName = decodeURIComponent(rawHeader) || 'shared.pdf';
    } catch {
      fileName = rawHeader;
    }
    const buf = await res.arrayBuffer();
    await cache.delete(GP_SHARE_REQUEST_KEY);

    if (hasShareFlag) {
      url.searchParams.delete('shared-pdf');
      window.history.replaceState({}, '', url.toString());
    }

    if (buf.byteLength > 0) {
      await openPdfBytes(fileName, new Uint8Array(buf), undefined, {
        initialMode: 'view',
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function usePwaLaunchAndShare(): void {
  useEffect(() => {
    void consumePendingSharedPdf();

    if (typeof window === 'undefined' || !window.launchQueue?.setConsumer) {
      return;
    }

    window.launchQueue.setConsumer(async (launchParams) => {
      const handles = launchParams.files;
      if (!handles || handles.length === 0) return;
      for (const handle of handles) {
        if (handle.kind !== 'file') continue;
        const fileHandle = handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        if (
          file.type === 'application/pdf' ||
          file.name.toLowerCase().endsWith('.pdf')
        ) {
          const buf = await file.arrayBuffer();
          await openPdfBytes(file.name, new Uint8Array(buf), undefined, {
            initialMode: 'view',
            fileHandle,
          });
          return;
        }
      }
    });
  }, []);
}
