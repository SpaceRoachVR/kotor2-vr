/**
 * Regression checks over a collected metrics object.
 *
 * Every check states what it protects and why the value is what it is, because
 * a bare threshold rots: the next person needs to know whether a number moving
 * is a regression or a legitimate change to re-baseline.
 *
 * Thresholds are deliberately ranges, not equalities. This runs a real engine
 * against a real install through a browser, so anything derived from timing or
 * physics varies run to run.
 */

/** @typedef {{ id: string, describe: string, run: (m: any) => { ok: boolean, detail: string } }} VrCheck */

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** @type {VrCheck[]} */
const CHECKS = [
  {
    id: 'device-installed',
    describe: 'IWER runtime installs before page scripts',
    run: (m) => ({
      ok: m.device?.ready === true,
      detail: `ready=${m.device?.ready} device=${m.device?.name}`,
    }),
  },
  {
    id: 'immersive-supported',
    describe: 'engine sees an immersive-vr capable runtime',
    // Guards the forceInstall requirement: Chrome exposes a native XRSystem
    // even with no headset, and without forceInstall this silently answers
    // false and the Enter VR button comes up disabled.
    run: (m) => ({ ok: m.immersiveSupported === true, detail: `supported=${m.immersiveSupported}` }),
  },
  {
    id: 'reaches-ingame',
    describe: 'save loads and the engine reaches INGAME mode',
    // Engine mode follows the current menu. If this drops to 0, gameplay input
    // is suppressed and the locomotion/recenter checks below are meaningless
    // rather than failing honestly.
    run: (m) => ({ ok: m.engineMode === 1, detail: `EngineMode=${m.engineMode} (1=INGAME)` }),
  },
  {
    id: 'session-enters',
    describe: 'immersive session starts with both controllers',
    run: (m) => ({
      ok: m.session?.active === true && m.session?.inputSources === 2,
      detail: `active=${m.session?.active} inputSources=${m.session?.inputSources} ` +
        `profiles=${(m.session?.profiles ?? []).join(',')}`,
    }),
  },
  {
    id: 'xr-frames-delivered',
    describe: 'XR frame loop delivers frames',
    run: (m) => {
      const frames = number(m.xrFrames);
      return { ok: frames !== null && frames >= 60, detail: `frames=${frames} (want >= 60 of 90)` };
    },
  },
  {
    id: 'gameplay-input-eligible',
    describe: 'gameplay input is eligible when the interaction checks run',
    // Without this, a suppressed-input run reports recenter and locomotion as
    // broken behaviour rather than as an untested precondition.
    run: (m) => ({
      ok: m.inputEligibility?.mode === 1 && m.inputEligibility?.isPresenting === true,
      detail: `EngineMode=${m.inputEligibility?.mode} presenting=${m.inputEligibility?.isPresenting} ` +
        `state=${m.inputEligibility?.state}`,
    }),
  },
  {
    id: 'recenter-cancels-head-yaw',
    describe: 'a long press recentres exactly against the physical head yaw',
    // The whole point of ROADMAP 4.6: yawOffset must absorb the head yaw, so
    // physical forward becomes game forward. Tolerance is loose enough for
    // frame timing but tight enough to catch a sign flip or a halved angle.
    run: (m) => {
      const after = number(m.recenter?.yawOffsetAfter);
      const expected = -(m.recenter?.headYawRadians ?? 0);
      const ok = after !== null && Math.abs(after - expected) < 0.05;
      return { ok, detail: `yawOffset ${m.recenter?.yawOffsetBefore} -> ${after} (want ~${expected.toFixed(3)})` };
    },
  },
  {
    id: 'recenter-tap-ignored',
    describe: 'a stray thumbstick tap does not recentre',
    // Recenter shares the dominant stick with Turn. If this fails, an
    // accidental click mid-turn is a comfort event.
    run: (m) => ({ ok: m.recenterTapIgnored === true, detail: `tapIgnored=${m.recenterTapIgnored}` }),
  },
  {
    id: 'locomotion-moves-avatar',
    describe: 'thumbstick locomotion moves the player through the world',
    run: (m) => {
      const moved = number(m.locomotion?.metresMoved);
      return { ok: moved !== null && moved >= 3, detail: `moved=${moved?.toFixed(2)}m over 4s (want >= 3)` };
    },
  },
  {
    id: 'wheel-icons-resolve',
    describe: 'every action wheel icon resolves to a real texture',
    // Every wheel icon was a wrong resref until 2026-08-22; each failure logs
    // and draws a generic fallback shape.
    run: (m) => ({
      ok: (m.wheel?.iconLoadFailures ?? 0) === 0 && (m.console?.iconLoadFailures ?? 0) === 0,
      detail: `wheelFailures=${m.wheel?.iconLoadFailures} totalFailures=${m.console?.iconLoadFailures}`,
    }),
  },
  {
    id: 'startup-trace-is-one-shot',
    describe: 'the startup trace stops after the first frame',
    // It once logged two lines per frame for an entire session because its
    // terminator sat on a path an early return skipped.
    run: (m) => {
      const lines = number(m.console?.startupTraceLines);
      return { ok: lines !== null && lines <= 12, detail: `startup-stage lines=${lines} (want <= 12, one frame)` };
    },
  },
  {
    id: 'no-serialize-warning-flood',
    describe: 'nothing serialises THREE textures during logging',
    // The harness once caused 29,812 of 30,209 console lines this way, inside
    // the loop being measured.
    run: (m) => ({
      ok: (m.console?.serializeWarnings ?? 0) === 0,
      detail: `serializeWarnings=${m.console?.serializeWarnings}`,
    }),
  },
  {
    id: 'console-volume-sane',
    describe: 'console output stays low enough to read',
    // Not a hard correctness bound — a canary for per-frame logging creeping
    // back into the XR loop.
    run: (m) => {
      const lines = number(m.console?.totalLines);
      return { ok: lines !== null && lines < 2000, detail: `lines=${lines} (want < 2000)` };
    },
  },
  {
    id: 'texture-resolution-baseline',
    describe: 'missing textures stay at or below the known-absent set',
    // 14 distinct resrefs are genuinely absent from this install (several are
    // K1 names). Anything above that is a new loader regression, and anything
    // below is an improvement worth re-baselining.
    run: (m) => {
      const distinct = number(m.textures?.distinctFailing);
      return {
        ok: distinct !== null && distinct <= 14,
        detail: `distinctFailing=${distinct} (want <= 14 known-absent) missing=${m.textures?.missing} of ${m.textures?.total}`,
      };
    },
  },
  {
    id: 'gui-pack-textures-resolve',
    describe: 'GUI-pack textures resolve under non-GUI semantics',
    // The six that exposed the search-order bug. `gui_galxy_*` and `gui_sun_1`
    // are the galaxy map's own particles (ROADMAP 1.9).
    run: (m) => {
      const failing = new Set((m.textures?.failing ?? []).map((f) => f.resref));
      const regressed = ['innermenu', 'loadscreen3', 'gui_galxy_1', 'gui_galxy_2', 'gui_galxy_3', 'gui_sun_1']
        .filter((name) => failing.has(name));
      return { ok: regressed.length === 0, detail: regressed.length ? `regressed: ${regressed.join(', ')}` : 'all six resolve' };
    },
  },
  {
    id: 'wheel-menu-routes-open',
    describe: 'every menu the action wheel can open does so without throwing',
    // MenuMap touched a control TSL's GUI lacks, and GUIFeatItem dereferenced a
    // feats.2da padding hole. Both built fine and threw on use, so only opening
    // them catches it.
    run: (m) => {
      const routes = m.menuRoutes ?? {};
      const broken = Object.entries(routes).filter(([, status]) => status !== 'ok');
      return {
        ok: Object.keys(routes).length > 0 && broken.length === 0,
        detail: broken.length
          ? broken.map(([name, status]) => `${name} ${status}`).join('; ')
          : `${Object.keys(routes).length} routes open cleanly`,
      };
    },
  },
  {
    id: 'no-page-exceptions',
    describe: 'no uncaught page exceptions',
    run: (m) => ({
      ok: (m.pageErrors?.length ?? 0) === 0,
      detail: `pageErrors=${m.pageErrors?.length}${m.pageErrors?.length ? `: ${m.pageErrors[0].slice(0, 120)}` : ''}`,
    }),
  },
  {
    id: 'console-errors-baseline',
    describe: 'console errors stay at or below the known set',
    // 36 `Invalid Item Property Sub Type` (ROADMAP 1.3b) plus a handful of
    // expected 404 probes (1.11). Headroom above that, so a genuinely new
    // error class trips this.
    run: (m) => {
      const total = number(m.console?.errorTotal);
      return { ok: total !== null && total <= 60, detail: `errors=${total} (want <= 60 known) kinds=${Object.keys(m.console?.errorsByKind ?? {}).length}` };
    },
  },
];

function runChecks(metrics) {
  return CHECKS.map((check) => {
    let result;
    try {
      result = check.run(metrics);
    } catch (error) {
      result = { ok: false, detail: `check threw: ${error.message}` };
    }
    return { id: check.id, describe: check.describe, ...result };
  });
}

module.exports = { CHECKS, runChecks };
