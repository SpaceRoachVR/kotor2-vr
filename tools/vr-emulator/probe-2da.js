/**
 * Ad-hoc probe: which 2DA tables and columns back the chargen descriptions.
 *
 * `LB_DESC` / `DESC_LBL` are declared on CharGenAbilities and CharGenFeats but
 * never written to, and the remaining-selections labels likewise — so the hover
 * descriptions and the feat count were never implemented rather than broken.
 * Implementing them needs the real data source: guessing TLK strrefs would put
 * arbitrary text on screen.
 *
 *   node tools/vr-emulator/probe-2da.js --url "<launch url>"
 */
const { VrHarness } = require('./harness');

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
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');

  const harness = new VrHarness({ port: 9443 });
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
      const tables = gs.TwoDAManager.datatables;
      const names = Array.from(tables.keys());
      const cols = (n) => { const t = tables.get(n); return t && t.rows && t.rows[0] ? Object.keys(t.rows[0]) : null; };
      const sample = (n, i) => { const t = tables.get(n); return t && t.rows ? t.rows[i] : null; };
      const tlk = (id) => { try { const s = gs.TLKManager.GetStringById(Number(id)); return s ? String(s.Value).slice(0, 90) : null; } catch { return null; } };

      const out = {
        candidateTables: names.filter(n => /abil|attrib|stat|skill|feat|class/i.test(n)).sort(),
        skillsColumns: cols('skills'),
        skillsRow0: sample('skills', 0),
        featsColumns: cols('feats'),
        featsRow0: sample('feats', 0),
        classesColumns: cols('classes'),
      };

      // Resolve the description strrefs the tables point at, to prove they are
      // real strings rather than padding.
      const s0 = sample('skills', 0);
      if (s0) {
        out.skillDescResolved = {};
        for (const k of Object.keys(s0)) {
          if (/desc/i.test(k)) out.skillDescResolved[k] = tlk(s0[k]);
        }
      }
      const f0 = sample('feats', 0);
      if (f0) {
        out.featDescResolved = {};
        for (const k of Object.keys(f0)) {
          if (/desc|name/i.test(k)) out.featDescResolved[k] = tlk(f0[k]);
        }
      }
      return out;
    })()`, { timeoutMs: 90000 });

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
