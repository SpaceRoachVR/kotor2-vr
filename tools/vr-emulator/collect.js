/**
 * Single-pass metric collection under the emulated Quest 3.
 *
 * `in-game.js` and `phase1-diagnostics.js` each drove their own browser run and
 * duplicated the boot/load sequence. A full run costs several minutes, so the
 * regression check collects everything a scenario can observe in one pass and
 * lets the caller decide what to assert.
 *
 * Returns a plain metrics object — no pass/fail judgement, so the same
 * collection can back both the check runner and ad-hoc investigation.
 */
const { VrHarness } = require('./harness');

const PHASE_TIMEOUTS = {
  eula: 90_000,
  boot: 240_000,
  saves: 120_000,
  moduleLoad: 300_000,
};

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    // position:fixed elements report offsetParent === null, so measure instead.
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The emulated head yaw used for the recenter check, in radians. */
const RECENTER_HEAD_YAW = 0.9;

async function collectVrMetrics({ url, port = 9430, onProgress = () => {} } = {}) {
  if (!url) throw new Error('collectVrMetrics requires a launch url');
  const harness = new VrHarness({ port });
  const metrics = { steps: {} };

  try {
    await harness.launch(url);
    metrics.device = await harness.evaluate(`({
      ready: window.__xrHarness.ready,
      name: window.__xrHarness.deviceName,
    })`);
    onProgress('device installed');

    await harness.waitFor(
      `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
      PHASE_TIMEOUTS.eula
    );
    await clickButtonByText(harness, 'OK');
    await harness.waitFor(
      `document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`,
      PHASE_TIMEOUTS.boot, 2000
    );
    metrics.steps.vrButtonEnabled = true;
    metrics.immersiveSupported = await harness.evaluate(
      `navigator.xr.isSessionSupported('immersive-vr')`
    );
    onProgress('engine booted, VR available');

    // --- load a save --------------------------------------------------------
    metrics.saveCount = await harness.evaluate(`(async () => {
      await window.KotOR.SaveGame.GetSaveGames();
      return window.KotOR.SaveGame.saves.length;
    })()`, { timeoutMs: PHASE_TIMEOUTS.saves });

    // Mirror MenuSaveLoad's LOADGAME path: clear menus and dispose the live
    // module before loading, or the engine stays in GUI mode and never lands.
    await harness.evaluate(`(async () => {
      const gs = window.KotOR.GameState;
      gs.MenuManager.ClearMenus();
      if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
      Promise.resolve(window.KotOR.SaveGame.saves[0].load()).catch(() => undefined);
      return true;
    })()`);
    await harness.waitFor(
      `(() => {
        const gs = window.KotOR.GameState;
        const p = window.KotOR.PartyManager && window.KotOR.PartyManager.Player;
        return !!(gs && gs.module && p && p.position && Number.isFinite(p.position.x));
      })()`,
      PHASE_TIMEOUTS.moduleLoad, 3000
    );
    onProgress('save loaded');

    // A save can land mid-movie, and movie lifecycle suspends gameplay input.
    await harness.evaluate(`(async () => {
      const gs = window.KotOR.GameState;
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const playing = gs.VideoManager && gs.VideoManager.isMoviePlaying
          ? gs.VideoManager.isMoviePlaying() : false;
        if (!playing && gs.Mode !== 5) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      return true;
    })()`, { timeoutMs: 90_000 });

    // Engine mode follows the current menu; InGameOverlay is the one carrying
    // INGAME. Without it, gameplay input stays suppressed.
    metrics.engineMode = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      gs.MenuManager.InGameOverlay.open();
      return gs.Mode;
    })()`);
    await wait(2000);
    onProgress('in-game');

    // --- textures (ROADMAP 1.2) --------------------------------------------
    // Harvest before entering VR so the numbers describe module load, not the
    // extra GUI textures a VR session pulls in.
    await wait(20_000);
    metrics.textures = await harness.evaluate(`(() => {
      const all = window.KotOR.TextureLoader.getDiagnostics();
      const byStatus = {};
      const failing = new Map();
      for (const d of all) {
        byStatus[d.status] = (byStatus[d.status] || 0) + 1;
        if (d.status === 'resolved') continue;
        const key = d.requestedResref + '|' + d.status;
        if (!failing.has(key)) failing.set(key, { resref: d.requestedResref, status: d.status, semantic: d.semantic, count: 0 });
        failing.get(key).count++;
      }
      return {
        total: all.length,
        byStatus,
        missing: byStatus.missing || 0,
        distinctFailing: failing.size,
        failing: Array.from(failing.values()).sort((a, b) => b.count - a.count),
      };
    })()`);
    onProgress('textures harvested');

    // --- immersive session --------------------------------------------------
    // Re-assert INGAME immediately before the interaction phase. Engine mode
    // follows the current menu, and the texture harvest above spends 20 s in
    // which something else can take the foreground — leaving gameplay input
    // suppressed so recenter and locomotion silently do nothing.
    metrics.engineModeBeforeSession = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      if (gs.Mode !== 1) gs.MenuManager.InGameOverlay.open();
      return { mode: gs.Mode, state: gs.State };
    })()`);
    await clickButtonByText(harness, 'Enter VR (spike)');
    await wait(6000);
    metrics.session = await harness.evaluate(`(() => {
      const d = window.__xrDevice;
      return {
        active: !!(d && d.activeSession),
        inputSources: d && d.activeSession ? d.activeSession.inputSources.length : 0,
        profiles: d && d.activeSession
          ? Array.from(d.activeSession.inputSources).map(s => s.profiles[0]) : [],
      };
    })()`);
    onProgress('immersive session');

    if (metrics.session.active) {
      metrics.xrFrames = await harness.evaluate(`(async () => {
        const session = window.__xrDevice.activeSession;
        let count = 0;
        await new Promise((resolve) => {
          const tick = () => { count++; if (count < 90) session.requestAnimationFrame(tick); else resolve(); };
          session.requestAnimationFrame(tick);
          setTimeout(resolve, 5000);
        });
        return count;
      })()`, { timeoutMs: 20_000 });

      // --- recenter (long press on the dominant thumbstick) ----------------
      await harness.evaluate(`(() => {
        const q = window.__xrDevice.quaternion;
        const half = ${RECENTER_HEAD_YAW / 2};
        q.set(0, Math.sin(half), 0, Math.cos(half));
        return true;
      })()`);
      await wait(1500);
      // Sampled at the moment of the test, so a failure says whether gameplay
      // input was even eligible rather than just reporting a zero.
      metrics.inputEligibility = await harness.evaluate(`(() => {
        const gs = window.KotOR.GameState;
        return {
          mode: gs.Mode,
          state: gs.State,
          isPresenting: window.KotOR.VRSpike.isPresenting,
          hasPlayer: !!(window.KotOR.PartyManager && window.KotOR.PartyManager.Player),
        };
      })()`);
      const yawBefore = await harness.evaluate(`window.KotOR.VRSpike.yawOffset`);
      // Held well past the ~700 ms threshold.
      await harness.evaluate(
        `(() => { window.__xrDevice.controllers.right.updateButtonValue('thumbstick', 1); return true; })()`
      );
      await wait(2000);
      await harness.evaluate(
        `(() => { window.__xrDevice.controllers.right.updateButtonValue('thumbstick', 0); return true; })()`
      );
      await wait(1000);
      metrics.recenter = {
        headYawRadians: RECENTER_HEAD_YAW,
        yawOffsetBefore: yawBefore,
        yawOffsetAfter: await harness.evaluate(`window.KotOR.VRSpike.yawOffset`),
      };

      // A tap must not recentre — this is the accidental-turn guard.
      await harness.evaluate(`window.KotOR.VRSpike.yawOffset = 0`);
      await harness.evaluate(
        `(() => { window.__xrDevice.controllers.right.updateButtonValue('thumbstick', 1); return true; })()`
      );
      await wait(120);
      await harness.evaluate(
        `(() => { window.__xrDevice.controllers.right.updateButtonValue('thumbstick', 0); return true; })()`
      );
      await wait(600);
      metrics.recenterTapIgnored =
        (await harness.evaluate(`window.KotOR.VRSpike.yawOffset`)) === 0;
      onProgress('recenter');

      // --- locomotion -------------------------------------------------------
      const readPosition = `(() => {
        const p = window.KotOR.PartyManager.Player;
        return p && p.position ? { x: p.position.x, y: p.position.y } : null;
      })()`;
      const before = await harness.evaluate(readPosition);
      await harness.evaluate(
        `(() => { window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, -1); return true; })()`
      );
      await wait(4000);
      await harness.evaluate(
        `(() => { window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, 0); return true; })()`
      );
      const after = await harness.evaluate(readPosition);
      metrics.locomotion = {
        before, after,
        metresMoved: before && after ? Math.hypot(after.x - before.x, after.y - before.y) : null,
      };
      onProgress('locomotion');

      // --- action wheel ------------------------------------------------------
      const wheelMark = await harness.evaluate(`window.__xrHarness.log.length`);
      await harness.evaluate(
        `(() => { window.__xrDevice.controllers.left.updateButtonValue('x-button', 1); return true; })()`
      );
      await wait(2500);
      metrics.wheel = await harness.evaluate(`(() => {
        const since = window.__xrHarness.log.slice(${wheelMark});
        return {
          iconLoadFailures: since.filter(e => /could not be loaded/.test(e.text)).length,
          lines: since.length,
        };
      })()`);
      await harness.evaluate(
        `(() => { window.__xrDevice.controllers.left.updateButtonValue('x-button', 0); return true; })()`
      );
      onProgress('action wheel');
    }

    // --- approach suppression (ROADMAP 3.10) --------------------------------
    // Activating a world object beyond the engine's own use distance must not
    // enqueue an ActionMoveToPoint: the rig is anchored to the avatar, so an
    // engine-driven walk drags the player. Checked by inspecting the queue
    // rather than by watching for motion, which would be timing-dependent.
    metrics.approachSuppression = await harness.evaluate(`(() => {
      const K = window.KotOR;
      const player = K.PartyManager.Player;
      // Actor-scoped: suppression applies only to the creature the player is
      // driving, so party members and NPCs keep walking to their targets.
      const policySuppressed = K.ActionApproachPolicy
        ? K.ActionApproachPolicy.isApproachSuppressedFor(player) : null;
      const companionStillWalks = K.ActionApproachPolicy
        ? K.ActionApproachPolicy.isApproachSuppressedFor({ id: 'not-the-player' }) === false
        : null;
      const queuedTypes = player && player.actionQueue
        ? Array.from(player.actionQueue).map(a => (a && a.constructor && a.constructor.name) || '?')
        : null;
      return {
        policySuppressed,
        companionStillWalks,
        queuedTypes,
        movesQueued: queuedTypes ? queuedTypes.filter(n => /MoveToPoint/.test(n)).length : null,
      };
    })()`);
    onProgress('approach suppression');

    // --- recenter refuses a near-vertical head (ROADMAP 4.6) ----------------
    // The first guard relied on the facing conversion throwing, which only
    // happens for an exactly-vertical forward. A real headset looking up is a
    // few degrees off, so it never fired — reported from the second headset
    // session as "recenter still worked while looking straight up".
    await harness.evaluate(`(() => {
      window.KotOR.VRSpike.yawOffset = 0;
      // Pitch the head ~85 degrees up: forward is nearly vertical, so the yaw
      // it reports is mostly noise.
      const half = ${(85 * Math.PI / 180) / 2};
      window.__xrDevice.quaternion.set(-Math.sin(half), 0, 0, Math.cos(half));
      return true;
    })()`);
    await wait(1200);
    await harness.evaluate(
      `(() => { window.__xrDevice.controllers.right.updateButtonValue('thumbstick', 1); return true; })()`
    );
    await wait(1600);
    await harness.evaluate(
      `(() => { window.__xrDevice.controllers.right.updateButtonValue('thumbstick', 0); return true; })()`
    );
    await wait(600);
    metrics.recenterVerticalRefused = await harness.evaluate(
      `window.KotOR.VRSpike.yawOffset === 0`
    );
    // Restore a level head so later checks are not run from a silly pose.
    await harness.evaluate(`(() => { window.__xrDevice.quaternion.set(0, 0, 0, 1); return true; })()`);
    onProgress('recenter vertical guard');

    // --- movement mode is not on a physical button --------------------------
    metrics.locomotionModeUnbound = await harness.evaluate(`(() => {
      const profiles = window.KotOR.BUILT_IN_XR_PROFILES;
      if (!profiles) return null;
      return !profiles.some(p => p.bindings.some(b => b.action === 'toggle-locomotion-mode'));
    })()`);

    // --- level-up button is actually clickable ------------------------------
    metrics.levelUpClickable = await harness.evaluate(`(() => {
      const menu = window.KotOR.GameState.MenuManager.MenuCharacter;
      if (!menu) return 'no-menu';
      const button = menu.BTN_LEVELUP;
      if (!button) return 'no-button';
      const listeners = button.eventListeners && button.eventListeners['click'];
      return Array.isArray(listeners) && listeners.length > 0;
    })()`);
    onProgress('menu wiring');

    // --- world prompt survey ------------------------------------------------
    // Builds the prompt for every eligible object and records what it offers.
    // Reported from the second headset session: "doors with no security option
    // show bash but not use", and Security/tunneler failing on containers that
    // should accept them. A survey answers both with data rather than guessing
    // which object misbehaved — there is already a passing unit test asserting
    // Use appears alongside Bash, so the real objects differ from the synthetic
    // case somehow.
    //
    // Candidates are flat DTOs (id, name, actorDistanceMetres, hasActions,
    // inRange); the underlying engine object is resolved separately by id for
    // the lock flags.
    metrics.promptSurvey = await harness.evaluate(`(() => {
      const K = window.KotOR;
      const area = K.GameState.module && K.GameState.module.area;
      const player = K.PartyManager && K.PartyManager.Player;
      if (!area || !player) return { error: 'no area or player' };

      const build = K.buildVRWorldActionPrompt;
      if (typeof build !== 'function') return { error: 'buildVRWorldActionPrompt not exported' };

      // Every action is gated by isLiveVRWorldPromptCandidate, which recomputes
      // the candidate from live state — so a synthesised in-range candidate is
      // rejected and a distant object reports nothing. The only truthful way to
      // ask "what would this object offer" is to stand next to it. Position is
      // restored afterwards.
      const home = player.position.clone();
      const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
      const rows = [];

      try {
        for (const [kind, pool] of [['door', area.doors || []], ['placeable', area.placeables || []]]) {
          for (const raw of pool) {
            if (!raw || raw.id == null || !raw.position) continue;
            // Prompt building is gated on playerSelectableObjects, a live pool
            // the engine refreshes in its own update loop. A synchronous probe
            // cannot widen it, so an object outside the pool reports nothing —
            // which is "not sampled", not "offers no actions". Say which.
            const pool = K.GameState.ModuleObjectManager.playerSelectableObjects || [];
            const sampled = pool.includes(raw);
            player.position.set(raw.position.x + 1.0, raw.position.y, raw.position.z);
            let labels = [];
            let error = null;
            if (!sampled) {
              rows.push({
                id: raw.id,
                kind,
                name: safe(() => raw.getName(), null),
                locked: safe(() => !!raw.isLocked(), null),
                keyRequired: !!raw.keyRequired,
                notBlastable: !!raw.notBlastable,
                openLockDC: raw.openLockDC != null ? raw.openLockDC : null,
                sampled: false,
              });
              continue;
            }
            try {
              const model = build('module-object:' + raw.id);
              labels = ((model && model.pages) || []).flatMap(page =>
                (page.entries || []).filter(e => e && e.kind === 'action').map(e => e.label));
            } catch (e) {
              error = String(e && e.message || e);
            }
            rows.push({
              id: raw.id,
              kind,
              name: safe(() => raw.getName(), null),
              locked: safe(() => !!raw.isLocked(), null),
              keyRequired: !!raw.keyRequired,
              notBlastable: !!raw.notBlastable,
              openLockDC: raw.openLockDC != null ? raw.openLockDC : null,
              sampled: true,
              labels,
              ...(error ? { error } : {}),
            });
          }
        }
      } finally {
        player.position.copy(home);
      }

      rows.sort((a, b) => a.id - b.id);
      return {
        total: rows.length,
        sampled: rows.filter(r => r.sampled).length,
        doors: (area.doors || []).length,
        placeables: (area.placeables || []).length,
        rows,
      };
    })()`, { timeoutMs: 120000 });
    onProgress('world prompt survey');

    // --- wheel menu routes open without throwing ----------------------------
    // The action wheel's Screens submenu opens real legacy menus. Two of them
    // threw on first headset use: MenuMap touched BTN_PRTYSLCT, which TSL's GUI
    // does not have, and GUIFeatItem dereferenced a padding hole in feats.2da.
    // Opening each here catches a route that builds but explodes on use.
    metrics.menuRoutes = await harness.evaluate(`(async () => {
      const gs = window.KotOR.GameState;
      const routes = ['MenuMap', 'MenuAbilities', 'MenuJournal', 'MenuMessages',
                      'MenuEquipment', 'MenuOptions', 'MenuInventory', 'MenuCharacter'];
      const results = {};
      for (const name of routes) {
        const menu = gs.MenuManager[name];
        if (!menu) { results[name] = 'missing'; continue; }
        try {
          menu.open();
          await new Promise(r => setTimeout(r, 400));
          results[name] = 'ok';
        } catch (error) {
          results[name] = 'threw: ' + String(error && error.message || error);
        }
        try { menu.close(); } catch (e) { /* closing is not what we are testing */ }
        await new Promise(r => setTimeout(r, 200));
      }
      return results;
    })()`, { timeoutMs: 60000 });
    onProgress('menu routes');

    // --- menus actually show something --------------------------------------
    // "Opens without throwing" is not the same as "shows content": the second
    // headset session reported a blank active-quest list and inventory slots
    // with no icons, both of which opened cleanly. Measure what a menu holds,
    // not just that it survived being opened.
    metrics.menuContent = await harness.evaluate(`(async () => {
      const gs = window.KotOR.GameState;
      const out = {};

      const journal = gs.JournalManager;
      out.journal = {
        managerPresent: !!journal,
        entryCount: journal && Array.isArray(journal.Entries) ? journal.Entries.length : -1,
        categoryCount: journal && Array.isArray(journal.Categories) ? journal.Categories.length : -1,
      };

      // An empty list has two very different causes — the save carries no
      // quests, or it carries quests we failed to load. The party table GFF is
      // not retained after loading, so re-read it from the save the same way
      // SaveGame.loadPartyTable does and count the source structs.
      try {
        const save = window.KotOR.SaveGame.saves[0];
        const data = await window.KotOR.GameFileSystem.readFile(
          save.directory + '/PARTYTABLE.res'
        );
        const gff = new window.KotOR.GFFObject(data);
        const root = gff.RootNode;
        out.journal.savedHasJournalField = root.hasField('JNL_Entries');
        out.journal.savedEntryCount = root.hasField('JNL_Entries')
          ? root.getFieldByLabel('JNL_Entries').getChildStructs().length
          : 0;
      } catch (error) {
        out.journal.saveReadError = String(error && error.message || error);
      }

      const menu = gs.MenuManager.MenuJournal;
      if (menu) {
        try {
          menu.open();
          await new Promise(r => setTimeout(r, 500));
          const lb = menu.LB_ITEMS;
          out.journal.listBoxPresent = !!lb;
          out.journal.listedItems = lb && Array.isArray(lb.items) ? lb.items.length : -1;
          out.journal.childCount = lb && lb.children ? lb.children.length : -1;
        } catch (error) {
          out.journal.error = String(error && error.message || error);
        }
        try { menu.close(); } catch (e) { /* not under test */ }
      }
      await new Promise(r => setTimeout(r, 200));

      // Equipped-item icons: the reported slots draw no icon at all.
      const equip = gs.MenuManager.MenuEquipment;
      if (equip) {
        try {
          equip.open();
          await new Promise(r => setTimeout(r, 500));
          // Distinguish "nothing equipped" from "we looked in the wrong place":
          // an empty result that means the latter reads as a false negative.
          const player = gs.PartyManager && gs.PartyManager.party
            ? gs.PartyManager.party[0] : null;
          out.equipment = {
            playerPresent: !!player,
            partySize: gs.PartyManager && gs.PartyManager.party
              ? gs.PartyManager.party.length : -1,
            equipmentPropertyPresent: !!(player && player.equipment),
          };
          if (player && player.equipment) {
            const slots = Object.entries(player.equipment)
              .filter(([, item]) => !!item);
            out.equipment.equippedSlots = slots.length;
            out.equipment.slots = slots.slice(0, 12).map(([slot, item]) => ({
              slot,
              name: (item.getName && item.getName()) || null,
              // The reported symptom is a slot with no icon.
              icon: item.getIcon ? item.getIcon() : (item.icon || null),
            }));
          }
        } catch (error) {
          out.equipment = { error: String(error && error.message || error) };
        }
        try { equip.close(); } catch (e) { /* not under test */ }
      }

      // The reported symptom is an equipped slot drawing no icon. The item data
      // carries an icon name, so the question is whether that name resolves —
      // and whether anything ever asks for it. Ask directly.
      const names = (out.equipment && out.equipment.slots || []).map(s => s.icon).filter(Boolean);
      out.itemIcons = [];
      for (const name of names) {
        try {
          // LoadGUI is the call the item protoitems actually make.
          const tex = await Promise.race([
            window.KotOR.TextureLoader.LoadGUI(name).catch(() => null),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
          ]);
          // GUIEquipmentItem does not call LoadGUI — it enqueues with
          // TextureType.TEXTURE, and only reveals the sprite on success. Test
          // that exact call too, since it is the one that actually draws.
          const viaEnqueue = await Promise.race([
            new Promise((resolve) => {
              const mat = {};
              window.KotOR.TextureLoader.enQueue(
                name, mat, window.KotOR.TextureType.TEXTURE, () => resolve(true)
              );
              window.KotOR.TextureLoader.LoadQueue(() => resolve('queue-drained'));
            }),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 6000)),
          ]);
          out.itemIcons.push({
            name,
            viaLoadGUI: !!tex && tex !== 'timeout',
            viaEnqueueTexture: viaEnqueue === true,
            enqueueOutcome: viaEnqueue === true ? 'callback-fired' : String(viaEnqueue),
          });
        } catch (error) {
          out.itemIcons.push({ name, error: String(error && error.message || error) });
        }
      }
      return out;
    })()`, { timeoutMs: 60000 });
    onProgress('menu content');

    // --- console health -----------------------------------------------------
    metrics.console = await harness.evaluate(`(() => {
      const log = window.__xrHarness.log;
      const errors = {};
      for (const e of log) {
        if (e.level !== 'error') continue;
        const key = e.text.split('\\n')[0].slice(0, 160);
        errors[key] = (errors[key] || 0) + 1;
      }
      return {
        totalLines: log.length,
        startupTraceLines: log.filter(e => /startup stage/.test(e.text)).length,
        serializeWarnings: log.filter(e => /Unable to serialize Texture/.test(e.text)).length,
        iconLoadFailures: log.filter(e => /could not be loaded/.test(e.text)).length,
        errorsByKind: errors,
        errorTotal: Object.values(errors).reduce((sum, n) => sum + n, 0),
      };
    })()`);
    metrics.pageErrors = harness.pageErrors.slice(0, 10);
    onProgress('console harvested');

    return metrics;
  } finally {
    await harness.close();
  }
}

module.exports = { collectVrMetrics, RECENTER_HEAD_YAW };
