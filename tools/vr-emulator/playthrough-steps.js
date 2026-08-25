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

// Keep this verification campaign isolated from the exploratory VRPT saves.
// Reusing their names allowed SaveGame's first matching entry to load an older
// state while the harness skipped work based on the newer checkpoint label.
// The earlier campaign reached Peragus through the explicit Skip Prologue
// console, which sets 101PER_Med_Log and therefore starts the medical terminal
// in its authored log-only branch. Do not reuse those stateful saves for the
// normal new-game route.
const CHECKPOINT_PREFIX = 'VRPT-20260824-E2E';

/**
 * Checkpoints in the order they are reached. `--resume <name>` skips every step
 * belonging to a stage at or before that checkpoint, so a later checkpoint does
 * not replay the Ebon Hawk — special-casing one name meant every new checkpoint
 * silently re-ran the whole prologue.
 */
const CHECKPOINT_ORDER = [
  'prologue-start',
  'ebon-console-sliced',
  'ebon-main-hold-open',
  'ebon-spikes-recovered',
  'ebon-security-sliced',
  'ebon-inner-garage-open',
  'ebon-low-security-open',
  'ebon-second-low-security-open',
  'ebon-exterior-arrival',
  'ebon-first-mine-disarmed',
  'ebon-second-mine-recovered',
  'ebon-proton-missile-recovered',
  'ebon-engine-parts-recovered',
  'ebon-quadlasers-recovered',
  'ebon-return-lift-entered',
  'ebon-engine-room-open',
  'ebon-hyperdrive-rigged',
  'peragus-arrival',
  'kolto-tank',
  'medbay-door',
  'medbay-looted',
  'medbay-swept',
  'consoles-used',
  'morgue-door',
  'first-kill',
  'droids-cleared',
  'levelled',
  'module-102',
];

/** Checkpoints that leave the player back aboard the Ebon Hawk, post-exterior. */
const RETURNED_TO_EBON_HAWK = new Set([
  'ebon-return-lift-entered',
  'ebon-engine-room-open',
  'ebon-hyperdrive-rigged',
]);

// These are the player-facing Peragus medical-bay progression fixtures. Keep
// the playthrough focused on them: a generic area sweep can cross into
// unrelated rooms and mutate containers that the player has not chosen to
// investigate. `KreiaInv` and `inv_talker` are invisible story helpers, not
// things a VR player can deliberately select and use.
const MEDBAY_FIXTURE_TAGS = Object.freeze(['MedCom']);
const MEDBAY_MAX_NAVIGATION_ATTEMPTS = 2;
const INTERMEDIATE_WAYPOINT_RANGE = 0.8;
const MEDICAL_COMPUTER_MAX_VISITS = 6;
const GAMEPLAY_RETURN_MENU_NAMES = Object.freeze([
  'MenuCharacter',
  'MenuContainer',
  'MenuEquipment',
  'MenuInventory',
  'MenuAbilities',
  'MenuJournal',
  'MenuMessages',
  'MenuOptions',
  'MenuLevelUp',
  'MenuPartySelection',
  'MenuGalaxyMap',
  'InGameComputer',
]);

const CHECKPOINT_EXPECTATIONS = Object.freeze({
  'ebon-engine-room-open': Object.freeze({ module: '001ebo', minimumInventoryCount: 1 }),
  'ebon-hyperdrive-rigged': Object.freeze({ module: '001ebo', minimumInventoryCount: 1 }),
  'peragus-arrival': Object.freeze({ module: '101per' }),
  'kolto-tank': Object.freeze({ module: '101per' }),
  'medbay-door': Object.freeze({ module: '101per' }),
  'medbay-looted': Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
  'medbay-swept': Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
  'consoles-used': Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
  'morgue-door': Object.freeze({ module: '101per', minimumInventoryCount: 1 }),
});

function validateCheckpointSnapshot(name, { moduleName, inventoryCount }) {
  const expected = CHECKPOINT_EXPECTATIONS[name];
  if (!expected) return { ok: true };
  if (String(moduleName || '').toLowerCase() !== expected.module) {
    return { ok: false, reason: `checkpoint ${name} loaded module ${moduleName || '(none)'}; expected ${expected.module}` };
  }
  if (expected.minimumInventoryCount != null && (!Number.isInteger(inventoryCount) || inventoryCount < expected.minimumInventoryCount)) {
    return { ok: false, reason: `checkpoint ${name} has inventory ${inventoryCount}; expected at least ${expected.minimumInventoryCount}` };
  }
  return { ok: true };
}

function resumedPast(args, checkpoint) {
  if (!args.resume) return false;
  const resumedAt = CHECKPOINT_ORDER.indexOf(args.resume);
  const stageAt = CHECKPOINT_ORDER.indexOf(checkpoint);
  if (resumedAt < 0 || stageAt < 0) return false;
  return stageAt <= resumedAt;
}

/**
 * The menus that carry a running conversation and therefore suspend gameplay.
 *
 * InGameComputer is the terminal/log variant and had been left out, so a
 * scripted Peragus medical-log sequence that grabs control mid-walk looked to
 * the driver like nothing at all: it kept pushing the stick with the engine in
 * DIALOG mode and reported every destination as "unreachable".
 */
const PROGRESS_BLOCKING_MENUS = Object.freeze(['InGameDialog', 'InGameComputer']);

/** EngineMode.DIALOG. Gameplay input is suppressed while the engine sits here. */
const ENGINE_MODE_DIALOG = 3;

/**
 * Whether a named conversation menu is carrying a live conversation.
 *
 * Reads the whole menu stack and the engine mode, not just the foreground
 * menu: InGameComputer and InGameDialog both routinely sit *under*
 * InGameOverlay while their conversation runs, so a foreground-only test
 * reports "the console did not open" for a console that opened fine.
 */
function isConversationLive(state, menuName) {
  if (!state) return false;
  const stack = Array.isArray(state.menuStack) ? state.menuStack : [];
  if (state.foregroundMenu === menuName || stack.includes(menuName)) return true;
  return state.engineMode === ENGINE_MODE_DIALOG;
}

function isProgressBlockingForeground(menuName) {
  return PROGRESS_BLOCKING_MENUS.includes(menuName);
}

function dialogueTranscriptKey(transcript) {
  if (!Array.isArray(transcript)) throw new TypeError('dialogue transcript must be an array');
  return transcript.map((line) => String(line).trim()).filter(Boolean).join('\n');
}

function chooseMorgueUnlockReply(replies, snapshot) {
  const scripts = Array.isArray(snapshot && snapshot.replyScripts) ? snapshot.replyScripts : [];
  const index = scripts.findIndex((script) => script.toLowerCase() === 'a_setmor');
  return index >= 0 && index < replies.length ? index : 0;
}

/**
 * Resolves a console action by its authored reply script rather than by a
 * display-order assumption. This fails closed if the expected action is absent:
 * selecting another console option can consume resources or move the story.
 */
function chooseRequiredDialogueScript(replies, snapshot, scriptName, label = 'dialogue') {
  if (!Array.isArray(replies)) throw new TypeError(`${label}: replies must be an array`);
  if (typeof scriptName !== 'string' || scriptName.trim().length === 0) {
    throw new TypeError(`${label}: scriptName must be a non-empty string`);
  }
  const scripts = Array.isArray(snapshot && snapshot.replyScripts) ? snapshot.replyScripts : [];
  const expected = scriptName.trim().toLowerCase();
  const index = scripts.findIndex((script, candidateIndex) =>
    candidateIndex < replies.length && String(script).trim().toLowerCase() === expected,
  );
  if (index < 0) {
    throw new Error(`${label}: required authored reply script ${scriptName} was not offered; ` +
      `replies=${JSON.stringify(replies)} scripts=${JSON.stringify(scripts)}`);
  }
  return index;
}

/**
 * Resolves a player-visible conversation exit when the game data intentionally
 * supplies no reply script. The text must occur exactly once: display order is
 * not a safe substitute for a terminal action.
 */
function chooseRequiredDialogueText(replies, requiredText, label = 'dialogue') {
  if (!Array.isArray(replies) || replies.some((reply) => typeof reply !== 'string')) {
    throw new TypeError(`${label}: replies must be an array of strings`);
  }
  if (typeof requiredText !== 'string' || requiredText.trim().length === 0) {
    throw new TypeError(`${label}: requiredText must be a non-empty string`);
  }
  const expected = requiredText.trim().toLowerCase();
  const matches = replies.reduce((indexes, reply, index) => {
    if (reply.trim().toLowerCase() === expected) indexes.push(index);
    return indexes;
  }, []);
  if (matches.length !== 1) {
    throw new Error(`${label}: required reply ${requiredText} was ${matches.length === 0 ? 'not offered' : 'ambiguous'}; ` +
      `replies=${JSON.stringify(replies)}`);
  }
  return matches[0];
}

/**
 * Same fail-closed contract as chooseRequiredDialogueText, but matched on a
 * prefix, for authored replies that carry a runtime-substituted token. The
 * Hyperdrive's repair reply reads "Rig the hyperdrive. [<CUSTOM30> Parts
 * needed]" in the data and renders with the count substituted, so an exact
 * match cannot be written down ahead of the run. Still requires exactly one
 * match: a prefix that hits two rows is an ambiguous choice, not a default.
 */
function chooseRequiredDialogueTextPrefix(replies, requiredPrefix, label = 'dialogue') {
  if (!Array.isArray(replies) || replies.some((reply) => typeof reply !== 'string')) {
    throw new TypeError(`${label}: replies must be an array of strings`);
  }
  if (typeof requiredPrefix !== 'string' || requiredPrefix.trim().length === 0) {
    throw new TypeError(`${label}: requiredPrefix must be a non-empty string`);
  }
  const expected = requiredPrefix.trim().toLowerCase();
  const matches = replies.reduce((indexes, reply, index) => {
    // Rendered rows are numbered ("1. Rig the hyperdrive..."), so compare after
    // stripping the display ordinal rather than against the raw row.
    const text = reply.trim().replace(/^\d+\.\s*/, '').toLowerCase();
    if (text.startsWith(expected)) indexes.push(index);
    return indexes;
  }, []);
  if (matches.length !== 1) {
    throw new Error(`${label}: reply starting ${JSON.stringify(requiredPrefix)} was ` +
      `${matches.length === 0 ? 'not offered' : 'ambiguous'}; replies=${JSON.stringify(replies)}`);
  }
  return matches[0];
}

/**
 * A fail-closed sequence matched on reply text with the display ordinal
 * stripped. The security console renumbers its rows as options appear and
 * disappear — closing the Outer Garage Door changes what the doors submenu
 * offers — so a sequence written as "2. Open Inner Garage Door." is correct
 * only for one particular menu state.
 */
function createRequiredDialoguePrefixSequence(requiredPrefixes, label = 'dialogue') {
  if (!Array.isArray(requiredPrefixes) || requiredPrefixes.length === 0 ||
      requiredPrefixes.some((text) => typeof text !== 'string' || text.trim().length === 0)) {
    throw new TypeError(`${label}: requiredPrefixes must be a non-empty array of non-empty strings`);
  }
  let nextIndex = 0;
  const choose = (replies) => {
    if (nextIndex >= requiredPrefixes.length) {
      throw new Error(`${label}: received an unexpected additional choice; replies=${JSON.stringify(replies)}`);
    }
    const selected = chooseRequiredDialogueTextPrefix(replies, requiredPrefixes[nextIndex], label);
    nextIndex += 1;
    return selected;
  };
  choose.assertCompleted = () => {
    if (nextIndex !== requiredPrefixes.length) {
      throw new Error(`${label}: completed ${nextIndex}/${requiredPrefixes.length} required choices`);
    }
  };
  return choose;
}

function createRequiredDialogueTextSequence(requiredTexts, label = 'dialogue') {
  if (!Array.isArray(requiredTexts) || requiredTexts.length === 0 ||
      requiredTexts.some((text) => typeof text !== 'string' || text.trim().length === 0)) {
    throw new TypeError(`${label}: requiredTexts must be a non-empty array of non-empty strings`);
  }
  let nextIndex = 0;
  const choose = (replies) => {
    if (nextIndex >= requiredTexts.length) {
      throw new Error(`${label}: received an unexpected additional choice; replies=${JSON.stringify(replies)}`);
    }
    const selected = chooseRequiredDialogueText(replies, requiredTexts[nextIndex], label);
    nextIndex += 1;
    return selected;
  };
  choose.assertCompleted = () => {
    if (nextIndex !== requiredTexts.length) throw new Error(`${label}: completed ${nextIndex}/${requiredTexts.length} required choices`);
  };
  return choose;
}

/**
 * Creates a fail-closed chooser for a known sequence of authored console
 * scripts. Some terminals expose the next required operation only after the
 * first succeeds, so matching one action and then falling back to row zero can
 * silently choose a non-progression option.
 */
function createRequiredDialogueScriptSequence(scriptNames, label = 'dialogue') {
  if (!Array.isArray(scriptNames) || scriptNames.length === 0 ||
      scriptNames.some((scriptName) => typeof scriptName !== 'string' || scriptName.trim().length === 0)) {
    throw new TypeError(`${label}: scriptNames must be a non-empty array of non-empty strings`);
  }
  let nextScriptIndex = 0;
  const choose = (replies, snapshot) => {
    if (nextScriptIndex >= scriptNames.length) {
      // The required actions are done; the console is simply still open.
      // playDialogue used to return the moment the menu went invisible, so
      // this turn never arrived and throwing here was harmless. Now that a
      // conversation is played to its real end, leave deliberately.
      const logout = replies.findIndex((reply) =>
        /^log out/i.test(String(reply).trim().replace(/^\d+\.\s*/, '')));
      if (logout >= 0) return logout;
      throw new Error(`${label}: required console sequence is complete but no 'Log out.' was ` +
        `offered; replies=${JSON.stringify(replies)}`);
    }
    const index = chooseRequiredDialogueScript(replies, snapshot, scriptNames[nextScriptIndex], label);
    nextScriptIndex += 1;
    return index;
  };
  choose.assertCompleted = () => {
    if (nextScriptIndex !== scriptNames.length) {
      throw new Error(`${label}: completed ${nextScriptIndex}/${scriptNames.length} required console actions`);
    }
  };
  return choose;
}

/**
 * Builds a medical-log route selector for one console interaction sequence.
 *
 * The Peragus terminal records each log through a distinct a_setmedlog script,
 * then exposes a_setmor after the relevant history. Re-selecting the first log
 * is valid UI input but cannot advance the quest, so retain only this local
 * conversation history while always preferring the authored unlock action.
 */
function createMorgueUnlockChooser() {
  const selectedLogScripts = new Set();
  let returnedToMainConsole = false;
  let unlockedMorgue = false;
  const findByText = (replies, pattern) => replies.findIndex((reply) =>
    pattern.test(String(reply).trim().replace(/^\d+\.\s*/, '')));
  return (replies, snapshot) => {
    const scripts = Array.isArray(snapshot && snapshot.replyScripts) ? snapshot.replyScripts : [];
    const unlockIndex = scripts.findIndex((script) => String(script).toLowerCase() === 'a_setmor');
    if (unlockIndex >= 0 && unlockIndex < replies.length) {
      unlockedMorgue = true;
      return unlockIndex;
    }

    // a_setmor is only offered one level down, behind "Access medical bay
    // functions." — medlog.dlg reaches it as entry 0 -> reply 1 -> entry 1 ->
    // reply 6. The old fallback of reply 0 took the medical LOGS branch
    // instead, so the doors menu was never reached, the Morgue Door stayed
    // locked, and the prologue stopped there. The console does not reliably
    // reopen for a second visit, so the unlock has to be taken on this one.
    if (!unlockedMorgue) {
      const functionsIndex = findByText(replies, /^access medical bay functions/i);
      if (functionsIndex >= 0) return functionsIndex;
    }

    const unseenLogIndex = scripts.findIndex((script, index) => {
      const normalizedScript = String(script).toLowerCase();
      return index < replies.length && /^a_setmedlog\d+$/.test(normalizedScript) &&
        !selectedLogScripts.has(normalizedScript);
    });
    if (unseenLogIndex >= 0) {
      selectedLogScripts.add(String(scripts[unseenLogIndex]).toLowerCase());
      return unseenLogIndex;
    }

    if (!returnedToMainConsole && selectedLogScripts.size >= 3) {
      const mainConsoleIndex = replies.findIndex((reply) => /access main console options/i.test(String(reply)));
      if (mainConsoleIndex >= 0) {
        returnedToMainConsole = true;
        return mainConsoleIndex;
      }
    }
    // Objective met: leave deliberately rather than falling to reply 0, which
    // on the post-unlock menu just re-enters a submenu and can cycle.
    if (unlockedMorgue) {
      const logoutIndex = findByText(replies, /^log out/i);
      if (logoutIndex >= 0) return logoutIndex;
    }
    return 0;
  };
}

