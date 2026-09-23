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
  const out = {
    obstacles: mg.obstacles.length,
    withTemplate: mg.obstacles.filter((o) => !!o.template).length,
    withScripts: mg.obstacles.filter((o) => Object.keys(o.scripts || {}).some((k) => o.scripts[k])).length,
    radius: safe(() => mg.obstacles[0].sphere.radius, null),
  };

  // Count hits by instrumenting the player's handler.
  let hits = 0, hitNames = [];
  const original = p.onHitObstacle.bind(p);
  p.onHitObstacle = function (obstacle) {
    hits++;
    if (hitNames.length < 5) hitNames.push(safe(() => obstacle.layout.name, '?'));
    return original(obstacle);
  };

  // Drive the whole track from the start line and count what we strike.
  const world = () => { p.container.updateMatrixWorld(true);
    const m = p.container.matrixWorld.elements; return [m[12], m[13], m[14]]; };
  out.startWorld = world().map((n) => +n.toFixed(1));
  const reach = mg.obstacles.filter((o) => Math.abs(o.layout.position.x - out.startWorld[0]) <= 25).length;
  out.obstaclesNearStartLane = reach;
  p.speed_min = 60; p.speed_max = 200; p.accel_secs = 25;
  let frames = 0;
  for (let i = 0; i < 4000; i++) {
    p.requestAcceleration();
    GS.module.area.update(1 / 60);
    frames++;
    if (world()[1] > 6100) break;
  }
  out.framesDriven = frames;
  out.endWorld = world().map((n) => +n.toFixed(1));

  out.hits = hits;
  out.hitNames = hitNames;
  out.finalY = +p.track.position.y.toFixed(1);
  return out;
})()`;

async function main() {
  const i = process.argv.indexOf('--url');
  const harness = new VrHarness({ port: 9458 });
  try {
    await harness.launch(process.argv[i + 1]);
    await bootEngine(harness, () => {}, true);
    console.log(JSON.stringify(await harness.evaluate(SCRIPT, { timeoutMs: 600000 }), null, 1));
  } finally { await harness.close().catch(() => {}); }
}
main().catch((e) => { console.error(e); process.exit(1); });
