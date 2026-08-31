/**
 * Ad-hoc probe: what a module's area actually contains, loaded cold versus
 * reached the way the sweep reaches it (transitioning out of the save's
 * module). Written for 001EBO's templateResRef question; `--module` generalises
 * it, because "cold differs from transitioned" turned out to be the interesting
 * axis for more than one defect.
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
  const moduleArg = argv.indexOf('--module');
  const MODULE = moduleArg > -1 ? String(argv[moduleArg + 1]).toUpperCase() : '001EBO';

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
    // Who empties the area? Reasoning about call order got this wrong twice, so
    // record the stack at the moment dispose actually runs.
    if (argv.includes('--trace-dispose')) {
      await harness.evaluate(`(() => {
        const K = window.KotOR;
        const proto = K.ModuleArea && K.ModuleArea.prototype;
        if (!proto || proto.__disposeTraced) return 'unavailable';
        const original = proto.dispose;
        window.__disposeTraces = [];
        proto.dispose = function () {
          window.__disposeTraces.push({
            at: Date.now(),
            areaName: String(this.name || ''),
            module: String(((window.KotOR.GameState || {}).module || {}).filename || ''),
            rooms: this.rooms ? this.rooms.length : null,
            stack: new Error('dispose').stack,
          });
          return original.apply(this, arguments);
        };
        proto.__disposeTraced = true;
        return 'traced';
      })()`);
    }

    if (argv.includes('--trace-loads')) {
      await harness.evaluate(`(() => {
        const GS = window.KotOR.GameState;
        if (GS.__loadTraced) return 'already';
        const original = GS.LoadModule.bind(GS);
        window.__loadCalls = [];
        GS.LoadModule = function (name) {
          window.__loadCalls.push({
            at: Date.now(),
            name: String(name),
            current: String((GS.module || {}).filename || ''),
            loadingModule: !!GS.loadingModule,
            stack: String(new Error('LoadModule').stack || ''),
          });
          return original.apply(GS, arguments);
        };
        GS.__loadTraced = true;
        return 'traced';
      })()`);
    }

    const consoleFrom = harness.consoleMessages.length;
    const errorsFrom = harness.pageErrors.length;

    await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      window.__probePrevModule = gs.module;
      gs.loadingModule = false;
      gs.MenuManager.ClearMenus();
      gs.LoadModule('${MODULE}');
      return true;
    })()`);

    await harness.waitFor(`(() => {
      const gs = window.KotOR.GameState;
      const m = gs.module;
      return !!m && m !== window.__probePrevModule && gs.loadingModule === false
        && m.readyToProcessEvents === true && !!m.area
        && String(m.filename || '').toUpperCase() === '${MODULE}';
    })()`, 300_000);
    // Sample the collections while the area builds. A single reading at the end
    // cannot tell "never populated" from "populated, then cleared" - and those
    // point at completely different code.
    if (argv.includes('--watch')) {
      const samples = await harness.evaluate(`(async () => {
        const out = [];
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 60; i++) {
          const a = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
          out.push({
            t: i * 250,
            mod: String((window.KotOR.GameState.module || {}).filename || ''),
            rooms: a && a.rooms ? a.rooms.length : null,
            doors: a && a.doors ? a.doors.length : null,
            placeables: a && a.placeables ? a.placeables.length : null,
            sounds: a && a.sounds ? a.sounds.length : null,
          });
          await sleep(250);
        }
        return out;
      })()`, { timeoutMs: 120000 });
      const changes = samples.filter((s, i) =>
        i === 0 || JSON.stringify(s.rooms) + s.doors + s.placeables + s.sounds + s.mod
               !== JSON.stringify(samples[i - 1].rooms) + samples[i - 1].doors
                  + samples[i - 1].placeables + samples[i - 1].sounds + samples[i - 1].mod);
      console.log('WATCH (only changes):', JSON.stringify(changes, null, 1));
    }

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
        module: '${MODULE}',
        settleMs: ${settleMs},
        landedAs: String(window.KotOR.GameState.module.filename || ''),
        counts: {
          rooms: (area.rooms || []).length,
          creatures: (area.creatures || []).length,
          doors: (area.doors || []).length,
          placeables: (area.placeables || []).length,
          triggers: (area.triggers || []).length,
          waypoints: (area.waypoints || []).length,
          sounds: (area.sounds || []).length,
        },
        areaName: (() => { try { return String(area.name || area._name || ''); } catch { return '?'; } })(),
        // When the collections come back empty, the question is whether the
        // area parsed its GFFs at all or parsed them and built nothing.
        diagnostics: (() => {
          const mod = window.KotOR.GameState.module;
          const listLen = (gff, label) => {
            try {
              const f = gff.RootNode.getFieldByLabel(label);
              return f ? f.getChildStructs().length : null;
            } catch (e) { return 'threw:' + String(e && e.message || e).slice(0, 60); }
          };
          const out = {
            areasOnModule: (mod.areas || []).length,
            hasAre: !!area.are,
            hasGit: !!area.git,
          };
          if (area.are) {
            out.areRoomsList = listLen(area.are, 'Rooms');
            // ModuleArea.load() reads a long run of ARE fields unguarded, so a
            // single absent label throws and the area builds nothing.
            try {
              out.areFields = area.are.RootNode.getFields()
                .map((f) => f.getLabel()).sort();
            } catch (e) { out.areFields = 'threw:' + String(e && e.message || e); }
          }
          if (area.git) {
            for (const label of ['Creature List', 'Door List', 'Placeable List',
                                 'TriggerList', 'WaypointList', 'SoundList']) {
              out['git:' + label] = listLen(area.git, label);
            }
          }
          return out;
        })(),
        total: all.length,
        withRefCount: withRef.length,
        withoutRefCount: without.length,
        withRefTemplateTypes: tally(withRef),
        withoutTemplateTypes: tally(without),
        sampleWith: withRef.slice(0, 5),
        sampleWithout: without.slice(0, 8),
      };
    })()`, { timeoutMs: 90000 });

    // What the engine said while building this area. Four hypotheses about
    // 005EBO died to guesswork before this was added; the errors were the
    // evidence all along.
    const said = harness.consoleMessages.slice(consoleFrom)
      .filter((m) => m.type === 'error' || m.type === 'warning')
      .map((m) => String(m.text || '').slice(0, 220));
    report.pageErrors = harness.pageErrors.slice(errorsFrom).map((e) => String(e).slice(0, 400));
    report.consoleErrors = said.slice(0, 25);
    report.consoleErrorCount = said.length;
    if (argv.includes('--trace-dispose')) {
      report.disposeTraces = await harness.evaluate(
        `(window.__disposeTraces || []).map((t) => ({
          areaName: t.areaName, module: t.module, rooms: t.rooms,
          stack: String(t.stack || '').split(String.fromCharCode(10)).slice(1, 9).join(' | '),
        }))`);
    }
    if (argv.includes('--trace-loads')) {
      const calls = await harness.evaluate(`(window.__loadCalls || []).map((c) => ({
        name: c.name, current: c.current, loadingModule: c.loadingModule,
        stack: String(c.stack).split(String.fromCharCode(10)).slice(1, 10).join(' | '),
      }))`);
      report.loadCalls = calls;
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
