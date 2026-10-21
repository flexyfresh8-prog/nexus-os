// boot: 1) srcdoc sandboxed iframe with inline script
//       2) SW-served sandboxed iframe with inline script
(function () {
  function report(name, ok, err) {
    parent.postMessage({ __csptest: true, name: name, ok: ok, err: err || '' }, '*');
  }

  // --- 1. srcdoc + sandbox(no allow-same-origin) + inline script
  var f1 = document.getElementById('f-srcdoc');
  f1.setAttribute('sandbox', 'allow-scripts');
  f1.srcdoc = '<!DOCTYPE html><html><body><script>' +
    'try { parent.postMessage({ __csptest: true, name: "srcdoc inline script", ok: true }, "*"); }' +
    'catch (e) { parent.postMessage({ __csptest: true, name: "srcdoc inline script", ok: false, err: String(e) }, "*"); }' +
    '<\/script></body></html>';

  // --- 2. SW-served document
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      return navigator.serviceWorker.ready;
    }).then(function () {
      var f2 = document.getElementById('f-sw');
      f2.setAttribute('sandbox', 'allow-scripts');
      f2.src = './__preview/probe';
    }).catch(function (e) {
      report('SW registration', false, String(e));
    });
  } else {
    report('SW support', false, 'no serviceWorker');
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.__csptest && d.name === 'sw-served inline script') {
      report('sw-served inline script', d.ok, d.err);
    }
  });

  // timeouts: no message in 3s means the script never ran (blocked by CSP or frame dead)
  setTimeout(function () { report('srcdoc inline script (timeout check)', null); }, 3000);
  setTimeout(function () { report('sw-served inline script (timeout check)', null); }, 4000);
})();
