/**
 * Phase 1 diagnostic harvest.
 *
 * Several Phase 1 items are marked "blocked on user log". This loads a real
 * save under the emulator and collects the evidence they were waiting on,
 * without costing a playthrough.
 *
 *   node tools/vr-emulator/phase1-diagnostics.js "<launch-url>"
 *
 * Covers:
 *   1.2  missing textures  — via TextureLoader.getDiagnostics(), which records
 *        every resolution with status, semantic, module and searched sources.
 *        Better evidence than a console warning: it distinguishes genuinely
 *        absent from parsed-but-rejected.
 *   1.3b item properties   — the `Invalid Item Property Sub Type` errors, with
 *        the offending property names rather than just a count.
 *   1.4  equip             — reports the player's equipped slots so a later
 *        run can compare across a save/load.
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');

const outDir = path.join(__dirname, 'evidence');
const report = {};

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
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

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error('usage: phase1-diagnostics.js <launch-url>');
  fs.mkdirSync(outDir, { recursive: true });

  const harness = new VrHarness({ port: 9428 });
  await harness.launch(url);

  await harness.waitFor(
    `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
    90000
  );
  await clickButtonByText(harness, 'OK');
  await harness.waitFor(
    `document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`,
    240000, 2000
  );
  log('engine booted', 'ok');

  await harness.evaluate(`(async () => {
    const K = window.KotOR;
    await K.SaveGame.GetSaveGames();
    const gs = K.GameState;
    gs.MenuManager.ClearMenus();
    if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
    Promise.resolve(K.SaveGame.saves[0].load()).catch(() => undefined);
    return true;
  })()`, { timeoutMs: 120000 });

  await harness.waitFor(
    `(() => {
      const gs = window.KotOR.GameState;
      const p = window.KotOR.PartyManager && window.KotOR.PartyManager.Player;
      return !!(gs && gs.module && p && p.position && Number.isFinite(p.position.x));
    })()`,
    300000, 3000
  );
  // Let the area finish streaming textures before harvesting.
  await new Promise((r) => setTimeout(r, 25000));
  log('module loaded', 'ok');

  // --- 1.2 textures -------------------------------------------------------
  report.textures = await harness.evaluate(`(() => {
    const all = window.KotOR.TextureLoader.getDiagnostics();
    const byStatus = {};
    const byCode = {};
    const failing = new Map();
    for (const d of all) {
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      if (d.diagnosticCode) byCode[d.diagnosticCode] = (byCode[d.diagnosticCode] || 0) + 1;
      if (d.status === 'resolved') continue;
      const key = d.requestedResref + '|' + d.status;
      if (!failing.has(key)) {
        failing.set(key, {
          resref: d.requestedResref,
          status: d.status,
          code: d.diagnosticCode || null,
          semantic: d.semantic,
          module: d.activeModule || null,
          searched: (d.searchedSources || []).slice(0, 6),
          count: 0,
        });
      }
      failing.get(key).count++;
    }
    const rows = Array.from(failing.values()).sort((a, b) => b.count - a.count);
    return {
      totalDiagnostics: all.length,
      byStatus,
      byDiagnosticCode: byCode,
      distinctFailing: rows.length,
      // Full list goes to the JSON report; keep the console readable.
      worst: rows.slice(0, 40),
    };
  })()`);
  log('1.2 texture resolution', {
    totalDiagnostics: report.textures.totalDiagnostics,
    byStatus: report.textures.byStatus,
    byDiagnosticCode: report.textures.byDiagnosticCode,
    distinctFailing: report.textures.distinctFailing,
    worst: report.textures.worst.slice(0, 15),
  });

  // --- 1.3b item properties ----------------------------------------------
  report.itemProperties = await harness.evaluate(`(() => {
    const lines = window.__xrHarness.log
      .filter(e => /Invalid Item Property/.test(e.text))
      .map(e => e.text);
    const counts = {};
    for (const line of lines) counts[line] = (counts[line] || 0) + 1;
    return { total: lines.length, distinct: Object.keys(counts).length, counts };
  })()`);
  log('1.3b item properties', report.itemProperties);

  // --- 1.4 equipment ------------------------------------------------------
  report.equipment = await harness.evaluate(`(() => {
    const p = window.KotOR.PartyManager.Player;
    if (!p || !p.equipment) return { error: 'no player equipment' };
    const out = {};
    for (const slot of Object.keys(p.equipment)) {
      const item = p.equipment[slot];
      out[slot] = item ? (item.getName ? item.getName() : String(item.id)) : null;
    }
    return out;
  })()`);
  log('1.4 equipped slots', report.equipment);

  report.console = await harness.evaluate(`(() => {
    const log = window.__xrHarness.log;
    const errors = {};
    for (const e of log) {
      if (e.level !== 'error') continue;
      const key = e.text.split('\\n')[0].slice(0, 160);
      errors[key] = (errors[key] || 0) + 1;
    }
    return { totalLines: log.length, errorsByKind: errors };
  })()`);
  log('console errors by kind', report.console);

  fs.writeFileSync(
    path.join(outDir, 'phase1-diagnostics.json'),
    JSON.stringify(report, null, 2)
  );
  console.log('\nfull report -> tools/vr-emulator/evidence/phase1-diagnostics.json');
  await harness.close();
})().catch((error) => {
  console.error('\nPHASE1 DIAGNOSTICS ERROR:', error.message);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'phase1-diagnostics.json'), JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
