/**
 * Range-capable static server over the KOTOR II game directory, plus a test page
 * that exercises the two access patterns GameFileSystem needs:
 *   - readFile()  : whole-file read (this is what throws NotReadableError today)
 *   - read()      : random access at (offset, length) -> HTTP Range
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\SteamLibrary\\steamapps\\common\\Knights of the Old Republic II';
const PORT = 8479;
const OUT = path.join(__dirname, 'result.json');

const PAGE = `<!doctype html><html><body style="font:14px monospace;padding:24px">
<h2>asset read test</h2><pre id="out">running…</pre>
<script>
const log = [];
const t = async (label, fn) => {
  const t0 = performance.now();
  try { const v = await fn(); log.push({ label, ms: Math.round(performance.now()-t0), ok: true, ...v }); }
  catch (e) { log.push({ label, ms: Math.round(performance.now()-t0), ok: false, error: String(e) }); }
  document.getElementById('out').textContent = JSON.stringify(log, null, 2);
};
(async () => {
  // whole-file read of the file that fails under File System Access
  await t('dialog.tlk full', async () => {
    const r = await fetch('/file/dialog.tlk');
    const b = await r.arrayBuffer();
    return { bytes: b.byteLength, status: r.status };
  });
  // random access, the pattern GameFileSystem.read() actually uses
  await t('dialog.tlk range 0-4095', async () => {
    const r = await fetch('/file/dialog.tlk', { headers: { Range: 'bytes=0-4095' } });
    const b = await r.arrayBuffer();
    return { bytes: b.byteLength, status: r.status, hdr: r.headers.get('content-range') };
  });
  await t('chitin.key full', async () => {
    const r = await fetch('/file/chitin.key');
    const b = await r.arrayBuffer();
    return { bytes: b.byteLength, status: r.status };
  });
  // a big BIF, the largest thing the engine touches
  await t('data/models.bif range mid-file', async () => {
    const r = await fetch('/file/data/models.bif', { headers: { Range: 'bytes=10000000-10032767' } });
    const b = await r.arrayBuffer();
    return { bytes: b.byteLength, status: r.status, hdr: r.headers.get('content-range') };
  });
  await fetch('/result', { method: 'POST', body: JSON.stringify(log) });
})();
</script></body></html>`;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { fs.writeFileSync(OUT, body); console.log(body); res.end('ok'); });
    return;
  }
  if (req.url.startsWith('/file/')) {
    const rel = decodeURIComponent(req.url.slice(6));
    const full = path.join(ROOT, rel);
    if (!full.startsWith(ROOT)) { res.statusCode = 403; return res.end('nope'); }
    let st;
    try { st = fs.statSync(full); } catch (e) { res.statusCode = 404; return res.end('not found'); }

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Accept-Ranges', 'bytes');
      return fs.createReadStream(full, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', st.size);
    res.setHeader('Accept-Ranges', 'bytes');
    return fs.createReadStream(full).pipe(res);
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(PAGE);
}).listen(PORT, () => console.log('asset server on ' + PORT));
