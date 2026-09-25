/**
 * The Peragus arc after the medical bay: 101PER to the escape, in stages.
 *
 * Continues `playthrough-steps.js` from its `levelled` checkpoint. Everything
 * here goes through the same entry points the headset uses (VR world prompts,
 * the action wheel, the dialogue GUI's own reply selection), so a step that
 * passes is evidence about the product, not the driver. It is still not device
 * evidence: see HEADSET-TEST-PLAN.md.
 *
 * The route is read out of the retail data (module GITs, the door and console
 * conversations, the gating scripts) rather than remembered; the working notes
 * that back each stage are summarised inline where a step depends on them.
 */
const { worldState, TIMEOUTS } = require('./playthrough');

// playthrough-steps.js requires this file while it is still loading (for the
// checkpoint order), so its helpers are looked up at call time rather than
// destructured at load time, when its exports are not yet assigned.
const lazy = (name) => (...args) => {
  const helper = require('./playthrough-steps')[name];
  if (typeof helper !== 'function') throw new Error(`playthrough-steps does not export ${name}`);
  return helper(...args);
};
const line = lazy('line');
const sleep = lazy('sleep');
const findObjectByTag = lazy('findObjectByTag');
const useTaggedWorldObject = lazy('useTaggedWorldObject');
const navigateTo = lazy('navigateTo');
const moveTo = lazy('moveTo');
const listWorldPrompts = lazy('listWorldPrompts');
const activateWorldAction = lazy('activateWorldAction');
const clearBlockingModal = lazy('clearBlockingModal');
const clearHostiles = lazy('clearHostiles');
const fightHostile = lazy('fightHostile');
const surveyArea = lazy('surveyArea');
const describeInventory = lazy('describeInventory');
const equipPlayerWeapon = lazy('equipPlayerWeapon');
const returnToGameplay = lazy('returnToGameplay');
const dialogueSnapshot = lazy('dialogueSnapshot');
const waitForModule = lazy('waitForModule');
const activateWheelAction = lazy('activateWheelAction');
const checkpoint = lazy('checkpoint');
const clearProgressBlockingDialogue = lazy('clearProgressBlockingDialogue');
const readGlobalNumber = lazy('readGlobalNumber');
const resolveOpenedContainer = lazy('resolveOpenedContainer');
const healPlayerIfInjured = lazy('healPlayerIfInjured');
const playerVitals = lazy('playerVitals');

/** Every checkpoint this file writes, in the order the campaign reaches them. */
const PERAGUS_CHECKPOINT_ORDER = Object.freeze([
  // Stage A: the rest of the administration level, as the Exile.
  'vibroblade',
  'security-room',
  'admin-override',
  'atton-freed',
  't3-hangar',
  // Stage B: the hangar bay and fuel depot, as T3-M4.
  't3-sublevel-parts',
  't3-spikes',
  't3-fuel-depot',
  'hatch-opened',
  // Stage C: down the hatch, through the mining tunnels and fuel depot, as the Exile.
  'mining-tunnels',
  'tunnel-core',
  'containment-fields-down',
  'fuel-depot-arrival',
  'airlock-open',
  'asteroid-exterior',
  // Stage D: across the asteroid, through the dormitories, back up to the Harbinger.
  'dormitories',
  'turbolift-unlocked',
  'admin-return',
  'hk50-defeated',
  // Stage E: the Harbinger, deck by deck, into the fuel line.
  'drift-charts',
  'harbinger-crew-quarters',
  'harbinger-engine-deck',
  'fuel-line',
  // Stage F: T3 rescued, the hangar opened, the Ebon Hawk boarded.
  't3-rescued',
  'exit-ramp-open',
  'hangar-bay',
  'hangar-door-open',
  'ebon-hawk-boarded',
]);

const PERAGUS_CHECKPOINT_EXPECTATIONS = Object.freeze({
  vibroblade: Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
  'security-room': Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
  'admin-override': Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
  'atton-freed': Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
  't3-hangar': Object.freeze({ module: '106per' }),
  't3-sublevel-parts': Object.freeze({ module: '106per', minimumInventoryCount: 1 }),
  't3-spikes': Object.freeze({ module: '106per', minimumInventoryCount: 1 }),
  't3-fuel-depot': Object.freeze({ module: '103per', minimumInventoryCount: 1 }),
  'hatch-opened': Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
  'mining-tunnels': Object.freeze({ module: '102per', minimumInventoryCount: 1 }),
  'tunnel-core': Object.freeze({ module: '102per', minimumInventoryCount: 1 }),
  'containment-fields-down': Object.freeze({ module: '102per', minimumInventoryCount: 1 }),
  'fuel-depot-arrival': Object.freeze({ module: '103per', minimumInventoryCount: 1 }),
  'airlock-open': Object.freeze({ module: '103per', minimumInventoryCount: 1 }),
  'asteroid-exterior': Object.freeze({ module: '104per' }),
  dormitories: Object.freeze({ module: '105per' }),
  'turbolift-unlocked': Object.freeze({ module: '105per' }),
  'admin-return': Object.freeze({ module: '101per' }),
  'hk50-defeated': Object.freeze({ module: '151har' }),
  'drift-charts': Object.freeze({ module: '151har' }),
  'harbinger-crew-quarters': Object.freeze({ module: '152har' }),
  'harbinger-engine-deck': Object.freeze({ module: '153har' }),
  'fuel-line': Object.freeze({ module: '103per' }),
  't3-rescued': Object.freeze({ module: '103per' }),
  'exit-ramp-open': Object.freeze({ module: '103per' }),
  'hangar-bay': Object.freeze({ module: '106per' }),
  'hangar-door-open': Object.freeze({ module: '106per' }),
  'ebon-hawk-boarded': Object.freeze({ module: '107per' }),
});

// ---------------------------------------------------------------------------
// Conversation driving
// ---------------------------------------------------------------------------

const ENGINE_MODE_DIALOG = 3;
const CONVERSATION_MENUS = Object.freeze(['InGameDialog', 'InGameComputer']);

function stripOrdinal(text) {
  return String(text || '').trim().replace(/^\d+\.\s*/, '');
}

/**
 * Picks replies by an ordered list of patterns: the first pattern with a match
 * wins, so the list reads as "what the walkthrough wants, most urgent first".
 *
 * When nothing matches: a single reply (an authored "continue") is taken, and
 * with `unseenFallback` the first reply not yet chosen in this conversation is
 * taken, which walks an exposition tree without looping. Without it the chooser
 * fails closed — consoles can spend spikes or move the story on a stray pick.
 */
function createPriorityChooser(patterns, { label = 'dialogue', unseenFallback = false } = {}) {
  if (!Array.isArray(patterns) || patterns.some((p) => !(p instanceof RegExp))) {
    throw new TypeError(`${label}: patterns must be an array of RegExp`);
  }
  const seen = new Set();
  const picks = [];
  const choose = (replies) => {
    // A reply can carry no text at all (104PER's Sion-arrival conversation
    // offered one); treat it as an empty string rather than crashing the step.
    const texts = (replies || []).map((reply) => String(stripOrdinal(reply) ?? ''));
    let index = -1;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      index = texts.findIndex((text) => pattern.test(text));
      if (index >= 0) break;
    }
    if (index < 0 && texts.length === 1) index = 0;
    if (index < 0 && unseenFallback) {
      index = texts.findIndex((text) => !seen.has(text.toLowerCase()));
      if (index < 0) index = 0;
    }
    if (index < 0) {
      throw new Error(`${label}: no preferred reply offered; replies=${JSON.stringify(texts)}`);
    }
    seen.add(texts[index].toLowerCase());
    picks.push(texts[index]);
    return index;
  };
  choose.picks = picks;
  return choose;
}

/**
 * A chooser for console menus: an ordered script of replies, each taken once
 * the first time it is offered. Entries may be skipped when the console never
 * offers them (a branch that depends on skills or items), and once the script
 * is spent "Log out" or a lone continue is taken. Anything else fails closed.
 */
function createScriptedChooser(script, { label = 'console', exit = /^(Log out|Return to main)/i } = {}) {
  if (!Array.isArray(script) || !script.length || script.some((p) => !(p instanceof RegExp))) {
    throw new TypeError(`${label}: script must be a non-empty array of RegExp`);
  }
  let cursor = 0;
  const picks = [];
  const choose = (replies) => {
    const texts = (replies || []).map(stripOrdinal);
    for (let at = cursor; at < script.length; at += 1) {
      script[at].lastIndex = 0;
      const index = texts.findIndex((text) => script[at].test(text));
      if (index >= 0) {
        cursor = at + 1;
        picks.push(texts[index]);
        return index;
      }
    }
    if (texts.length === 1) { picks.push(texts[0]); return 0; }
    const out = texts.findIndex((text) => exit.test(text));
    if (out >= 0) { picks.push(texts[out]); return out; }
    throw new Error(`${label}: nothing scripted is offered (script at ${cursor}/${script.length}); replies=${JSON.stringify(texts)}`);
  };
  choose.picks = picks;
  choose.done = () => cursor >= script.length;
  return choose;
}

