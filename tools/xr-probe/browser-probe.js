/**
 * Browser-side WebXR probe.
 *
 * `tools/xr-probe` (the Electron app) can write its own result file. A browser
 * page cannot, so this serves the same check over localhost and collects the
 * answers posted back. Results append to results.jsonl, one JSON object per run,
 * tagged with the ?label= query parameter.
 *
 *   node tools/xr-probe/browser-probe.js
 *   chrome.exe --user-data-dir=<tmp> --no-first-run "http://localhost:8478/?label=chrome"
 *
 * Use a fresh --user-data-dir every time. A Chromium process caches the "no XR
 * device" answer from browser startup, so opening a new window in an
 * already-running browser reports immersive-vr: false no matter what the runtime
 * is doing. That confound produced two wrong readings during Phase 0.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8478;
const OUT = path.join(__dirname, 'results.jsonl');

const PAGE = `<!doctype html><html><body style="font:16px monospace;padding:24px">
<h2>WebXR probe</h2><pre id="out">running…</pre>
<script>
(async () => {
  const label = new URLSearchParams(location.search).get('label') || 'unlabelled';
  const out = { label, hasNavigatorXR: typeof navigator.xr !== 'undefined',
                immersiveVR: null, inline: null, xrError: null, ua: navigator.userAgent };
  try {
    if (navigator.xr) {
      out.immersiveVR = await navigator.xr.isSessionSupported('immersive-vr');
      out.inline = await navigator.xr.isSessionSupported('inline');
    }
  } catch (e) { out.xrError = String(e); }
  document.getElementById('out').textContent = JSON.stringify(out, null, 2);
  await fetch('/result', { method: 'POST', body: JSON.stringify(out) });
})();
</script></body></html>`;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      fs.appendFileSync(OUT, body + '\n');
      console.log(body);
      res.end('ok');
    });
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(PAGE);
}).listen(PORT, () => console.log('WebXR probe server on http://localhost:' + PORT));
