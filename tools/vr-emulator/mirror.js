/**
 * Turns the desktop mirror of the headset view on or off in a running
 * `npm run vr:play` session, without reloading the page.
 *
 *   node tools/vr-emulator/mirror.js on [--fps 20] [--eye left|right] [--zoom 1.2] [--port 9422]
 *   node tools/vr-emulator/mirror.js off
 *   node tools/vr-emulator/mirror.js status
 *
 * The mirror draws the scene a second time from one eye, so it costs frame
 * time while on (see src/vr/runtime/VRDesktopMirror.ts). Screenshots
 * (screenshot.js) work with it off.
 */
const { CdpSession, findPageTarget } = require('./cdp');

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : fallback; };
const PORT = Number(opt('--port', process.env.KOTOR2VR_CDP_PORT || 9422));
const command = (argv[0] || 'status').toLowerCase();

async function main() {
  if (!['on', 'off', 'status'].includes(command)) throw new Error('usage: mirror.js on|off|status [--fps N] [--eye left|right] [--zoom N]');
  const settings = {};
  if (command !== 'status') settings.enabled = command === 'on';
  if (opt('--fps', null)) settings.fps = Number(opt('--fps'));
  if (opt('--eye', null)) settings.eye = opt('--eye') === 'right' ? 'right' : 'left';
  if (opt('--zoom', null)) settings.zoom = Math.max(1, Number(opt('--zoom')));

  const target = await findPageTarget(PORT, (u) => /\/game\//.test(u));
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    const result = await cdp.evaluate(
      `(() => {
        const m = window.VRSpike && window.VRSpike.desktopMirror;
        if (!m || typeof m.render !== 'function') throw new Error('this build has no spectator mirror');
        Object.assign(m, ${JSON.stringify(settings)});
        return { enabled: m.enabled, fps: m.fps, eye: m.eye, zoom: m.zoom, framesMirrored: m.framesMirrored,
          presenting: !!window.VRSpike.isPresenting };
      })()`,
    );
    console.log(JSON.stringify(result));
  } finally {
    cdp.close();
  }
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