/** Which conversation menu is carrying a live conversation right now, if any. */
async function liveConversationMenu(harness) {
  return harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const menus = gs.MenuManager;
    for (const name of ${JSON.stringify(CONVERSATION_MENUS)}) {
      const menu = menus && menus[name];
      if (menu && menu.bVisible === true) return { menu: name, mode: gs.Mode };
    }
    // A live conversation whose menu another menu has hidden is still a live
    // conversation: CutsceneManager owns the replies, the GUI only draws them.
    const cm = gs.CutsceneManager;
    if (gs.Mode === ${ENGINE_MODE_DIALOG} && cm && cm.active && cm.dialog) {
      const computer = typeof cm.dialog.getConversationType === 'function' && cm.dialog.getConversationType() === 1;
      return { menu: computer ? 'InGameComputer' : 'InGameDialog', mode: gs.Mode, hidden: true };
    }
    return { menu: null, mode: gs.Mode };
  })()`);
}

async function waitForConversation(harness, timeoutMs = 15_000) {
  return harness.waitFor(`(() => {
    const gs = window.KotOR.GameState;
    const menus = gs.MenuManager;
    if (gs.Mode === ${ENGINE_MODE_DIALOG}) return true;
    return ${JSON.stringify(CONVERSATION_MENUS)}.some((name) => menus[name] && menus[name].bVisible === true);
  })()`, timeoutMs, 300).then(() => true).catch(() => false);
}

/**
 * Plays a conversation to its end, following it across menus.
 *
 * `playDialogue` watches one menu. A console reply that fires
 * `ActionStartConversation` on someone else (the administration computer
 * handing off to T3-M4) moves the conversation from InGameComputer to
 * InGameDialog while the engine never leaves DIALOG mode, and a single-menu
 * loop then skips against a hidden menu until it gives up. This reads whichever
 * menu is live each turn instead.
 */
async function playConversation(harness, { choose, label = 'conversation', maxTurns = 240 } = {}) {
  const transcript = [];
  let idle = 0;
  let menusSeen = new Set();
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const live = await liveConversationMenu(harness);
    if (!live.menu) {
      if (live.mode !== ENGINE_MODE_DIALOG) {
        return { finished: true, turns: turn, transcript, menus: Array.from(menusSeen) };
      }
      await harness.evaluate(`(() => { const cm = window.KotOR.GameState.CutsceneManager;
        try { cm.playerSkipEntry(cm.currentEntry); } catch (e) {} return true; })()`);
      idle += 1;
      if (idle > 40) {
        // DIALOG mode with nothing to show and nothing to skip is a
        // conversation the engine has lost track of, not one to wait on.
        // End it the way clearProgressBlockingDialogue does, and say so:
        // the stuck state is itself a finding worth the log line.
        const ended = await harness.evaluate(`(() => {
          const cm = window.KotOR.GameState.CutsceneManager;
          const detail = { dialog: cm && cm.dialog ? String(cm.dialog.resref) : null, active: cm ? cm.active : null,
            entry: cm && cm.currentEntry ? String(cm.currentEntry.text || '').slice(0, 80) : null };
          try { cm.endConversation(true); } catch (e) { detail.error = String(e && e.message || e); }
          return detail;
        })()`);
        line(`  · ${label}: engine sat in DIALOG mode ${idle} turns with no menu; ended it: ${JSON.stringify(ended)}`);
        await returnToGameplay(harness);
        return { finished: true, forced: true, turns: turn, transcript, menus: Array.from(menusSeen) };
      }
      await sleep(500);
      continue;
    }
    menusSeen.add(live.menu);
    const snapshot = await dialogueSnapshot(harness, live.menu);
    if (!snapshot.located) throw new Error(`${label}: ${snapshot.reason}`);
    if (snapshot.spoken && transcript[transcript.length - 1] !== snapshot.spoken) transcript.push(snapshot.spoken);
    if (snapshot.state === 1) {
      let replies = Array.isArray(snapshot.replies) ? snapshot.replies : [];
      if (!replies.length) {
        // The GUI list is empty when the menu was hidden before it drew; the
        // conversation's own reply nodes still say what is on offer.
        replies = await harness.evaluate(`(() => {
          const cm = window.KotOR.GameState.CutsceneManager;
          return (cm.currentReplies || []).filter((r) => !r || !r.isContinueDialog || !r.isContinueDialog())
            .map((r, i) => (i + 1) + '. ' + String(r && r.text || ''));
        })()`).catch(() => []);
        if (replies.length) transcript.push(`! replies read from CutsceneManager (${live.hidden ? 'menu hidden' : 'list empty'})`);
        else transcript.push('! awaiting choice with no readable replies');
      }
      if (!replies.length) {
        // Nothing to choose from: a continue node whose reply row carries no
        // text (104PER's Sion arrival, 104atton). Skip the entry and look
        // again rather than asking the chooser to pick from nothing.
        // A continue row (empty text, isContinueDialog) is a reply the engine
        // must be given; only when there is no row at all is the entry skipped.
        // While the entry is still playing (state 0) the only honest move is
        // to skip it; selecting its continue row then merely re-shows it
        // (104PER's "I have a bad feeling about this." looped that way).
        // Once the engine is awaiting a choice (state 1) with only continue
        // rows, select the first.
        const advanced = await harness.evaluate(`(() => { const cm = window.KotOR.GameState.CutsceneManager;
          try {
            if (cm.state === 1 && (cm.currentReplies || []).length) { cm.selectReplyAtIndex(0); return 'continue'; }
            if (cm.currentEntry) { cm.playerSkipEntry(cm.currentEntry); return 'skip'; }
            if ((cm.currentReplies || []).length) { cm.selectReplyAtIndex(0); return 'continue'; }
          } catch (e) { return String(e); }
          return 'nothing'; })()`).catch(() => undefined);
        transcript.push(`! advanced by ${advanced}`);
        idle += 1;
        await sleep(600);
        continue;
      }
      const index = choose ? choose(replies, snapshot, live.menu) : 0;
      transcript.push(`> [${index}] ${replies[index] ?? '<no rendered row>'}` +
        ` [script=${snapshot.replyScripts && snapshot.replyScripts[index] || '(none)'}]`);
      const picked = await harness.evaluate(`(() => {
        try { window.KotOR.GameState.CutsceneManager.selectReplyAtIndex(${Number(index)}); return { ok: true }; }
        catch (error) { return { ok: false, reason: String(error && error.message || error) }; } })()`);
      if (!picked.ok) throw new Error(`${label}: selecting reply ${index} threw: ${picked.reason}`);
      idle = 0;
    } else {
      // A line is playing: skip it, and say what the skip met. An authored
      // cutscene (104PER's harbcs: six camera shots, ~57 s) advances on its
      // own if the skip is refused, so the stall limit must outlast it.
      const skipped = await harness.evaluate(`(() => { const cm = window.KotOR.GameState.CutsceneManager; const e = cm.currentEntry;
        const before = e ? { idx: (cm.dialog && cm.dialog.entryList || []).indexOf(e), skippable: e.skippable, isSkipped: !!(e.checkList && e.checkList.isSkipped), repliesShown: e.repliesShown, elapsed: Math.round(e.elapsed || 0) } : null;
        let result = 'no entry';
        try { if (e) { cm.playerSkipEntry(e); result = 'called'; } } catch (err) { result = String(err && err.message || err); }
        const after = cm.currentEntry ? (cm.dialog && cm.dialog.entryList || []).indexOf(cm.currentEntry) : -1;
        return { before, result, after, state: cm.state, mode: window.KotOR.GameState.Mode }; })()`).catch((error) => ({ error: String(error.message) }));
      idle += 1;
      if (idle % 10 === 1) transcript.push(`! skip ${JSON.stringify(skipped)}`);
      if (idle > 200) {
        throw new Error(`${label}: stalled for ${idle} turns on ${live.menu}; state=${snapshot.state} ` +
          `conversation=${snapshot.conversationName} last=${JSON.stringify(snapshot.spoken)}; skip=${JSON.stringify(skipped)}`);
      }
    }
    await sleep(450);
  }
  throw new Error(`${label}: did not end within ${maxTurns} turns; transcript=${JSON.stringify(transcript.slice(-8))}`);
}

// ---------------------------------------------------------------------------
// World helpers
// ---------------------------------------------------------------------------

function distanceBetween(a, b) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

/** The object with this tag nearest to a point — tags repeat within a module. */
async function findTaggedNear(harness, tag, point) {
  const matches = await findObjectByTag(harness, tag);
  return matches.sort((l, r) => distanceBetween(l.position, point) - distanceBetween(r.position, point))[0];
}

/**
 * Pushes the stick briefly in four directions. A creature that has walked
 * into a placeable's collision (T3-M4 at the hangar storage footlocker) can
 * stand pinned with every planned leg starting through the obstacle; a short
 * shove sideways frees it where the planner's straight line never will.
 */
async function nudgeFree(harness, label = 'nudge') {
  const before = await playerSnapshot(harness);
  for (const [x, y] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    await harness.evaluate(`(() => {
      const controller = window.__xrDevice && window.__xrDevice.controllers && window.__xrDevice.controllers.left;
      if (controller && typeof controller.updateAxes === 'function') controller.updateAxes('thumbstick', ${x}, ${y});
      return true;
    })()`).catch(() => undefined);
    await sleep(900);
  }
  await harness.evaluate(`(() => {
    const controller = window.__xrDevice && window.__xrDevice.controllers && window.__xrDevice.controllers.left;
    if (controller && typeof controller.updateAxes === 'function') controller.updateAxes('thumbstick', 0, 0);
    return true;
  })()`).catch(() => undefined);
  const after = await playerSnapshot(harness);
  line(`  · ${label}: nudged from ${JSON.stringify(before.position)} to ${JSON.stringify(after.position)}`);
  return { before: before.position, after: after.position };
}

/**
 * Walks somewhere through hostile ground: fights what is close, walks, and
 * when the walk stalls with a hostile nearby, fights that and walks again.
 * The Exile is level 2 with ~24 HP; a droid left behind an open door kills a
 * run that only ever walks.
 */
async function travelTo(harness, { x, y, z, label = 'destination', range = 1.6, sweepRadius = 18, rounds = 4, permittedDoorPromptIds = null, via = null, viaChooser = null, usePath = true }) {
  // Long routes go room by room. The engine's walkmesh planner is right
  // about a corridor and wrong about a level: across the administration
  // level it returned legs through walls, and a head-relative stick push
  // then stood at the wall for the whole timeout. Each via point is a room
  // centre or a doorway, so every leg is short and the door in the way is
  // the next thing the navigator opens.
  if (Array.isArray(via) && via.length) {
    const player = await playerSnapshot(harness);
    // Skip via points already behind us: start from the nearest one, so the
    // same route table serves whether the walk begins at its head or midway.
    let start = 0;
    let best = Infinity;
    via.forEach((point, index) => {
      const gap = distanceBetween(player.position, point);
      if (gap < best) { best = gap; start = index; }
    });
    // A planned route ends on the destination's own face, so its last via
    // points can sit behind the object the walker is going to use (106PER's
    // Decontamination Console: via 38 was 1 m past the console and the push
    // stood on its collision for two minutes). Anything within 3 m of the
    // destination is the final approach's job.
    const finalApproachRadius = Math.max(3, Number(range) + 1);
    let end = via.length;
    while (end > start + 1 && distanceBetween(via[end - 1], { x, y, z }) <= finalApproachRadius) end -= 1;
    for (let index = start; index < end; index += 1) {
      const point = via[index];
      const legLabel = `${label} via ${index + 1}/${via.length}`;
      // Straight pushes first, not the engine planner: via points come from
      // the walkmesh map five metres apart along the corridor, and the
      // planner routed one such leg back through a door onto a Broken Droid.
      // A short sweep too: chasing a droid 13 m away through the planner
      // walked the Exile 25 m off the route. When the straight push slides
      // into a notch in the wall (102PER at -11.7,-51.9), the planner is
      // right about a five-metre leg inside one room, so try it second.
      // Arrive close (1.2 m): a leg that starts 2.4 m to the side of its
      // via point can aim straight into a notch in the corridor wall.
      const leg = { ...point, label: legLabel, range: 1.2, sweepRadius: Math.min(sweepRadius, 8), rounds: 1, permittedDoorPromptIds };
      const died = (error) => /player died/i.test(String(error.message));
      try {
        await travelTo(harness, { ...leg, usePath: false });
      } catch (straightError) {
        if (died(straightError)) throw straightError;
        // Back off to the previous via point (exactly), then push straight
        // again from the right side of the corridor.
        const previous = index > 0 ? via[index - 1] : null;
        let recovered = false;
        if (previous) {
          try {
            await travelTo(harness, { ...previous, label: `${legLabel} back-off`, range: 0.8, sweepRadius: 8, rounds: 1, usePath: false });
            await travelTo(harness, { ...leg, label: `${legLabel} (retry)`, usePath: false });
            recovered = true;
          } catch (retryError) {
            if (died(retryError)) throw retryError;
          }
        }
        if (!recovered) {
          try {
            await travelTo(harness, { ...leg, label: `${legLabel} (planned)`, usePath: true });
            recovered = true;
          } catch (error) {
            if (died(error)) throw error;
            line(`  · ${legLabel}: ${String(error.message).slice(0, 120)}`);
          }
        }
        if (!recovered) {
          // Off the route (104PER: a back-off shoved the walker onto the
          // parallel strand), pressing on to later via points only compounds
          // it. Walk back along up to three earlier via points by straight
          // push and try the leg once more from there.
          const here = await playerSnapshot(harness);
          if (!here || !here.position) throw new Error(`${legLabel}: no player position (module changing?)`);
          if (distanceBetween(here.position, point) > 6) {
            for (let back = Math.max(0, index - 3); back < index; back += 1) {
              await travelTo(harness, { ...via[back], label: `${legLabel} back-track ${back + 1}`, range: 1.2, sweepRadius: 8, rounds: 1, usePath: false }).catch(() => undefined);
            }
            try {
              await travelTo(harness, { ...leg, label: `${legLabel} (after back-track)`, usePath: false });
              recovered = true;
            } catch (error) {
              if (died(error)) throw error;
              line(`  · ${legLabel}: ${String(error.message).slice(0, 120)}; continuing to the next leg`);
            }
          } else {
            line(`  · ${legLabel}: within 6 m; continuing to the next leg`);
          }
        }
      }
      // A trigger on the way can start a movie or a conversation (Atton over
      // the comlink, the Harbinger's arrival); settle it before the next leg.
      if (viaChooser) await playAnyPendingConversation(harness, { choose: viaChooser, label: `${legLabel} interruption` });
    }
  }
  let lastError = null;
  const lastVia = Array.isArray(via) && via.length ? via[via.length - 1] : null;
  for (let round = 1; round <= rounds; round += 1) {
    const fought = await clearHostiles(harness, { limit: 6, maxDistance: sweepRadius });
    if (fought.some((o) => o.reason === 'player died')) throw new Error(`${label}: the player died on the way`);
    // A sweep can drag the walker a room away (two droids 14 m off in the
    // 102PER core pocket); come back to the last via point by straight push
    // before the final approach, which the engine planner then gets right.
    if (lastVia && fought.length) {
      const here = await playerSnapshot(harness);
      if (distanceBetween(here.position, lastVia) > 3) {
        await navigateTo(harness, { ...lastVia, range: 1.2, label: `${label} (back to the route)`, maxAttempts: 3, usePath: false }).catch((error) => {
          line(`  · ${label}: could not return to the route (${String(error.message).slice(0, 100)})`);
        });
      }
    }
    try {
      const arrived = await navigateTo(harness, { x, y, z, range, label, maxAttempts: usePath ? 6 : 3, permittedDoorPromptIds, usePath });
      return { arrived, rounds: round };
    } catch (error) {
      lastError = error;
      // A leg that failed because the player is dead must say so, or the
      // stall handling below nudges a corpse for the rest of the route.
      const vitals = await playerVitals(harness);
      if ((vitals && vitals.dead) || /player died/i.test(String(error.message))) throw new Error(`${label}: the player died on the way`);
      await clearBlockingModal(harness);
      await clearProgressBlockingDialogue(harness, label).catch(() => undefined);
      await nudgeFree(harness, label);
      const survey = await surveyArea(harness);
      // Only a hostile close enough to be the reason for the stall is worth
      // chasing: in the mining tunnels the walker spent minutes pathing to
      // droids thirty metres away, behind doors, and never reached them.
      const chaseRadius = Math.min(sweepRadius, 12);
      const near = (survey.hostiles || []).filter((h) => Number(h.distance) <= chaseRadius);
      line(`  · ${label}: walk ${round} stalled (${String(error.message).slice(0, 90)}); ` +
        `${near.length} hostile(s) within ${chaseRadius}m`);
      if (!near.length && round >= 2) throw error;
      for (const hostile of near.slice(0, 3)) {
        const result = await fightHostile(harness, hostile);
        line(`  · ${hostile.name}: ${result.killed ? 'killed' : `not killed (${result.reason})`}`);
        if (result.reason === 'player died') throw new Error(`${label}: the player died fighting ${hostile.name}`);
      }
    }
  }
  throw lastError || new Error(`${label}: unreachable`);
}

/** Opens a tagged container near a point and takes everything in it. */
async function lootTagged(harness, { tag, near, label }) {
  const target = await findTaggedNear(harness, tag, near);
  if (!target) throw new Error(`${label}: no ${tag} near ${JSON.stringify(near)}`);
  const used = await useTaggedWorldObject(harness, {
    tag, targetId: target.id, actionPattern: /^Use:/i, range: 1.8, maxAttempts: 4,
  });
  const container = used.container || {};
  line(`  · ${label}: took ${JSON.stringify(container.names || [])}` +
    (container.skipped && container.skipped.length ? ` skipped ${JSON.stringify(container.skipped)}` : ''));
  await returnToGameplay(harness);
  return { target, used };
}

async function playerSnapshot(harness) {
  return harness.evaluate(`(() => {
    const K = window.KotOR;
    const player = K.PartyManager.party[0];
    if (!player) return { located: false };
    return {
      located: true,
      tag: String(player.tag || ''),
      name: (() => { try { return String(player.getName()); } catch (e) { return ''; } })(),
      isPlayer: !!player.isPlayer,
      npcId: player.npcId,
      position: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2) },
      hp: player.getHP ? player.getHP() : null,
      lvl: player.getTotalClassLevel ? player.getTotalClassLevel() : null,
      module: String(K.GameState.module && K.GameState.module.area ? K.GameState.module.area.name : ''),
      partySize: K.PartyManager.party.length,
    };
  })()`);
}

/** Uses a console or other conversation-bearing object and plays what it starts. */
async function useAndConverse(harness, { tag, near, actionPattern = /^Use:/i, choose, label, range = 1.8 }) {
  const target = near ? await findTaggedNear(harness, tag, near) : (await findObjectByTag(harness, tag))[0];
  if (!target) throw new Error(`${label}: no object tagged ${tag}`);
  const used = await useTaggedWorldObject(harness, { tag, targetId: target.id, actionPattern, range, maxAttempts: 4 });
  const started = await waitForConversation(harness, 12_000);
  if (!started) {
    const state = await worldState(harness);
    throw new Error(`${label}: using ${target.name || tag} started no conversation; ` +
      `foreground=${state.foregroundMenu} mode=${state.engineMode} used=${JSON.stringify(used.action)}`);
  }
  const played = await playConversation(harness, { choose, label });
  line(`  · ${label}: ${played.turns} turns over ${JSON.stringify(played.menus)}; picked ${JSON.stringify(choose && choose.picks || [])}`);
  for (const entry of played.transcript.slice(-6)) line(`      ${String(entry).slice(0, 150)}`);
  await clearBlockingModal(harness);
  await returnToGameplay(harness);
  return { target, used, played };
}

// ---------------------------------------------------------------------------
// Stage A: the administration level, as the Exile
// ---------------------------------------------------------------------------

const VIBROCUTTER_CORPSE = { x: -27.7, y: -13.9, z: 9.1 };
const SECURITY_ROOM = { x: 46.5, y: -52.2, z: 9.1 };
const SECURITY_SPIKE_CORPSE = { x: 48.8, y: -57.2, z: 9.1 };
const ADMIN_CONSOLE = { x: 87.7, y: -71.8, z: 8.9 };
const ATTON_CAGE = { x: 67.8, y: -13.2, z: 9.1 };
const PRISON_DOOR = { x: 73.6, y: -12.4, z: 9.1 };

// Room centres and doorways of 101PER, from the module's door placements. The
// medical bay side is a chain of rooms behind PeragusDoor1 doors; the main
// body is open with the comm blister south, the prison north and the
// security/storage rooms west.
const Z = 9.1;
const ADMIN_MAIN_BODY_WEST = { x: 70, y: -38, z: Z };
const ADMIN_STORAGE_DOORS = { x: 61.5, y: -35.7, z: Z };
const ADMIN_STORAGE_ROOM = { x: 48, y: -36, z: Z };
const ADMIN_STORAGE_TO_SECURITY = { x: 47.9, y: -47.8, z: Z };
const ADMIN_SECURITY_ROOM = { x: 46, y: -52, z: Z };
const ADMIN_SECURITY_TO_HATCH = { x: 40.9, y: -51.4, z: Z };
const ADMIN_HATCH_ROOM = { x: 31, y: -45, z: Z };
const ADMIN_HATCH_TO_AREA3 = { x: 18.6, y: -44.4, z: Z };
const ADMIN_AREA3 = { x: 8, y: -39, z: Z };
const ADMIN_AREA3_TO_AREA2 = { x: -0.9, y: -34.5, z: Z };
const ADMIN_AREA2 = { x: -9, y: -30, z: Z };
const ADMIN_AREA2_TO_VIBRO = { x: -19.2, y: -22.3, z: Z };
const ADMIN_VIBRO_ROOM = { x: -25, y: -15, z: Z };
const ADMIN_BLISTER_ENTRY = { x: 85.8, y: -54.1, z: 9.0 };
const ADMIN_PRISON_APPROACH = { x: 75, y: -22, z: Z };

const ROUTE_MAIN_BODY_TO_VIBROCUTTER = [
  ADMIN_MAIN_BODY_WEST, ADMIN_STORAGE_DOORS, ADMIN_STORAGE_ROOM, ADMIN_STORAGE_TO_SECURITY, ADMIN_SECURITY_ROOM,
  ADMIN_SECURITY_TO_HATCH, ADMIN_HATCH_ROOM, ADMIN_HATCH_TO_AREA3, ADMIN_AREA3, ADMIN_AREA3_TO_AREA2, ADMIN_AREA2,
  ADMIN_AREA2_TO_VIBRO,
];
const ROUTE_VIBROCUTTER_TO_SECURITY_ROOM = [
  ADMIN_AREA2_TO_VIBRO, ADMIN_AREA2, ADMIN_AREA3_TO_AREA2, ADMIN_AREA3, ADMIN_HATCH_TO_AREA3,
  ADMIN_HATCH_ROOM, ADMIN_SECURITY_TO_HATCH, ADMIN_SECURITY_ROOM,
];
const ROUTE_SECURITY_ROOM_TO_CONSOLE = [
  ADMIN_SECURITY_ROOM, ADMIN_STORAGE_TO_SECURITY, ADMIN_STORAGE_ROOM, ADMIN_STORAGE_DOORS, ADMIN_MAIN_BODY_WEST,
  ADMIN_BLISTER_ENTRY,
];
const ROUTE_CONSOLE_TO_PRISON = [ADMIN_BLISTER_ENTRY, ADMIN_MAIN_BODY_WEST, ADMIN_PRISON_APPROACH];
const ROUTE_PRISON_TO_CONSOLE = [ADMIN_PRISON_APPROACH, ADMIN_MAIN_BODY_WEST, ADMIN_BLISTER_ENTRY];

async function stageAdministrationLevel(ctx) {
  const { harness, args, record, report, resumedPast } = ctx;

  await record('take the Vibroblade from the corpse beyond the Damaged Door', async () => {
    if (resumedPast(args, 'vibroblade')) return { skipped: 'resumed past it' };
    // corpse{Vibrocutter}, one of three LowCorpse placeables in 101PER. The
    // walkthrough: "The vibroblade is a better weapon than the plasma torch,
    // and you'll be needing it in the next room."
    await travelTo(harness, { ...VIBROCUTTER_CORPSE, label: 'vibrocutter corpse', range: 2.2, via: ROUTE_MAIN_BODY_TO_VIBROCUTTER });
    const loot = await lootTagged(harness, { tag: 'LowCorpse', near: VIBROCUTTER_CORPSE, label: 'corpse' });
    const equipped = await equipPlayerWeapon(harness, 'Vibroblade');
    line(`  · Vibroblade: ${JSON.stringify(equipped)}`);
    if (!equipped.ok) {
      throw new Error(`could not equip the Vibroblade: ${equipped.reason}`);
    }
    return { loot: loot.used.container, equipped };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'vibroblade')) {
    await record('checkpoint: vibroblade', () => checkpoint(harness, 'vibroblade'));
    if (report.blocked) return;
  }

  await record('reach the security room and take the Security Tunneler', async () => {
    if (resumedPast(args, 'security-room')) return { skipped: 'resumed past it' };
    await travelTo(harness, { ...SECURITY_ROOM, label: 'security room', range: 2.5, via: ROUTE_VIBROCUTTER_TO_SECURITY_ROOM });
    const loot = await lootTagged(harness, { tag: 'LowCorpse', near: SECURITY_SPIKE_CORPSE, label: 'security corpse' });
    const inventory = await describeInventory(harness);
    line(`  · carrying ${inventory.inventoryCount}: ${JSON.stringify(inventory.inventory.slice(0, 16))}`);
    return { loot: loot.used.container, inventory: inventory.inventory };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'security-room')) {
    await record('checkpoint: security room', () => checkpoint(harness, 'security-room'));
    if (report.blocked) return;
  }

  await record('activate the security override on the Administration Computer', async () => {
    if (resumedPast(args, 'admin-override')) return { skipped: 'resumed past it' };
    // Through the storage room's three droids and the main body of the level
    // to the communications blister. admlog.dlg: the encrypted console offers
    // "Look for the control override switch." then "Activate the switch."
    // (a_local_set 30 -> a_unlock_prison), which deactivates the remaining
    // droids and drops the holding cell's force field.
    await travelTo(harness, { ...ADMIN_CONSOLE, label: 'Administration Computer', range: 2.2, sweepRadius: 22, rounds: 6, via: ROUTE_SECURITY_ROOM_TO_CONSOLE });
    const chooser = createPriorityChooser([
      /^Look for the control override switch/i,
      /^Activate the switch/i,
      /^Log out/i,
    ], { label: 'Administration Computer' });
    const result = await useAndConverse(harness, {
      tag: 'Adm_Console', choose: chooser, label: 'Administration Computer',
    });
    if (!chooser.picks.some((pick) => /^Activate the switch/i.test(pick))) {
      throw new Error(`the override switch was never offered; picked ${JSON.stringify(chooser.picks)}`);
    }
    // The switch runs k_door_heart on the prison door 0.8s later.
    await sleep(2500);
    const door = await findTaggedNear(harness, 'PrisonRoomDr', PRISON_DOOR);
    line(`  · prison door after the override: ${JSON.stringify(door)}`);
    if (!door || door.locked !== false) {
      throw new Error(`the holding cell door is still locked after the override: ${JSON.stringify(door)}`);
    }
    return { picks: chooser.picks, transcript: result.played.transcript.slice(-8), door };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'admin-override')) {
    await record('checkpoint: admin override', () => checkpoint(harness, 'admin-override'));
    if (report.blocked) return;
  }

  await record('free Atton from the holding cell', async () => {
    if (resumedPast(args, 'atton-freed')) return { skipped: 'resumed past it' };
    // The prison door's OnOpen (k_attontlk) starts 101atton only when Kreia
    // has already spoken about the cell (101PER_Kreia_Telepath), which needs
    // the locked door to have been tried — an action VR does not offer on a
    // key-locked door. Talking to Atton directly reaches the same tree
    // ("You back here to torture me?" -> "I've come to let you out.").
    await travelTo(harness, { ...ATTON_CAGE, label: "Atton's cage", range: 2.6, sweepRadius: 20, via: ROUTE_CONSOLE_TO_PRISON });
    await sleep(800);
    let played = null;
    const chooser = createPriorityChooser([
      /let you out/i,
      /^All right, let's go/i,
      /reach someone on the comm/i,
      /^What's wrong\?/i,
      /Did someone do it on purpose|Is that part of the lockdown/i,
      /anything else we can do with this console/i,
      /Can we contact the miners/i,
      /Do you have some plan for getting out/i,
      /^How can you help\?/i,
      /deserted\. What happened\?/i,
      /this facility seems abandoned/i,
      /couldn't care less about Revan|heard enough\. Let me ask you something else/i,
      /None taken - I had some more questions|^I had some more questions for you/i,
      /bounty on captured Jedi/i,
      /Not many Jedi left/i,
      /heard rumors of a war/i,
      /^Who are you\?/i,
    ], { label: 'Atton', unseenFallback: true });
    // The door's own OnOpen may already have started it.
    if (await waitForConversation(harness, 2000)) {
      played = await playConversation(harness, { choose: chooser, label: 'Atton (door)' });
    } else {
      const atton = (await findObjectByTag(harness, 'Atton'))[0];
      if (!atton) throw new Error('Atton is not in the area');
      const used = await useTaggedWorldObject(harness, {
        tag: 'Atton', targetId: atton.id, actionPattern: /^(Use|Talk)/i, range: 2.6, maxAttempts: 4,
      });
      line(`  · talking to Atton via ${JSON.stringify(used.action)}`);
      if (!(await waitForConversation(harness, 12_000))) {
        const state = await worldState(harness);
        throw new Error(`talking to Atton started no conversation: foreground=${state.foregroundMenu} mode=${state.engineMode}`);
      }
      played = await playConversation(harness, { choose: chooser, label: 'Atton' });
    }
    line(`  · Atton: ${played.turns} turns; picked ${JSON.stringify(chooser.picks)}`);
    for (const entry of played.transcript.slice(-8)) line(`      ${String(entry).slice(0, 150)}`);
    await clearBlockingModal(harness);
    await returnToGameplay(harness);
    if (!chooser.picks.some((pick) => /let you out/i.test(pick))) {
      throw new Error(`Atton was never let out; picked ${JSON.stringify(chooser.picks)}`);
    }
    // a_setcode fires on "Be my guest - the comm's all yours", which unlocks the
    // console's comm functions (admlog E2, c_chkcode). Verify it took.
    const code = await readGlobalNumber(harness, '101PER_Switch');
    const cage = await findObjectByTag(harness, 'Atton').catch(() => []);
    line(`  · 101PER_Switch=${JSON.stringify(code.value)} Atton at ${JSON.stringify(cage[0] && cage[0].position)}`);
    if (!chooser.picks.some((pick) => /reach someone on the comm/i.test(pick))) {
      throw new Error(`Atton never reached the console conversation; picked ${JSON.stringify(chooser.picks)}`);
    }
    return { picks: chooser.picks, transcript: played.transcript.slice(-10), code: code.value };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'atton-freed')) {
    await record('checkpoint: Atton freed', () => checkpoint(harness, 'atton-freed'));
    if (report.blocked) return;
  }

  await record('raise T3-M4 on the comm and take control of him in the hangar', async () => {
    if (resumedPast(args, 't3-hangar')) return { skipped: 'resumed past it' };
    // admlog E2 -> "Access comm system." -> "Hangar Bay 25." -> "Can you read
    // me?" -> a_t3m4_dlg_fire hands the conversation to T3-M4 (101t3m4.dlg),
    // whose last reply runs a_106perjump: AddAvailableNPCByObject(8), the
    // PER_TURNINTO_T3M4 flag and StartNewModule("106PER"); 106PER's area
    // OnEnter (a_transformt3m4) then calls SwitchPlayerCharacter(8).
    await travelTo(harness, { ...ADMIN_CONSOLE, label: 'Administration Computer', range: 2.2, sweepRadius: 20, via: ROUTE_PRISON_TO_CONSOLE });
    const chooser = createPriorityChooser([
      /^Access comm system/i,
      /^Hangar Bay 25/i,
      /^Can you read me\?/i,
      /^Do a diagnostic, then follow my instructions/i,
      /another route off this level/i,
      /other way out of here besides the turbolifts/i,
      /rather risk it than be trapped up here/i,
    ], { label: 'comm to T3-M4' });
    const before = await playerSnapshot(harness);
    const result = await useAndConverse(harness, { tag: 'Adm_Console', choose: chooser, label: 'comm to T3-M4' });
    if (!chooser.picks.some((pick) => /rather risk it/i.test(pick))) {
      throw new Error(`the T3-M4 handoff was never reached; picked ${JSON.stringify(chooser.picks)}`);
    }
    await waitForModule(harness, '106per', TIMEOUTS.moduleLoad);
    // SwitchPlayerCharacter(8) runs a second after the area is entered.
    const switched = await harness.waitFor(`(() => {
      const player = window.KotOR.PartyManager.party[0];
      return !!(player && /^t3m4$/i.test(String(player.tag || '')));
    })()`, 60_000, 500).then(() => true).catch(() => false);
    await sleep(1500);
    await returnToGameplay(harness);
    const after = await playerSnapshot(harness);
    line(`  · now in ${after.module} as ${after.name} (tag=${after.tag}, npcId=${after.npcId}) at ${JSON.stringify(after.position)}`);
    if (!switched) {
      throw new Error(`106PER loaded but the player was never switched to T3-M4: ${JSON.stringify({ before, after })}`);
    }
    return { picks: chooser.picks, transcript: result.played.transcript.slice(-8), before, after };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 't3-hangar')) {
    await record('checkpoint: T3-M4 in the hangar', () => checkpoint(harness, 't3-hangar'));
  }
}

// ---------------------------------------------------------------------------
// More world helpers, for the T3-M4 leg
// ---------------------------------------------------------------------------

function inventoryQuantity(inventory, pattern) {
  return (inventory || []).reduce((total, item) => {
    if (!item || !pattern.test(String(item.name || ''))) return total;
    const quantity = Number(item.stack);
    return total + (Number.isInteger(quantity) && quantity > 0 ? quantity : 1);
  }, 0);
}

async function inventoryReport(harness, label) {
  const inventory = await describeInventory(harness);
  if (!inventory.located) throw new Error(`${label}: ${inventory.reason}`);
  const counts = {
    parts: inventoryQuantity(inventory.inventory, /^parts$/i),
    spikes: inventoryQuantity(inventory.inventory, /computer spike/i),
    mines: inventoryQuantity(inventory.inventory, /mine$/i),
    medpacs: inventoryQuantity(inventory.inventory, /^medpac/i),
  };
  line(`  · ${label}: ${inventory.playerName} lvl ${inventory.level} hp ${inventory.hp}/${inventory.maxHp}; ` +
    `${JSON.stringify(counts)}; carrying ${inventory.inventoryCount}: ${JSON.stringify(inventory.inventory.slice(0, 14))}`);
  return { ...inventory, counts };
}

/** Reads a prompt for an object, walking closer until it is in range. */
async function promptFor(harness, target, { label, range = 2.4, approaches = 3 }) {
  let offered = null;
  for (let approach = 1; approach <= approaches; approach += 1) {
    const prompts = await listWorldPrompts(harness);
    offered = (prompts.prompts || []).find((prompt) => prompt.id === target.promptId);
    if (offered && offered.inRange === true && Array.isArray(offered.actions)) return offered;
    try {
      await navigateTo(harness, {
        x: target.position.x, y: target.position.y, z: target.position.z,
        range, label, maxAttempts: 4, permittedDoorPromptIds: [],
      });
    } catch (error) {
      line(`  · ${label}: approach ${approach} fell short (${String(error.message).slice(0, 80)})`);
    }
    await sleep(800);
  }
  const prompts = await listWorldPrompts(harness);
  offered = (prompts.prompts || []).find((prompt) => prompt.id === target.promptId);
  if (offered && offered.inRange === true && Array.isArray(offered.actions)) return offered;
  throw new Error(`${label}: no in-range VR prompt: ${JSON.stringify(offered || null)}`);
}

/**
 * Transition triggers only fire when the player's point is inside the
 * trigger's box (ModuleTrigger.updateObjectInside), and a GIT trigger's
 * position is its first polygon vertex, not its centre: 101PER's To_102PER
 * sits at (36.2,-23.9) but its box runs 36.25..40.67 x -25..-21.85, so the
 * driver stood on the corner, just outside. Resolve the live box centre and
 * walk into that instead.
 */
async function transitionTriggerCenter(harness, { module, near, tag = null }) {
  const found = await harness.evaluate(`(() => {
    const K = window.KotOR; const gs = K.GameState; const area = gs.module && gs.module.area;
    if (!area) return null;
    const want = ${JSON.stringify(String(module || '').toLowerCase())};
    const wantTag = ${JSON.stringify(tag ? String(tag).toLowerCase() : null)};
    const near = ${JSON.stringify(near)};
    // A tagged trigger is a scripted one (106PER's TO_107PERm: k_force003ebodlg
    // starts ebonhawk.dlg, whose "[Enter the Ebon Hawk.]" loads 107PER); it
    // has no linkedToModule, so it is found by tag.
    const trigs = (area.triggers || []).filter((t) => t && t.box && (wantTag ? String(t.tag || '').toLowerCase() === wantTag : String(t.linkedToModule || '').toLowerCase() === want));
    if (!trigs.length) return null;
    trigs.sort((a, b) => a.position.distanceTo(near) - b.position.distanceTo(near));
    const t = trigs[0];
    const c = t.box.getCenter(t.position.clone());
    return { tag: String(t.tag), linkedTo: t.linkedTo, x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +t.position.z.toFixed(2),
      min: [+t.box.min.x.toFixed(2), +t.box.min.y.toFixed(2)], max: [+t.box.max.x.toFixed(2), +t.box.max.y.toFixed(2)], triggered: t.triggered };
  })()`);
  if (!found) throw new Error(`no ${tag ? `trigger tagged ${tag}` : `transition trigger to ${module}`} in this area`);
  return found;
}

/**
 * Records every position write and room change on the player across a module
 * transition. The player object survives the transition, so hooks installed
 * before the push report where the arrival placement was moved afterwards:
 * the stage E arrival in 103PER ended 12.7 m north of From_153HAR, outside
 * the fuel pipe, and a plain LoadModule replay did not reproduce it.
 */
async function installArrivalTrace(harness) {
  await harness.evaluate(`(() => {
    const K = window.KotOR; const p = K.PartyManager.party[0]; if (!p || p.__arrivalTraced) return false;
    p.__arrivalTraced = true; window.__arrivalMoves = []; const startArea = p.area;
    const stack = () => String(new Error().stack).split(String.fromCharCode(10)).slice(2, 7).map((s) => s.trim().replace('at ', '').split('webpack-internal:///./src/').join('').slice(0, 80));
    const push = (entry) => { if (window.__arrivalMoves.length < 140) window.__arrivalMoves.push({ t: Math.round(performance.now()), ...entry }); };
    const origSet = p.setPosition.bind(p);
    p.setPosition = (...a) => { push({ kind: 'setPosition', to: a[0] && a[0].x !== undefined ? [+a[0].x.toFixed(2), +a[0].y.toFixed(2)] : String(a[0]), stack: stack() }); return origSet(...a); };
    const origCopy = p.position.copy.bind(p.position);
    p.position.copy = (v) => { push({ kind: 'position.copy', to: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)], stack: stack() }); return origCopy(v); };
    const origPosSet = p.position.set.bind(p.position);
    p.position.set = (x, y, z) => { push({ kind: 'position.set', to: [+(+x).toFixed(2), +(+y).toFixed(2), +(+z).toFixed(2)], stack: stack() }); return origPosSet(x, y, z); };
    // Frame-by-frame movement goes through position.add (CollisionManager)
    // and is far too frequent to keep; count it, and keep the ones made while
    // the engine is not in gameplay mode or the player has no room.
    window.__arrivalAdds = 0;
    const origAdd = p.position.add.bind(p.position);
    p.position.add = (v) => { window.__arrivalAdds += 1; const mode = K.GameState.Mode; if (p.area !== startArea && (Math.abs(v.x) + Math.abs(v.y) > 0.02 || !p.room)) push({ kind: 'position.add', mode, room: p.room && p.area ? p.area.rooms.indexOf(p.room) : null, at: [+p.position.x.toFixed(2), +p.position.y.toFixed(2)], by: [+v.x.toFixed(3), +v.y.toFixed(3)], stack: stack().slice(0, 3) }); return origAdd(v); };
    const origAttach = p.attachToRoom.bind(p);
    p.attachToRoom = (room) => { const from = p.room && p.area ? p.area.rooms.indexOf(p.room) : null; const to = room && p.area ? p.area.rooms.indexOf(room) : null; if (from !== to) push({ kind: 'attachToRoom', from, to, pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)], stack: stack() }); return origAttach(room); };
    return true;
  })()`).catch(() => false);
}

async function reportArrivalTrace(harness, label) {
  const moves = await harness.evaluate(`(() => { const m = window.__arrivalMoves || []; window.__arrivalMoves = []; return m; })()`).catch(() => []);
  const adds = await harness.evaluate(`window.__arrivalAdds || 0`).catch(() => null);
  if (!moves.length) { line(`  · ${label}: no traced position/room writes (position.add calls: ${adds})`); return; }
  line(`  · ${label}: ${moves.length} player position/room writes across the transition (position.add calls: ${adds}):`);
  for (const move of moves.slice(0, 40)) line(`      ${JSON.stringify(move)}`);
}

async function walkIntoTransition(harness, { module, near, label, tag = null, via = null, viaChooser = null, sweepRadius = 10, rounds = 3, timeout = TIMEOUTS.moduleLoad }) {
  const trigger = await transitionTriggerCenter(harness, { module, near, tag });
  await installArrivalTrace(harness);
  line(`  · ${label}: trigger ${trigger.tag} box ${JSON.stringify(trigger.min)}..${JSON.stringify(trigger.max)}, aiming at (${trigger.x}, ${trigger.y})`);
  const halfSpan = Math.max(0.5, Math.min(trigger.max[0] - trigger.min[0], trigger.max[1] - trigger.min[1]) / 2 - 0.2);
  const from = await harness.evaluate(`(() => { const gs = window.KotOR.GameState; return gs.module && gs.module.area ? String(gs.module.area.name).toLowerCase() : null; })()`);
  try {
    await travelTo(harness, { x: trigger.x, y: trigger.y, z: trigger.z, label, range: Math.min(0.9, halfSpan), sweepRadius, rounds, via, viaChooser });
  } catch (error) {
    // The trigger fires the moment the player's point enters the box, and
    // the module unloads under the walker ("survey: no player", "no area or
    // player"). That is the transition starting, not a failed walk.
    const now = await harness.evaluate(`(() => { const gs = window.KotOR.GameState; const p = window.KotOR.PartyManager.party[0];
      return { mode: gs.Mode, loading: !!gs.loadingModule, module: gs.module && gs.module.area ? String(gs.module.area.name).toLowerCase() : null, hasPlayer: !!p }; })()`).catch(() => null);
    const transitioning = now && (now.loading || !now.hasPlayer || now.module !== from);
    if (!transitioning) throw error;
    line(`  · ${label}: transition began under the walker (${String(error.message).slice(0, 80)})`);
  }
  await waitForModule(harness, module, timeout);
  await sleep(2500);
  await reportArrivalTrace(harness, label);
  return trigger;
}

async function objectState(harness, id) {
  return harness.evaluate(`(() => {
    const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
    if (!area) return { located: false };
    const pools = [area.doors, area.placeables, area.creatures, area.triggers];
    for (const pool of pools) {
      const object = (pool || []).find((o) => o && o.id === ${Number(id)});
      if (!object) continue;
      return {
        located: true,
        tag: String(object.tag || ''),
        open: typeof object.isOpen === 'function' ? !!object.isOpen() : null,
        locked: typeof object.isLocked === 'function' ? !!object.isLocked() : null,
        dead: typeof object.isDead === 'function' ? !!object.isDead() : null,
        hp: typeof object.getHP === 'function' ? object.getHP() : null,
      };
    }
    return { located: false };
  })()`);
}

/**
 * Opens a container that may be locked: Security first when the prompt offers
 * it, then Use, then takes everything. Bash is never substituted — a bashed
 * container breaks an item, which is a different playthrough.
 */
async function openLockedContainer(harness, { tag, near, label }) {
  const target = await findTaggedNear(harness, tag, near);
  if (!target) throw new Error(`${label}: no ${tag} near ${JSON.stringify(near)}`);
  await travelTo(harness, { ...target.position, label, range: 2.0, sweepRadius: 14, rounds: 3 });
  let offered = await promptFor(harness, target, { label, range: 1.8 });
  const attempts = [];
  for (let round = 0; round < 6; round += 1) {
    const use = offered.actions.find((a) => /^Use:/i.test(a));
    if (use) {
      const activation = await activateWorldAction(harness, { objectId: target.promptId, actionLabel: use });
      const container = await resolveOpenedContainer(harness);
      attempts.push(use);
      line(`  · ${label}: ${use} -> took ${JSON.stringify(container.names || [])}`);
      await returnToGameplay(harness);
      return { target, attempts, container, activation };
    }
    const security = offered.actions.find((a) => /security/i.test(a));
    if (!security) {
      throw new Error(`${label}: neither Use nor Security offered: ${JSON.stringify(offered.actions)}`);
    }
    await activateWorldAction(harness, { objectId: target.promptId, actionLabel: security });
    attempts.push(security);
    // Security is a 1.5s action; re-pressing restarts it (headset round 3).
    await sleep(3500);
    await clearBlockingModal(harness);
    const state = await objectState(harness, target.id);
    line(`  · ${label}: after ${security}: ${JSON.stringify(state)}`);
    offered = await promptFor(harness, target, { label, range: 1.8 });
  }
  throw new Error(`${label}: still locked after ${JSON.stringify(attempts)}`);
}

/**
 * Walks to a module-transition door, uses it, and waits for the far module.
 * The door's own LinkedToModule drives the transition; nothing is scripted.
 */
async function transitThroughDoor(harness, { tag, near, label, expectModule, playerTag = null, via = null }) {
  const door = await findTaggedNear(harness, tag, near);
  if (!door) throw new Error(`${label}: no door tagged ${tag}`);
  const fromModule = await harness.evaluate(`(() => { const gs = window.KotOR.GameState; return gs.module && gs.module.area ? String(gs.module.area.name).toLowerCase() : null; })()`).catch(() => null);
  try {
    await travelTo(harness, { ...door.position, label, range: 2.6, sweepRadius: 16, rounds: 3, via });
  } catch (error) {
    // An already-open transition door transits as soon as the approach
    // crosses its line (101PER's docking door to the Harbinger): the module
    // unloads under the walker and the approach reports a missing player.
    // That is the transition starting, not a failed walk.
    const now = await harness.evaluate(`(() => { const gs = window.KotOR.GameState; const p = window.KotOR.PartyManager.party[0];
      return { loading: !!gs.loadingModule, module: gs.module && gs.module.area ? String(gs.module.area.name).toLowerCase() : null, hasPlayer: !!p }; })()`).catch(() => null);
    const transitioning = now && (now.loading || !now.hasPlayer || now.module !== fromModule);
    if (!transitioning) throw error;
    line(`  · ${label}: transition began under the walker (${String(error.message).slice(0, 80)})`);
    await waitForModule(harness, expectModule, TIMEOUTS.moduleLoad);
    await sleep(1500);
    await returnToGameplay(harness);
    const arrivedEarly = await playerSnapshot(harness);
    line(`  · ${label}: now in ${arrivedEarly.module} as ${arrivedEarly.name} at ${JSON.stringify(arrivedEarly.position)}`);
    return { door, action: null, activation: null, arrived: arrivedEarly };
  }
  // A transition door transits when the player walks through it open:
  // CollisionManager tests the door's transition line against the
  // creature's forceVector, which VR locomotion drives. So: open it if it is
  // shut (the navigator may already have), then walk through to the far side.
  let state = await objectState(harness, door.id);
  let activation = null;
  let action = null;
  if (!state.open && !state.dead) {
    const offered = await promptFor(harness, door, { label, range: 2.4 });
    action = offered.actions.find((a) => /^(Use|Open)/i.test(a)) || offered.actions[0];
    line(`  · ${label}: ${JSON.stringify(offered.actions)} -> "${action}"`);
    activation = await activateWorldAction(harness, { objectId: door.promptId, actionLabel: action });
    await sleep(2000);
    await clearBlockingModal(harness);
    state = await objectState(harness, door.id);
    line(`  · ${label}: door after use ${JSON.stringify(state)}`);
  }
  const before = await playerSnapshot(harness);
  const moduleBefore = String(before.module || '').toLowerCase();
  const dx = door.position.x - before.position.x;
  const dy = door.position.y - before.position.y;
  const gap = Math.hypot(dx, dy) || 1;
  const beyond = { x: door.position.x + (dx / gap) * 3.0, y: door.position.y + (dy / gap) * 3.0, z: door.position.z };
  const crossed = harness.waitFor(`(() => {
    const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
    return !!(area && String(area.name || '').toLowerCase() !== ${JSON.stringify(moduleBefore)});
  })()`, 25_000, 500).then(() => true).catch(() => false);
  await moveTo(harness, { ...beyond, range: 0.8, usePath: false, timeoutMs: 20_000, label: `${label} (through)` }).catch(() => undefined);
  if (!(await crossed)) {
    line(`  · ${label}: walking through did not change module; trying once more from the doorway`);
    await moveTo(harness, { ...door.position, range: 0.5, usePath: false, timeoutMs: 15_000, label: `${label} (doorway)` }).catch(() => undefined);
    await moveTo(harness, { ...beyond, range: 0.8, usePath: false, timeoutMs: 15_000, label: `${label} (through again)` }).catch(() => undefined);
  }
  await waitForModule(harness, expectModule, TIMEOUTS.moduleLoad);
  if (playerTag) {
    await harness.waitFor(`(() => {
      const player = window.KotOR.PartyManager.party[0];
      return !!(player && String(player.tag || '').toLowerCase() === ${JSON.stringify(String(playerTag).toLowerCase())});
    })()`, 30_000, 500);
  }
  await sleep(1500);
  await returnToGameplay(harness);
  const arrived = await playerSnapshot(harness);
  line(`  · ${label}: now in ${arrived.module} as ${arrived.name} at ${JSON.stringify(arrived.position)}`);
  return { door, action, activation, arrived };
}

/**
 * Plants a mine on a door through its VR "Mine" action and waits for the
 * blast to open it. Mirrors the prologue's Engine Room Door step.
 */
async function blastDoorWithMine(harness, { tag, near, label, retreat }) {
  const door = await findTaggedNear(harness, tag, near);
  if (!door) throw new Error(`${label}: no door tagged ${tag}`);
  const already = await objectState(harness, door.id);
  if (already.open || already.dead) {
    // The navigator may have bashed it open on an earlier walk; a mine on a
    // wreck is not a test of anything.
    line(`  · ${label}: already ${already.dead ? 'destroyed' : 'open'}; no mine needed`);
    return { door, activation: null, state: already, skipped: true };
  }
  const before = await inventoryReport(harness, `${label} before`);
  if (before.counts.mines < 1) throw new Error(`${label}: no mine to plant`);
  await travelTo(harness, { ...door.position, label, range: 2.6, sweepRadius: 14, rounds: 3 });
  const offered = await promptFor(harness, door, { label, range: 2.4 });
  line(`  · ${label} prompt: ${JSON.stringify(offered.actions)}`);
  const action = offered.actions.find((a) => /^Mine$/i.test(a));
  if (!action) throw new Error(`${label}: Mine not offered: ${JSON.stringify(offered.actions)}`);
  const MINE_STACK = `(() => {
    const actor = window.KotOR.PartyManager.party[0];
    if (!actor || typeof actor.getInventory !== 'function') return null;
    return actor.getInventory().filter((item) => item && item.baseItemId === 58)
      .reduce((total, item) => total + (Number(item.stackSize) || 1), 0);
  })()`;
  const stackBefore = await harness.evaluate(MINE_STACK);
  const activation = await activateWorldAction(harness, { objectId: door.promptId, actionLabel: action });
  // Judge by the door, not only by the stack: on the hangar's welded door the
  // mine planted, fired and broke the door (console: ActionSetMine ITEM_USED,
  // "Trap Fired") while the actor's inventory count read unchanged for the
  // whole wait, and the run called that "never planted".
  const DOOR_OPEN = `(() => {
    const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
    const door = area && (area.doors || []).find((entry) => entry && entry.id === ${door.id});
    return !!(door && ((typeof door.isOpen === 'function' && door.isOpen()) || (typeof door.isDead === 'function' && door.isDead())));
  })()`;
  const planted = await harness.waitFor(`(() => {
    if (${DOOR_OPEN}) return true;
    const actor = window.KotOR.PartyManager.party[0];
    if (!actor || typeof actor.getInventory !== 'function') return false;
    const stack = actor.getInventory().filter((item) => item && item.baseItemId === 58)
      .reduce((total, item) => total + (Number(item.stackSize) || 1), 0);
    return stack < ${Number(stackBefore)};
  })()`, 30_000, 500).then(() => true).catch(() => false);
  const after = await inventoryReport(harness, `${label} after planting`);
  if (!planted && after.counts.mines >= before.counts.mines) {
    throw new Error(`${label}: the mine was never planted (${JSON.stringify(activation)})`);
  }
  if (retreat) await moveTo(harness, { ...retreat, range: 1.2, usePath: false, timeoutMs: 15_000, label: `${label} retreat` }).catch(() => undefined);
  const opened = await harness.waitFor(DOOR_OPEN, 45_000, 500).then(() => true).catch(() => false);
  const state = await objectState(harness, door.id);
  line(`  · ${label} after the blast: ${JSON.stringify({ opened, state })}`);
  if (!opened) throw new Error(`${label}: the mine did not open the door: ${JSON.stringify(state)}`);
  return { door, activation, state };
}

// ---------------------------------------------------------------------------
// Stage B: the hangar bay and fuel depot, as T3-M4
// ---------------------------------------------------------------------------

const HANGAR_STORAGE = { x: 1.4, y: 71.9, z: 9.3 };
const HANGAR_CARGO_FOOTLOCKER_1 = { x: 8.6, y: 69.1, z: 9.3 };
const HANGAR_CARGO_FOOTLOCKER_2 = { x: -5.2, y: 70.7, z: 9.3 };
const HANGAR_CARGO_BROKEN_DROID = { x: -0.7, y: 73.7, z: 9.3 };
const HANGAR_SUBLEVEL_DOOR = { x: -37.0, y: 74.2, z: 0.8 };      // Door_to_103PER2
const SUBLEVEL_BROKEN_DROID_COMPS = { x: -26.5, y: 63.1, z: 11.9 };
const SUBLEVEL_PARTS_CORPSE = { x: -31.2, y: 46.3, z: 11.9 };
const SUBLEVEL_PARTS_DROID = { x: -36.8, y: 44.4, z: 11.9 };
const SUBLEVEL_RETURN_DOOR = { x: -18.5, y: 66.5, z: 11.9 };     // DOOR_103PER2
const HANGAR_SEALED_DOOR = { x: 11.3, y: 79.0, z: 9.3 };          // BlastDoor
const HANGAR_SECURE_FOOTLOCKER = { x: 25.1, y: 81.0, z: 9.3 };
const HANGAR_CONTROL = { x: 0.0, y: 36.4, z: 12.8 };             // HangarTer
const HANGAR_FUEL_DEPOT_DOOR = { x: -61.9, y: 5.0, z: 9.3 };      // Door_to_103PER
const FUEL_CONTROL_STATION = { x: -28.4, y: 1.4, z: 22.4 };       // ComputerPanel

// 106PER's storage level (z 9.3) and the sub-level landing (z 0.8) are joined
// by a ramp that loops north through rooms 106PER17..21; the walkmesh planner
// keeps trying the ledge straight between them, which is a wall.
const ROUTE_STORAGE_TO_SUBLEVEL = [
  { x: -7.8, y: 74.1, z: 9.3 }, { x: -14.9, y: 75.5, z: 9.3 }, { x: -15.9, y: 93.5, z: 7.2 }, { x: -22.4, y: 111.0, z: 7.4 },
  { x: -28.8, y: 93.5, z: 3.0 }, { x: -34.7, y: 75.5, z: 3.2 },
];
const ROUTE_SUBLEVEL_TO_STORAGE = [...ROUTE_STORAGE_TO_SUBLEVEL].reverse();
// Out of the blasted cargo hold (106PER16, z 12) through its doorway, across
// the storage room and down its south door to the hangar control platform.
const ROUTE_CARGO_HOLD_TO_CONTROL = [
  { x: 16.0, y: 79.5, z: 12.1 }, { x: 11.3, y: 79.0, z: 9.5 }, { x: 4.0, y: 76.0, z: 9.3 }, { x: 0.0, y: 64.0, z: 9.3 },
  { x: 0.0, y: 52.0, z: 9.3 }, { x: 0.0, y: 44.0, z: 12.0 },
];
const ROUTE_STORAGE_TO_FUEL_DEPOT_DOOR = [
  { x: 0.0, y: 64.0, z: 9.3 }, { x: 0.0, y: 52.0, z: 9.3 }, { x: -9.6, y: 49.8, z: 9.3 }, { x: -26.0, y: 32.1, z: 9.4 },
  { x: -40.2, y: 11.8, z: 9.4 }, { x: -41.1, y: 5.0, z: 9.4 }, { x: -46.7, y: 5.0, z: 9.3 }, { x: -54.5, y: 5.0, z: 9.3 },
];

async function expectPlayerTag(harness, tag, label) {
  const player = await playerSnapshot(harness);
  if (!player.located || String(player.tag).toLowerCase() !== tag) {
    throw new Error(`${label}: expected to be playing ${tag}, but party[0] is ${JSON.stringify(player)}`);
  }
  return player;
}

async function stageT3Rescue(ctx) {
  const { harness, args, record, report, resumedPast } = ctx;

  await record('T3-M4: loot the hangar storage room and fetch Parts and mines from the sub-level', async () => {
    if (resumedPast(args, 't3-sublevel-parts')) return { skipped: 'resumed past it' };
    await expectPlayerTag(harness, 't3m4', 'hangar storage');
    const start = await inventoryReport(harness, 'T3-M4 start');
    // The storage room's two locked footlockers and broken droid. T3 has
    // Security 10, so the DC 21 locks open through the Security prompt.
    for (const [near, label] of [
      [HANGAR_CARGO_FOOTLOCKER_1, 'Footlocker (cargo 1)'],
      [HANGAR_CARGO_FOOTLOCKER_2, 'Footlocker (cargo 2)'],
    ]) {
      try { await openLockedContainer(harness, { tag: 'MilLowFootLker', near, label }); }
      catch (error) { line(`  · ${label}: ${String(error.message).slice(0, 140)}`); }
    }
    try { await lootTagged(harness, { tag: 'LowBroknDrd', near: HANGAR_CARGO_BROKEN_DROID, label: 'Broken Droid (cargo)' }); }
    catch (error) { line(`  · Broken Droid (cargo): ${String(error.message).slice(0, 140)}`); }

    // Down the ramp past the mining droids to the sub-level turbolift.
    const down = await transitThroughDoor(harness, {
      tag: 'Door_to_103PER2', near: HANGAR_SUBLEVEL_DOOR, label: 'turbolift to the fuel depot sub-level',
      expectModule: '103per', playerTag: 't3m4', via: ROUTE_STORAGE_TO_SUBLEVEL,
    });
    await lootTagged(harness, { tag: 'LowBroknDrd', near: SUBLEVEL_BROKEN_DROID_COMPS, label: 'Broken Droid (comps)' }).catch((error) =>
      line(`  · Broken Droid (comps): ${String(error.message).slice(0, 140)}`));
    // Across the fuel line: the corpse with the datapad, three Deadly Sonic
    // Mines and the ion striker, and the broken droid that holds the Parts.
    await travelTo(harness, { ...SUBLEVEL_PARTS_CORPSE, label: 'sub-level corpse', range: 2.2, sweepRadius: 14, rounds: 4 });
    await lootTagged(harness, { tag: 'LowCorpse', near: SUBLEVEL_PARTS_CORPSE, label: 'Corpse (parts)' });
    await lootTagged(harness, { tag: 'LowBroknDrd', near: SUBLEVEL_PARTS_DROID, label: 'Broken Droid (parts)' });
    const after = await inventoryReport(harness, 'after the sub-level');
    if (after.counts.parts < 1) throw new Error(`no Parts after the sub-level (had ${start.counts.parts})`);
    if (after.counts.mines < 1) throw new Error('no mine after the sub-level corpse');
    // Checking the corpse spawns two shielded droids back on the landing.
    const up = await transitThroughDoor(harness, {
      tag: 'DOOR_103PER2', near: SUBLEVEL_RETURN_DOOR, label: 'door back to the hangar bay',
      expectModule: '106per', playerTag: 't3m4',
    });
    return { start: start.counts, after: after.counts, down: down.arrived, up: up.arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 't3-sublevel-parts')) {
    await record('checkpoint: T3-M4 has Parts and mines', () => checkpoint(harness, 't3-sublevel-parts'));
    if (report.blocked) return;
  }

  await record('T3-M4: blast the sealed cargo door and take the computer spikes', async () => {
    if (resumedPast(args, 't3-spikes')) return { skipped: 'resumed past it' };
    await expectPlayerTag(harness, 't3m4', 'sealed door');
    // blastdr.dlg: "Someone has purposely welded this door shut. You'll need
    // to blast it open with explosives." Its OnOpen (k_cargodropen) flags the
    // hangar terminal. The footlocker inside holds the three Computer Spikes
    // the terminal needs to open the fuel depot door.
    // Back up the ramp loop to the storage level first; the mine step's own
    // approach is a short one from there.
    await travelTo(harness, { ...HANGAR_STORAGE, label: 'hangar storage room', range: 3.0, sweepRadius: 14, rounds: 4, via: ROUTE_SUBLEVEL_TO_STORAGE });
    const blast = await blastDoorWithMine(harness, {
      tag: 'BlastDoor', near: HANGAR_SEALED_DOOR, label: 'sealed cargo door', retreat: HANGAR_STORAGE,
    });
    await openLockedContainer(harness, { tag: 'MilLowFootLker', near: HANGAR_SECURE_FOOTLOCKER, label: 'secure cargo footlocker' });
    const after = await inventoryReport(harness, 'after the secure cargo hold');
    if (after.counts.spikes < 1) throw new Error('no Computer Spike after the secure cargo hold');
    return { blast: blast.state, counts: after.counts };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 't3-spikes')) {
    await record('checkpoint: T3-M4 has spikes', () => checkpoint(harness, 't3-spikes'));
    if (report.blocked) return;
  }

  await record('T3-M4: restore Hangar Control and open the fuel depot door', async () => {
    if (resumedPast(args, 't3-fuel-depot')) return { skipped: 'resumed past it' };
    await expectPlayerTag(harness, 't3m4', 'hangar control');
    // hangterm.dlg: "[Repair] Replace the missing parts. [1 Part(s)]"
    // (a_sethangcon), then "Access emergency control commands." ->
    // "[Computer] Check status of emergency sub-systems." -> "[Computer] Open
    // blast door to the fuel depot. [1 Spike(s)]" (a_op106westdr).
    await travelTo(harness, { ...HANGAR_CONTROL, label: 'Hangar Control', range: 2.4, sweepRadius: 16, rounds: 4, via: ROUTE_CARGO_HOLD_TO_CONTROL });
    const chooser = createPriorityChooser([
      /Replace the missing parts/i,
      /^Access emergency control commands/i,
      /Open blast door to the fuel depot/i,
      /Check status of emergency sub-systems/i,
      /^Log out/i,
    ], { label: 'Hangar Control' });
    const result = await useAndConverse(harness, { tag: 'HangarTer', choose: chooser, label: 'Hangar Control' });
    if (!chooser.picks.some((pick) => /Open blast door to the fuel depot/i.test(pick))) {
      throw new Error(`the fuel depot door was never opened from Hangar Control; picked ${JSON.stringify(chooser.picks)}`);
    }
    await sleep(2000);
    const west = (await findObjectByTag(harness, 'TrafficWestDoor'))[0];
    const state = west ? await objectState(harness, west.id) : { located: false };
    line(`  · Fuel Depot Door: ${JSON.stringify(state)}`);
    if (!state.located || state.locked !== false) {
      throw new Error(`the Fuel Depot Door is still locked after Hangar Control: ${JSON.stringify(state)}`);
    }
    // Around the hangar and through the corridor to the turbolift.
    const transit = await transitThroughDoor(harness, {
      tag: 'Door_to_103PER', near: HANGAR_FUEL_DEPOT_DOOR, label: 'turbolift to the fuel depot',
      expectModule: '103per', playerTag: 't3m4', via: ROUTE_STORAGE_TO_FUEL_DEPOT_DOOR,
    });
    return { picks: chooser.picks, transcript: result.played.transcript.slice(-6), door: state, arrived: transit.arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 't3-fuel-depot')) {
    await record('checkpoint: T3-M4 in the fuel depot', () => checkpoint(harness, 't3-fuel-depot'));
    if (report.blocked) return;
  }

  await record('T3-M4: open the administration level hatch from the Fuel Control Station', async () => {
    if (resumedPast(args, 'hatch-opened')) return { skipped: 'resumed past it' };
    await expectPlayerTag(harness, 't3m4', 'fuel control');
    // fuelcon.dlg: "Call up emergency system schematics." -> "Open emergency
    // hatch on Peragus Administration Level." (a_sett3ambush) -> "Log out."
    // Logging out springs the Mark II ambush; the cutscene ends with T3
    // dumped in the fuel line and control back with the Exile in 101PER.
    await travelTo(harness, { ...FUEL_CONTROL_STATION, label: 'Fuel Control Station', range: 2.4, sweepRadius: 16, rounds: 4 });
    const chooser = createPriorityChooser([
      /Call up emergency system schematics/i,
      /Open emergency hatch on Peragus Administration Level/i,
      /^Log out/i,
    ], { label: 'Fuel Control Station' });
    const result = await useAndConverse(harness, { tag: 'ComputerPanel', near: FUEL_CONTROL_STATION, choose: chooser, label: 'Fuel Control Station' });
    if (!chooser.picks.some((pick) => /Open emergency hatch/i.test(pick))) {
      throw new Error(`the hatch was never opened; picked ${JSON.stringify(chooser.picks)}`);
    }
    const ambush = await readGlobalNumber(harness, '103PER_T3_Ambush');
    line(`  · 103PER_T3_Ambush=${JSON.stringify(ambush.value)}`);
    // The ambush conversations and the hand-back to the Exile.
    for (let turn = 0; turn < 6; turn += 1) {
      if (!(await waitForConversation(harness, 8000))) break;
      const played = await playConversation(harness, { label: `ambush ${turn + 1}` }).catch((error) => ({ error: String(error.message) }));
      line(`  · ambush conversation ${turn + 1}: ${JSON.stringify(played.transcript ? played.transcript.slice(-4) : played)}`);
    }
    await waitForModule(harness, '101per', TIMEOUTS.moduleLoad);
    await harness.waitFor(`(() => {
      const player = window.KotOR.PartyManager.party[0];
      return !!(player && player.isPlayer && !/^t3m4$/i.test(String(player.tag || '')));
    })()`, 60_000, 500);
    await sleep(1500);
    const back = await playerSnapshot(harness);
    line(`  · back in ${back.module} as ${back.name} at ${JSON.stringify(back.position)}`);
    const atton = await openHatchWithAtton(harness);
    await returnToGameplay(harness);
    return { picks: chooser.picks, transcript: result.played.transcript.slice(-6), ambush: ambush.value, back, atton: atton.picks };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'hatch-opened')) {
    await record('checkpoint: the emergency hatch is open', () => checkpoint(harness, 'hatch-opened'));
  }
}

// ---------------------------------------------------------------------------
// Stage C: the hatch, the mining tunnels and the fuel depot, as the Exile
// ---------------------------------------------------------------------------

const ADMIN_HATCH_DOOR = { x: 32.8, y: -42.4, z: Z };             // 102PERDoor
const ADMIN_TUNNEL_TRIGGER = { x: 36.2, y: -23.9, z: Z };         // transition to 102PER
const ROUTE_CONSOLE_TO_HATCH = [
  ADMIN_BLISTER_ENTRY, ADMIN_MAIN_BODY_WEST, ADMIN_STORAGE_DOORS, ADMIN_STORAGE_ROOM, ADMIN_STORAGE_TO_SECURITY,
  ADMIN_SECURITY_ROOM, ADMIN_SECURITY_TO_HATCH, ADMIN_HATCH_ROOM,
];

// 102PER, from its layout rooms (102PERa..dd) and door hooks: the turbolift
// room in the south-east, the first junction, the tunnel south-west to the
// cavern, the superheated blast tunnel, the second junction, the tunnel to
// the central core, then the High Security Door and the corridors north to
// the fuel depot turbolift.
const T = 3.4;
const TUNNEL_ARRIVAL = { x: 34.7, y: -70.7, z: T };
const TUNNEL_CONTROLLER = { x: -13.1, y: 26.9, z: 3.5 };          // Shftcom
const TUNNEL_SECURITY_DOOR = { x: 30.8, y: 21.9, z: T };           // SecDoor
const TUNNEL_EXIT_DOOR = { x: 37.2, y: 105.3, z: T };              // Door_To_103PER
// Planned over the live walkmesh (tools/vr-emulator/probe-walkmesh-map.js +
// walkmesh-route.js from the mining-tunnels checkpoint, containment fields
// blocked at 9 m): the LYT room origins used before were almost all off the
// mesh, and the short loop past Blast Containment Field 4 is sealed by that
// field on both branches (the field spans the whole cavern). Arrival -> the
// three ordinary doors north-west -> south-west into the big western
// caverns -> north along the west wall -> east into the core from the
// south-west.
const ROUTE_TUNNELS_TO_CORE = [
  { x: 33, y: -65, z: T }, { x: 32, y: -64, z: T }, { x: 29, y: -61, z: T }, { x: 28, y: -60, z: T },
  { x: 25, y: -57, z: T }, { x: 25, y: -56, z: T }, { x: 22, y: -53, z: T }, { x: 21, y: -52, z: T },
  { x: 18, y: -49, z: T }, { x: 15, y: -46, z: T }, { x: 14, y: -45, z: T }, { x: 11, y: -42, z: T },
  { x: 10, y: -41, z: T }, { x: 6, y: -41, z: T }, { x: 5, y: -41, z: T }, { x: 1, y: -40, z: T },
  { x: 0, y: -40, z: T }, { x: -4, y: -41, z: T }, { x: -5, y: -42, z: T }, { x: -8, y: -45, z: T },
  { x: -9, y: -46, z: T }, { x: -12, y: -49, z: T }, { x: -13, y: -50, z: T }, { x: -15, y: -54, z: T },
  { x: -16, y: -55, z: T }, { x: -16, y: -59, z: T }, { x: -16, y: -60, z: T }, { x: -19, y: -64, z: T },
  { x: -23, y: -67, z: T }, { x: -27, y: -68, z: T }, { x: -28, y: -69, z: T }, { x: -32, y: -69, z: T },
  { x: -33, y: -69, z: T }, { x: -37, y: -69, z: T }, { x: -38, y: -70, z: T }, { x: -41, y: -73, z: T },
  { x: -42, y: -74, z: T }, { x: -46, y: -74, z: T }, { x: -47, y: -74, z: T }, { x: -51, y: -74, z: T },
  { x: -52, y: -74, z: T }, { x: -56, y: -74, z: T }, { x: -57, y: -74, z: T }, { x: -61, y: -74, z: T },
  { x: -62, y: -74, z: T }, { x: -66, y: -74, z: T }, { x: -67, y: -74, z: T }, { x: -71, y: -71, z: T },
  { x: -73, y: -67, z: T }, { x: -73, y: -66, z: T }, { x: -73, y: -62, z: T }, { x: -73, y: -61, z: T },
  { x: -74, y: -57, z: T }, { x: -75, y: -53, z: T }, { x: -76, y: -51, z: T }, { x: -79, y: -48, z: T },
  { x: -83, y: -45, z: T }, { x: -83, y: -41, z: T }, { x: -82, y: -37, z: T }, { x: -81, y: -33, z: T },
  { x: -80, y: -31, z: T }, { x: -77, y: -28, z: T }, { x: -77, y: -27, z: T }, { x: -75, y: -23, z: T },
  { x: -75, y: -22, z: T }, { x: -75, y: -18, z: T }, { x: -75, y: -17, z: T }, { x: -72, y: -14, z: T },
  { x: -71, y: -13, z: T }, { x: -68, y: -10, z: T }, { x: -67, y: -9, z: T }, { x: -64, y: -6, z: T },
  { x: -63, y: -5, z: T }, { x: -60, y: -1, z: T }, { x: -59, y: 0, z: T }, { x: -56, y: 3, z: T },
  { x: -55, y: 4, z: T }, { x: -53, y: 6, z: T }, { x: -49, y: 9, z: T }, { x: -45, y: 11, z: T },
  { x: -44, y: 11, z: T }, { x: -40, y: 11, z: T }, { x: -39, y: 11, z: T }, { x: -35, y: 11, z: T },
  { x: -34, y: 11, z: T }, { x: -30, y: 14, z: T }, { x: -27, y: 17, z: T }, { x: -26, y: 18, z: T },
  { x: -24, y: 20, z: T }, { x: -21, y: 23, z: T }, { x: -20, y: 24, z: T }, { x: -16, y: 26, z: T },
  { x: -15, y: 27, z: T },
];
// Core -> north-east past Blast Containment Field 1 (open after the
// controller) -> the long tunnel north to the fuel depot turbolift.
// (evidence/peragus/plan-102per-exit.txt)
const ROUTE_CORE_TO_EXIT = [
  { x: -13, y: 31, z: T }, { x: -10, y: 34, z: T }, { x: -7, y: 37, z: T }, { x: -4, y: 40, z: T },
  { x: 0, y: 40, z: T }, { x: 4, y: 40, z: T }, { x: 8, y: 40, z: T }, { x: 12, y: 39, z: T },
  { x: 16, y: 39, z: T }, { x: 20, y: 41, z: T }, { x: 22, y: 45, z: T }, { x: 23, y: 49, z: T },
  { x: 23, y: 53, z: T }, { x: 23, y: 57, z: T }, { x: 20, y: 60, z: T }, { x: 17, y: 63, z: T },
  { x: 15, y: 67, z: T }, { x: 15, y: 71, z: T }, { x: 15, y: 75, z: T }, { x: 15, y: 79, z: T },
  { x: 18, y: 82, z: T }, { x: 21, y: 85, z: T }, { x: 24, y: 88, z: T }, { x: 27, y: 91, z: T },
  { x: 31, y: 91, z: T }, { x: 35, y: 94, z: T }, { x: 36, y: 98, z: T }, { x: 36, y: 102, z: T },
];

// 103PER's upper level (z 22.4), the north-west corner where the tunnel
// turbolift arrives, and the airlock in the south.
const F = 22.4;
const DEPOT_ARRIVAL = { x: -99.1, y: -15.4, z: F };
const DEPOT_SENSOR_CYLINDER = { x: -74.3, y: -18.9, z: F };        // MilHighPlstcCylin
const DEPOT_MAINTENANCE_STATION = { x: -59.1, y: -53.1, z: F };    // DroCon
const DEPOT_SECURITY_DOOR = { x: -39.0, y: -48.8, z: F };          // SecurityDoor104PER
const DEPOT_SUIT_LOCKER = { x: -26.1, y: -64.2, z: F };            // SpaceSuitLocker
const DEPOT_AIRLOCK_INNER = { x: -33.1, y: -58.1, z: F };
const DEPOT_AIRLOCK_OUTER = { x: -28.0, y: -66.2, z: F };
// Planned over the live walkmesh (evidence/peragus/plan-103per-*.txt).
const ROUTE_DEPOT_TO_MAINTENANCE = [
  { x: -89, y: -10, z: F }, { x: -86, y: -7, z: F }, { x: -83, y: -4, z: F }, { x: -80, y: -1, z: F },
  { x: -76, y: -1, z: F }, { x: -72, y: 0, z: F }, { x: -71, y: 0, z: F }, { x: -70, y: 0, z: F },
  { x: -67, y: -4, z: F }, { x: -64, y: -8, z: F }, { x: -61, y: -11, z: F }, { x: -58, y: -14, z: F },
  { x: -56, y: -18, z: F }, { x: -53, y: -22, z: F }, { x: -52, y: -26, z: F }, { x: -51, y: -30, z: F },
  { x: -52, y: -34, z: F }, { x: -55, y: -37, z: F }, { x: -56, y: -41, z: F }, { x: -57, y: -45, z: F },
  { x: -57, y: -49, z: F }, { x: -57, y: -51, z: F },
];
const ROUTE_MAINTENANCE_TO_AIRLOCK = [
  { x: -59, y: -49, z: F }, { x: -59, y: -45, z: F }, { x: -58, y: -41, z: F }, { x: -55, y: -37, z: F },
  { x: -51, y: -37, z: F }, { x: -47, y: -39, z: F }, { x: -45, y: -43, z: F }, { x: -42, y: -46, z: F },
  { x: -36, y: -53, z: F }, { x: -34, y: -57, z: F }, { x: -33, y: -58, z: F }, { x: -30, y: -61, z: F },
];

/** Waits out a movie (the Harbinger's arrival, the hangar pan) before going on. */
async function waitForMovieToEnd(harness, timeoutMs = 120_000) {
  const playing = await harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    return !!(gs.VideoManager && gs.VideoManager.isMoviePlaying && gs.VideoManager.isMoviePlaying()) || gs.Mode === 5;
  })()`);
  if (!playing) return false;
  line('  · a movie is playing; waiting for it to end');
  await harness.waitFor(`(() => {
    const gs = window.KotOR.GameState;
    const playing = !!(gs.VideoManager && gs.VideoManager.isMoviePlaying && gs.VideoManager.isMoviePlaying());
    return !playing && gs.Mode !== 5;
  })()`, timeoutMs, 1000);
  await sleep(1500);
  await returnToGameplay(harness);
  return true;
}

