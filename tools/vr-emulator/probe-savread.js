/**
 * Ad-hoc probe: where TemplateResRef is lost when a module loads from its
 * saved copy.
 *
 * The .sav written by this build contains the label, yet every object loaded
 * from it reports no TemplateResRef field. Either the file's structs do not
 * carry the field (a write that only looks right), or the loader drops it.
 * Read the file back independently and compare against the live objects.
 */
const { VrHarness } = require('./harness');

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');
  const harness = new VrHarness({ port: 9468 });
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

    // Make the run self-contained: gameinprogress is cleared on load, so write
    // the archive first rather than hoping one is lying around.
    await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      window.__prev = gs.module;
      gs.loadingModule = false;
      gs.MenuManager.ClearMenus();
      gs.LoadModule('001EBO');
      return true;
    })()`);
    await harness.waitFor(`(() => {
      const gs = window.KotOR.GameState; const m = gs.module;
      return !!m && m !== window.__prev && gs.loadingModule === false
        && m.readyToProcessEvents === true && !!m.area
        && String(m.filename||'').toUpperCase() === '001EBO';
    })()`, 300_000);
    await new Promise((r) => setTimeout(r, 6000));

    const wrote = await harness.evaluate(`(async () => {
      const gs = window.KotOR.GameState;
      const live = (gs.module.area.placeables || [])[0];
      const before = live ? (live.templateResRef || null) : null;
      try { await gs.module.save(); } catch (e) { return 'save threw: ' + String(e && e.message || e); }
      let dir = [];
      try { dir = await window.KotOR.GameFileSystem.readdir('gameinprogress'); } catch (e) { dir = 'threw'; }
      return { livePlaceableTemplateResRef: before, gameInProgress: dir };
    })()`, { timeoutMs: 180000 });
    console.log('WROTE:', JSON.stringify(wrote));

    // Inspect the saved archive on disk, independently of the module loader.
    const onDisk = await harness.evaluate(`(async () => {
      const K = window.KotOR;
      try {
        const erf = new K.ERFObject('gameinprogress/001ebo.sav');
        await erf.load();
        const keys = (erf.keyList || erf.resources || []).map((r) => ({
          resRef: String(r.resRef || ''), resType: r.resType }));
        if (erf.loadFailed) return { loadFailed: true, notFound: !!erf.notFound };
        // 2023 = GIT. Take the resref from the archive rather than assuming it:
        // the area is not always named after the module.
        const gitEntry = (erf.keyList || erf.resources || []).find((r) => r.resType === 2023);
        const git = gitEntry
          ? await erf.getResourceBufferByResRef(String(gitEntry.resRef), 2023)
          : null;
        if (!git || !git.length) return { keys, git: 'not retrieved' };
        const gff = new K.GFFObject(git);
        const list = gff.RootNode.getFieldByLabel('Placeable List');
        const structs = list ? list.getChildStructs() : [];
        const first = structs[0];
        return {
          keys: keys.slice(0, 6),
          gitBytes: git.length,
          placeableStructs: structs.length,
          firstStructLabels: first ? first.getFields().map((f) => f.getLabel()) : null,
          firstHasTemplateResRef: first ? first.hasField('TemplateResRef') : null,
          firstTemplateResRef: first && first.hasField('TemplateResRef')
            ? String(first.getFieldByLabel('TemplateResRef').getValue()) : null,
        };
      } catch (e) { return 'threw: ' + String(e && e.stack || e); }
    })()`, { timeoutMs: 120000 });

    console.log('ON DISK:', JSON.stringify(onDisk, (k, v) =>
      k === 'firstStructLabels' && Array.isArray(v) ? v.slice(0, 12).join(',') + ` (${v.length} fields)` : v, 1));

    // Now enter the module again. IsModuleSaved is true, so it should load the
    // archive just inspected. Compare what the engine ends up holding.
    await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      window.__prev2 = gs.module;
      gs.loadingModule = false;
      gs.MenuManager.ClearMenus();
      gs.LoadModule('001EBO');
      return true;
    })()`);
    await harness.waitFor(`(() => {
      const gs = window.KotOR.GameState; const m = gs.module;
      return !!m && m !== window.__prev2 && gs.loadingModule === false
        && m.readyToProcessEvents === true && !!m.area
        && String(m.filename||'').toUpperCase() === '001EBO';
    })()`, 300_000);
    await new Promise((r) => setTimeout(r, 6000));

    const afterLoad = await harness.evaluate(`(async () => {
      const K = window.KotOR;
      const gs = K.GameState;
      const area = gs.module.area;
      const decode = (b) => new TextDecoder('latin1').decode(b);
      const count = (t) => t.split('TemplateResRef').length - 1;

      const live = (area.placeables || [])[0];
      const liveInfo = live ? {
        name: (() => { try { return live.getName(); } catch (e) { return '?'; } })(),
        templateResRef: live.templateResRef || null,
        hasField: !!(live.template && live.template.RootNode
          && live.template.RootNode.hasField('TemplateResRef')),
        templateFieldCount: live.template && live.template.RootNode
          ? live.template.RootNode.getFields().length : null,
      } : null;

      // What the area is actually holding as its GIT.
      let areaGitLabels = null;
      try { areaGitLabels = count(decode(area.git.getExportBuffer())); } catch (e) { areaGitLabels = 'threw'; }

      // What the resource router hands back for the GIT right now.
      let routed = null;
      try {
        const buf = await K.ResourceLoader.loadResource(2023, String(area.name || ''));
        routed = buf ? { bytes: buf.length, labels: count(decode(buf)) } : 'no buffer';
      } catch (e) { routed = 'threw: ' + String(e && e.message || e); }

      return { areaName: String(area.name || ''), liveInfo, areaGitTemplateLabels: areaGitLabels, routedGit: routed };
    })()`, { timeoutMs: 120000 });
    console.log('AFTER SAVED-COPY LOAD:', JSON.stringify(afterLoad, null, 1));
  } finally {
    await harness.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
