/**
 * Ad-hoc probe: do a module's objects carry TemplateResRef immediately after a
 * savegame load, before any module transition?
 *
 * The write path is byte-verified correct and loading a current-build .sav
 * preserves the field. What still produces fieldless saves is the state right
 * after SaveGame.load(): if the objects are already fieldless there, everything
 * written from them is fieldless too, and the loss perpetuates.
 */
const { VrHarness } = require('./harness');

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');
  const harness = new VrHarness({ port: 9469 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      const box = await harness.evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim() === 'OK');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      })()`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await harness.cdp.send('Input.dispatchMouseEvent', {
          type, x: box.x, y: box.y, button: 'left', clickCount: 1,
          buttons: type === 'mousePressed' ? 1 : 0 });
      }
    } catch { /* accepted */ }
    await harness.waitFor(`document.querySelector('#vr-spike-button') !== null`, 240_000, 2000);
    await harness.waitFor(`!!window.KotOR.GameState.MenuManager.MainMenu`, 240_000);

    const before = await harness.evaluate(`(async () => {
      try { return await window.KotOR.GameFileSystem.readdir('gameinprogress'); } catch (e) { return 'threw'; }
    })()`);
    console.log('gameinprogress before save load:', JSON.stringify(before));

    // Catch whoever writes into gameinprogress during the save load, with a
    // stack. GetModuleRim reads gameinprogress/<module>.sav from disk, so the
    // file exists at that moment even though a listing either side shows none.
    const hooked = await harness.evaluate(`(() => {
      const FS = window.KotOR.GameFileSystem;
      if (!FS || typeof FS.writeFile !== 'function') return 'no writeFile';
      if (FS.__writeTraced) return 'already';
      const original = FS.writeFile.bind(FS);
      window.__fsWrites = [];
      FS.writeFile = function (filepath, data) {
        try {
          window.__fsWrites.push({
            path: String(filepath),
            bytes: data && data.length ? data.length : null,
            stack: String(new Error('write').stack || ''),
          });
        } catch (e) { /* never break the write */ }
        return original(filepath, data);
      };
      FS.__writeTraced = true;
      return 'traced';
    })()`);
    console.log('write hook:', hooked);
    if (hooked !== 'traced' && hooked !== 'already') {
      throw new Error('cannot trace filesystem writes: ' + hooked);
    }

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
    await new Promise((r) => setTimeout(r, 8000));

    const report = await harness.evaluate(`(async () => {
      const K = window.KotOR;
      const gs = K.GameState;
      const area = gs.module.area;
      const all = [].concat(area.placeables || [], area.doors || [], area.creatures || []);
      const withRef = all.filter((o) => o.templateResRef).length;
      const first = (area.placeables || [])[0];
      let dir = [];
      try { dir = await K.GameFileSystem.readdir('gameinprogress'); } catch (e) { dir = 'threw'; }
      return {
        module: String(gs.module.filename || ''),
        isLoadingSave: !!gs.isLoadingSave,
        total: all.length,
        withTemplateResRef: withRef,
        withoutTemplateResRef: all.length - withRef,
        firstPlaceable: first ? {
          name: (() => { try { return first.getName(); } catch (e) { return '?'; } })(),
          templateResRef: first.templateResRef || null,
          hasField: !!(first.template && first.template.RootNode
            && first.template.RootNode.hasField('TemplateResRef')),
        } : null,
        gameInProgress: dir,
        // Decisive split: if the area's own GIT carries the label but the
        // objects do not, the loss is in turning structs into objects. If the
        // GIT itself lacks it, the engine loaded a GIT that is not the pristine
        // one - which the archive on disk provably contains.
        areaGit: (() => {
          try {
            const text = new TextDecoder('latin1').decode(area.git.getExportBuffer());
            const list = area.git.RootNode.getFieldByLabel('Placeable List');
            const structs = list ? list.getChildStructs() : [];
            const first = structs[0];
            return {
              templateLabelCount: text.split('TemplateResRef').length - 1,
              placeableStructs: structs.length,
              firstStructFieldCount: first ? first.getFields().length : null,
              firstStructHasTemplateResRef: first ? first.hasField('TemplateResRef') : null,
            };
          } catch (e) { return 'threw: ' + String(e && e.message || e); }
        })(),
        // Which archives are in the module cache, and what does each hold for
        // the GIT? InitModuleCache writes them all into one Map under
        // Promise.all, so a later archive silently overwrites an earlier one.
        moduleArchives: await (async () => {
          try {
            const list = K.ResourceLoader.ModuleArchives || [];
            const out = [];
            for (const a of list) {
              const entry = { path: String(a.resource_path || ''), kind: a.constructor && a.constructor.name };
              try {
                const rec = (a.resources || a.keyList || []).find((r) => r.resType === 2023);
                if (rec) {
                  const buf = a.getResourceBuffer
                    ? await a.getResourceBuffer(rec)
                    : await a.getResourceBufferByResRef(String(rec.resRef), 2023);
                  const text = new TextDecoder('latin1').decode(buf);
                  entry.git = { resRef: String(rec.resRef), bytes: buf.length,
                                templateLabels: text.split('TemplateResRef').length - 1 };
                } else { entry.git = 'none'; }
              } catch (e) { entry.git = 'threw'; }
              out.push(entry);
            }
            return out;
          } catch (e) { return 'threw: ' + String(e && e.message || e); }
        })(),
        // Why do placeables fail to match where doors succeed? Compare the keys
        // each side actually exposes.
        matchKeys: await (async () => {
          try {
            const M = K.GameState.Module;
            const rim = await M.GetModuleRimA('001EBO');
            const info = rim && rim.getResourceInfo(String(area.name || ''), 2023);
            const buf = info ? await rim.getResourceBuffer(info) : null;
            const pristine = buf ? new K.GFFObject(buf) : null;
            const dump = (gff, label, n) => {
              if (!gff || !gff.RootNode.hasField(label)) return 'no list';
              const structs = gff.RootNode.getFieldByLabel(label).getChildStructs();
              return structs.slice(0, n).map((st) => ({
                tag: st.hasField('Tag') ? String(st.getFieldByLabel('Tag').getValue()) : '(none)',
                x: st.hasField('X') ? st.getFieldByLabel('X').getValue()
                   : (st.hasField('XPosition') ? st.getFieldByLabel('XPosition').getValue() : '(no X)'),
                resref: st.hasField('TemplateResRef')
                  ? String(st.getFieldByLabel('TemplateResRef').getValue()) : '(none)',
                fields: st.getFields().length,
              }));
            };
            return {
              savedPlaceables: dump(area.git, 'Placeable List', 2),
              pristinePlaceables: dump(pristine, 'Placeable List', 2),
              savedDoors: dump(area.git, 'Door List', 1),
              pristineDoors: dump(pristine, 'Door List', 1),
            };
          } catch (e) { return 'threw: ' + String(e && e.message || e); }
        })(),
        routedGit: await (async () => {
          try {
            const buf = await K.ResourceLoader.loadResource(2023, String(area.name || ''));
            if (!buf) return 'no buffer';
            const text = new TextDecoder('latin1').decode(buf);
            return { bytes: buf.length, templateLabelCount: text.split('TemplateResRef').length - 1 };
          } catch (e) { return 'threw: ' + String(e && e.message || e); }
        })(),
      };
    })()`, { timeoutMs: 120000 });
    console.log('AFTER SAVE LOAD:', JSON.stringify(report, null, 1));

    const writes = await harness.evaluate(`(window.__fsWrites || []).map((w) => ({
      path: w.path, bytes: w.bytes,
      stack: w.stack.split(String.fromCharCode(10)).slice(1, 7).map((l) => l.trim()).join(' | '),
    }))`, { timeoutMs: 60000 });
    console.log('WRITES during save load:');
    for (const w of writes) {
      console.log(`  ${w.path}  ${w.bytes} bytes`);
      if (/\.sav$/i.test(w.path)) console.log(`     ${w.stack}`);
    }
  } finally {
    await harness.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
