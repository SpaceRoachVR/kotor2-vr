/**
 * Workbench probe (ROADMAP 7.7).
 *
 * Boots the browser build against an emulated Quest 3 on an isolated copy of
 * the SpaceRoach Peragus save, loads 103PER (the fuel depot) and drives the
 * real Workbench (tag 000_Workbench, OnUsed k_workbench): the first use starts
 * the help conversation and opens nothing; the second use runs
 * ShowUpgradeScreen, which opens MenuComponent. Then: create an upgrade
 * (components and inventory), break a blaster down (yield from the main
 * character's Repair, whoever uses the bench; a medpac is never offered), a
 * companion as the user, greyed rows under the VR ray, stick scrolling and
 * the list kept after Accept, the create/breakdown reply script run directly
 * (k_workbench_bd, workbnch.dlg's reply when party NPC 7 is not available), the
 * prologue's tutitemcreate table and its K_REPAIR_PART override tag
 * (k_workbench_tut), a missing override table falling back to itemcreate,
 * the upgrade reply script (k_workbench_t3, upgrades only: a notice, no screen), chemicals
 * untouched, PNGs of both panels, and the component count across save/reload.
 *
 *   node tools/vr-emulator/probe-workbench.js
 *
 * Build first (npm run webpack:dev): the asset service serves dist/.
 * Prints a JSON summary; exits non-zero when any check fails.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');
const { landed, loadModule } = require('./probe-memory-growth');
const { enterVrSession, playDialogue } = require('./playthrough-steps');

const CDP_PORT = 9475;
const ASSET_PORT = 8515;
const SAVE_DIRECTORY = 'Saves/000100 - Game99';
const MODULE = '103PER';
const SCRATCH_SAVE_ID = 141;
const UPGRADE = 'u_r_targ_01';
const BLASTER = 'w_blaste_01';
const RIFLE = 'w_brifle_10';
const MEDPAC = 'g_i_medeqpmnt01';
const PART = 'g_i_parts01';
const NOTICE = "Upgrading items isn't available yet.";
const REPAIR = 5;
const AWARENESS = 3;
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const FIXTURE_CANDIDATES = [
  path.join(EVIDENCE_DIR, 'spaceroach-saves-ZaBsC0', 'user'),
  path.join('C:', 'Users', 'allen', 'source', 'repos', 'kotor2-vr', 'tools', 'vr-emulator', 'evidence', 'spaceroach-saves-ZaBsC0', 'user'),
];

const GAME_ROOT = process.env.KOTOR2_GAME_ROOT || path.join('D:', 'SteamLibrary', 'steamapps', 'common', 'Knights of the Old Republic II');
/** k_workbench_tut lives in the prologue module's archives, not in 103PER's or the BIFs. */
const TUT_SCRIPT_ARCHIVES = ['001ebo.mod', '001EBO_s.rim'];
const NCS_TYPE = 2010;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One resource from a module archive (ERF/MOD or RIM), or null. */
function readArchiveResource(file, resref, type) {
  if (!fs.existsSync(file)) return null;
  const b = fs.readFileSync(file);
  const want = resref.toLowerCase();
  const name = (o) => b.toString('latin1', o, o + 16).split(String.fromCharCode(0))[0].toLowerCase();
  if (b.toString('latin1', 0, 4) === 'RIM ') {
    const n = b.readUInt32LE(12), keys = b.readUInt32LE(16);
    for (let i = 0; i < n; i++) {
      const e = keys + i * 32;
      if (name(e) === want && b.readUInt32LE(e + 16) === type) return b.subarray(b.readUInt32LE(e + 24), b.readUInt32LE(e + 24) + b.readUInt32LE(e + 28));
    }
    return null;
  }
  const n = b.readUInt32LE(16), keys = b.readUInt32LE(24), res = b.readUInt32LE(28);
  for (let i = 0; i < n; i++) {
    const k = keys + i * 24, r = res + i * 8;
    if (name(k) === want && b.readUInt16LE(k + 20) === type) return b.subarray(b.readUInt32LE(r), b.readUInt32LE(r) + b.readUInt32LE(r + 4));
  }
  return null;
}

function isolatedUserRoot() {
  const fixture = FIXTURE_CANDIDATES.find((candidate) => fs.existsSync(path.join(candidate, SAVE_DIRECTORY)));
  if (!fixture) throw new Error('SpaceRoach save fixture not found: ' + FIXTURE_CANDIDATES.join(' | '));
  const userRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2-workbench-')), 'user');
  fs.cpSync(path.join(fixture, SAVE_DIRECTORY), path.join(userRoot, SAVE_DIRECTORY), { recursive: true });
  return { fixture, userRoot };
}

