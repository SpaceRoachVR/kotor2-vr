/**
 * Records a real headset ride of the swoop over CDP, so a failed ride is
 * explained by data rather than by description.
 *
 *   npm run vr:play            (in one terminal, then enter VR and the race)
 *   node tools/vr-emulator/capture-swoop-ride.js [--out <file.jsonl>] [--port 9422]
 *
 * Attaches to the running game page WITHOUT reloading it, installs a sampler
 * inside the page that snapshots the live input frame, head pose, seat pose
 * and bike state every frame the minigame controller runs, and drains those
 * samples into a JSONL file every 250ms. Race events (obstacle, pad, mine,
 * wall, jump, land, gear, lap) are recorded as they happen, together with
 * console errors and exceptions. Ctrl+C stops it; the file is complete at
 * every point in time.
 *
 * Why in-page sampling rather than polling: the interesting failures are
 * one-frame events (a hand dropping out of the frame, a spurious steer), and a
 * 250ms poll would miss them. The sampler wraps VRMiniGameInputController.update
 * and keeps a ring buffer that the poll drains.
 */
const fs = require('fs');
const path = require('path');
const { CdpSession, waitForEndpoint, findPageTarget } = require('./cdp');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : fallback;
};
const PORT = Number(opt('--port', process.env.KOTOR2VR_CDP_PORT || 9422));
const OUT = opt('--out', path.join(__dirname, 'evidence',
  `swoop-ride-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));

// Runs inside the page. Everything it touches is guarded: a missing field
// reads as null rather than throwing out of the frame loop.
const INSTALL = `(() => {
  if (window.__swoopCapture) { window.__swoopCapture.frames.length = 0; return 'already-installed'; }
  const K = window.KotOR; const GS = K.GameState; const C = K.VRMiniGameInputController;
  if (!C || !GS) return 'no-controller';
  const cap = window.__swoopCapture = { frames: [], events: [], installedAt: performance.now(), frameCount: 0 };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? +v.toFixed(3) : null;
  const vec = (v) => v ? [num(v.x), num(v.y), num(v.z)] : null;
  const quat = (q) => q ? [num(q.x), num(q.y), num(q.z), num(q.w)] : null;
  const hand = (h) => {
    if (!h) return null;
    const b = h.buttons || {}; const out = {};
    for (const k of Object.keys(b)) out[k] = num(b[k].value);
    return { p: vec(h.pose && h.pose.position), q: quat(h.pose && h.pose.orientation),
      t: h.pose && h.pose.trackingState, b: out, a: (h.axes || []).map(num), prof: h.interactionProfile };
  };
  const player = () => { try { return GS.module.area.miniGame.player; } catch (e) { return null; } };
  const bike = () => {
    const p = player(); if (!p) return null;
    const c = p.container; const w = new K.THREE.Vector3(); try { c.getWorldPosition(w); } catch (e) {}
    return { world: vec(w), local: vec(c && c.position), speed: num(p.speed), speedMin: num(p.speed_min),
      speedMax: num(p.speed_max), accel: num(p.accel_secs), lateralAccel: num(p.accel_lateral_secs),
      lateralForce: num(p.lateralForce), lateralVelocity: num(p.lateralVelocity), jumpV: num(p.jumpVelcolity),
      invince: num(p.invince), hp: num(p.hit_points), laneCentre: num(p.laneCentre),
      tunnel: p.tunnel ? { pos: vec(p.tunnel.pos), neg: vec(p.tunnel.neg) } : null,
      gear: (() => { try { return GS.GlobalVariableManager.GetGlobalNumber('MIN_RACE_GEAR'); } catch (e) { return null; } })(),
      lap: (() => { try { return GS.GlobalVariableManager.GetGlobalNumber('MIN_RACE_LAP'); } catch (e) { return null; } })(),
      mode: GS.Mode, state: GS.State };
  };
  const seat = () => { try { const s = GS.getMiniGameSeat(); return s ? { p: vec(s.position), facing: num(s.facing) } : null; } catch (e) { return null; } };
  const rig = () => { try { const r = K.VRSpike.rig; return r ? { p: vec(r.position), q: quat(r.quaternion) } : null; } catch (e) { return null; } };
  const orig = C.update.bind(C);
  C.update = function (frame) {
    cap.frameCount++;
    try { orig(frame); } catch (e) { cap.events.push({ t: performance.now(), type: 'controller-exception', text: String(e && e.stack || e) }); }
    if (!frame) { if (cap.frameCount % 90 === 0) cap.frames.push({ t: performance.now(), noFrame: true, bike: bike() }); return; }
    try {
      const debug = C.debugState ? C.debugState() : null;
      cap.frames.push({ t: num(frame.timestamp), head: { p: vec(frame.head.position), q: quat(frame.head.orientation) },
        left: hand(frame.hands.left), right: hand(frame.hands.right), profiles: frame.activeInteractionProfiles,
        controller: debug, seat: seat(), rig: rig(), bike: bike() });
      if (cap.frames.length > 2000) cap.frames.splice(0, cap.frames.length - 2000);
    } catch (e) { cap.events.push({ t: performance.now(), type: 'sampler-exception', text: String(e && e.stack || e) }); }
  };
  // Race events, from the player's own hooks.
  const p0 = player();
  const wrap = (obj, name, type) => {
    if (!obj || typeof obj[name] !== 'function') return;
    const o = obj[name];
    obj[name] = function () { cap.events.push({ t: performance.now(), type, arg: (arguments[0] && (arguments[0].name || (arguments[0].layout && arguments[0].layout.name) || arguments[0].trackName)) || null, bike: bike() }); return o.apply(this, arguments); };
  };
  if (p0) { for (const [n, t] of [['onHitObstacle', 'obstacle'], ['onHitFollower', 'follower'], ['onBrake', 'jump-request'], ['onAccelerate', 'accelerate'], ['onTrackLoop', 'track-loop'], ['onDamaged', 'damaged']]) wrap(p0, n, t); }
  const ce = console.error; console.error = function () { cap.events.push({ t: performance.now(), type: 'console.error', text: Array.from(arguments).map(String).join(' ').slice(0, 400) }); return ce.apply(console, arguments); };
  window.addEventListener('error', (e) => cap.events.push({ t: performance.now(), type: 'window-error', text: String(e.message) }));
  return 'installed';
})()`;

const DRAIN = `(() => { const c = window.__swoopCapture; if (!c) return null;
  const out = { frames: c.frames.splice(0), events: c.events.splice(0), frameCount: c.frameCount }; return JSON.stringify(out); })()`;

const SNAPSHOT = `(() => {
  const K = window.KotOR, GS = K.GameState; const out = {};
  try { out.module = GS.module && GS.module.filename; out.mode = GS.Mode; out.presenting = K.VRSpike.isPresenting; } catch (e) {}
  try {
    const mg = GS.module.area.miniGame; const p = mg.player; const w = new K.THREE.Vector3();
    out.player = { models: p.models.map(m => m.name), visible: p.models.map(m => m.visible), track: p.trackName, sphere: p.sphere_radius };
    out.enemies = mg.enemies.map(e => { try { e.container.getWorldPosition(w); } catch (x) {} return { track: e.trackName, name: e.name, alive: e.alive, hp: e.hit_points, models: (e.models||[]).length, visible: (e.models||[]).map(m => m.visible), world: [w.x, w.y, w.z].map(v => +v.toFixed(1)), hasTrack: !!e.track, trackParent: !!(e.track && e.track.parent) }; });
    out.obstacles = mg.obstacles.length; out.obstacleScripts = mg.obstacles.filter(o => o.scripts && Object.keys(o.scripts).length).length;
    out.tracks = mg.tracks.map(t => ({ name: t.track, loaded: !!t.model, parent: !!(t.model && t.model.parent) }));
    // Which script routines the swoop calls are actually implemented.
    const names = ['SWMG_SetLateralAccelerationPerSecond','SWMG_GetPlayer','SWMG_GetIsInvulnerable','SWMG_GetPosition','SWMG_GetObjectName','SWMG_AdjustFollowerHitPoints','SWMG_RemoveAnimation','SWMG_GetPlayerOffset','SWMG_GetPlayerSpeed','SWMG_SetPlayerSpeed','SWMG_GetLastFollowerHit','SWMG_PlayAnimation','SWMG_GetHitPoints','SWMG_GetMaxHitPoints','SWMG_SetFollowerHitPoints','SWMG_StartInvulnerability','SWMG_SetSpeedBlurEffect','SWMG_SetPlayerTunnelPos','SWMG_SetPlayerMinSpeed','SWMG_SetPlayerMaxSpeed','SWMG_SetPlayerAccelerationPerSecond','SetGlobalFadeOut','StartNewModule','GetTimeMillisecond'];
    const actions = K.NWScriptDefK2 && K.NWScriptDefK2.Actions;
    if (actions) { const byName = {}; for (const k of Object.keys(actions)) byName[actions[k].name] = !!actions[k].action; out.unimplemented = names.filter(n => !byName[n]); }
    // Meshes with opacity 0 still rendering, and every model under the bike.
    const seeThrough = []; p.container.traverse(o => { if (o.isMesh && o.material && o.material.opacity === 0) seeThrough.push({ name: o.name, visible: o.visible, transparent: o.material.transparent, parent: o.parent && o.parent.name }); });
    out.opacityZeroMeshes = seeThrough;
  } catch (e) { out.error = String(e && e.stack || e); }
  return JSON.stringify(out);
})()`;

async function main() {
  await waitForEndpoint(PORT);
  const target = await findPageTarget(PORT, (u) => /\/game\//.test(u) || /index\.html/.test(u));
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out = fs.createWriteStream(OUT, { flags: 'a' });
  const write = (record) => out.write(JSON.stringify(record) + '\n');
  write({ kind: 'attach', url: target.url, at: new Date().toISOString() });
  console.log(`ATTACH ${target.url}\nWRITING ${OUT}`);

  cdp.on('Runtime.exceptionThrown', (params) => {
    const d = params.exceptionDetails || {};
    write({ kind: 'exception', text: (d.exception && d.exception.description) || d.text || 'unknown' });
  });

  let installed = false;
  let lastSnapshotMode = null;
  const tick = async () => {
    try {
      if (!installed) {
        const r = await cdp.evaluate(INSTALL, { timeoutMs: 5000 });
        if (r === 'installed' || r === 'already-installed') { installed = true; write({ kind: 'install', result: r }); console.log(`SAMPLER ${r}`); }
        else { return; }
      }
      const raw = await cdp.evaluate(DRAIN, { timeoutMs: 5000 });
      if (raw) {
        const batch = JSON.parse(raw);
        for (const f of batch.frames) write({ kind: 'frame', ...f });
        for (const e of batch.events) { write({ kind: 'event', ...e }); console.log(`EVENT ${e.type} ${e.arg || ''} ${e.text || ''}`.trim()); }
        const mode = batch.frames.length ? batch.frames[batch.frames.length - 1].bike && batch.frames[batch.frames.length - 1].bike.mode : null;
        if (mode !== null && mode !== lastSnapshotMode) {
          lastSnapshotMode = mode;
          const snap = await cdp.evaluate(SNAPSHOT, { timeoutMs: 10000 });
          write({ kind: 'snapshot', at: performance.now(), data: JSON.parse(snap) });
          console.log(`SNAPSHOT mode=${mode}`);
        }
      }
    } catch (error) {
      // The page navigated (module change) or reloaded; the sampler is gone.
      if (/Cannot find context|Execution context|Target closed|Inspected target/.test(String(error.message))) {
        installed = false;
        write({ kind: 'context-lost', text: String(error.message) });
      } else {
        write({ kind: 'capture-error', text: String(error.message) });
      }
    }
  };
  const timer = setInterval(tick, 250);
  const stop = () => { clearInterval(timer); out.end(() => { console.log(`\nSTOPPED ${OUT}`); process.exit(0); }); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Take one snapshot immediately, so a ride that never starts is still explained.
  try { const snap = await cdp.evaluate(SNAPSHOT, { timeoutMs: 10000 }); write({ kind: 'snapshot', at: 0, data: JSON.parse(snap) }); console.log('SNAPSHOT initial'); } catch (e) { write({ kind: 'capture-error', text: String(e.message) }); }
}

main().catch((error) => { console.error(error); process.exit(1); });
