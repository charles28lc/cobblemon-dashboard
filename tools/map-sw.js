// Static hosts serve BlueMap's .gz map files without Content-Encoding, so unzip them here.
const GZ_PATH = /\/maps\/[^/]+\/(tiles\/.+\.prbm|textures\.json)$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !GZ_PATH.test(url.pathname)) return;
  event.respondWith(fetchGz(url));
});

async function fetchGz(url) {
  const gzUrl = new URL(url.pathname + ".gz", url.origin);
  const res = await fetch(gzUrl);
  if (res.status === 404) return new Response(null, { status: 404 });
  if (!res.ok) return fetch(url);
  const type = url.pathname.endsWith(".json") ? "application/json" : "application/octet-stream";
  const body = res.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(body, { status: 200, headers: { "Content-Type": type } });
}
