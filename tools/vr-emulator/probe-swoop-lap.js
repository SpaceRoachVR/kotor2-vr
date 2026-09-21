const path = require('path');
const REPO = 'C:/Users/allen/source/repos/kotor2-vr-parity';
const { VrHarness } = require(path.join(REPO, 'tools/vr-emulator/harness'));
const { bootEngine } = require(path.join(REPO, 'tools/vr-emulator/module-sweep'));

const SCRIPT = `(async () => {
  const K = window.KotOR, GS = K.GameState;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const safe = (fn, d) => { try { const v = fn(); return v === undefined ? d : v; } catch (e) { return d; } };
  GS.loadingModule = false;
  try { GS.MenuManager.ClearMenus(); } catch (e) {}
  const previous = GS.module;
  Promise.resolve(GS.LoadModule('211TEL')).catch(() => {});
  let deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    if (safe(() => GS.module && GS.module !== previous && !GS.loadingModule
      && GS.module.readyToProcessEvents === true && !!GS.module.area, false)) break;
    await sleep(500);
  }
  await sleep(6000);
  const mg = GS.module.area.miniGame, p = mg.player;
  const world = () => { p.container.updateMatrixWorld(true);
    const m = p.container.matrixWorld.elements; return [+m[12].toFixed(1), +m[13].toFixed(1)]; };

  // Hold the authored speed so a lap takes the authored time.
  const held = mg.movementPerSec;
  let wraps = 0, lastY = world()[1];
  const yMax = [];
  const startWall = 0;
  let simSeconds = 0;
  for (let i = 0; i < 7200; i++) {
    p.speed = held; p.speed_min = held; p.speed_max = held;
    p.requestAcceleration();
    GS.module.area.update(1 / 60);
    simSeconds += 1 / 60;
    const y = world()[1];
    if (y < lastY - 200) { wraps++; yMax.push(+lastY.toFixed(0)); }
    lastY = y;
    if (wraps >= 1) break;
  }
  return {
    movementPerSec: held,
    animationLength: safe(() => mg.tracks.find((t) => t.track === p.trackName).model
      .odysseyAnimationMap.get('track').length, null),
    secondsToCompleteCourse: +simSeconds.toFixed(1),
    wraps,
    courseEndY: yMax,
    finalWorld: world(),
  };
})()`;

async function main() {
  const i = process.argv.indexOf('--url');
  const harness = new VrHarness({ port: 9463 });
  try {
    await harness.launch(process.argv[i + 1]);
    await bootEngine(harness, () => {}, true);
    console.log(JSON.stringify(await harness.evaluate(SCRIPT, { timeoutMs: 600000 }), null, 1));
  } finally { await harness.close().catch(() => {}); }
}
main().catch((e) => { console.error(e); process.exit(1); });
