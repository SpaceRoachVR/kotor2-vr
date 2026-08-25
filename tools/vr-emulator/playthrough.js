/**
 * Peragus prologue playthrough driver.
 *
 *   node tools/vr-emulator/playthrough.js                 # starts its own asset service
 *   node tools/vr-emulator/playthrough.js --url "<url>"   # reuse a running one
 *   node tools/vr-emulator/playthrough.js --prologue-route continue
 *   node tools/vr-emulator/playthrough.js --prologue-route skip # diagnostic only
 *
 * Drives a NEW GAME from character creation through the Peragus prologue under
 * an emulated Quest 3, inside a live immersive session, and reports the first
 * step that could not be completed.
 *
 * This is a blocker-finder, not a gate. `vr:check` asserts a fixed list of
 * behaviours; this one walks the actual game and stops where the game stops.
 *
 * Everything it touches goes through the real engine entry points — GUI control
 * click handlers, the action wheel model, the world-prompt routes — so a step
 * that passes here is evidence about the product rather than about the driver.
 * It is still not device evidence: see HEADSET-TEST-PLAN.md.
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');

const TIMEOUTS = {
  boot: 240_000,
  chargen: 120_000,
  moduleLoad: 300_000,
  session: 60_000,
  short: 30_000,
};

const PROLOGUE_ROUTES = Object.freeze(['continue', 'skip']);

function parseArgs(argv) {
  const args = {
    url: null,
    stopAt: Infinity,
    headless: true,
    resume: null,
    // A new run must preserve the authored T3-M4 opening. "skip" remains
    // available only for focused Peragus diagnosis and cannot be used as
    // end-to-end acceptance evidence.
    prologueRoute: 'continue',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--url') {
      const value = argv[++i];
      if (!value) throw new Error('--url requires a non-empty URL');
      args.url = value;
    } else if (argument === '--stop-at') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--stop-at requires a positive integer');
      args.stopAt = value;
    }
    else if (argv[i] === '--headed') args.headless = false;
    // Resume from a checkpoint this driver saved earlier, so a re-test does not
    // replay character creation every time.
    else if (argument === '--resume') {
      const value = argv[++i];
      if (!value) throw new Error('--resume requires a checkpoint name');
      args.resume = value;
    } else if (argument === '--prologue-route') {
      const value = String(argv[++i] || '').toLowerCase();
      if (!PROLOGUE_ROUTES.includes(value)) {
        throw new Error(`--prologue-route must be one of ${PROLOGUE_ROUTES.join(', ')}`);
      }
      args.prologueRoute = value;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return args;
}

const steps = [];
function step(name, run) {
  steps.push({ name, run });
}

/**
 * Engine-facing world state. Deliberately reports whether it located each
 * subject rather than only what it counted — a bare zero here has repeatedly
 * been misread in this project as a finding.
 */
const WORLD_STATE = `(() => {
  const K = window.KotOR || {};
  const gs = K.GameState;
  if (!gs) return { located: false, reason: 'no GameState' };
  const module = gs.module;
  const party = K.PartyManager;
  const player = party && party.party ? party.party[0] : null;
  const menus = gs.MenuManager;
  const foreground = menus && menus.GetForegroundMenu ? menus.GetForegroundMenu() : null;
  return {
    located: true,
    engineMode: gs.Mode,
    engineState: gs.State,
    // module.name is a CExoLocString ({RESREF, strings}), not a string. The
    // area's name is the usable identifier and is what matches "001EBO".
    moduleName: module && module.area && module.area.name ? String(module.area.name) : null,
    hasPlayer: !!player,
    playerName: player && player.getName ? String(player.getName() || '') : null,
    playerPosition: player && player.position
      ? { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2) }
      : null,
    playerHp: player ? player.getHP && player.getHP() : null,
    playerMaxHp: player ? player.getMaxHP && player.getMaxHP() : null,
    partySize: party && party.party ? party.party.length : null,
    foregroundMenu: foreground && foreground.constructor ? foreground.constructor.name : null,
    // The whole stack, not just the top: "MainMenu is foreground" and "MainMenu
    // is the only thing left" are different faults.
    menuStack: menus && Array.isArray(menus.activeMenus)
      ? menus.activeMenus.map((m) => m && m.constructor ? m.constructor.name : '?')
      : null,
    modalStack: menus && Array.isArray(menus.activeModals)
      ? menus.activeModals.map((m) => m && m.constructor ? m.constructor.name : '?')
      : null,
    inDialog: !!(menus && menus.InGameDialog && menus.InGameDialog.bVisible),
    // Gates every creature's updateActionQueue. LoadModule sets it; if a save
    // load does not, nothing in the world can act.
    readyToProcessEvents: module ? module.readyToProcessEvents === true : null,
    presenting: !!(K.VRSpike && K.VRSpike.isPresenting),
  };
})()`;

