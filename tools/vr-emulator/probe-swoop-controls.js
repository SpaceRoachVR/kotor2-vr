/**
 * Drives the real VR input path against a live 211TEL race with synthetic
 * controller frames, so the controls are proven end to end rather than only
 * unit-tested. Usage: node swoop-probe.js --url "<launch url>"
 */
const path = require('path');
const REPO = 'C:/Users/allen/source/repos/kotor2-vr-parity';
const { VrHarness } = require(path.join(REPO, 'tools/vr-emulator/harness'));
const { bootEngine } = require(path.join(REPO, 'tools/vr-emulator/module-sweep'));

const SCRIPT = `(async () => {
  const K = window.KotOR, GS = K.GameState;
  const THREE = K.THREE || window.THREE;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const safe = (fn, d) => { try { const v = fn(); return v === undefined ? d : v; } catch (e) { return d; } };

  GS.loadingModule = false;
  try { GS.MenuManager.ClearMenus(); } catch (e) {}
  const previous = GS.module;
  let threw = null;
  Promise.resolve(GS.LoadModule('211TEL')).catch((e) => { threw = String(e && e.stack || e); });
  let deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    if (threw) return { stage: 'load', error: threw };
    if (safe(() => GS.module && GS.module !== previous && !GS.loadingModule
      && GS.module.readyToProcessEvents === true && !!GS.module.area, false)) break;
    await sleep(500);
  }
  await sleep(7000);

  const mg = GS.module.area.miniGame, p = mg.player;
  const C = K.VRMiniGameInputController;
  if (!C) return { error: 'no controller' };
  C.reset();

  const btn = (v) => ({ pressed: v >= 0.5, touched: v > 0, value: v });
  const pose = (x, y, z) => ({ position: new THREE.Vector3(x, y, z),
    orientation: new THREE.Quaternion(), linearVelocity: null, angularVelocity: null,
    trackingState: 'tracked' });
  // Buttons keyed by index, exactly as XRInputFrameBuilder writes them.
  const hand = (role, x, y, o) => {
    o = o || {};
    const pp = pose(x, y, -0.3);
    return { hand: role, pose: pp, targetRayPose: pp,
      buttons: { '0': btn(o.trigger || 0), '1': btn(o.squeeze || 0), '4': btn(o.face || 0) },
      axes: [0, 0, 0, o.stickY || 0], interactionProfile: 'oculus-touch' };
  };
  let clock = 0;
  const frame = (hands) => { clock += 16; return { timestamp: clock,
    head: pose(0, 1.6, 0), hands: hands, activeInteractionProfiles: ['oculus-touch'] }; };

  const lateral = () => +p.track.position.x.toFixed(2);
  const out = { gearAtStart: safe(() => GS.GlobalVariableManager.GetGlobalNumber('MIN_RACE_GEAR'), null) };

  // The rider holds with a biased posture: right hand 12cm higher than left.
  const RY_BIAS = 0.12;
  const rest = (o) => ({ left: hand('left', -0.24, 1.15, o && o.l),
    right: hand('right', 0.24, 1.15 + RY_BIAS, o && o.r) });

  // 1. Throttle held: the neutral is captured here, and the bike accelerates.
  for (let i = 0; i < 60; i++) { C.update(frame(rest({ r: { trigger: 1 } }))); GS.module.area.update(1 / 60); }
  out.speedAfterThrottle = +p.speed.toFixed(1);
  out.acceleratingFlag = p.isAccelerating();
  out.lateralWhileRestingPosture = lateral();

  // 2. Release the throttle: speed must fall back, not hold the ceiling.
  const peak = p.speed;
  for (let i = 0; i < 90; i++) { C.update(frame(rest())); GS.module.area.update(1 / 60); }
  out.speedAfterRelease = +p.speed.toFixed(1);
  out.speedFellOnRelease = p.speed < peak - 0.5;
  out.speedFloor = +p.speed_min.toFixed(1);

  // 3. Steering, measured from the biased rest posture, must go both ways.
  const steerFor = (dy) => {
    const before = lateral();
    for (let i = 0; i < 30; i++) {
      C.update(frame({ left: hand('left', -0.24, 1.15 - dy), right: hand('right', 0.24, 1.15 + RY_BIAS + dy) }));
      GS.module.area.update(1 / 60);
    }
    return +(lateral() - before).toFixed(2);
  };
  out.driftHoldingRest = steerFor(0);
  out.movedRight = steerFor(0.12);
  out.movedLeft = steerFor(-0.12);

  // 4. Jump on a face button, from the right hand alone.
  p.jumpVelcolity = 0;
  C.update(frame({ right: hand('right', 0.24, 1.27, { face: 1 }) }));
  out.jumpFromRightFaceButton = p.jumpVelcolity;
  p.jumpVelcolity = 0;
  C.update(frame({ right: hand('right', 0.24, 1.27, { face: 1 }) }));
  out.jumpRepeatsWhileHeld = p.jumpVelcolity;

  // 5. The tunnel keeps the bike on the track.
  out.tunnel = { pos: safe(() => +p.tunnel.pos.x.toFixed(1), null),
    neg: safe(() => +p.tunnel.neg.x.toFixed(1), null) };
  p.track.position.x = 0;
  for (let i = 0; i < 400; i++) {
    C.update(frame({ left: hand('left', -0.24, 0.9), right: hand('right', 0.24, 1.6) }));
    GS.module.area.update(1 / 60);
  }
  out.lateralAfterHardRight = lateral();
  out.heldInsideTunnel = safe(() => p.track.position.x <= p.tunnel.pos.x + 0.01, null);

  out.consoleErrors = (window.__probeErrors || []).slice(-3);
  return out;
})()`;

async function main() {
  const i = process.argv.indexOf('--url');
  const url = i > -1 ? process.argv[i + 1] : null;
  if (!url) throw new Error('pass --url');
  const harness = new VrHarness({ port: 9456 });
  try {
    await harness.launch(url);
    await bootEngine(harness, () => {}, true);
    await harness.evaluate(`(() => { window.__probeErrors = []; const e = console.error;
      console.error = function(){ window.__probeErrors.push(Array.from(arguments).map(String).join(' ').slice(0,160));
      return e.apply(console, arguments); }; return true; })()`);
    console.log(JSON.stringify(await harness.evaluate(SCRIPT, { timeoutMs: 600000 }), null, 1));
  } finally {
    await harness.close().catch(() => {});
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
