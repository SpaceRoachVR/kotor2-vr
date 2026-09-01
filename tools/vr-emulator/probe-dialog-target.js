/**
 * Ad-hoc probe: why ActionDialogObject's target does not resolve.
 *
 * Eight modules in the 82-module sweep logged the same failure - "action type 24
 * threw ... reading 'position'" for Hanharr, Visquis, T3M4, G0T0, Tobin,
 * npc_dillan and others. The action is dropped from the queue, so those
 * conversations never start: a gameplay defect, not just log noise.
 *
 * The target comes from `GetObjectById(parameters[0].value)`. Two very different
 * causes produce the same symptom, and they want opposite fixes:
 *
 *   - the script passed OBJECT_INVALID, i.e. no target was ever intended, and
 *     the action should fail quietly the way retail does; or
 *   - a real object id fails to resolve, which is a registry bug and silencing
 *     it would bury a conversation that should have played.
 *
 * So record the raw id alongside the resolution result rather than guessing.
 *
 *   node tools/vr-emulator/probe-dialog-target.js --url "<url>" --module 601DAN
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
  const MODULE = moduleArg > -1 ? String(argv[moduleArg + 1]).toUpperCase() : '601DAN';

  const harness = new VrHarness({ port: 9457 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      await clickButtonByText(harness, 'OK');
    } catch { /* already accepted */ }
    await harness.waitFor(`document.querySelector('#vr-spike-button') !== null`, 240_000, 2000);

    // Same boot as the sweep: a party established from a save.
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

    // Record every update where the target fails to resolve, with the raw id.
    const hookStatus = await harness.evaluate(`(() => {
      const K = window.KotOR;
      // Not exported on window.KotOR; the engine constructs it through the
      // action factory (ModuleObject: new GameState.ActionFactory.ActionDialogObject()).
      const factory = K.GameState && K.GameState.ActionFactory;
      const ctor = factory && factory.ActionDialogObject;
      const proto = ctor && ctor.prototype;
      if (!proto) return 'ActionDialogObject not reachable via ActionFactory';
      if (proto.__targetTraced) return 'already';
      const original = proto.update;
      window.__dialogTargetMisses = [];
      proto.update = function (delta) {
        const param = this.parameters ? this.parameters[0] : undefined;
        const rawId = param ? param.value : undefined;
        const resolved = K.GameState.ModuleObjectManager.GetObjectById(rawId);
        if (!resolved) {
          window.__dialogTargetMisses.push({
            owner: this.owner && this.owner.getTag ? this.owner.getTag() : '?',
            rawId: rawId,
            rawIdHex: typeof rawId === 'number' ? '0x' + (rawId >>> 0).toString(16) : String(rawId),
            paramType: param ? param.type : null,
            // What the engine believes exists right now.
            objectCount: K.GameState.ModuleObjectManager.objectList
              ? K.GameState.ModuleObjectManager.objectList.size : null,
            playerId: (K.PartyManager.Player || {}).id,
          });
        }
        return original.apply(this, arguments);
      };
      proto.__targetTraced = true;
      return 'traced';
    })()`);
    console.log('hook status:', hookStatus);
    if (hookStatus !== 'traced' && hookStatus !== 'already') {
      // Do not report "no misses" from a hook that never installed.
      throw new Error(`cannot trace ActionDialogObject: ${hookStatus}`);
    }

    await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      window.__prev = gs.module;
      gs.loadingModule = false;
      gs.MenuManager.ClearMenus();
      gs.LoadModule('${MODULE}');
      return true;
    })()`);
    await harness.waitFor(`(() => {
      const gs = window.KotOR.GameState; const m = gs.module;
      return !!m && m !== window.__prev && gs.loadingModule === false
        && m.readyToProcessEvents === true && !!m.area
        && String(m.filename || '').toUpperCase() === '${MODULE}';
    })()`, 300_000);
    await new Promise((r) => setTimeout(r, 12000));

    const misses = await harness.evaluate(`(() => {
      const seen = new Map();
      for (const m of (window.__dialogTargetMisses || [])) {
        const key = m.owner + '|' + m.rawIdHex;
        if (!seen.has(key)) seen.set(key, { ...m, count: 0 });
        seen.get(key).count += 1;
      }
      return {
        distinct: Array.from(seen.values()),
        total: (window.__dialogTargetMisses || []).length,
        objectInvalid: '0x' + (window.KotOR.ModuleObjectConstant
          ? (window.KotOR.ModuleObjectConstant.OBJECT_INVALID >>> 0).toString(16) : '?'),
      };
    })()`, { timeoutMs: 60000 });

    console.log(JSON.stringify(misses, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
