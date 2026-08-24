/**
 * The Peragus prologue walkthrough, as an ordered list of steps.
 *
 * Each step either completes or blocks. A blocked step stops the run and is
 * reported with whatever state was current, because that state is the bug
 * report: the point of this driver is to find what stops a playthrough, not to
 * assert a fixed list of behaviours the way `vr:check` does.
 *
 * Checkpoints: after a milestone is verified the driver saves the game, so a
 * later run can resume from it with `--resume "<name>"` rather than replaying
 * character creation every time.
 */
const { worldState, clickButtonByText, TIMEOUTS } = require('./playthrough');

const CHECKPOINT_PREFIX = 'VRPT';

/**
 * Checkpoints in the order they are reached. `--resume <name>` skips every step
 * belonging to a stage at or before that checkpoint, so a later checkpoint does
 * not replay the Ebon Hawk — special-casing one name meant every new checkpoint
 * silently re-ran the whole prologue.
 */
const CHECKPOINT_ORDER = [
  'prologue-start',
  'peragus-arrival',
  'medbay-door',
  'medbay-looted',
  'first-kill',
  'droids-cleared',
  'levelled',
  'module-102',
];

function resumedPast(args, checkpoint) {
  if (!args.resume) return false;
  const resumedAt = CHECKPOINT_ORDER.indexOf(args.resume);
  const stageAt = CHECKPOINT_ORDER.indexOf(checkpoint);
  if (resumedAt < 0 || stageAt < 0) return false;
  return stageAt <= resumedAt;
}

