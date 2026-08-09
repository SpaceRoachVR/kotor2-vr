const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'result.json');
const write = (o) => { try { fs.writeFileSync(OUT, JSON.stringify(o, null, 2)); } catch (e) {} };

// Extra Chromium switches, passed as --sw=key=value or --sw=key
const applied = [];
for (const arg of process.argv) {
  if (!arg.startsWith('--sw=')) continue;
  const spec = arg.slice(5);
  const eq = spec.indexOf('=');
  if (eq > 0) app.commandLine.appendSwitch(spec.slice(0, eq), spec.slice(eq + 1));
  else app.commandLine.appendSwitch(spec);
  applied.push(spec);
}

process.on('uncaughtException', (e) => { write({ fatal: String((e && e.stack) || e) }); app.quit(); });

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 400, height: 300, show: false });
    await win.loadFile(path.join(__dirname, 'probe.html'));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const out = { hasNavigatorXR: typeof navigator.xr !== 'undefined', immersiveVR: null, inline: null, xrError: null };
      try {
        if (navigator.xr) {
          out.immersiveVR = await navigator.xr.isSessionSupported('immersive-vr');
          out.inline = await navigator.xr.isSessionSupported('inline');
        }
      } catch (e) { out.xrError = String(e); }
      return out;
    })()`);
    result.switches = applied;
    result.electron = process.versions.electron;
    write(result);
  } catch (e) {
    write({ fatal: String((e && e.stack) || e), switches: applied });
  }
  app.quit();
});
