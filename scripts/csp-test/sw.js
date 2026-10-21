// test service worker: synthesize a preview document with an inline script,
// no CSP headers on the response.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.pathname.endsWith('/__preview/probe')) {
    var html = '<!DOCTYPE html><html><body><script>' +
      'try { parent.postMessage({ __csptest: true, name: "sw-served inline script", ok: true }, "*"); }' +
      'catch (err) { parent.postMessage({ __csptest: true, name: "sw-served inline script", ok: false, err: String(err) }, "*"); }' +
      '<\/script></body></html>';
    e.respondWith(new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }));
  }
});