function line(text) {
  console.log(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Invokes a real GUI control's click handler, and says so when it cannot. */
async function clickGuiControl(harness, menuName, controlName) {
  const outcome = await harness.evaluate(`(() => {
    const menus = window.KotOR.GameState.MenuManager;
    const menu = menus && menus[${JSON.stringify(menuName)}];
    if (!menu) return { ok: false, reason: 'no menu ' + ${JSON.stringify(menuName)} };
    const control = menu[${JSON.stringify(controlName)}];
    if (!control) return { ok: false, reason: 'no control ' + ${JSON.stringify(controlName)} };
    const listeners = control.eventListeners && control.eventListeners['click'];
    if (!Array.isArray(listeners) || listeners.length === 0) {
      return { ok: false, reason: ${JSON.stringify(controlName)} + ' has no click handler' };
    }
    try { control.click(); } catch (error) {
      return { ok: false, reason: 'click threw: ' + String(error && error.message || error) };
    }
    return { ok: true };
  })()`);
  if (!outcome.ok) throw new Error(`${menuName}.${controlName}: ${outcome.reason}`);
}

/** Lists the clickable controls on a menu — used when a layout is unknown. */
async function describeMenuControls(harness, menuName) {
  return harness.evaluate(`(() => {
    const menus = window.KotOR.GameState.MenuManager;
    const menu = menus && menus[${JSON.stringify(menuName)}];
    if (!menu) return { located: false, reason: 'no menu ' + ${JSON.stringify(menuName)} };
    const clickable = [];
    const present = [];
    for (const key of Object.keys(menu)) {
      const control = menu[key];
      if (!control || typeof control !== 'object') continue;
      if (!/^(BTN_|LB_|LBL_|[A-Z0-9_]+_BTN)/.test(key)) continue;
      present.push(key);
      const listeners = control.eventListeners && control.eventListeners['click'];
      if (Array.isArray(listeners) && listeners.length > 0) clickable.push(key);
    }
    return { located: true, visible: menu.bVisible === true, present, clickable };
  })()`);
}

async function waitForMenu(harness, menuName, timeoutMs = TIMEOUTS.chargen) {
  await harness.waitFor(
    `(() => { const m = window.KotOR.GameState.MenuManager;
      return !!(m && m[${JSON.stringify(menuName)}] && m[${JSON.stringify(menuName)}].bVisible); })()`,
    timeoutMs, 500,
  );
}

async function waitForModule(harness, moduleName, timeoutMs = TIMEOUTS.moduleLoad) {
  // A module plus a placed player is the real signal. GameState.Mode stays at
  // GUI through a load even once the world is live, so gating on INGAME waits
  // forever on a load that already succeeded.
  await harness.waitFor(`(() => {
    const gs = window.KotOR.GameState;
    const party = window.KotOR.PartyManager;
    const player = party && party.party ? party.party[0] : null;
    if (!gs || !gs.module || !player || !player.position) return false;
    if (!Number.isFinite(player.position.x)) return false;
    ${moduleName ? `
    // module.name is a CExoLocString; the area name is the usable identifier.
    const area = gs.module.area;
    if (!area || String(area.name || '').toLowerCase() !== ${JSON.stringify(String(moduleName).toLowerCase())}) return false;` : ''}
    return true;
  })()`, timeoutMs, 3000);

  // Module + player is necessary but not sufficient: LoadScreen can still be the
  // foreground menu, in which case GameState.Mode is -1 and gameplay has not
  // begun. Entering VR there produces a session with no engine mode at all.
  await harness.waitFor(`(() => {
    const gs = window.KotOR.GameState;
    const menus = gs.MenuManager;
    if (menus && menus.LoadScreen && menus.LoadScreen.bVisible) return false;
    // 1 = INGAME, 3 = DIALOG. A new game drops straight into a conversation.
    return gs.Mode === 1 || gs.Mode === 3;
  })()`, timeoutMs, 1000);
}

/**
 * A snapshot of the live conversation.
 *
 * `ConversationState`: -1 INVALID, 0 LISTENING_TO_SPEAKER, 1 WAITING_FOR_PC_CHOICE,
 * 2 CONTINUE_DIALOG, 3 END_DIALOG. Reported numerically and by name, so a
 * renumbered enum shows up as a changed name rather than as "no dialogue".
 */
async function dialogueSnapshot(harness) {
  return harness.evaluate(`(() => {
    const K = window.KotOR;
    const gs = K.GameState;
    const menus = gs.MenuManager;
    const dialog = menus && menus.InGameDialog;
    const cm = gs.CutsceneManager;
    if (!dialog) return { located: false, reason: 'no InGameDialog' };
    if (!cm) return { located: false, reason: 'no CutsceneManager' };
    const visible = dialog.bVisible === true;
    // GUIListBox holds its rows in children, not items -- reading items
    // returned undefined and made a populated reply list look like an empty one.
    let replies = [];
    let replyReadError = null;
    try {
      const rows = dialog.LB_REPLIES && dialog.LB_REPLIES.children;
      if (Array.isArray(rows)) {
        replies = rows.map((row) => {
          if (!row) return '<empty row>';
          if (typeof row.text === 'string') return row.text;
          if (row.text && typeof row.text.text === 'string') return row.text.text;
          if (typeof row.getText === 'function') return String(row.getText());
          if (row.node && typeof row.node.text === 'string') return row.node.text;
          return '<unreadable row: ' + Object.keys(row).slice(0, 8).join(',') + '>';
        });
      } else {
        replyReadError = 'LB_REPLIES.children is not an array';
      }
    } catch (error) {
      replyReadError = String(error && error.message || error);
    }
    let spoken = null;
    try { spoken = String(cm.lastSpokenString || ''); } catch (e) {}
    return {
      located: true,
      visible,
      engineMode: gs.Mode,
      state: cm.state,
      stateName: ['LISTENING_TO_SPEAKER', 'WAITING_FOR_PC_CHOICE', 'CONTINUE_DIALOG', 'END_DIALOG'][cm.state] ||
        (cm.state === -1 ? 'INVALID' : 'UNKNOWN:' + cm.state),
      repliesShown: dialog.LB_REPLIES ? dialog.LB_REPLIES.isVisible && dialog.LB_REPLIES.isVisible() : null,
      replies,
      replyReadError,
      spoken: spoken ? spoken.slice(0, 220) : null,
      currentEntrySkippable: cm.currentEntry ? cm.currentEntry.skippable === true : null,
      conversationName: cm.dialog && cm.dialog.resref ? String(cm.dialog.resref) : null,
    };
  })()`);
}

/**
 * Why a conversation will not advance.
 *
 * Reports whether each subject was located rather than only what it held: a
 * missing `currentEntry` and an entry whose replies are empty are different
 * faults with different fixes, and a bare null cannot tell them apart.
 */
async function diagnoseStalledDialogue(harness) {
  return harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const cm = gs.CutsceneManager;
    const out = { cutsceneManagerLocated: !!cm };
    if (!cm) return out;
    out.state = cm.state;
    out.engineMode = gs.Mode;
    out.cutsceneMode = cm.cutsceneMode;
    out.conversationType = cm.dialog && cm.dialog.getConversationType
      ? cm.dialog.getConversationType() : null;

    const entry = cm.currentEntry;
    out.currentEntryLocated = !!entry;
    if (entry) {
      out.currentEntry = {
        skippable: entry.skippable,
        repliesShown: entry.repliesShown,
        replyCount: Array.isArray(entry.replies) ? entry.replies.length : null,
        isSkipped: entry.checkList ? entry.checkList.isSkipped : null,
        checkListKeys: entry.checkList ? Object.keys(entry.checkList) : null,
        delay: entry.delay,
        text: String(entry.getCompiledString ? entry.getCompiledString() : '').slice(0, 160),
      };
      // What the replies actually are — an entry with replies that all fail
      // their conditions looks identical to an entry with none.
      if (Array.isArray(entry.replies)) {
        out.replyNodes = entry.replies.slice(0, 8).map((r, i) => ({
          index: i,
          isContinue: r && r.isContinueDialog ? r.isContinueDialog() : null,
          text: String(r && r.getCompiledString ? r.getCompiledString() : '').slice(0, 120),
        }));
      }
    }

    const dialog = gs.MenuManager && gs.MenuManager.InGameDialog;
    out.dialogMenuLocated = !!dialog;
    if (dialog) {
      out.dialogVisible = dialog.bVisible === true;
      const lb = dialog.LB_REPLIES;
      out.repliesListLocated = !!lb;
      if (lb) {
        out.repliesListVisible = lb.isVisible ? lb.isVisible() : null;
        out.repliesListItemCount = Array.isArray(lb.items) ? lb.items.length : null;
      }
    }

    // The audio emitter is what a listening entry normally waits on.
    out.audioEmitterLocated = !!cm.audioEmitter;
    return out;
  })()`);
}

/**
 * Plays a conversation to its end.
 *
 * `choose(replies, snapshot)` returns the index to pick; by default the first
 * reply, which is the fastest way through and is what a "just get past it"
 * pass wants. Returns a transcript so a run that stalls shows what was said.
 */
async function playDialogue(harness, { choose, maxTurns = 200, label = 'dialogue' } = {}) {
  const transcript = [];
  let idleTurns = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const snapshot = await dialogueSnapshot(harness);
    if (!snapshot.located) throw new Error(`${label}: ${snapshot.reason}`);
    if (!snapshot.visible) {
      return { finished: true, turns: turn, transcript };
    }

    if (snapshot.spoken && transcript[transcript.length - 1] !== snapshot.spoken) {
      transcript.push(snapshot.spoken);
    }

    // WAITING_FOR_PC_CHOICE (1) is the authority on "a choice is required".
    // Gating on the GUI list instead made an unreadable list look like no
    // choice at all, and the driver then skipped forever against a cleared
    // currentEntry.
    const awaitingChoice = snapshot.state === 1;
    const hasReplies = Array.isArray(snapshot.replies) && snapshot.replies.length > 0;
    if (awaitingChoice) {
      if (!hasReplies) {
        // Worth surfacing rather than silently picking 0: a conversation that
        // wants a choice but renders no rows is exactly the VR defect logged as
        // "the reply list is not reachable".
        transcript.push(`! awaiting choice with no readable replies` +
          (snapshot.replyReadError ? ` (${snapshot.replyReadError})` : ''));
      }
      const index = choose ? choose(snapshot.replies, snapshot) : 0;
      transcript.push(`> [${index}] ${snapshot.replies[index] ?? '<no rendered row>'}`);
      const picked = await harness.evaluate(
        `(() => { try { window.KotOR.GameState.CutsceneManager.selectReplyAtIndex(${Number(index)}); return { ok: true }; }
          catch (error) { return { ok: false, reason: String(error && error.message || error) }; } })()`,
      );
      if (!picked.ok) throw new Error(`${label}: selecting reply ${index} threw: ${picked.reason}`);
      idleTurns = 0;
    } else {
      // Listening. Skip the line rather than waiting out its audio.
      await harness.evaluate(
        `(() => { const cm = window.KotOR.GameState.CutsceneManager;
          try { cm.playerSkipEntry(cm.currentEntry); } catch (e) {} return true; })()`,
      );
      idleTurns += 1;
      // An unskippable line has to be waited out; only give up if nothing at all
      // changes for a long stretch, which is a genuine stall rather than a slow line.
      if (idleTurns > 60) {
        const deep = await diagnoseStalledDialogue(harness);
        throw new Error(`${label}: stalled for ${idleTurns} turns; ` +
          `state=${snapshot.state} conversation=${snapshot.conversationName} ` +
          `last="${snapshot.spoken}"
  diagnosis=${JSON.stringify(deep, null, 2)}`);
      }
    }
    await sleep(500);
  }
  throw new Error(`${label}: did not end within ${maxTurns} turns; transcript=${JSON.stringify(transcript.slice(-8))}`);
}

/**
 * What is in the current area and what VR can do with it.
 *
 * Reports counts AND whether each collection was located, because "0 doors"
 * and "never found the area" have repeatedly been confused in this project.
 * Interactables are described through the VR world-prompt route so the survey
 * reflects what the player can actually reach, not what merely exists.
 */
async function surveyArea(harness) {
  return harness.evaluate(`(() => {
    const K = window.KotOR;
    const gs = K.GameState;
    const area = gs.module && gs.module.area;
    if (!area) return { located: false, reason: 'no area' };
    const player = K.PartyManager.party[0];
    if (!player) return { located: false, reason: 'no player' };

    const near = (o) => {
      try { return +player.position.distanceTo(o.position).toFixed(2); }
      catch (e) { return null; }
    };
    const describe = (o, kind) => {
      let name = null;
      try { name = String((o.getName && o.getName()) || ''); } catch (e) {}
      return {
        kind,
        id: o.id,
        tag: String(o.tag || ''),
        name,
        distance: near(o),
        locked: typeof o.isLocked === 'function' ? !!o.isLocked() : null,
        dead: typeof o.isDead === 'function' ? !!o.isDead() : null,
        hostile: typeof o.isHostile === 'function' ? !!o.isHostile(player) : null,
      };
    };

    const doors = (area.doors || []).map((d) => describe(d, 'door'));
    const placeables = (area.placeables || []).map((p) => describe(p, 'placeable'));
    const creatures = (area.creatures || []).map((c) => describe(c, 'creature'));
    const triggers = (area.triggers || []).map((t) => describe(t, 'trigger'));

    const sortByDistance = (a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9);
    return {
      located: true,
      areaName: String(area.name || ''),
      playerPosition: {
        x: +player.position.x.toFixed(2),
        y: +player.position.y.toFixed(2),
        z: +player.position.z.toFixed(2),
      },
      counts: {
        doors: doors.length,
        placeables: placeables.length,
        creatures: creatures.length,
        triggers: triggers.length,
      },
      hostiles: creatures.filter((c) => c.hostile && !c.dead).sort(sortByDistance),
      nearestDoors: doors.sort(sortByDistance).slice(0, 10),
      nearestPlaceables: placeables.sort(sortByDistance).slice(0, 12),
      nearestTriggers: triggers.sort(sortByDistance).slice(0, 8),
    };
  })()`, { timeoutMs: 60000 });
}

/**
 * Every object VR currently offers a world prompt for, and what each prompt
 * offers — driven through getWorldActionPromptContext, so an action missing
 * here is an action missing in the headset.
 *
 * `createPrompt` is the same call VRSpike makes, and action closures are never
 * invoked, only described.
 */
async function listWorldPrompts(harness) {
  return harness.evaluate(`(() => {
    const spike = window.KotOR.VRSpike;
    const hooks = spike && spike.hooks;
    if (!hooks || typeof hooks.getWorldActionPromptContext !== 'function') {
      return { located: false, reason: 'no getWorldActionPromptContext hook' };
    }
    const context = hooks.getWorldActionPromptContext();
    if (!context) return { located: false, reason: 'hook returned null (no actor or no module?)' };
    const candidates = Array.isArray(context.candidates) ? context.candidates : [];
    // Which pool the object came from. navigateTo must open DOORS, not any
    // usable thing in range — without this it kept re-opening a container and
    // called that progress.
    const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
    const idsOf = (pool) => new Set((Array.isArray(pool) ? pool : []).map((o) => o && o.id));
    const doorIds = idsOf(area && area.doors);
    const placeableIds = idsOf(area && area.placeables);
    const kindOf = (promptId) => {
      const match = /^module-object:(\d+)$/.exec(String(promptId));
      const numeric = match ? Number(match[1]) : null;
      if (numeric === null) return 'unknown';
      if (doorIds.has(numeric)) return 'door';
      if (placeableIds.has(numeric)) return 'placeable';
      return 'other';
    };
    const described = candidates.map((candidate) => {
      const row = {
        id: String(candidate.id),
        kind: kindOf(candidate.id),
        name: String(candidate.name || ''),
        distance: +Number(candidate.actorDistanceMetres).toFixed(2),
        hasActions: candidate.hasActions === true,
        inRange: candidate.inRange === true,
        actions: null,
        promptError: null,
      };
      try {
        const model = context.createPrompt(candidate);
        if (!model) { row.promptError = 'createPrompt returned null'; return row; }
        row.actions = (model.pages || []).flatMap((page) =>
          (page.entries || [])
            .filter((entry) => entry.kind === 'action')
            .map((entry) => entry.label));
      } catch (error) {
        row.promptError = String(error && error.message || error);
      }
      return row;
    });
    return {
      located: true,
      actorLocated: !!context.actor,
      candidateCount: candidates.length,
      prompts: described.sort((a, b) => a.distance - b.distance),
    };
  })()`, { timeoutMs: 60000 });
}

/**
 * Activates a named action on a named object through the VR world-prompt route.
 *
 * Matching is by object id and action label so a run reads as a walkthrough
 * rather than as index arithmetic, and a renamed action fails loudly with the
 * list of what was actually offered.
 */
async function activateWorldAction(harness, { objectId, actionLabel }) {
  const wantedId = JSON.stringify(String(objectId));
  const wantedLabel = JSON.stringify(String(actionLabel).toLowerCase());

  const outcome = await harness.evaluate(`(() => {
    const hooks = window.KotOR.VRSpike && window.KotOR.VRSpike.hooks;
    if (!hooks || typeof hooks.getWorldActionPromptContext !== 'function') {
      return { ok: false, reason: 'no getWorldActionPromptContext hook' };
    }
    const context = hooks.getWorldActionPromptContext();
    if (!context) return { ok: false, reason: 'prompt context unavailable' };

    const candidates = Array.isArray(context.candidates) ? context.candidates : [];
    const candidate = candidates.find((c) => String(c.id) === ${wantedId});
    if (!candidate) {
      return {
        ok: false,
        reason: 'no prompt candidate with that id',
        offered: candidates.map((c) => String(c.id) + ':' + String(c.name || '')),
      };
    }

    let model = null;
    try { model = context.createPrompt(candidate); }
    catch (error) { return { ok: false, reason: 'createPrompt threw: ' + String(error && error.message || error) }; }
    if (!model) return { ok: false, reason: 'createPrompt returned null for ' + String(candidate.name || '') };

    const actions = (model.pages || []).flatMap((page) =>
      (page.entries || []).filter((entry) => entry.kind === 'action'));
    const action = actions.find((entry) => String(entry.label).toLowerCase() === ${wantedLabel});
    if (!action) {
      return {
        ok: false,
        reason: 'action not offered on ' + String(candidate.name || ''),
        offered: actions.map((entry) => entry.label),
      };
    }

    // Revalidate first: the prompt model is a snapshot, and activating a route
    // the engine would now refuse is how a stale action silently does nothing.
    let valid = false;
    try { valid = action.revalidate() === true; }
    catch (error) { return { ok: false, reason: 'revalidate threw: ' + String(error && error.message || error) }; }
    if (!valid) return { ok: false, reason: 'action ' + String(action.label) + ' failed revalidation' };

    try { action.activate(); }
    catch (error) { return { ok: false, reason: 'activate threw: ' + String(error && error.message || error) }; }
    return { ok: true, object: String(candidate.name || ''), action: String(action.label) };
  })()`);

  if (!outcome.ok) {
    throw new Error(`activate "${actionLabel}" on ${objectId}: ${outcome.reason}` +
      (outcome.offered ? ` (offered: ${JSON.stringify(outcome.offered)})` : ''));
  }
  return outcome;
}

/**
 * Counts how often the player's update actually runs.
 *
 * Wrapped and sampled rather than reasoned about: every gate inside
 * ModuleCreature.update can pass while update() itself is never reached, and
 * those two look identical from the outside.
 */
async function countPlayerUpdates(harness, millis = 2000) {
  await harness.evaluate(`(() => {
    const player = window.KotOR.PartyManager.party[0];
    if (!player) return false;
    window.__updateCounts = { update: 0, updateActionQueue: 0 };
    const origUpdate = player.update.bind(player);
    const origQueue = player.updateActionQueue.bind(player);
    player.update = function (delta) { window.__updateCounts.update++; return origUpdate(delta); };
    player.updateActionQueue = function (delta) { window.__updateCounts.updateActionQueue++; return origQueue(delta); };
    window.__restoreUpdates = () => { delete player.update; delete player.updateActionQueue; };
    return true;
  })()`);
  await sleep(millis);
  return harness.evaluate(
    `(() => { const c = window.__updateCounts; try { window.__restoreUpdates(); } catch (e) {} return c; })()`,
  );
}

/**
 * The party's inventory and what the player has equipped.
 *
 * Reports whether it located the party at all, not just counts: this project
 * has twice mistaken a probe reading the wrong object (GameState.player, which
 * does not exist — the player is PartyManager.party[0]) for an empty inventory.
 */
async function describeInventory(harness) {
  return harness.evaluate(`(() => {
    const K = window.KotOR;
    const party = K.PartyManager;
    if (!party) return { located: false, reason: 'no PartyManager' };
    const player = party.party ? party.party[0] : null;
    if (!player) return { located: false, reason: 'no player at party[0]' };

    const nameOf = (item) => {
      if (!item) return null;
      try { return String((item.getName && item.getName()) || item.tag || item.templateResRef || '?'); }
      catch (e) { return '<unreadable>'; }
    };

    let inventory = [];
    let inventoryError = null;
    try {
      const raw = typeof party.getInventory === 'function'
        ? party.getInventory()
        : (player.getInventory ? player.getInventory() : null);
      if (Array.isArray(raw)) {
        inventory = raw.map((item) => ({ name: nameOf(item), stack: item && item.stackSize }));
      } else {
        inventoryError = 'inventory is not an array: ' + typeof raw;
      }
    } catch (error) {
      inventoryError = String(error && error.message || error);
    }

    const equipped = {};
    try {
      const slots = player.equipment || {};
      for (const slot of Object.keys(slots)) {
        if (slots[slot]) equipped[slot] = nameOf(slots[slot]);
      }
    } catch (e) { /* leave equipped partial */ }

    return {
      located: true,
      playerName: nameOf(player),
      credits: party.Gold,
      inventoryCount: inventory.length,
      inventory: inventory.slice(0, 30),
      inventoryError,
      equipped,
      canLevelUp: typeof player.canLevelUp === 'function' ? !!player.canLevelUp() : null,
      level: player.getTotalClassLevel ? player.getTotalClassLevel() : null,
      xp: player.getXP ? player.getXP() : null,
      hp: player.getHP ? player.getHP() : null,
      maxHp: player.getMaxHP ? player.getMaxHP() : null,
    };
  })()`, { timeoutMs: 60000 });
}

/**
 * Walks the player with the engine's own ActionMoveToPoint and waits for
 * arrival.
 *
 * Traversal only. Every *interaction* in this driver goes through the VR
 * world-prompt route, because that is what is under test; walking is the
 * engine's pathfinding and walkmesh, which VR does not replace.
 */
async function moveTo(harness, { x, y, z, range = 1.2, timeoutMs = 90000, label = 'destination' }) {
  const started = await harness.evaluate(`(() => {
    const K = window.KotOR;
    const gs = K.GameState;
    const player = K.PartyManager.party[0];
    if (!player) return { ok: false, reason: 'no player' };
    // Drop any stale move first. A failed leg leaves its ActionMoveToPoint
    // queued, and a second one behind it never runs — the player then sits
    // still while the driver reports "did not arrive", which looks like the
    // walkmesh is blocked when it is really a queue the driver dirtied.
    const stale = player.actionQueue.length;
    try { player.clearAllActions(); } catch (e) { /* best effort */ }
    const action = new gs.ActionFactory.ActionMoveToPoint();
    const P = K.ActionParameterType || { FLOAT: 2, DWORD: 4, INT: 3 };
    action.setParameter(0, P.FLOAT, ${Number(x)});
    action.setParameter(1, P.FLOAT, ${Number(y)});
    action.setParameter(2, P.FLOAT, ${Number(z)});
    action.setParameter(3, P.DWORD, gs.module.area.id);
    action.setParameter(5, P.INT, 1);
    action.setParameter(6, P.FLOAT, ${Number(range)});
    action.setParameter(8, P.FLOAT, 60.0);
    player.actionQueue.add(action);
    return { ok: true, clearedStale: stale, from: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2) } };
  })()`);
  if (!started.ok) throw new Error(`moveTo ${label}: ${started.reason}`);

  // Poll rather than one long waitFor: a confirmation modal suspends gameplay,
  // so the walk simply stops with its move still queued. Clearing it as it
  // appears is the difference between "arrived" and a spurious pathfinding bug.
  const deadline = Date.now() + timeoutMs;
  let arrived = false;
  try {
    while (Date.now() < deadline) {
      await clearBlockingModal(harness);
      arrived = await harness.evaluate(`(() => {
        const player = window.KotOR.PartyManager.party[0];
        if (!player) return false;
        const dx = player.position.x - ${Number(x)};
        const dy = player.position.y - ${Number(y)};
        return Math.sqrt(dx * dx + dy * dy) <= ${Number(range) + 0.6};
      })()`);
      if (arrived) break;
      await sleep(1000);
    }
    if (!arrived) throw new Error('timeout');
  } catch (error) {
    const where = await harness.evaluate(`(() => {
      const player = window.KotOR.PartyManager.party[0];
      const dx = player.position.x - ${Number(x)};
      const dy = player.position.y - ${Number(y)};
      return {
        at: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2) },
        remaining: +Math.sqrt(dx * dx + dy * dy).toFixed(2),
        queued: (player.actionQueue || []).length,
        action: player.action ? (player.action.constructor ? player.action.constructor.name : '?') : null,
      };
    })()`);
    throw new Error(`moveTo ${label}: did not arrive — ${JSON.stringify(where)}`);
  }

  return harness.evaluate(`(() => {
    const player = window.KotOR.PartyManager.party[0];
    return { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2) };
  })()`);
}

/**
 * Clears a blocking confirmation modal, reporting what it said.
 *
 * `InGameConfirm` sits on the modal stack and suspends gameplay, so a walk that
 * runs into one simply stops with its move still queued — which reads as
 * "pathfinding stalled" and is not. Always says what the modal contained, so a
 * dismissed prompt is never silently lost from the record.
 */
async function clearBlockingModal(harness) {
  const outcome = await harness.evaluate(`(() => {
    const menus = window.KotOR.GameState.MenuManager;
    const confirm = menus && menus.InGameConfirm;
    if (!confirm || confirm.bVisible !== true) return { present: false };

    let message = null;
    try {
      for (const key of Object.keys(confirm)) {
        if (!/^LBL_/.test(key)) continue;
        const control = confirm[key];
        const text = control && control.text && typeof control.text.text === 'string'
          ? control.text.text : null;
        if (text && text.trim()) { message = key + ': ' + text.trim().slice(0, 200); break; }
      }
    } catch (e) { message = '<unreadable>'; }

    const ok = confirm.BTN_OK;
    if (!ok) return { present: true, message, dismissed: false, reason: 'no BTN_OK' };
    try { ok.click(); } catch (error) {
      return { present: true, message, dismissed: false, reason: String(error && error.message || error) };
    }
    return { present: true, message, dismissed: true };
  })()`);
  if (outcome.present) {
    line(`  · confirm modal ${outcome.dismissed ? 'accepted' : 'NOT dismissed'}: ${outcome.message || '<no text found>'}` +
      (outcome.reason ? ` (${outcome.reason})` : ''));
  }
  return outcome;
}

/**
 * Locates a live object by tag, so a walkthrough reads by name rather than by
 * object id — ids shift between saves, tags do not.
 */
async function findObjectByTag(harness, tag) {
  const wanted = JSON.stringify(String(tag).toLowerCase());
  const found = await harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const area = gs.module && gs.module.area;
    if (!area) return { located: false, reason: 'no area' };
    const player = window.KotOR.PartyManager.party[0];
    const pools = [
      ['placeable', area.placeables],
      ['door', area.doors],
      ['creature', area.creatures],
      ['trigger', area.triggers],
    ];
    const matches = [];
    for (const [kind, pool] of pools) {
      if (!Array.isArray(pool)) continue;
      for (const object of pool) {
        if (!object) continue;
        if (String(object.tag || '').toLowerCase() !== ${wanted}) continue;
        matches.push({
          kind,
          id: object.id,
          promptId: 'module-object:' + object.id,
          tag: String(object.tag || ''),
          name: (() => { try { return String((object.getName && object.getName()) || ''); } catch (e) { return ''; } })(),
          position: {
            x: +object.position.x.toFixed(2),
            y: +object.position.y.toFixed(2),
            z: +object.position.z.toFixed(2),
          },
          distance: player ? +player.position.distanceTo(object.position).toFixed(2) : null,
          locked: typeof object.isLocked === 'function' ? !!object.isLocked() : null,
        });
      }
    }
    return { located: matches.length > 0, matches };
  })()`);
  if (!found.located) {
    throw new Error(`no object tagged "${tag}" in this area${found.reason ? ` (${found.reason})` : ''}`);
  }
  return found.matches;
}