async function playAnyPendingConversation(harness, { choose, label }) {
  await waitForMovieToEnd(harness).catch(() => undefined);
  if (!(await waitForConversation(harness, 3000))) return null;
  const played = await playConversation(harness, { choose, label });
  line(`  · ${label}: ${played.turns} turns; picked ${JSON.stringify(choose && choose.picks || [])}`);
  for (const entry of played.transcript.slice(-5)) line(`      ${String(entry).slice(0, 150)}`);
  await clearBlockingModal(harness);
  await returnToGameplay(harness);
  return played;
}

/**
 * After the fuel-line ambush hands control back to the Exile in 101PER,
 * a_hatchopen starts 101atton on Atton (E80 -> a_door102per -> a_sethatch),
 * which opens the emergency hatch and hands over the comlink. It must be
 * played before any checkpoint: a save taken while it is pending consumes
 * its one-shot starter and Atton only ever says "Found anything?" after.
 */
async function openHatchWithAtton(harness) {
  const atton = createPriorityChooser([
    /Give him a little more time/i, /^It's not my droid/i, /don't really want to talk about it/i,
    /turbolifts are locked down manually/i, /only way out, and it's better I risk my life/i,
    /You're right, I'll take the risk/i, /^Got it\. See you soon/i, /received a comlink/i,
  ], { label: 'Atton (hatch)', unseenFallback: true });
  // What the engine did with the hand-back conversation, from the console
  // the harness has been capturing since boot.
  const recent = harness.consoleMessages.slice(-1500)
    .map((m) => `${m.level}: ${m.text}`)
    .filter((l) => /Conversation|conversation|showEntry|preload|superseded|could not show|101atton|Atton|Switched to Player|LoadModule|StartNewModule|Loading Player|SaveCurrentGame|saving |Unhandled|TypeError|ReferenceError/i.test(l) &&
      !/rolling sound|PerfSampler|prompt candidacy|VR rooms|dialog rooms|VR targetUI|VR prompt/.test(l))
    .slice(-40);
  line(`  · console since the hand-back (${recent.length} lines):`);
  for (const entry of recent) line(`      ${entry.slice(0, 230)}`);
  const pending = await harness.evaluate(`(() => {
    const gs = window.KotOR.GameState; const cm = gs.CutsceneManager;
    return { mode: gs.Mode, active: cm.active, dialog: cm.dialog ? String(cm.dialog.resref) : null, state: cm.state,
      entry: cm.currentEntry ? String(cm.currentEntry.text || '').slice(0, 80) : null,
      startingEntry: cm.startingEntry ? String(cm.startingEntry.text || '').slice(0, 80) : null,
      owner: cm.owner ? String(cm.owner.tag || cm.owner.constructor.name) : null,
      listener: cm.listener ? String(cm.listener.tag || cm.listener.constructor.name) : null,
      menus: (gs.MenuManager.activeMenus || []).map((m) => m.constructor.name + (m.bVisible ? '' : '(hidden)')) };
  })()`);
  line(`  · conversation state on return: ${JSON.stringify(pending)}`);
  await playAnyPendingConversation(harness, { choose: atton, label: 'Atton (hatch)' });
  // a_hatchopen starts 101atton on Atton half a second after the module is
  // entered, sometimes before Atton has spawned, so the conversation that
  // opens the hatch (E80 -> a_door102per -> a_sethatch) can simply not
  // happen. Its starter is unconditional on the player talking to him, so
  // talk to him until 101PER_Open_Hatch says the hatch is open.
  const exile = await playerSnapshot(harness);
  line(`  · back as ${exile.name}: level ${exile.lvl ?? '?'} hp ${exile.hp}`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await readGlobalNumber(harness, '101PER_Open_Hatch');
    if (opened.value === 1) break;
    const who = (await findObjectByTag(harness, 'Atton').catch(() => []))[0];
    if (!who) throw new Error('Atton is not on the administration level to open the hatch');
    line(`  · 101PER_Open_Hatch=${JSON.stringify(opened.value)}; talking to Atton (attempt ${attempt + 1})`);
    await travelTo(harness, { ...who.position, label: 'Atton', range: 2.6, sweepRadius: 12, rounds: 2 });
    await useTaggedWorldObject(harness, { tag: 'Atton', targetId: who.id, actionPattern: /^(Use|Talk)/i, range: 2.6, maxAttempts: 3 });
    if (await waitForConversation(harness, 8000)) {
      const played = await playConversation(harness, { choose: atton, label: 'Atton (hatch)' });
      line(`  · Atton (hatch): ${played.turns} turns; picked ${JSON.stringify(atton.picks)}`);
      for (const entry of played.transcript.slice(-5)) line(`      ${String(entry).slice(0, 150)}`);
      await clearBlockingModal(harness);
      await returnToGameplay(harness);
    }
  }
  const opened = await readGlobalNumber(harness, '101PER_Open_Hatch');
  if (opened.value !== 1) throw new Error(`101PER_Open_Hatch=${JSON.stringify(opened.value)} after talking to Atton; picked ${JSON.stringify(atton.picks)}`);
  return atton;
}

