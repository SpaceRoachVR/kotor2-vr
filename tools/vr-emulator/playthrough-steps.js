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
    const described = candidates.map((candidate) => {
      const row = {
        id: String(candidate.id),
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
    return { ok: true, from: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2) } };
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
      const prompts = await listWorldPrompts(harness);
      const doors = (prompts.prompts || []).filter((candidate) =>
        candidate.inRange &&
        Array.isArray(candidate.actions) &&
        candidate.actions.some((action) => /open|use|bash|security/i.test(action)));

      if (!doors.length) {
        if (progressed) continue;
        throw new Error(`navigateTo ${label}: stopped ${remaining}m short with nothing to open. ` +
          `In range: ${JSON.stringify((prompts.prompts || []).map((p) =>
            `${p.name}@${p.distance}m inRange=${p.inRange} actions=${(p.actions || []).join('|')} err=${p.promptError}`))}`);
      }

      // Nearest first: the door in the way is the one you are standing at.
      const blocker = doors.sort((a, b) => a.distance - b.distance)[0];
      // Prefer a plain open over Bash — bashing a door that Security would have
      // opened is a different playthrough, and a noisier one.
      const action = blocker.actions.find((a) => /^use|open/i.test(a)) ||
        blocker.actions.find((a) => /security/i.test(a)) ||
        blocker.actions[0];
      line(`  · ${remaining}m short; opening ${blocker.name} via "${action}"`);
      try {
        await activateWorldAction(harness, { objectId: blocker.id, actionLabel: action });
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