/** Every door in the area with its state, nearest first. */
async function listDoors(harness) {
  return harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const area = gs.module && gs.module.area;
    const player = window.KotOR.PartyManager.party[0];
    if (!area || !player) return { located: false, reason: 'no area or player' };
    const doors = (area.doors || []).filter(Boolean).map((door) => ({
      id: door.id,
      promptId: 'module-object:' + door.id,
      tag: String(door.tag || ''),
      name: (() => { try { return String((door.getName && door.getName()) || ''); } catch (e) { return ''; } })(),
      open: typeof door.isOpen === 'function' ? !!door.isOpen() : null,
      locked: typeof door.isLocked === 'function' ? !!door.isLocked() : null,
      plot: !!door.plot,
      min1HP: !!door.min1HP,
      notBlastable: !!door.notBlastable,
      position: {
        x: +door.position.x.toFixed(2),
        y: +door.position.y.toFixed(2),
        z: +door.position.z.toFixed(2),
      },
      distance: +player.position.distanceTo(door.position).toFixed(2),
    }));
    doors.sort((a, b) => a.distance - b.distance);
    return { located: true, doors };
  })()`, { timeoutMs: 60000 });
}

/** Straight-line distance from the player to a point, ignoring height. */
async function distanceTo(harness, x, y) {
  return harness.evaluate(`(() => {
    const player = window.KotOR.PartyManager.party[0];
    if (!player) return null;
    const dx = player.position.x - ${Number(x)};
    const dy = player.position.y - ${Number(y)};
    return +Math.sqrt(dx * dx + dy * dy).toFixed(2);
  })()`);
}

/**
 * Walks to a point, opening whatever doors block the way.
 *
 * `moveTo` alone walks until the walkmesh runs out and then sits there with its
 * move still queued, which is indistinguishable from broken pathfinding. Peragus
 * is a series of rooms behind doors, so traversal needs the loop: walk, and when
 * progress stops, open the nearest blocking door through its VR prompt and
 * continue.
 *
 * Opening the door goes through the real world-prompt route deliberately —
 * traversal is scaffolding, but every door opened on the way is itself a test of
 * the thing under test.
 *
 * Gives up when an attempt neither closed distance nor opened anything, rather
 * than looping until the timeout: no progress and no door is a real dead end and
 * should be reported as one, with what was in range at the time.
 */
async function navigateTo(harness, { x, y, z, range = 1.6, label = 'destination', maxAttempts = 8 }) {
  const opened = [];
  // Opening the same door twice is never progress; without this the loop burned
  // every attempt re-using one object and reported that as "opened" eight times.
  const openedIds = new Set();
  let previousDistance = await distanceTo(harness, x, y);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const arrived = await moveTo(harness, { x, y, z, range, label, timeoutMs: 45000 });
      line(`  · reached ${label} after ${attempt} leg(s)${opened.length ? `, opening ${opened.join(', ')}` : ''}`);
      return { arrived, opened, legs: attempt };
    } catch (error) {
      const remaining = await distanceTo(harness, x, y);
      const progressed = previousDistance !== null && remaining !== null &&
        remaining < previousDistance - 0.5;
      previousDistance = remaining;

      await clearBlockingModal(harness);

      // The walk stops where the walkmesh ends, which is rarely right next to
      // the door in the way — so find the nearest closed door in the AREA, walk
      // to it, and only then open it. Filtering on what is already in prompt
      // range never saw a door 16m off and reported a dead end instead.
      const inventory = await listDoors(harness);
      if (!inventory.located) throw new Error(`navigateTo ${label}: ${inventory.reason}`);
      // Try candidates in distance order rather than committing to the nearest.
      // The nearest closed door is often a plot door that can never open, and
      // fixating on it reported a dead end while a usable route stood behind it.
      const candidates = inventory.doors.filter((door) =>
        !door.open && !openedIds.has(door.promptId));

      if (!candidates.length) {
        if (progressed) continue;
        const prompts = await listWorldPrompts(harness);
        throw new Error(`navigateTo ${label}: stopped ${remaining}m short and every door is already open. ` +
          `In range: ${JSON.stringify((prompts.prompts || []).map((p) =>
            `${p.name}@${p.distance}m inRange=${p.inRange} actions=${(p.actions || []).join('|')}`))}`);
      }

      let blocker = null;
      let action = null;
      const rejected = [];
      for (const door of candidates.slice(0, 4)) {
        try {
          if (door.distance > 2.5) {
            await moveTo(harness, {
              x: door.position.x, y: door.position.y, z: door.position.z,
              range: 2.0, label: door.name, timeoutMs: 45000,
            });
            await sleep(1200);
            await clearBlockingModal(harness);
          }
        } catch (walkError) {
          rejected.push(`${door.name}: unreachable`);
          continue;
        }
        const prompts = await listWorldPrompts(harness);
        const offered = (prompts.prompts || []).find((p) => p.id === door.promptId);
        if (!offered || !offered.actions || !offered.actions.length) {
          rejected.push(`${door.name}: no action (locked=${door.locked} plot=${door.plot} ` +
            `notBlastable=${door.notBlastable} err=${offered && offered.promptError})`);
          openedIds.add(door.promptId);
          continue;
        }
        blocker = door;
        action = offered.actions.find((a) => /^use|open/i.test(a)) ||
          offered.actions.find((a) => /security/i.test(a)) ||
          offered.actions[0];
        break;
      }

      if (!blocker) {
        if (progressed) continue;
        throw new Error(`navigateTo ${label}: stopped ${remaining}m short; no closed door offered a way ` +
          `through. Tried: ${JSON.stringify(rejected)}`);
      }

      line(`  · ${remaining}m short; opening ${blocker.name} via "${action}"` +
        (rejected.length ? ` (skipped ${JSON.stringify(rejected)})` : ''));
      try {
        const prompts = await listWorldPrompts(harness);
        const offered = (prompts.prompts || []).find((p) => p.id === blocker.promptId);
        if (!offered || !offered.actions || !offered.actions.length) {
          // "No prompt on a locked door" is either correct (plot-locked, fails
          // closed per checklist E4) or the session-2 defect. Only the door's
          // own flags and the actor's skills can tell them apart, so report them.
          const why = await harness.evaluate(`(() => {
            const gs = window.KotOR.GameState;
            const area = gs.module.area;
            const door = (area.doors || []).find((d) => d && d.id === ${Number(blocker.id)});
            const player = window.KotOR.PartyManager.party[0];
            if (!door) return { located: false };
            let security = null;
            try { security = player.skills && player.skills[6] ? player.skills[6].rank : null; } catch (e) {}
            return {
              located: true,
              locked: typeof door.isLocked === 'function' ? !!door.isLocked() : null,
              lockable: !!door.lockable,
              keyRequired: !!door.keyRequired,
              keyName: String(door.keyName || ''),
              notBlastable: !!door.notBlastable,
              plot: !!door.plot,
              min1HP: !!door.min1HP,
              openLockDC: door.openLockDC,
              openLockDiffMod: door.openLockDiffMod,
              useable: typeof door.isUseable === 'function' ? door.isUseable() : null,
              staticFlag: !!door.static,
              playerSecurityRank: security,
              scripts: door.scripts ? Object.keys(door.scripts).filter((k) => !!door.scripts[k]) : null,
            };
          })()`);
          line(`  · ${blocker.name} properties: ${JSON.stringify(why)}`);
          // What ActionMenuManager itself offers for this door. If the engine
          // produces a Bash entry and the VR prompt shows nothing, the loss is
          // in the VR layer; if the engine offers nothing either, it is the
          // authored data or the lock rules.
          const engineOffers = await harness.evaluate(`(() => {
            const gs = window.KotOR.GameState;
            const area = gs.module.area;
            const door = (area.doors || []).find((d) => d && d.id === ${Number(blocker.id)});
            const actor = gs.getCurrentPlayer();
            if (!door || !actor) return { located: false };
            try {
              gs.ActionMenuManager.SetPC(actor);
              gs.ActionMenuManager.SetTarget(door);
              gs.ActionMenuManager.UpdateMenuActions();
            } catch (error) {
              return { located: true, threw: String(error && error.message || error) };
            }
            const panels = gs.ActionMenuManager.ActionPanels;
            const describe = (list) => (list || []).map((panel, index) => ({
              panel: index,
              actions: (panel && panel.actions ? panel.actions : []).map((entry) => ({
                actionType: entry && entry.action ? entry.action.type : null,
                talent: entry && entry.talent ? (entry.talent.name || entry.talent.label || 'talent') : null,
                icon: entry ? entry.icon : null,
              })),
            })).filter((p) => p.actions.length);
            return { located: true, targetPanels: describe(panels.targetPanels) };
          })()`);
          line(`  · engine action menu for ${blocker.name}: ${JSON.stringify(engineOffers)}`);
          throw new Error(`no VR action for ${blocker.name} while standing at it ` +
            `(locked=${blocker.locked}, err=${offered && offered.promptError}); in range: ` +
            JSON.stringify((prompts.prompts || []).map((p) => `${p.name}@${p.distance}m inRange=${p.inRange}`)));
        }
        // Prefer a plain open over Bash — bashing a door Security would have
        // opened is a different, noisier playthrough.
        const action = offered.actions.find((a) => /^use|open/i.test(a)) ||
          offered.actions.find((a) => /security/i.test(a)) ||
          offered.actions[0];
        line(`  · opening ${blocker.name} via "${action}"`);
        await activateWorldAction(harness, { objectId: blocker.promptId, actionLabel: action });
        openedIds.add(blocker.promptId);
        opened.push(`${blocker.name}(${action})`);
        await sleep(2500);
        await clearBlockingModal(harness);
      } catch (activationError) {
        throw new Error(`navigateTo ${label}: could not open ${blocker.name} — ${activationError.message}`);
      }
    }
  }
  throw new Error(`navigateTo ${label}: gave up after ${maxAttempts} legs; opened ${JSON.stringify(opened)}`);
}

/**
 * Builds the VR action wheel for a target and describes it.
 *
 * Goes through `hooks.createActionWheel`, the same call VRSpike makes when the
 * player holds the wheel button, so this reflects ROADMAP 4.8's real structure:
 * six top-level items, with Attacks and Force Powers as submenus over the
 * panels ActionMenuManager already filtered.
 */
async function describeActionWheel(harness, targetId) {
  const numeric = targetId === null || targetId === undefined ? 'null' : Number(targetId);
  return harness.evaluate(`(() => {
    const hooks = window.KotOR.VRSpike && window.KotOR.VRSpike.hooks;
    if (!hooks || typeof hooks.createActionWheel !== 'function') {
      return { located: false, reason: 'no createActionWheel hook' };
    }
    const menu = hooks.createActionWheel(${numeric});
    if (!menu) return { located: false, reason: 'createActionWheel returned null' };
    const describe = (definition) => (definition.pages || []).flatMap((page) =>
      (page.entries || [])
        .filter((entry) => entry.kind === 'action' || entry.kind === 'submenu')
        .map((entry) => ({ kind: entry.kind, id: entry.id, label: entry.label })));
    const top = describe(menu);
    const submenus = {};
    for (const page of menu.pages || []) {
      for (const entry of page.entries || []) {
        if (entry.kind !== 'submenu') continue;
        try { submenus[entry.id] = describe(entry.buildMenu()); }
        catch (error) { submenus[entry.id] = 'threw: ' + String(error && error.message || error); }
      }
    }
    return { located: true, pageCount: (menu.pages || []).length, top, submenus };
  })()`, { timeoutMs: 60000 });
}

/**
 * Activates one entry of the action wheel, optionally inside a submenu.
 *
 * Matched by label so a walkthrough reads as what the player picked, and a
 * renamed or absent entry fails loudly with what was on offer.
 */
async function activateWheelAction(harness, { targetId, submenuId = null, actionLabel }) {
  const numeric = targetId === null || targetId === undefined ? 'null' : Number(targetId);
  const wantedSubmenu = submenuId === null ? 'null' : JSON.stringify(String(submenuId));
  const wantedLabel = JSON.stringify(String(actionLabel).toLowerCase());

  const outcome = await harness.evaluate(`(() => {
    const hooks = window.KotOR.VRSpike && window.KotOR.VRSpike.hooks;
    if (!hooks || typeof hooks.createActionWheel !== 'function') {
      return { ok: false, reason: 'no createActionWheel hook' };
    }
    const menu = hooks.createActionWheel(${numeric});
    if (!menu) return { ok: false, reason: 'createActionWheel returned null' };

    const entriesOf = (definition) => (definition.pages || []).flatMap((page) =>
      (page.entries || []).filter((entry) => entry.kind === 'action' || entry.kind === 'submenu'));

    let scope = menu;
    const submenuId = ${wantedSubmenu};
    if (submenuId) {
      const submenu = entriesOf(menu).find((entry) => entry.kind === 'submenu' && entry.id === submenuId);
      if (!submenu) {
        return {
          ok: false,
          reason: 'no submenu ' + submenuId,
          offered: entriesOf(menu).map((entry) => entry.id + ':' + entry.label),
        };
      }
      try { scope = submenu.buildMenu(); }
      catch (error) { return { ok: false, reason: 'buildMenu threw: ' + String(error && error.message || error) }; }
    }

    const actions = entriesOf(scope).filter((entry) => entry.kind === 'action');
    const action = actions.find((entry) => String(entry.label).toLowerCase() === ${wantedLabel});
    if (!action) {
      return { ok: false, reason: 'action not on the wheel', offered: actions.map((entry) => entry.label) };
    }
    let valid = false;
    try { valid = action.revalidate() === true; }
    catch (error) { return { ok: false, reason: 'revalidate threw: ' + String(error && error.message || error) }; }
    if (!valid) return { ok: false, reason: 'action failed revalidation: ' + action.label };
    try { action.activate(); }
    catch (error) { return { ok: false, reason: 'activate threw: ' + String(error && error.message || error) }; }
    return { ok: true, action: action.label };
  })()`, { timeoutMs: 60000 });

  if (!outcome.ok) {
    throw new Error(`wheel "${actionLabel}"${submenuId ? ` in ${submenuId}` : ''}: ${outcome.reason}` +
      (outcome.offered ? ` (offered: ${JSON.stringify(outcome.offered)})` : ''));
  }
  return outcome;
}

/**
 * Delivers one roll-eligible swing at a target through the engine's combat
 * bridge.
 *
 * **Test boundary, stated plainly.** This drives `getCombatContext(...)
 * .onCombatSwing`, which is the handler a recognised gesture calls. It exercises
 * target nomination, the armed attack stance (ROADMAP 4.8) and the whole d20
 * path. It does NOT exercise gesture *recognition* — the speed gate, the blade
 * sample point, the two-handed grip — which VRCombatInputController's unit tests
 * cover and which ultimately needs a headset (checklist F1-F3).
 *
 * Driving it this way rather than animating the emulated controller is
 * deliberate: aiming the interaction ray from outside is fragile, and a swing
 * that missed because the ray drifted would read as combat being broken.
 */
async function swingAt(harness, targetId) {
  return harness.evaluate(`(() => {
    const spike = window.KotOR.VRSpike;
    const hooks = spike && spike.hooks;
    if (!hooks || typeof hooks.getCombatContext !== 'function') {
      return { ok: false, reason: 'no getCombatContext hook' };
    }
    // Drop any queued movement first. ActionCombat goes on the back of the
    // queue, so a move still at the front blocks it forever — the swing is
    // accepted, nothing happens, and it reads as combat being broken. This is
    // the driver's own approach move, not something a player would have.
    try {
      const player = window.KotOR.PartyManager.party[0];
      if (player && player.actionQueue && player.actionQueue.length) {
        player.clearAllActions();
      }
    } catch (e) { /* best effort */ }
    const context = hooks.getCombatContext(${Number(targetId)});
    if (!context) return { ok: false, reason: 'combat context unavailable' };
    if (!context.nominatedTargetId) {
      return { ok: false, reason: 'target not nominated (out of range, or not a valid combat target)' };
    }
    try {
      context.onCombatSwing({
        actorId: context.actorId,
        nominatedTargetId: context.nominatedTargetId,
        hand: 'right',
        weaponMode: context.weaponMode,
        speedMetresPerSecond: 3.0,
        rollEligible: true,
        pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
        timestamp: performance.now(),
      });
    } catch (error) {
      return { ok: false, reason: 'onCombatSwing threw: ' + String(error && error.message || error) };
    }
    return {
      ok: true,
      weaponMode: context.weaponMode,
      inCombat: context.inCombat === true,
      stance: context.stanceReadout || null,
    };
  })()`, { timeoutMs: 60000 });
}

/**
 * Fights one hostile to the death: approach into combat range, arm the plain
 * stance from the wheel's Attacks page, then swing until it drops.
 *
 * Returns `{ killed: false, reason }` rather than throwing when a specific foe
 * cannot be engaged, so a sweep can move on to the next one and report what it
 * skipped instead of stopping at the first awkward target.
 */
async function fightHostile(harness, target) {
  const position = await harness.evaluate(`(() => {
    const area = window.KotOR.GameState.module.area;
    const c = (area.creatures || []).find((o) => o && o.id === ${Number(target.id)});
    if (!c) return null;
    return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) };
  })()`);
  if (!position) return { killed: false, reason: 'vanished before approach' };

  try {
    await navigateTo(harness, { ...position, range: 1.4, label: target.name, maxAttempts: 8 });
  } catch (error) {
    return { killed: false, reason: `unreachable: ${String(error.message).slice(0, 120)}` };
  }
  await sleep(1000);
  await clearBlockingModal(harness);

  // Arm the plain stance. 4.8: the Attacks page ARMS, it does not attack.
  try {
    const wheel = await describeActionWheel(harness, target.id);
    const attacks = wheel.located ? wheel.submenus['submenu:attacks'] : null;
    if (Array.isArray(attacks) && attacks.length) {
      await activateWheelAction(harness, {
        targetId: target.id, submenuId: 'submenu:attacks', actionLabel: attacks[0].label,
      });
    }
  } catch (error) {
    // A stance that will not arm is worth knowing about but does not stop the
    // fight — an unarmed swing is the plain attack anyway.
    line(`  · stance not armed for ${target.name}: ${String(error.message).slice(0, 100)}`);
  }

  for (let round = 0; round < 40; round += 1) {
    const status = await harness.evaluate(`(() => {
      const area = window.KotOR.GameState.module.area;
      const c = (area.creatures || []).find((o) => o && o.id === ${Number(target.id)});
      const player = window.KotOR.PartyManager.party[0];
      if (!c) return { gone: true };
      return {
        gone: false,
        dead: typeof c.isDead === 'function' ? !!c.isDead() : null,
        hp: c.getHP ? c.getHP() : null,
        playerHp: player.getHP ? player.getHP() : null,
      };
    })()`);
    if (status.gone || status.dead) return { killed: true, rounds: round };
    if (status.playerHp !== null && status.playerHp <= 0) {
      return { killed: false, reason: 'player died' };
    }

    let swung = await swingAt(harness, target.id);
    if (!swung.ok && /not nominated/.test(swung.reason || '')) {
      const now = await harness.evaluate(`(() => {
        const area = window.KotOR.GameState.module.area;
        const c = (area.creatures || []).find((o) => o && o.id === ${Number(target.id)});
        if (!c) return null;
        return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) };
      })()`);
      if (now) {
        try { await moveTo(harness, { ...now, range: 1.2, label: target.name, timeoutMs: 20000 }); }
        catch (e) { /* it may be closing on us anyway */ }
        swung = await swingAt(harness, target.id);
      }
    }
    if (!swung.ok && round === 0) return { killed: false, reason: swung.reason };
    await sleep(1200);
    await clearBlockingModal(harness);
  }
  return { killed: false, reason: 'still standing after 40 rounds' };
}

/** Fights every live hostile in the area, nearest first. */
async function clearHostiles(harness, { limit = 12 } = {}) {
  const outcomes = [];
  // A foe that cannot be engaged must be set aside, not stopped on: the survey
  // hands back the same nearest hostile every time, so breaking on the first
  // awkward one left the rest of the area alive.
  const skipped = new Set();
  for (let index = 0; index < limit; index += 1) {
    const survey = await surveyArea(harness);
    if (!survey.located) throw new Error(`survey: ${survey.reason}`);
    const next = (survey.hostiles || []).find((h) => !skipped.has(h.id));
    if (!next) break;
    const result = await fightHostile(harness, next);
    const stats = await describeInventory(harness);
    line(`  · ${next.name} (${next.distance}m): ${result.killed ? `killed in ${result.rounds} rounds` : `SKIPPED — ${result.reason}`}` +
      ` | xp=${stats.xp} hp=${stats.hp}/${stats.maxHp} canLevelUp=${stats.canLevelUp}`);
    outcomes.push({ name: next.name, ...result });
    if (!result.killed) skipped.add(next.id);
    if (result.reason === 'player died') break;
  }
  return outcomes;
}

/**
 * Returns the engine to gameplay after a menu interaction.
 *
 * Engine mode follows the current menu, so a screen left open holds the engine
 * in GUI mode — the player cannot move, and every subsequent navigation reports
 * its target as "unreachable". That is what a forgotten Exit looks like from
 * the outside, and it is indistinguishable from a pathfinding fault.
 */
async function returnToGameplay(harness) {
  const outcome = await harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const menus = gs.MenuManager;
    const closed = [];
    for (const name of ['MenuCharacter', 'MenuContainer', 'MenuEquipment', 'MenuInventory',
                        'MenuAbilities', 'MenuJournal', 'MenuMessages', 'MenuOptions',
                        'MenuLevelUp', 'MenuPartySelection']) {
      const menu = menus[name];
      if (menu && menu.bVisible) {
        try { menu.close(); closed.push(name); } catch (e) { closed.push(name + '(close threw)'); }
      }
    }
    // InGameOverlay is the menu that carries EngineMode.INGAME.
    try { if (!menus.InGameOverlay.bVisible) menus.InGameOverlay.open(); } catch (e) {}
    return { closed, mode: gs.Mode };
  })()`);
  if (outcome.closed.length) line(`  · closed ${JSON.stringify(outcome.closed)} (engineMode=${outcome.mode})`);
  await sleep(800);
  return outcome;
}

