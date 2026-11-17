const GP_SHARE_CACHE = 'gp-share-target-v1';
const GP_SHARE_REQUEST_KEY = './__gp_shared_pdf__';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'POST') return;
  const url = new URL(req.url);
  if (url.searchParams.get('share-target') !== '1') return;

  event.respondWith(
    (async () => {
      try {
        const formData = await req.formData();
        const file = formData.get('file');
        if (file instanceof File) {
          const cache = await caches.open(GP_SHARE_CACHE);
          const headers = new Headers({
            'Content-Type': file.type || 'application/pdf',
            'X-File-Name': encodeURIComponent(file.name || 'shared.pdf'),
          });
          await cache.put(GP_SHARE_REQUEST_KEY, new Response(file, { headers }));
        }
        return Response.redirect(new URL('./?shared-pdf=1', req.url).toString(), 303);
      } catch {
        return Response.redirect(new URL('./', req.url).toString(), 303);
      }
    })(),
  );
});