/** Returns the action-script names for the same replies the dialogue GUI displays. */
function getDisplayedReplyScriptNames(replies) {
  if (!Array.isArray(replies)) return [];
  return replies
    .filter((reply) => !reply || !reply.isContinueDialog || !reply.isContinueDialog())
    .map((reply) => String(reply && reply.script && reply.script.name || ''));
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
 * A snapshot of the live conversation rendered by a dialogue-capable menu.
 *
 * `ConversationState`: -1 INVALID, 0 LISTENING_TO_SPEAKER, 1 WAITING_FOR_PC_CHOICE,
 * 2 CONTINUE_DIALOG, 3 END_DIALOG. Reported numerically and by name, so a
 * renumbered enum shows up as a changed name rather than as "no dialogue".
 */
async function dialogueSnapshot(harness, menuName = 'InGameDialog') {
  return harness.evaluate(`(() => {
    const getDisplayedReplyScriptNames = ${getDisplayedReplyScriptNames.toString()};
    const K = window.KotOR;
    const gs = K.GameState;
    const menus = gs.MenuManager;
    const dialog = menus && menus[${JSON.stringify(menuName)}];
    const cm = gs.CutsceneManager;
    if (!dialog) return { located: false, reason: 'no ' + ${JSON.stringify(menuName)} };
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
    // currentEntry.replies contains DLG links. The GUI and
    // CutsceneManager.selectReplyAtIndex() operate on the resolved target
    // nodes in currentReplies; only those nodes carry authored action
    // scripts such as a_setmor.
    const replyScripts = getDisplayedReplyScriptNames(cm.currentReplies);
    return {
      located: true,
      visible,
      engineMode: gs.Mode,
      state: cm.state,
      stateName: ['LISTENING_TO_SPEAKER', 'WAITING_FOR_PC_CHOICE', 'CONTINUE_DIALOG', 'END_DIALOG'][cm.state] ||
        (cm.state === -1 ? 'INVALID' : 'UNKNOWN:' + cm.state),
      repliesShown: dialog.LB_REPLIES ? dialog.LB_REPLIES.isVisible && dialog.LB_REPLIES.isVisible() : null,
      replies,
      replyScripts,
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
async function playDialogue(harness, {
  choose,
  maxTurns = 200,
  label = 'dialogue',
  menuName = 'InGameDialog',
} = {}) {
  const transcript = [];
  let idleTurns = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const snapshot = await dialogueSnapshot(harness, menuName);
    if (!snapshot.located) throw new Error(`${label}: ${snapshot.reason}`);
    if (!snapshot.visible) {
      // "Menu not visible" is not "conversation over". An authored camera shot
      // hides the dialogue menu while the conversation is still live with a
      // reply pending — the Peragus arrival opens on
      // "{camera 33}{wide shot of kolto tanks}" exactly like this. Returning
      // finished there left the engine in DIALOG mode with gameplay input
      // suppressed and every later walk reporting "unreachable".
      if (snapshot.engineMode !== ENGINE_MODE_DIALOG) {
        return { finished: true, turns: turn, transcript };
      }
      await harness.evaluate(
        `(() => { const cm = window.KotOR.GameState.CutsceneManager;
          try { cm.playerSkipEntry(cm.currentEntry); } catch (e) {} return true; })()`,
      );
      idleTurns += 1;
      if (idleTurns > 60) {
        throw new Error(`${label}: engine held DIALOG mode for ${idleTurns} turns with the ` +
          `${menuName} menu hidden; conversation=${snapshot.conversationName} ` +
          `lastSpoken=${JSON.stringify(snapshot.spoken || null)}`);
      }
      await sleep(500);
      continue;
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
      transcript.push(`> [${index}] ${snapshot.replies[index] ?? '<no rendered row>'}` +
        ` [script=${snapshot.replyScripts && snapshot.replyScripts[index] || '(none)'}]`);
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

/** Completes an authored interruption before reapplying immersive locomotion. */
async function clearProgressBlockingDialogue(harness, label) {
  const state = await worldState(harness);
  const stack = Array.isArray(state.menuStack) ? state.menuStack : [];
  // Search the whole stack, and treat DIALOG engine mode as authoritative.
  // A conversation menu routinely sits *under* InGameOverlay: the foreground
  // menu then looks innocent while the engine stays in mode 3, gameplay input
  // is suppressed, and every destination reports "unreachable" with no error
  // anywhere. Testing only the foreground menu missed exactly that, twice —
  // at the Communications Console and again at the Peragus medical logs.
  const blocking = PROGRESS_BLOCKING_MENUS.find((name) =>
    state.foregroundMenu === name || stack.includes(name));
  if (!blocking && state.engineMode !== ENGINE_MODE_DIALOG) return null;

  let played = null;
  if (blocking) {
    // Play it through the menu actually carrying it: driving InGameDialog
    // while InGameComputer holds the conversation reads "not visible" and
    // returns finished immediately.
    played = await playDialogue(harness, {
      label: `${label} interruption`,
      menuName: blocking,
      maxTurns: 90,
    });
    if (!played.finished) {
      throw new Error(`${label}: dialogue interruption did not finish`);
    }
    line(`  · ${label}: completed ${played.turns}-turn ${blocking} interruption`);
  }

  // Closing the menu is not the same as ending the conversation. A console
  // conversation that is still live in CutsceneManager reopens InGameComputer
  // on the next frame and holds the engine in DIALOG mode, so the driver
  // logged "closed [InGameComputer] (engineMode=3)" thirty times in a row
  // while the player stood still. End it the way the engine does.
  const after = await worldState(harness);
  if (after.engineMode !== 1) {
    const ended = await harness.evaluate(`(() => {
      const cm = window.KotOR.GameState.CutsceneManager;
      if (!cm) return { located: false, reason: 'no CutsceneManager' };
      const wasActive = cm.active === true || !!cm.dialog;
      if (!wasActive) return { located: true, wasActive: false };
      try { cm.endConversation(true); } catch (error) {
        return { located: true, wasActive: true, ended: false, reason: String(error && error.message || error) };
      }
      return { located: true, wasActive: true, ended: true };
    })()`);
    if (ended.located && ended.wasActive) {
      line(`  · ${label}: ended a conversation still live in CutsceneManager ${JSON.stringify(ended)}`);
    }
    await returnToGameplay(harness);
    const restored = await worldState(harness);
    if (restored.engineMode !== 1) {
      throw new Error(`${label}: engine stayed in mode ${restored.engineMode} after ending the conversation; ` +
        `foreground=${restored.foregroundMenu} stack=${JSON.stringify(restored.menuStack)}`);
    }
  }
  return played;
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
        position: o.position ? {
          x: +o.position.x.toFixed(2),
          y: +o.position.y.toFixed(2),
          z: +o.position.z.toFixed(2),
        } : null,
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
 * Performs one explicit, authored mine outcome through the VR action wheel.
 *
 * Disarm and Recover are deliberately mutually exclusive: either destroys the
 * trap, but only Recover returns the mine item. Keeping that distinction in one
 * helper prevents a run from trying to Recover a mine already removed by Disarm.
 */
async function resolveExteriorMine(harness, { mine, actionLabel }) {
  if (!mine || !Number.isInteger(mine.id) || !mine.position) {
    throw new TypeError('mine must include an integer id and a world position');
  }
  if (actionLabel !== 'Disarm' && actionLabel !== 'Recover') {
    throw new TypeError('mine action must be exactly Disarm or Recover');
  }

  const before = await describeInventory(harness);
  if (!before.located) throw new Error(`mine inventory before action: ${before.reason || 'player not located'}`);
  // Retry the approach, and let the mine prompt decide when we are close
  // enough. Arriving from the Utility Lift puts T3 on a raised platform above
  // the hull, and the descent to a mine is where a single approach most often
  // stops a few metres out.
  let prompts = null;
  for (let approach = 1; approach <= 4; approach += 1) {
    try {
      await navigateTo(harness, {
        x: mine.position.x,
        y: mine.position.y,
        z: mine.position.z,
        range: 1.5,
        label: `Frag Mine, Minor (${actionLabel})`,
        maxAttempts: 3,
        permittedDoorPromptIds: [],
      });
    } catch (error) {
      if (approach === 4) throw error;
      line(`  · mine approach ${approach} fell short (${String(error.message).slice(0, 70)})`);
    }
    await sleep(800);
    prompts = await listWorldPrompts(harness);
    const near = (prompts.prompts || []).find((prompt) =>
      prompt.id === `module-object:${mine.id}` && prompt.inRange === true);
    if (near) break;
  }

  const minePrompt = (prompts.prompts || []).find((prompt) =>
    prompt.id === `module-object:${mine.id}` && /frag mine/i.test(String(prompt.name || '')) && prompt.inRange);
  if (!minePrompt || !Array.isArray(minePrompt.actions)) {
    throw new Error(`Frag Mine ${mine.id} has no in-range VR prompt: ${JSON.stringify(minePrompt || null)}`);
  }
  chooseExplicitWorldAction(minePrompt.actions, actionLabel, `Frag Mine ${mine.id}`, { allowDestructive: false });
  const activation = await activateWorldAction(harness, { objectId: minePrompt.id, actionLabel });
  await sleep(1200);
  await clearBlockingModal(harness);

  const state = await harness.evaluate(`(() => {
    const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
    const trap = area && (area.triggers || []).find((entry) => entry && entry.id === ${mine.id});
    if (!trap) return { located: false, destroyed: true, willDestroy: true };
    return { located: true, destroyed: trap.destroyed === true, willDestroy: trap.willDestroy === true };
  })()`);
  if (!state.destroyed && !state.willDestroy) {
    throw new Error(`Frag Mine ${mine.id} remained active after ${actionLabel}: ${JSON.stringify(state)}`);
  }

  const after = await describeInventory(harness);
  if (!after.located) throw new Error(`mine inventory after action: ${after.reason || 'player not located'}`);
  if (actionLabel === 'Recover' && after.inventoryCount <= before.inventoryCount) {
    throw new Error(`Recovering Frag Mine ${mine.id} did not add an inventory item (${before.inventoryCount} -> ${after.inventoryCount})`);
  }
  if (actionLabel === 'Disarm' && after.inventoryCount !== before.inventoryCount) {
    throw new Error(`Disarming Frag Mine ${mine.id} unexpectedly changed inventory (${before.inventoryCount} -> ${after.inventoryCount})`);
  }
  return { mine, actionLabel, minePrompt, activation, state, before, after };
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
 * Waits for the already-targeted object's authored action panel to finish its
 * next-frame rebuild. Locomotion can arrive between overlay updates, so an
 * immediate prompt read is transiently empty even though the selected object
 * is in range. The caller still receives only the real action labels.
 */
async function waitForWorldPrompt(harness, promptId, timeoutMs = 5000) {
  if (typeof promptId !== 'string' || promptId.length === 0) {
    throw new TypeError('world prompt id must be a non-empty string');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('world prompt timeout must be a positive integer');
  }

  const deadline = Date.now() + timeoutMs;
  let lastPrompt = null;
  while (Date.now() < deadline) {
    const prompts = await listWorldPrompts(harness);
    const prompt = (prompts.prompts || []).find((candidate) => candidate.id === promptId);
    if (prompt && prompt.inRange && Array.isArray(prompt.actions) && prompt.actions.length > 0) {
      return prompt;
    }
    lastPrompt = prompt || null;
    await sleep(250);
  }
  throw new Error(`world prompt ${promptId} was not ready after ${timeoutMs}ms: ${JSON.stringify(lastPrompt)}`);
}

/**
 * Walks the player with the engine's own ActionMoveToPoint and waits for
 * arrival.
 *
 * Converts a world-space destination into the left-stick axes that produce a
 * head-relative smooth-locomotion vector toward it. `referenceFacing` is the
 * same creature-facing angle used by `LocomotionController`: the stick's
 * positive-Y direction is rotated by this amount before it reaches the avatar.
 *
 * Kept pure because a sign error here looks like a navigation or collision
 * fault, while it is really a harness fault. The browser adapter below supplies
 * the live head-facing angle; this function owns only the coordinate transform.
 */
function computeHeadRelativeMoveAxes({ targetX, targetY, playerX, playerY, referenceFacing }) {
  const values = [targetX, targetY, playerX, playerY, referenceFacing];
  if (!values.every(Number.isFinite)) {
    throw new TypeError('VR navigation requires finite world coordinates and head facing');
  }

  const deltaX = targetX - playerX;
  const deltaY = targetY - playerY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 1e-6) return { x: 0, y: 0, distance: 0 };

  const worldX = deltaX / distance;
  const worldY = deltaY / distance;
  // `LocomotionController` rotates `(axes[0], -axes[1])` by referenceFacing.
  // Rotate the desired world vector back into that input space, then restore
  // the WebXR gamepad's Y sign.
  const rawX = worldX * Math.cos(referenceFacing) + worldY * Math.sin(referenceFacing);
  const rawY = -worldX * Math.sin(referenceFacing) + worldY * Math.cos(referenceFacing);
  return { x: rawX, y: -rawY, distance };
}

/** Converts a normalized world quaternion into the locomotion reference yaw. */
function computeReferenceFacingFromQuaternion({ x, y, z, w }) {
  if (![x, y, z, w].every(Number.isFinite)) {
    throw new TypeError('VR navigation requires a finite world quaternion');
  }
  // Rotate the engine's forward vector (0, 0, -1) by the world quaternion,
  // then flatten it onto KOTOR's XY ground plane.
  const forwardX = -2 * (x * z + w * y);
  const forwardY = -2 * (y * z - w * x);
  if (Math.hypot(forwardX, forwardY) < 1e-10) {
    throw new Error('VR navigation headset forward has no horizontal component');
  }
  const rawFacing = Math.atan2(forwardY, forwardX) - Math.PI / 2;
  return Math.atan2(Math.sin(rawFacing), Math.cos(rawFacing));
}

/**
 * Breaks long or steeply climbing route legs into shorter ones.
 *
 * ModulePath smooths its output, so a ramp can arrive as a single leg — the
 * exterior Utility Lift platform is reached by one 3.4m leg that rises 1.4m.
 * Pushing the stick straight at the far end of such a leg drifts off the
 * ramp and the climb fails, which is why reaching that lift succeeded on one
 * run and stalled 5.7m short on the next. Following the leg in ~1m steps
 * keeps the actor on the authored surface.
 */
const ROUTE_LEG_MAX_LENGTH = 1.0;
const ROUTE_LEG_MAX_RISE = 0.35;

function subdivideRouteLegs(points) {
  if (!Array.isArray(points) || points.length < 2) return points;
  const out = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const run = Math.hypot(to.x - from.x, to.y - from.y);
    const rise = Math.abs((to.z || 0) - (from.z || 0));
    // Only legs that actually climb are split. Subdividing flat ground too
    // turned an ordinary Peragus corridor into 70 legs, each carrying its own
    // arrival wait, and the walk ran out of patience 20m short.
    const steps = rise > ROUTE_LEG_MAX_RISE
      ? Math.max(Math.ceil(run / ROUTE_LEG_MAX_LENGTH), Math.ceil(rise / ROUTE_LEG_MAX_RISE), 1)
      : 1;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      out.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: (from.z || 0) + ((to.z || 0) - (from.z || 0)) * t,
      });
    }
  }
  return out;
}

/**
 * Drives real emulated thumbstick locomotion to a world-space point.
 *
 * In VR the controlled actor intentionally rejects queued `ActionMoveToPoint`
 * approaches: they would drag the headset rig without player input. The old
 * harness used exactly that desktop action and therefore could never move in a
 * live immersive session. This routine instead sends left-stick axes through
 * IWER, the same route a Quest controller uses in the product.
 */
async function moveTo(harness, { x, y, z, range = 1.2, timeoutMs = null, label = 'destination', usePath = true }) {
  // Scale the wait with the distance actually to be covered. A fixed 45s budget
  // was fine across a room and hopeless across 70m of Peragus, so long walks
  // timed out mid-stride and every distant fixture reported "unreachable" —
  // which reads as a broken walkmesh rather than an impatient driver.
  if (timeoutMs === null) {
    const gap = await distanceTo(harness, x, y);
    const metres = Number.isFinite(gap) ? gap : 30;
    timeoutMs = Math.min(120000, Math.max(40000, Math.round(metres * 2500)));
  }
  const started = await harness.evaluate(`(() => {
    const K = window.KotOR;
    const player = K.PartyManager.party[0];
    if (!player) return { ok: false, reason: 'no player' };
    const controller = window.__xrDevice && window.__xrDevice.controllers && window.__xrDevice.controllers.left;
    if (!K.VRSpike || !K.VRSpike.isPresenting) return { ok: false, reason: 'immersive session is not presenting' };
    if (!controller || typeof controller.updateAxes !== 'function') return { ok: false, reason: 'emulated left thumbstick is unavailable' };
    return { ok: true, from: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2) } };
  })()`);
  if (!started.ok) throw new Error(`moveTo ${label}: ${started.reason}`);

  if (usePath) {
    // Compute, but never queue, the engine's walkmesh route. The returned
    // points are then traversed by real emulated thumbstick input below. This
    // retains VR ownership of the avatar while avoiding a straight-stick line
    // that stops at the first wall.
    const planned = await harness.evaluate(`(() => {
      const K = window.KotOR;
      const player = K.PartyManager.party[0];
      const area = K.GameState.module && K.GameState.module.area;
      if (!player || !area || !area.path || typeof area.path.traverseToPoint !== 'function') {
        return { ok: false, reason: 'walkmesh path service unavailable' };
      }
      try {
        const destination = player.position.clone().set(${Number(x)}, ${Number(y)}, ${Number(z)});
        const path = area.path.traverseToPoint(player, player.position.clone(), destination, true);
        path.fixWalkEdges(player.getHitDistance());
        const points = (path.points || []).map((point) => ({
          x: point.vector.x, y: point.vector.y, z: point.vector.z,
        })).filter((point) => [point.x, point.y, point.z].every(Number.isFinite));
        path.dispose();
        return { ok: true, points };
      } catch (error) {
        return { ok: false, reason: String(error && error.message || error) };
      }
    })()`, { timeoutMs: 60000 });
    if (!planned.ok) throw new Error(`moveTo ${label}: ${planned.reason}`);
    if (planned.points.length > 1) {
      planned.points = subdivideRouteLegs(planned.points);
      line(`  · ${label}: following ${planned.points.length} walkmesh waypoints by thumbstick`);
      line(`  · ${label}: walkmesh points ${JSON.stringify(planned.points.map((point) => ({
        x: +point.x.toFixed(2), y: +point.y.toFixed(2), z: +point.z.toFixed(2),
      })))}`);
      for (let index = 0; index < planned.points.length; index += 1) {
        const waypoint = planned.points[index];
        await moveTo(harness, {
          ...waypoint,
          // fixWalkEdges offsets intermediate points by the creature hit
          // radius. Give those legs a small extra margin; requiring a player
          // to land inside the wall-facing edge made an otherwise-complete
          // 1.34 m leg fail a 1.30 m acceptance threshold.
          range: index === planned.points.length - 1 ? range : INTERMEDIATE_WAYPOINT_RANGE,
          timeoutMs: null,
          label: `${label} waypoint ${index + 1}/${planned.points.length}`,
          usePath: false,
        });
      }
      // Finish directly. The planner's last waypoint is not the target: smooth()
      // maps every sample through getNearestWalkablePoint, and a wall-mounted
      // object like the Security Console does not stand on the walkmesh at all,
      // so its route ended six metres away and the object stayed out of
      // interaction range. Walking the planned route gets past the geometry;
      // the last few metres are a straight line by definition.
      return moveTo(harness, {
        x, y, z, range,
        label: `${label} final approach`,
        usePath: false,
        timeoutMs: 30000,
      });
    }
  }

  // Poll rather than one long waitFor: a confirmation modal suspends gameplay,
  // so the stick must be released before the modal is handled and re-applied
  // afterward. Holding an input through a menu would test neither locomotion
  // nor the menu boundary honestly.
  const deadline = Date.now() + timeoutMs;
  let arrived = false;
  let lastNavigation = null;
  let stalledSamples = 0;
  try {
    while (Date.now() < deadline) {
      await harness.evaluate(`(() => {
        const controller = window.__xrDevice && window.__xrDevice.controllers && window.__xrDevice.controllers.left;
        if (controller && typeof controller.updateAxes === 'function') controller.updateAxes('thumbstick', 0, 0);
      })()`);
      await clearBlockingModal(harness);
      await clearProgressBlockingDialogue(harness, label);
      const navigation = await harness.evaluate(`(() => {
        const player = window.KotOR.PartyManager.party[0];
        const rig = window.KotOR.VRSpike && window.KotOR.VRSpike.rig;
        const headset = window.__xrDevice && window.__xrDevice.quaternion;
        if (!player || !rig || !rig.quaternion || !headset) return { ok: false, reason: 'player, rig, or headset pose unavailable' };
        const a = rig.quaternion;
        const b = headset;
        const qx = a.x * b.w + a.y * b.z - a.z * b.y + a.w * b.x;
        const qy = -a.x * b.z + a.y * b.w + a.z * b.x + a.w * b.y;
        const qz = a.x * b.y - a.y * b.x + a.z * b.w + a.w * b.z;
        const qw = -a.x * b.x - a.y * b.y - a.z * b.z + a.w * b.w;
        const referenceFacing = (${computeReferenceFacingFromQuaternion.toString()})({ x: qx, y: qy, z: qz, w: qw });
        const dx = player.position.x - ${Number(x)};
        const dy = player.position.y - ${Number(y)};
        return {
          ok: Number.isFinite(referenceFacing),
          reason: Number.isFinite(referenceFacing) ? null : 'headset facing is not finite',
          playerX: player.position.x,
          playerY: player.position.y,
          referenceFacing,
          remaining: Math.sqrt(dx * dx + dy * dy),
          queued: (player.actionQueue || []).length,
        };
      })()`);
      if (!navigation.ok) throw new Error(navigation.reason);
      // Nudge a walk that has stopped dead. An authored conversation can
      // interrupt mid-leg and leave gameplay input suppressed after it ends;
      // the stick then pushes against a suspended engine for the whole
      // timeout and the leg reports "stopped Nm short" having never moved at
      // all. Re-asserting gameplay is cheap and idempotent.
      if (lastNavigation && Math.abs(lastNavigation.remaining - navigation.remaining) < 0.05) {
        stalledSamples += 1;
        if (stalledSamples === 6) {
          line();
          await returnToGameplay(harness);
        }
      } else {
        stalledSamples = 0;
      }
      lastNavigation = navigation;
      if (navigation.remaining <= Number(range) + 0.6) {
        arrived = true;
        break;
      }
      const axes = computeHeadRelativeMoveAxes({
        targetX: Number(x), targetY: Number(y),
        playerX: navigation.playerX, playerY: navigation.playerY,
        referenceFacing: navigation.referenceFacing,
      });
      await harness.evaluate(`(() => {
        const controller = window.__xrDevice.controllers.left;
        controller.updateAxes('thumbstick', ${axes.x}, ${axes.y});
        return true;
      })()`);
      // A long fixed sample can carry the player into a hull edge before the
      // next head-relative correction. Keep broad traversal inexpensive but
      // steer tightly around authored walkmesh corners with real, finer-grain
      // thumbstick samples.
      const inputSampleMs = navigation.remaining <= 3 ? 180 : navigation.remaining <= 8 ? 350 : 900;
      await sleep(inputSampleMs);
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
        canMove: typeof player.canMove === 'function' ? player.canMove() : null,
        controlled: player.controlled === true,
        animation: player.animationState ? player.animationState.index : null,
        casting: Array.isArray(player.casting) ? player.casting.length : null,
        party: (window.KotOR.PartyManager.party || []).map((member, index) => ({
          index,
          name: member && member.getName ? String(member.getName() || '') : null,
          npcId: member ? member.npcId : null,
          canMove: member && typeof member.canMove === 'function' ? member.canMove() : null,
        })),
      };
    })()`);
    throw new Error(`moveTo ${label}: did not arrive — ${JSON.stringify({ ...where, navigation: lastNavigation })}`);
  } finally {
    await harness.evaluate(`(() => {
      const controller = window.__xrDevice && window.__xrDevice.controllers && window.__xrDevice.controllers.left;
      if (controller && typeof controller.updateAxes === 'function') controller.updateAxes('thumbstick', 0, 0);
    })()`).catch(() => undefined);
  }

  return harness.evaluate(`(() => {
    const player = window.KotOR.PartyManager.party[0];
    return { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), z: +player.position.z.toFixed(2) };
  })()`);
}

/**
 * Reads the engine's candidate walkmesh route without sending input, queueing
 * an action, or changing the world. This is diagnostic evidence for a route
 * that may cross an authored plot lock.
 */
