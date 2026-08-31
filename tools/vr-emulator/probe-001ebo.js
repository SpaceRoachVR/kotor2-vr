/**
 * Ad-hoc probe: why 25 of 43 placeables and all 11 doors in 001EBO report no
 * templateResRef, while the module itself loads correctly - every object has a
 * model, names resolve, 30 frames render.
 *
 * The GIT carries the TemplateResRef label and the loader reads it when the
 * field is present, so the question is which objects lack it and what those
 * objects have in common. Guessing from the file layout cannot answer that;
 * this reads the live objects.
 *
 *   node tools/vr-emulator/probe-001ebo.js --url "<launch url>"
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

  const harness = new VrHarness({ port: 9447 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      await clickButtonByText(harness, 'OK');
    } catch { /* already accepted */ }
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await harness.waitFor(`!!window.KotOR.GameState.MenuManager.MainMenu`, 240_000);

    // The sweep reaches 001EBO by transitioning out of the save's module, not
    // from a cold main menu. That distinction turned out to matter, so it is
    // reproducible from here rather than only inside the sweep.
    if (argv.includes('--via-save')) {
      await harness.evaluate(`(async () => {
        await window.KotOR.SaveGame.GetSaveGames();
        const gs = window.KotOR.GameState;
        gs.MenuManager.ClearMenus();
        if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
        Promise.resolve(window.KotOR.SaveGame.saves[0].load()).catch(() => undefined);
        return true;
      })()`, { timeoutMs: 300000 });
      await harness.waitFor(`(() => {
        const gs = window.KotOR.GameState;
        const p = window.KotOR.PartyManager && window.KotOR.PartyManager.Player;
        return !!(gs && gs.module && p && p.position && Number.isFinite(p.position.x));
      })()`, 300_000, 3000);
    }

    // Identity, not existence: the outgoing module is still resident with a live
    // area and readyToProcessEvents already true, so "a module is ready" is true
    // before this load even starts. Waiting on that measured the previous module
    // mid-teardown and reported an area with zero of everything - the same
    // mistake the sweep's own probe documents. Stash the outgoing module and
    // require a different one that actually landed as 001EBO.
    await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      window.__probePrevModule = gs.module;
      gs.loadingModule = false;
      gs.MenuManager.ClearMenus();
      gs.LoadModule('001EBO');
      return true;
    })()`);

    await harness.waitFor(`(() => {
      const gs = window.KotOR.GameState;
      const m = gs.module;
      return !!m && m !== window.__probePrevModule && gs.loadingModule === false
        && m.readyToProcessEvents === true && !!m.area
        && String(m.filename || '').toUpperCase() === '001EBO';
    })()`, 300_000);
    const settleArg = argv.indexOf('--settle');
    const settleMs = settleArg > -1 ? Number(argv[settleArg + 1]) : 8000;
    await new Promise((r) => setTimeout(r, settleMs));

    const report = await harness.evaluate(`(() => {
      const area = window.KotOR.GameState.module.area;
      const describe = (list, label) => (list || []).map((o) => ({
        kind: label,
        name: (() => { try { return o.getName(); } catch { return '?'; } })(),
        tag: o.tag || null,
        templateResRef: o.templateResRef || null,
        // What the object was actually built from: a GIT instance struct or a
        // blueprint loaded from the module's static archive.
        templateType: o.template && o.template.RootNode
          ? (o.template.RootNode.hasField('TemplateResRef') ? 'has-field' : 'no-field')
          : 'no-template',
        hasModel: !!o.model,
      }));
      const all = [].concat(
        describe(area.placeables, 'placeable'),
        describe(area.doors, 'door'),
        describe(area.creatures, 'creature'),
      );
      const withRef = all.filter((o) => o.templateResRef);
      const without = all.filter((o) => !o.templateResRef);
      const tally = (rows) => rows.reduce((acc, r) => {
        acc[r.templateType] = (acc[r.templateType] || 0) + 1; return acc;
      }, {});
      return {
        settleMs: ${settleMs},
        total: all.length,
        withRefCount: withRef.length,
        withoutRefCount: without.length,
        withRefTemplateTypes: tally(withRef),
        withoutTemplateTypes: tally(without),
        sampleWith: withRef.slice(0, 5),
        sampleWithout: without.slice(0, 8),
      };
    })()`, { timeoutMs: 90000 });

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
