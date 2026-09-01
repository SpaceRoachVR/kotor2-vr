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
      };
    })()`, { timeoutMs: 120000 });
    console.log('AFTER SAVE LOAD:', JSON.stringify(report, null, 1));
  } finally {
    await harness.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