/** Page-side helpers, installed once per page as window.__wb. */
const PAGE_HELPERS = `(() => {
  const K = window.KotOR, g = K.GameState;
  const menu = () => g.MenuManager.MenuComponent;
  const resrefOf = (i) => String(i.getTemplateResRef?.() || i.getTag?.() || '').toLowerCase();
  const count = (resref) => g.InventoryManager.inventory
    .filter((i) => resrefOf(i) === resref)
    .reduce((n, i) => n + (Number(i.getStackSize()) || 0), 0);
  const countTag = (tag) => g.InventoryManager.inventory
    .filter((i) => String(i.getTag?.() || '') === tag)
    .reduce((n, i) => n + (Number(i.getStackSize()) || 0), 0);
  const addItem = async (resref, n = 1) => {
    const buffer = await K.ResourceLoader.loadResource(2025, resref);
    for (let i = 0; i < n; i++) g.InventoryManager.addItem(new K.GFFObject(buffer));
  };
  const templateCost = async (resref) => {
    const gff = new K.GFFObject(await K.ResourceLoader.loadResource(2025, resref));
    return Number(gff.RootNode.getFieldByLabel('Cost').getValue());
  };
  const centre = (box) => ({ x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 });
  const pointAt = (p) => {
    const M = K.Mouse;
    const w = g.ResolutionManager.getViewportWidth(), h = g.ResolutionManager.getViewportHeight();
    M.positionUI.set(p.x, p.y); M.Vector.set(p.x, p.y);
    M.positionViewport.set(p.x + w / 2, h / 2 - p.y); M.positionWindow.set(p.x + w / 2, h / 2 - p.y);
    M.position.set(p.x / (w / 2), p.y / (h / 2));
  };
  const inViewport = (box) => {
    const w = g.ResolutionManager.getViewportWidth() / 2, h = g.ResolutionManager.getViewportHeight() / 2;
    return box.min.x >= -w - 0.5 && box.max.x <= w + 0.5 && box.min.y >= -h - 0.5 && box.max.y <= h + 0.5;
  };
  const boxOf = (control) => { control.updateBounds?.(); const b = control.box;
    return { minX: +b.min.x.toFixed(1), minY: +b.min.y.toFixed(1), maxX: +b.max.x.toFixed(1), maxY: +b.max.y.toFixed(1) }; };
  /** Whether the engine's own pointer hit-test (the route the VR pointer adapter uses) finds this control. */
  const targetable = (control) => {
    if (!control || !control.box) return { ok: false, reason: 'no box' };
    control.updateBounds?.();
    const c = centre(control.box);
    pointAt(c);
    const hits = g.controls.MenuGetActiveUIElements();
    return { ok: hits.includes(control), visible: control.isVisible?.() ?? !control.hidden, inViewport: inViewport(control.box), box: boxOf(control) };
  };
  const rowTargetable = (list, index) => {
    const row = list.children[index];
    if (!row) return { ok: false, reason: 'no row ' + index };
    row.updateBounds?.();
    const c = centre(row.box);
    pointAt(c);
    const semantic = list.getVRPointerTargetsAtPointer ? list.getVRPointerTargetsAtPointer() : [];
    const hits = g.controls.MenuGetActiveUIElements();
    return { ok: semantic.length > 0 || hits.includes(row), inViewport: inViewport(row.box) };
  };
  const state = () => {
    const m = menu();
    return {
      visible: !!m.bVisible,
      foreground: g.MenuManager.GetCurrentMenu() === m,
      components: K.PartyManager.ComponentCount,
      chemicals: K.PartyManager.ChemicalCount,
      breakdownMode: m.breakdownMode, category: m.category, breakTab: m.breakTab, recipeTable: m.recipeTable,
      shopRows: m.LB_SHOPITEMS.children.length, invRows: m.LB_INVITEMS.children.length,
      recipes: (m.createViews || []).map((v) => v.recipe.resref),
      breakRows: (m.breakRows || []).map((r) => r.resref),
      labels: {
        credits: m.LBL_CREDITS_VALUE.getText(), cost: m.LBL_COST_VALUE.getText(),
        stock: m.LBL_STOCK_VALUE.getText(), skill: m.LBL_RELATEDSKILL.getText(),
        accept: m.BTN_Accept.getText(), examine: m.BTN_Examine.getText(),
        costLabel: m.LBL_COST.getText(), title: m.LBL_TITLE.getText(),
      },
    };
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const hand = () => window.__xrDevice?.controllers?.right;
  const restAim = (() => { const q = hand()?.quaternion; return q ? [q.x, q.y, q.z, q.w] : [0, 0, 0, 1]; })();
  let aim = { yaw: 0, pitch: 0 };
  /** Turns the right controller: yaw about +Y, then pitch about +X; its ray is -Z. */
  const setAim = (yaw, pitch) => {
    const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sp = Math.sin(pitch / 2), cp = Math.cos(pitch / 2);
    hand().quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  };
  /** Where the real VR ray meets the panel, in GUI units, a few frames after the last turn; null = off the panel. */
  const readPointer = async () => {
    await pause(150);
    const p = K.VRSpike.latestPanelPointerPosition;
    return p ? { x: p.x, y: p.y } : null;
  };
  /** Aims the controller so its ray lands on target (GUI units): Newton steps on yaw and pitch. */
  const aimAt = async (target, tolerance = 4) => {
    if (!hand()) return { ok: false, reason: 'no right controller' };
    setAim(aim.yaw, aim.pitch);
    let p = await readPointer();
    if (!p) {
      search: for (const pitch of [0, -0.2, 0.2, -0.4, 0.4]) {
        for (const yaw of [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6]) {
          setAim(yaw, pitch); p = await readPointer();
          if (p) { aim = { yaw, pitch }; break search; }
        }
      }
      if (!p) return { ok: false, reason: 'ray never met the panel' };
    }
    const d = 0.01;
    for (let i = 0; i < 15; i++) {
      const ex = target.x - p.x, ey = target.y - p.y;
      if (Math.hypot(ex, ey) <= tolerance) return { ok: true, pointer: p, iterations: i };
      setAim(aim.yaw + d, aim.pitch); const py = await readPointer();
      setAim(aim.yaw, aim.pitch + d); const pp = await readPointer();
      if (!py || !pp) return { ok: false, reason: 'probe step left the panel', pointer: p };
      const a = (py.x - p.x) / d, b = (pp.x - p.x) / d, c = (py.y - p.y) / d, e = (pp.y - p.y) / d;
      const det = a * e - b * c;
      if (Math.abs(det) < 1e-6) return { ok: false, reason: 'singular aim', pointer: p };
      let dy = (e * ex - b * ey) / det, dp = (-c * ex + a * ey) / det;
      const size = Math.hypot(dy, dp);
      if (size > 0.3) { dy *= 0.3 / size; dp *= 0.3 / size; }
      aim = { yaw: aim.yaw + dy, pitch: aim.pitch + dp };
      setAim(aim.yaw, aim.pitch); p = await readPointer();
      if (!p) {
        aim = { yaw: aim.yaw - dy / 2, pitch: aim.pitch - dp / 2 };
        setAim(aim.yaw, aim.pitch); p = await readPointer();
        if (!p) return { ok: false, reason: 'overshot the panel' };
      }
    }
    return { ok: Math.hypot(target.x - p.x, target.y - p.y) <= tolerance, pointer: p };
  };
  const resetAim = () => { aim = { yaw: 0, pitch: 0 }; hand()?.quaternion.set(...restAim); };
  const boxCentre = (control) => { control.updateBounds?.(); return centre(control.box); };
  const rowInList = (list, row) => {
    row.updateBounds?.(); list.updateBounds?.();
    const c = centre(row.box);
    return c.x > list.box.min.x && c.x < list.box.max.x && c.y > list.box.min.y && c.y < list.box.max.y;
  };
  /** Scrolls list so row index sits inside the list's box; returns whether it does. */
  const revealRow = (list, index) => {
    const row = list.children[index];
    for (const scroll of [list.scroll, 0, list.maxScroll / 2, list.maxScroll]) {
      list.scroll = scroll; list.updateList();
      if (rowInList(list, row)) return true;
    }
    return false;
  };
  /** The last row inside the list's box that passes accept(index), or -1. */
  const lastVisibleRow = (list, accept) => {
    for (let i = list.children.length - 1; i >= 0; i--) {
      if (accept(i) && rowInList(list, list.children[i])) return i;
    }
    return -1;
  };
  const colour = (label) => ({ r: +label.text.color.r.toFixed(3), g: +label.text.color.g.toFixed(3), b: +label.text.color.b.toFixed(3) });
  /** Text colours of label sampled over ms, so a pulse or hover paint between frames is caught. */
  const sampleColours = async (label, ms = 900) => {
    const samples = [];
    for (let t = 0; t < ms; t += 90) { samples.push(colour(label)); await pause(90); }
    return samples;
  };
  /** Pushes the right stick down, releases, then up, with the ray on list's centre; reads the scroll after each. */
  const stickScroll = async (list) => {
    const stick = hand();
    stick.updateAxes('thumbstick', 0, 0);
    list.scroll = 0; list.updateList();
    const aimed = await aimAt(boxCentre(list));
    await pause(200);
    const hovered = g.MenuManager.hoveredGUIElement === list;
    const before = list.scroll;
    try {
      stick.updateAxes('thumbstick', 0, 1); await pause(750);
      const down = list.scroll;
      stick.updateAxes('thumbstick', 0, 0); await pause(300);
      const neutral = list.scroll;
      stick.updateAxes('thumbstick', 0, -1); await pause(750);
      const up = list.scroll;
      return { aimed, hovered, rows: list.children.length, maxScroll: list.maxScroll, before, down, neutral, up };
    } finally {
      stick.updateAxes('thumbstick', 0, 0);
    }
  };
  /** Ends any running conversation. */
  const endConversations = async () => { const cm = g.CutsceneManager;
    for (let i = 0; i < 10 && cm.active; i++) { cm.endConversation(true); await pause(300); } return !cm.active; };
  /** Closes the screen (Back) if it is open. */
  const close = async () => { const m = menu(); if (m.bVisible) { m.BTN_Cancel.click(); await pause(500); } return { visible: !!m.bVisible, mode: g.Mode }; };
  /**
   * Puts script on the workbench's OnUsed, uses the bench as the player and
   * waits for the screen (or for timeoutMs). Records whether a conversation
   * ran; restores the bench's own OnUsed afterwards.
   */
  const useWithScript = async (name, timeoutMs = 6000) => {
    const bench = window.__workbench, cm = g.CutsceneManager, m = menu();
    const script = name ? K.NWScript.Load(name) : null;
    if (name && !script) return { loaded: false };
    const own = bench.scripts['OnUsed'];
    if (script) bench.scripts['OnUsed'] = script;
    let conversationSeen = !!cm.active;
    try {
      bench.use(K.PartyManager.Player);
      for (let t = 0; t < timeoutMs && !m.bVisible; t += 50) { if (cm.active) conversationSeen = true; await pause(50); }
      await pause(800);
      if (cm.active) conversationSeen = true;
    } finally {
      bench.scripts['OnUsed'] = own;
    }
    return { loaded: true, conversationSeen, conversation: cm.dialog?.resref || null,
      user: m.activeUser() === K.PartyManager.Player, ...state() };
  };
  window.__wb = { menu, count, countTag, addItem, templateCost, targetable, rowTargetable, boxOf, state, aimAt, resetAim,
    boxCentre, revealRow, lastVisibleRow, sampleColours, stickScroll, pause, close, endConversations, useWithScript };
  return true;
})()`;