async function describeWalkmeshRoute(harness, { x, y, z, label = 'destination' }) {
  if (![x, y, z].every(Number.isFinite)) throw new TypeError('walkmesh route requires finite coordinates');
  if (typeof label !== 'string' || label.trim().length === 0) throw new TypeError('walkmesh route label must be non-empty');
  const planned = await harness.evaluate(`(() => {
    const K = window.KotOR;
    const player = K.PartyManager.party[0];
    const area = K.GameState.module && K.GameState.module.area;
    if (!player || !area || !area.path || typeof area.path.traverseToPoint !== 'function') {
      return { ok: false, reason: 'walkmesh path service unavailable' };
    }
    let path = null;
    try {
      const destination = player.position.clone().set(${Number(x)}, ${Number(y)}, ${Number(z)});
      path = area.path.traverseToPoint(player, player.position.clone(), destination, true);
      path.fixWalkEdges(player.getHitDistance());
      return {
        ok: true,
        points: (path.points || []).map((point) => ({
          x: point.vector.x, y: point.vector.y, z: point.vector.z,
        })).filter((point) => [point.x, point.y, point.z].every(Number.isFinite)),
      };
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error) };
    } finally {
      if (path && typeof path.dispose === 'function') path.dispose();
    }
  })()`, { timeoutMs: 60000 });
  if (!planned.ok) throw new Error(`walkmesh route ${label}: ${planned.reason}`);
  return planned.points;
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

    // InGameConfirm carries its text in LB_MESSAGE, a GUIListBox, NOT in any
    // LBL_ control. An earlier version of this probe scanned only LBL_ keys,
    // found nothing, and reported message:null — which read as "a modal with no
    // text" when the real reading was "this probe cannot see the message".
    // Report which route produced the text, and say so when none did.
    let message = null;
    let messageSource = 'none';
    try {
      const box = confirm.LB_MESSAGE;
      if (box && Array.isArray(box.listItems) && box.listItems.length) {
        const text = box.listItems
          .map((item) => (typeof item === 'string' ? item : (item && item.text) || ''))
          .filter((entry) => String(entry).trim())
          .join(' | ');
        if (text.trim()) { message = text.trim().slice(0, 400); messageSource = 'LB_MESSAGE.listItems'; }
      }
      if (message === null && box && Array.isArray(box.children)) {
        const text = box.children
          .map((child) => (child && child.text && typeof child.text.text === 'string' ? child.text.text : ''))
          .filter((entry) => entry.trim()).join(' | ');
        if (text.trim()) { message = text.trim().slice(0, 400); messageSource = 'LB_MESSAGE.children'; }
      }
      if (message === null) {
        for (const key of Object.keys(confirm)) {
          if (!/^LBL_/.test(key)) continue;
          const control = confirm[key];
          const text = control && control.text && typeof control.text.text === 'string'
            ? control.text.text : null;
          if (text && text.trim()) { message = text.trim().slice(0, 400); messageSource = key; break; }
        }
      }
      if (message === null) messageSource = 'LB_MESSAGE present but empty: ' + !!box;
    } catch (e) { message = '<unreadable>'; messageSource = String(e && e.message || e); }

    const ok = confirm.BTN_OK;
    if (!ok) return { present: true, message, messageSource, dismissed: false, reason: 'no BTN_OK' };
    try { ok.click(); } catch (error) {
      return { present: true, message, messageSource, dismissed: false, reason: String(error && error.message || error) };
    }
    return { present: true, message, messageSource, dismissed: true };
  })()`);
  if (outcome.present) {
    line(`  · confirm modal ${outcome.dismissed ? 'accepted' : 'NOT dismissed'}: ` +
      `${outcome.message || `<no text found via ${outcome.messageSource}>`}` +
      (outcome.reason ? ` (${outcome.reason})` : ''));
  }
  return outcome;
}

/**
 * Reports the Galaxy Map's own decision inputs.
 *
 * MenuGalaxyMap.BTN_ACCEPT branches on exactly three things: the active
 * planet's `selectable` flag, its `lockedOutReason`, and whether its id already
 * equals `Planetary.selectedIndex`. Two of those three branches raise a modal
 * instead of travelling, and the modal alone cannot tell them apart. Read the
 * inputs rather than inferring them from the symptom.
 */
async function galaxyMapState(harness) {
  return harness.evaluate(`(() => {
    const K = window.KotOR;
    const menus = K.GameState.MenuManager;
    const menu = menus && menus.MenuGalaxyMap;
    const Planetary = K.Planetary;
    if (!menu) return { located: false, reason: 'MenuGalaxyMap is not registered on MenuManager' };
    if (!Planetary || !Array.isArray(Planetary.planets)) {
      return { located: false, reason: 'Planetary.planets is unavailable' };
    }
    const describe = (planet) => planet ? {
      id: planet.id,
      label: planet.label,
      guitag: planet.guitag,
      enabled: planet.enabled,
      selectable: planet.selectable,
      lockedOutReason: planet.lockedOutReason,
    } : null;
    const active = menu.activePlanet;
    return {
      located: true,
      visible: menu.bVisible === true,
      selectedIndex: Planetary.selectedIndex,
      selected: describe(Planetary.selected),
      activePlanet: describe(active),
      // The branch BTN_ACCEPT will take, computed the same way the handler does.
      branch: !active ? 'no-active-planet'
        : !active.selectable ? (active.lockedOutReason >= 0 ? 'locked-out-modal' : 'silently-does-nothing')
        : active.id == Planetary.selectedIndex ? 'already-at-location-modal'
        : 'runs-k_sup_galaxymap',
      planets: Planetary.planets.map(describe),
      currentPlanetGlobal: (() => {
        try { return K.GameState.GlobalVariableManager.GetGlobalNumber('K_CURRENT_PLANET'); }
        catch (e) { return 'unreadable: ' + String(e && e.message || e); }
      })(),
      scriptLoaded: !!menu.script,
    };
  })()`);
}

/**
 * Locates a live object by tag, so a walkthrough reads by name rather than by
 * object id — ids shift between saves, tags do not.
 */
/**
 * Reads one named global NUMBER, and says whether the variable exists at all.
 *
 * A missing global and a global holding 0 read identically through
 * GetGlobalNumber, and the prologue's gate is exactly such a value
 * (`001EBO_HyperDrive`), so "absent" and "not yet set" have to be
 * distinguishable in the log.
 */
async function readGlobalNumber(harness, name) {
  return harness.evaluate(`(() => {
    const manager = window.KotOR.GameState.GlobalVariableManager;
    if (!manager) return { located: false, reason: 'no GlobalVariableManager' };
    const table = manager.Globals && manager.Globals.Number;
    const key = ${JSON.stringify(String(name))};
    const declared = table instanceof Map
      ? Array.from(table.values()).some((entry) => entry &&
          String(entry.name || '').toLowerCase() === key.toLowerCase())
      : null;
    let value = null;
    try { value = manager.GetGlobalNumber(key); }
    catch (error) { return { located: false, reason: String(error && error.message || error) }; }
    return { located: true, name: key, value, declared };
  })()`);
}

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

/**
 * Selects an exact non-destructive action from a live prompt.
 *
 * A walkthrough must never silently substitute Bash or Attack when a required
 * authored use action disappeared. Such a substitution can advance the module
 * while concealing the VR interaction regression we are trying to detect.
 */
function chooseRequiredWorldAction(actions, pattern, objectName = 'object') {
  if (!Array.isArray(actions) || actions.some((action) => typeof action !== 'string')) {
    throw new TypeError(`${objectName}: actions must be an array of strings`);
  }
  if (!(pattern instanceof RegExp)) throw new TypeError(`${objectName}: action pattern must be a RegExp`);
  const action = actions.find((candidate) => {
    pattern.lastIndex = 0;
    return pattern.test(candidate);
  });
  if (!action) {
    throw new Error(`${objectName}: required action ${pattern} was not offered; got ${JSON.stringify(actions)}`);
  }
  if (/^(bash|attack)$/i.test(action.trim())) {
    throw new Error(`${objectName}: required-action pattern selected destructive action ${JSON.stringify(action)}`);
  }
  return action;
}

/**
 * Selects one exact, explicitly approved world action. Destructive labels are
 * rejected unless the caller intentionally opts in for a known authored route.
 */
function chooseExplicitWorldAction(actions, actionLabel, objectName = 'object', { allowDestructive = false } = {}) {
  if (!Array.isArray(actions) || actions.some((action) => typeof action !== 'string')) {
    throw new TypeError(`${objectName}: actions must be an array of strings`);
  }
  if (typeof actionLabel !== 'string' || actionLabel.trim().length === 0) {
    throw new TypeError(`${objectName}: actionLabel must be a non-empty string`);
  }
  if (typeof allowDestructive !== 'boolean') throw new TypeError(`${objectName}: allowDestructive must be boolean`);
  const expected = actionLabel.trim().toLowerCase();
  const action = actions.find((candidate) => candidate.trim().toLowerCase() === expected);
  if (!action) throw new Error(`${objectName}: required action ${JSON.stringify(actionLabel)} was not offered; got ${JSON.stringify(actions)}`);
  if (/^(bash|attack)$/i.test(action.trim()) && !allowDestructive) {
    throw new Error(`${objectName}: destructive action ${JSON.stringify(action)} requires explicit approval`);
  }
  return action;
}

/** Returns the total stack quantity for an exact inventory display name. */
function inventoryQuantityByName(inventory, itemName) {
  if (!Array.isArray(inventory)) throw new TypeError('inventory must be an array');
  if (typeof itemName !== 'string' || itemName.trim().length === 0) {
    throw new TypeError('itemName must be a non-empty string');
  }
  const expected = itemName.trim().toLowerCase();
  return inventory.reduce((total, item) => {
    if (!item || typeof item !== 'object' || String(item.name || '').trim().toLowerCase() !== expected) return total;
    const quantity = Number(item.stack);
    return total + (Number.isInteger(quantity) && quantity > 0 ? quantity : 1);
  }, 0);
}

/**
 * Opens a world container through its exact VR action and transfers its Parts
 * stack into the shared party inventory. The check is intentionally based on
 * the post-transfer quantity rather than the menu click alone: a visible
 * container or accepted click is not evidence that an item reached the party.
 */
async function recoverPartsFromWorldContainer(harness, {
  tag,
  objectName,
  actionLabel,
  minimumParts = null,
}) {
  if (typeof tag !== 'string' || tag.trim().length === 0) throw new TypeError('tag must be a non-empty string');
  if (typeof objectName !== 'string' || objectName.trim().length === 0) throw new TypeError('objectName must be a non-empty string');
  if (typeof actionLabel !== 'string' || actionLabel.trim().length === 0) throw new TypeError('actionLabel must be a non-empty string');
  if (minimumParts !== null && (!Number.isInteger(minimumParts) || minimumParts < 1)) {
    throw new TypeError('minimumParts must be a positive integer or null');
  }

  const target = (await findObjectByTag(harness, tag)).sort((left, right) => left.distance - right.distance)[0];
  if (!target || !target.position) throw new Error(`${objectName} target is unavailable: ${JSON.stringify(target || null)}`);
  await navigateTo(harness, {
    x: target.position.x,
    y: target.position.y,
    z: target.position.z,
    range: 1.5,
    label: objectName,
    maxAttempts: 3,
    permittedDoorPromptIds: [],
  });
  const prompt = await waitForWorldPrompt(harness, target.promptId);
  const action = chooseExplicitWorldAction(prompt.actions, actionLabel, objectName, { allowDestructive: false });
  const before = await describeInventory(harness);
  const activation = await activateWorldAction(harness, { objectId: target.promptId, actionLabel: action });
  await sleep(1500);
  const openedContainer = await harness.evaluate(`(() => {
    const menu = window.KotOR.GameState.MenuManager.MenuContainer;
    const nameOf = (item) => {
      try { return String((item && item.getName && item.getName()) || item?.tag || 'item'); }
      catch (error) { return '<unreadable>'; }
    };
    const inventory = menu && menu.container && Array.isArray(menu.container.inventory)
      ? menu.container.inventory.map((item) => ({ name: nameOf(item), stack: item && item.stackSize })) : null;
    return { visible: !!(menu && menu.bVisible), inventory };
  })()`);
  if (!openedContainer.visible || !Array.isArray(openedContainer.inventory) || openedContainer.inventory.length === 0) {
    throw new Error(`${objectName} opened no recoverable Parts: ${JSON.stringify(openedContainer)}`);
  }
  const transferred = await harness.evaluate(`(() => {
    const menu = window.KotOR.GameState.MenuManager.MenuContainer;
    if (!menu || menu.bVisible !== true || !menu.container || !Array.isArray(menu.container.inventory)) {
      return { ok: false, reason: 'container is unavailable' };
    }
    const parts = menu.container.inventory.find((item) => {
      try { return /parts/i.test(String((item && item.getName && item.getName()) || item?.tag || '')); }
      catch (error) { return false; }
    });
    if (!parts) return { ok: false, reason: 'container has no Parts item' };
    try {
      menu.LB_ITEMS.select(parts);
      menu.BTN_OK.click();
      return { ok: true, transferredStack: parts.getStackSize ? parts.getStackSize() : parts.stackSize };
    } catch (error) {
      return { ok: false, reason: String(error && error.message || error) };
    }
  })()`);
  if (!transferred.ok) throw new Error(`${objectName} Parts transfer failed: ${transferred.reason}`);
  await sleep(3000);
  const after = await describeInventory(harness);
  const partsBefore = inventoryQuantityByName(before.inventory, 'Parts');
  const partsAfter = inventoryQuantityByName(after.inventory, 'Parts');
  if (partsAfter <= partsBefore) throw new Error(`${objectName} Get Items did not add Parts (${partsBefore} -> ${partsAfter})`);
  if (minimumParts !== null && partsAfter < minimumParts) {
    throw new Error(`${objectName} left insufficient Parts for travel (${partsAfter} < ${minimumParts})`);
  }
  return { target, prompt, activation, before, openedContainer, transferred, after, partsBefore, partsAfter };
}

/** Walk to a stable tagged target and execute its explicitly required VR action. */
async function useTaggedWorldObject(harness, {
  tag,
  actionPattern,
  actionLabel,
  allowDestructive = false,
  range = 1.6,
  maxAttempts = 4,
  usePath = true,
  permittedDoorPromptIds = null,
  targetId = null,
}) {
  if (typeof tag !== 'string' || tag.trim().length === 0) throw new TypeError('tag must be a non-empty string');
  if ((actionPattern instanceof RegExp) === (typeof actionLabel === 'string')) {
    throw new TypeError('provide exactly one of actionPattern or actionLabel');
  }
  if (!(actionPattern instanceof RegExp) && typeof actionLabel !== 'string') {
    throw new TypeError('actionPattern must be a RegExp or actionLabel must be a string');
  }
  if (typeof allowDestructive !== 'boolean') throw new TypeError('allowDestructive must be boolean');
  if (!Number.isFinite(range) || range <= 0) throw new TypeError('range must be a positive finite number');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('maxAttempts must be a positive integer');
  if (typeof usePath !== 'boolean') throw new TypeError('usePath must be boolean');
  if (permittedDoorPromptIds !== null &&
      (!Array.isArray(permittedDoorPromptIds) || permittedDoorPromptIds.some((id) => typeof id !== 'string' || id.trim().length === 0))) {
    throw new TypeError('permittedDoorPromptIds must be null or an array of non-empty strings');
  }
  if (targetId !== null && (!Number.isInteger(targetId) || targetId < 0)) {
    throw new TypeError('targetId must be null or a non-negative integer');
  }

  const matches = (await findObjectByTag(harness, tag)).sort((left, right) => left.distance - right.distance);
  const target = targetId === null ? matches[0] : matches.find((candidate) => candidate.id === targetId);
  if (!target) {
    throw new Error(`${tag}: target id ${targetId} was not found; candidates=${JSON.stringify(matches.map((candidate) => candidate.id))}`);
  }
  // Walk, then check the prompt, and retry the pair. A single approach that
  // stops a few metres out is common on long routes and leaves the object
  // out of interaction range; the prompt is the authority on whether we are
  // close enough, so keep walking until it says yes.
  let prompts = null;
  let offered = null;
  for (let approach = 1; approach <= 3; approach += 1) {
    try {
      await navigateTo(harness, {
        x: target.position.x,
        y: target.position.y,
        z: target.position.z,
        range,
        label: target.name || target.tag,
        maxAttempts,
        usePath,
        permittedDoorPromptIds,
      });
    } catch (error) {
      if (approach === 3) throw error;
      line(`  · ${target.name || tag}: approach ${approach} fell short (${String(error.message).slice(0, 70)})`);
    }
    await sleep(800);
    prompts = await listWorldPrompts(harness);
    if (!prompts.located) throw new Error(`${target.name || tag}: VR prompt context unavailable: ${prompts.reason}`);
    offered = (prompts.prompts || []).find((prompt) => prompt.id === target.promptId);
    if (offered && offered.inRange === true && Array.isArray(offered.actions)) break;
  }
  if (!offered || offered.inRange !== true || !Array.isArray(offered.actions)) {
    throw new Error(`${target.name || tag}: no in-range VR actions: ${JSON.stringify(offered || null)}`);
  }
  const action = actionPattern instanceof RegExp
    ? chooseRequiredWorldAction(offered.actions, actionPattern, target.name || tag)
    : chooseExplicitWorldAction(offered.actions, actionLabel, target.name || tag, { allowDestructive });
  const activation = await activateWorldAction(harness, { objectId: target.promptId, actionLabel: action });
  const container = await resolveOpenedContainer(harness);
  return { target, action, activation, container, after: await worldState(harness) };
}

/**
 * Bashes a locked container until it actually breaks, then takes what it held.
 *
 * One Bash queues one attack. The Spike Footlocker has 10 HP and takes several
 * rounds of T3's Mining Laser, so reading the inventory straight after the
 * first swing showed no spikes and read as "Bash does not work" — it does, it
 * just had not finished yet.
 */
async function bashOpenPlaceable(harness, { tag, maxRounds = 12, roundMs = 3500 }) {
  if (typeof tag !== 'string' || !tag.trim()) throw new TypeError('tag must be a non-empty string');
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new TypeError('maxRounds must be a positive integer');

  const first = await useTaggedWorldObject(harness, {
    tag, actionLabel: 'Bash', allowDestructive: true,
  });
  const targetId = first.target.id;
  const readTarget = `(() => {
    const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
    const object = area && (area.placeables || []).find((entry) => entry && entry.id === ${Number(targetId)});
    if (!object) return { located: false, reason: 'target ' + ${Number(targetId)} + ' is gone from the area' };
    return {
      located: true,
      hp: typeof object.getHP === 'function' ? object.getHP() : null,
      dead: typeof object.isDead === 'function' ? object.isDead() : null,
      locked: typeof object.isLocked === 'function' ? object.isLocked() : null,
    };
  })()`;

  const rounds = [];
  for (let round = 0; round < maxRounds; round += 1) {
    await sleep(roundMs);
    const status = await harness.evaluate(readTarget);
    rounds.push(status);
    // A destroyed container is removed from the area in some cases, which is
    // success, not a lost subject — say which happened either way.
    if (!status.located || status.dead === true) break;
    const prompts = await listWorldPrompts(harness);
    const offered = (prompts.prompts || []).find((prompt) => prompt.id === first.target.promptId);
    if (!offered || !Array.isArray(offered.actions) || !offered.actions.some((a) => /^bash$/i.test(a))) break;
    await activateWorldAction(harness, { objectId: first.target.promptId, actionLabel: 'Bash' })
      .catch(() => undefined);
  }

  const container = await resolveOpenedContainer(harness);
  const final = await harness.evaluate(readTarget);
  line(`  · ${tag}: ${rounds.length} bash round(s), final=${JSON.stringify(final)}, container=${JSON.stringify(container)}`);
  return { first, rounds, container, final };
}

/** Wait for a world action's container modal and take its authored contents once. */
async function resolveOpenedContainer(harness) {
  const appeared = await harness.evaluate(`(async () => {
    const deadline = Date.now() + 5000;
    const menu = () => window.KotOR.GameState.MenuManager.MenuContainer;
    while (Date.now() < deadline) {
      if (menu() && menu().bVisible === true) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  })()`);
  if (!appeared) return { appeared: false };

  // Empty the container, one authored item at a time, the way a player clicking
  // "Take" repeatedly does. This used to select inventory[0], click once and
  // return: the Ebon Hawk's Spike Footlocker holds TWO separate
  // g_i_progspike01 entries rather than one stack of two, so a single take left
  // a spike behind and the Security Console — which costs two — could not be
  // sliced on a fresh game.
  const taken = await harness.evaluate(`(async () => {
    const menus = window.KotOR.GameState.MenuManager;
    const nameOf = (item) => {
      try { return String((item.getName && item.getName()) || item.tag || 'item'); } catch (e) { return 'item'; }
    };
    const names = [];
    const skipped = [];
    for (let pass = 0; pass < 24; pass += 1) {
      const menu = menus.MenuContainer;
      if (!menu || menu.bVisible !== true) {
        return { ok: true, names, skipped, emptied: true, wasEmpty: names.length === 0, closedEarly: pass > 0 };
      }
      const inventory = menu.container && Array.isArray(menu.container.inventory)
        ? menu.container.inventory : [];
      if (!inventory.length) {
        try { menu.BTN_CANCEL.click(); } catch (error) {
          return { ok: false, reason: String(error && error.message || error), names, skipped };
        }
        return { ok: true, names, skipped, emptied: true, wasEmpty: names.length === 0 };
      }
      const item = inventory[0];
      const label = nameOf(item);
      try {
        menu.LB_ITEMS.select(item);
        menu.BTN_OK.click();
      } catch (error) {
        return { ok: false, reason: String(error && error.message || error), names, skipped };
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      const after = menus.MenuContainer && menus.MenuContainer.container
        && Array.isArray(menus.MenuContainer.container.inventory)
        ? menus.MenuContainer.container.inventory : [];
      if (after.length === inventory.length && after[0] === item) {
        // The click was accepted but the item did not move. Report it rather
        // than spinning: a container that refuses an item is a finding.
        skipped.push(label);
        return { ok: true, names, skipped, emptied: false, wasEmpty: names.length === 0, stalledOn: label };
      }
      names.push(label);
    }
    return { ok: true, names, skipped, emptied: false, wasEmpty: names.length === 0, exhaustedPasses: true };
  })()`, { timeoutMs: 60_000 });
  if (!taken.ok) throw new Error(`container take failed: ${taken.reason}`);
  await sleep(500);
  return { appeared: true, ...taken };
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
      // A bashed door is DESTROYED, not opened — isOpen() stays false. Without
      // this the navigator kept re-selecting the same wreck as the thing in its
      // way and bashed it once per attempt.
      dead: typeof door.isDead === 'function' ? !!door.isDead() : null,
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
async function navigateTo(harness, {
  x,
  y,
  z,
  range = 1.6,
  label = 'destination',
  maxAttempts = 8,
  usePath = true,
  permittedDoorPromptIds = null,
}) {
  if (typeof usePath !== 'boolean') throw new TypeError('navigateTo usePath must be boolean');
  if (permittedDoorPromptIds !== null &&
      (!Array.isArray(permittedDoorPromptIds) || permittedDoorPromptIds.some((id) => typeof id !== 'string' || id.trim().length === 0))) {
    throw new TypeError('navigateTo permittedDoorPromptIds must be null or an array of non-empty strings');
  }
  const opened = [];
  // Session-scoped, not per call: each navigateTo used to start with a clean
  // slate, so a door that had already refused was walked to and retried once per
  // destination — five fixtures meant five pointless round trips each.
  if (!navigateTo.openedIds) navigateTo.openedIds = new Set();
  const openedIds = navigateTo.openedIds;
  let previousDistance = await distanceTo(harness, x, y);

  // Alternate planned and direct approaches. The planner is right about long
  // routes and wrong about short ones near an object that sits just off the
  // walkmesh - an exterior mine on the Ebon Hawk hull is both - while a
  // straight stick push is the reverse. Trying only one of them made a 4.45m
  // approach report the mine as unreachable.
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptUsesPath = usePath && attempt % 2 === 1;
    try {
      const arrived = await moveTo(harness, { x, y, z, range, label, usePath: attemptUsesPath });
      line(`  · reached ${label} after ${attempt} leg(s)${opened.length ? `, opening ${opened.join(', ')}` : ''}`);
      return { arrived, opened, legs: attempt };
    } catch (error) {
      const remaining = await distanceTo(harness, x, y);
      const progressed = previousDistance !== null && remaining !== null &&
        remaining < previousDistance - 0.5;
      previousDistance = remaining;

      await clearBlockingModal(harness);

      // A direct-stick movement is requested only for a deliberately local,
      // authored interaction whose walkmesh route is known to be misleading.
      // Do not turn that request back into generic path recovery: it can walk
      // through unrelated plot doors and mutate the wrong part of the module.
      if (!usePath && attempt >= maxAttempts) {
        throw new Error(`navigateTo ${label}: direct thumbstick approach stopped ${remaining}m short; ` +
          `refusing walkmesh door recovery (${String(error.message).slice(0, 160)})`);
      }

      // The walk stops where the walkmesh ends, which is rarely right next to
      // the door in the way — so find the nearest closed door in the AREA, walk
      // to it, and only then open it. Filtering on what is already in prompt
      // range never saw a door 16m off and reported a dead end instead.
      const inventory = await listDoors(harness);
      if (!inventory.located) throw new Error(`navigateTo ${label}: ${inventory.reason}`);
      // Try candidates in distance order rather than committing to the nearest.
      // The nearest closed door is often a plot door that can never open, and
      // fixating on it reported a dead end while a usable route stood behind it.
      const closedDoors = inventory.doors.filter((door) => !door.open && !door.dead && !openedIds.has(door.promptId));
      const candidates = permittedDoorPromptIds === null
        ? closedDoors
        : closedDoors.filter((door) => permittedDoorPromptIds.includes(door.promptId));

      if (!candidates.length) {
        if (permittedDoorPromptIds !== null && closedDoors.length) {
          throw new Error(`navigateTo ${label}: stopped ${remaining}m short; refusing automatic interaction with unapproved doors ` +
            `${JSON.stringify(closedDoors.map((door) => ({ promptId: door.promptId, name: door.name, tag: door.tag, locked: door.locked, plot: door.plot })))}.`);
        }
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
              range: 2.0, label: door.name,
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
async function clearHostiles(harness, { limit = 12, maxDistance = Infinity } = {}) {
  const outcomes = [];
  // A foe that cannot be engaged must be set aside, not stopped on: the survey
  // hands back the same nearest hostile every time, so breaking on the first
  // awkward one left the rest of the area alive.
  const skipped = new Set();
  for (let index = 0; index < limit; index += 1) {
    const survey = await surveyArea(harness);
    if (!survey.located) throw new Error(`survey: ${survey.reason}`);
    // Bounded by distance as well as count. Once long-range routing started
    // working, an unbounded sweep walked the Exile the length of Peragus
    // hunting every assassin droid in the module - far past the medical bay
    // slice this campaign covers, and long enough to look like a hang.
    const next = (survey.hostiles || [])
      .find((h) => !skipped.has(h.id) && Number(h.distance) <= maxDistance);
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
    for (const name of ${JSON.stringify(GAMEPLAY_RETURN_MENU_NAMES)}) {
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

/** Every interactable in the area, with position, so a sweep can walk to them. */
async function listInteractables(harness) {
  return harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const area = gs.module && gs.module.area;
    const player = window.KotOR.PartyManager.party[0];
    if (!area || !player) return { located: false, reason: 'no area or player' };
    const rows = [];
    const push = (object, kind) => {
      if (!object) return;
      rows.push({
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
        distance: +player.position.distanceTo(object.position).toFixed(2),
        plot: !!object.plot,
        locked: typeof object.isLocked === 'function' ? !!object.isLocked() : null,
        useable: typeof object.isUseable === 'function' ? !!object.isUseable() : null,
      });
    };
    (area.placeables || []).forEach((o) => push(o, 'placeable'));
    (area.doors || []).forEach((o) => push(o, 'door'));
    (area.creatures || []).forEach((o) => push(o, 'creature'));
    rows.sort((a, b) => a.distance - b.distance);
    return { located: true, rows };
  })()`, { timeoutMs: 60000 });
}

