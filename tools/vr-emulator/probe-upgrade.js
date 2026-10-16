/**
 * Upgrade Workbench probe (ROADMAP 7.7, weapon and armor upgrades).
 *
 * Boots the browser build against an emulated Quest 3 on an isolated copy of
 * the SpaceRoach Peragus save, loads 103PER (the fuel depot) and drives the
 * placed bench plc_workb_rep: workbnch.dlg's "[Use the workbench to upgrade
 * items.]" reply runs k_workbench_t3 (ShowUpgradeScreen with item creation
 * disabled), which opens MenuUpgradeSelect (upgradesel_p). Then: tab
 * filtering (a level-3 Republic Blaster listed, a level-0 Blaster Carbine and
 * the level-0 Jedi Robe not), the slot screen (upgrade_p) with open and closed
 * slots, staging + Back changing nothing, Assemble installing a Pinpoint
 * Scope (its Keen property among the wielded blaster's effective properties),
 * replacing it with an Attack +1 targeting part on the equipped blaster (the
 * Exile's attack bonus rises by it, the scope returns to the bag), the bonus on a
 * companion, removing the part
 * back to the bag, an armor underlay, Create Items and the forced-oItem route
 * of routine 354, save/reload persistence, pointer reach and stick scrolling,
 * and PNGs of both screens.
 *
 *   node tools/vr-emulator/probe-upgrade.js
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

const CDP_PORT = 9487;
const ASSET_PORT = 8527;
const SAVE_DIRECTORY = 'Saves/000100 - Game99';
const MODULE = '103PER';
const SCRATCH_SAVE_ID = 143;
const BLASTER = 'w_blaste_09';
const CARBINE = 'w_brifle_01';
const SCOPE = 'u_r_targ_01';
/** Pinpoint Scope Mark I (u_r_targ_01) carries Keen, not an attack bonus; this targeting part (Attack +1) measures the bonus. */
const AB_SCOPE = 'u_r_targ_02';
const ROBE = 'a_robe_08';
const NOTICE = "Upgrading items isn't available yet.";
const RIGHTHAND = 0x10;
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const FIXTURE_CANDIDATES = [
  path.join(EVIDENCE_DIR, 'spaceroach-saves-ZaBsC0', 'user'),
  path.join('C:', 'Users', 'allen', 'source', 'repos', 'kotor2-vr', 'tools', 'vr-emulator', 'evidence', 'spaceroach-saves-ZaBsC0', 'user'),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isolatedUserRoot() {
  const fixture = FIXTURE_CANDIDATES.find((candidate) => fs.existsSync(path.join(candidate, SAVE_DIRECTORY)));
  if (!fixture) throw new Error('SpaceRoach save fixture not found: ' + FIXTURE_CANDIDATES.join(' | '));
  const userRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2-upgrade-')), 'user');
  fs.cpSync(path.join(fixture, SAVE_DIRECTORY), path.join(userRoot, SAVE_DIRECTORY), { recursive: true });
  return { fixture, userRoot };
}

/**
 * Page-side helpers, installed once per page as window.__up. The pointer,
 * aim, stick and list helpers are probe-workbench.js's, generalised to any
 * menu.
 */
const PAGE_HELPERS = `(() => {
  const K = window.KotOR, g = K.GameState, MM = g.MenuManager;
  const sel = () => MM.MenuUpgradeSelect;
  const up = () => MM.MenuUpgrade;
  const resrefOf = (i) => String(i?.getTemplateResRef?.() || i?.getTag?.() || '').toLowerCase();
  const count = (resref) => g.InventoryManager.inventory
    .filter((i) => resrefOf(i) === resref)
    .reduce((n, i) => n + (Number(i.getStackSize()) || 0), 0);
  const uti = async (resref) => new K.GFFObject(await K.ResourceLoader.loadResource(2025, resref));
  const addItem = async (resref, n = 1) => {
    const added = [];
    for (let i = 0; i < n; i++) added.push(g.InventoryManager.addItem(await uti(resref)));
    return added;
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
    pointAt(centre(control.box));
    const hits = g.controls.MenuGetActiveUIElements();
    return { ok: hits.includes(control), visible: control.isVisible?.() ?? !control.hidden, inViewport: inViewport(control.box), box: boxOf(control) };
  };
  const rowTargetable = (list, index) => {
    const row = list.children[index];
    if (!row) return { ok: false, reason: 'no row ' + index };
    row.updateBounds?.();
    pointAt(centre(row.box));
    const semantic = list.getVRPointerTargetsAtPointer ? list.getVRPointerTargetsAtPointer() : [];
    const hits = g.controls.MenuGetActiveUIElements();
    return { ok: semantic.length > 0 || hits.includes(row), inViewport: inViewport(row.box) };
  };
  /** Every visible BTN_/LBL_/LB_ control of a menu, and whether its box is inside the viewport (the panel). */
  const layout = (m) => {
    const out = {};
    for (const key of Object.keys(m)) {
      if (!/^(BTN|LBL|LB)_/.test(key)) continue;
      const c = m[key];
      if (!c || !c.box || !c.widget || !c.isVisible?.()) continue;
      c.updateBounds?.();
      out[key] = { inViewport: inViewport(c.box), box: boxOf(c) };
    }
    return out;
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const hand = () => window.__xrDevice?.controllers?.right;
  const restAim = (() => { const q = hand()?.quaternion; return q ? [q.x, q.y, q.z, q.w] : [0, 0, 0, 1]; })();
  let aim = { yaw: 0, pitch: 0 };
  const setAim = (yaw, pitch) => {
    const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sp = Math.sin(pitch / 2), cp = Math.cos(pitch / 2);
    hand().quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  };
  const readPointer = async () => {
    await pause(150);
    const p = K.VRSpike.latestPanelPointerPosition;
    return p ? { x: p.x, y: p.y } : null;
  };
  /** Aims the right controller so its real VR ray lands on target (GUI units). */
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
  /** Aims the real ray at a control and reports whether the engine hovers it. */
  const rayHovers = async (control) => {
    const aimed = await aimAt(boxCentre(control));
    await pause(250);
    return { aimed: !!aimed.ok, hover: !!(control.hover || control.mouseOver), hovered: MM.hoveredGUIElement === control };
  };
  const rowInList = (list, row) => {
    row.updateBounds?.(); list.updateBounds?.();
    const c = centre(row.box);
    return c.x > list.box.min.x && c.x < list.box.max.x && c.y > list.box.min.y && c.y < list.box.max.y;
  };
  const revealRow = (list, index) => {
    const row = list.children[index];
    if (!row) return false;
    for (const scroll of [list.scroll, 0, list.maxScroll / 2, list.maxScroll]) {
      list.scroll = scroll; list.updateList();
      if (rowInList(list, row)) return true;
    }
    return false;
  };
  const stickScroll = async (list) => {
    const stick = hand();
    stick.updateAxes('thumbstick', 0, 0);
    list.scroll = 0; list.updateList();
    const aimed = await aimAt(boxCentre(list));
    await pause(200);
    const hovered = MM.hoveredGUIElement === list;
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
  const colour = (label) => ({ r: +label.text.color.r.toFixed(3), g: +label.text.color.g.toFixed(3), b: +label.text.color.b.toFixed(3) });
  const endConversations = async () => { const cm = g.CutsceneManager;
    for (let i = 0; i < 10 && cm.active; i++) { cm.endConversation(true); await pause(300); } return !cm.active; };
  /** Closes every upgrade/crafting screen that is open, top first. */
  const closeAll = async () => {
    for (let i = 0; i < 6; i++) {
      const top = MM.GetCurrentMenu();
      if (top === up()) up().BTN_BACK.click();
      else if (top === sel()) sel().BTN_BACK.click();
      else if (top === MM.MenuComponent) MM.MenuComponent.BTN_Cancel.click();
      else break;
      await pause(400);
    }
    return { select: !!sel().bVisible, upgrade: !!up().bVisible, component: !!MM.MenuComponent.bVisible, mode: g.Mode };
  };
  const selState = () => {
    const m = sel();
    return {
      visible: !!m.bVisible, foreground: MM.GetCurrentMenu() === m, tab: m.tab,
      rows: (m.rows || []).map((r) => ({ resref: resrefOf(r.item), wearer: r.wearer ? String(r.wearer.getName?.()) : null })),
      rowTexts: m.LB_UPGRADELIST.children.map((c) => String(c.node?.getName?.() ?? '')),
      createVisible: !!m.BTN_CREATEITEMS?.isVisible?.(), createText: m.BTN_CREATEITEMS?.getText?.(),
      lightsaberDisabled: !!m.BTN_LIGHTSABER?.disableSelection, recipeTable: m.recipeTable, allowCreate: m.allowCreate,
      description: (() => { const c = m.LB_DESCRIPTION.children[0]; if (!c) return ''; return typeof c.node === 'string' ? c.node : String(c.text?.text ?? ''); })(),
    };
  };
  const upState = () => {
    const m = up();
    const labels = [m.LBL_UPGRADE31, m.LBL_UPGRADE32, m.LBL_UPGRADE33];
    const buttons = [m.BTN_UPGRADE31, m.BTN_UPGRADE32, m.BTN_UPGRADE33];
    return {
      visible: !!m.bVisible, foreground: MM.GetCurrentMenu() === m,
      title: m.LBL_TITLE?.getText?.(), item: resrefOf(m.item), selectedSlot: m.selectedSlot,
      slots: m.slots().map((s) => ({ type: s.type, open: s.open, installed: s.installed?.resref || null,
        staged: s.staged === null ? 'remove' : (s.staged?.resref || null) })),
      slotUi: buttons.map((b, i) => ({ visible: !!b.isVisible(), disabled: !!b.disableSelection, label: labels[i].getText(), fill: String(b.getFillTextureName?.() ?? ''),
        labelVisible: !!labels[i].isVisible(), colour: colour(labels[i]) })),
      rows: (m.listRows || []).map((r) => r.kind === 'remove' ? 'remove' : r.part.resref),
      hasChanges: !!m.session?.hasChanges(), property: m.LBL_PROPERTY?.getText?.(), slotName: m.LBL_SLOTNAME?.getText?.(),
      hiddenLs: Object.keys(m).filter((k) => /(^|_)3D_MODEL|_LS$/.test(k) && m[k]?.isVisible).map((k) => [k, !!m[k].isVisible()]),
    };
  };
  /** Selects the select-screen row for item (a real row click) and presses Upgrade Items. */
  const openItem = async (item) => {
    const m = sel();
    const index = m.rows.findIndex((r) => r.item === item);
    if (index < 0) return { index, rows: selState().rows };
    revealRow(m.LB_UPGRADELIST, index);
    m.LB_UPGRADELIST.children[index].click();
    await pause(150);
    m.BTN_UPGRADEITEMS.click();
    for (let i = 0; i < 40 && !up().bVisible; i++) await pause(50);
    await pause(300);
    return { index, ...upState() };
  };
  /** Clicks slot button i, then the LB_ITEMS row for resref ('remove' = the Remove row). */
  const stage = async (slot, resref) => {
    const m = up();
    [m.BTN_UPGRADE31, m.BTN_UPGRADE32, m.BTN_UPGRADE33][slot].click();
    await pause(200);
    const index = m.listRows.findIndex((r) => resref === 'remove' ? r.kind === 'remove' : (r.kind === 'part' && r.part.resref === resref));
    if (index < 0) return { staged: false, rows: upState().rows };
    revealRow(m.LB_ITEMS, index);
    m.LB_ITEMS.children[index].click();
    await pause(200);
    return { staged: true, ...upState() };
  };
  const assemble = async () => { up().BTN_ASSEMBLE.click(); await pause(300); return upState(); };
  const back = async () => { up().BTN_BACK.click(); await pause(400); return { upgrade: !!up().bVisible, select: selState() }; };
  const rowOf = (resref) => {
    const rows = g.TwoDAManager.datatables.get('upgrade').rows;
    for (const key of Object.keys(rows)) if (String(rows[key].template || '').toLowerCase() === resref) return Number(key);
    return -1;
  };
  const ab = (creature, weapon) => Number(creature.getAttackBonusFor(weapon));
  window.__up = { sel, up, resrefOf, count, uti, addItem, targetable, rowTargetable, layout, boxOf, aimAt, resetAim, boxCentre,
    rayHovers, revealRow, stickScroll, colour, pause, endConversations, closeAll, selState, upState, openItem, stage, assemble, back,
    rowOf, ab };
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

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const { fixture, userRoot } = isolatedUserRoot();
  report.fixture = fixture;
  report.userRoot = userRoot;
  const harness = new VrHarness({ port: CDP_PORT });
  let service;
  try {
    service = await startAssetService({ port: ASSET_PORT, userRoot });
    await harness.launch(service.url);
    await harness.waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='OK')`, 90000, 500);
    await harness.evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='OK');b.dataset.upEula='true';return true;})()`);
    await harness.clickSelector('[data-up-eula]');
    await harness.waitFor(`document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`, 240000, 1000);
    await harness.evaluate('window.KotOR.SaveGame.GetSaveGames()', { timeoutMs: 120000 });
    await harness.evaluate(`(async()=>{const K=window.KotOR;const s=K.SaveGame.saves.find(s=>s.directory===${JSON.stringify(SAVE_DIRECTORY)});
      if(!s)throw new Error('Peragus save missing');window.__memoryProbeLoad={module:'101PER',error:null};await s.load();return true;})()`, { timeoutMs: 180000 });
    await harness.waitFor(landed, 300000, 500);
    await harness.evaluate(loadModule(MODULE));
    await harness.waitFor(landed, 300000, 500);
    await enterVrSession(harness);
    await harness.evaluate(`(async()=>{const g=window.KotOR.GameState;for(let n=0;n<8;n++){
      await new Promise(r=>setTimeout(r,250));if(g.CutsceneManager.active)g.CutsceneManager.endConversation(true);
      g.MenuManager.InGameOverlay.open();}return true;})()`, { timeoutMs: 30000 });
    await harness.evaluate(PAGE_HELPERS);
    await harness.evaluate(`(()=>{const K=window.KotOR;window.__upNotices=[];
      const show=K.VRSpike.showNotice;K.VRSpike.showNotice=function(...a){window.__upNotices.push(a);return show.apply(this,a);};
      return true;})()`);

    // Templates the probe needs: an armor with UpgradeLevel >= 1 and an
    // underlay that fits it, a level-1 ranged weapon, and enough distinct
    // upgradeable templates to overflow the item list.
    const templates = await harness.evaluate(`(()=>{const K=window.KotOR,g=K.GameState;
      const cache=K.ResourceLoader.CacheScopes.global.get(2025);
      const base=g.TwoDAManager.datatables.get('baseitems').rows;
      const sortOf=(b)=>Number(base[b]?.storepanelsort);
      const out={armor:[],ranged1:[],upgradeable:[],underlays:[],total:cache?cache.size:0};
      const read=(resref,buf)=>{const gff=new K.GFFObject(buf);const f=(l)=>gff.RootNode.hasField(l)?gff.getFieldByLabel(l).getValue():undefined;
        return {resref,baseItem:Number(f('BaseItem')),level:Number(f('UpgradeLevel')||0),plot:!!f('Plot')};};
      const upgradeRows=g.TwoDAManager.datatables.get('upgrade').rows;
      const underlayTemplates=new Map();
      for(const key of Object.keys(upgradeRows)){const r=upgradeRows[key];
        if(String(r.upgradetype)==='11'){const t=String(r.template||'').toLowerCase();if(t&&t!=='****') underlayTemplates.set(t,Number(key));}}
      for(const [resref,buf] of (cache||new Map())){
        let it;try{it=read(resref,buf);}catch(e){continue;}
        if(underlayTemplates.has(resref)) out.underlays.push({resref,row:underlayTemplates.get(resref),level:it.level});
        const sort=sortOf(it.baseItem);
        const cat=[40,45].includes(sort)?'ranged':[20,25].includes(sort)?'melee':[4,5,10,15].includes(sort)?'armor':null;
        if(!cat||it.plot) continue;
        if(it.level>=1) out.upgradeable.push({resref,cat,level:it.level});
        if(cat==='armor'&&it.level>=1) out.armor.push({resref,level:it.level});
        if(cat==='ranged'&&it.level===1) out.ranged1.push(resref);
      }
      for(const k of ['armor','upgradeable','underlays','ranged1']) out[k].sort((a,b)=>String(a.resref||a).localeCompare(String(b.resref||b)));
      return out;})()`, { timeoutMs: 120000 });
    // The armor: the lightest-level armor for which an underlay fits; prefer a_light_* (clothing-weight armor).
    let armor = null, underlay = null;
    const byLevel = [...templates.armor].sort((a, b) => a.level - b.level || (/^a_light/.test(b.resref) - /^a_light/.test(a.resref)) || a.resref.localeCompare(b.resref));
    for (const a of byLevel) {
      const u = templates.underlays.filter((x) => x.level <= a.level).sort((x, y) => x.level - y.level || x.resref.localeCompare(y.resref))[0];
      if (u) { armor = a; underlay = u; break; }
    }
    const ranged1 = templates.ranged1.find((r) => r !== BLASTER && r !== CARBINE) || null;
    report.notes.templates = { armor, underlay, ranged1, cachedUti: templates.total, armorCount: templates.armor.length,
      underlays: templates.underlays.length, upgradeable: templates.upgradeable.length };
    if (!armor || !underlay || !ranged1) throw new Error('templates not found: ' + JSON.stringify(report.notes.templates));

    // 1. The bench's own conversation: the "upgrade items" reply (k_workbench_t3) opens MenuUpgradeSelect, no notice.
    const bench = await harness.evaluate(`(()=>{const K=window.KotOR,g=K.GameState;const list=g.module.area.placeables;
      const p=list.find(p=>/^(000_)?workbench$/i.test(String(p.tag||p.getTag?.()||'')));
      if(!p) return {found:false};
      window.__bench=p;return {found:true,tag:p.tag,template:p.getTemplateResRef?.()||null,conversation:String(p.conversation?.resref||p.conversation||'')};})()`);
    report.notes.bench = bench;
    if (!bench.found) throw new Error('Workbench placeable not found');
    const use = await harness.evaluate(`(async()=>{const U=window.__up,g=window.KotOR.GameState,cm=g.CutsceneManager;
      window.__bench.use(window.KotOR.PartyManager.Player);
      for(let i=0;i<120 && !cm.active;i++) await U.pause(50);
      await U.pause(500);
      return {active:!!cm.active,resref:cm.dialog?.resref||null,computer:cm.dialog?.getConversationType?.()===1};})()`, { timeoutMs: 60000 });
    let dialogue = { transcript: [] };
    if (use.active) {
      try {
        dialogue = await playDialogue(harness, {
          label: 'Workbench upgrade', maxTurns: 60, menuName: use.computer ? 'InGameComputer' : 'InGameDialog',
          choose: (replies, snapshot) => {
            const scripts = (snapshot && snapshot.replyScripts) || [];
            const t3 = scripts.findIndex((name) => /^k_workbench_t3$/i.test(String(name)));
            if (t3 >= 0) return t3;
            const text = replies.findIndex((t) => /upgrade/i.test(String(t)));
            return text >= 0 ? text : 0;
          },
        });
      } catch (e) { dialogue.error = String(e); }
    }
    const opened = await harness.evaluate(`(async()=>{const U=window.__up,g=window.KotOR.GameState;
      for(let i=0;i<100 && !U.sel().bVisible;i++) await U.pause(100);
      await U.pause(800);
      return {...U.selState(),component:!!g.MenuManager.MenuComponent.bVisible,conversationActive:!!g.CutsceneManager.active,
        notices:window.__upNotices.map(a=>String(a[0])),userIsPlayer:U.sel().user===window.KotOR.PartyManager.Player};})()`, { timeoutMs: 60000 });
    report.notes.open = { use, transcript: dialogue.transcript, error: dialogue.error, opened };
    check('1_upgradeReplyOpensSelect', use.active && /workbnch/i.test(String(use.resref))
      && dialogue.transcript.some((line) => /\[script=k_workbench_t3\]/i.test(line))
      && opened.visible && opened.foreground && !opened.component && !opened.conversationActive
      && !opened.notices.includes(NOTICE) && opened.createVisible === false && opened.allowCreate === false
      && opened.lightsaberDisabled === true && opened.tab === 'all', report.notes.open);

    // 2. Tabs: Ranged lists the Republic Blaster, not the Carbine; Armor lists the chosen armor, not the Jedi Robe.
    const tabs = await harness.evaluate(`(async()=>{const U=window.__up,m=U.sel(),K=window.KotOR;
      const levels={};
      for(const r of [${JSON.stringify(BLASTER)},${JSON.stringify(CARBINE)},${JSON.stringify(ROBE)},${JSON.stringify(armor.resref)},${JSON.stringify(ranged1)}]){
        const gff=await U.uti(r);levels[r]=gff.RootNode.hasField('UpgradeLevel')?Number(gff.getFieldByLabel('UpgradeLevel').getValue()):0;}
      const before={scopes:U.count(${JSON.stringify(SCOPE)}),underlays:U.count(${JSON.stringify(underlay.resref)})};
      window.__blaster=(await U.addItem(${JSON.stringify(BLASTER)}))[0];
      await U.addItem(${JSON.stringify(CARBINE)});
      await U.addItem(${JSON.stringify(SCOPE)},2);
      await U.addItem(${JSON.stringify(AB_SCOPE)});
      window.__armor=(await U.addItem(${JSON.stringify(armor.resref)}))[0];
      await U.addItem(${JSON.stringify(ROBE)});
      await U.addItem(${JSON.stringify(underlay.resref)});
      window.__ranged1=(await U.addItem(${JSON.stringify(ranged1)}))[0];
      window.__before=before;
      m.BTN_RANGED.click(); await U.pause(300);
      const ranged=U.selState();
      m.BTN_ARMOR.click(); await U.pause(300);
      const armorTab=U.selState();
      m.BTN_MELEE.click(); await U.pause(300);
      const melee=U.selState();
      m.BTN_ALL.click(); await U.pause(300);
      const all=U.selState();
      return {levels,before,scopes:U.count(${JSON.stringify(SCOPE)}),ranged:{tab:ranged.tab,rows:ranged.rows.map(r=>r.resref)},
        armor:{tab:armorTab.tab,rows:armorTab.rows.map(r=>r.resref)},melee:{tab:melee.tab,rows:melee.rows.map(r=>r.resref)},
        all:{tab:all.tab,rows:all.rows.map(r=>r.resref)}};})()`, { timeoutMs: 60000 });
    report.notes.tabs = tabs;
    check('2_tabsFilterUpgradeable', tabs.levels[BLASTER] === 3 && tabs.levels[CARBINE] === 0 && tabs.levels[ROBE] === 0
      && tabs.ranged.tab === 'ranged' && tabs.ranged.rows.includes(BLASTER) && !tabs.ranged.rows.includes(CARBINE)
      && !tabs.ranged.rows.includes(armor.resref) && tabs.armor.rows.includes(armor.resref) && !tabs.armor.rows.includes(ROBE)
      && !tabs.armor.rows.includes(BLASTER) && !tabs.melee.rows.includes(BLASTER)
      && tabs.all.rows.includes(BLASTER) && tabs.all.rows.includes(armor.resref) && !tabs.all.rows.includes(CARBINE), tabs);

    // 3. The blaster's slot screen: 3 slots, all open; a level-1 ranged item: slots 2-3 greyed and unselectable.
    const slots = await harness.evaluate(`(async()=>{const U=window.__up;
      const blaster=await U.openItem(window.__blaster);
      const blasterBack=await U.back();
      const low=await U.openItem(window.__ranged1);
      const m=U.up();
      m.BTN_UPGRADE32.click(); m.BTN_UPGRADE33.click(); await U.pause(200);
      const afterClosedClicks=m.selectedSlot;
      const lowBack=await U.back();
      return {blaster,blasterBack:{upgrade:blasterBack.upgrade,select:blasterBack.select.foreground},low,afterClosedClicks,
        lowBack:{upgrade:lowBack.upgrade,select:lowBack.select.foreground}};})()`, { timeoutMs: 60000 });
    report.notes.slots = slots;
    const greyed = (c) => Math.abs(c.r - 0.5) < 0.01 && Math.abs(c.g - 0.5) < 0.01 && Math.abs(c.b - 0.5) < 0.01;
    check('3_slotsOpenAndClosed', slots.blaster.visible && slots.blaster.foreground && slots.blaster.item === BLASTER
      && slots.blaster.slots.length === 3 && slots.blaster.slots.every((s) => s.open)
      && slots.blaster.slots.map((s) => s.type).join() === '4,6,5'
      && slots.blaster.slotUi.every((s) => s.visible && !s.disabled && s.labelVisible && s.label === ['Targeting', 'Firing Chamber', 'Power Pack'][slots.blaster.slotUi.indexOf(s)]) && /^Targeting: Empty$/.test(slots.blaster.slotName)
      && slots.blaster.hiddenLs.every(([, v]) => v === false) && slots.blasterBack.upgrade === false && slots.blasterBack.select
      && slots.low.slots.length === 3 && slots.low.slots[0].open && !slots.low.slots[1].open && !slots.low.slots[2].open
      && !slots.low.slotUi[0].disabled && slots.low.slotUi[1].disabled && slots.low.slotUi[2].disabled
      && greyed(slots.low.slotUi[1].colour) && greyed(slots.low.slotUi[2].colour) && !greyed(slots.low.slotUi[0].colour)
      && slots.afterClosedClicks === 0 && slots.lowBack.select, slots);

    // 5 (before). The Exile's attack bonus with the bare blaster, equipped.
    const bare = await harness.evaluate(`(async()=>{const U=window.__up,K=window.KotOR,p=K.PartyManager.Player,b=window.__blaster;
      await p.equipItem(${RIGHTHAND},b); await U.pause(300);
      const scopeItem=U.up().engine.displayItem(${JSON.stringify(SCOPE)}),abItem=U.up().engine.displayItem(${JSON.stringify(AB_SCOPE)});
      const propsOf=(list)=>(list||[]).map(x=>Number(x.propertyName));
      const r={equipped:p.equipment.RIGHTHAND===b,ab:U.ab(p,p.equipment.RIGHTHAND),ownAB:b.getHighestPropertyValue?.(K.ModuleItemProperty?.AttackBonus??38)??null,
        scopeAB:Number(scopeItem?.getAttackBonus?.()),scopeName:scopeItem?.getName?.(),scopeProps:propsOf(scopeItem?.properties),
        abScopeAB:Number(abItem?.getAttackBonus?.()),abScopeName:abItem?.getName?.(),abRow:U.rowOf(${JSON.stringify(AB_SCOPE)}),
        bareProps:propsOf(b.getEffectiveProperties())};
      p.unequipSlot(${RIGHTHAND},true); await U.pause(200);
      r.backInBag=K.GameState.InventoryManager.inventory.includes(b);
      U.sel().refresh(0);
      return r;})()`, { timeoutMs: 60000 });
    report.notes.bare = bare;

    // 4. Stage the scope in slot 0, Back: nothing changed. Stage again, Assemble: UpgradeSlot0 = the scope's row, one scope left.
    const install = await harness.evaluate(`(async()=>{const U=window.__up,b=window.__blaster;
      const row=U.rowOf(${JSON.stringify(SCOPE)});
      await U.openItem(b);
      const staged=await U.stage(0,${JSON.stringify(SCOPE)});
      const back=await U.back();
      const afterBack={slot0:b.getUpgradeSlot(0),scopes:U.count(${JSON.stringify(SCOPE)})};
      await U.openItem(b);
      const staged2=await U.stage(0,${JSON.stringify(SCOPE)});
      const assembled=await U.assemble();
      const field=b.template.RootNode.hasField('UpgradeSlot0')?b.template.getFieldByLabel('UpgradeSlot0').getValue():null;
      const after={slot0:b.getUpgradeSlot(0),field,scopes:U.count(${JSON.stringify(SCOPE)})};
      const back2=await U.back();
      return {row,before:window.__before,staged:{staged:staged.staged,slots:staged.slots,label:staged.slotName,fill:staged.slotUi[0].fill,hasChanges:staged.hasChanges,rows:staged.rows,property:staged.property},
        back:{upgrade:back.upgrade},afterBack,staged2:{staged:staged2.staged,hasChanges:staged2.hasChanges},
        assembled:{slots:assembled.slots,label:assembled.slotName,fill:assembled.slotUi[0].fill,hasChanges:assembled.hasChanges,rows:assembled.rows},after,
        description:back2.select.description};})()`, { timeoutMs: 60000 });
    report.notes.install = install;
    check('4_stageBackThenAssemble', install.row >= 0 && install.staged.staged && install.staged.hasChanges
      && install.staged.slots[0].staged === SCOPE && String(install.staged.label).includes(bare.scopeName)
      && install.back.upgrade === false && install.afterBack.slot0 === -1 && install.afterBack.scopes === install.before.scopes + 2
      && install.staged2.staged && install.after.slot0 === install.row && install.after.field === install.row
      && install.after.scopes === install.before.scopes + 1 && install.assembled.hasChanges === false
      && install.assembled.slots[0].installed === SCOPE && install.assembled.rows.includes('remove')
      && install.assembled.fill !== '' && install.assembled.fill !== slots.blaster.slotUi[0].fill
      && String(install.description).includes('Targeting: ' + bare.scopeName), { install, scopeName: bare.scopeName });

    // 5. Equip the upgraded blaster on the Exile. The Pinpoint Scope Mark I's only property is Keen (28):
    // it must appear among the wielded blaster's effective properties (the engine has no Keen rule, so it
    // changes no number). Then, with the blaster still equipped, Assemble a replacement: the Attack +1
    // targeting part (AB_SCOPE). The old scope returns to the bag and the combat code's attack bonus
    // rises by the new part's bonus versus the bare blaster.
    const exile = await harness.evaluate(`(async()=>{const U=window.__up,K=window.KotOR,p=K.PartyManager.Player,b=window.__blaster;
      await p.equipItem(${RIGHTHAND},b); await U.pause(300);
      const m=U.sel(); m.refresh(0); await U.pause(200);
      const listed=U.selState().rows.find(r=>r.resref===${JSON.stringify(BLASTER)});
      const withKeen={ab:U.ab(p,p.equipment.RIGHTHAND),props:p.equipment.RIGHTHAND.getEffectiveProperties().map(x=>Number(x.propertyName))};
      const scopesBefore=U.count(${JSON.stringify(SCOPE)}),abBefore=U.count(${JSON.stringify(AB_SCOPE)});
      await U.openItem(b);
      const replacing=await U.stage(0,${JSON.stringify(AB_SCOPE)});
      await U.assemble(); await U.back();
      return {equipped:p.equipment.RIGHTHAND===b,withKeen,staged:replacing.slots[0].staged,slot0:b.getUpgradeSlot(0),
        ab:U.ab(p,p.equipment.RIGHTHAND),scopesBefore,scopesAfter:U.count(${JSON.stringify(SCOPE)}),abBefore,abAfter:U.count(${JSON.stringify(AB_SCOPE)}),
        exileName:p.getName?.(),listed,rowText:U.selState().rowTexts.find(t=>t.startsWith(String(b.getName())))};})()`, { timeoutMs: 60000 });
    report.notes.exile = { bare, exile };
    const scopeDelta = Math.max(bare.ownAB || 0, bare.abScopeAB) - (bare.ownAB || 0);
    check('5_exileBonusRisesByScope', bare.equipped && exile.equipped && bare.scopeProps.includes(28) && !bare.bareProps.includes(28)
      && exile.withKeen.props.includes(28) && exile.withKeen.ab === bare.ab
      && exile.staged === AB_SCOPE && exile.slot0 === bare.abRow && exile.scopesAfter === exile.scopesBefore + 1 && exile.abAfter === exile.abBefore - 1
      && bare.abScopeAB > 0 && scopeDelta > 0 && exile.ab === bare.ab + scopeDelta && exile.listed?.wearer === exile.exileName
      && String(exile.rowText).includes('(' + exile.exileName + ')'), { bare, exile, scopeDelta });

    // 6. A companion wields it: the companion's bonus follows a further Assemble without re-equipping.
    const companion = await harness.evaluate(`(async()=>{const U=window.__up,K=window.KotOR,g=K.GameState,p=K.PartyManager.Player,b=window.__blaster;
      const party=K.PartyManager.party;
      let c=party.find(x=>x!==p && !x.isPlayer), source='party';
      if(!c){
        const gff=new K.GFFObject(await K.ResourceLoader.loadResource(2027,'p_atton'));
        c=new g.Module.ModuleArea.ModuleCreature(gff); c.initProperties(); try{c.load?.();}catch(e){}
        party.push(c); window.__upCompanion=c; source='template p_atton (joined the party for the check)';
      }
      p.unequipSlot(${RIGHTHAND},true); await U.pause(200);
      await c.equipItem(${RIGHTHAND},b); await U.pause(300);
      const withScope=U.ab(c,c.equipment.RIGHTHAND);
      const m=U.sel(); m.refresh(0); await U.pause(200);
      const listed=U.selState().rows.find(r=>r.resref===${JSON.stringify(BLASTER)});
      await U.openItem(b);
      const wearer=U.up().wearer===c;
      await U.stage(0,'remove'); await U.assemble();
      const without={ab:U.ab(c,c.equipment.RIGHTHAND),slot0:b.getUpgradeSlot(0),same:c.equipment.RIGHTHAND===b};
      await U.stage(0,${JSON.stringify(AB_SCOPE)}); await U.assemble();
      const again={ab:U.ab(c,c.equipment.RIGHTHAND),slot0:b.getUpgradeSlot(0),same:c.equipment.RIGHTHAND===b};
      await U.back();
      c.unequipSlot(${RIGHTHAND},true); await U.pause(200);
      if(window.__upCompanion){const i=party.indexOf(c);if(i>=0)party.splice(i,1);try{g.ModuleObjectManager.RemoveObjectById(c.id);}catch(e){}}
      return {source,name:c.getName?.(),withScope,without,again,listed,wearer,backInBag:g.InventoryManager.inventory.includes(b)};})()`, { timeoutMs: 60000 });
    report.notes.companion = companion;
    check('6_companionBonusFollowsAssemble', companion.listed?.wearer === companion.name && companion.wearer
      && companion.without.same && companion.again.same && companion.without.slot0 === -1
      && companion.withScope === companion.without.ab + scopeDelta && companion.again.ab === companion.withScope
      && companion.again.slot0 === bare.abRow && companion.backInBag, companion);

    // 7. Remove the scope with the blaster on the Exile: it returns to the bag and the bonus drops back.
    const removed = await harness.evaluate(`(async()=>{const U=window.__up,K=window.KotOR,p=K.PartyManager.Player,b=window.__blaster;
      await p.equipItem(${RIGHTHAND},b); await U.pause(300);
      const withScope=U.ab(p,p.equipment.RIGHTHAND);
      const scopesBefore=U.count(${JSON.stringify(AB_SCOPE)});
      U.sel().refresh(0); await U.pause(200);
      await U.openItem(b);
      const s=await U.stage(0,'remove');
      const a=await U.assemble();
      await U.back();
      return {withScope,scopesBefore,staged:s.slots[0].staged,after:{slot0:b.getUpgradeSlot(0),scopes:U.count(${JSON.stringify(AB_SCOPE)}),
        ab:U.ab(p,p.equipment.RIGHTHAND),label:a.slotName,fill:a.slotUi[0].fill}};})()`, { timeoutMs: 60000 });
    report.notes.removed = removed;
    check('7_removeReturnsScopeAndDropsBonus', removed.withScope === bare.ab + scopeDelta && removed.staged === 'remove'
      && removed.after.slot0 === -1 && removed.after.scopes === removed.scopesBefore + 1 && removed.after.ab === bare.ab
      && /Empty$/.test(removed.after.label), removed);

    // 8. Armor: an underlay into the chosen armor; Assemble; slot 1 holds it.
    const armorRun = await harness.evaluate(`(async()=>{const U=window.__up,a=window.__armor;
      U.sel().BTN_ARMOR.click(); await U.pause(300);
      const opened=await U.openItem(a);
      const before=U.count(${JSON.stringify(underlay.resref)});
      const s=await U.stage(1,${JSON.stringify(underlay.resref)});
      const asm=await U.assemble();
      const out={opened:{slots:opened.slots,ui:opened.slotUi.map(x=>({visible:x.visible,disabled:x.disabled,label:x.label}))},
        staged:s.staged,slot1:a.getUpgradeSlot(1),slot0:a.getUpgradeSlot(0),row:U.rowOf(${JSON.stringify(underlay.resref)}),
        bagBefore:before,bagAfter:U.count(${JSON.stringify(underlay.resref)}),label:asm.slotName};
      await U.back();
      return out;})()`, { timeoutMs: 60000 });
    report.notes.armor = armorRun;
    check('8_armorUnderlayInstalled', armorRun.opened.slots.length === 2 && armorRun.opened.slots.map((s) => s.type).join() === '10,11'
      && armorRun.opened.ui[2].visible === false && armorRun.staged && armorRun.slot1 === armorRun.row && armorRun.slot0 === -1
      && armorRun.bagAfter === armorRun.bagBefore - 1 && !/Empty$/.test(armorRun.label), armorRun);

    // 11a. Overflow the item list with distinct upgradeable items, then stick-scroll it.
    const extra = templates.upgradeable.map((t) => t.resref).filter((r) => ![BLASTER, armor.resref, ranged1].includes(r)).slice(0, 14);
    const scroll = await harness.evaluate(`(async()=>{const U=window.__up,m=U.sel();
      for(const r of ${JSON.stringify(extra)}){try{await U.addItem(r);}catch(e){}}
      m.BTN_ALL.click(); await U.pause(400);
      return {...await U.stickScroll(m.LB_UPGRADELIST)};})()`, { timeoutMs: 120000 });
    report.notes.scroll = scroll;

    // 12a / 11b. PNG of the select screen; every control inside the panel; pointer reach.
    const panelFor = async (file, menuExpr) => {
      await sleep(1500);
      const panel = await harness.evaluate(`(()=>{const K=window.KotOR,g=K.GameState,host=K.VRSpike.panelHost,m=${menuExpr};
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
    await harness.evaluate(`(async()=>{const U=window.__up,m=U.sel();m.LB_UPGRADELIST.scroll=0;m.LB_UPGRADELIST.updateList();
      const i=m.rows.findIndex(r=>r.item===window.__blaster);if(i>=0){U.revealRow(m.LB_UPGRADELIST,i);m.LB_UPGRADELIST.children[i].click();}
      await U.pause(300);return true;})()`);
    const selectPanel = await panelFor(path.join(EVIDENCE_DIR, 'upgrade-select.png'), 'window.__up.sel()');
    const selectReach = await harness.evaluate(`(async()=>{const U=window.__up,m=U.sel(),out={};
      for(const n of ['BTN_ALL','BTN_RANGED','BTN_MELEE','BTN_ARMOR','BTN_UPGRADEITEMS','BTN_BACK']) out[n]=U.targetable(m[n]);
      out.row0=U.rowTargetable(m.LB_UPGRADELIST,0);
      out.layout=U.layout(m);
      out.ray={ranged:await U.rayHovers(m.BTN_RANGED),upgradeItems:await U.rayHovers(m.BTN_UPGRADEITEMS)};
      const row=m.LB_UPGRADELIST.children[0];U.revealRow(m.LB_UPGRADELIST,0);
      out.ray.row0=await U.rayHovers(row.children[0]||row);
      U.resetAim();
      return out;})()`, { timeoutMs: 120000 });
    report.notes.selectPanel = selectPanel;
    report.notes.selectReach = selectReach;

    // 12b / 11c. PNG of the slot screen (the blaster, Targeting selected, the scope listed); reach of slots, rows, Assemble.
    await harness.evaluate(`(async()=>{const U=window.__up;await U.openItem(window.__blaster);U.up().BTN_UPGRADE31.click();await U.pause(300);return true;})()`);
    const slotPanel = await panelFor(path.join(EVIDENCE_DIR, 'upgrade-slots.png'), 'window.__up.up()');
    const slotReach = await harness.evaluate(`(async()=>{const U=window.__up,m=U.up(),out={};
      for(const n of ['BTN_UPGRADE31','BTN_UPGRADE32','BTN_UPGRADE33','BTN_ASSEMBLE','BTN_BACK','BTN_OK']) out[n]=U.targetable(m[n]);
      out.row0=U.rowTargetable(m.LB_ITEMS,0);
      out.layout=U.layout(m);
      out.ray={slot2:await U.rayHovers(m.BTN_UPGRADE32),assemble:await U.rayHovers(m.BTN_ASSEMBLE)};
      const row=m.LB_ITEMS.children[0];
      if(row) out.ray.row0=await U.rayHovers(row.children[0]||row);
      out.rows=U.upState().rows;
      U.resetAim();
      await U.back();
      return out;})()`, { timeoutMs: 120000 });
    report.notes.slotPanel = slotPanel;
    report.notes.slotReach = slotReach;
    const allInside = (layout) => Object.values(layout || {}).every((c) => c.inViewport === true);
    const reachOk = (reach, names) => names.every((n) => reach[n]?.ok === true && reach[n]?.inViewport === true);
    check('11_pointerReachAndStickScroll',
      reachOk(selectReach, ['BTN_ALL', 'BTN_RANGED', 'BTN_MELEE', 'BTN_ARMOR', 'BTN_UPGRADEITEMS', 'BTN_BACK']) && selectReach.row0.ok
      && selectReach.ray.ranged.aimed && selectReach.ray.ranged.hover && selectReach.ray.upgradeItems.aimed && selectReach.ray.upgradeItems.hover
      && selectReach.ray.row0.aimed
      && reachOk(slotReach, ['BTN_UPGRADE31', 'BTN_UPGRADE32', 'BTN_UPGRADE33', 'BTN_ASSEMBLE', 'BTN_BACK']) && slotReach.row0.ok
      && slotReach.ray.slot2.aimed && slotReach.ray.slot2.hover && slotReach.ray.assemble.aimed && slotReach.ray.assemble.hover
      && !!scroll.aimed?.ok && scroll.hovered === true && scroll.maxScroll > 0 && scroll.down > scroll.before
      && scroll.neutral === scroll.down && scroll.up < scroll.down,
    { selectReach: { ...selectReach, layout: undefined }, slotReach: { ...slotReach, layout: undefined }, scroll });
    check('12_panelPngsControlsInside', selectPanel.host && selectPanel.presenting && selectPanel.ownerIsMenu && selectPanel.litFraction > 0.05
      && slotPanel.host && slotPanel.ownerIsMenu && slotPanel.litFraction > 0.05
      && allInside(selectReach.layout) && allInside(slotReach.layout)
      // LB_ITEMS ends above the slot buttons, and BTN_OK (on top of Assemble) is hidden.
      && slotReach.layout.LB_ITEMS?.box.minY >= slotReach.layout.BTN_UPGRADE31?.box.maxY && !slotReach.layout.BTN_OK,
    { selectPanel, slotPanel, selectLayout: selectReach.layout, slotLayout: slotReach.layout });

    // 9. Create Items opens MenuComponent (routine 354 with item creation allowed, run as k_workbench's second use);
    // the forced-oItem route opens MenuUpgrade for the blaster.
    const create = await harness.evaluate(`(async()=>{const U=window.__up,K=window.KotOR,g=K.GameState,MM=g.MenuManager,p=K.PartyManager.Player;
      const closed=await U.closeAll();
      g.GlobalVariableManager.SetGlobalNumber('000_Workbench',1);
      const bench=window.__bench,own=bench.scripts['OnUsed'];
      bench.scripts['OnUsed']=K.NWScript.Load('k_workbench');
      try{ bench.use(p); for(let i=0;i<120 && !U.sel().bVisible;i++) await U.pause(50); } finally { bench.scripts['OnUsed']=own; }
      await U.pause(500);
      const select=U.selState();
      U.sel().BTN_CREATEITEMS.click();
      for(let i=0;i<80 && !MM.MenuComponent.bVisible;i++) await U.pause(50);
      await U.pause(500);
      const component={visible:!!MM.MenuComponent.bVisible,foreground:MM.GetCurrentMenu()===MM.MenuComponent,recipeTable:MM.MenuComponent.recipeTable,
        user:MM.MenuComponent.activeUser()===p};
      MM.MenuComponent.BTN_Cancel.click(); await U.pause(400);
      const backToSelect=MM.GetCurrentMenu()===U.sel();
      const closedAgain=await U.closeAll();
      const b=window.__blaster;
      K.NWScriptDefK2.Actions[354].action.call({}, [b, p, 0, 0, '']);
      for(let i=0;i<80 && !U.up().bVisible;i++) await U.pause(50);
      await U.pause(300);
      const forced={...U.upState(),selectVisible:!!U.sel().bVisible,isBlaster:U.up().item===b};
      const forcedClosed=await U.closeAll();
      return {closed,select:{visible:select.visible,createVisible:select.createVisible,createText:select.createText,allowCreate:select.allowCreate,recipeTable:select.recipeTable},
        component,backToSelect,closedAgain,forced:{visible:forced.visible,foreground:forced.foreground,isBlaster:forced.isBlaster,
        selectVisible:forced.selectVisible,title:forced.title,slots:forced.slots.length},forcedClosed};})()`, { timeoutMs: 120000 });
    report.notes.create = create;
    check('9_createItemsAndForcedItem', create.select.visible && create.select.createVisible && create.select.createText === 'Create Items'
      && create.select.allowCreate && create.component.visible && create.component.foreground && create.component.recipeTable === 'itemcreate'
      && create.component.user && create.backToSelect && create.closedAgain.select === false
      && create.forced.visible && create.forced.foreground && create.forced.isBlaster && create.forced.selectVisible === false
      && create.forced.slots === 3 && create.forcedClosed.upgrade === false && create.forcedClosed.mode === 1, create);

    // 10. Save with the scope installed in the Exile's equipped blaster, reload: UpgradeSlot0 persists and the bonus applies.
    const saved = await harness.evaluate(`(async()=>{const U=window.__up,K=window.KotOR,p=K.PartyManager.Player,b=window.__blaster;
      U.sel().refresh(0);
      await U.openItem(b);
      if(!U.up().bVisible){ await U.sel().openFor(p,{}); await U.pause(300); await U.openItem(b); }
      await U.stage(0,${JSON.stringify(AB_SCOPE)}); await U.assemble(); await U.closeAll();
      const before={slot0:b.getUpgradeSlot(0),equipped:p.equipment.RIGHTHAND===b,ab:U.ab(p,p.equipment.RIGHTHAND),armorSlot1:window.__armor.getUpgradeSlot(1)};
      await K.SaveGame.SaveCurrentGame('Upgrade probe',${SCRATCH_SAVE_ID});
      const s=K.SaveGame.saves.find(s=>s.getSaveNumber()===${SCRATCH_SAVE_ID});if(!s) return {saved:false,before};
      window.__memoryProbeLoad={module:${JSON.stringify(MODULE)},error:null};await s.load();return {saved:true,before};})()`, { timeoutMs: 180000 });
    await harness.waitFor(landed, 300000, 500);
    await harness.evaluate(PAGE_HELPERS);
    const reloaded = await harness.evaluate(`(()=>{const U=window.__up,K=window.KotOR,g=K.GameState,p=K.PartyManager.Player;
      const w=p.equipment.RIGHTHAND;
      const armor=g.InventoryManager.inventory.find(i=>U.resrefOf(i)===${JSON.stringify(armor.resref)} && i.getUpgradeSlot(1)>=0);
      return {weapon:U.resrefOf(w),slot0:w?w.getUpgradeSlot(0):null,ab:w?U.ab(p,w):null,armorSlot1:armor?armor.getUpgradeSlot(1):null};})()`);
    report.notes.reload = { saved, reloaded };
    check('10_upgradePersistsAcrossSave', saved.saved && saved.before.slot0 === bare.abRow && saved.before.equipped
      && saved.before.ab === bare.ab + scopeDelta && reloaded.weapon === BLASTER && reloaded.slot0 === bare.abRow
      && reloaded.ab === saved.before.ab && reloaded.armorSlot1 === saved.before.armorSlot1, { saved, reloaded });

    report.consoleErrors = harness.consoleMessages
      .filter((m) => m.level === 'error' && /upgrade|workbench|ShowUpgradeScreen|crafting/i.test(String(m.text)))
      .map((m) => String(m.text).slice(0, 300)).slice(0, 10);
    report.upgradeWarnings = harness.consoleMessages
      .filter((m) => /UpgradeEnginePorts|MenuUpgrade|ModuleItem: upgrade/i.test(String(m.text)))
      .map((m) => String(m.text).slice(0, 300)).slice(0, 10);
    report.pageErrors = harness.pageErrors.map((e) => String(e).slice(0, 300)).slice(0, 10);
  } catch (error) {
    report.error = String(error && error.stack || error);
  } finally {
    await harness.close().catch(() => {});
    if (service) service.stop();
    try { fs.rmSync(path.dirname(userRoot), { recursive: true, force: true }); } catch (e) { report.cleanupError = String(e); }
  }

  report.passed = !report.error && Object.keys(report.checks).length === 12 && Object.values(report.checks).every(Boolean);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