async function boot(harness, url) {
  line('  · launching');
  await harness.launch(url);
  await harness.waitFor(
    `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
    90_000,
  );
  await clickButtonByText(harness, 'OK');
  line('  · EULA accepted');
  await harness.waitFor(
    `document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`,
    TIMEOUTS.boot, 2000,
  );
  line('  · engine booted');
}

async function newGameThroughCharacterCreation(harness) {
  await waitForMenu(harness, 'MainMenu', TIMEOUTS.boot);
  line('  · main menu up');

  await clickGuiControl(harness, 'MainMenu', 'BTN_NEWGAME');
  await waitForMenu(harness, 'CharGenClass');
  line('  · class selection up');

  // Consular: the prologue's Force powers are the interesting case for the
  // action wheel's Force Powers page, and a Consular has some from level 1.
  await clickGuiControl(harness, 'CharGenClass', 'BTN_SEL3');
  await waitForMenu(harness, 'CharGenQuickOrCustom');
  const selectedClass = await harness.evaluate('window.KotOR.GameState.CharGenManager.selectedClass');
  line(`  · class chosen (selectedClass=${selectedClass})`);

  await clickGuiControl(harness, 'CharGenQuickOrCustom', 'QUICK_CHAR_BTN');
  await waitForMenu(harness, 'CharGenQuickPanel');
  line('  · quick character panel up');

  // Portrait step.
  await clickGuiControl(harness, 'CharGenQuickPanel', 'BTN_STEPNAME1');
  await waitForMenu(harness, 'CharGenPortCust');
  const portraitControls = await describeMenuControls(harness, 'CharGenPortCust');
  line(`  · portrait controls: ${JSON.stringify(portraitControls.clickable)}`);
  await clickGuiControl(harness, 'CharGenPortCust', 'BTN_ACCEPT');
  await waitForMenu(harness, 'CharGenQuickPanel');
  line('  · portrait accepted');

  // Name step.
  await clickGuiControl(harness, 'CharGenQuickPanel', 'BTN_STEPNAME2');
  await waitForMenu(harness, 'CharGenName');
  const nameControls = await describeMenuControls(harness, 'CharGenName');
  line(`  · name controls: ${JSON.stringify(nameControls.clickable)}`);
  const named = await harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const creature = gs.CharGenManager.selectedCreature;
    if (!creature) return { ok: false, reason: 'no selectedCreature' };
    try {
      creature.firstName = 'Exile';
      if (creature.template && creature.template.getFieldByLabel) {
        const field = creature.template.getFieldByLabel('FirstName');
        if (field && field.setValue) field.setValue('Exile');
      }
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error) };
    }
    return { ok: true, name: String(creature.firstName || '') };
  })()`);
  line(`  · name set: ${JSON.stringify(named)}`);
  // CharGenName's accept is END_BTN, not BTN_ACCEPT as on the portrait menu.
  await clickGuiControl(harness, 'CharGenName', 'END_BTN');
  await waitForMenu(harness, 'CharGenQuickPanel');
  line('  · name accepted');

  const beforeStats = await harness.evaluate(`(() => {
    const c = window.KotOR.GameState.CharGenManager.selectedCreature;
    if (!c) return { located: false };
    return {
      located: true,
      str: c.str, dex: c.dex, con: c.con, wis: c.wis, int: c.int, cha: c.cha,
      featCount: Array.isArray(c.feats) ? c.feats.length : null,
    };
  })()`);
  line(`  · rolled character: ${JSON.stringify(beforeStats)}`);
  if (!beforeStats.located) throw new Error('character creation produced no creature');
  if (!beforeStats.featCount) {
    // QUICK_CHAR_BTN sets the ability scores BEFORE looping the feat table, and
    // its whole body is wrapped in a catch that only console.logs. So "stats set
    // but no feats" is exactly what a throw partway through looks like. Walk the
    // same data the handler walks and report where it actually gives out.
    const diagnosis = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      const out = { selectedClass: gs.CharGenManager.selectedClass };
      try {
        const creatureClass = gs.SWRuleSet.classes[gs.CharGenManager.selectedClass];
        out.classLocated = !!creatureClass;
        if (!creatureClass) return out;
        out.savingThrowTable = String(creatureClass['savingthrowtable']);
        const label = out.savingThrowTable.toLowerCase();
        const table = gs.TwoDAManager.datatables.get(label);
        out.savingThrowTableLocated = !!table;
        out.savingThrowRow0 = table && table.rows ? !!table.rows[0] : null;
        const feats = gs.SWRuleSet.feats;
        out.featTableLocated = Array.isArray(feats);
        out.featTableLength = Array.isArray(feats) ? feats.length : null;
        if (Array.isArray(feats)) {
          let granted = 0, missingGetGranted = 0, threw = null;
          for (let i = 0; i < feats.length; i++) {
            const row = feats[i];
            if (!row || typeof row.getGranted !== 'function') { missingGetGranted++; continue; }
            try {
              if (row.getGranted(creatureClass) == 1) granted++;
            } catch (error) {
              if (!threw) threw = { index: i, message: String(error && error.message || error) };
            }
          }
          out.grantedCount = granted;
          out.rowsWithoutGetGranted = missingGetGranted;
          out.getGrantedThrew = threw;
          // getGranted switches on classData.skillstable against lowercase
          // literals. Report the raw value and a sample row's granted columns so
          // a case or naming mismatch is named rather than inferred.
          out.skillstableRaw = String(creatureClass.skillstable);
          const sample = feats.find(f => f && typeof f.getGranted === 'function');
          if (sample) {
            out.sampleGrantedFields = Object.keys(sample)
              .filter(k => /granted$/i.test(k))
              .slice(0, 20)
              .map(k => k + '=' + JSON.stringify(sample[k]));
            out.sampleGetGrantedResult = sample.getGranted(creatureClass);
          }
          // How many rows would be granted if the switch matched case-insensitively.
          const key = String(creatureClass.skillstable || '').toLowerCase() + 'Granted';
          out.lowercaseKeyTried = key;
          out.grantedIfCaseInsensitive = feats
            .filter(f => f && f[key] == 1).length;
        }
      } catch (error) {
        out.walkThrew = String(error && error.stack || error);
      }
      return out;
    })()`);
    line(`  · feat diagnosis: ${JSON.stringify(diagnosis)}`);
    throw new Error(`quick character granted no feats; diagnosis=${JSON.stringify(diagnosis)}`);
  }

  // Play.
  await clickGuiControl(harness, 'CharGenQuickPanel', 'BTN_STEPNAME3');
  line('  · starting game…');
  await waitForModule(harness, '001EBO');
  return { selectedClass, stats: beforeStats };
}

async function enterVrSession(harness) {
  const before = await worldState(harness);
  line(`  · before: mode=${before.engineMode} stack=${JSON.stringify(before.menuStack)} modals=${JSON.stringify(before.modalStack)}`);
  await harness.clickSelector('#vr-spike-button');
  await harness.waitFor(
    `!!(window.KotOR && window.KotOR.VRSpike && window.KotOR.VRSpike.isPresenting)`,
    TIMEOUTS.session, 500,
  );
  // Engine mode follows the current menu: InGameOverlay is the menu that
  // carries INGAME, so a state that cleared menus without reopening it leaves
  // gameplay input suppressed and locomotion silently doing nothing.
  const state = await worldState(harness);
  line(`  · after: mode=${state.engineMode} stack=${JSON.stringify(state.menuStack)} modals=${JSON.stringify(state.modalStack)}`);
  // 1 = INGAME, 3 = DIALOG. A new game drops straight into the opening
  // conversation, so DIALOG here is correct rather than a fault; anything else
  // means menus were cleared without reopening InGameOverlay, which leaves
  // gameplay input suppressed and locomotion silently doing nothing.
  if (state.engineMode !== 1 && state.engineMode !== 3) {
    throw new Error(`entered VR but engineMode=${state.engineMode} (want 1=INGAME or 3=DIALOG); ` +
      `foregroundMenu=${state.foregroundMenu}`);
  }
  return state;
}

async function checkpoint(harness, name) {
  const saved = await harness.evaluate(`(async () => {
    const K = window.KotOR;
    if (!K.GameState.module) return { ok: false, reason: 'no module to save' };
    try {
      await K.SaveGame.SaveCurrentGame(${JSON.stringify(`${CHECKPOINT_PREFIX} ${name}`)});
    } catch (error) {
      // The stack, not just the message: "undefined.toStruct" appears in
      // several unguarded export loops and the message alone cannot tell them
      // apart. Webpack line numbers are offset from source by roughly 10%, so
      // locate by symbol name rather than by line.
      return {
        ok: false,
        reason: String(error && error.message || error),
        stack: String(error && error.stack || '').split('\\n').slice(0, 12).join(' | '),
      };
    }
    return { ok: true };
  })()`, { timeoutMs: 120_000 });
  if (!saved.ok) {
    // Name the collection with the hole rather than reporting a bare
    // "undefined.toStruct". PartyManager.Export and FactionManager both walk
    // several arrays and call toStruct on every element without guarding.
    const diagnosis = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      const survey = (label, collection) => {
        // Maps as well as arrays: FactionManager.factions is a Map, and a
        // survey that only understood arrays reported it as "not located",
        // which reads as absent rather than as unexamined.
        let entries;
        if (Array.isArray(collection)) {
          entries = collection.map((value, index) => [index, value]);
        } else if (collection instanceof Map) {
          entries = Array.from(collection.entries());
        } else {
          return { label, located: false, type: typeof collection, isMap: false };
        }
        const holes = [];
        for (const [key, value] of entries) {
          if (!value || typeof value.toStruct !== 'function') {
            holes.push({ key: String(key), value: String(value) });
          }
        }
        return {
          label,
          located: true,
          kind: collection instanceof Map ? 'Map' : 'Array',
          length: entries.length,
          holes: holes.slice(0, 8),
        };
      };
      return {
        journal: survey('JournalManager.Entries', gs.JournalManager && gs.JournalManager.Entries),
        dialogMessages: survey('DialogMessageManager.Entries', gs.DialogMessageManager && gs.DialogMessageManager.Entries),
        feedback: survey('FeedbackMessageManager.Entries', gs.FeedbackMessageManager && gs.FeedbackMessageManager.Entries),
        factions: survey('FactionManager.factions', gs.FactionManager && gs.FactionManager.factions),
        // Save() also walks faction.reputations and reads .reputation before
        // calling .toStruct, so a hole there fails with a different message —
        // worth separating so the two are never confused.
        factionReputations: (() => {
          const map = gs.FactionManager && gs.FactionManager.factions;
          if (!(map instanceof Map)) return { located: false };
          const bad = [];
          for (const [id, faction] of map.entries()) {
            if (!faction) { bad.push({ id: String(id), why: 'faction undefined' }); continue; }
            const reps = faction.reputations;
            if (!Array.isArray(reps)) { bad.push({ id: String(id), why: 'reputations not an array: ' + typeof reps }); continue; }
            for (let i = 0; i < reps.length; i++) {
              if (!reps[i] || typeof reps[i].toStruct !== 'function') {
                bad.push({ id: String(id), index: i, why: 'reputation hole: ' + String(reps[i]) });
              }
            }
          }
          return { located: true, factionCount: map.size, problems: bad.slice(0, 10) };
        })(),
        npcSlots: (() => {
          const npcs = gs.PartyManager && gs.PartyManager.NPCS;
          if (!npcs) return { located: false };
          const max = gs.GameKey === 1 ? 9 : 12;
          const missing = [];
          for (let i = 0; i < max; i++) if (!npcs[i]) missing.push(i);
          return { located: true, expected: max, missing };
        })(),
        partySize: gs.PartyManager && gs.PartyManager.party ? gs.PartyManager.party.length : null,
        // The actual culprit, per the stack: actionQueueToActionList calls
        // toStruct on every index of action.parameters without guarding, and
        // setParameter writes at an index, so a producer that sets 1..3 without
        // 0 leaves a hole. Name the action type and index rather than patching
        // the writer blind — the producer may be the real bug.
        actionParameterHoles: (() => {
          const area = gs.module && gs.module.area;
          if (!area) return { located: false, reason: 'no area' };
          const pools = [
            ['creatures', area.creatures],
            ['placeables', area.placeables],
            ['doors', area.doors],
            ['party', gs.PartyManager && gs.PartyManager.party],
          ];
          const found = [];
          let scanned = 0;
          for (const [poolName, pool] of pools) {
            if (!Array.isArray(pool)) continue;
            for (const owner of pool) {
              const queue = owner && owner.actionQueue;
              if (!Array.isArray(queue)) continue;
              scanned++;
              for (let i = 0; i < queue.length; i++) {
                const action = queue[i];
                if (!action || !Array.isArray(action.parameters)) continue;
                for (let j = 0; j < action.parameters.length; j++) {
                  if (!action.parameters[j] || typeof action.parameters[j].toStruct !== 'function') {
                    found.push({
                      pool: poolName,
                      owner: String((owner.getName && owner.getName()) || owner.tag || owner.id),
                      actionIndex: i,
                      actionType: action.type,
                      actionClass: action.constructor ? action.constructor.name : '?',
                      paramCount: action.parameters.length,
                      holeIndex: j,
                    });
                  }
                }
              }
            }
          }
          return { located: true, ownersScanned: scanned, holes: found.slice(0, 12), holeCount: found.length };
        })(),
      };
    })()`);
    line(`  ! checkpoint "${name}" not written: ${saved.reason}`);
    if (saved.stack) line(`  ! stack: ${saved.stack}`);
    line(`  ! diagnosis: ${JSON.stringify(diagnosis)}`);
    // Close the LoadScreen SaveCurrentGame opened before it threw — otherwise it
    // stays foreground, engine mode goes to -1, and every later step reads as
    // broken for a reason that has nothing to do with it.
    await harness.evaluate(
      `(() => { try { window.KotOR.GameState.MenuManager.LoadScreen.close(); } catch (e) {} return true; })()`,
    );
    return { ...saved, diagnosis };
  }
  line(`  · checkpoint saved: ${CHECKPOINT_PREFIX} ${name}`);
  return saved;
}