async function worldState(harness) {
  return harness.evaluate(WORLD_STATE);
}

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btn = Array.from(document.querySelectorAll('button')).filter(visible)
      .find(b => (b.textContent || '').trim().toLowerCase() === wanted);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) throw new Error(`No visible button labelled "${text}"`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

module.exports = {
  parseArgs,
  PROLOGUE_ROUTES,
  WORLD_STATE,
  worldState,
  clickButtonByText,
  steps,
  step,
  TIMEOUTS,
  EVIDENCE_DIR,
};

// ---------------------------------------------------------------------------
// The walkthrough
// ---------------------------------------------------------------------------

if (require.main === module) {
  const { runPlaythrough } = require('./playthrough-steps');
  const args = parseArgs(process.argv.slice(2));

  (async () => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    let service = null;
    let url = args.url;
    if (!url) {
      console.log('starting asset service…');
      service = await startAssetService();
      url = service.url;
      await waitForPort(8479).catch(() => undefined);
    }

    // The walkthrough is written as a sequence of resumable stages, and some
    // stages are written earlier in the file than the stage that reaches them
    // — their guards read args.resume, which only advances mid-pass. When a
    // pass ends by handing back a checkpoint rather than finishing, continue
    // from it instead of making the operator re-invoke by hand.
    //
    // Each pass gets its own browser: `boot` launches one on a fixed CDP port,
    // so reusing the harness across passes fails with "port already in use".
    // A fresh browser per pass also keeps one pass's renderer state out of the
    // next, which matters on a build with known memory growth.
    let report;
    const seen = new Set();
    let resume = args.resume;
    const passes = [];
    try {
      for (let pass = 1; ; pass += 1) {
        if (pass > 1) console.log(`
=== continuing from checkpoint "${resume}" (pass ${pass}) ===`);
        const harness = new VrHarness({ port: 9431, headless: args.headless });
        try {
          report = await runPlaythrough(harness, url, { ...args, resume });
        } finally {
          await harness.close().catch(() => undefined);
          // Chrome can linger a moment after exit before the OS releases the
          // listening socket.
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        passes.push({ pass, resume: resume ?? null, steps: report.steps.length, resumeNext: report.resumeNext ?? null });
        if (report.blocked || !report.resumeNext) break;
        if (seen.has(report.resumeNext) || pass >= 8) {
          report.blocked = {
            step: 'playthrough driver',
            error: `stage "${report.resumeNext}" did not advance the campaign after ${pass} pass(es)`,
          };
          break;
        }
        seen.add(report.resumeNext);
        resume = report.resumeNext;
      }
      report.passes = passes;
    } finally {
      if (service) service.stop();
    }

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'playthrough-report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(`\nreport -> tools/vr-emulator/evidence/playthrough-report.json`);
    process.exit(report.blocked ? 1 : 0);
  })().catch((error) => {
    console.error('\nPLAYTHROUGH ERROR:', error && error.stack || error);
    process.exit(1);
  });
}
