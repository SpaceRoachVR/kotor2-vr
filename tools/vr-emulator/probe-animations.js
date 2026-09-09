/**
 * Ad-hoc probe: what animations.2da actually contains, by row index.
 *
 * `animationConstantToAnimation` maps a creature animation constant to a row of
 * animations.2da by literal index — `return animations2DA.rows[78]`. 27 of the
 * 135 constants in ModuleCreatureAnimState have no case at all, so they resolve
 * to undefined and the creature reports "Animation Missing" and falls back to
 * PAUSE. Adding the missing cases needs the real row indices; guessing them puts
 * the wrong animation on screen, which is worse than none.
 *
 *   node tools/vr-emulator/probe-animations.js            # starts its own service
 *   node tools/vr-emulator/probe-animations.js --url "<launch url>"
 *
 * Writes the full table to evidence/animations-2da.json and prints the rows
 * whose names look like the constants that are missing.
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');


const EVIDENCE_DIR = path.join(__dirname, 'evidence');

const { startAssetService } = require('./asset-service');

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

async function main() {
  const argv = process.argv.slice(2);
  const urlFlag = argv.indexOf('--url');
  let service = null;
  let url = urlFlag > -1 ? argv[urlFlag + 1] : null;
  if (!url) {
    service = await startAssetService();
    url = service.url;
  }

  const harness = new VrHarness({ port: 9445 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      await clickButtonByText(harness, 'OK');
    } catch { /* already accepted */ }
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await harness.waitFor(`!!window.KotOR.GameState.MenuManager.MainMenu`, 240_000);

    const report = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      const table = gs.TwoDAManager.datatables.get('animations');
      if (!table) return { error: 'animations 2DA not loaded' };
      const columns = table.rows && table.rows[0] ? Object.keys(table.rows[0]) : [];
      const rows = [];
      for (let i = 0; i < table.RowCount; i++) {
        const row = table.rows[i];
        if (!row) { rows.push({ index: i, missing: true }); continue; }
        rows.push({
          index: i,
          name: row.name,
          looping: row.looping,
          fireforget: row.fireforget,
        });
      }
      return { rowCount: table.RowCount, columns, rows };
    })()`, { timeoutMs: 90000 });

    if (report.error) throw new Error(report.error);

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const out = path.join(EVIDENCE_DIR, 'animations-2da.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));

    console.log(`animations.2da: ${report.rowCount} rows, columns: ${report.columns.join(', ')}`);
    console.log(`full table -> ${path.relative(process.cwd(), out)}`);

    // The constants with no case in animationConstantToAnimation, by the name
    // each one plainly wants. Printing candidates rather than deciding here.
    const wanted = [
      'meditate', 'worship', 'kneel', 'attack', 'parry', 'deflect', 'castout',
      'wield', 'talk', 'damage', 'knockdown', 'dead', 'idle', 'walk', 'power',
      'critical', 'duel',
    ];
    console.log('\ncandidate rows by name:');
    for (const row of report.rows) {
      const name = String(row.name || '').toLowerCase();
      if (!name || name === '****') continue;
      if (wanted.some((w) => name.includes(w))) {
        console.log(`  [${String(row.index).padStart(3)}] ${row.name}  looping=${row.looping} fireforget=${row.fireforget}`);
      }
    }
  } finally {
    await harness.close();
    if (service) service.stop();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