async function resumeFromCheckpoint(harness, name) {
  // Wait for the main menu before touching anything. The boot movie queue ends
  // by calling MainMenu.Start() and SetEngineMode(GUI) (GameState.ts ~2444), so
  // loading before that lands gets the load stomped a couple of seconds later —
  // the module stays live but MainMenu is pushed on top of InGameOverlay and the
  // engine drops back to GUI mode.
  await waitForMenu(harness, 'MainMenu', TIMEOUTS.boot);

  const loaded = await harness.evaluate(`(async () => {
    const K = window.KotOR;
    const gs = K.GameState;
    await K.SaveGame.GetSaveGames();
    const wanted = ${JSON.stringify(`${CHECKPOINT_PREFIX} ${name}`)}.toLowerCase();
    // getSaveName(), not getName(): the latter is the folder display name and
    // reads back empty, which makes every checkpoint look absent.
    const all = K.SaveGame.saves.map(s => String(
      (s.getSaveName && s.getSaveName()) || s.SAVEGAMENAME || ''
    ));
    const index = all.findIndex(n => n.trim().toLowerCase() === wanted);
    if (index < 0) return { ok: false, reason: 'no checkpoint named ' + wanted, available: all };
    // MenuSaveLoad's exact LOADGAME sequence. Calling load() with the menu's
    // module still standing leaves the engine in GUI mode and never lands.
    gs.MenuManager.ClearMenus();
    if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
    Promise.resolve(K.SaveGame.saves[index].load()).catch(() => undefined);
    return { ok: true, index, name: all[index] };
  })()`, { timeoutMs: 120_000 });
  if (!loaded.ok) {
    throw new Error(`${loaded.reason}; available: ${JSON.stringify(loaded.available)}`);
  }
  // Wait for module + player, but NOT for an engine mode yet: a scripted load
  // does not open InGameOverlay by itself, and engine mode follows the current
  // menu, so gating on INGAME here would wait forever on a load that landed.
  await harness.waitFor(`(() => {
    const gs = window.KotOR.GameState;
    const party = window.KotOR.PartyManager;
    const player = party && party.party ? party.party[0] : null;
    return !!(gs && gs.module && player && player.position && Number.isFinite(player.position.x));
  })()`, TIMEOUTS.moduleLoad, 3000);

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
  })()`, { timeoutMs: 90000 });

  // InGameOverlay is the menu that carries EngineMode.INGAME. A scripted load
  // leaves it closed, so gameplay input stays suppressed and locomotion
  // silently does nothing — the same trap collect.js works around.
  const mode = await harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    gs.MenuManager.InGameOverlay.open();
    return gs.Mode;
  })()`);
  await sleep(2000);
  line(`  · resumed from "${loaded.name}" (engineMode=${mode})`);
  return loaded;
}