async function stageMiningTunnels(ctx) {
  const { harness, args, record, report, resumedPast } = ctx;

  await record('take the emergency hatch down to the mining tunnels', async () => {
    if (resumedPast(args, 'mining-tunnels')) return { skipped: 'resumed past it' };
    // Back with Atton at the console (101atton E80/E95): the hatch beeps open
    // and he hands over a comlink. Then west through the level to the hatch
    // room; the hatch (a_door102per) is unlocked and the transition is the
    // trigger by the turbolift beyond it.
    const atton = await openHatchWithAtton(harness);
    await travelTo(harness, { ...ADMIN_HATCH_DOOR, label: 'emergency hatch', range: 2.6, sweepRadius: 16, via: ROUTE_CONSOLE_TO_HATCH });
    const hatch = await findTaggedNear(harness, '102PERDoor', ADMIN_HATCH_DOOR);
    let hatchState = await objectState(harness, hatch.id);
    line(`  · emergency hatch: ${JSON.stringify(hatchState)}`);
    if (hatchState.open === false) {
      const offered = await promptFor(harness, hatch, { label: 'emergency hatch', range: 2.4 });
      const action = offered.actions.find((a) => /^(Use|Open)/i.test(a));
      if (!action) throw new Error(`the emergency hatch offers no Use: ${JSON.stringify(offered.actions)} (locked=${hatchState.locked})`);
      await activateWorldAction(harness, { objectId: hatch.promptId, actionLabel: action });
      await sleep(2500);
      await clearBlockingModal(harness);
      await playAnyPendingConversation(harness, { choose: atton, label: 'hatch conversation' });
      hatchState = await objectState(harness, hatch.id);
      if (!hatchState.open) throw new Error(`the emergency hatch did not open: ${JSON.stringify(hatchState)}`);
    }
    await walkIntoTransition(harness, { module: '102per', near: ADMIN_TUNNEL_TRIGGER, label: 'turbolift to the mining tunnels', rounds: 2 });
    await sleep(1500);
    await returnToGameplay(harness);
    const arrived = await playerSnapshot(harness);
    line(`  · now in ${arrived.module} at ${JSON.stringify(arrived.position)}`);
    return { atton: atton.picks, hatch: hatchState, arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'mining-tunnels')) {
    await record('checkpoint: mining tunnels', () => checkpoint(harness, 'mining-tunnels'));
    if (report.blocked) return;
  }

  await record('cross the mining tunnels and shut down the containment fields', async () => {
    if (resumedPast(args, 'containment-fields-down')) return { skipped: 'resumed past it' };
    // Atton talks over the comlink at several triggers on the way; each is an
    // interruption the walk clears. shfcon.dlg: "Access fuel containment
    // functions." -> "Shut down containment fields." (a_shutdownff opens
    // FFDoor1-4) -> "Log out."
    const comlink = createPriorityChooser([/Understood\.|^I'll do that/i], { label: 'Atton (comlink)', unseenFallback: true });
    await playAnyPendingConversation(harness, { choose: comlink, label: 'Atton (comlink)' });
    if (!resumedPast(args, 'tunnel-core')) {
      await travelTo(harness, { ...TUNNEL_CONTROLLER, label: 'Central Controller', range: 2.4, sweepRadius: 16, rounds: 5, via: ROUTE_TUNNELS_TO_CORE });
      // The 236 m crossing is the slow part; keep it behind its own checkpoint.
      await checkpoint(harness, 'tunnel-core');
    } else {
      await travelTo(harness, { ...TUNNEL_CONTROLLER, label: 'Central Controller', range: 2.4, sweepRadius: 8, rounds: 3 });
    }
    const chooser = createScriptedChooser([
      /^Access fuel containment functions/i,
      /^Shut down containment fields/i,
      /^Log out/i,
    ], { label: 'Central Controller' });
    const result = await useAndConverse(harness, { tag: 'Shftcom', choose: chooser, label: 'Central Controller' });
    if (!chooser.picks.some((pick) => /Shut down containment fields/i.test(pick))) {
      throw new Error(`the containment fields were never shut down; picked ${JSON.stringify(chooser.picks)}`);
    }
    await sleep(5000);
    const fields = [];
    for (const tag of ['FFDoor1', 'FFDoor2', 'FFDoor3', 'FFDoor4']) {
      const door = (await findObjectByTag(harness, tag).catch(() => []))[0];
      fields.push({ tag, state: door ? await objectState(harness, door.id) : null });
    }
    line(`  · containment fields: ${JSON.stringify(fields)}`);
    if (!fields.some((f) => f.state && f.state.open)) {
      throw new Error(`no containment field opened after the controller: ${JSON.stringify(fields)}`);
    }
    return { picks: chooser.picks, transcript: result.played.transcript.slice(-6), fields };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'containment-fields-down')) {
    await record('checkpoint: containment fields down', () => checkpoint(harness, 'containment-fields-down'));
    if (report.blocked) return;
  }

  await record('take the turbolift from the mining tunnels to the fuel depot', async () => {
    if (resumedPast(args, 'fuel-depot-arrival')) return { skipped: 'resumed past it' };
    // Out through the High Security Door (Security, or the Security Tunneler
    // from the administration level's security room), then the corridors
    // north to the turbolift. Atton warns over the comlink as the tunnels
    // are entered and seals the administration turbolift behind us.
    const comlink = createPriorityChooser([/Understood\.|^I'll do that|^Got it/i], { label: 'Atton (comlink)', unseenFallback: true });
    await playAnyPendingConversation(harness, { choose: comlink, label: 'Atton (comlink)' });
    const transit = await transitThroughDoor(harness, {
      tag: 'Door_To_103PER', near: TUNNEL_EXIT_DOOR, label: 'turbolift to the fuel depot', expectModule: '103per',
      via: ROUTE_CORE_TO_EXIT,
    });
    return { arrived: transit.arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'fuel-depot-arrival')) {
    await record('checkpoint: fuel depot arrival', () => checkpoint(harness, 'fuel-depot-arrival'));
    if (report.blocked) return;
  }

  await record('meet HK-50, then open the way to the airlock', async () => {
    if (resumedPast(args, 'airlock-open')) return { skipped: 'resumed past it' };
    // Arrival plays hk50.dlg (k_102exit): HK-50 introduces itself over the
    // maintenance officer's corpse. Leave the conversation at the first exit.
    // The airlock's security door is voiceprinted; the maintenance station
    // offers "[Destroy the console.]" (k_desairlock -> airlock.dlg ->
    // a_door104per), the direct route the walkthrough also names.
    const hk50 = createPriorityChooser([
      /heard enough\. I'll be going now/i, /^Never mind\. I'll be going now/i, /^Never mind, then/i,
      /^How do you know me/i, /^What are you\?/i, /^I had some other questions/i,
    ], { label: 'HK-50', unseenFallback: true });
    await playAnyPendingConversation(harness, { choose: hk50, label: 'HK-50' });
    await travelTo(harness, { ...DEPOT_SENSOR_CYLINDER, label: 'sonic sensor cylinder', range: 2.2, sweepRadius: 14, rounds: 3 });
    await lootTagged(harness, { tag: 'MilHighPlstcCylin', near: DEPOT_SENSOR_CYLINDER, label: 'sonic sensor cylinder' }).catch((error) =>
      line(`  · sonic sensor cylinder: ${String(error.message).slice(0, 120)}`));
    await travelTo(harness, { ...DEPOT_MAINTENANCE_STATION, label: 'Maintenance Station', range: 2.4, sweepRadius: 16, rounds: 5, via: ROUTE_DEPOT_TO_MAINTENANCE });
    const chooser = createScriptedChooser([
      /\[Destroy the console\.\]/i,
    ], { label: 'Maintenance Station' });
    const result = await useAndConverse(harness, { tag: 'DroCon', choose: chooser, label: 'Maintenance Station' });
    if (!chooser.picks.some((pick) => /Destroy the console/i.test(pick))) {
      throw new Error(`the console could not be destroyed; picked ${JSON.stringify(chooser.picks)}`);
    }
    // k_desairlock: the PC attacks the invisible MainInv, the console explodes
    // 2s later and AirlockInv plays airlock.dlg, whose a_door104per unlocks
    // the security door.
    for (let turn = 0; turn < 4; turn += 1) {
      if (!(await playAnyPendingConversation(harness, { label: `airlock ${turn + 1}` }))) await sleep(2000);
    }
    const door = await findTaggedNear(harness, 'SecurityDoor104PER', DEPOT_SECURITY_DOOR);
    const state = await objectState(harness, door.id);
    line(`  · security door to the airlock: ${JSON.stringify(state)}`);
    if (state.locked !== false) throw new Error(`the security door to the airlock stayed locked: ${JSON.stringify(state)}`);
    return { hk50: hk50.picks, picks: chooser.picks, transcript: result.played.transcript.slice(-6), door: state };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'airlock-open')) {
    await record('checkpoint: airlock open', () => checkpoint(harness, 'airlock-open'));
    if (report.blocked) return;
  }

  await record('suit up and cross the airlock to the asteroid exterior', async () => {
    if (resumedPast(args, 'asteroid-exterior')) return { skipped: 'resumed past it' };
    // The outer door's OnFailToOpen (a_airlockout) refuses without the
    // "spacesuit" item from the Storage Locker and closes the inner door
    // behind it; the outer door links to 104PER.
    await travelTo(harness, { ...DEPOT_SUIT_LOCKER, label: 'space suit locker', range: 2.2, sweepRadius: 14, rounds: 4, via: ROUTE_MAINTENANCE_TO_AIRLOCK });
    await lootTagged(harness, { tag: 'SpaceSuitLocker', near: DEPOT_SUIT_LOCKER, label: 'space suit locker' });
    const inventory = await inventoryReport(harness, 'before the airlock');
    if (!inventoryQuantity(inventory.inventory, /space ?suit/i)) throw new Error('no Space Suit after the locker');
    const transit = await transitThroughDoor(harness, {
      tag: 'AirlockOuterDoor_103PER', near: DEPOT_AIRLOCK_OUTER, label: 'airlock outer door', expectModule: '104per',
    });
    return { arrived: transit.arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'asteroid-exterior')) {
    await record('checkpoint: asteroid exterior', () => checkpoint(harness, 'asteroid-exterior'));
  }
}

// ---------------------------------------------------------------------------
// Stage D: the asteroid exterior, the dormitories, and back to the Harbinger
// ---------------------------------------------------------------------------

// 104PER: the scaffolding from the fuel depot airlock (east) past the comm
// blister window (south) to the dormitory airlock (west). Room origins from
// the layout; the Harbinger's arrival plays at the window.
const X = 256.6;
// Planned on the walkmesh face graph (tools/vr-emulator/walkmesh-plan.js,
// evidence/peragus/plan-104per-faces.txt): the exterior is a switchback with
// ramps at both ends; a 2D raster cut across its ledges.
const EXTERIOR_TO_DORMS = [
  { x: 72.5, y: -123.8, z: 256.5 }, { x: 69.4, y: -123.9, z: 256.5 }, { x: 65.0, y: -124.8, z: 256.5 }, { x: 61.4, y: -126.3, z: 256.5 },
  { x: 56.3, y: -128.3, z: 256.6 }, { x: 53.6, y: -131.4, z: 256.6 }, { x: 51.6, y: -135.0, z: 256.6 }, { x: 50.2, y: -138.9, z: 256.7 },
  { x: 49.7, y: -142.8, z: 256.7 }, { x: 50.2, y: -147.1, z: 256.7 }, { x: 48.3, y: -150.5, z: 257.0 }, { x: 46.2, y: -153.2, z: 257.5 },
  { x: 43.3, y: -154.0, z: 258.1 }, { x: 40.9, y: -156.1, z: 259.0 }, { x: 38.3, y: -160.1, z: 260.3 }, { x: 35.4, y: -162.6, z: 261.2 },
  { x: 31.9, y: -165.7, z: 262.4 }, { x: 28.9, y: -166.7, z: 262.4 }, { x: 26.7, y: -164.5, z: 262.4 }, { x: 27.7, y: -161.5, z: 262.4 },
  { x: 32.3, y: -158.8, z: 263.7 }, { x: 35.1, y: -154.1, z: 264.9 }, { x: 39.8, y: -151.3, z: 266.2 }, { x: 41.0, y: -148.4, z: 266.2 },
  { x: 39.0, y: -146.1, z: 266.2 }, { x: 31.9, y: -150.4, z: 266.2 }, { x: 28.6, y: -155.0, z: 266.2 }, { x: 23.2, y: -158.0, z: 266.2 },
  { x: 20.9, y: -159.5, z: 266.2 }, { x: 18.2, y: -162.5, z: 266.2 }, { x: 11.8, y: -163.8, z: 266.2 }, { x: 6.7, y: -163.3, z: 266.2 },
  { x: 1.4, y: -164.1, z: 266.2 }, { x: -1.4, y: -164.1, z: 266.2 }, { x: -6.7, y: -163.3, z: 266.2 }, { x: -11.8, y: -163.8, z: 266.2 },
  { x: -16.9, y: -161.5, z: 266.2 }, { x: -20.4, y: -161.5, z: 266.2 }, { x: -23.4, y: -159.5, z: 266.2 }, { x: -28.6, y: -155.0, z: 266.2 },
  { x: -31.9, y: -150.4, z: 266.2 }, { x: -37.0, y: -145.9, z: 266.2 }, { x: -38.9, y: -148.2, z: 266.2 }, { x: -35.1, y: -154.1, z: 264.9 },
  { x: -32.3, y: -158.8, z: 263.7 }, { x: -27.7, y: -161.5, z: 262.4 }, { x: -26.7, y: -164.5, z: 262.4 }, { x: -28.9, y: -166.7, z: 262.4 },
  { x: -31.9, y: -165.7, z: 262.4 }, { x: -35.4, y: -162.6, z: 261.2 }, { x: -38.3, y: -160.1, z: 260.3 }, { x: -40.9, y: -156.1, z: 259.0 },
  { x: -43.3, y: -154.0, z: 258.1 }, { x: -46.2, y: -153.2, z: 257.5 }, { x: -48.0, y: -148.7, z: 256.8 }, { x: -50.6, y: -146.5, z: 256.7 },
  { x: -51.0, y: -142.6, z: 256.7 }, { x: -50.9, y: -138.6, z: 256.8 },
];
const EXTERIOR_DORM_TRIGGER = { x: -52.2, y: -138.9, z: 256.7 };

// 105PER: from the airlock in the west, through the first rooms and the hall
// past the shift console, down the hallway to the cafeteria and the turbolift
// room in the south-west.
const D = 10.0;
const DORM_AIRLOCK_INNER = { x: -55.0, y: 17.7, z: D };
const DORM_TURBO_CONSOLE = { x: -54.5, y: -42.0, z: D };            // TurboConsole
const DORM_TURBOLIFT = { x: -50.4, y: -45.1, z: D };                // Door_To_101PER
// Planned on the walkmesh face graph (evidence/peragus/plan-105per-console.txt).
const ROUTE_DORMS_TO_TURBOLIFT = [
  { x: -52.0, y: 17.1, z: 10.0 }, { x: -48.4, y: 19.0, z: 10.0 }, { x: -44.7, y: 22.3, z: 10.0 }, { x: -43.7, y: 26.2, z: 10.0 },
  { x: -43.9, y: 30.1, z: 10.0 }, { x: -39.9, y: 30.1, z: 10.0 }, { x: -36.0, y: 30.1, z: 10.0 }, { x: -26.5, y: 33.0, z: 10.0 },
  { x: -20.8, y: 33.0, z: 10.0 }, { x: -20.2, y: 28.4, z: 10.0 }, { x: -18.4, y: 33.0, z: 10.0 }, { x: -17.1, y: 28.4, z: 10.0 },
  { x: -15.3, y: 33.0, z: 10.0 }, { x: -14.8, y: 28.4, z: 10.0 }, { x: -10.5, y: 33.0, z: 10.0 }, { x: -6.6, y: 30.1, z: 10.0 },
  { x: -2.1, y: 31.4, z: 10.0 }, { x: 2.8, y: 28.4, z: 10.0 }, { x: 6.9, y: 31.3, z: 10.0 }, { x: 13.8, y: 30.0, z: 10.0 },
  { x: 13.3, y: 24.1, z: 10.0 }, { x: 15.8, y: 20.9, z: 10.0 }, { x: 17.8, y: 18.5, z: 10.0 }, { x: 18.1, y: 12.8, z: 10.0 },
  { x: 18.1, y: 10.5, z: 10.0 }, { x: 15.3, y: 7.5, z: 10.0 }, { x: 20.1, y: 6.4, z: 10.0 }, { x: 16.4, y: 3.0, z: 10.0 },
  { x: 16.9, y: -2.1, z: 10.0 }, { x: 14.1, y: -9.9, z: 10.0 }, { x: 9.5, y: -8.3, z: 10.0 }, { x: 6.1, y: -11.9, z: 10.0 },
  { x: 2.0, y: -8.1, z: 10.0 }, { x: -1.8, y: -11.9, z: 10.0 }, { x: -4.5, y: -8.9, z: 10.0 }, { x: -10.5, y: -8.9, z: 10.0 },
  { x: -12.3, y: -13.5, z: 10.0 }, { x: -15.3, y: -8.9, z: 10.0 }, { x: -17.1, y: -13.5, z: 10.0 }, { x: -17.1, y: -20.2, z: 10.0 },
  { x: -18.5, y: -26.8, z: 10.0 }, { x: -24.5, y: -27.8, z: 10.0 }, { x: -28.9, y: -26.4, z: 10.0 }, { x: -32.7, y: -28.3, z: 10.0 },
  { x: -32.6, y: -33.1, z: 10.0 }, { x: -31.7, y: -37.1, z: 10.0 }, { x: -36.1, y: -37.2, z: 10.0 }, { x: -41.5, y: -37.2, z: 10.0 },
  { x: -44.9, y: -38.3, z: 10.0 }, { x: -50.8, y: -41.4, z: 10.0 },
];

// 101PER again: the dormitory turbolift lands by the medical bay's blast door;
// the blister is across the level, the docking door is up the ramp south-west
// of the main body.
const ADMIN_DORM_ARRIVAL = { x: -38.2, y: -3.6, z: Z };
const ADMIN_DOCKING_DOOR = { x: 42.4, y: -76.5, z: 12.5 };          // 151HARDoor
const ROUTE_DORM_ARRIVAL_TO_BLISTER = [
  { x: -30.1, y: -9.2, z: Z }, ADMIN_AREA2_TO_VIBRO, ADMIN_AREA2, ADMIN_AREA3_TO_AREA2, ADMIN_AREA3, ADMIN_HATCH_TO_AREA3,
  ADMIN_HATCH_ROOM, ADMIN_SECURITY_TO_HATCH, ADMIN_SECURITY_ROOM, ADMIN_STORAGE_TO_SECURITY, ADMIN_STORAGE_ROOM,
  ADMIN_STORAGE_DOORS, ADMIN_MAIN_BODY_WEST, ADMIN_BLISTER_ENTRY,
];
const ROUTE_BLISTER_TO_DOCKING = [ADMIN_BLISTER_ENTRY, { x: 70.1, y: -51.5, z: Z }, { x: 52.0, y: -65.5, z: Z }, { x: 38.1, y: -72.5, z: 12.0 }];

async function stageDormitories(ctx) {
  const { harness, args, record, report, resumedPast } = ctx;

  await record('cross the asteroid exterior to the dormitory airlock', async () => {
    if (resumedPast(args, 'dormitories')) return { skipped: 'resumed past it' };
    // Atton over the comlink below the blister window, then the Harbinger's
    // arrival (a_setsion: 101PER_Sion_Arrives=1, 104atton.dlg with the movie).
    const chooser = createPriorityChooser([/^Got it|^Understood|^I'll do that/i], { label: 'Atton (exterior)', unseenFallback: true });
    await playAnyPendingConversation(harness, { choose: chooser, label: 'Atton (exterior)' });
    await walkIntoTransition(harness, { module: '105per', near: EXTERIOR_DORM_TRIGGER, label: 'dormitory airlock', sweepRadius: 6, via: EXTERIOR_TO_DORMS, viaChooser: chooser });
    await sleep(1500);
    await returnToGameplay(harness);
    const sion = await readGlobalNumber(harness, '101PER_Sion_Arrives');
    const arrived = await playerSnapshot(harness);
    line(`  · now in ${arrived.module} at ${JSON.stringify(arrived.position)}; 101PER_Sion_Arrives=${JSON.stringify(sion.value)}`);
    if (sion.value !== 1) throw new Error(`the Harbinger never arrived on the way across (101PER_Sion_Arrives=${JSON.stringify(sion.value)})`);
    return { picks: chooser.picks, arrived, sion: sion.value };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'dormitories')) {
    await record('checkpoint: dormitories', () => checkpoint(harness, 'dormitories'));
    if (report.blocked) return;
  }

  await record('reach the turbolift console and force the turbolift open', async () => {
    if (resumedPast(args, 'turbolift-unlocked')) return { skipped: 'resumed past it' };
    // The inner airlock door is a script lock (a_airlockin). Then the long way
    // round to the turbolift room. turbocon.dlg's "[Destroy the console to
    // force open the door.]" (a_bash_console) is the authored shortcut past
    // the five-number code; the code itself needs the west dormitory's log
    // terminal, which a later pass can add.
    const comlink = createPriorityChooser([/^Got it|^Understood|^I'll do that/i], { label: 'Atton (dorms)', unseenFallback: true });
    await travelTo(harness, {
      ...DORM_TURBO_CONSOLE, label: 'Turbolift Console', range: 2.4, sweepRadius: 16, rounds: 5,
      via: ROUTE_DORMS_TO_TURBOLIFT, viaChooser: comlink,
    });
    const chooser = createScriptedChooser([/\[Destroy the console to force open the door\.\]/i], { label: 'Turbolift Console' });
    const result = await useAndConverse(harness, { tag: 'TurboConsole', choose: chooser, label: 'Turbolift Console' });
    if (!chooser.picks.some((pick) => /Destroy the console/i.test(pick))) {
      throw new Error(`the turbolift console was not destroyed; picked ${JSON.stringify(chooser.picks)}`);
    }
    // a_bash_console: the PC attacks the invisible console until it breaks and
    // its death script unlocks the turbolift.
    let door = null;
    for (let wait = 0; wait < 20; wait += 1) {
      await sleep(2000);
      await clearBlockingModal(harness);
      await playAnyPendingConversation(harness, { label: 'turbolift console' });
      const found = await findTaggedNear(harness, 'Door_To_101PER', DORM_TURBOLIFT);
      door = found ? await objectState(harness, found.id) : null;
      if (door && door.locked === false) break;
    }
    line(`  · turbolift to the administration level: ${JSON.stringify(door)}`);
    if (!door || door.locked !== false) throw new Error(`the turbolift stayed locked after the console: ${JSON.stringify(door)}`);
    return { picks: chooser.picks, transcript: result.played.transcript.slice(-6), door };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'turbolift-unlocked')) {
    await record('checkpoint: turbolift unlocked', () => checkpoint(harness, 'turbolift-unlocked'));
    if (report.blocked) return;
  }

  await record('take the turbolift up and rejoin Kreia and Atton', async () => {
    if (resumedPast(args, 'admin-return')) return { skipped: 'resumed past it' };
    // 101PER From_105PER: Kreia waits beyond the now-open blast door and
    // joins (101kreia -> a_addkreia); Sith assassins decloak in the third
    // room; hk50.dlg opens at the blister with Atton joining (a_addatton) and
    // the party running into HK-50.
    const kreia = createPriorityChooser([
      /^Then let's go/i, /^All right\. Let's go/i, /^All right, then - let's go/i, /Kreia has joined your party/i,
      /^Forgive me, Kreia/i, /^Very well/i,
    ], { label: 'Kreia', unseenFallback: true });
    const transit = await transitThroughDoor(harness, {
      tag: 'Door_To_101PER', near: DORM_TURBOLIFT, label: 'turbolift to the administration level', expectModule: '101per',
    });
    await playAnyPendingConversation(harness, { choose: kreia, label: 'Kreia' });
    const party = await playerSnapshot(harness);
    line(`  · party size after Kreia: ${party.partySize}`);
    const escape = createPriorityChooser([
      /It'll take too long to explain/i, /Atton has joined your party/i, /^What do you mean\?/i,
      /I don't want to fight you, but I will/i, /Enough of this - you won't take me/i, /prepare to be scrapped/i,
      /Are you the one who killed all the miners/i, /You mean by killing all the miners/i, /So you did kill all the miners/i,
    ], { label: 'Atton and HK-50', unseenFallback: true });
    await travelTo(harness, {
      ...ADMIN_BLISTER_ENTRY, label: 'communications blister', range: 2.6, sweepRadius: 14, rounds: 4,
      via: ROUTE_DORM_ARRIVAL_TO_BLISTER, viaChooser: kreia,
    });
    await playAnyPendingConversation(harness, { choose: escape, label: 'Atton and HK-50' });
    const after = await playerSnapshot(harness);
    line(`  · party size at the blister: ${after.partySize}; picked ${JSON.stringify(escape.picks)}`);
    return { arrived: transit.arrived, kreia: kreia.picks, escape: escape.picks, partySize: after.partySize };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'admin-return')) {
    await record('checkpoint: back on the administration level', () => checkpoint(harness, 'admin-return'));
    if (report.blocked) return;
  }

  await record('defeat HK-50 and reach the Harbinger', async () => {
    if (resumedPast(args, 'hk50-defeated')) return { skipped: 'resumed past it' };
    const escape = createPriorityChooser([
      /I don't want to fight you, but I will/i, /Enough of this - you won't take me/i, /prepare to be scrapped/i,
      /Atton has joined your party/i, /It'll take too long to explain/i, /^What do you mean\?/i,
    ], { label: 'HK-50', unseenFallback: true });
    await playAnyPendingConversation(harness, { choose: escape, label: 'HK-50' });
    // HK-50 and his four floating mines, with Kreia and Atton fighting too.
    const fought = await clearHostiles(harness, { limit: 10, maxDistance: 40 });
    line(`  · fought: ${JSON.stringify(fought.map((o) => `${o.name}:${o.killed ? 'killed' : o.reason}`))}`);
    const hk = (await findObjectByTag(harness, 'HK50').catch(() => []))[0];
    const hkState = hk ? await objectState(harness, hk.id) : { located: false };
    line(`  · HK-50: ${JSON.stringify(hkState)}`);
    if (hkState.located && hkState.dead === false) throw new Error(`HK-50 is still standing: ${JSON.stringify(hkState)}`);
    const transit = await transitThroughDoor(harness, {
      tag: '151HARDoor', near: ADMIN_DOCKING_DOOR, label: 'docking door to the Harbinger', expectModule: '151har',
      via: ROUTE_BLISTER_TO_DOCKING,
    });
    return { escape: escape.picks, fought, hk: hkState, arrived: transit.arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'hk50-defeated')) {
    await record('checkpoint: aboard the Harbinger', () => checkpoint(harness, 'hk50-defeated'));
  }
}

// ---------------------------------------------------------------------------
// Stage E: the Harbinger
// ---------------------------------------------------------------------------

// 151HAR command deck: docking port east, bridge north, crew-quarters door
// south. The jammed HammerHeadDoor2 blocks the direct corridor, so the route
// runs through the two Low Security Doors and the briefing room side.
const H = 0.0;
const HAR_CMD_ARRIVAL = { x: 52.0, y: 120.9, z: H };
const HAR_CMD_CYLINDER = { x: 32.4, y: 137.1, z: H };               // Parts + Spikes
const HAR_NAVICOMPUTER = { x: 34.4, y: 162.9, z: H };               // NavcomI
const HAR_CREW_DOOR = { x: 22.2, y: 46.1, z: H };                   // To_152HAR
const ROUTE_CMD_TO_BRIDGE = [{ x: 39.1, y: 120.7, z: H }, { x: 39.5, y: 135.6, z: H }, { x: 34.1, y: 146.7, z: H }];
const ROUTE_BRIDGE_TO_CREW = [
  { x: 39.5, y: 135.6, z: H }, { x: 39.1, y: 120.7, z: H }, { x: 50.1, y: 115.6, z: H }, { x: 51.6, y: 107.4, z: H },
  { x: 52.9, y: 99.4, z: H }, { x: 39.6, y: 98.5, z: H }, { x: 39.6, y: 81.6, z: H }, { x: 39.6, y: 66.9, z: H },
  { x: 42.2, y: 58.4, z: H }, { x: 24.9, y: 62.3, z: H }, { x: 23.7, y: 54.1, z: H },
];

// 152HAR crew quarters: one long corridor south to the engine deck turbolift.
const HAR_CREW_ARRIVAL = { x: 22.1, y: 47.8, z: H };
const HAR_ENGINE_LIFT = { x: 22.0, y: -47.5, z: H };                // Door_To_153HAR
const ROUTE_CREW_TO_LIFT = [
  { x: 22.2, y: 25.9, z: H }, { x: 21.8, y: 11.2, z: H }, { x: 22.2, y: 5.7, z: H }, { x: 22.2, y: -4.6, z: H },
  { x: 20.3, y: -11.5, z: H }, { x: 26.3, y: -27.3, z: H }, { x: 21.9, y: -41.6, z: H },
];

// 153HAR engine deck (z -13): Sion at the second junction, then the storage
// room's maintenance console opens the maintenance door, the ion engine
// control unseals the engine hatch, and the fuel line leads to 103PER.
const E = -13.0;
const HAR_MAINT_FOOTLOCKER = { x: 59.6, y: 26.4, z: E };            // CivilFootLker: Parts + Spikes
const HAR_STORAGE_FOOTLOCKER = { x: 61.5, y: 3.0, z: E };           // MilLowFootLker
const HAR_MAINT_CONSOLE = { x: 66.1, y: 2.0, z: E };                // MainCon
const HAR_ENGINE_CONSOLE = { x: 88.1, y: 23.7, z: -1.4 };           // EngCom
const HAR_FUEL_LINE_TRIGGER = { x: 108.6, y: 38.9, z: -1.4 };       // TO_103PER
const ROUTE_ENGINE_ARRIVAL_TO_JUNCTION = [{ x: -2.0, y: -2.3, z: E }, { x: 7.7, y: -2.3, z: E }, { x: 12.6, y: -1.9, z: E }, { x: 36.8, y: -2.5, z: E }];
const ROUTE_JUNCTION_TO_MAINT_ROOM = [{ x: 39.9, y: 20.8, z: E }, { x: 46.9, y: 22.1, z: E }, { x: 56.6, y: 23.3, z: E }];
const ROUTE_MAINT_ROOM_TO_STORAGE = [{ x: 46.9, y: 22.1, z: E }, { x: 36.8, y: -2.5, z: E }, { x: 46.6, y: -2.2, z: E }, { x: 51.7, y: -1.9, z: E }, { x: 59.6, y: -0.2, z: E }];
const ROUTE_STORAGE_TO_ENGINE = [
  { x: 51.7, y: -1.9, z: E }, { x: 46.6, y: -2.2, z: E }, { x: 37.1, y: -14.5, z: E }, { x: 40.4, y: -26.5, z: E },
  { x: 46.9, y: -25.9, z: E }, { x: 60.9, y: -28.0, z: E }, { x: 73.9, y: -42.6, z: E }, { x: 79.8, y: -38.2, z: E },
  { x: 79.6, y: -28.7, z: E }, { x: 94.7, y: -21.1, z: -0.4 }, { x: 96.7, y: 10.9, z: E },
];
const ROUTE_ENGINE_TO_HATCH = [{ x: 100.5, y: 36.6, z: -1.4 }, { x: 104.0, y: 36.0, z: -1.4 }];

async function stageHarbinger(ctx) {
  const { harness, args, record, report, resumedPast } = ctx;

  await record('Harbinger command deck: download the orbital drift charts', async () => {
    if (resumedPast(args, 'drift-charts')) return { skipped: 'resumed past it' };
    // 151Kreia at the docking port, then the bridge. navcom.dlg needs a Part
    // or a Spike; the plasteel cylinder by the bridge door carries both.
    const kreia = createPriorityChooser([/^Forgive me, Kreia/i, /Atton's plan was a good one/i, /^Very well/i], { label: 'Kreia (docking)', unseenFallback: true });
    await playAnyPendingConversation(harness, { choose: kreia, label: 'Kreia (docking)' });
    await travelTo(harness, { ...HAR_CMD_CYLINDER, label: 'bridge cylinder', range: 2.2, sweepRadius: 16, rounds: 4, via: ROUTE_CMD_TO_BRIDGE, viaChooser: kreia });
    await lootTagged(harness, { tag: 'MilLowPlstcCylin', near: HAR_CMD_CYLINDER, label: 'bridge cylinder' }).catch((error) =>
      line(`  · bridge cylinder: ${String(error.message).slice(0, 120)}`));
    await travelTo(harness, { ...HAR_NAVICOMPUTER, label: 'Navicomputer', range: 2.4, sweepRadius: 14, rounds: 3 });
    const chooser = createScriptedChooser([
      /Slice the navicomputer|Reroute the navicomputer/i,
      /Download the orbital drift charts/i,
      /^Log out/i,
    ], { label: 'Navicomputer' });
    const result = await useAndConverse(harness, { tag: 'NavcomI', choose: chooser, label: 'Navicomputer' });
    if (!chooser.picks.some((pick) => /Download the orbital drift charts/i.test(pick))) {
      throw new Error(`the drift charts were never downloaded; picked ${JSON.stringify(chooser.picks)}`);
    }
    return { kreia: kreia.picks, picks: chooser.picks, transcript: result.played.transcript.slice(-6) };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'drift-charts')) {
    await record('checkpoint: drift charts', () => checkpoint(harness, 'drift-charts'));
    if (report.blocked) return;
  }

  await record('Harbinger: fight through to the crew quarters', async () => {
    if (resumedPast(args, 'harbinger-crew-quarters')) return { skipped: 'resumed past it' };
    // Sith assassins decloak in fours along the way; Kreia and Atton fight too.
    const transit = await transitThroughDoor(harness, {
      tag: 'To_152HAR', near: HAR_CREW_DOOR, label: 'door to the crew quarters', expectModule: '152har', via: ROUTE_BRIDGE_TO_CREW,
    });
    return { arrived: transit.arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'harbinger-crew-quarters')) {
    await record('checkpoint: crew quarters', () => checkpoint(harness, 'harbinger-crew-quarters'));
    if (report.blocked) return;
  }

  await record('Harbinger: through the crew quarters to the engine deck', async () => {
    if (resumedPast(args, 'harbinger-engine-deck')) return { skipped: 'resumed past it' };
    const kreia = createPriorityChooser([/^It's not important/i, /^These were my quarters/i, /^Hold on/i], { label: 'Kreia (cabin)', unseenFallback: true });
    const transit = await transitThroughDoor(harness, {
      tag: 'Door_To_153HAR', near: HAR_ENGINE_LIFT, label: 'turbolift to the engine deck', expectModule: '153har',
      via: ROUTE_CREW_TO_LIFT,
    });
    return { arrived: transit.arrived, kreia: kreia.picks };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'harbinger-engine-deck')) {
    await record('checkpoint: engine deck', () => checkpoint(harness, 'harbinger-engine-deck'));
    if (report.blocked) return;
  }

  await record('Harbinger engine deck: Sion, the engine hatch, and the fuel line to Peragus', async () => {
    if (resumedPast(args, 'fuel-line')) return { skipped: 'resumed past it' };
    const atton = createPriorityChooser([
      /We'll have to be careful, then/i, /Atton has the special ability/i,
      /only way to get around the sealed door/i, /All right\.\.\. let's go|I'm fine\. Keep going/i, /My hand\.\.\. felt like/i,
    ], { label: 'Atton (engine deck)', unseenFallback: true });
    await playAnyPendingConversation(harness, { choose: atton, label: 'Atton (engine deck)' });
    // The Sion cutscene fires at the second junction and takes Kreia out of
    // the party behind a locked door.
    await travelTo(harness, { x: 36.8, y: -2.5, z: E, label: 'second junction', range: 2.4, sweepRadius: 12, rounds: 3, via: ROUTE_ENGINE_ARRIVAL_TO_JUNCTION, viaChooser: atton });
    await playAnyPendingConversation(harness, { choose: atton, label: 'Sion' });
    const party = await playerSnapshot(harness);
    line(`  · party size after Sion: ${party.partySize}`);
    // Parts and spikes from the maintenance room, then the storage room's
    // console (maincon.dlg) opens the maintenance door to the ion engines.
    await travelTo(harness, { ...HAR_MAINT_FOOTLOCKER, label: 'maintenance room', range: 2.2, sweepRadius: 12, rounds: 3, via: ROUTE_JUNCTION_TO_MAINT_ROOM });
    await openLockedContainer(harness, { tag: 'CivilFootLker', near: HAR_MAINT_FOOTLOCKER, label: 'maintenance footlocker' }).catch((error) =>
      line(`  · maintenance footlocker: ${String(error.message).slice(0, 120)}`));
    await travelTo(harness, { ...HAR_MAINT_CONSOLE, label: 'Engine Maintenance Console', range: 2.4, sweepRadius: 12, rounds: 3, via: ROUTE_MAINT_ROOM_TO_STORAGE });
    const maint = createScriptedChooser([
      /Slice the maintenance control system|Reroute the maintenance control system|Slice the system|Reroute the main console system/i,
      /Open maintenance doors to the ion engines/i,
      /^Log out/i,
    ], { label: 'Engine Maintenance Console' });
    await useAndConverse(harness, { tag: 'MainCon', choose: maint, label: 'Engine Maintenance Console' });
    if (!maint.picks.some((pick) => /Open maintenance doors/i.test(pick))) {
      throw new Error(`the maintenance doors were never opened; picked ${JSON.stringify(maint.picks)}`);
    }
    await travelTo(harness, { ...HAR_ENGINE_CONSOLE, label: 'Main Ion Engine Control', range: 2.4, sweepRadius: 12, rounds: 4, via: ROUTE_STORAGE_TO_ENGINE });
    const engine = createScriptedChooser([/Activate Engine Maintenance Procedure/i, /^Log out/i], { label: 'Main Ion Engine Control' });
    await useAndConverse(harness, { tag: 'EngCom', choose: engine, label: 'Main Ion Engine Control' });
    if (!engine.picks.some((pick) => /Activate Engine Maintenance Procedure/i.test(pick))) {
      throw new Error(`the engine hatch was never unsealed; picked ${JSON.stringify(engine.picks)}`);
    }
    await walkIntoTransition(harness, { module: '103per', near: HAR_FUEL_LINE_TRIGGER, label: 'fuel line to Peragus', via: ROUTE_ENGINE_TO_HATCH, viaChooser: atton });
    await playAnyPendingConversation(harness, { choose: atton, label: 'Atton (fuel line)' });
    await waitForModule(harness, '103per', TIMEOUTS.moduleLoad);
    await sleep(1500);
    await returnToGameplay(harness);
    const arrived = await playerSnapshot(harness);
    line(`  · now in ${arrived.module} at ${JSON.stringify(arrived.position)}`);
    return { atton: atton.picks, maint: maint.picks, engine: engine.picks, partySize: party.partySize, arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'fuel-line')) {
    await record('checkpoint: in the fuel line', () => checkpoint(harness, 'fuel-line'));
  }
}

// ---------------------------------------------------------------------------
// Stage F: T3, the hangar, the Ebon Hawk
// ---------------------------------------------------------------------------

// 103PER's lower level (z ~12): T3 in the first fuel line, the concealed stash
// with the hangar conduit, three mined fuel lines, the emergency field station
// at the top of the ramp, then the upper walkway to the hangar turbolift.
const L = 12.2;
const LINE_T3 = { x: -45.4, y: -5.9, z: L };
// 103pipeenter (newgeneric011): k_103enter has Atton start 103atton.dlg over
// T3 when the party leader enters this polygon; that conversation is the one
// with a_addt3m4sp, which puts T3 back in the party. Talking to T3 directly
// only plays his companion chatter (t3m4.dlg), so the walker must cross it.
const LINE_PIPE_ENTER = { x: -41.8, y: -11.05, z: L };
const LINE_STASH = { x: -49.5, y: -0.7, z: L };                    // OddCase
const LINE_MINES = [{ x: -50.9, y: 1.9, z: L }, { x: -14.0, y: 9.4, z: L }, { x: 5.6, y: 34.4, z: L }];
const LINE_FIELD_STATION = { x: -1.7, y: 44.7, z: L };             // EmerStation
const LINE_FIELD_DOOR = { x: -27.4, y: 22.0, z: F };               // FieldFuel
const DEPOT_HANGAR_TRIGGER = { x: -7.9, y: 60.0, z: F };
// Stage F legs planned on the 103PER face graph (walkmesh-plan.js over
// evidence/peragus/walkmesh-103per.faces.json, both decks): the fuel line is
// the lower deck (z ~12), the Emergency Field Station sits on a mezzanine
// (z 16.4) and the exit ramp climbs to the fuel depot deck (z 22.4), where
// the FieldFuel door and the To_106PER turbolift trigger are.
const ROUTE_LINE_MINE_LEGS = [[{ x: -50.3, y: 1.8, z: 12.3 }, { x: -50.9, y: 1.9, z: 12.2 }], [{ x: -46.3, y: 3.2, z: 11.9 }, { x: -42.6, y: 2.9, z: 11.9 }, { x: -40.5, y: -3.4, z: 11.9 }, { x: -35.4, y: -5.8, z: 11.9 }, { x: -32.8, y: -13.1, z: 11.9 }, { x: -28.6, y: -13.5, z: 11.9 }, { x: -24.4, y: -6.3, z: 11.9 }, { x: -19.9, y: -3.9, z: 11.9 }, { x: -17.3, y: 2.4, z: 11.9 }, { x: -14.1, y: 8.0, z: 12.2 }, { x: -14, y: 9.4, z: 12.2 }], [{ x: -10.4, y: 13.8, z: 11.9 }, { x: -12.0, y: 19.2, z: 11.9 }, { x: -8.0, y: 24.5, z: 11.9 }, { x: -4.7, y: 29.6, z: 11.9 }, { x: 0.2, y: 31.6, z: 11.9 }, { x: 4.9, y: 34.2, z: 12.2 }, { x: 5.6, y: 34.4, z: 12.2 }]];
const ROUTE_MINE3_TO_STATION = [{ x: 1.6, y: 31.1, z: 11.9 }, { x: -4.7, y: 29.6, z: 11.9 }, { x: -7.5, y: 26.7, z: 11.9 }, { x: -11.2, y: 22.3, z: 11.9 }, { x: -13.9, y: 16.6, z: 11.9 }, { x: -17.6, y: 19.2, z: 11.9 }, { x: -14.3, y: 25.3, z: 12.7 }, { x: -10.6, y: 27.2, z: 13.5 }, { x: -7.2, y: 33.6, z: 15.0 }, { x: -1.5, y: 38.5, z: 16.4 }, { x: -1.7, y: 44.7, z: 16.4 }];
const ROUTE_STATION_TO_FIELD = [{ x: -6.7, y: 39.8, z: 16.8 }, { x: -11.1, y: 34.5, z: 18.3 }, { x: -18.1, y: 26.5, z: 20.7 }, { x: -21.7, y: 24.7, z: 21.5 }, { x: -23.9, y: 19.7, z: 22.4 }, { x: -26.6, y: 22.1, z: 22.4 }, { x: -27.4, y: 22, z: 22.2 }];
const ROUTE_FIELD_TO_TURBOLIFT = [{ x: -27.3, y: 24.9, z: 22.4 }, { x: -22.9, y: 32.5, z: 22.4 }, { x: -15.9, y: 39.9, z: 22.4 }, { x: -10.8, y: 48.4, z: 22.4 }, { x: -6.8, y: 55.9, z: 22.4 }, { x: -6.3, y: 60.1, z: 22.4 }, { x: -7.9, y: 60, z: 22.4 }];

// 106PER: from the fuel depot turbolift round the corridor to Hangar Control,
// then east through the opened hangar door, down to decontamination and the
// hangar floor.
const G = 9.3;
const HANGAR_ARRIVAL = { x: -58.1, y: 5.2, z: G };
const HANGAR_DECON_CONSOLE = { x: 62.3, y: 20.3, z: 0.9 };         // DecCon
const HANGAR_RAMP_TRIGGER = { x: 12.1, y: 6.8, z: 0.9 };          // TO_107PERm
// Planned on the 106PER face graph from the hangar-bay checkpoint
// (walkmesh-plan.js over evidence/peragus/walkmesh-106per.faces.json): the
// corridor from the turbolift to the Fuel Depot Door, up the ramp onto the
// Hangar Control platform (z 12.8); through the Hangar Bay Door, the mined
// gallery and down to the decontamination console (z 0.9); then through the
// decontamination door and the gassed tunnel to the loading ramp.
const ROUTE_HANGAR_ARRIVAL_TO_CONTROL = [{ x: -52.0, y: 7.6, z: 9.3 }, { x: -45.6, y: 8.7, z: 9.3 }, { x: -43.5, y: 13.4, z: 9.3 }, { x: -38.3, y: 17.4, z: 9.3 }, { x: -39.3, y: 23.5, z: 9.3 }, { x: -37.8, y: 27.7, z: 9.3 }, { x: -32.3, y: 31.5, z: 9.3 }, { x: -33.0, y: 35.9, z: 9.3 }, { x: -30.1, y: 39.4, z: 9.3 }, { x: -25.6, y: 39.5, z: 9.3 }, { x: -24.9, y: 43.8, z: 9.3 }, { x: -20.9, y: 46.8, z: 9.3 }, { x: -15.8, y: 46.9, z: 9.3 }, { x: -13.7, y: 50.6, z: 9.3 }, { x: -8.5, y: 50.9, z: 9.3 }, { x: -6.5, y: 52.0, z: 9.3 }, { x: -4.8, y: 57.9, z: 9.3 }, { x: -0.9, y: 60.4, z: 9.3 }, { x: 0.9, y: 50.7, z: 10.5 }, { x: -0.9, y: 45.0, z: 11.6 }, { x: -1.0, y: 39.3, z: 12.8 }, { x: 0.9, y: 37.2, z: 12.8 }, { x: 0, y: 36.4, z: 12.8 }];
const ROUTE_CONTROL_TO_DECON = [{ x: -1.0, y: 39.3, z: 12.8 }, { x: -0.9, y: 45.0, z: 11.6 }, { x: 0.9, y: 50.7, z: 10.5 }, { x: 1.1, y: 58.4, z: 9.3 }, { x: 5.0, y: 57.3, z: 9.3 }, { x: 6.5, y: 52.0, z: 9.3 }, { x: 8.5, y: 48.7, z: 9.3 }, { x: 13.7, y: 50.6, z: 9.3 }, { x: 15.8, y: 46.9, z: 9.3 }, { x: 20.9, y: 46.8, z: 9.3 }, { x: 24.8, y: 43.9, z: 9.3 }, { x: 29.0, y: 44.7, z: 9.3 }, { x: 29.4, y: 48.4, z: 9.3 }, { x: 34.9, y: 49.8, z: 9.3 }, { x: 34.6, y: 54.3, z: 9.3 }, { x: 39.7, y: 55.0, z: 9.3 }, { x: 41.8, y: 57.1, z: 9.3 }, { x: 45.3, y: 57.8, z: 9.3 }, { x: 48.3, y: 60.6, z: 9.3 }, { x: 52.2, y: 58.6, z: 9.3 }, { x: 61.3, y: 60.1, z: 7.9 }, { x: 68.7, y: 59.1, z: 6.5 }, { x: 77.8, y: 60.9, z: 5.1 }, { x: 82.3, y: 58.5, z: 5.1 }, { x: 84.2, y: 53.5, z: 5.1 }, { x: 80.7, y: 48.5, z: 5.1 }, { x: 68.6, y: 46.2, z: 3.7 }, { x: 61.0, y: 47.2, z: 2.3 }, { x: 51.6, y: 47.7, z: 0.9 }, { x: 49.0, y: 43.5, z: 0.9 }, { x: 45.4, y: 40.1, z: 0.9 }, { x: 48.6, y: 33.6, z: 0.9 }, { x: 52.5, y: 33.7, z: 0.9 }, { x: 57.0, y: 32.2, z: 0.9 }, { x: 60.9, y: 29.1, z: 0.9 }, { x: 64.3, y: 27.1, z: 0.9 }, { x: 62.9, y: 23.0, z: 0.9 }, { x: 62.2, y: 19.3, z: 0.9 }, { x: 62.3, y: 20.3, z: 0.9 }];
// The face graph bridged the wall east of the console (rooms 106per04 to
// 106per03 are 1.2 m apart there, but joined only by the Decontamination
// Door at 63.9,26.4); the first legs go through that door instead.
const ROUTE_DECON_TO_RAMP = [{ x: 62.6, y: 24.6, z: 0.9 }, { x: 63.9, y: 26.4, z: 0.9 }, { x: 66.0, y: 25.4, z: 0.9 }, { x: 66.5, y: 21.0, z: 0.9 }, { x: 65.0, y: 16.4, z: 1.0 }, { x: 68.1, y: 13.4, z: 1.0 }, { x: 67.5, y: 9.9, z: 1.1 }, { x: 64.3, y: 7.5, z: 1.0 }, { x: 60.9, y: 8.3, z: 1.2 }, { x: 57.0, y: 7.9, z: 1.2 }, { x: 53.7, y: 8.6, z: 1.3 }, { x: 50.3, y: 7.5, z: 1.0 }, { x: 47.0, y: 5.3, z: 0.9 }, { x: 43.8, y: 3.7, z: 0.9 }, { x: 39.6, y: 6.5, z: 0.9 }, { x: 35.6, y: 7.1, z: 0.9 }, { x: 32.9, y: 6.6, z: 0.9 }, { x: 30.8, y: 2.8, z: 0.9 }, { x: 29.6, y: 6.8, z: 0.9 }, { x: 24.2, y: 3.3, z: 0.9 }, { x: 18.7, y: 6.4, z: 0.9 }, { x: 16.6, y: 10.8, z: 0.9 }, { x: 8.9, y: 10.4, z: 0.9 }, { x: 12.1, y: 6.8, z: 0.9 }];

/** Disarms or recovers a mine through its VR prompt; walking it off counts too. */
async function clearMineNear(harness, point, label) {
  const mines = await harness.evaluate(`(() => {
    const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
    const player = window.KotOR.PartyManager.party[0];
    if (!area || !player) return [];
    return (area.triggers || []).filter((t) => t && /sonic|mine|trap/i.test(String(t.tag || '') + String(t.templateResRef || '')))
      .filter((t) => !t.destroyed)
      .map((t) => {
        // A trigger's position is its polygon origin (vertex 0 for the
        // authored mines), not where the mine sits: measure from the box
        // centre or the first mine measured 4 m out and was skipped.
        let c = t.position;
        try { if (t.box) c = t.box.getCenter(t.position.clone()); } catch (e) { c = t.position; }
        return { id: t.id, tag: String(t.tag || ''), position: { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +t.position.z.toFixed(2) },
          distance: +player.position.distanceTo(c).toFixed(2) };
      });
  })()`);
  const mine = mines.sort((l, r) => distanceBetween(l.position, point) - distanceBetween(r.position, point))[0];
  if (!mine || distanceBetween(mine.position, point) > 4) {
    line(`  · ${label}: no mine within 4 m of ${JSON.stringify(point)}; nearest ${JSON.stringify(mine || null)} of ${mines.length}`);
    return { found: false, mines: mines.length };
  }
  await healPlayerIfInjured(harness, 12).catch(() => undefined);
  try {
    await navigateTo(harness, { ...mine.position, range: 1.6, label, maxAttempts: 3, permittedDoorPromptIds: [] });
  } catch (error) {
    line(`  · ${label}: approach fell short (${String(error.message).slice(0, 80)})`);
  }
  await sleep(800);
  const prompts = await listWorldPrompts(harness);
  const offered = (prompts.prompts || []).find((p) => p.id === `module-object:${mine.id}`);
  const action = offered && Array.isArray(offered.actions) ? (offered.actions.find((a) => /^Recover$/i.test(a)) || offered.actions.find((a) => /^Disarm$/i.test(a))) : null;
  if (!action) {
    line(`  · ${label}: no Disarm/Recover offered (${JSON.stringify(offered || null)}); stepping over it`);
    await moveTo(harness, { ...mine.position, range: 0.4, usePath: false, timeoutMs: 15_000, label }).catch(() => undefined);
    await sleep(1500);
  } else {
    await activateWorldAction(harness, { objectId: offered.id, actionLabel: action });
    await sleep(2500);
    await clearBlockingModal(harness);
  }
  const state = await harness.evaluate(`(() => {
    const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
    const t = area && (area.triggers || []).find((entry) => entry && entry.id === ${mine.id});
    return t ? { present: true, destroyed: t.destroyed === true, willDestroy: t.willDestroy === true } : { present: false };
  })()`);
  line(`  · ${label}: ${action || 'walked'} -> ${JSON.stringify(state)}`);
  return { found: true, mine, action, state };
}

async function stageHangarEscape(ctx) {
  const { harness, args, record, report, resumedPast } = ctx;

  await record('fuel line: recover T3-M4 and the hangar control conduit', async () => {
    if (resumedPast(args, 't3-rescued')) return { skipped: 'resumed past it' };
    // 103atton.dlg over T3 (a_addt3m4sp puts him back in the party), then the
    // concealed stash (oddcase.dlg) with the Hangar 25 Control Conduit.
    const atton = createPriorityChooser([
      /^Can you travel, T3\?/i, /^Then let's go/i, /Warm up your systems/i, /T3 has joined your party/i, /Don't blame yourself/i,
    ], { label: 'T3 rescue', unseenFallback: true });
    // The polygon sits in a niche west of the pipe: a straight push from the
    // arrival stops 4 m short on the pipe wall. The face graph enters it
    // from (-43.6, -7.5).
    // The arrival, the trigger and T3 are all inside the fuel pipe (room
    // 103perr, floor z 12.2), which overlaps the deck (103pers, z 11.9) in
    // plan. A sweep after a droid on the deck walked the Exile out through
    // the pipe wall (engine collision does not keep overlapping rooms apart)
    // and every later approach to T3 pressed on the wall from outside. No
    // sweeps inside the pipe; the droids outside cannot reach us either.
    await travelTo(harness, { ...LINE_PIPE_ENTER, label: '103pipeenter trigger', range: 0.8, sweepRadius: 0, rounds: 2, usePath: false, viaChooser: atton });
    await sleep(1500);
    await playAnyPendingConversation(harness, { choose: atton, label: 'T3 rescue' });
    const joinedFromTrigger = atton.picks.some((pick) => /T3 has joined your party|Then let's go|Warm up your systems|Can you travel, T3/i.test(pick));
    line(`  · 103pipeenter: ${joinedFromTrigger ? 'played 103atton' : 'no 103atton conversation'}; picks so far ${JSON.stringify(atton.picks)}`);
    // The trigger's conversation often plays as a walk interruption (moveTo's
    // clearProgressBlockingDialogue, default chooser), so the picks say
    // nothing; the party does. Once a_addt3m4sp has run T3 is a party member
    // and no longer an area creature.
    const t3IsPartyMember = async () => harness.evaluate(`(() => window.KotOR.PartyManager.party.some((m) => /^t3m4$/i.test(String(m.tag || ''))))()`).catch(() => false);
    if (!(await t3IsPartyMember())) {
      await travelTo(harness, { ...LINE_T3, label: 'T3-M4', range: 2.6, sweepRadius: 0, rounds: 2, usePath: false, viaChooser: atton });
      await playAnyPendingConversation(harness, { choose: atton, label: 'T3 rescue' });
      if (!(await t3IsPartyMember())) {
        const t3 = (await findObjectByTag(harness, 'T3M4').catch(() => []))[0];
        if (!t3) throw new Error('T3-M4 is neither in the party nor in the fuel line');
        await useTaggedWorldObject(harness, { tag: 'T3M4', targetId: t3.id, actionPattern: /^(Use|Talk)/i, range: 2.6, maxAttempts: 3 });
        await playAnyPendingConversation(harness, { choose: atton, label: 'T3 rescue' });
      }
    }
    const party = await playerSnapshot(harness);
    line(`  · party size after T3: ${party.partySize}; picked ${JSON.stringify(atton.picks)}`);
    const t3InParty = await harness.evaluate(`(() => { const K = window.KotOR; return { inParty: K.PartyManager.party.some((m) => /^t3m4$/i.test(String(m.tag || ''))), members: K.PartyManager.party.map((m) => String(m.tag || m.getName())), npc8: K.PartyManager.NPCS && K.PartyManager.NPCS[8] ? { available: K.PartyManager.NPCS[8].available, selectable: K.PartyManager.NPCS[8].selectable } : null }; })()`);
    line(`  · T3 in party: ${JSON.stringify(t3InParty)}`);
    if (!t3InParty.inParty) throw new Error(`T3-M4 did not rejoin the party after the rescue: ${JSON.stringify({ ...t3InParty, picks: atton.picks })}`);
    await lootTagged(harness, { tag: 'OddCase', near: LINE_STASH, label: 'concealed stash' });
    await playAnyPendingConversation(harness, { label: 'stash' });
    const inventory = await inventoryReport(harness, 'after the stash');
    if (!inventoryQuantity(inventory.inventory, /control conduit/i)) throw new Error('the Hangar 25 Control Conduit was not recovered');
    return { atton: atton.picks, partySize: party.partySize };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 't3-rescued')) {
    await record('checkpoint: T3 rescued', () => checkpoint(harness, 't3-rescued'));
    if (report.blocked) return;
  }

  await record('fuel line: clear the sonic mines and open the exit ramp field', async () => {
    if (resumedPast(args, 'exit-ramp-open')) return { skipped: 'resumed past it' };
    // emerstat.dlg refuses while any of the three G_T_SONIC02_EMER mines
    // remain (c_checkmines); disarmed, recovered or triggered all count.
    const cleared = [];
    for (let index = 0; index < LINE_MINES.length; index += 1) {
      await travelTo(harness, { ...LINE_MINES[index], label: `fuel line mine ${index + 1}`, range: 3.0, sweepRadius: 12, rounds: 3, via: ROUTE_LINE_MINE_LEGS[index] });
      cleared.push(await clearMineNear(harness, LINE_MINES[index], `fuel line mine ${index + 1}`));
    }
    await travelTo(harness, { ...LINE_FIELD_STATION, label: 'Emergency Field Station', range: 2.4, sweepRadius: 12, rounds: 4, via: ROUTE_MINE3_TO_STATION });
    const chooser = createScriptedChooser([/Shut down emergency field to exit ramp/i, /^Log out/i], { label: 'Emergency Field Station' });
    const result = await useAndConverse(harness, { tag: 'EmerStation', choose: chooser, label: 'Emergency Field Station' });
    await sleep(3000);
    const field = await findTaggedNear(harness, 'FieldFuel', LINE_FIELD_DOOR);
    const state = field ? await objectState(harness, field.id) : { located: false };
    line(`  · exit ramp field: ${JSON.stringify(state)}`);
    if (!state.located || !state.open) {
      throw new Error(`the exit ramp field did not open: ${JSON.stringify({ state, mines: cleared, transcript: result.played.transcript.slice(-4) })}`);
    }
    return { mines: cleared, picks: chooser.picks, field: state };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'exit-ramp-open')) {
    await record('checkpoint: exit ramp open', () => checkpoint(harness, 'exit-ramp-open'));
    if (report.blocked) return;
  }

  await record('fuel depot: up the ramp and the turbolift to the hangar bay', async () => {
    if (resumedPast(args, 'hangar-bay')) return { skipped: 'resumed past it' };
    // Up the exit ramp to the depot deck, through the opened FieldFuel door
    // (walking through an open door is the same as any other leg), then the
    // corridor to the turbolift trigger.
    await travelTo(harness, { ...LINE_FIELD_DOOR, label: 'exit ramp field', range: 2.4, sweepRadius: 12, rounds: 4, via: ROUTE_STATION_TO_FIELD });
    await walkIntoTransition(harness, { module: '106per', near: DEPOT_HANGAR_TRIGGER, label: 'turbolift to the hangar bay', sweepRadius: 14, rounds: 4, via: ROUTE_FIELD_TO_TURBOLIFT });
    await waitForModule(harness, '106per', TIMEOUTS.moduleLoad);
    await sleep(1500);
    await returnToGameplay(harness);
    const arrived = await playerSnapshot(harness);
    line(`  · now in ${arrived.module} at ${JSON.stringify(arrived.position)}`);
    return { arrived };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'hangar-bay')) {
    await record('checkpoint: hangar bay', () => checkpoint(harness, 'hangar-bay'));
    if (report.blocked) return;
  }

  await record('hangar bay: replace the conduit and open the hangar door', async () => {
    if (resumedPast(args, 'hangar-door-open')) return { skipped: 'resumed past it' };
    // 106Atton at the sealed hangar door, then hangterm.dlg. The console's
    // route to the door is skill-gated on GetPCSpeaker (the party leader):
    // "Access emergency control commands" -> "[Repair] Run diagnostic"
    // (c_skilrep) re-routes the sub-systems -> "[Computer] Check status"
    // (c_skilcom) -> "[Computer] Open blast door to Hangar 25" fails for the
    // missing conduit (E19 sets local 37) -> "Replace hangar control power
    // conduit" (c_hasitem Hangar25Control AND local 37; a_op106eastdr opens
    // TrafficEastDoor). The Exile has Repair but no Computer Use and Atton the
    // reverse, so the leader is switched through the wheel's Party submenu:
    // a member with both skills (T3-M4) does it in one session, otherwise
    // the Repair session runs as the Exile and the Computer session as Atton.
    const atton = createPriorityChooser([/^Then go to the terminal and open it/i, /He said he can open the door/i, /Long story, not enough time/i], { label: 'Atton (hangar)', unseenFallback: true });
    await travelTo(harness, { ...HANGAR_CONTROL, label: 'Hangar Control', range: 2.4, sweepRadius: 16, rounds: 5, via: ROUTE_HANGAR_ARRIVAL_TO_CONTROL, viaChooser: atton });
    await playAnyPendingConversation(harness, { choose: atton, label: 'Atton (hangar)' });

    const roster = async () => harness.evaluate(`(() => window.KotOR.PartyManager.party.map((m, index) => ({ index, name: String(m.getName ? m.getName() : m.tag), tag: String(m.tag || ''), isPlayer: !!m.isPlayer, npcId: m.npcId, repair: m.getSkillLevel ? m.getSkillLevel(5) : 0, computer: m.getSkillLevel ? m.getSkillLevel(0) : 0 })))()`);
    const members = await roster();
    line(`  · party at Hangar Control: ${JSON.stringify(members)}`);
    const exile = members.find((m) => m.isPlayer) || members[0];
    const both = members.find((m) => m.repair > 0 && m.computer > 0);
    const repairer = both || members.find((m) => m.repair > 0);
    const slicer = both || members.find((m) => m.computer > 0);
    if (!repairer || !slicer) throw new Error(`no party member can work Hangar Control: ${JSON.stringify(members)}`);

    // The wheel's Party submenu possesses the chosen member
    // (SwitchPlayerCharacter), which is retail's leader switch: GetPCSpeaker
    // is then that member and their skills gate the console. While a
    // companion is possessed the wheel offers the Exile by name to switch
    // back. (It used to only reorder the follow order, and every
    // conversation made the Exile the speaker again.)
    const makeLeader = async (member) => {
      const now = await roster();
      if (now[0] && now[0].name === member.name) return { switched: false };
      const wheel = await activateWheelAction(harness, { targetId: null, submenuId: 'submenu:party', actionLabel: member.name }).catch((error) => ({ ok: false, reason: String(error.message) }));
      await sleep(3000);
      await returnToGameplay(harness);
      const after = await roster();
      const player = await playerSnapshot(harness);
      line(`  · wheel Party -> ${member.name}: ${JSON.stringify(wheel)}; party now ${JSON.stringify(after.map((m) => m.name))}; playing ${player.name} at ${JSON.stringify(player.position)}`);
      if (!wheel.ok || !after[0] || after[0].name !== member.name) throw new Error(`the wheel did not hand control to ${member.name}: ${JSON.stringify({ wheel, after })}`);
      return { switched: true };
    };
    const eastDoorUnlocked = async () => {
      const east = (await findObjectByTag(harness, 'TrafficEastDoor'))[0];
      return east ? await objectState(harness, east.id) : { located: false };
    };
    const sessions = [];
    const plan = both
      ? [{ operator: both, patterns: [/^Access emergency control commands/i, /^\[Repair\] Run diagnostic/i, /^\[Computer\] Check status of emergency sub-systems/i, /^\[Computer\] Open blast door to Hangar 25/i, /Replace hangar control power conduit/i, /^Log out/i] }]
      : [
        { operator: repairer, patterns: [/^Access emergency control commands/i, /^\[Repair\] Run diagnostic/i, /^Log out/i] },
        { operator: slicer, patterns: [/^Access emergency control commands/i, /^\[Computer\] Check status of emergency sub-systems/i, /^\[Computer\] Open blast door to Hangar 25/i, /Replace hangar control power conduit/i, /^Log out/i] },
      ];
    for (const session of plan) {
      await makeLeader(session.operator);
      await travelTo(harness, { ...HANGAR_CONTROL, label: `Hangar Control (${session.operator.name})`, range: 2.4, sweepRadius: 0, rounds: 2, usePath: false });
      const chooser = createScriptedChooser(session.patterns, { label: `Hangar Control (${session.operator.name})` });
      const result = await useAndConverse(harness, { tag: 'HangarTer', choose: chooser, label: `Hangar Control (${session.operator.name})` });
      sessions.push({ operator: session.operator.name, picks: chooser.picks, transcript: result.played.transcript.slice(-6) });
      await sleep(2000);
      const state = await eastDoorUnlocked();
      line(`  · Hangar Bay Door after ${session.operator.name}: ${JSON.stringify(state)}`);
      if (state.located && state.locked === false) break;
    }
    await makeLeader(exile).catch((error) => line(`  · could not hand the lead back to ${exile.name}: ${String(error.message).slice(0, 120)}`));
    const state = await eastDoorUnlocked();
    line(`  · Hangar Bay Door: ${JSON.stringify(state)}`);
    if (!sessions.some((s) => s.picks.some((pick) => /Replace hangar control power conduit/i.test(pick)))) {
      throw new Error(`the conduit was never replaced; sessions ${JSON.stringify(sessions)}`);
    }
    if (!state.located || state.locked !== false) throw new Error(`the hangar bay door stayed locked: ${JSON.stringify({ state, sessions })}`);
    return { atton: atton.picks, sessions, door: state };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'hangar-door-open')) {
    await record('checkpoint: hangar door open', () => checkpoint(harness, 'hangar-door-open'));
    if (report.blocked) return;
  }

  await record('hangar bay: through decontamination to the Ebon Hawk', async () => {
    if (resumedPast(args, 'ebon-hawk-boarded')) return { skipped: 'resumed past it' };
    // deccon.dlg: "[Destroy the console to open the decontamination door.]",
    // then the gassed tunnel down to the hangar floor and the loading ramp
    // (k_force003ebodlg -> ebonhawk.dlg -> a_load003ebo -> 107PER).
    await travelTo(harness, { ...HANGAR_DECON_CONSOLE, label: 'Decontamination Console', range: 2.4, sweepRadius: 16, rounds: 6, via: ROUTE_CONTROL_TO_DECON });
    const decon = createScriptedChooser([/\[Destroy the console to open the decontamination door\.\]/i, /^Log out/i], { label: 'Decontamination Console' });
    await useAndConverse(harness, { tag: 'DecCon', choose: decon, label: 'Decontamination Console' });
    let door = null;
    for (let wait = 0; wait < 15; wait += 1) {
      await sleep(2000);
      await clearBlockingModal(harness);
      const found = (await findObjectByTag(harness, '106DeconDoor').catch(() => []))[0];
      door = found ? await objectState(harness, found.id) : null;
      if (door && (door.open || door.locked === false)) break;
    }
    line(`  · decontamination door: ${JSON.stringify(door)}`);
    if (!door || (!door.open && door.locked !== false)) throw new Error(`the decontamination door stayed sealed: ${JSON.stringify(door)}`);
    const ramp = createPriorityChooser([/\[Enter the Ebon Hawk\.\]/i], { label: 'Ebon Hawk ramp' });
    // TO_107PERm is a scripted trigger (k_force003ebodlg -> ebonhawk.dlg);
    // the module changes when "[Enter the Ebon Hawk.]" runs a_load003ebo, so
    // the conversation is played before waiting for 107PER.
    await walkIntoTransition(harness, { module: '107per', tag: 'TO_107PERm', near: HANGAR_RAMP_TRIGGER, label: 'Ebon Hawk loading ramp', sweepRadius: 14, rounds: 5, via: ROUTE_DECON_TO_RAMP, timeout: 20_000 }).catch((error) => {
      line(`  · Ebon Hawk loading ramp: ${String(error.message).slice(0, 120)}`);
    });
    await healPlayerIfInjured(harness, 999).catch(() => undefined);
    await playAnyPendingConversation(harness, { choose: ramp, label: 'Ebon Hawk ramp' });
    await waitForModule(harness, '107per', TIMEOUTS.moduleLoad);
    await sleep(2000);
    const arrived = await playerSnapshot(harness);
    const state = await worldState(harness);
    // 107PER is the Ebon Hawk turret minigame (engine mode 2), the authored
    // end of the Peragus arc; the minigame itself is ROADMAP 7.6.
    line(`  · now in ${arrived.module} as ${arrived.name} (engine mode ${state.engineMode}${state.engineMode === 2 ? ', the turret minigame' : ''}); picked ${JSON.stringify(ramp.picks)}`);
    if (String(arrived.module).toLowerCase() !== '107per') throw new Error(`expected 107PER after the loading ramp, got ${arrived.module}`);
    return { decon: decon.picks, ramp: ramp.picks, arrived, engineMode: state.engineMode };
  });
  if (report.blocked) return;
  if (!resumedPast(args, 'ebon-hawk-boarded')) {
    await record('checkpoint: Ebon Hawk boarded', async () => {
      // Retail cannot save inside the turret minigame either; the arrival in
      // 107PER is the milestone, and the save is written only if the engine is
      // in gameplay there.
      const state = await worldState(harness);
      if (state.engineMode === 2) return { skipped: 'no save inside the 107PER turret minigame; the Peragus arc is complete' };
      return checkpoint(harness, 'ebon-hawk-boarded');
    });
  }
}

// ---------------------------------------------------------------------------

/**
 * Runs every Peragus stage after the medical bay. `ctx` carries the live
 * harness plus the driver's `record`/`resumedPast` so stages read like the
 * steps in playthrough-steps.js.
 */
async function runPeragusCampaign(ctx) {
  const stages = [stageAdministrationLevel, stageT3Rescue, stageMiningTunnels, stageDormitories, stageHarbinger, stageHangarEscape];
  for (const stage of stages) {
    if (ctx.report.blocked) return;
    await stage(ctx);
  }
}

module.exports = {
  ROUTES: { ROUTE_MAIN_BODY_TO_VIBROCUTTER, ROUTE_VIBROCUTTER_TO_SECURITY_ROOM, ROUTE_SECURITY_ROOM_TO_CONSOLE, ROUTE_CONSOLE_TO_PRISON, ROUTE_PRISON_TO_CONSOLE, ROUTE_STORAGE_TO_SUBLEVEL, ROUTE_SUBLEVEL_TO_STORAGE, ROUTE_CARGO_HOLD_TO_CONTROL, ROUTE_STORAGE_TO_FUEL_DEPOT_DOOR, ROUTE_CONSOLE_TO_HATCH, ROUTE_TUNNELS_TO_CORE, ROUTE_CORE_TO_EXIT, ROUTE_DEPOT_TO_MAINTENANCE, ROUTE_MAINTENANCE_TO_AIRLOCK, EXTERIOR_TO_DORMS, ROUTE_DORMS_TO_TURBOLIFT, ROUTE_DORM_ARRIVAL_TO_BLISTER, ROUTE_BLISTER_TO_DOCKING, ROUTE_CMD_TO_BRIDGE, ROUTE_BRIDGE_TO_CREW, ROUTE_CREW_TO_LIFT, ROUTE_ENGINE_ARRIVAL_TO_JUNCTION, ROUTE_JUNCTION_TO_MAINT_ROOM, ROUTE_MAINT_ROOM_TO_STORAGE, ROUTE_STORAGE_TO_ENGINE, ROUTE_ENGINE_TO_HATCH, ROUTE_LINE_MINE_LEGS, ROUTE_MINE3_TO_STATION, ROUTE_STATION_TO_FIELD, ROUTE_FIELD_TO_TURBOLIFT, ROUTE_HANGAR_ARRIVAL_TO_CONTROL, ROUTE_CONTROL_TO_DECON, ROUTE_DECON_TO_RAMP },
  runPeragusCampaign,
  PERAGUS_CHECKPOINT_ORDER,
  PERAGUS_CHECKPOINT_EXPECTATIONS,
  createPriorityChooser,
  createScriptedChooser,
  stripOrdinal,
  playConversation,
  travelTo,
  lootTagged,
  findTaggedNear,
  useAndConverse,
  playAnyPendingConversation,
  playConversation,
  waitForConversation,
  playerSnapshot,
};