/** Snapshot of what the prologue is gating on, so a sweep can tell it moved. */
async function questGateSnapshot(harness) {
  return harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const area = gs.module && gs.module.area;
    if (!area) return { located: false };
    const exits = (area.doors || []).filter(Boolean)
      .map((d) => ({
        name: (() => { try { return String((d.getName && d.getName()) || ''); } catch (e) { return ''; } })(),
        tag: String(d.tag || ''),
        plot: !!d.plot,
        locked: typeof d.isLocked === 'function' ? !!d.isLocked() : null,
        open: typeof d.isOpen === 'function' ? !!d.isOpen() : null,
      }))
      .filter((d) => /\{1\d\dPER\}|\{151HAR\}/i.test(d.name));
    return { located: true, exits };
  })()`, { timeoutMs: 60000 });
}

/**
 * Interacts with everything reachable, once each.
 *
 * This is how a player advances a questline: use the console, open the
 * footlocker, read the terminal. Scripting the beats from memory of the retail
 * game would encode guesses; walking up to each object and taking what it
 * offers exercises whatever the module actually authored, and the quest scripts
 * fire as a side effect.
 *
 * Objects are visited once and then retired whether or not they did anything —
 * without that the nearest one is chosen forever.
 */
async function sweepInteractables(harness, { limit = 30, visited = new Set() } = {}) {
  const log = [];
  for (let index = 0; index < limit; index += 1) {
    const inventory = await listInteractables(harness);
    if (!inventory.located) throw new Error(`interactables: ${inventory.reason}`);

    const next = inventory.rows.find((row) =>
      !visited.has(row.promptId) &&
      row.kind !== 'creature' &&
      row.plot !== true &&
      row.distance < 60);
    if (!next) break;
    visited.add(next.promptId);

    try {
      if (next.distance > 2.2) {
        await navigateTo(harness, {
          x: next.position.x, y: next.position.y, z: next.position.z,
          range: 1.8, label: next.name || next.tag, maxAttempts: 4,
        });
      }
    } catch (error) {
      log.push({ name: next.name || next.tag, skipped: 'unreachable' });
      continue;
    }
    await sleep(900);
    await clearBlockingModal(harness);

    const prompts = await listWorldPrompts(harness);
    const offered = (prompts.prompts || []).find((p) => p.id === next.promptId);
    if (!offered || !offered.actions || !offered.actions.length) {
      log.push({ name: next.name || next.tag, skipped: `no action (${offered && offered.promptError})` });
      continue;
    }

    const entry = { name: next.name || next.tag, kind: next.kind, actions: offered.actions, did: [] };
    for (const action of offered.actions) {
      // The destructive route is labelled "Bash" on doors and "Attack" on
      // containers — both are ActionPhysicalAttacks. Only take either when
      // nothing else is offered, or the sweep smashes lockers it could open.
      const destructive = /^(bash|attack)$/i.test(action);
      const alternatives = offered.actions.filter((a) => !/^(bash|attack)$/i.test(a));
      if (destructive && alternatives.length) continue;
      try {
        await activateWorldAction(harness, { objectId: next.promptId, actionLabel: action });
        entry.did.push(action);
      } catch (error) {
        entry.did.push(`${action} FAILED: ${String(error.message).slice(0, 90)}`);
        continue;
      }
      await sleep(2200);

      // Whatever the interaction raised: a container to empty, a conversation
      // to play, a modal to accept.
      const state = await worldState(harness);
      if (state.foregroundMenu === 'MenuContainer') {
        const took = await harness.evaluate(`(() => {
          const menu = window.KotOR.GameState.MenuManager.MenuContainer;
          const list = menu.LB_ITEMS;
          const rows = list && Array.isArray(list.children) ? list.children : [];
          if (!rows.length) return { ok: false, reason: 'empty' };
          try { list.select(rows[0]); menu.BTN_OK.click(); }
          catch (error) { return { ok: false, reason: String(error && error.message || error) }; }
          return { ok: true, rowCount: rows.length };
        })()`);
        entry.looted = took;
        await sleep(1500);
      }
      if (state.inDialog) {
        try {
          const played = await playDialogue(harness, { label: entry.name, maxTurns: 80 });
          entry.dialogue = played.transcript.slice(-3);
        } catch (error) {
          entry.dialogue = `stalled: ${String(error.message).slice(0, 120)}`;
        }
      }
      await clearBlockingModal(harness);
      await returnToGameplay(harness);
    }
    log.push(entry);
  }
  return log;
}

async function boot(harness, url) {
  line('  · launching');
  await harness.launch(url);
  await harness.waitFor(
    `(() => {
      const eulaVisible = Array.from(document.querySelectorAll('button')).some((button) =>
        (button.textContent || '').trim() === 'OK' &&
        button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0
      );
      const menus = window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager;
      return eulaVisible || !!(menus && menus.MainMenu && menus.MainMenu.bVisible);
    })()`,
    90_000,
  );
  const eulaVisible = await harness.evaluate(`Array.from(document.querySelectorAll('button')).some((button) =>
    (button.textContent || '').trim() === 'OK' &&
    button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0
  )`);
  if (eulaVisible) {
    await clickButtonByText(harness, 'OK');
    line('  · EULA accepted');
  } else {
    line('  · EULA already accepted');
  }
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
  // Validate before writing, not only when a later pass resumes the save.  A
  // mislabeled save otherwise becomes a tempting but false progress marker and
  // can skip the very transition the campaign is meant to exercise.
  const state = await worldState(harness);
  const inventory = await describeInventory(harness);
  const validation = validateCheckpointSnapshot(name, {
    moduleName: state.moduleName,
    inventoryCount: inventory.inventoryCount,
  });
  if (!validation.ok) {
    throw new Error(`refusing to write checkpoint: ${validation.reason}`);
  }

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
  return { ...saved, validation };
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
    // The NEWEST match, not the first. A campaign rewrites the same checkpoint
    // name every pass, so findIndex kept resurrecting the oldest save under
    // that label — which is how a resume arrived at the Hyperdrive carrying 4
    // Parts when the checkpoint that was actually just written had 7.
    const matches = all.reduce((found, n, at) => {
      if (n.trim().toLowerCase() === wanted) found.push(at);
      return found;
    }, []);
    if (!matches.length) return { ok: false, reason: 'no checkpoint named ' + wanted, available: all };
    const index = matches[matches.length - 1];
    const directory = String(K.SaveGame.saves[index].directory || '');
    // MenuSaveLoad's exact LOADGAME sequence. Calling load() with the menu's
    // module still standing leaves the engine in GUI mode and never lands.
    gs.MenuManager.ClearMenus();
    if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
    Promise.resolve(K.SaveGame.saves[index].load()).catch(() => undefined);
    return { ok: true, index, name: all[index], directory, matchCount: matches.length };
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
  const state = await worldState(harness);
  const inventory = await describeInventory(harness);
  const validation = validateCheckpointSnapshot(name, {
    moduleName: state.moduleName,
    inventoryCount: inventory.inventoryCount,
  });
  if (!validation.ok) {
    throw new Error(validation.reason);
  }
  line(`  · resumed from "${loaded.name}" (engineMode=${mode}, save=${loaded.directory}, ${loaded.matchCount} save(s) carry this name — newest chosen)`);
  return { ...loaded, validation };
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

  await record('change equipment through the VR Menu route', async () => {
    // The playthrough looted, spent and gained items but never moved one into
    // a slot. Equipping is the other half of "inventory works", and in this
    // codebase it is exactly the shape that breaks silently: a TSL menu whose
    // buttons render but were never wired.
    //
    // Adaptive on purpose. T3 boards the Ebon Hawk wearing a Mining Laser, a
    // Droid Shock Arm and a Droid Hide, so an unequip/re-equip round trip is
    // available there. The Exile wakes from the kolto tank with nothing
    // equipped and nothing equippable — Medpacs, Parts, a spike and a mine —
    // which is authored, not a defect, so that case reports what it found
    // instead of failing.
    const before = await describeInventory(harness);
    line(`  · ${before.playerName} equipped before: ${JSON.stringify(before.equipped)}`);

    await activateWheelAction(harness, { targetId: null, actionLabel: 'Menu' });
    await sleep(1500);
    await clickGuiControl(harness, 'MenuTop', 'BTN_EQU');
    await harness.waitFor(`(() => {
      const menu = window.KotOR.GameState.MenuManager.MenuEquipment;
      return !!(menu && menu.bVisible);
    })()`, TIMEOUTS.short, 250);

    const outcome = await harness.evaluate(`(async () => {
      const K = window.KotOR;
      const menu = K.GameState.MenuManager.MenuEquipment;
      const player = K.PartyManager.party[0];
      if (!menu) return { located: false, reason: 'no MenuEquipment' };
      if (!player) return { located: false, reason: 'no player' };
      const nameOf = (item) => {
        try { return String((item && item.getName && item.getName()) || ''); } catch (e) { return ''; }
      };
      // ModuleCreature.equipment is keyed by NAME ('RIGHTHAND'), while the menu
      // and equipItem() speak the numeric ModuleCreatureArmorSlot mask. Reading
      // player.equipment[menu.slot] therefore answered undefined for every
      // slot and reported a fully equipped T3-M4 as wearing nothing. Invert the
      // engine's own enum rather than restating it here.
      const SLOT_KEY = {};
      for (const [key, value] of Object.entries(K.ModuleCreatureArmorSlot || {})) {
        if (typeof value === 'number') SLOT_KEY[value] = key;
      }
      const wornIn = (slot) => (player.equipment && SLOT_KEY[slot]) ? player.equipment[SLOT_KEY[slot]] : null;
      const clickable = (control) => {
        const listeners = control && control.eventListeners && control.eventListeners['click'];
        return Array.isArray(listeners) && listeners.length > 0;
      };
      if (!clickable(menu.BTN_EQUIP)) {
        return { located: true, wired: false, reason: 'BTN_EQUIP has no click handler' };
      }

      const slotButtons = Object.keys(menu).filter((key) => /^BTN_INV_/.test(key));
      const survey = [];
      let acted = null;
      for (const buttonName of slotButtons) {
        const button = menu[buttonName];
        if (!clickable(button)) { survey.push({ buttonName, wired: false }); continue; }
        try { button.click(); } catch (error) {
          survey.push({ buttonName, wired: true, note: 'click threw: ' + String(error && error.message || error) });
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 140));
        const slot = menu.slot;
        const rows = (menu.LB_ITEMS && Array.isArray(menu.LB_ITEMS.listItems)) ? menu.LB_ITEMS.listItems : [];
        const items = rows.filter((row) => row && typeof row.baseItemId === 'number');
        // Unequip is expressed as the list's authored 'None' row. BTN_EQUIP
        // guards on 'selectedItem instanceof GUIItemNone', so selecting null
        // silently did nothing and looked like an engine that refused to
        // unequip. Use the row the menu itself builds.
        const noneRow = rows.find((row) => row && row.constructor && row.constructor.name === 'GUIItemNone');
        const worn = wornIn(slot);
        survey.push({ buttonName, wired: true, slot, offered: items.map(nameOf), worn: nameOf(worn),
          hasNoneRow: !!noneRow });
        // Deliberately read-only. An earlier version unequipped and re-equipped
        // to prove the route works; it does, and the three engine defects it
        // uncovered are fixed and unit-tested. But acting here mutated T3's
        // loadout and that state rode along in every checkpoint the campaign
        // wrote afterwards - the Mining Laser turned up in the left hand two
        // stages later. Verifying the screen is live is worth a step; moving
        // the player's weapon around mid-playthrough is not.
      }
      return { located: true, wired: true, survey, acted: null };
    })()`, { timeoutMs: 90_000 });

    if (!outcome.located) throw new Error(`equipment menu unavailable: ${outcome.reason}`);
    line(`  · slot survey: ${JSON.stringify(outcome.survey || null)}`);
    await returnToGameplay(harness);
    const after = await describeInventory(harness);

    const resumed = await worldState(harness);
    if (resumed.engineMode !== 1) {
      throw new Error(`the equipment screen left the engine in mode ${resumed.engineMode} (want 1=INGAME); ` +
        `foreground=${resumed.foregroundMenu}`);
    }
    if (!outcome.wired) throw new Error(`the VR Equipment route is not wired: ${outcome.reason}`);
    const unwired = (outcome.survey || []).filter((row) => row.wired === false).map((row) => row.buttonName);
    if (unwired.length) throw new Error(`equipment slot buttons with no click handler: ${JSON.stringify(unwired)}`);
    if (outcome.reason) throw new Error(`equipment change failed: ${outcome.reason}`);
    // The list's 'None' row is what BTN_EQUIP's unequip branch needs; its absence
    // would make unequipping impossible again.
    const missingNone = (outcome.survey || []).filter((row) => row.wired && row.hasNoneRow === false)
      .map((row) => row.buttonName);
    if (missingNone.length) {
      throw new Error(`equipment slots with no 'None' row to unequip with: ${JSON.stringify(missingNone)}`);
    }

    if (!outcome.acted) {
      line(`  · ${before.playerName} has nothing equipped and nothing equippable ` +
        `(${JSON.stringify(before.inventory)}); Equipment screen verified reachable with ` +
        `${(outcome.survey || []).length} live slots`);
      return { before, after, outcome, note: 'no equippable item at this point in the prologue' };
    }
    if (outcome.acted.kind === 'round-trip') {
      if (!outcome.acted.emptiedOnUnequip) {
        throw new Error(`unequipping ${outcome.acted.item} left the slot occupied: ${JSON.stringify(outcome.acted)}`);
      }
      if (outcome.acted.inInventoryAfterUnequip !== true) {
        throw new Error(`unequipping ${outcome.acted.item} did not leave it in the inventory: ` +
          JSON.stringify(outcome.acted));
      }
      if (outcome.acted.restored !== outcome.acted.item) {
        throw new Error(`re-equipping did not restore ${outcome.acted.item}: ${JSON.stringify(outcome.acted)}`);
      }
      line(`  · unequipped and re-equipped ${JSON.stringify(outcome.acted.item)} in slot ${outcome.acted.slot}`);
    } else if (outcome.acted.inSlotAfter !== outcome.acted.item) {
      throw new Error(`equipping ${outcome.acted.item} did not stick: ${JSON.stringify(outcome.acted)}`);
    } else {
      line(`  · equipped ${JSON.stringify(outcome.acted.item)} into slot ${outcome.acted.slot}`);
    }
    return { before, after, outcome };
  });

  const ebonExteriorCheckpoints = new Set([
    'ebon-exterior-arrival',
    'ebon-first-mine-disarmed',
    'ebon-second-mine-recovered',
    'ebon-proton-missile-recovered',
    'ebon-engine-parts-recovered',
    'ebon-quadlasers-recovered',
  ]);
  if (args.prologueRoute === 'continue' && ebonExteriorCheckpoints.has(args.resume)) {
    await record('survey the Ebon Hawk exterior repair route', async () => {
      await returnToGameplay(harness);
      const state = await worldState(harness);
      const survey = await surveyArea(harness);
      const interactables = await listInteractables(harness);
      const prompts = await listWorldPrompts(harness);
      if (String(state.moduleName || '').toLowerCase() !== '002ebo') {
        throw new Error(`exterior checkpoint loaded ${state.moduleName}; expected 002ebo`);
      }
      line(`  · exterior state: ${JSON.stringify(state)}`);
      line(`  · exterior area: ${JSON.stringify(survey)}`);
      line(`  · exterior interactables: ${JSON.stringify(interactables)}`);
      line(`  · exterior VR prompts: ${JSON.stringify(prompts)}`);
      return { state, survey, interactables, prompts };
    });
    if (!resumedPast(args, 'ebon-first-mine-disarmed')) {
      await record('disarm the first exterior Frag Mine through the VR action wheel', async () => {
        const survey = await surveyArea(harness);
        const mine = (survey.nearestTriggers || []).find((trigger) => /frag mine/i.test(String(trigger.name || trigger.tag || '')));
        if (!mine || !mine.position) throw new Error(`no exterior Frag Mine trigger found: ${JSON.stringify(survey.nearestTriggers || [])}`);
        const result = await resolveExteriorMine(harness, { mine, actionLabel: 'Disarm' });
        line(`  · disarmed mine ${mine.id}; inventory ${result.before.inventoryCount} -> ${result.after.inventoryCount}`);
        return result;
      });
      await record('checkpoint: first exterior mine disarmed', () => checkpoint(harness, 'ebon-first-mine-disarmed'));
    }
    if (!resumedPast(args, 'ebon-second-mine-recovered')) {
      await record('recover the second exterior Frag Mine through the VR action wheel', async () => {
        const survey = await surveyArea(harness);
        const mines = (survey.nearestTriggers || []).filter((trigger) => /frag mine/i.test(String(trigger.name || trigger.tag || '')));
        const mine = mines.find((trigger) => trigger.position);
        if (!mine) throw new Error(`no remaining exterior Frag Mine trigger found: ${JSON.stringify(mines)}`);
        const result = await resolveExteriorMine(harness, { mine, actionLabel: 'Recover' });
        line(`  · recovered mine ${mine.id}; inventory ${result.before.inventoryCount} -> ${result.after.inventoryCount}: ${JSON.stringify(result.after.inventory.slice(-3))}`);
        return result;
      });
      await record('checkpoint: second exterior mine recovered', () => checkpoint(harness, 'ebon-second-mine-recovered'));
    }
    if (!resumedPast(args, 'ebon-proton-missile-recovered')) {
      await record('inspect the exterior Proton Missile VR action', async () => {
      const target = (await findObjectByTag(harness, 'ProtonMis')).sort((left, right) => left.distance - right.distance)[0];
      if (!target || !target.position) throw new Error(`Proton Missile target has no world position: ${JSON.stringify(target || null)}`);
      await navigateTo(harness, {
        x: target.position.x,
        y: target.position.y,
        z: target.position.z,
        range: 1.5,
        label: 'Proton Missile',
        maxAttempts: 3,
        permittedDoorPromptIds: [],
      });
      await sleep(800);
      const prompts = await listWorldPrompts(harness);
      const prompt = (prompts.prompts || []).find((candidate) => candidate.id === target.promptId && candidate.inRange);
      if (!prompt || !Array.isArray(prompt.actions) || prompt.actions.length === 0) {
        throw new Error(`Proton Missile has no in-range VR action: ${JSON.stringify(prompt || null)}`);
      }
      line(`  · Proton Missile prompt: ${JSON.stringify(prompt)}`);
      return { target, prompt };
      });
      await record('recover the Proton Missile through the verified VR action', async () => {
      const target = (await findObjectByTag(harness, 'ProtonMis')).sort((left, right) => left.distance - right.distance)[0];
      if (!target) throw new Error('Proton Missile disappeared before its verified action could be selected');
      const prompts = await listWorldPrompts(harness);
      const prompt = (prompts.prompts || []).find((candidate) => candidate.id === target.promptId && candidate.inRange);
      if (!prompt || !Array.isArray(prompt.actions)) {
        throw new Error(`Proton Missile action became unavailable: ${JSON.stringify(prompt || null)}`);
      }
      const action = chooseExplicitWorldAction(prompt.actions, 'Use: Proton Missile', 'Proton Missile', { allowDestructive: false });
      const before = await describeInventory(harness);
      const activation = await activateWorldAction(harness, { objectId: target.promptId, actionLabel: action });
      const container = await resolveOpenedContainer(harness);
      // wasEmpty, not emptied: this helper now clears the container, so
      // 'empty' afterwards is success. What matters is whether anything came out.
      if (container.appeared !== true || container.wasEmpty === true) {
        throw new Error(`Proton Missile opened no recoverable contents: ${JSON.stringify(container)}`);
      }
      await returnToGameplay(harness);
      const after = await describeInventory(harness);
      if (after.inventoryCount <= before.inventoryCount) {
        throw new Error(`Recovering Proton Missile added no inventory item (${before.inventoryCount} -> ${after.inventoryCount})`);
      }
      const state = await worldState(harness);
      line(`  · recovered Proton Missile; inventory ${before.inventoryCount} -> ${after.inventoryCount}: ${JSON.stringify(after.inventory.slice(-3))}`);
      return { activation, container, before, after, state };
      });
      await record('checkpoint: Proton Missile recovered', () => checkpoint(harness, 'ebon-proton-missile-recovered'));
    }
    if (!resumedPast(args, 'ebon-engine-parts-recovered')) {
    await record('recover the Engine Port Parts through the verified VR action', async () => {
      const recovered = await recoverPartsFromWorldContainer(harness, {
        tag: 'eng_port', objectName: 'Engine Port', actionLabel: 'Use: Engine Port',
      });
      const state = await worldState(harness);
      const dialogue = await dialogueSnapshot(harness);
      line(`  · Engine Port Parts ${recovered.partsBefore} -> ${recovered.partsAfter}; aftermath: ${JSON.stringify({ state, dialogue })}`);
      return { ...recovered, state, dialogue };
    });
    await record('checkpoint: Engine Port Parts recovered', () => checkpoint(harness, 'ebon-engine-parts-recovered'));
    }
    if (!resumedPast(args, 'ebon-quadlasers-recovered')) {
      await record('inspect the exterior Quadlasers VR action required for the fifth Part', async () => {
        const target = (await findObjectByTag(harness, 'Quad')).sort((left, right) => left.distance - right.distance)[0];
        if (!target || !target.position) throw new Error(`Quadlasers target is unavailable: ${JSON.stringify(target || null)}`);
        await navigateTo(harness, {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z,
          range: 1.5,
          label: 'Quadlasers',
          maxAttempts: 3,
          permittedDoorPromptIds: [],
        });
        const prompt = await waitForWorldPrompt(harness, target.promptId);
        if (!Array.isArray(prompt.actions) || !prompt.actions.some((action) => /^Use:/i.test(action))) {
          throw new Error(`Quadlasers offered no authored Use action: ${JSON.stringify(prompt)}`);
        }
        line(`  · Quadlasers prompt: ${JSON.stringify(prompt)}`);
        return { target, prompt };
      });
      await record('recover Quadlasers Parts through the verified VR action', async () => {
        const recovered = await recoverPartsFromWorldContainer(harness, {
          tag: 'Quad', objectName: 'Quadlasers', actionLabel: 'Use: Quadlasers', minimumParts: 5,
        });
        line(`  · Quadlasers Parts ${recovered.partsBefore} -> ${recovered.partsAfter}; travel requirement met.`);
        return recovered;
      });
      await record('checkpoint: Quadlasers Parts recovered', () => checkpoint(harness, 'ebon-quadlasers-recovered'));
      args.resume = 'ebon-quadlasers-recovered';
    }
    if (args.resume === 'ebon-quadlasers-recovered') {
      await record('capture the Quadlasers-to-lift walkmesh route before traversal', async () => {
        return harness.evaluate(`(() => {
          const K = window.KotOR;
          const player = K.PartyManager.party[0];
          const area = K.GameState.module && K.GameState.module.area;
          const lift = area && (area.placeables || []).find((entry) => entry && String(entry.tag || '').toLowerCase() === 'lift_to_001');
          if (!player || !area || !area.path || !lift) return { ok: false, reason: 'player, area path, or return lift is unavailable' };
          try {
            const destination = player.position.clone().copy(lift.position);
            const path = area.path.traverseToPoint(player, player.position.clone(), destination, true);
            path.fixWalkEdges(player.getHitDistance());
            const points = (path.points || []).map((point) => ({ x: point.vector.x, y: point.vector.y, z: point.vector.z }));
            path.dispose();
            return { ok: true, from: { x: player.position.x, y: player.position.y, z: player.position.z }, points };
          } catch (error) {
            return { ok: false, reason: String(error && error.message || error) };
          }
        })()`);
      });
      await record('activate the return Utility Lift through its VR prompt', async () => {
        const lift = await useTaggedWorldObject(harness, {
          tag: 'lift_to_001',
          actionPattern: /^Use:/i,
          permittedDoorPromptIds: [],
        });
        await sleep(1800);
        const state = await worldState(harness);
        const dialogue = await dialogueSnapshot(harness);
        const computer = await dialogueSnapshot(harness, 'InGameComputer');
        line(`  · return lift activation: ${JSON.stringify({ lift, state, dialogue, computer })}`);
        return { lift, state, dialogue, computer };
      });
      await record('enter the Ebon Hawk through the authored Utility Lift dialogue', async () => {
        const chooseGoInside = (replies) => chooseRequiredDialogueText(
          replies,
          '1. [Go inside.]',
          'Utility Lift',
        );
        const dialogue = await playDialogue(harness, {
          choose: chooseGoInside,
          label: 'Utility Lift return dialogue',
          maxTurns: 20,
        });
        if (!dialogue.finished) throw new Error('Utility Lift return dialogue did not finish');
        await waitForModule(harness, '001ebo');
        const state = await worldState(harness);
        if (String(state.moduleName || '').toLowerCase() !== '001ebo') {
          throw new Error(`Utility Lift Go inside did not return to 001EBO: ${JSON.stringify(state)}`);
        }
        line(`  · Utility Lift Go inside returned to ${state.moduleName}: ${JSON.stringify({ dialogue, state })}`);
        return { dialogue, state };
      });
      await record('checkpoint: Ebon Hawk return lift entered', () => checkpoint(harness, 'ebon-return-lift-entered'));
      args.resume = 'ebon-return-lift-entered';
    }
    if (!RETURNED_TO_EBON_HAWK.has(args.resume) && !report.blocked) {
      report.blocked = {
        step: 'Ebon Hawk exterior repair route',
        error: args.resume === 'ebon-engine-parts-recovered'
          ? 'Return Utility Lift Go inside transition is verified; the next Ebon Hawk objective is the next route decision.'
          : 'Exterior mines, Parts recovery, and the Engine Port transfer are verified; the return-lift continuation is the next route decision.',
      };
      line('  ! Exterior mines and Engine Port Parts recovery are verified; ending this pass after the current return-lift probe.');
    }
    if (!RETURNED_TO_EBON_HAWK.has(args.resume)) return report;
  }

  // Any checkpoint taken after the return lift belongs to this stretch. Gating
  // on the single label 'ebon-return-lift-entered' meant resuming from a later
  // checkpoint silently skipped every remaining Ebon Hawk step.
  if (args.prologueRoute === 'continue' && RETURNED_TO_EBON_HAWK.has(args.resume)) {
    await record('survey the authored Ebon Hawk objective after returning from the exterior', async () => {
      await returnToGameplay(harness);
      const state = await worldState(harness);
      if (String(state.moduleName || '').toLowerCase() !== '001ebo') {
        throw new Error(`return-lift checkpoint loaded ${state.moduleName}; expected 001ebo`);
      }
      const survey = await surveyArea(harness);
      const doors = await listDoors(harness);
      const interactables = await listInteractables(harness);
      const prompts = await listWorldPrompts(harness);
      line(`  · return-lift interior state: ${JSON.stringify(state)}`);
      line(`  · return-lift interior survey: ${JSON.stringify(survey)}`);
      line(`  · return-lift interior doors: ${JSON.stringify(doors)}`);
      line(`  · return-lift interior interactables: ${JSON.stringify(interactables)}`);
      line(`  · return-lift interior VR prompts: ${JSON.stringify(prompts)}`);
      return { state, survey, doors, interactables, prompts };
    });
    await record('diagnose the open Inner Garage Door walkmesh transition', async () => {
      const transition = await harness.evaluate(`(() => {
        const gs = window.KotOR.GameState;
        const area = gs.module && gs.module.area;
        const player = window.KotOR.PartyManager.party && window.KotOR.PartyManager.party[0];
        if (!area || !player) return { located: false, reason: 'no area or player' };
        const door = (area.doors || []).find((entry) => entry && entry.id === 206);
        const workbench = (area.placeables || []).find((entry) => entry && String(entry.tag || '').toLowerCase() === 'workbench');
        if (!door || !workbench) return { located: false, reason: 'inner garage door or workbench missing' };
        const roomIndex = (room) => (area.rooms || []).indexOf(room);
        const walkmesh = door.collisionManager && door.collisionManager.walkmesh;
        const mesh = walkmesh && walkmesh.mesh;
        return {
          located: true,
          door: {
            id: door.id,
            open: typeof door.isOpen === 'function' && door.isOpen(),
            openState: door.openState,
            locked: typeof door.isLocked === 'function' && door.isLocked(),
            collisionListed: !!(walkmesh && (area.doorWalkmeshes || []).includes(walkmesh)),
            globalWalkmeshListed: !!(mesh && (window.KotOR.GameState.walkmeshList || []).includes(mesh)),
            collisionMeshAttached: !!(mesh && mesh.parent),
            room: roomIndex(door.room),
          },
          player: { position: { x: player.position.x, y: player.position.y, z: player.position.z }, room: roomIndex(player.room) },
          workbench: { position: { x: workbench.position.x, y: workbench.position.y, z: workbench.position.z }, room: roomIndex(workbench.room) },
          playerRoomLinks: player.room && player.room.linkedRoomsArray
            ? player.room.linkedRoomsArray.map(roomIndex)
            : [],
        };
      })()`);
      if (!transition.located) throw new Error(`Inner Garage Door transition diagnostics unavailable: ${transition.reason}`);
      line(`  · Inner Garage Door transition: ${JSON.stringify(transition)}`);
      return transition;
    });
    await record('map the returned Ebon Hawk walkmesh before selecting another route', async () => {
      const map = await harness.evaluate(`(() => {
        const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
        const player = window.KotOR.PartyManager.party && window.KotOR.PartyManager.party[0];
        if (!area || !player || !Array.isArray(area.walkFaces)) return { located: false, reason: 'area walkmesh is unavailable' };
        const xMin = 40;
        const xMax = 68;
        const yMin = 20;
        const yMax = 48;
        const scale = 0.5;
        const markerAt = (x, y) => {
          if (Math.hypot(player.position.x - x, player.position.y - y) < scale * 0.8) return 'P';
          const workbench = (area.placeables || []).find((entry) => entry && String(entry.tag || '').toLowerCase() === 'workbench');
          if (workbench && Math.hypot(workbench.position.x - x, workbench.position.y - y) < scale * 0.8) return 'W';
          const door = (area.doors || []).find((entry) => entry && Math.hypot(entry.position.x - x, entry.position.y - y) < scale * 0.8);
          if (door) return typeof door.isOpen === 'function' && door.isOpen() ? 'o' : 'D';
          return null;
        };
        const lines = [];
        for (let y = yMax; y >= yMin; y -= scale) {
          let line = '';
          for (let x = xMin; x <= xMax; x += scale) {
            const marker = markerAt(x, y);
            if (marker) { line += marker; continue; }
            const point = player.position.clone().set(x, y, player.position.z);
            line += area.walkFaces.some((face) => face && typeof face.pointInFace2d === 'function' && face.pointInFace2d(point)) ? '.' : '#';
          }
          lines.push(line);
        }
        return {
          located: true,
          bounds: { xMin, xMax, yMin, yMax, scale },
          legend: '# blocked, . walkable, P player, W workbench, o open door, D closed door',
          lines,
        };
      })()`);
      if (!map.located) throw new Error(`returned Ebon Hawk walkmesh map unavailable: ${map.reason}`);
      line(`  · returned Ebon Hawk walkmesh map ${JSON.stringify(map)}`);
      return map;
    });
    await record('inspect the returned Ebon Hawk plot state without changing it', async () => {
      const plotState = await harness.evaluate(`(() => {
        const K = window.KotOR;
        const area = K.GameState.module && K.GameState.module.area;
        if (!area) return { located: false, reason: 'no area' };
        const matchesRoute = (value) => /(?:001|ebo|prologue|peragus|t3|engine|garage)/i.test(String(value || ''));
        const globals = K.GameState.GlobalVariableManager && K.GameState.GlobalVariableManager.Globals;
        const collectGlobals = (map) => map instanceof Map
          ? Array.from(map.values()).filter((entry) => entry && matchesRoute(entry.name) && entry.value).map((entry) => ({ name: entry.name, value: entry.value }))
          : [];
        const journals = K.GameState.JournalManager && Array.isArray(K.GameState.JournalManager.Entries)
          ? K.GameState.JournalManager.Entries.filter((entry) => entry && matchesRoute(entry.plotID || entry.tag || entry.name))
            .map((entry) => ({ tag: entry.plotID || entry.tag || entry.name, state: entry.state }))
          : [];
        const scriptName = (script) => String((script && (script.name || script.resref)) || script || '');
        const describe = (object, kind) => ({
          kind,
          id: object.id,
          tag: String(object.tag || ''),
          name: (() => { try { return String(object.getName && object.getName() || ''); } catch (_) { return ''; } })(),
          position: { x: object.position.x, y: object.position.y, z: object.position.z },
          open: typeof object.isOpen === 'function' ? object.isOpen() : undefined,
          locked: typeof object.isLocked === 'function' ? object.isLocked() : undefined,
          scripts: Object.fromEntries(Object.entries(object.scripts || {})
            .map(([event, script]) => [event, scriptName(script)]).filter(([, script]) => script)),
        });
        const relevant = [
          ...(area.placeables || []).filter((object) => object && /workbench|spark_wire|eng_star|lift_to_002/i.test(String(object.tag || ''))).map((object) => describe(object, 'placeable')),
          ...(area.doors || []).filter((object) => object && /sealed_door|engine_door/i.test(String(object.tag || ''))).map((object) => describe(object, 'door')),
        ];
        return {
          located: true,
          globals: globals ? {
            boolean: collectGlobals(globals.Boolean),
            number: collectGlobals(globals.Number),
            string: collectGlobals(globals.String),
          } : null,
          journals,
          relevant,
        };
      })()`);
      if (!plotState.located) throw new Error(`returned Ebon Hawk plot state unavailable: ${plotState.reason}`);
      line(`  · returned Ebon Hawk plot state: ${JSON.stringify(plotState)}`);
      return plotState;
    });
    if (!resumedPast(args, 'ebon-engine-room-open')) {
      await record('open the Engine Room Door with a recovered mine through the VR prompt', async () => {
        // The authored route, not an improvisation: eng_door.dlg reads "This door
        // is damaged and cannot be opened with your Security skill, or by bashing
        // it. You can use a mine to open this door." engine_door is also the only
        // locked door template in 001EBO with NotBlastable=0.
        const before = await describeInventory(harness);
        const minesBefore = inventoryQuantityByName(before.inventory, 'Minor Frag Mine');
        if (minesBefore < 1) {
          throw new Error(`no mine to plant; inventory=${JSON.stringify(before.inventory)}`);
        }
        const door = (await findObjectByTag(harness, 'engine_door'))[0];
        if (!door) throw new Error('Engine Room Door was not found in the area');

        // Defer to the prompt, not to an arrival threshold of our own. The VR
        // interaction range for a door is 3m and this approach reliably gets to
        // about 2.9m, which navigateTo scored as "0.7m short" of its stricter
        // target and called a failure. What matters is whether the door offers
        // its action from where we are standing.
        try {
          await navigateTo(harness, {
            x: door.position.x, y: door.position.y, z: door.position.z,
            range: 2.4, label: 'Engine Room Door', maxAttempts: 4, permittedDoorPromptIds: [],
          });
        } catch (error) {
          await sleep(600);
          const reach = await listWorldPrompts(harness);
          const near = (reach.prompts || []).find((prompt) => prompt.id === door.promptId);
          if (!near || near.inRange !== true) throw error;
          line('  · the approach fell short of its own threshold but the door is in range');
        }
        await sleep(800);

        // Report what the door actually offers before acting on it: "Mine was not
        // offered" and "Mine was offered and did nothing" need different fixes.
        const prompts = await listWorldPrompts(harness);
        const offered = (prompts.prompts || []).find((prompt) => prompt.id === door.promptId);
        line(`  · Engine Room Door VR prompt: ${JSON.stringify(offered || null)}`);
        if (!offered || offered.inRange !== true || !Array.isArray(offered.actions)) {
          throw new Error(`Engine Room Door offered no in-range VR actions: ${JSON.stringify(offered || null)}`);
        }
        const action = chooseExplicitWorldAction(offered.actions, 'Mine', 'Engine Room Door');
        // Count the stack, not `charges`. Retail mines are stacked items and ship
        // charges=0; ActionSetMine's own consumption path reads that as "last
        // one" and calls removeItem, so the stack total is what actually moves.
        const MINE_STACK = `(() => {
          const actor = window.KotOR.PartyManager.party[0];
          if (!actor || typeof actor.getInventory !== 'function') return null;
          return actor.getInventory().filter((item) => item && item.baseItemId === 58)
            .reduce((total, item) => total + (Number(item.stackSize) || 1), 0);
        })()`;
        const stackBefore = await harness.evaluate(MINE_STACK);
        if (!Number.isFinite(stackBefore) || stackBefore < 1) {
          throw new Error(`no mine in the actor's inventory to plant: ${JSON.stringify(stackBefore)}`);
        }
        const activation = await activateWorldAction(harness, { objectId: door.promptId, actionLabel: action });

        // Let the placement finish BEFORE backing away. ActionSetMine queues its
        // SET_MINE animation to the front of the queue and returns IN_PROGRESS,
        // so it needs several frames; driving locomotion in that window races it.
        //
        // Watch the mine's charge count, NOT the target's trapType: engine_door
        // ships TrapType=2 in its own template, so a "trapType >= 0" probe is
        // true before anything is planted and reported success for a run that
        // had planted nothing.
        const planted = await harness.waitFor(`(() => {
          const actor = window.KotOR.PartyManager.party[0];
          if (!actor || typeof actor.getInventory !== 'function') return false;
          const mines = actor.getInventory().filter((item) => item && item.baseItemId === 58);
          const stack = mines.reduce((total, item) => total + (Number(item.stackSize) || 1), 0);
          return stack < ${stackBefore};
        })()`, 30_000, 500).then(() => true).catch(() => false);
        if (!planted) {
          const stall = await harness.evaluate(`(() => {
            const K = window.KotOR;
            const actor = K.PartyManager.party[0];
            const area = K.GameState.module && K.GameState.module.area;
            const door = area && (area.doors || []).find((entry) => entry && entry.id === ${door.id});
            if (!actor) return { located: false, reason: 'no actor' };
            const describeAction = (entry) => {
              if (!entry) return String(entry);
              return {
                kind: entry.constructor ? entry.constructor.name : '?',
                type: entry.type,
                status: entry.status,
                bInitialized: entry.bInitialized,
                elapsed: entry.elapsed,
                animation: entry.animation,
                animationLength: entry.animationLength,
                time: entry.time,
                bAnimQueued: entry.bAnimQueued,
                usedItem: entry.usedItem,
              };
            };
            return {
              located: true,
              queueLength: (actor.actionQueue || []).length,
              queue: Array.from(actor.actionQueue || []).map(describeAction),
              currentAction: describeAction(actor.action),
              mines: actor.getInventory().filter((i) => i && i.baseItemId === 58)
                .map((i) => ({ name: i.getName ? String(i.getName()) : '?', charges: i.charges,
                  stackSize: i.stackSize, id: i.id })),
              door: door ? { trapType: door.trapType, hp: door.getHP ? door.getHP() : null,
                open: typeof door.isOpen === 'function' ? door.isOpen() : null } : 'no door',
              actorPosition: { x: +actor.position.x.toFixed(2), y: +actor.position.y.toFixed(2) },
            };
          })()`);
          throw new Error(`the mine was never planted on the Engine Room Door: ${JSON.stringify({ activation, stall })}`);
        }

        // The conversation says to back away before it blows.
        await moveTo(harness, { x: 50.70, y: 30.20, z: 1.81, range: 1.2, usePath: false }).catch(() => undefined);

        // Detonation is scheduled three module-seconds out, then the door falls to
        // -11 HP and its own update() opens it.
        const opened = await harness.waitFor(`(() => {
          const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
          const door = area && (area.doors || []).find((entry) => entry && entry.id === ${door.id});
          return !!(door && typeof door.isOpen === 'function' && door.isOpen());
        })()`, 45_000, 500).then(() => true).catch(() => false);

        const after = await describeInventory(harness);
        const minesAfter = inventoryQuantityByName(after.inventory, 'Minor Frag Mine');
        const doors = await listDoors(harness);
        const engineDoor = (doors.doors || []).find((entry) => entry.id === door.id);
        line(`  · Engine Room Door after the mine: ${JSON.stringify({ opened, minesBefore, minesAfter, engineDoor })}`);
        if (!opened || !engineDoor || engineDoor.open !== true) {
          throw new Error(`the mine did not open the Engine Room Door: ${JSON.stringify({ activation, minesBefore, minesAfter, engineDoor })}`);
        }
        if (minesAfter >= minesBefore) {
          throw new Error(`planting a mine did not consume one: ${minesBefore} -> ${minesAfter}`);
        }
        return { activation, minesBefore, minesAfter, engineDoor };
      });
      await record('checkpoint: Engine Room Door mined open', () => checkpoint(harness, 'ebon-engine-room-open'));
    }

    if (!resumedPast(args, 'ebon-hyperdrive-rigged')) {
      await record('rig the Hyperdrive with the recovered Parts', async () => {
        // 001EBO_HyperDrive is what glxy_map.dlg tests (c_global_eq == 2) before
        // it will offer Peragus, and a_hyper_rep on the Hyperdrive's own
        // conversation is the only thing in the module that sets it.
        const gateBefore = await readGlobalNumber(harness, '001EBO_HyperDrive');
        const partsBefore = inventoryQuantityByName((await describeInventory(harness)).inventory, 'Parts');
        line(`  · before rigging: ${JSON.stringify({ gateBefore, partsBefore })}`);
        if (partsBefore < 5) throw new Error(`the Hyperdrive needs 5 Parts; carrying ${partsBefore}`);

        const used = await useTaggedWorldObject(harness, {
          tag: 'Hyperdrive',
          actionPattern: /^Use:/i,
          range: 2.0,
          maxAttempts: 3,
          permittedDoorPromptIds: [],
        });
        const choose = (replies) => chooseRequiredDialogueTextPrefix(replies, 'Rig the hyperdrive', 'Hyperdrive');
        const dialogue = await playDialogue(harness, {
          choose: (replies, snapshot) => {
            try { return choose(replies); } catch (error) {
              // Later turns of this conversation are plain continuations with a
              // single authored row; only the repair choice is a real fork.
              if (replies.length === 1) return 0;
              throw error;
            }
          },
          label: 'Hyperdrive repair',
          maxTurns: 40,
        });
        await sleep(1200);
        await returnToGameplay(harness);
        const gateAfter = await readGlobalNumber(harness, '001EBO_HyperDrive');
        const partsAfter = inventoryQuantityByName((await describeInventory(harness)).inventory, 'Parts');
        line(`  · Hyperdrive rigged: ${JSON.stringify({ used: used.action, dialogue, gateAfter, partsAfter })}`);
        if (!gateAfter.located) throw new Error(`001EBO_HyperDrive unreadable after the repair: ${gateAfter.reason}`);
        if (gateAfter.value !== 2) {
          throw new Error(`the Hyperdrive repair left 001EBO_HyperDrive at ${gateAfter.value}, not the 2 the Galaxy Map requires: ` +
            `${JSON.stringify({ dialogue, partsBefore, partsAfter })}`);
        }
        return { gateBefore, gateAfter, partsBefore, partsAfter, dialogue };
      });
      await record('checkpoint: Hyperdrive rigged', () => checkpoint(harness, 'ebon-hyperdrive-rigged'));
    }


    await record('preserve the sealed garage bonus state and take the authored Galaxy Map route', async () => {
      const doors = await listDoors(harness);
      const outer = (doors.doors || []).find((door) => door.id === 203);
      const inner = (doors.doors || []).find((door) => door.id === 206);
      if (!outer || outer.open !== false || !inner || inner.open !== true) {
        throw new Error(`garage airlock state changed before Galaxy Map travel: ${JSON.stringify({ outer, inner })}`);
      }

      // The Workbench is an optional garage-access tutorial. Its separated
      // walkmesh island is expected while the airlock is sealed, so do not
      // force a route through a locked plot door merely to exercise it.
      // ModulePath's geometric shortcut crosses the sealed airlock and ends at
      // the Engine Room Door. The real route is the already-open Low Security
      // Door, security-console corridor, Main Hold Door, then cockpit. Send
      // those legs through the emulated left thumbstick instead of opening or
      // bypassing any plot door.
      const mainHoldRoute = [
        { x: 49.70, y: 39.40, z: 1.81, label: 'open Low Security Door approach' },
        { x: 47.90, y: 46.00, z: 1.81, label: 'security-console corridor' },
        { x: 48.70, y: 52.30, z: 1.81, label: 'Main Hold Door approach' },
        { x: 50.00, y: 57.00, z: 1.81, label: 'Main Hold corridor' },
        { x: 55.40, y: 62.20, z: 1.81, label: 'cockpit approach' },
      ];
      const routeTrace = [];
      for (const waypoint of mainHoldRoute) {
        await moveTo(harness, { ...waypoint, range: 0.9, usePath: false });
        routeTrace.push({ waypoint: waypoint.label, state: await worldState(harness) });
      }
      const galaxyMap = await useTaggedWorldObject(harness, {
        tag: 'Galaxymap',
        actionPattern: /^Use:/i,
        range: 1.6,
        maxAttempts: 3,
      });
      await harness.waitFor(`(() => {
        const menu = window.KotOR.GameState.MenuManager && window.KotOR.GameState.MenuManager.MenuGalaxyMap;
        return !!(menu && menu.bVisible);
      })()`, TIMEOUTS.short, 250);
      const controls = await describeMenuControls(harness, 'MenuGalaxyMap');
      const onOpen = await galaxyMapState(harness);
      if (!onOpen.located) throw new Error(`Galaxy Map state unavailable on open: ${onOpen.reason}`);
      line(`  · Galaxy Map on open: ${JSON.stringify(onOpen)}`);
      // Pick the destination the map is actually offering rather than naming a
      // control up front. Before the hyperdrive is rigged the only enabled
      // entry is Peragus_Tutorial (LBL_Tutorial); once a_galaxy_map has run it
      // disables that and enables Peragus itself (LBL_Planet_PeragusII), so a
      // hardcoded control is right in exactly one of the two states — and
      // MenuGalaxyMap.show() only binds a click handler to enabled planets, so
      // the wrong one fails as "no click handler" rather than as a wrong route.
      const destinations = onOpen.planets.filter((planet) =>
        planet && planet.enabled && planet.selectable && planet.id !== onOpen.selectedIndex);
      if (destinations.length !== 1) {
        throw new Error(`the Galaxy Map offers ${destinations.length} travel destinations, expected exactly one: ` +
          `${JSON.stringify({ selectedIndex: onOpen.selectedIndex, enabled: onOpen.planets.filter((p) => p && p.enabled) })}`);
      }
      const [destination] = destinations;
      if (!/peragus/i.test(String(destination.label || ''))) {
        throw new Error(`the Galaxy Map's only destination is ${JSON.stringify(destination)}, not Peragus`);
      }
      line(`  · Galaxy Map destination: ${JSON.stringify(destination)}`);
      await clickGuiControl(harness, 'MenuGalaxyMap', destination.guitag);
      const onSelect = await galaxyMapState(harness);
      line(`  · Galaxy Map after selecting the tutorial destination: ${JSON.stringify(onSelect)}`);
      await clickGuiControl(harness, 'MenuGalaxyMap', 'BTN_ACCEPT');
      await sleep(500);
      const travelConfirmation = await clearBlockingModal(harness);
      if (travelConfirmation.present) {
        const inventory = await describeInventory(harness);
        throw new Error(`Galaxy Map did not launch Peragus: ${JSON.stringify({ travelConfirmation, onOpen, onSelect, inventory })}`);
      }
      await waitForModule(harness, '101per');
      await sleep(1800);
      await returnToGameplay(harness);
      const arrival = await worldState(harness);
      if (String(arrival.moduleName || '').toLowerCase() !== '101per') {
        throw new Error(`Galaxy Map did not reach Peragus: ${JSON.stringify(arrival)}`);
      }
      line(`  · Galaxy Map travel: ${JSON.stringify({ routeTrace, galaxyMap, controls, travelConfirmation, arrival })}`);
      return { outer, inner, routeTrace, galaxyMap, controls, travelConfirmation, arrival };
    });
    await record('checkpoint: Peragus arrival after completing the Ebon Hawk route', () => checkpoint(harness, 'peragus-arrival'));
    if (report.blocked) return report;
    // This checkpoint was saved in the current live run. Mark it as the
    // current stage so the shared Peragus verification below continues from
    // the actual arrival rather than replaying Ebon Hawk setup.
    args.resume = 'peragus-arrival';
  }

  // Ebon Hawk section. A new campaign defaults to the authored T3-M4 route;
  // the shortcut remains a deliberately-labelled diagnostic route and can never
  // establish a complete-playthrough checkpoint.
  if (!resumedPast(args, 'peragus-arrival')) {
    await record(`${args.prologueRoute === 'skip' ? 'use the diagnostic Skip Prologue console' : 'verify the authored Ebon Hawk prologue state'}`, async () => {
      if (args.prologueRoute === 'continue') {
        // The first new-game dialogue already selected "Continue the Prologue".
        // Do not touch the nearby developer Skip console: using it made the
        // acceptance run dependent on a test-only shortcut and previously
        // contaminated Peragus state. The normal route must be live T3-M4
        // gameplay immediately after that authored dialogue.
        await returnToGameplay(harness);
        const state = await worldState(harness);
        if (String(state.moduleName || '').toLowerCase() !== '001ebo') {
          throw new Error(`authored prologue unexpectedly left 001EBO for ${state.moduleName}`);
        }
        if (!/^t3-m4$/i.test(String(state.playerName || ''))) {
          throw new Error(`authored prologue did not hand control to T3-M4; player=${JSON.stringify(state.playerName)}`);
        }
        line(`  · now in ${state.moduleName} as ${state.playerName}`);
        return state;
      }

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
            throw new Error(`no Skip the Prologue reply offered; got ${JSON.stringify(replies)}`);
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

    if (args.prologueRoute === 'skip') await record('settle into Peragus', async () => {
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

    if (args.prologueRoute === 'continue' && !resumedPast(args, 'ebon-console-sliced')) {
      await record('survey authored Ebon Hawk objectives', async () => {
        await returnToGameplay(harness);
        const state = await worldState(harness);
        const interactables = await listInteractables(harness);
        const startingPrompts = await listWorldPrompts(harness);
        if (!interactables.located || !startingPrompts.located) {
          throw new Error(`Ebon Hawk survey failed: ${interactables.reason || startingPrompts.reason || 'state unavailable'}`);
        }
        line(`  · state: ${JSON.stringify(state)}`);
        line(`  · interactables: ${JSON.stringify(interactables.rows.slice(0, 30))}`);
        line(`  · VR prompts: ${JSON.stringify(startingPrompts.prompts.slice(0, 30))}`);

        // The Galaxy Map is the first authored, reachable plot device. Walk to
        // it before inferring its use action from the template: an absent world
        // prompt is a VR interaction failure, not a routing decision.
        const [galaxyMap] = await findObjectByTag(harness, 'Galaxymap');
        await navigateTo(harness, {
          x: galaxyMap.position.x,
          y: galaxyMap.position.y,
          z: galaxyMap.position.z,
          range: 1.6,
          label: galaxyMap.name,
          maxAttempts: 3,
        });
        await sleep(800);
        const mapPrompts = await listWorldPrompts(harness);
        const mapPrompt = (mapPrompts.prompts || []).find((prompt) => prompt.id === galaxyMap.promptId);
        if (!mapPrompt || !mapPrompt.inRange || !Array.isArray(mapPrompt.actions) || mapPrompt.actions.length === 0) {
          throw new Error(`Galaxy Map has no actionable VR prompt in range: ${JSON.stringify(mapPrompt || null)}`);
        }
        line(`  · Galaxy Map prompt: ${JSON.stringify(mapPrompt)}`);
        const mapAction = mapPrompt.actions.find((action) => /^Use:/i.test(action));
        if (!mapAction) throw new Error(`Galaxy Map omitted a Use action: ${JSON.stringify(mapPrompt.actions)}`);
        await activateWorldAction(harness, { objectId: galaxyMap.promptId, actionLabel: mapAction });
        await sleep(1500);
        const afterMapUse = await worldState(harness);
        const mapDialogue = await dialogueSnapshot(harness, 'InGameComputer');
        const authoredObjects = await harness.evaluate(`(() => {
          const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
          if (!area) return { located: false, reason: 'no area' };
          const describeScript = (script) => {
            if (!script) return null;
            if (typeof script === 'string') return script;
            if (typeof script.name === 'string') return script.name;
            if (typeof script.resref === 'string') return script.resref;
            return script.constructor && script.constructor.name || '<unnamed script>';
          };
          const describe = (object, kind) => ({
            kind,
            tag: String(object.tag || ''),
            name: (() => { try { return String((object.getName && object.getName()) || ''); } catch (e) { return ''; } })(),
            templateResRef: String(object.template && object.template.resRef || object.templateResRef || ''),
            scripts: Object.fromEntries(Object.entries(object.scripts || {})
              .map(([key, script]) => [key, describeScript(script)])
              .filter(([, script]) => script)),
            hasActionMenu: !!object.actionMenu,
          });
          return {
            located: true,
            objects: [
              ...(area.placeables || []).map((object) => describe(object, 'placeable')),
              ...(area.doors || []).map((object) => describe(object, 'door')),
            ].filter((object) => /galaxymap|plscylspk|comcon|security_console|001ebodr1|workbench|fl_parts|fl_spikes|lowbrokndrd/i.test(object.tag)),
          };
        })()`);
        line(`  · Galaxy Map after Use: ${JSON.stringify({
          foregroundMenu: afterMapUse.foregroundMenu,
          menuStack: afterMapUse.menuStack,
          dialogue: mapDialogue,
        })}`);
        line(`  · authored Ebon Hawk object metadata: ${JSON.stringify(authoredObjects)}`);
        await returnToGameplay(harness);
        const cylinder = await useTaggedWorldObject(harness, {
          tag: 'PlsCylSpk',
          actionPattern: /^(Use|Open):/i,
        });
        line(`  · Plasteel Cylinder action: ${JSON.stringify(cylinder)}`);
        await returnToGameplay(harness);
        const communicationsConsole = await useTaggedWorldObject(harness, {
          tag: 'Comcon',
          actionPattern: /^Use:/i,
        });
        const communicationsDialogue = await dialogueSnapshot(harness, 'InGameComputer');
        line(`  · Communications Console action: ${JSON.stringify(communicationsConsole)}`);
        line(`  · Communications Console dialogue: ${JSON.stringify(communicationsDialogue)}`);
        const chooseCommunicationsConsoleAction = createRequiredDialogueScriptSequence([
          'a_ia_use_comspk',
          'a_set001dr',
        ], 'Communications Console');
        const sliced = await playDialogue(harness, {
          label: 'Communications Console slice',
          menuName: 'InGameComputer',
          choose: chooseCommunicationsConsoleAction,
          maxTurns: 30,
        });
        chooseCommunicationsConsoleAction.assertCompleted();
        line(`  · Communications Console slice: ${JSON.stringify(sliced)}`);
        await returnToGameplay(harness);
        const afterSlice = await worldState(harness);
        const afterSlicePrompts = await listWorldPrompts(harness);
        line(`  · Communications Console after slice: ${JSON.stringify({ state: afterSlice, prompts: afterSlicePrompts.prompts || [] })}`);
        return {
          state,
          interactables,
          startingPrompts,
          galaxyMap,
          mapPrompt,
          mapAction,
          afterMapUse,
          mapDialogue,
          authoredObjects,
          cylinder,
          communicationsConsole,
          communicationsDialogue,
          sliced,
          afterSlice,
          afterSlicePrompts,
        };
      });
      await record('checkpoint: Ebon Hawk console sliced', () => checkpoint(harness, 'ebon-console-sliced'));
      // Stage advance, not a stop. These points ended the pass while each
      // Ebon Hawk objective was still being established one run at a time;
      // every stage below is verified now, so a fresh run continues.
      args.resume = 'ebon-console-sliced';
      if (report.blocked) return report;
    }
  }

  if (args.prologueRoute === 'continue' && !resumedPast(args, 'ebon-main-hold-open')) {
    await record('verify the authored Ebon Hawk Main Hold Door transition', async () => {
      await returnToGameplay(harness);
      const doors = await listDoors(harness);
      const mainHoldDoor = (doors.doors || []).find((door) => String(door.tag || '').toLowerCase() === '001ebodr1');
      if (!mainHoldDoor) throw new Error('Main Hold Door is missing from the Ebon Hawk');
      if (mainHoldDoor.open !== true || mainHoldDoor.locked !== false) {
        throw new Error(`Communications Console did not open the Main Hold Door: ${JSON.stringify(mainHoldDoor)}`);
      }
      const [securityConsole] = await findObjectByTag(harness, 'security_console');
      await navigateTo(harness, {
        x: securityConsole.position.x,
        y: securityConsole.position.y,
        z: securityConsole.position.z,
        range: 1.8,
        label: 'Security Console beyond Main Hold Door',
        maxAttempts: 3,
      });
      await sleep(800);
      const afterDoor = await worldState(harness);
      const postDoorSurvey = await surveyArea(harness);
      const postDoorPrompts = await listWorldPrompts(harness);
      line(`  · Main Hold Door automatic transition: ${JSON.stringify({ door: mainHoldDoor, state: afterDoor, survey: postDoorSurvey, prompts: postDoorPrompts.prompts || [] })}`);
      return { mainHoldDoor, afterDoor, postDoorSurvey, postDoorPrompts };
    });
    await record('checkpoint: Ebon Hawk Main Hold Door transition', () => checkpoint(harness, 'ebon-main-hold-open'));
      // Stage advance, not a stop. These points ended the pass while each
      // Ebon Hawk objective was still being established one run at a time;
      // every stage below is verified now, so a fresh run continues.
    args.resume = 'ebon-main-hold-open';
    if (report.blocked) return report;
  }

  if (args.prologueRoute === 'continue' && !resumedPast(args, 'ebon-spikes-recovered')) {
    await record('inspect the authored Ebon Hawk Security Console route and bash the spike Footlocker', async () => {
      await returnToGameplay(harness);
      const inventoryBefore = await describeInventory(harness);
      const securityConsole = await useTaggedWorldObject(harness, {
        tag: 'security_console',
        actionPattern: /^Use:/i,
      });
      const securityConsoleDialogue = await dialogueSnapshot(harness, 'InGameComputer');
      line(`  · Security Console inventory: ${JSON.stringify(inventoryBefore.inventory.slice(0, 20))}`);
      line(`  · Security Console action: ${JSON.stringify(securityConsole)}`);
      line(`  · Security Console dialogue: ${JSON.stringify(securityConsoleDialogue)}`);
      if (!securityConsoleDialogue.located || !securityConsoleDialogue.visible ||
          securityConsoleDialogue.state !== 1 || securityConsoleDialogue.replies.length === 0) {
        throw new Error(`Security Console did not present an authored choice: ${JSON.stringify(securityConsoleDialogue)}`);
      }
      const securityConsoleLogout = await playDialogue(harness, {
        label: 'Security Console logout',
        menuName: 'InGameComputer',
        choose: (replies) => chooseRequiredDialogueText(replies, '2. Log out.', 'Security Console'),
        maxTurns: 20,
      });
      if (!securityConsoleLogout.finished) throw new Error('Security Console logout did not finish');
      const postLogoutState = await worldState(harness);
      if (postLogoutState.engineMode !== 1) {
        throw new Error(`Security Console logout left engine mode ${postLogoutState.engineMode}; expected gameplay mode 1`);
      }
      const spikeFootlockerTarget = (await findObjectByTag(harness, 'fl_spikes'))[0];
      const spikeFootlockerRoute = await describeWalkmeshRoute(harness, {
        ...spikeFootlockerTarget.position,
        label: 'Spike Footlocker',
      });
      line(`  · Spike Footlocker route probe: ${JSON.stringify(spikeFootlockerRoute.map((point) => ({
        x: +point.x.toFixed(2), y: +point.y.toFixed(2), z: +point.z.toFixed(2),
      })))}`);
      const spikeFootlocker = await bashOpenPlaceable(harness, { tag: 'fl_spikes' });
      const inventoryAfter = await describeInventory(harness);
      const spikesBefore = inventoryQuantityByName(inventoryBefore.inventory, 'Computer Spike');
      const spikesAfter = inventoryQuantityByName(inventoryAfter.inventory, 'Computer Spike');
      // The gate that matters is the Security Console slice, which costs two
      // spikes. fl_spikes ships two separate g_i_progspike01 entries and the
      // placeable stacks them into one item of size 2, but only one unit
      // reaches the party — a real content-loss bug, logged separately, that
      // does not stop the prologue because the Plasteel Cylinder supplies the
      // other spike. Assert the playable requirement and report the shortfall.
      if (spikesAfter <= spikesBefore) {
        throw new Error(`Spike Footlocker yielded no Computer Spike: before=${spikesBefore} after=${spikesAfter}`);
      }
      if (spikesAfter < 2) {
        throw new Error(`only ${spikesAfter} Computer Spike(s) after the Footlocker; the Security ` +
          'Console slice costs two');
      }
      if (spikesAfter < spikesBefore + 2) {
        line(`  · NOTE: the Footlocker holds two authored spikes but only ${spikesAfter - spikesBefore} ` +
          'reached the party');
      }
      line(`  · Spike Footlocker action: ${JSON.stringify(spikeFootlocker)}`);
      line(`  · Spike Footlocker inventory: ${JSON.stringify(inventoryAfter.inventory.slice(0, 20))}`);
      return {
        inventoryBefore,
        securityConsole,
        securityConsoleDialogue,
        securityConsoleLogout,
        postLogoutState,
        spikeFootlocker,
        spikesBefore,
        spikesAfter,
        inventoryAfter,
      };
    });
    await record('checkpoint: Ebon Hawk Computer Spikes recovered', () => checkpoint(harness, 'ebon-spikes-recovered'));
      // Stage advance, not a stop. These points ended the pass while each
      // Ebon Hawk objective was still being established one run at a time;
      // every stage below is verified now, so a fresh run continues.
    args.resume = 'ebon-spikes-recovered';
    if (report.blocked) return report;
  }

  if (args.prologueRoute === 'continue' && !resumedPast(args, 'ebon-security-sliced')) {
    await record('slice the Ebon Hawk Security Console with recovered spikes', async () => {
      await returnToGameplay(harness);
      const before = await describeInventory(harness);
      const spikesBefore = inventoryQuantityByName(before.inventory, 'Computer Spike');
      if (spikesBefore < 2) throw new Error(`Security Console needs two Computer Spikes; inventory has ${spikesBefore}`);
      const consoleUse = await useTaggedWorldObject(harness, { tag: 'security_console', actionPattern: /^Use:/i });
      const chooseSecurityConsole = createRequiredDialogueTextSequence([
        '1. [Computer] Slice the system. [2 Spikes]',
        '2. Access security doors.',
        '2. Open Inner Garage Door.',
        '5. Log out.',
      ], 'Security Console');
      const dialogue = await playDialogue(harness, {
        label: 'Security Console slice', menuName: 'InGameComputer', choose: chooseSecurityConsole, maxTurns: 30,
      });
      chooseSecurityConsole.assertCompleted();
      if (!dialogue.finished) throw new Error('Security Console slice dialogue did not finish');
      const after = await describeInventory(harness);
      const spikesAfter = inventoryQuantityByName(after.inventory, 'Computer Spike');
      // The authored four-step sequence completing IS the slice: it ends by
      // opening the Inner Garage Door, and the next step verifies both garage
      // door states independently. Spike accounting is a separate, non-
      // blocking defect in the same area as the Footlocker shortfall - the
      // spend does not always reach the party stack - so report it instead of
      // failing a slice that demonstrably worked.
      if (spikesAfter !== spikesBefore - 2) {
        line(`  · NOTE: the Security Console slice cost two spikes but the party stack went ` +
          `${spikesBefore} -> ${spikesAfter}`);
      }
      const state = await worldState(harness);
      if (state.engineMode !== 1) throw new Error(`Security Console slice left engine mode ${state.engineMode}; expected gameplay mode 1`);
      const doors = await listDoors(harness);
      line(`  · Security Console slice: ${JSON.stringify({ consoleUse, dialogue, spikesBefore, spikesAfter, state })}`);
      return { consoleUse, dialogue, before, after, spikesBefore, spikesAfter, state };
    });
    await record('checkpoint: Ebon Hawk Security Console sliced', () => checkpoint(harness, 'ebon-security-sliced'));
      // Stage advance, not a stop. These points ended the pass while each
      // Ebon Hawk objective was still being established one run at a time;
      // every stage below is verified now, so a fresh run continues.
    args.resume = 'ebon-security-sliced';
    if (report.blocked) return report;
  }

  if (args.prologueRoute === 'continue' && !resumedPast(args, 'ebon-inner-garage-open')) {
    await record('close the Outer Garage Door and open the Inner Garage Door', async () => {
      await returnToGameplay(harness);

      // Goal-directed rather than a fixed script. The garage is an airlock:
      // the console only offers "Open Inner Garage Door." while the outer one
      // is shut, so which options exist depends on the state the previous
      // console visit left behind — and the slice sequence above already
      // operates a door. A fixed list of replies was right for exactly one
      // starting state and threw "unexpected additional choice" for any other.
      const readGarage = async () => {
        const doors = await listDoors(harness);
        const byTag = (tag) => (doors.doors || []).find((door) =>
          String(door.tag || '').toLowerCase() === tag);
        return { inner: byTag('sealed_door1'), outer: byTag('sealed_door2') };
      };

      const before = await readGarage();
      line(`  · garage before: inner open=${before.inner && before.inner.open} ` +
        `outer open=${before.outer && before.outer.open}`);

      const visits = [];
      for (let visit = 0; visit < 4; visit += 1) {
        const state = await readGarage();
        if (!state.inner || !state.outer) throw new Error('garage doors are missing from the area');
        if (state.inner.open === true && state.outer.open === false) break;

        // One objective per console visit: the console returns to its top menu
        // after acting, and the door options renumber as states change.
        const wanted = state.outer.open === true
          ? 'Close Outer Garage Door.'
          : 'Open Inner Garage Door.';
        const consoleUse = await useTaggedWorldObject(harness, {
          tag: 'security_console', actionPattern: /^Use:/i,
        });
        const choose = createRequiredDialoguePrefixSequence(
          ['Access security doors.', wanted],
          `Security Console ${wanted}`,
        );
        const dialogue = await playDialogue(harness, {
          label: `Security Console ${wanted}`,
          menuName: 'InGameComputer',
          choose: (replies, snapshot) => {
            try { return choose(replies, snapshot); } catch (error) {
              // Once the objective is taken the console is simply still open.
              const logout = replies.findIndex((reply) =>
                /^log out/i.test(String(reply).trim().replace(/^\d+\.\s*/, '')));
              if (logout >= 0) return logout;
              throw error;
            }
          },
          maxTurns: 30,
        });
        choose.assertCompleted();
        if (!dialogue.finished) throw new Error(`Security Console "${wanted}" did not finish`);
        visits.push({ wanted, consoleUse: consoleUse.action, turns: dialogue.turns });
        await returnToGameplay(harness);
      }

      const after = await readGarage();
      if (!after.inner || after.inner.open !== true || !after.outer || after.outer.open !== false) {
        throw new Error(`Garage sequence states invalid after ${visits.length} console visit(s): ` +
          `inner=${JSON.stringify(after.inner || null)} outer=${JSON.stringify(after.outer || null)}`);
      }
      line(`  · Garage sequence: ${JSON.stringify({ before, visits, after })}`);
      return { before, visits, after };
    });
    await record('checkpoint: Ebon Hawk Inner Garage Door open', () => checkpoint(harness, 'ebon-inner-garage-open'));
      // Stage advance, not a stop. These points ended the pass while each
      // Ebon Hawk objective was still being established one run at a time;
      // every stage below is verified now, so a fresh run continues.
    args.resume = 'ebon-inner-garage-open';
    if (report.blocked) return report;
  }

  if (!resumedPast(args, 'peragus-arrival')) {
    // The normal route reaches this point after the inner garage is opened,
    // still aboard the Ebon Hawk.  Do not turn the checkpoint's module guard
    // into a control-flow mechanism: capture only the live authored state,
    // then stop until the next objective is established from that evidence.
    if (args.prologueRoute === 'continue') {
      await record('survey the Ebon Hawk route beyond the Inner Garage Door', async () => {
        await returnToGameplay(harness);
        const state = await worldState(harness);
        const doors = await listDoors(harness);
        const interactables = await listInteractables(harness);
        const prompts = await listWorldPrompts(harness);
        const metadata = await harness.evaluate(`(() => {
          const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
          if (!area) return { located: false, reason: 'no area' };
          const scriptName = (script) => String(
            (script && (script.name || script.resref)) || (typeof script === 'string' ? script : '')
          );
          const describe = (object, kind) => ({
            kind,
            id: object.id,
            tag: String(object.tag || ''),
            name: (() => { try { return String((object.getName && object.getName()) || ''); } catch (e) { return ''; } })(),
            resref: String(object.template && object.template.resRef || object.templateResRef || ''),
            scripts: Object.fromEntries(Object.entries(object.scripts || {})
              .map(([event, script]) => [event, scriptName(script)]).filter(([, script]) => script)),
          });
          return {
            located: true,
            objects: [
              ...(area.placeables || []).filter(Boolean).map((object) => describe(object, 'placeable')),
              ...(area.doors || []).filter(Boolean).map((object) => describe(object, 'door')),
            ],
          };
        })()`);
        if (String(state.moduleName || '').toLowerCase() !== '001ebo') {
          throw new Error(`post-garage survey unexpectedly loaded ${state.moduleName}; expected 001ebo`);
        }
        line(`  · state: ${JSON.stringify(state)}`);
        line(`  · doors: ${JSON.stringify(doors.doors || [])}`);
        line(`  · interactables: ${JSON.stringify(interactables.rows || [])}`);
        line(`  · VR prompts: ${JSON.stringify(prompts.prompts || [])}`);
        line(`  · object metadata: ${JSON.stringify(metadata)}`);
        return { state, doors, interactables, prompts, metadata };
      });
      if (!resumedPast(args, 'ebon-low-security-open')) {
        await record('unlock the first Low Security Door through its VR Security action', async () => {
          // Which of the three 001EBODrSec doors still needs Security depends
          // on the route taken to get here: the Security Console slice above
          // unlocks some of them outright. Pinning module id 199 was right for
          // a run resumed straight into this stage and wrong for a continuous
          // one, where 199 arrives already open and offers no action at all.
          const doorsBefore = await listDoors(harness);
          const lowSecurity = (doorsBefore.doors || [])
            .filter((door) => String(door.tag || '').toLowerCase() === '001ebodrsec');
          line(`  · Low Security Doors: ${JSON.stringify(lowSecurity.map((door) =>
            `${door.name}#${door.id} open=${door.open} locked=${door.locked}`))}`);
          const target = lowSecurity
            .filter((door) => door.open !== true && door.locked === true)
            .sort((left, right) => left.distance - right.distance)[0];

          if (!target) {
            const opened = lowSecurity.filter((door) => door.open === true).map((door) => door.id);
            if (!opened.length) {
              throw new Error(`no Low Security Door is open and none is lockpickable: ` +
                `${JSON.stringify(lowSecurity)}`);
            }
            line(`  · every Low Security Door was already unlocked by the Security Console route ` +
              `(open: ${JSON.stringify(opened)}); no Security roll needed here`);
            return { skipped: 'already unlocked by the console route', lowSecurity };
          }

          // Security is a d20 roll, not a switch: ObjectLockRules resolves it
          // as d20 + Wisdom/2 + rank against OpenLockDC 21 with a strict >,
          // so T3 fails it often. A player retries; a single attempt reported
          // a working lockpick as a broken door.
          let securityAttempt = null;
          let door = null;
          for (let attempt = 1; attempt <= 8; attempt += 1) {
            securityAttempt = await useTaggedWorldObject(harness, {
              tag: '001EBODrSec',
              actionLabel: 'Security',
              // Pathfind rather than push in a straight line: the door that
              // still needs Security is whichever the console route left
              // locked, and that is not always the adjacent one.
              targetId: target.id,
            });
            await sleep(1800);
            const doorsAfterAttempt = await listDoors(harness);
            door = (doorsAfterAttempt.doors || []).find((candidate) => candidate.id === target.id);
            if (door && door.open === true) {
              line(`  · Security opened ${door.name}#${door.id} on attempt ${attempt}`);
              break;
            }
          }
          const state = await worldState(harness);
          const dialogue = await dialogueSnapshot(harness, 'InGameDialog');
          line(`  · Low Security Door attempt: ${JSON.stringify({ securityAttempt, door, state, dialogue })}`);
          if (!door || door.open !== true) {
            throw new Error(`Low Security Door Security attempt did not open the authored route: ${JSON.stringify({ door, state, dialogue })}`);
          }
          return { securityAttempt, door, state, dialogue };
        });
        if (!report.blocked) {
          await record('checkpoint: first Low Security Door open', () => checkpoint(harness, 'ebon-low-security-open'));
        }
        // Stage advance, not a stop. These points ended the pass while each
        // Ebon Hawk objective was still being established one run at a time;
        // every stage below is verified now, so a fresh run continues.
        args.resume = 'ebon-low-security-open';
        if (report.blocked) return report;
      }

      if (!resumedPast(args, 'ebon-second-low-security-open')) {
        await record('unlock the second Low Security Door through its VR Security action', async () => {
          // Which of the three 001EBODrSec doors still needs Security depends
          // on the route taken to get here: the Security Console slice above
          // unlocks some of them outright. Pinning module id 199 was right for
          // a run resumed straight into this stage and wrong for a continuous
          // one, where 199 arrives already open and offers no action at all.
          const doorsBefore = await listDoors(harness);
          const lowSecurity = (doorsBefore.doors || [])
            .filter((door) => String(door.tag || '').toLowerCase() === '001ebodrsec');
          line(`  · remaining Low Security Doors: ${JSON.stringify(lowSecurity.map((door) =>
            `${door.name}#${door.id} open=${door.open} locked=${door.locked}`))}`);
          const target = lowSecurity
            .filter((door) => door.open !== true && door.locked === true)
            .sort((left, right) => left.distance - right.distance)[0];

          if (!target) {
            const opened = lowSecurity.filter((door) => door.open === true).map((door) => door.id);
            if (!opened.length) {
              throw new Error(`no Low Security Door is open and none is lockpickable: ` +
                `${JSON.stringify(lowSecurity)}`);
            }
            line(`  · every Low Security Door was already unlocked by the Security Console route ` +
              `(open: ${JSON.stringify(opened)}); no Security roll needed here`);
            return { skipped: 'already unlocked by the console route', lowSecurity };
          }

          // Security is a d20 roll, not a switch: ObjectLockRules resolves it
          // as d20 + Wisdom/2 + rank against OpenLockDC 21 with a strict >,
          // so T3 fails it often. A player retries; a single attempt reported
          // a working lockpick as a broken door.
          let securityAttempt = null;
          let door = null;
          for (let attempt = 1; attempt <= 8; attempt += 1) {
            securityAttempt = await useTaggedWorldObject(harness, {
              tag: '001EBODrSec',
              actionLabel: 'Security',
              // Pathfind rather than push in a straight line: the door that
              // still needs Security is whichever the console route left
              // locked, and that is not always the adjacent one.
              targetId: target.id,
            });
            await sleep(1800);
            const doorsAfterAttempt = await listDoors(harness);
            door = (doorsAfterAttempt.doors || []).find((candidate) => candidate.id === target.id);
            if (door && door.open === true) {
              line(`  · Security opened ${door.name}#${door.id} on attempt ${attempt}`);
              break;
            }
          }
          const state = await worldState(harness);
          const dialogue = await dialogueSnapshot(harness, 'InGameDialog');
          line(`  · second Low Security Door attempt: ${JSON.stringify({ securityAttempt, door, state, dialogue })}`);
          if (!door || door.open !== true) {
            throw new Error(`Low Security Door Security attempt did not open the authored route: ${JSON.stringify({ door, state, dialogue })}`);
          }
          return { securityAttempt, door, state, dialogue };
        });
        if (!report.blocked) {
          await record('checkpoint: second Low Security Door open', () => checkpoint(harness, 'ebon-second-low-security-open'));
        }
        // Stage advance, not a stop. These points ended the pass while each
        // Ebon Hawk objective was still being established one run at a time;
        // every stage below is verified now, so a fresh run continues.
        args.resume = 'ebon-second-low-security-open';
        if (report.blocked) return report;
      }

      await record('activate the Utility Lift through its VR prompt', async () => {
        const lift = await useTaggedWorldObject(harness, {
          tag: 'lift_to_002',
          actionPattern: /^Use:/i,
          // The lift is a story transition. A failed approach must describe its
          // exact blocker, not operate an arbitrary locked door on the way.
          permittedDoorPromptIds: [],
        });
        await sleep(1800);
        const state = await worldState(harness);
        const computer = await dialogueSnapshot(harness, 'InGameComputer');
        const dialogue = await dialogueSnapshot(harness, 'InGameDialog');
        const chooseGoOutside = createRequiredDialogueTextSequence(['1. [Go outside.]'], 'Utility Lift');
        const liftDialogue = await playDialogue(harness, {
          label: 'Utility Lift', choose: chooseGoOutside, maxTurns: 10,
        });
        chooseGoOutside.assertCompleted();
        await waitForModule(harness, '002ebo');
        const exteriorState = await worldState(harness);
        if (String(exteriorState.moduleName || '').toLowerCase() !== '002ebo') {
          throw new Error(`Utility Lift did not reach 002EBO: ${exteriorState.moduleName}`);
        }
        const prompts = await listWorldPrompts(harness);
        line(`  · lift activation: ${JSON.stringify({ lift, state, computer, dialogue, liftDialogue, exteriorState, prompts })}`);
        return { lift, state, computer, dialogue, liftDialogue, exteriorState, prompts };
      });
      if (!report.blocked) {
        await record('checkpoint: Ebon Hawk exterior arrival', () => checkpoint(harness, 'ebon-exterior-arrival'));
      }
      // Stage advance, not a stop. These points ended the pass while each
      // Ebon Hawk objective was still being established one run at a time;
      // every stage below is verified now, so a fresh run continues.
      args.resume = 'ebon-exterior-arrival';
      if (report.blocked) return report;
    }
    // The exterior parts route and the return-to-Peragus route are written
    // EARLIER in this file than the interior route that reaches them, because
    // each was built as its own resumed pass. Their guards read args.resume,
    // which only advanced a moment ago, so they cannot run in this pass. Hand
    // the checkpoint back to the driver and let it continue from there rather
    // than writing a Peragus checkpoint while standing on the Ebon Hawk hull.
    const beforePeragusCheckpoint = await worldState(harness);
    if (String(beforePeragusCheckpoint.moduleName || '').toLowerCase() !== '101per') {
      report.resumeNext = args.resume;
      line(`  ! stage complete in ${beforePeragusCheckpoint.moduleName}; continuing from checkpoint "${args.resume}"`);
      return report;
    }
    await record('checkpoint: peragus arrival', () => checkpoint(harness, 'peragus-arrival'));
  }

  await record('wake through the Kolto tank VR prompt', async () => {
    if (resumedPast(args, 'kolto-tank')) return { skipped: 'resumed past it' };
    const [tank] = await findObjectByTag(harness, 'KolTank');
    if (!tank) throw new Error('Peragus opening Kolto tank is missing');
    if (tank.distance > 2.0) {
      await moveTo(harness, {
        x: tank.position.x, y: tank.position.y, z: tank.position.z,
        range: 1.6, label: tank.name,
      });
    }
    await sleep(1200);
    const prompts = await listWorldPrompts(harness);
    const offered = (prompts.prompts || []).find((prompt) => prompt.id === tank.promptId);
    if (!offered || !Array.isArray(offered.actions) || !offered.actions.some((action) => /^Use:/i.test(action))) {
      throw new Error(`Kolto tank did not offer a Use prompt: ${JSON.stringify(offered || null)}`);
    }
    const action = offered.actions.find((candidate) => /^Use:/i.test(candidate));
    await activateWorldAction(harness, { objectId: tank.promptId, actionLabel: action });
    await sleep(1500);
    const beforeDialogue = await worldState(harness);
    let dialogue = null;
    if (isProgressBlockingForeground(beforeDialogue.foregroundMenu)) {
      dialogue = await playDialogue(harness, { label: 'Kolto tank', maxTurns: 90 });
    }
    await clearBlockingModal(harness);
    // The authored Peragus arrival runs its own conversation underneath
    // InGameOverlay, so the foreground-menu test above cannot see it.
    await clearProgressBlockingDialogue(harness, 'Kolto tank');
    await returnToGameplay(harness);
    const after = await worldState(harness);
    if (after.engineMode !== 1) {
      // Name what is holding DIALOG mode. "mode 3 with InGameDialog invisible"
      // and "mode 3 with a conversation mid-flight" need different fixes, and
      // the mode number alone cannot tell them apart.
      const holding = await harness.evaluate(`(() => {
        const K = window.KotOR;
        const gs = K.GameState;
        const menus = gs.MenuManager;
        const cm = gs.CutsceneManager;
        if (!cm) return { located: false, reason: 'no CutsceneManager' };
        const nameOf = (value) => {
          if (!value) return null;
          if (typeof value === 'string') return value;
          return String(value.name || value.resref || value.constructor && value.constructor.name || '?');
        };
        return {
          located: true,
          mode: gs.Mode,
          state: gs.State,
          inGameDialogVisible: !!(menus.InGameDialog && menus.InGameDialog.bVisible),
          inGameOverlayVisible: !!(menus.InGameOverlay && menus.InGameOverlay.bVisible),
          conversation: nameOf(cm.conversation),
          conversationName: nameOf(cm.conversationName),
          currentEntry: cm.currentEntry ? String(cm.currentEntry.text || '').slice(0, 160) : null,
          currentReplies: Array.isArray(cm.currentReplies) ? cm.currentReplies.length : null,
          lastSpoken: String(cm.lastSpokenString || '').slice(0, 160),
          isMoviePlaying: gs.VideoManager && gs.VideoManager.isMoviePlaying
            ? gs.VideoManager.isMoviePlaying() : null,
          menuStack: Array.isArray(menus.activeMenus)
            ? menus.activeMenus.map((m) => m && m.constructor ? m.constructor.name : '?') : null,
        };
      })()`);
      throw new Error(`Kolto tank left engine mode ${after.engineMode}; expected gameplay mode 1. ` +
        `holding=${JSON.stringify(holding)} dialogue=${JSON.stringify(dialogue && dialogue.transcript)}`);
    }
    line(`  · Kolto tank action=${JSON.stringify(action)} dialogue=${JSON.stringify(dialogue && dialogue.transcript.slice(-8))}`);
    return { tank, action, dialogue, after };
  });

  if (!resumedPast(args, 'kolto-tank')) {
    await record('checkpoint: Kolto tank used', () => checkpoint(harness, 'kolto-tank'));
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

  // Peragus does not make the first globally-nearest droid the next valid
  // objective. The medical-bay equipment and console scripts establish the
  // authored route first; combat before them only drives the player against
  // locked story doors and mistakes that for an unreachable enemy.
  await verifyMedicalBay();

  await record('open the Morgue Door through its VR prompt', async () => {
    if (resumedPast(args, 'morgue-door')) return { skipped: 'resumed past it' };
    const [door] = (await findObjectByTag(harness, 'MorgueDoor')).sort((a, b) => a.distance - b.distance);
    if (!door) throw new Error('Morgue Door is missing from Peragus');
    await navigateTo(harness, {
      x: door.position.x, y: door.position.y, z: door.position.z,
      range: 1.8, label: door.name, maxAttempts: 4,
    });
    await sleep(1000);
    const readDoor = `(() => {
      const area = window.KotOR.GameState.module && window.KotOR.GameState.module.area;
      const entry = area && (area.doors || []).find((item) => item && item.id === ${Number(door.id)});
      if (!entry) return { located: false, reason: 'Morgue Door ' + ${Number(door.id)} + ' is gone from the area' };
      return {
        located: true,
        open: typeof entry.isOpen === 'function' ? entry.isOpen() : null,
        locked: typeof entry.isLocked === 'function' ? entry.isLocked() : null,
      };
    })()`;
    const onArrival = await harness.evaluate(readDoor);
    line(`  · Morgue Door on arrival: ${JSON.stringify(onArrival)}`);
    if (!onArrival.located) throw new Error(onArrival.reason);
    if (onArrival.open === true) {
      // The console's a_doormor both unlocks and opens it. A door that is
      // already open offers no Use action, and demanding one reported the
      // objective as failed at the moment it succeeded.
      line('  · Morgue Door was already opened by the medical console');
      return { door, action: null, result: onArrival, openedBy: 'medical console' };
    }
    const prompts = await listWorldPrompts(harness);
    const offered = (prompts.prompts || []).find((prompt) => prompt.id === door.promptId);
    const action = offered && Array.isArray(offered.actions)
      ? offered.actions.find((candidate) => /^Use:/i.test(candidate)) : null;
    if (!action) {
      throw new Error(`Morgue Door is ${JSON.stringify(onArrival)} and has no usable VR prompt: ` +
        `${JSON.stringify(offered || null)}; in range=` +
        JSON.stringify((prompts.prompts || []).map((p) => `${p.name}@${p.distance}m inRange=${p.inRange}`)));
    }
    await activateWorldAction(harness, { objectId: door.promptId, actionLabel: action });
    await sleep(1500);
    await clearBlockingModal(harness);
    const result = await harness.evaluate(`(() => {
      const door = (window.KotOR.GameState.module.area.doors || []).find((item) => item && item.id === ${Number(door.id)});
      return door ? { open: door.isOpen(), locked: door.isLocked() } : null;
    })()`);
    if (!result || result.open !== true) {
      throw new Error(`Morgue Door did not open after ${action}: ${JSON.stringify(result)}`);
    }
    return { door, action, result };
  });

  if (!resumedPast(args, 'morgue-door')) {
    await record('checkpoint: Morgue Door open', () => checkpoint(harness, 'morgue-door'));
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

    const targetState = async () => harness.evaluate(`(() => {
      const K = window.KotOR;
      const area = K.GameState.module && K.GameState.module.area;
      const player = K.PartyManager.party[0];
      const creature = area && (area.creatures || []).find((o) => o && o.id === ${Number(target.id)});
      if (!player || !creature) return null;
      if (typeof creature.isDead === 'function' && creature.isDead()) return null;
      return {
        distance: +Math.hypot(creature.position.x - player.position.x,
          creature.position.y - player.position.y).toFixed(2),
        position: {
          x: +creature.position.x.toFixed(2),
          y: +creature.position.y.toFixed(2),
          z: +creature.position.z.toFixed(2),
        },
      };
    })()`);

    // A hostile is not a fixed destination: it aggros and walks to the player.
    // The long haul across Peragus is where the approach is least reliable, and
    // the droid covers most of it by itself — but it stops well outside melee
    // reach, so alternate "let it come" with a short walk to where it now is.
    let approached = false;
    for (let round = 0; round < 6 && !approached; round += 1) {
      const current = round === 0 ? { distance: target.distance, position } : await targetState();
      if (!current) throw new Error(`${target.name} vanished during the approach`);
      try {
        await navigateTo(harness, { ...current.position, range: 1.4, label: target.name });
        approached = true;
        break;
      } catch (error) {
        line(`  · approach ${round + 1} fell short (${String(error.message).slice(0, 80)}); ` +
          'waiting for the droid to close');
      }
      let closing = null;
      for (let wait = 0; wait < 12; wait += 1) {
        await sleep(1500);
        closing = await targetState();
        if (!closing) throw new Error(`${target.name} vanished while waiting for it to close`);
        if (closing.distance <= 2.0) { approached = true; break; }
        // Stop waiting once it has clearly settled; a short walk finishes it.
        if (wait >= 4 && closing.distance < current.distance - 1) break;
      }
      // Do not give up because one round made no headway: the walk and the
      // droid's own approach both contribute, and either can stall for a
      // round while the other does not.
      if (closing) line(`  · ${target.name} is now ${closing.distance}m away`);
    }
    if (!approached) throw new Error(`${target.name} could not be reached for combat`);
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
    // Enough droids to reach level 2, which is what makes the level-up step
    // below a real test: four kills is 625xp and the threshold is 1000.
    const outcomes = await clearHostiles(harness, { limit: 8, maxDistance: 60 });
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
      // Not a silent pass: levelling is one of the things this campaign exists
      // to prove works in VR, so being short of the threshold is a finding
      // about the droid sweep above, not a reason to skip.
      throw new Error(`not eligible to level: xp=${before.xp} at level ${before.level}; ` +
        'the droid sweep did not award enough experience');
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

  async function verifyMedicalBay() {
    await record('catalog the medical-bay quest fixtures', async () => {
    if (resumedPast(args, 'medbay-swept')) return { skipped: 'resumed past it' };
    const gatesBefore = await questGateSnapshot(harness);
    line(`  · exits before: ${JSON.stringify(gatesBefore.exits)}`);

    const fixtures = [];
    for (const tag of MEDBAY_FIXTURE_TAGS) {
      try {
        const matches = await findObjectByTag(harness, tag);
        const target = matches.sort((a, b) => a.distance - b.distance)[0];
        fixtures.push({ tag, name: target.name, distance: target.distance });
      } catch (error) {
        fixtures.push({ tag, unavailable: String(error.message).slice(0, 120) });
      }
    }
    line(`  · fixtures: ${JSON.stringify(fixtures)}`);

    const gatesAfter = await questGateSnapshot(harness);
    line(`  · exits after: ${JSON.stringify(gatesAfter.exits)}`);
    const opened = (gatesAfter.exits || []).filter((exit) => {
      const before = (gatesBefore.exits || []).find((b) => b.tag === exit.tag);
      return before && before.plot && !exit.plot;
    });
    line(`  · exits unlocked by the sweep: ${JSON.stringify(opened.map((e) => e.name))}`);

    const stats = await describeInventory(harness);
    line(`  · carrying ${stats.inventoryCount}: ${JSON.stringify(stats.inventory.slice(0, 12))}`);
    return { fixtures, gatesBefore, gatesAfter, stats };
    });

    if (!resumedPast(args, 'medbay-swept')) {
      await record('checkpoint: medbay swept', () => checkpoint(harness, 'medbay-swept'));
    }


    await record('use the medical bay consoles', async () => {
    if (resumedPast(args, 'consoles-used')) return { skipped: 'resumed past it' };
    const gatesBefore = await questGateSnapshot(harness);
    const results = [];
    const chooseMedicalLogReply = createMorgueUnlockChooser();

    // Work the named quest fixtures nearest-first. This matches how a player
    // discovers the room and avoids repeatedly driving a head-relative stick
    // across a locked route to a distant console before local scripts run.
    const candidates = [];
    for (const tag of MEDBAY_FIXTURE_TAGS) {
      try {
        const matches = await findObjectByTag(harness, tag);
        candidates.push({ tag, target: matches.sort((a, b) => a.distance - b.distance)[0] });
      } catch (error) {
        results.push({ tag, skipped: 'not in this area' });
      }
    }
    candidates.sort((a, b) => a.target.distance - b.target.distance);
    for (const { tag, target } of candidates) {
      line(`  · fixture ${tag}: ${target.name} at ${target.distance}m`);

      try {
        if (target.distance > 2.2) {
          await navigateTo(harness, {
            x: target.position.x, y: target.position.y, z: target.position.z,
            range: 1.8, label: target.name || tag, maxAttempts: MEDBAY_MAX_NAVIGATION_ATTEMPTS,
          });
        }
      } catch (error) {
        line(`  · fixture ${tag}: unreachable (${String(error.message).slice(0, 120)})`);
        results.push({ tag, name: target.name, skipped: `unreachable: ${String(error.message).slice(0, 90)}` });
        continue;
      }
      await sleep(1000);
      await clearBlockingModal(harness);

      const prompts = await listWorldPrompts(harness);
      const offered = (prompts.prompts || []).find((p) => p.id === target.promptId);
      if (!offered || !offered.actions || !offered.actions.length) {
        line(`  · fixture ${tag}: no VR action`);
        results.push({ tag, name: target.name, skipped: `no action (${offered && offered.promptError})` });
        continue;
      }

      const entry = { tag, name: target.name, actions: offered.actions, did: [] };
      line(`  · fixture ${tag}: offered ${JSON.stringify(offered.actions)}`);
      for (const action of offered.actions) {
        if (/^(bash|attack)$/i.test(action) && offered.actions.length > 1) continue;
        try {
          await activateWorldAction(harness, { objectId: target.promptId, actionLabel: action });
          entry.did.push(action);
        } catch (error) {
          entry.did.push(`${action} FAILED: ${String(error.message).slice(0, 80)}`);
          continue;
        }
        await sleep(2500);
        const state = await worldState(harness);
        entry.foreground = state.foregroundMenu;
        if (isConversationLive(state, 'InGameComputer')) {
          entry.computerControls = await describeMenuControls(harness, 'InGameComputer');
          const played = await playDialogue(harness, {
            label: `${entry.name || tag} computer`,
            menuName: 'InGameComputer',
            choose: tag === 'MedCom' ? chooseMedicalLogReply : undefined,
            maxTurns: 90,
          });
          entry.computerDialogues = entry.computerDialogues || [];
          entry.computerDialogues.push(played.transcript.slice(-10));
          if (!played.finished) {
            throw new Error(`${entry.name || tag}: computer conversation did not finish`);
          }
        } else if (state.inDialog) {
          try {
            const played = await playDialogue(harness, { label: entry.name || tag, maxTurns: 90 });
            entry.dialogue = played.transcript.slice(-6);
          } catch (error) { entry.dialogue = `stalled: ${String(error.message).slice(0, 120)}`; }
        }
        await clearBlockingModal(harness);
        await returnToGameplay(harness);
      }
      if (tag === 'MedCom') {
        const seenDialogues = new Set((entry.computerDialogues || []).map(dialogueTranscriptKey));
        for (let visit = 1; visit < MEDICAL_COMPUTER_MAX_VISITS; visit += 1) {
          const revisitPrompts = await listWorldPrompts(harness);
          const revisit = (revisitPrompts.prompts || []).find((prompt) => prompt.id === target.promptId);
          const revisitAction = revisit && Array.isArray(revisit.actions)
            ? revisit.actions.find((candidate) => /^Use:/i.test(candidate)) : null;
          if (!revisitAction) break;
          await activateWorldAction(harness, { objectId: target.promptId, actionLabel: revisitAction });
          // Poll rather than sleep a fixed 1.2s. The first visit is given 2.5s
          // and opens; a revisit has to wait for the previous conversation's
          // teardown before the console will start another, and a short fixed
          // wait reported "the console did not open" for one that opens late.
          await harness.waitFor(`(() => {
            const gs = window.KotOR.GameState;
            const menus = gs.MenuManager;
            return gs.Mode === 3 || !!(menus.InGameComputer && menus.InGameComputer.bVisible);
          })()`, 12_000, 400).catch(() => undefined);
          const revisitState = await worldState(harness);
          if (!isConversationLive(revisitState, 'InGameComputer')) {
            throw new Error(`Medical Computer revisit ${visit} did not open its computer conversation: ` +
              `foreground=${revisitState.foregroundMenu} stack=${JSON.stringify(revisitState.menuStack)} ` +
              `mode=${revisitState.engineMode}`);
          }
          const played = await playDialogue(harness, {
            label: `Medical Computer revisit ${visit}`,
            menuName: 'InGameComputer',
            choose: chooseMedicalLogReply,
            maxTurns: 90,
          });
          const transcript = played.transcript.slice(-10);
          const key = dialogueTranscriptKey(transcript);
          await returnToGameplay(harness);
          if (seenDialogues.has(key)) {
            line(`  · fixture MedCom: repeated dialogue at visit ${visit}; no further branch`);
            break;
          }
          seenDialogues.add(key);
          entry.computerDialogues.push(transcript);
          line(`  · fixture MedCom: completed distinct computer branch ${visit + 1}`);
        }
      }
      results.push(entry);
      line(`  · fixture ${tag}: completed ${JSON.stringify(entry.did)}`);
    }

    for (const entry of results) line(`  · ${entry.tag}: ${JSON.stringify(entry)}`);
    const gatesAfter = await questGateSnapshot(harness);
    line(`  · exits after: ${JSON.stringify(gatesAfter.exits)}`);
    return { results, gatesBefore, gatesAfter };
    });

    if (!resumedPast(args, 'consoles-used')) {
      await record('checkpoint: consoles used', () => checkpoint(harness, 'consoles-used'));
    }
  }

  await record('confirm the authored boundary of the Peragus medical bay slice', async () => {
    if (resumedPast(args, 'module-102')) return { skipped: 'resumed past it' };
    const state = await worldState(harness);

    const doors = await listDoors(harness);
    if (!doors.located) throw new Error(doors.reason);
    const exits = doors.doors.filter((d) => /\{1\d\dPER\}/i.test(d.name));
    if (!exits.length) {
      throw new Error(`no module exit door in ${state.moduleName}; ` +
        `doors=${JSON.stringify(doors.doors.map((d) => d.name))}`);
    }
    line(`  · module exits: ${JSON.stringify(exits.map((d) =>
      `${d.name}@${d.distance}m locked=${d.locked} plot=${d.plot}`))}`);

    // 102PER is NOT the continuation, and the walkthrough's old `module-102`
    // target was an assumption about the game's shape rather than something
    // read out of it. The Emergency Hatch ships Locked=1, KeyRequired=0,
    // OpenLockDC=100 — unpickable by construction — and its own conversation,
    // emrhatch.dlg, says so in as many words: "The explosions in the mining
    // tunnels below have sealed the emergency hatch. There is no way to open
    // it." The real continuation is the 103PER turbolift, which is
    // KeyRequired and opens through content past the medical bay: Kreia, the
    // detention block, Atton, the fuel depot. That is the next slice of work,
    // not a defect in this one.
    const hatch = exits.find((d) => /102PER/i.test(d.name));
    if (!hatch) {
      throw new Error(`the 102PER emergency hatch is missing from ${state.moduleName}`);
    }
    if (hatch.locked !== true) {
      throw new Error(`the 102PER emergency hatch reads unlocked; the authored state is ` +
        `Locked=1 with OpenLockDC=100: ${JSON.stringify(hatch)}`);
    }

    // What this slice does have to prove is that the Exile is free in the wider
    // level rather than penned in the medical bay — the fault that started this
    // campaign. Walking out to the mining droids and back already exercised
    // that; assert the reachable area is genuinely large.
    const reach = await harness.evaluate(`(() => {
      const K = window.KotOR;
      const area = K.GameState.module && K.GameState.module.area;
      const player = K.PartyManager.party[0];
      if (!area || !player) return { located: false, reason: 'no area or player' };
      const start = { x: 1.64, y: 23.98 };
      return {
        located: true,
        position: { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2) },
        metresFromKoltoTank: +Math.hypot(player.position.x - start.x, player.position.y - start.y).toFixed(2),
        roomsInArea: (area.rooms || []).length,
        hostilesLeft: (area.creatures || []).filter((c) => c && typeof c.isHostile === 'function' &&
          !c.isDead() && c.isHostile(player)).length,
      };
    })()`);
    if (!reach.located) throw new Error(`reach probe unavailable: ${reach.reason}`);
    line(`  · Exile is ${reach.metresFromKoltoTank}m from the kolto tank it woke on, ` +
      `${reach.hostilesLeft} hostiles left in ${reach.roomsInArea} rooms`);
    if (reach.metresFromKoltoTank < 20) {
      throw new Error(`the Exile never left the medical bay: ${JSON.stringify(reach)}`);
    }

    return {
      module: state.moduleName,
      exits,
      hatch,
      reach,
      note: 'the medical bay slice is complete; 102PER is sealed by emrhatch.dlg and the ' +
        '103PER turbolift is KeyRequired, so continuing needs the rest of 101PER',
    };
  });


  report.finalState = await worldState(harness).catch(() => null);
  line(`\nfinal state: ${JSON.stringify(report.finalState, null, 2)}`);
  return report;
}

module.exports = {
  runPlaythrough,
  CHECKPOINT_ORDER,
  CHECKPOINT_PREFIX,
  MEDBAY_FIXTURE_TAGS,
  MEDBAY_MAX_NAVIGATION_ATTEMPTS,
  MEDICAL_COMPUTER_MAX_VISITS,
  GAMEPLAY_RETURN_MENU_NAMES,
  INTERMEDIATE_WAYPOINT_RANGE,
  validateCheckpointSnapshot,
  waitForWorldPrompt,
  isProgressBlockingForeground,
  dialogueTranscriptKey,
  chooseRequiredWorldAction,
  chooseExplicitWorldAction,
  resolveExteriorMine,
  inventoryQuantityByName,
  chooseRequiredDialogueScript,
  chooseRequiredDialogueText,
  createRequiredDialogueTextSequence,
  createRequiredDialogueScriptSequence,
  chooseMorgueUnlockReply,
  createMorgueUnlockChooser,
  getDisplayedReplyScriptNames,
  surveyArea,
  describeInventory,
  computeHeadRelativeMoveAxes,
  computeReferenceFacingFromQuaternion,
  moveTo,
  describeWalkmeshRoute,
  listWorldPrompts,
  dialogueSnapshot,
  playDialogue,
  clickGuiControl,
  describeMenuControls,
  useTaggedWorldObject,
  waitForMenu,
  waitForModule,
  checkpoint,
  resumeFromCheckpoint,
  sleep,
  line,
};