async function runPlaythrough(harness, url, args) {
  const report = { started: new Date().toISOString(), steps: [], blocked: null };

  const record = async (name, fn) => {
    if (report.blocked) return false;
    line(`\n[${report.steps.length + 1}] ${name}`);
    const entry = { name, ok: false };
    try {
      entry.result = await fn();
      entry.ok = true;
    } catch (error) {
      entry.error = String((error && error.message) || error);
      entry.state = await worldState(harness).catch(() => null);
      entry.console = harness.consoleMessages.slice(-25).map((m) => `${m.level}: ${m.text}`.slice(0, 300));
      report.steps.push(entry);
      report.blocked = { step: name, error: entry.error, state: entry.state };
      line(`  ✗ BLOCKED: ${entry.error}`);
      return false;
    }
    report.steps.push(entry);
    line('  ✓');
    return true;
  };

  await record('boot to main menu', () => boot(harness, url));

  if (args.resume) {
    await record(`resume checkpoint "${args.resume}"`, () => resumeFromCheckpoint(harness, args.resume));
  } else {
    await record('new game through character creation', () => newGameThroughCharacterCreation(harness));
  }

  await record('player updates BEFORE entering VR', async () => {
    const counts = await countPlayerUpdates(harness);
    line(`  · calls in 2s (flatscreen): ${JSON.stringify(counts)}`);
    return counts;
  });

  await record('enter VR session', () => enterVrSession(harness));

  await record('player updates AFTER entering VR', async () => {
    const counts = await countPlayerUpdates(harness);
    line(`  · calls in 2s (in session): ${JSON.stringify(counts)}`);
    return counts;
  });

  await record('opening conversation', async () => {
    if (resumedPast(args, 'peragus-arrival')) return { skipped: 'resumed past it' };
    const before = await dialogueSnapshot(harness);
    line(`  · dialogue: ${JSON.stringify({
      visible: before.visible, state: before.state,
      conversation: before.conversationName, replies: before.replies,
      spoken: before.spoken,
    })}`);
    if (!before.visible) return { skipped: 'no conversation running' };
    const played = await playDialogue(harness, { label: 'opening conversation' });
    line(`  · ${played.turns} turns, ${played.transcript.length} lines`);
    for (const entry of played.transcript.slice(0, 12)) line(`      ${entry.slice(0, 140)}`);
    return played;
  });

  await record('checkpoint: prologue start', () => checkpoint(harness, 'prologue-start'));

  await record('survey the area', async () => {
    const survey = await surveyArea(harness);
    if (!survey.located) throw new Error(`area survey: ${survey.reason}`);
    line(`  · ${survey.areaName} at ${JSON.stringify(survey.playerPosition)} ${JSON.stringify(survey.counts)}`);
    line(`  · hostiles: ${JSON.stringify(survey.hostiles.slice(0, 6))}`);
    line(`  · doors: ${JSON.stringify(survey.nearestDoors.slice(0, 6))}`);
    line(`  · placeables: ${JSON.stringify(survey.nearestPlaceables.slice(0, 8))}`);
    const prompts = await listWorldPrompts(harness);
    if (!prompts.located) throw new Error(`world prompts: ${prompts.reason}`);
    line(`  · VR prompts (${prompts.candidateCount}): ${JSON.stringify(prompts.prompts.slice(0, 8), null, 1)}`);
    return { survey, prompts };
  });

  // Ebon Hawk section. Skipped once a Peragus checkpoint has been resumed.
  if (!resumedPast(args, 'peragus-arrival')) {
    await record('use the Skip Prologue console to reach Peragus', async () => {
      // Through the real VR world-prompt route, not a scripted LoadModule: the
      // point is to exercise the activation path the player uses.
      //
      // Give the world a moment first. Activating immediately after a resume
      // enqueues the action before the engine has settled, and it then sits
      // undrained — which reads exactly like "the prompt did nothing" and cost a
      // long detour before the settling turned out to be the whole story.
      await sleep(3000);
      const used = await activateWorldAction(harness, {
        objectId: 'module-object:97',
        actionLabel: 'Use: Skip Prologue',
      });
      line(`  · activated ${JSON.stringify(used)}`);

      await harness.waitFor(
        `(() => { const m = window.KotOR.GameState.MenuManager;
          return !!(m && m.InGameDialog && m.InGameDialog.bVisible); })()`,
        TIMEOUTS.short, 500,
      );

      // Choose by label, not index: "1. [Continue the Prologue.]" is first, and
      // picking blindly quietly kept us on the Ebon Hawk.
      const played = await playDialogue(harness, {
        label: 'skip prologue confirm',
        choose: (replies) => {
          const index = replies.findIndex((reply) => /skip the prologue/i.test(reply));
          if (index < 0) {
            throw new Error(`no "Skip the Prologue" reply offered; got ${JSON.stringify(replies)}`);
          }
          return index;
        },
      });
      line(`  · ${JSON.stringify(played.transcript.slice(-3))}`);

      await harness.waitFor(`(() => {
        const gs = window.KotOR.GameState;
        const area = gs.module && gs.module.area;
        return !!(area && String(area.name || '').toLowerCase() !== '001ebo');
      })()`, TIMEOUTS.moduleLoad, 3000);

      const after = await worldState(harness);
      line(`  · now in ${after.moduleName} as ${after.playerName}`);
      return after;
    });

    await record('settle into Peragus', async () => {
      // A module transition lands with LoadScreen up and no engine mode; the
      // overlay is what carries INGAME.
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
      })()`, { timeoutMs: 90000 });
      await harness.evaluate(
        `(() => { try { window.KotOR.GameState.MenuManager.InGameOverlay.open(); } catch (e) {} return true; })()`,
      );
      await sleep(2000);
      const snapshot = await dialogueSnapshot(harness);
      if (snapshot.located && snapshot.visible) {
        const played = await playDialogue(harness, { label: 'peragus opening' });
        line(`  · opening conversation: ${played.turns} turns`);
        for (const entry of played.transcript.slice(0, 8)) line(`      ${entry.slice(0, 130)}`);
      }
      const state = await worldState(harness);
      line(`  · ${JSON.stringify(state)}`);
      const survey = await surveyArea(harness);
      if (survey.located) {
        line(`  · ${survey.areaName}: ${JSON.stringify(survey.counts)}`);
        line(`  · hostiles: ${JSON.stringify(survey.hostiles.slice(0, 5))}`);
      }
      const prompts = await listWorldPrompts(harness);
      line(`  · VR prompts: ${JSON.stringify(prompts.prompts ? prompts.prompts.slice(0, 6) : prompts)}`);
      return { state, survey, prompts };
    });
  }

  if (!resumedPast(args, 'peragus-arrival')) {
    await record('checkpoint: peragus arrival', () => checkpoint(harness, 'peragus-arrival'));
  }


  await record('Peragus medical bay: recon', async () => {
    const inventory = await describeInventory(harness);
    if (!inventory.located) throw new Error(`inventory: ${inventory.reason}`);
    line(`  · ${inventory.playerName} lvl=${inventory.level} xp=${inventory.xp} hp=${inventory.hp}/${inventory.maxHp} ` +
      `credits=${inventory.credits} canLevelUp=${inventory.canLevelUp}`);
    line(`  · carrying ${inventory.inventoryCount}: ${JSON.stringify(inventory.inventory.slice(0, 10))}` +
      (inventory.inventoryError ? ` (error: ${inventory.inventoryError})` : ''));
    line(`  · equipped: ${JSON.stringify(inventory.equipped)}`);

    const survey = await surveyArea(harness);
    if (!survey.located) throw new Error(`survey: ${survey.reason}`);
    line(`  · nearest placeables: ${JSON.stringify(survey.nearestPlaceables.slice(0, 10))}`);
    line(`  · nearest doors: ${JSON.stringify(survey.nearestDoors.slice(0, 5))}`);

    const prompts = await listWorldPrompts(harness);
    line(`  · VR prompts: ${JSON.stringify(prompts.prompts || prompts, null, 1)}`);
    return { inventory, survey, prompts };
  });


  await record('walk to the medbay door and open it through the VR prompt', async () => {
    if (resumedPast(args, 'medbay-door')) return { skipped: 'resumed past it' };
    const doors = await findObjectByTag(harness, 'PeragusDoor1');
    const door = doors.sort((a, b) => a.distance - b.distance)[0];
    line(`  · nearest ${door.name} at ${JSON.stringify(door.position)} (${door.distance}m, locked=${door.locked})`);

    await moveTo(harness, {
      x: door.position.x, y: door.position.y, z: door.position.z,
      range: 2.0, label: door.name,
    });
    await sleep(1500);

    const prompts = await listWorldPrompts(harness);
    const offered = (prompts.prompts || []).find((p) => p.id === door.promptId);
    line(`  · prompt: ${JSON.stringify(offered || null)}`);
    if (!offered) {
      throw new Error(`no VR prompt for ${door.name} while standing at it; candidates were ` +
        JSON.stringify((prompts.prompts || []).map((p) => `${p.name}@${p.distance}m inRange=${p.inRange}`)));
    }
    if (!offered.actions || !offered.actions.length) {
      throw new Error(`${door.name} offered no actions (promptError=${offered.promptError})`);
    }

    await activateWorldAction(harness, { objectId: door.promptId, actionLabel: offered.actions[0] });
    await sleep(2500);
    await clearBlockingModal(harness);

    const state = await harness.evaluate(`(() => {
      const area = window.KotOR.GameState.module.area;
      const d = (area.doors || []).find((o) => o && o.id === ${Number(door.id)});
      if (!d) return { located: false };
      return {
        located: true,
        open: typeof d.isOpen === 'function' ? !!d.isOpen() : null,
        locked: typeof d.isLocked === 'function' ? !!d.isLocked() : null,
        animState: d.animationState ? d.animationState.index : null,
      };
    })()`);
    line(`  · door after use: ${JSON.stringify(state)}`);
    if (state.located && state.open === false) {
      throw new Error(`activating "${offered.actions[0]}" did not open ${door.name}: ${JSON.stringify(state)}`);
    }
    return { door, action: offered.actions[0], state };
  });

  if (!resumedPast(args, 'medbay-door')) {
    await record('checkpoint: medbay door open', () => checkpoint(harness, 'medbay-door'));
  }


  await record('navigate to the medbay container and loot it', async () => {
    if (resumedPast(args, 'medbay-looted')) return { skipped: 'resumed past it' };
    const [container] = await findObjectByTag(harness, 'MilLowPlstcCylin');
    line(`  · ${container.name} at ${JSON.stringify(container.position)} (${container.distance}m)`);

    const trip = await navigateTo(harness, {
      x: container.position.x, y: container.position.y, z: container.position.z,
      range: 1.6, label: container.name,
    });
    await sleep(1500);
    await clearBlockingModal(harness);

    const prompts = await listWorldPrompts(harness);
    const offered = (prompts.prompts || []).find((p) => p.id === container.promptId);
    if (!offered || !offered.actions || !offered.actions.length) {
      throw new Error(`standing at ${container.name} but it offers no VR action; in range: ` +
        JSON.stringify((prompts.prompts || []).map((p) => `${p.name}@${p.distance}m inRange=${p.inRange} err=${p.promptError}`)));
    }
    line(`  · prompt: ${JSON.stringify(offered.actions)}`);

    const before = await describeInventory(harness);
    await activateWorldAction(harness, { objectId: container.promptId, actionLabel: offered.actions[0] });
    await sleep(2500);

    const state = await worldState(harness);
    line(`  · foreground after use: ${state.foregroundMenu}`);
    if (state.foregroundMenu === 'MenuContainer') {
      // BTN_OK is take-all (it calls container.retrieveInventory), but it
      // early-returns unless something is selected — so select a row first,
      // exactly as a player pointing at an item would. BTN_GIVEITEMS is a
      // take/give MODE TOGGLE, not a take button; using it took nothing.
      const took = await harness.evaluate(`(() => {
        const menu = window.KotOR.GameState.MenuManager.MenuContainer;
        const list = menu.LB_ITEMS;
        const rows = list && Array.isArray(list.children) ? list.children : null;
        if (!rows) return { ok: false, reason: 'LB_ITEMS has no children array' };
        if (!rows.length) return { ok: false, reason: 'container is empty', rowCount: 0 };
        try { list.select(rows[0]); } catch (error) {
          return { ok: false, reason: 'select threw: ' + String(error && error.message || error) };
        }
        if (!menu.selectedItem) {
          return { ok: false, reason: 'selecting row 0 did not set selectedItem', rowCount: rows.length };
        }
        try { menu.BTN_OK.click(); } catch (error) {
          return { ok: false, reason: 'BTN_OK threw: ' + String(error && error.message || error) };
        }
        return { ok: true, rowCount: rows.length };
      })()`);
      line(`  · take-all: ${JSON.stringify(took)}`);
      await sleep(2000);
    }
    await clearBlockingModal(harness);
    await returnToGameplay(harness);

    const after = await describeInventory(harness);
    line(`  · inventory ${before.inventoryCount} -> ${after.inventoryCount}: ${JSON.stringify(after.inventory.slice(0, 10))}`);
    // Tight again: the loose version passed while looting nothing, which is
    // worse than failing.
    if (after.inventoryCount <= before.inventoryCount) {
      throw new Error(`looting ${container.name} added nothing (${before.inventoryCount} -> ${after.inventoryCount}); ` +
        `foreground was ${state.foregroundMenu}`);
    }
    return { trip, before, after };
  });

  if (!resumedPast(args, 'medbay-looted')) {
    await record('checkpoint: looted medbay', () => checkpoint(harness, 'medbay-looted'));
  }


  await record('fight a mining droid through the action wheel', async () => {
    if (resumedPast(args, 'first-kill')) return { skipped: 'resumed past it' };

    const survey = await surveyArea(harness);
    const target = (survey.hostiles || [])[0];
    if (!target) throw new Error('no live hostiles in this area');
    line(`  · nearest hostile: ${target.name} (${target.distance}m)`);

    const position = await harness.evaluate(`(() => {
      const area = window.KotOR.GameState.module.area;
      const c = (area.creatures || []).find((o) => o && o.id === ${Number(target.id)});
      if (!c) return null;
      return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) };
    })()`);
    if (!position) throw new Error(`hostile ${target.id} vanished before approach`);

    // Close to melee-ish range; the wheel's Attacks page only populates for a
    // hostile creature that the engine considers a valid target.
    // Nomination is gated on resolveVRCombatRange, which is melee reach — the
    // earlier 3m approach plus arrival tolerance left the player outside it and
    // every swing came back "target not nominated".
    await navigateTo(harness, { ...position, range: 1.4, label: target.name });
    await sleep(1500);
    await clearBlockingModal(harness);

    const wheel = await describeActionWheel(harness, target.id);
    if (!wheel.located) throw new Error(`action wheel: ${wheel.reason}`);
    line(`  · wheel top level (${wheel.top.length}, pages=${wheel.pageCount}): ${JSON.stringify(wheel.top.map((e) => e.label))}`);
    line(`  · submenus: ${JSON.stringify(wheel.submenus)}`);

    const attacks = wheel.submenus['submenu:attacks'];
    if (!Array.isArray(attacks) || !attacks.length) {
      throw new Error(`no Attacks page for a hostile creature; wheel was ${JSON.stringify(wheel.top.map((e) => e.label))}`);
    }

    const before = await describeInventory(harness);
    const attackLabel = attacks[0].label;
    // 4.8: the Attacks page ARMS a stance, it does not attack. Selecting
    // "Attack" here sets the plain, un-modified stance; the blows themselves
    // come from swings. Clicking it repeatedly and expecting damage is what a
    // misreading of that design looks like.
    await activateWheelAction(harness, {
      targetId: target.id, submenuId: 'submenu:attacks', actionLabel: attackLabel,
    });
    line(`  · armed stance via "${attackLabel}"; attacking by swing`);

    // Swing until it dies. Each activation queues one attack; the round timer
    // paces them, so this is a fight rather than a burst.
    let killed = false;
    for (let round = 0; round < 40; round += 1) {
      const status = await harness.evaluate(`(() => {
        const area = window.KotOR.GameState.module.area;
        const c = (area.creatures || []).find((o) => o && o.id === ${Number(target.id)});
        const player = window.KotOR.PartyManager.party[0];
        if (!c) return { gone: true };
        return {
          gone: false,
          dead: typeof c.isDead === 'function' ? !!c.isDead() : null,
          hp: c.getHP ? c.getHP() : null,
          playerHp: player.getHP ? player.getHP() : null,
          inCombat: player.combatData ? player.combatData.combatState === true : null,
        };
      })()`);
      if (status.gone || status.dead) { killed = true; break; }
      if (round % 6 === 0) {
        line(`  · round ${round}: target hp=${status.hp} player hp=${status.playerHp} inCombat=${status.inCombat}`);
      }
      let swung = await swingAt(harness, target.id);
      if (!swung.ok && /not nominated/.test(swung.reason || '')) {
        // The droid moves. Close the gap against its CURRENT position and retry
        // once before calling it a refusal.
        const now = await harness.evaluate(`(() => {
          const area = window.KotOR.GameState.module.area;
          const c = (area.creatures || []).find((o) => o && o.id === ${Number(target.id)});
          const player = window.KotOR.PartyManager.party[0];
          if (!c) return null;
          return {
            x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2),
            gap: +player.position.distanceTo(c.position).toFixed(2),
          };
        })()`);
        if (now) {
          if (round === 0) line(`  · not nominated at ${now.gap}m; closing`);
          try {
            await moveTo(harness, { x: now.x, y: now.y, z: now.z, range: 1.2, label: target.name, timeoutMs: 20000 });
          } catch (e) { /* it may be walking toward us anyway */ }
          swung = await swingAt(harness, target.id);
        }
      }
      if (!swung.ok) {
        if (round === 0) throw new Error(`first swing refused: ${swung.reason}`);
      } else if (round === 0) {
        line(`  · swinging: weaponMode=${swung.weaponMode} stance=${swung.stance || '(none)'}`);
        await sleep(1200);
        // A swing that is accepted but never lands: report what attackCreature
        // actually produced, rather than only that HP did not move.
        const combat = await harness.evaluate(`(() => {
          const K = window.KotOR;
          const gs = K.GameState;
          const player = K.PartyManager.party[0];
          const area = gs.module.area;
          const foe = (area.creatures || []).find((o) => o && o.id === ${Number(target.id)});
          const round = player.combatRound;
          const describe = (a) => a ? (a.constructor ? a.constructor.name : '?') : null;
          return {
            playerQueue: (player.actionQueue || []).map(describe),
            playerAction: describe(player.action),
            combatState: player.combatData ? player.combatData.combatState : null,
            combatQueueLength: player.combatData && player.combatData.combatQueue
              ? player.combatData.combatQueue.length : null,
            lastAttackTarget: player.combatData && player.combatData.lastAttackTarget
              ? String(player.combatData.lastAttackTarget.tag || player.combatData.lastAttackTarget.id) : null,
            roundStarted: round ? round.roundStarted : null,
            roundTimer: round ? round.timer : null,
            roundAction: round ? describe(round.action) : null,
            roundActionCount: round && round.actions ? round.actions.length : null,
            foeHostile: foe && typeof foe.isHostile === 'function' ? foe.isHostile(player) : null,
            foeDead: foe && typeof foe.isDead === 'function' ? foe.isDead() : null,
            foeHp: foe && foe.getHP ? foe.getHP() : null,
            gap: foe ? +player.position.distanceTo(foe.position).toFixed(2) : null,
          };
        })()`);
        line(`  · after first swing: ${JSON.stringify(combat)}`);
      }
      await sleep(1200);
      await clearBlockingModal(harness);
    }

    const after = await describeInventory(harness);
    line(`  · killed=${killed} xp ${before.xp} -> ${after.xp} hp ${after.hp}/${after.maxHp} canLevelUp=${after.canLevelUp}`);
    if (!killed) throw new Error(`could not kill ${target.name} in 40 rounds`);
    // xptable.2da pays a level-1 character 125 for a CR-1 kill. Combat awarded
    // nothing at all before this was wired, so assert it rather than logging it.
    if (!(after.xp > before.xp)) {
      throw new Error(`kill awarded no experience (${before.xp} -> ${after.xp}); ` +
        `xptable lookup is level ${before.level} vs the victim's challenge rating`);
    }
    return { target: target.name, before, after };
  });

  if (!resumedPast(args, 'first-kill')) {
    await record('checkpoint: first kill', () => checkpoint(harness, 'first-kill'));
  }


  await record('XP data probe', async () => {
    const info = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      const tables = gs.TwoDAManager && gs.TwoDAManager.datatables;
      if (!tables) return { located: false, reason: 'no datatables' };
      const names = Array.from(tables.keys());
      const interesting = names.filter((n) => /exp|xp|challenge|crtable|encounter/i.test(n));
      // 2DA rows are an object keyed by row index, not an array — reading
      // .length gave undefined and .slice threw.
      const rowsOf = (table) => (table && table.rows) ? Object.values(table.rows) : [];
      const describe = (name) => {
        const table = tables.get(name);
        const rows = rowsOf(table);
        if (!rows.length) return { name, rowCount: 0 };
        return { name, rowCount: rows.length, columns: Object.keys(rows[0]).slice(0, 12), row0: rows[0], row1: rows[1] };
      };
      const area = gs.module && gs.module.area;
      const hostiles = (area && area.creatures || []).filter(Boolean).map((c) => ({
        tag: String(c.tag || ''),
        cr: c.challengeRating,
        dead: typeof c.isDead === 'function' ? c.isDead() : null,
      })).slice(0, 8);
      return {
        located: true,
        totalTables: names.length,
        interesting,
        exptable: describe('exptable'),
        xptable: (() => {
          const rows = rowsOf(tables.get('xptable'));
          return { rowCount: rows.length, rows: rows.slice(0, 12) };
        })(),
        xpbaseconst: (() => {
          const rows = rowsOf(tables.get('xpbaseconst'));
          return { rowCount: rows.length, rows: rows.slice(0, 6) };
        })(),
        creatures: hostiles,
      };
    })()`, { timeoutMs: 60000 });
    line(`  · tables matching exp/xp/cr: ${JSON.stringify(info.interesting)}`);
    line(`  · exptable: ${JSON.stringify(info.exptable)}`);
    line(`  · xptable: ${JSON.stringify(info.xptable)}`);
    line(`  · xpbaseconst: ${JSON.stringify(info.xpbaseconst)}`);
    line(`  · creature challenge ratings: ${JSON.stringify(info.creatures)}`);
    return info;
  });


  await record('clear the mining droids', async () => {
    if (resumedPast(args, 'droids-cleared')) return { skipped: 'resumed past it' };
    const outcomes = await clearHostiles(harness, { limit: 12 });
    const killed = outcomes.filter((o) => o.killed).length;
    const stats = await describeInventory(harness);
    line(`  · ${killed}/${outcomes.length} killed; xp=${stats.xp} level=${stats.level} canLevelUp=${stats.canLevelUp}`);
    if (!killed) throw new Error(`killed nothing: ${JSON.stringify(outcomes)}`);
    return { outcomes, stats };
  });

  if (!resumedPast(args, 'droids-cleared')) {
    await record('checkpoint: droids cleared', () => checkpoint(harness, 'droids-cleared'));
  }

  await record('level up through the wheel Menu route', async () => {
    if (resumedPast(args, 'levelled')) return { skipped: 'resumed past it' };
    const before = await describeInventory(harness);
    line(`  · level=${before.level} xp=${before.xp} canLevelUp=${before.canLevelUp}`);
    if (!before.canLevelUp) {
      return { skipped: `not eligible yet (xp=${before.xp}, level ${before.level})` };
    }

    // The wheel's single Menu wedge opens MenuCharacter, which is where Auto
    // Level-Up lives — 4.8 dropped the dedicated Level-Up wedge for exactly this.
    await activateWheelAction(harness, { targetId: null, actionLabel: 'Menu' });
    await sleep(2000);
    const state = await worldState(harness);
    line(`  · foreground: ${state.foregroundMenu}`);

    const controls = await describeMenuControls(harness, 'MenuCharacter');
    line(`  · character menu: visible=${controls.visible} clickable=${JSON.stringify(controls.clickable)}`);

    const levelled = await harness.evaluate(`(() => {
      const menus = window.KotOR.GameState.MenuManager;
      const menu = menus.MenuCharacter;
      if (!menu) return { ok: false, reason: 'no MenuCharacter' };
      const button = menu.BTN_AUTO || menu.BTN_LEVELUP;
      if (!button) {
        return { ok: false, reason: 'no level-up control; have ' + Object.keys(menu).filter((k) => /^BTN_/.test(k)).join(',') };
      }
      try { button.click(); } catch (error) { return { ok: false, reason: String(error && error.message || error) }; }
      return { ok: true, used: menu.BTN_AUTO ? 'BTN_AUTO' : 'BTN_LEVELUP' };
    })()`);
    line(`  · level-up control: ${JSON.stringify(levelled)}`);
    await sleep(3000);
    await clearBlockingModal(harness);

    // Leaving the character screen open holds the engine in GUI mode, which
    // makes every later navigation report "unreachable".
    await returnToGameplay(harness);

    const after = await describeInventory(harness);
    line(`  · level ${before.level} -> ${after.level}, canLevelUp=${after.canLevelUp}`);
    const resumedState = await worldState(harness);
    if (resumedState.engineMode !== 1) {
      throw new Error(`levelling left the engine in mode ${resumedState.engineMode} (want 1=INGAME); ` +
        `foreground=${resumedState.foregroundMenu}`);
    }
    return { before, after, levelled };
  });


  await record('leave the medical bay for the next Peragus module', async () => {
    if (resumedPast(args, 'module-102')) return { skipped: 'resumed past it' };
    const startModule = (await worldState(harness)).moduleName;

    const doors = await listDoors(harness);
    if (!doors.located) throw new Error(doors.reason);
    line(`  · doors: ${JSON.stringify(doors.doors.slice(0, 8).map((d) =>
      `${d.name}(${d.tag})@${d.distance}m open=${d.open} locked=${d.locked} plot=${d.plot}`))}`);

    // Transition doors are named for the module they lead to, e.g.
    // "Emergency Hatch{102PER}". Prefer one of those over any old exit.
    const exits = doors.doors.filter((d) => /\{1\d\dPER\}/i.test(d.name));
    line(`  · module exits: ${JSON.stringify(exits.map((d) => `${d.name}@${d.distance}m locked=${d.locked} plot=${d.plot}`))}`);

    const reachable = exits.filter((d) => !d.plot);
    if (!reachable.length) {
      return {
        blockedBy: exits.map((d) => `${d.name} plot=${d.plot} locked=${d.locked}`),
        note: 'every module exit is plot-locked; the prologue gates it behind a task not yet done',
      };
    }

    const exit = reachable[0];
    await navigateTo(harness, {
      x: exit.position.x, y: exit.position.y, z: exit.position.z,
      range: 2.0, label: exit.name, maxAttempts: 8,
    });
    await sleep(1500);
    await clearBlockingModal(harness);

    const prompts = await listWorldPrompts(harness);
    const offered = (prompts.prompts || []).find((p) => p.id === exit.promptId);
    if (!offered || !offered.actions || !offered.actions.length) {
      throw new Error(`no VR action on ${exit.name}; in range: ` +
        JSON.stringify((prompts.prompts || []).map((p) => `${p.name}@${p.distance}m inRange=${p.inRange}`)));
    }
    await activateWorldAction(harness, { objectId: exit.promptId, actionLabel: offered.actions[0] });
    await sleep(4000);
    await clearBlockingModal(harness);

    const after = await worldState(harness);
    line(`  · module ${startModule} -> ${after.moduleName}`);
    return { from: startModule, to: after.moduleName, via: exit.name };
  });

  report.finalState = await worldState(harness).catch(() => null);
  line(`\nfinal state: ${JSON.stringify(report.finalState, null, 2)}`);
  return report;
}

module.exports = {
  runPlaythrough,
  surveyArea,
  describeInventory,
  moveTo,
  listWorldPrompts,
  dialogueSnapshot,
  playDialogue,
  clickGuiControl,
  describeMenuControls,
  waitForMenu,
  waitForModule,
  checkpoint,
  resumeFromCheckpoint,
  sleep,
  line,
};
