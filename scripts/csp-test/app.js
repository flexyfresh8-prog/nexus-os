// external script — all host logic (CSP-safe: external files only)
(function () {
  var results = null;
  function line(s) {
    if (!results) results = document.getElementById('results');
    if (results && results.textContent.indexOf(s) === -1) results.textContent += '\n' + s;
  }

  window.addEventListener('load', function () {
    document.getElementById('results').textContent =
      'main inline: ' + (window.__MAIN_OK ? 'ALLOWED (ran)' : 'BLOCKED (good)');
    line('SW registered: ' + (navigator.serviceWorker ? 'yes' : 'no'));
  });

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (!d.__csptest) return;
    if (d.ok === null) {
      var real = d.name.replace(' (timeout check)', '');
      if (document.getElementById('results').textContent.indexOf(real + ':') === -1) {
        line(real + ': DID NOT RUN (blocked or frame failed)');
      }
      return;
    }
    line(d.name + ': ' + (d.ok ? 'ALLOWED (ran)' : 'BLOCKED') + (d.err ? ' [' + d.err + ']' : ''));
  });

  function report(name, ok, err) {
    window.postMessage({ __csptest: true, name: name, ok: ok, err: err || '' }, '*');
  }

  line('stage: setup start');
  try {
    // srcdoc + sandbox(no allow-same-origin) + inline script
    var f1 = document.getElementById('f-srcdoc');
    f1.setAttribute('sandbox', 'allow-scripts');
    f1.srcdoc = '<!DOCTYPE html><html><body><script>' +
      'try { parent.postMessage({ __csptest: true, name: "srcdoc inline script", ok: true }, "*"); }' +
      'catch (e) { parent.postMessage({ __csptest: true, name: "srcdoc inline script", ok: false, err: String(e) }, "*"); }' +
      '<\/script></body></html>';
    line('stage: srcdoc set');
  } catch (e) { line('stage: srcdoc ERROR ' + e); }

  // SW-served document
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(function () {
      line('stage: sw register resolved');
      return navigator.serviceWorker.ready;
    }).then(function () {
      line('stage: sw ready');
      var f2 = document.getElementById('f-sw');
      f2.setAttribute('sandbox', 'allow-scripts');
      f2.src = './__preview/probe?v=2';
    }).catch(function (e) {
      report('SW registration', false, String(e));
    });
  } else {
    report('SW support', false, 'no serviceWorker');
  }

  setTimeout(function () { line('stage: 3s timer fired'); report('srcdoc inline script (timeout check)', null); }, 3000);
  setTimeout(function () { line('stage: 4.5s timer fired'); report('sw-served inline script (timeout check)', null); }, 4500);

  // --- 3. static shell loader: iframe src=shell.html (real network response, no CSP),
  //        sandbox allow-scripts only, doc delivered via postMessage + document.write
  var f3 = document.createElement('iframe');
  f3.setAttribute('sandbox', 'allow-scripts');
  f3.src = './shell.html?v=3';
  document.body.appendChild(f3);
  var shellReady = false;
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d && d.source === 'nexus-preview-shell' && d.kind === 'wrote') line('shell: document.write completed');
    if (d && d.source === 'nexus-preview-shell' && d.kind === 'error') line('shell: write error ' + d.message);
    if (d && d.source === 'nexus-preview-shell' && d.kind === 'ready') {
      shellReady = true;
      f3.contentWindow.postMessage({ __nexusPreview: true, id: 't3', html:
        '<!DOCTYPE html><html><body><script>' +
        'parent.postMessage({ __csptest: true, name: "shell-loaded inline script", ok: true }, "*");' +
        '<\/script></body></html>' }, '*');
    }
  });
  setTimeout(function () {
    if (!shellReady) line('shell: loader page did not signal ready');
    if (document.getElementById('results').textContent.indexOf('shell-loaded inline script') === -1) {
      line('shell-loaded inline script: DID NOT RUN');
    }
  }, 6000);
})();
