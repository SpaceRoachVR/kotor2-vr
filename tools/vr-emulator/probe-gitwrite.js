/**
 * Ad-hoc probe: does the exported GIT actually carry TemplateResRef?
 *
 * The .sav our engine writes contains the label zero times, yet
 * ModulePlaceable.save() writes the field and Module.save() calls
 * ModuleArea.save() before exporting. Isolate the writer: rebuild the GIT in
 * place and search the exported bytes.
 */
const { VrHarness } = require('./harness');

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');
  const harness = new VrHarness({ port: 9466 });
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
    // The engine needs to be at the main menu before a cold LoadModule lands;
    // waiting only on the boot button loads into a half-ready engine.
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await harness.waitFor(`!!window.KotOR.GameState.MenuManager.MainMenu`, 240_000);

    // Load 001EBO cold, where objects are known to carry templateResRef.
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

    const report = await harness.evaluate(`(() => {
      const area = window.KotOR.GameState.module.area;
      const decode = (bytes) => new TextDecoder('latin1').decode(bytes);
      const count = (s, n) => s.split(n).length - 1;

      const before = decode(area.git.getExportBuffer());
      const objectsWithRef = (area.placeables || []).filter(p => p.templateResRef).length;
      // One placeable's own save struct, to see what the object emits.
      const one = (area.placeables || [])[0];
      const oneSaved = one ? one.save() : null;
      const oneLabels = oneSaved && oneSaved.RootNode
        ? oneSaved.RootNode.getFields().map(f => f.getLabel()) : [];

      area.save();
      const after = decode(area.git.getExportBuffer());

      return {
        placeables: (area.placeables || []).length,
        placeablesWithTemplateResRef: objectsWithRef,
        firstPlaceable: one ? { name: (() => { try { return one.getName(); } catch(e){ return '?'; } })(),
                               templateResRef: one.templateResRef || null } : null,
        objectSaveEmitsLabel: oneLabels.indexOf('TemplateResRef') >= 0,
        objectSaveFieldCount: oneLabels.length,
        gitLabelBeforeAreaSave: count(before, 'TemplateResRef'),
        gitLabelAfterAreaSave: count(after, 'TemplateResRef'),
        gitBytesBefore: before.length, gitBytesAfter: after.length,
      };
    })()`, { timeoutMs: 120000 });
    console.log(JSON.stringify(report, null, 2));

    // Close the loop: write a .sav with the current build and read it back.
    // This is the end-to-end check the TemplateResRef fix never had. It writes
    // into gameinprogress, which is transient working state the engine rewrites
    // on every module transition - not the player's saves/ directory.
    const roundTrip = await harness.evaluate(`(async () => {
      const gs = window.KotOR.GameState;
      try { await gs.module.save(); } catch (e) { return 'save threw: ' + String(e && e.message || e); }
      try {
        const bytes = await window.KotOR.GameFileSystem.readFile('gameinprogress/001ebo.sav');
        const text = new TextDecoder('latin1').decode(bytes);
        return { bytes: bytes.length, labelCount: text.split('TemplateResRef').length - 1 };
      } catch (e) { return 'read threw: ' + String(e && e.message || e); }
    })()`, { timeoutMs: 180000 });
    console.log('ROUND TRIP (fresh .sav written by this build):', JSON.stringify(roundTrip));
  } finally {
    await harness.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