async function main() {
  const report = { checks: {}, notes: {} };
  const check = (name, value, detail) => {
    report.checks[name] = value === true;
    if (detail !== undefined) report.notes[name] = detail;
    if (value !== true) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
    else console.log(`ok   ${name}`);
  };

  const { fixture, userRoot } = isolatedUserRoot();
  report.fixture = fixture;
  report.userRoot = userRoot;
  const harness = new VrHarness({ port: CDP_PORT });
  let service;
  try {
    service = await startAssetService({ port: ASSET_PORT, userRoot });
    await harness.launch(service.url);
    await harness.waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='OK')`, 90000, 500);
    await harness.evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='OK');b.dataset.wbEula='true';return true;})()`);
    await harness.clickSelector('[data-wb-eula]');
    await harness.waitFor(`document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`, 240000, 1000);
    await harness.evaluate('window.KotOR.SaveGame.GetSaveGames()', { timeoutMs: 120000 });
    await harness.evaluate(`(async()=>{const K=window.KotOR;const s=K.SaveGame.saves.find(s=>s.directory===${JSON.stringify(SAVE_DIRECTORY)});
      if(!s)throw new Error('Peragus save missing');window.__memoryProbeLoad={module:'101PER',error:null};await s.load();return true;})()`, { timeoutMs: 180000 });
    await harness.waitFor(landed, 300000, 500);
    await harness.evaluate(loadModule(MODULE));
    await harness.waitFor(landed, 300000, 500);
    await enterVrSession(harness);
    // Clear any arrival conversation the module queues, as the survey fixtures do.
    await harness.evaluate(`(async()=>{const g=window.KotOR.GameState;for(let n=0;n<8;n++){
      await new Promise(r=>setTimeout(r,250));if(g.CutsceneManager.active)g.CutsceneManager.endConversation(true);
      g.MenuManager.InGameOverlay.open();}return true;})()`, { timeoutMs: 30000 });
    await harness.evaluate(PAGE_HELPERS);
    // Record the warnings and VR notices the engine raises from here on.
    await harness.evaluate(`(()=>{const K=window.KotOR;window.__wbWarnings=[];window.__wbNotices=[];
      const warn=console.warn.bind(console);console.warn=(...a)=>{window.__wbWarnings.push(a.map(String).join(' '));warn(...a);};
      const show=K.VRSpike.showNotice;K.VRSpike.showNotice=function(...a){window.__wbNotices.push(a);return show.apply(this,a);};
      return true;})()`);

    // 1. 200 components; the Exile's Repair total 10 and Awareness at least 4.
    const setup = await harness.evaluate(`(()=>{const K=window.KotOR,p=K.PartyManager.Player;
      const setTotal=(skill,total)=>{for(let i=0;i<5 && p.getSkillTotal(skill)!==total;i++) p.skills[skill].rank=Math.max(0,p.skills[skill].rank+total-p.getSkillTotal(skill));};
      const before={repair:p.getSkillTotal(${REPAIR}),awareness:p.getSkillTotal(${AWARENESS}),components:K.PartyManager.ComponentCount};
      setTotal(${REPAIR},10);
      if(p.getSkillTotal(${AWARENESS})<4) setTotal(${AWARENESS},4);
      K.PartyManager.ComponentCount=200;
      // A non-zero chemical count, so "chemicals unchanged" (11) can fail.
      K.PartyManager.ChemicalCount=37;
      window.__wbChemicals=K.PartyManager.ChemicalCount;
      return {before,repair:p.getSkillTotal(${REPAIR}),awareness:p.getSkillTotal(${AWARENESS}),components:K.PartyManager.ComponentCount,
        chemicals:K.PartyManager.ChemicalCount,module:window.KotOR.GameState.module.filename,
        party:K.PartyManager.party.map(c=>({name:c.getName?.(),isPlayer:!!c.isPlayer})),
        tables:['itemcreate','itemcreatemira','tutitemcreate'].map(t=>[t,!!window.KotOR.GameState.TwoDAManager.datatables.get(t)])};})()`);
    report.notes.setup = setup;
    check('setupRanksAndComponents', setup.repair === 10 && setup.awareness >= 4 && setup.components === 200 && setup.chemicals === 37, setup);

    // 2. The real Workbench. 103PER's GIT places plc_workb_rep (tag Workbench,
    // OnUsed a_compdlg -> workbnch.dlg); that conversation's replies run
    // k_workbench_bd / k_workbench_bdm / k_workbench_t3. The module's own
    // "workbench" template (tag 000_Workbench, OnUsed k_workbench) is not placed,
    // so k_workbench is put on the bench's OnUsed for 2b/2c, as the lab probe
    // does with k_medstation.
    const bench = await harness.evaluate(`(()=>{const K=window.KotOR,g=K.GameState,gv=g.GlobalVariableManager;
      const list=g.module.area.placeables;
      const p=list.find(p=>/^(000_)?workbench$/i.test(String(p.tag||p.getTag?.()||'')))
        || list.find(p=>/^k_workbench/i.test(String(p.scripts?.['OnUsed']?.name||'')));
      if(!p) return {found:false,tags:list.map(p=>p.tag).slice(0,60)};
      window.__workbench=p;
      const before=gv.GetGlobalNumber('000_Workbench');
      if(before!==0) gv.SetGlobalNumber('000_Workbench',0);
      return {found:true,tag:p.tag,name:p.getName?.(),template:p.getTemplateResRef?.()||p.templateResRef||null,
        onUsed:p.scripts?.['OnUsed']?.name||null,conversation:String(p.conversation?.resref||p.conversation||''),globalBefore:before};})()`);
    report.notes.bench = bench;
    check('workbenchFound', bench.found === true, bench);
    if (!bench.found) throw new Error('Workbench placeable not found');

    // 2a. The bench's own OnUsed: workbnch.dlg; no screen while it runs; its
    // create/breakdown reply (k_workbench_bd) opens the screen once it closes.
    const ownUse = await harness.evaluate(`(async()=>{const W=window.__wb,g=window.KotOR.GameState,cm=g.CutsceneManager,m=W.menu();
      window.__workbench.use(window.KotOR.PartyManager.Player);
      for(let i=0;i<120 && !cm.active && !m.bVisible;i++) await W.pause(50);
      await W.pause(500);
      return {active:!!cm.active,resref:cm.dialog?.resref||null,computer:cm.dialog?.getConversationType?.()===1,menuVisible:!!m.bVisible};})()`, { timeoutMs: 60000 });
    report.notes.ownUse = ownUse;
    let ownDialogue = { transcript: [] };
    if (ownUse.active) {
      try {
        ownDialogue = await playDialogue(harness, {
          label: 'Workbench help', maxTurns: 60, menuName: ownUse.computer ? 'InGameComputer' : 'InGameDialog',
          choose: (replies, snapshot) => {
            const scripts = (snapshot && snapshot.replyScripts) || [];
            const bd = scripts.findIndex((name) => /^k_workbench_bd$/i.test(String(name)));
            if (bd >= 0) return bd;
            const text = replies.findIndex((t) => /(create|break ?down|use the workbench)/i.test(String(t)));
            return text >= 0 ? text : 0;
          },
        });
      } catch (e) { ownDialogue.error = String(e); }
    }
    report.notes.ownDialogue = ownDialogue.transcript;
    const afterOwn = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu();
      for(let i=0;i<100 && !m.bVisible;i++) await W.pause(100);
      await W.pause(800);
      return {...W.state(),conversationActive:!!window.KotOR.GameState.CutsceneManager.active,user:m.activeUser()===window.KotOR.PartyManager.Player};})()`, { timeoutMs: 60000 });
    report.notes.afterOwn = afterOwn;
    check('benchConversationReplyOpensScreen', ownUse.active === true && /workbnch/i.test(String(ownUse.resref)) && ownUse.menuVisible === false
      && ownDialogue.transcript.some((line) => /\[script=k_workbench_bd\]/i.test(line))
      && afterOwn.visible && afterOwn.foreground && !afterOwn.conversationActive && afterOwn.user && afterOwn.category === 'ranged'
      && afterOwn.recipeTable === 'itemcreate' && afterOwn.shopRows > 0, { ownUse, transcript: ownDialogue.transcript, error: ownDialogue.error, afterOwn });
    await harness.evaluate(`(async()=>{await window.__wb.endConversations();return window.__wb.close();})()`);

    // 2b. k_workbench, first use (000_Workbench == 0): the help conversation, no screen.
    // k_workbench names no dialogue, so it starts the bench's own: 000_workbench
    // on the unplaced "workbench" template, workbnch on this plc_workb_rep.
    const firstUse = await harness.evaluate(`(async()=>{const r=await window.__wb.useWithScript('k_workbench',8000);
      r.global=window.KotOR.GameState.GlobalVariableManager.GetGlobalNumber('000_Workbench');return r;})()`, { timeoutMs: 60000 });
    report.notes.firstUse = firstUse;
    const ended = await harness.evaluate(`(async()=>{const g=window.KotOR.GameState,cm=g.CutsceneManager,m=window.__wb.menu();
      const wasActive=!!cm.active;
      await window.__wb.endConversations();
      await window.__wb.pause(1500);
      return {wasActive,active:!!cm.active,menuVisible:!!m.bVisible,mode:g.Mode};})()`, { timeoutMs: 60000 });
    report.notes.firstUseEnded = ended;
    check('firstUseStartsHelpConversation', firstUse.loaded === true && firstUse.conversationSeen === true
      && String(firstUse.conversation).toLowerCase() === String(bench.conversation).toLowerCase() && firstUse.visible === false && firstUse.global !== 0
      && ended.active === false && ended.menuVisible === false, { firstUse, ended });

    // 2c. k_workbench again: the screen, directly.
    const secondUse = await harness.evaluate(`window.__wb.useWithScript('k_workbench',8000)`, { timeoutMs: 60000 });
    report.notes.secondUse = secondUse;
    check('secondUseOpensWorkbench', secondUse.conversationSeen === false && secondUse.visible && secondUse.foreground && secondUse.user
      && secondUse.category === 'ranged' && secondUse.shopRows > 0 && secondUse.recipeTable === 'itemcreate'
      && secondUse.labels.credits === '200', secondUse);

    // 3. Create the upgrade from the Ranged tab: components drop by its value, the item is in the bag.
    const created = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),K=window.KotOR;
      const index=m.createViews.findIndex(v=>v.recipe.resref===${JSON.stringify(UPGRADE)});
      if(index<0) return {index,recipes:W.state().recipes};
      const view=m.createViews[index];
      W.revealRow(m.LB_SHOPITEMS,index);
      m.LB_SHOPITEMS.select(m.LB_SHOPITEMS.children[index]);
      const selected=W.state();
      const before={components:K.PartyManager.ComponentCount,count:W.count(${JSON.stringify(UPGRADE)})};
      m.BTN_Accept.click();
      for(let i=0;i<40 && K.PartyManager.ComponentCount===before.components;i++) await W.pause(100);
      await W.pause(300);
      return {index,view:{value:view.value,creatable:view.creatable,requiredRank:view.recipe.requiredRank,skill:view.recipe.skill},
        templateValue:Math.floor(await W.templateCost(${JSON.stringify(UPGRADE)})*0.05),selected,before,
        after:{components:K.PartyManager.ComponentCount,count:W.count(${JSON.stringify(UPGRADE)}),credits:m.LBL_CREDITS_VALUE.getText()}};})()`, { timeoutMs: 60000 });
    report.notes.create = created;
    check('createUpgrade', created.index >= 0 && created.view.value === created.templateValue && created.view.value > 0
      && created.after.components === created.before.components - created.view.value
      && created.after.count === created.before.count + 1 && created.after.credits === String(created.after.components), created);

    // PNG helper: what the VR panel shows.
    const panelFor = async (file) => {
      await sleep(1500);
      const panel = await harness.evaluate(`(()=>{const K=window.KotOR,g=K.GameState,host=K.VRSpike.panelHost,m=window.__wb.menu();
        if(!host) return {host:false};
        const rt=host.renderTarget,w=rt.width,h=rt.height,px=new Uint8Array(w*h*4);
        g.renderer.readRenderTargetPixels(rt,0,0,w,h,px);
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d'),img=ctx.createImageData(w,h);
        for(let y=0;y<h;y++) img.data.set(px.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);
        ctx.putImageData(img,0,0);
        let lit=0;for(let i=0;i<px.length;i+=4) if(px[i]+px[i+1]+px[i+2]>30) lit++;
        return {host:true,presenting:K.VRSpike.isPresenting===true,ownerIsMenu:host.owner===m,visible:host.isVisible,
          foreground:g.MenuManager.GetCurrentMenu()===m,renderTarget:{w,h},litFraction:+(lit/(w*h)).toFixed(3),png:canvas.toDataURL('image/png')};})()`, { timeoutMs: 30000 });
      if (panel.png) {
        fs.writeFileSync(file, Buffer.from(panel.png.split(',')[1], 'base64'));
        delete panel.png;
        panel.file = file;
      }
      return panel;
    };
    const reachOf = async (names) => harness.evaluate(`(()=>{const W=window.__wb,m=W.menu(),out={};
      for(const n of ${JSON.stringify(names)}) out[n]=W.targetable(m[n]);
      const list=m.breakdownMode?m.LB_INVITEMS:m.LB_SHOPITEMS;
      out.list_row0=W.rowTargetable(list,0);
      out.list_box={ok:true,inViewport:(()=>{const b=W.boxOf(list),w=window.KotOR.GameState.ResolutionManager.getViewportWidth()/2,h=window.KotOR.GameState.ResolutionManager.getViewportHeight()/2;
        return b.minX>=-w-0.5&&b.maxX<=w+0.5&&b.minY>=-h-0.5&&b.maxY<=h+0.5;})(),box:W.boxOf(list)};
      return out;})()`);

    // 12a. The create panel: PNG and every tab, counter and button inside it and reachable.
    const createPanel = await panelFor(path.join(EVIDENCE_DIR, 'workbench-panel.png'));
    report.notes.createPanel = createPanel;
    const createReach = await reachOf(['BTN_CREATE_RANGED', 'BTN_CREATE_MELEE', 'BTN_CREATE_ARMOR', 'BTN_CREATE_LIGHTSABER', 'BTN_CREATE_MISC',
      'BTN_Accept', 'BTN_Examine', 'BTN_Cancel', 'LBL_CREDITS_VALUE', 'LBL_COST_VALUE', 'LBL_STOCK_VALUE', 'LBL_RELATEDSKILL']);
    report.notes.createReach = createReach;
    const breakHiddenInCreate = await harness.evaluate(`(()=>{const m=window.__wb.menu();
      return ['BTN_BREAK_ALL','BTN_BREAK_WEAPONS','BTN_BREAK_ARMOR','BTN_BREAK_USEABLE','BTN_BREAK_MISC'].map(n=>[n,!!m[n].isVisible?.()]);})()`);
    report.notes.breakHiddenInCreate = breakHiddenInCreate;
    const buttonsOk = (reach) => Object.entries(reach).every(([name, r]) => r.inViewport === true && (/^LBL_|list_box/.test(name) || r.ok === true));
    check('createPanelFitsAndReachable', createPanel.host && createPanel.presenting && createPanel.ownerIsMenu && createPanel.visible
      && createPanel.litFraction > 0.05 && buttonsOk(createReach) && breakHiddenInCreate.every(([, v]) => v === false),
    { createPanel, createReach, breakHiddenInCreate });

    // 4. Breakdown: the blaster is offered on Weapons, the medpac nowhere; break
    // the blaster down. A blaster pistol's template Cost is 25 (value 1), which
    // yields 0 at Repair 10, so the Repeating Blaster Rifle (Cost 1750, value
    // 87, the spec's example) is broken down too for a non-zero yield.
    const broken = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),K=window.KotOR,p=K.PartyManager.Player;
      await W.addItem(${JSON.stringify(BLASTER)});await W.addItem(${JSON.stringify(RIFLE)});await W.addItem(${JSON.stringify(MEDPAC)});
      m.BTN_Examine.click(); await W.pause(300);
      const all=W.state();
      m.BTN_BREAK_WEAPONS.click(); await W.pause(300);
      const weapons=W.state();
      const breakOne=async(resref)=>{
        const index=m.breakRows.findIndex(r=>r.resref===resref);
        if(index<0) return {index};
        W.revealRow(m.LB_INVITEMS,index);
        m.LB_INVITEMS.select(m.LB_INVITEMS.children[index]);
        const selected=W.state().labels;
        const cost=await W.templateCost(resref);
        const rank=p.getSkillTotal(${REPAIR});
        const expected=Math.floor(Math.floor(cost*0.05)*Math.min(rank,20)/20);
        const before={components:K.PartyManager.ComponentCount,count:W.count(resref)};
        const itemCost=m.breakRows[index].cost;
        m.BTN_Accept.click(); await W.pause(400);
        return {index,cost,itemCost,rank,expected,selected,before,
          after:{components:K.PartyManager.ComponentCount,count:W.count(resref),credits:m.LBL_CREDITS_VALUE.getText(),breakTab:m.breakTab}};
      };
      const blaster=await breakOne(${JSON.stringify(BLASTER)});
      const rifle=await breakOne(${JSON.stringify(RIFLE)});
      return {all:{breakTab:all.breakTab,rows:all.breakRows,labels:all.labels},weapons:{breakTab:weapons.breakTab,rows:weapons.breakRows},
        medpacs:W.count(${JSON.stringify(MEDPAC)}),blaster,rifle};})()`, { timeoutMs: 60000 });
    report.notes.breakdown = broken;
    check('breakdownTabsExcludeMedpac', broken.weapons.breakTab === 'weapons'
      && broken.weapons.rows.includes(BLASTER) && !broken.weapons.rows.includes(MEDPAC)
      && broken.all.breakTab === 'all' && broken.all.rows.includes(BLASTER) && !broken.all.rows.includes(MEDPAC) && broken.medpacs >= 1, broken);
    const yieldOk = (r) => r && r.index >= 0 && r.after.components === r.before.components + r.expected
      && r.after.count === r.before.count - 1 && r.selected.cost === String(r.expected) && r.selected.skill === 'Repair 10'
      && r.selected.accept === 'Breakdown Item' && r.selected.costLabel === 'Component Value'
      && r.after.credits === String(r.after.components) && r.after.breakTab === 'weapons';
    check('breakdownBlasterYield', yieldOk(broken.blaster) && yieldOk(broken.rifle) && broken.rifle.expected === 43, broken);

    // 12b. The breakdown panel: PNG, the five breakdown tabs inside and reachable.
    await harness.evaluate(`(async()=>{const m=window.__wb.menu();m.BTN_BREAK_ALL.click();await window.__wb.pause(300);return true;})()`);
    const breakdownPanel = await panelFor(path.join(EVIDENCE_DIR, 'workbench-panel-breakdown.png'));
    report.notes.breakdownPanel = breakdownPanel;
    const breakdownReach = await reachOf(['BTN_BREAK_ALL', 'BTN_BREAK_WEAPONS', 'BTN_BREAK_ARMOR', 'BTN_BREAK_USEABLE', 'BTN_BREAK_MISC',
      'BTN_Accept', 'BTN_Examine', 'BTN_Cancel', 'LBL_CREDITS_VALUE']);
    report.notes.breakdownReach = breakdownReach;
    // The breakdown tabs sit where the create tabs are: only one row may show.
    const createHiddenInBreakdown = await harness.evaluate(`(()=>{const m=window.__wb.menu();
      return ['BTN_CREATE_RANGED','BTN_CREATE_MELEE','BTN_CREATE_ARMOR','BTN_CREATE_LIGHTSABER','BTN_CREATE_MISC'].map(n=>[n,!!m[n].isVisible?.()]);})()`);
    report.notes.createHiddenInBreakdown = createHiddenInBreakdown;
    check('breakdownPanelFitsAndReachable', breakdownPanel.host && breakdownPanel.ownerIsMenu && breakdownPanel.litFraction > 0.05
      && buttonsOk(breakdownReach) && createHiddenInBreakdown.every(([, v]) => v === false),
    { breakdownPanel, breakdownReach, createHiddenInBreakdown });

    // 5. A companion uses the bench: the Exile stays the main character, so the yield uses the Exile's Repair
    // (the companion's Repair is set to 0, which would yield 1 for the rifle).
    const companion = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),K=window.KotOR,g=K.GameState,p=K.PartyManager.Player;
      await W.close();
      let c=K.PartyManager.party.find(x=>x!==p && !x.isPlayer), source='party';
      if(!c){
        const gff=new K.GFFObject(await K.ResourceLoader.loadResource(2027,'p_atton'));
        c=new g.Module.ModuleArea.ModuleCreature(gff); c.initProperties(); source='template p_atton';
        window.__wbCompanion=c;
      }
      for(let i=0;i<5 && c.getSkillTotal(${REPAIR})>0;i++) c.skills[${REPAIR}].rank=Math.max(0,c.skills[${REPAIR}].rank-c.getSkillTotal(${REPAIR}));
      await W.addItem(${JSON.stringify(RIFLE)});
      await m.openFor(c); await W.pause(500);
      const opened=W.state();
      m.BTN_Examine.click(); await W.pause(300);
      const index=m.breakRows.findIndex(r=>r.resref===${JSON.stringify(RIFLE)});
      if(index<0) return {source,index,opened};
      W.revealRow(m.LB_INVITEMS,index);
      m.LB_INVITEMS.select(m.LB_INVITEMS.children[index]);
      const selected=W.state().labels;
      const cost=await W.templateCost(${JSON.stringify(RIFLE)});
      const expected=Math.floor(Math.floor(cost*0.05)*Math.min(p.getSkillTotal(${REPAIR}),20)/20);
      const before=K.PartyManager.ComponentCount;
      m.BTN_Accept.click(); await W.pause(400);
      const out={source,name:c.getName?.(),companionRepair:c.getSkillTotal(${REPAIR}),exileRepair:p.getSkillTotal(${REPAIR}),
        userIsCompanion:m.activeUser()===c,breakdownRank:m.engine.breakdownRank(),mainIsPlayer:!!p.isPlayer,
        opened:{visible:opened.visible,category:opened.category},selected,expected,before,after:K.PartyManager.ComponentCount};
      await W.close();
      if(window.__wbCompanion){try{g.ModuleObjectManager.RemoveObjectById(window.__wbCompanion.id);}catch(e){}}
      return out;})()`, { timeoutMs: 60000 });
    report.notes.companion = companion;
    check('companionUsesExileRepair', companion.userIsCompanion === true && companion.companionRepair !== 10 && companion.exileRepair === 10
      && companion.breakdownRank === 10 && companion.selected?.skill === 'Repair 10' && companion.expected > 0
      && companion.after === companion.before + companion.expected, companion);

    // 6. Greyed rows, stick scrolling and the list kept after Accept, on the player's screen.
    await harness.evaluate(`(async()=>{const m=window.__wb.menu();await m.openFor(window.KotOR.PartyManager.Player);await window.__wb.pause(800);return true;})()`, { timeoutMs: 60000 });
    const grey = (c) => Math.abs(c.r - 0.5) < 0.01 && Math.abs(c.g - 0.5) < 0.01 && Math.abs(c.b - 0.5) < 0.01;
    const hoverGrey = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),list=m.LB_SHOPITEMS,g=window.KotOR.GameState;
      for(const name of ['BTN_CREATE_RANGED','BTN_CREATE_MELEE','BTN_CREATE_ARMOR','BTN_CREATE_LIGHTSABER','BTN_CREATE_MISC']){
        m[name].click(); await W.pause(300);
        if(m.createViews.some(v=>!v.creatable) && m.createViews.some(v=>v.creatable)) break; }
      const greyIndex=m.createViews.findIndex(v=>!v.creatable), liveIndex=m.createViews.findIndex(v=>v.creatable);
      if(greyIndex<0||liveIndex<0) return {greyIndex,liveIndex,reason:'need one greyed and one creatable row'};
      const out={category:m.category,greyIndex,liveIndex,grey:m.createViews[greyIndex].recipe.resref,live:m.createViews[liveIndex].recipe.resref};
      out.liveRevealed=W.revealRow(list,liveIndex);
      const liveLabel=list.children[liveIndex].children[0];
      out.liveAim=await W.aimAt(W.boxCentre(liveLabel));
      out.liveHover=!!liveLabel.hover;
      out.liveSamples=await W.sampleColours(liveLabel);
      const h=liveLabel.defaultHighlightColor;
      out.liveHighlight={r:+h.r.toFixed(3),g:+h.g.toFixed(3),b:+h.b.toFixed(3)};
      out.revealed=W.revealRow(list,greyIndex);
      const row=list.children[greyIndex],label=row.children[0];
      out.aim=await W.aimAt(W.boxCentre(label));
      out.hovered={label:!!label.hover,row:!!row.hover,listUnderRay:g.MenuManager.hoveredGUIElement===list};
      out.hoverSamples=await W.sampleColours(label);
      list.select(row);
      out.selected=!!row.selected;
      out.selectedSamples=await W.sampleColours(label);
      list.clearSelection();
      out.outAim=await W.aimAt(W.boxCentre(m.BTN_Cancel));
      out.outSamples=await W.sampleColours(label,450);
      return out;})()`, { timeoutMs: 180000 });
    report.notes.hoverGrey = hoverGrey;
    const painted = (hoverGrey.liveSamples || []).some((c) => !grey(c) && c.r === hoverGrey.liveHighlight.r
      && c.g === hoverGrey.liveHighlight.g && c.b === hoverGrey.liveHighlight.b);
    check('greyedRowStaysGrey', !!hoverGrey.liveAim?.ok && hoverGrey.liveHover === true && painted
      && !!hoverGrey.aim?.ok && hoverGrey.revealed === true && (hoverGrey.hovered?.label || hoverGrey.hovered?.row)
      && (hoverGrey.hoverSamples || []).every(grey) && hoverGrey.selected === true && (hoverGrey.selectedSamples || []).every(grey)
      && !!hoverGrey.outAim?.ok && (hoverGrey.outSamples || []).every(grey), hoverGrey);

    const shopScroll = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu();
      for(const name of ['BTN_CREATE_RANGED','BTN_CREATE_MELEE','BTN_CREATE_ARMOR','BTN_CREATE_LIGHTSABER','BTN_CREATE_MISC']){
        m[name].click(); await W.pause(400); if(m.LB_SHOPITEMS.maxScroll>0) break; }
      return {category:m.category,...await W.stickScroll(m.LB_SHOPITEMS)};})()`, { timeoutMs: 120000 });
    report.notes.shopScroll = shopScroll;
    check('stickScrollsRecipeList', !!shopScroll.aimed?.ok && shopScroll.hovered === true && shopScroll.maxScroll > 0
      && shopScroll.down > shopScroll.before && shopScroll.neutral === shopScroll.down && shopScroll.up < shopScroll.down, shopScroll);

    const keptCreate = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),list=m.LB_SHOPITEMS,K=window.KotOR;
      K.PartyManager.ComponentCount=5000; m.refresh(0); await W.pause(300);
      list.scroll=list.maxScroll; list.updateList();
      const index=W.lastVisibleRow(list,(i)=>!!m.createViews[i]?.creatable);
      if(index<0) return {index,maxScroll:list.maxScroll};
      list.select(list.children[index]);
      const before={scroll:list.scroll,components:K.PartyManager.ComponentCount,resref:m.createViews[index].recipe.resref};
      m.BTN_Accept.click();
      for(let i=0;i<40 && K.PartyManager.ComponentCount===before.components;i++) await W.pause(100);
      await W.pause(300);
      return {category:m.category,index,maxScroll:list.maxScroll,before,after:{scroll:list.scroll,
        components:K.PartyManager.ComponentCount,selectedIndex:list.children.indexOf(list.selectedItem)}};})()`, { timeoutMs: 60000 });
    report.notes.keptCreate = keptCreate;
    check('scrollKeptAfterCreate', keptCreate.index >= 0 && keptCreate.before.scroll > 0 && keptCreate.after.components < keptCreate.before.components
      && keptCreate.after.scroll === keptCreate.before.scroll && keptCreate.after.selectedIndex === keptCreate.index, keptCreate);

    // Breakdown with a bag that overflows LB_INVITEMS: three each of up to 12 stackable "Other" recipes.
    const invScroll = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),list=m.LB_INVITEMS,K=window.KotOR;
      const added=[];
      const others=m.session.recipeViews('other').map(v=>v.recipe.resref);
      for(const resref of [...others,...m.displayItems.keys()]){
        if(added.length>=12) break;
        if(added.includes(resref)||resref===${JSON.stringify(MEDPAC)}) continue;
        try{await W.addItem(resref,3);added.push(resref);}catch(e){}
      }
      m.BTN_Examine.click(); await W.pause(400);
      return {added,breakdownMode:m.breakdownMode,breakTab:m.breakTab,...await W.stickScroll(list)};})()`, { timeoutMs: 120000 });
    report.notes.invScroll = invScroll;
    check('stickScrollsBreakdownList', invScroll.breakdownMode === true && !!invScroll.aimed?.ok && invScroll.hovered === true
      && invScroll.maxScroll > 0 && invScroll.down > invScroll.before && invScroll.up < invScroll.down, invScroll);
    const keptBreakdown = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),list=m.LB_INVITEMS,K=window.KotOR;
      list.scroll=list.maxScroll; list.updateList();
      const index=W.lastVisibleRow(list,(i)=>(m.breakRows[i]?.stackSize||0)>1);
      if(index<0) return {index,maxScroll:list.maxScroll};
      list.select(list.children[index]);
      const before={scroll:list.scroll,components:K.PartyManager.ComponentCount,resref:m.breakRows[index].resref};
      m.BTN_Accept.click(); await W.pause(400);
      return {index,maxScroll:list.maxScroll,before,after:{scroll:list.scroll,components:K.PartyManager.ComponentCount,
        selectedIndex:list.children.indexOf(list.selectedItem)}};})()`, { timeoutMs: 60000 });
    report.notes.keptBreakdown = keptBreakdown;
    check('scrollKeptAfterBreakdown', keptBreakdown.index >= 0 && keptBreakdown.before.scroll > 0
      && keptBreakdown.after.components >= keptBreakdown.before.components && keptBreakdown.after.scroll === keptBreakdown.before.scroll
      && keptBreakdown.after.selectedIndex === keptBreakdown.index, keptBreakdown);
    const unselected = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),K=window.KotOR;
      m.LB_INVITEMS.clearSelection();
      const before={components:K.PartyManager.ComponentCount,rows:m.breakRows.length};
      m.BTN_Accept.click(); await W.pause(800);
      const r={before,after:{components:K.PartyManager.ComponentCount,rows:m.breakRows.length}};
      W.resetAim(); return r;})()`, { timeoutMs: 30000 });
    report.notes.unselected = unselected;
    check('acceptWithoutSelectionIsNoop', unselected.before.components === unselected.after.components
      && unselected.before.rows === unselected.after.rows, unselected);
    const closed = await harness.evaluate(`window.__wb.close()`);
    report.notes.closed = closed;
    check('backClosesToPlay', closed.visible === false && closed.mode === 1, closed);

    // 7. The create/breakdown reply script run directly: k_workbench_bd (workbnch.dlg, party NPC 7 not available) opens the screen with no conversation.
    const bd = await harness.evaluate(`window.__wb.useWithScript('k_workbench_bd')`, { timeoutMs: 60000 });
    report.notes.createReplyScript = bd;
    check('createReplyScriptOpensScreen', bd.loaded && bd.conversationSeen === false && bd.visible && bd.foreground && bd.user
      && bd.recipeTable === 'itemcreate' && bd.category === 'ranged' && bd.shopRows > 0, bd);
    await harness.evaluate(`window.__wb.close()`);

    // 8. Prologue table: k_workbench_tut lists tutitemcreate; the created part carries K_REPAIR_PART.
    // The script is read from 001EBO's archive and registered with NWScript so it runs here.
    let tutSource = null, tutBytes = null;
    for (const archive of TUT_SCRIPT_ARCHIVES) {
      tutBytes = readArchiveResource(path.join(GAME_ROOT, 'modules', archive), 'k_workbench_tut', NCS_TYPE);
      if (tutBytes) { tutSource = archive; break; }
    }
    report.notes.tutScriptSource = tutSource;
    if (tutBytes) {
      await harness.evaluate(`(()=>{const K=window.KotOR;const bytes=Uint8Array.from(atob(${JSON.stringify(Buffer.from(tutBytes).toString('base64'))}),c=>c.charCodeAt(0));
        const script=new K.NWScript(bytes);script.name='k_workbench_tut';K.NWScript.scripts.set('k_workbench_tut',script);return true;})()`);
    }
    const tut = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),K=window.KotOR;
      await W.addItem(${JSON.stringify(PART)});
      K.PartyManager.ComponentCount=200;
      const used=await W.useWithScript('k_workbench_tut');
      if(!used.visible) return {used};
      m.BTN_CREATE_MISC.click(); await W.pause(400);
      const other=W.state();
      const table=window.KotOR.GameState.TwoDAManager.datatables.get('tutitemcreate');
      const rows=Object.values(table?.rows||{}).map(r=>({label:String(r.label).toLowerCase(),group:r.group,overridetag:r.overridetag}));
      const index=m.createViews.findIndex(v=>v.recipe.resref===${JSON.stringify(PART)});
      if(index<0) return {used,other,rows,index};
      W.revealRow(m.LB_SHOPITEMS,index);
      m.LB_SHOPITEMS.select(m.LB_SHOPITEMS.children[index]);
      const before={components:K.PartyManager.ComponentCount,tagged:W.countTag('K_REPAIR_PART'),plain:W.count(${JSON.stringify(PART)})};
      m.BTN_Accept.click();
      for(let i=0;i<40 && K.PartyManager.ComponentCount===before.components;i++) await W.pause(100);
      await W.pause(300);
      const out={used:{visible:used.visible,conversationSeen:used.conversationSeen,recipeTable:used.recipeTable},
        other:{category:other.category,recipes:other.recipes},rows,index,view:{overrideTag:m.createViews[index]?.recipe.overrideTag,creatable:m.createViews[index]?.creatable},
        before,after:{components:K.PartyManager.ComponentCount,tagged:W.countTag('K_REPAIR_PART'),plain:W.count(${JSON.stringify(PART)})}};
      await W.close(); return out;})()`, { timeoutMs: 60000 });
    report.notes.tutorial = tut;
    const tutRecipes = (tut.rows || []).filter((r) => String(r.group) === '4').map((r) => r.label);
    check('tutorialTableAndOverrideTag', tut.used?.visible === true && tut.used.recipeTable === 'tutitemcreate' && tut.used.conversationSeen === false
      && tut.other?.category === 'other' && tutRecipes.length > 0 && tutRecipes.every((r) => tut.other.recipes.includes(r))
      && tut.other.recipes.every((r) => tutRecipes.includes(r))
      && tut.index >= 0 && tut.view.overrideTag === 'K_REPAIR_PART' && tut.after.components < tut.before.components
      && tut.after.tagged === tut.before.tagged + 1, tut);

    // 9. A missing override table falls back to itemcreate with a warning.
    const fallback = await harness.evaluate(`(async()=>{const W=window.__wb,m=W.menu(),K=window.KotOR;
      const warningsBefore=window.__wbWarnings.length;
      await m.openFor(K.PartyManager.Player,'no_such_table'); await W.pause(500);
      const s=W.state();
      const warnings=window.__wbWarnings.slice(warningsBefore).filter(w=>/no_such_table/.test(w));
      await W.close();
      return {visible:s.visible,recipeTable:s.recipeTable,shopRows:s.shopRows,warnings};})()`, { timeoutMs: 60000 });
    report.notes.fallback = fallback;
    check('missingTableFallsBackToItemcreate', fallback.visible && fallback.recipeTable === 'itemcreate' && fallback.shopRows > 0
      && fallback.warnings.length > 0, fallback);

    // 10. workbnch.dlg's upgrade reply (k_workbench_t3, always shown): upgrades only, so a notice and no screen.
    const t3 = await harness.evaluate(`(async()=>{const W=window.__wb;const before=window.__wbNotices.length;
      const used=await W.useWithScript('k_workbench_t3',3000);
      return {loaded:used.loaded,visible:used.visible,conversationSeen:used.conversationSeen,presenting:window.KotOR.VRSpike.isPresenting,
        notices:window.__wbNotices.slice(before).map(a=>({text:a[0],holdMs:a[1],tone:a[2]}))};})()`, { timeoutMs: 60000 });
    report.notes.t3 = t3;
    check('upgradeReplyShowsNoticeOnly', t3.loaded && t3.visible === false
      && t3.notices.some((n) => n.text === NOTICE && n.holdMs === 3000 && n.tone === 'info'), t3);

    // 11. Chemicals untouched by every workbench action.
    const chemicals = await harness.evaluate(`({before:window.__wbChemicals,after:window.KotOR.PartyManager.ChemicalCount})`);
    report.notes.chemicals = chemicals;
    check('chemicalsUnchanged', chemicals.before === chemicals.after, chemicals);

    // 13. Save, zero the components, reload: the count is restored.
    const reloaded = await harness.evaluate(`(async()=>{const K=window.KotOR;
      K.PartyManager.ComponentCount=321;
      const savedComponents=K.PartyManager.ComponentCount;
      await K.SaveGame.SaveCurrentGame('Workbench probe',${SCRATCH_SAVE_ID});
      const s=K.SaveGame.saves.find(s=>s.getSaveNumber()===${SCRATCH_SAVE_ID});if(!s) return {saved:false,savedComponents};
      K.PartyManager.ComponentCount=0;
      window.__memoryProbeLoad={module:${JSON.stringify(MODULE)},error:null};await s.load();return {saved:true,directory:s.directory,savedComponents};})()`, { timeoutMs: 180000 });
    await harness.waitFor(landed, 300000, 500);
    reloaded.components = await harness.evaluate('window.KotOR.PartyManager.ComponentCount');
    report.notes.reload = reloaded;
    check('componentsPersistAcrossSave', reloaded.saved && reloaded.components === reloaded.savedComponents, reloaded);

    report.consoleErrors = harness.consoleMessages
      .filter((m) => m.level === 'error' && /component|workbench|ShowUpgradeScreen|crafting/i.test(String(m.text)))
      .map((m) => String(m.text).slice(0, 300)).slice(0, 10);
    report.pageErrors = harness.pageErrors.map((e) => String(e).slice(0, 300)).slice(0, 10);
  } catch (error) {
    report.error = String(error && error.stack || error);
  } finally {
    await harness.close().catch(() => {});
    if (service) service.stop();
    // The isolated save copy lives in an mkdtemp directory; remove it.
    try { fs.rmSync(path.dirname(userRoot), { recursive: true, force: true }); } catch (e) { report.cleanupError = String(e); }
  }

  report.passed = !report.error && Object.keys(report.checks).length > 0 && Object.values(report.checks).every(Boolean);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
