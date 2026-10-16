/**
 * Lightsaber upgrade probe (ROADMAP 7.7, lightsaber upgrades).
 *
 * Boots the browser build against an emulated Quest 3 on an isolated copy of
 * the SpaceRoach Peragus save, loads 103PER (the fuel depot) and drives the
 * placed bench through workbnch.dlg's "[Use the workbench to upgrade items.]"
 * reply (k_workbench_t3), which opens MenuUpgradeSelect. A granted
 * g_w_lghtsbr01 (variation 1, blue) then goes through: the Lightsaber tab,
 * the six-slot _LS layout with the 3D preview, two crystals, a lens, an
 * emitter and a cell installed and their bonuses reaching the wielder, the
 * colour slot, the preview recolouring when red is staged, Assemble swapping
 * the colour crystals and reloading the worn blade in the hand, Back with a
 * staged colour changing nothing and disposing the preview, a standard item
 * opened after the saber getting the standard layout back, pointer reach and
 * stick scrolling, and save/reload persistence. PNGs of the panel and of the
 * preview go to tools/vr-emulator/evidence/lightsaber/.
 *
 *   node tools/vr-emulator/probe-lightsaber.js [--cdp 9547] [--port 8587]
 *
 * Build first (npm run webpack:dev): the asset service serves dist/. It runs
 * its own asset service on --port, so a busy 8479 does not matter.
 * Prints a JSON summary; exits non-zero when any check fails.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');
const { landed, loadModule } = require('./probe-memory-growth');
const { enterVrSession, playDialogue } = require('./playthrough-steps');

const args = process.argv.slice(2);
const argNumber = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);
const CDP_PORT = argNumber('--cdp', 9547);
const ASSET_PORT = argNumber('--port', 8587);
const SAVE_DIRECTORY = 'Saves/000100 - Game99';
const MODULE = '103PER';
const SCRATCH_SAVE_ID = 147;
const SABER = 'g_w_lghtsbr01';
const BLASTER = 'w_blaste_09';
const BLUE = 'u_l_colo_01';
const RED = 'u_l_colo_04';
/** Slot index -> the part the probe installs (slot 1 is the colour crystal). */
const PARTS = { 0: 'u_l_crys_02', 2: 'u_l_crys_16', 3: 'u_l_lens_01', 4: 'u_l_emit_01', 5: 'u_l_cell_02' };
/** Extra crystals so the crystal slot's list overflows LB_ITEMS (stick scrolling). */
const SPARE_CRYSTALS = ['u_l_crys_01', 'u_l_crys_03', 'u_l_crys_04', 'u_l_crys_05', 'u_l_crys_06', 'u_l_crys_07'];
const LS_BUTTONS = ['BTN_UPGRADE31_LS', 'BTN_UPGRADE32_LS', 'BTN_UPGRADE33_LS', 'BTN_UPGRADE34_LS', 'BTN_UPGRADE35_LS', 'BTN_UPGRADE36_LS'];
const STD_BUTTONS = ['BTN_UPGRADE31', 'BTN_UPGRADE32', 'BTN_UPGRADE33'];
const RIGHTHAND = 0x10;
const NOTICE = "Upgrading items isn't available yet.";
const EVIDENCE_DIR = path.join(__dirname, 'evidence', 'lightsaber');
const FIXTURE_CANDIDATES = [
  path.join(__dirname, 'evidence', 'spaceroach-saves-ZaBsC0', 'user'),
  path.join('C:', 'Users', 'allen', 'source', 'repos', 'kotor2-vr', 'tools', 'vr-emulator', 'evidence', 'spaceroach-saves-ZaBsC0', 'user'),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isolatedUserRoot() {
  const fixture = FIXTURE_CANDIDATES.find((candidate) => fs.existsSync(path.join(candidate, SAVE_DIRECTORY)));
  if (!fixture) throw new Error('SpaceRoach save fixture not found: ' + FIXTURE_CANDIDATES.join(' | '));
  const userRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2-lightsaber-')), 'user');
  fs.cpSync(path.join(fixture, SAVE_DIRECTORY), path.join(userRoot, SAVE_DIRECTORY), { recursive: true });
  return { fixture, userRoot };
}

/**
 * Page-side helpers, installed once per page as window.__ls. Pointer, aim,
 * stick and list helpers are probe-upgrade.js's; the slot helpers follow the
 * open layout (the _LS buttons for a saber).
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
  const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
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
    for (let s = 0; s <= list.maxScroll; s++) { list.scroll = s; list.updateList(); if (rowInList(list, row)) return true; }
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
  const endConversations = async () => { const cm = g.CutsceneManager;
    for (let i = 0; i < 10 && cm.active; i++) { cm.endConversation(true); await pause(300); } return !cm.active; };
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
      rows: (m.rows || []).map((r) => ({ resref: resrefOf(r.item), baseItem: Number(r.item?.getBaseItemId?.()),
        variation: Number(r.item?.getModelVariation?.()), wearer: r.wearer ? String(r.wearer.getName?.()) : null })),
      lightsaberDisabled: !!m.BTN_LIGHTSABER?.disableSelection, allowCreate: m.allowCreate,
      createVisible: !!m.BTN_CREATEITEMS?.isVisible?.(),
    };
  };
  const visible = (c) => !!c && !!c.isVisible?.();
  /** The slot buttons of the open layout. */
  const slotButtons = () => { const m = up(); return (m.layout === 'lightsaber' ? ${JSON.stringify(LS_BUTTONS)} : ${JSON.stringify(STD_BUTTONS)}).map((n) => m[n]); };
  const upState = () => {
    const m = up();
    const ctl = {};
    for (const key of Object.keys(m)) {
      if (!/^(BTN|LBL|LB)_|^_3D_MODEL/.test(key)) continue;
      const c = m[key];
      if (!c || typeof c.isVisible !== 'function') continue;
      ctl[key] = visible(c);
    }
    return {
      visible: !!m.bVisible, foreground: MM.GetCurrentMenu() === m, layout: m.layout,
      title: m.LBL_TITLE?.getText?.(), item: resrefOf(m.item), selectedSlot: m.selectedSlot,
      slots: m.slots().map((s) => ({ index: s.index, type: s.type, open: s.open, installed: s.installed?.resref || null,
        staged: s.staged === null ? 'remove' : (s.staged?.resref || null) })),
      rows: (m.listRows || []).map((r) => r.kind === 'remove' ? 'remove' : r.part.resref),
      hasChanges: !!m.session?.hasChanges(), slotName: m.LBL_SLOTNAME?.getText?.(), property: m.LBL_PROPERTY?.getText?.(),
      controls: ctl, previewView: !!m.previewView, previewResRef: m.previewResRef, previewModel: m.previewModel?.name || null,
      previewVariation: m.previewVariation(), listExtent: m.LB_ITEMS?.extent ? { top: m.LB_ITEMS.extent.top, height: m.LB_ITEMS.extent.height } : null,
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
  /** Clicks slot button i of the open layout. */
  const pickSlot = async (slot) => { slotButtons()[slot].click(); await pause(200); return upState(); };
  /** Clicks slot button i, then the LB_ITEMS row for resref ('remove' = the Remove row). */
  const stage = async (slot, resref) => {
    const m = up();
    await pickSlot(slot);
    const index = m.listRows.findIndex((r) => resref === 'remove' ? r.kind === 'remove' : (r.kind === 'part' && r.part.resref === resref));
    if (index < 0) return { staged: false, ...upState() };
    revealRow(m.LB_ITEMS, index);
    m.LB_ITEMS.children[index].click();
    await pause(200);
    return { staged: true, ...upState() };
  };
  const assemble = async () => { up().BTN_ASSEMBLE.click(); await pause(300); return upState(); };
  const back = async () => { up().BTN_BACK.click(); await pause(400); return { upgrade: !!up().bVisible, select: selState() }; };
  const ab = (creature, weapon) => Number(creature.getAttackBonusFor(weapon));
  /** Attack and damage properties of a property list (usable only). */
  const bonusProps = (props) => (props || []).filter((p) => p.isUseable?.() && (p.propertyName === 38 || p.propertyName === 11))
    .map((p) => ({ name: p.propertyName, subType: p.propertyName === 11 ? (p.getSubType?.()?.id ?? p.subType) : p.subType,
      value: p.propertyName === 11 ? p.getExpectedValue() : Number(p.getValue()) || 0 }));
  /**
   * The weapon's damage bonus as combat applies it (ModuleItem.getDamageBonuses:
   * per damage type, the property with the highest expected value), totalled
   * as expected values so dice rows do not roll.
   */
  const damageOf = (item) => {
    const best = new Map();
    for (const p of item.getEffectiveProperties()) {
      if (!p.isUseable?.() || p.propertyName !== 11) continue;
      const type = p.getSubType?.()?.id || 0, v = p.getExpectedValue();
      if (!best.has(type) || v > best.get(type)) best.set(type, v);
    }
    const engineTypes = item.getDamageBonuses().map((b) => b.type);
    return { total: [...best.values()].reduce((a, b) => a + b, 0), byType: Object.fromEntries(best), engineTypes };
  };
  /** The parts' properties: getEffectiveProperties past the item's own list. */
  const partProps = (item) => item.getEffectiveProperties().slice(item.properties.length);
  const isModel3D = (o) => !!o && !!o.odysseyAnimationMap && typeof o.playAnimation === 'function';
  const handState = (creature, item) => {
    const rhand = creature.model?.rhand;
    const models = rhand ? rhand.children.filter(isModel3D) : [];
    const held = K.VRSpike?.hooks?.getHeldVisuals?.();
    const heldModels = held ? ['left', 'right'].map((h) => held[h]?.model ?? held[h]?.source ?? null) : [];
    return { equipped: creature.equipment.RIGHTHAND === item, model: item.model?.name || null,
      onHand: !!rhand && item.model?.parent === rhand, handModels: models.map((m) => m.name),
      bladeModels: models.filter((m) => /^w_lghtsbr/.test(String(m.name))).length,
      heldBridge: heldModels.some((m) => m === item.model),
      // What the controller anchor host presents in the VR hand (it clones the bridge's model when the source changes).
      presented: Object.values(K.VRSpike?.controllerAnchorHost?.heldSources || {}).some((m) => !!m && m === item.model) };
  };
  /** Waits until the worn item's model is resref and on the hand. */
  const waitForModel = async (creature, item, resref) => {
    for (let i = 0; i < 100; i++) { const s = handState(creature, item); if (s.model === resref && s.onHand) return { polls: i, ...s }; await pause(100); }
    return { polls: -1, ...handState(creature, item) };
  };
  const texIdle = async () => { const TL = K.TextureLoader, m = up();
    for (let i = 0; i < 120; i++) { const md = m.previewModel; let pending = 0;
      md && md.traverse((o) => { const t = o.material?.uniforms?.map?.value; if (o.material && (!t || !t.image)) pending++; });
      if (md && (TL?.queue?.length ?? 0) === 0 && pending === 0) { await pause(600); return { ok: true, polls: i }; }
      await pause(250); }
    return { ok: false }; };
  /** The preview's own texture, read back through three, with its mean lit colour. */
  const viewPixels = () => { const v = up().previewView; if (!v) return null;
    const rt = v.texture, w = rt.width, h = rt.height, px = new Uint8Array(w * h * 4); g.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255; ctx.putImageData(img, 0, 0);
    let lit = 0; const sum = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i + 1] + px[i + 2] > 60) { lit++; sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; } }
    return { w, h, lit: +(lit / (w * h)).toFixed(4), meanLit: sum.map((s) => (lit ? Math.round(s / lit) : 0)), png: c.toDataURL('image/png') }; };
  const panelPixels = (menu) => { const host = K.VRSpike.panelHost; if (!host) return { host: false };
    const rt = host.renderTarget, w = rt.width, h = rt.height, px = new Uint8Array(w * h * 4); g.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); ctx.putImageData(img, 0, 0);
    let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
    return { host: true, presenting: K.VRSpike.isPresenting === true, ownerIsMenu: host.owner === menu, w, h,
      litFraction: +(lit / (w * h)).toFixed(3), png: c.toDataURL('image/png') }; };
  window.__ls = { sel, up, resrefOf, count, uti, addItem, targetable, rowTargetable, boxOf, overlaps, aimAt, resetAim, boxCentre,
    rayHovers, revealRow, stickScroll, pause, endConversations, closeAll, selState, upState, openItem, pickSlot, stage, assemble, back,
    ab, bonusProps, damageOf, partProps, handState, waitForModel, texIdle, viewPixels, panelPixels, visible, slotButtons };
  return true;
})()`;

async function main() {
  const report = { checks: {}, notes: {}, pngs: {} };
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
  report.ports = { cdp: CDP_PORT, assets: ASSET_PORT };
  const harness = new VrHarness({ port: CDP_PORT });
  let service;
  const writePng = (name, result) => {
    if (!result || !result.png) return result;
    const file = path.join(EVIDENCE_DIR, name);
    fs.writeFileSync(file, Buffer.from(result.png.split(',')[1], 'base64'));
    delete result.png;
    result.file = file;
    report.pngs[name] = file;
    return result;
  };
  const panelPng = async (name, menuExpr = 'window.__ls.up()') => {
    await sleep(1500);
    return writePng(name, await harness.evaluate(`window.__ls.panelPixels(${menuExpr})`, { timeoutMs: 30000 }));
  };
  const viewPng = async (name) => writePng(name, await harness.evaluate('window.__ls.viewPixels()', { timeoutMs: 30000 }));
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

    // The bench's own conversation: the "upgrade items" reply (k_workbench_t3) opens MenuUpgradeSelect.
    const bench = await harness.evaluate(`(()=>{const K=window.KotOR,g=K.GameState;const list=g.module.area.placeables;
      const p=list.find(p=>/^(000_)?workbench$/i.test(String(p.tag||p.getTag?.()||'')));
      if(!p) return {found:false};
      window.__bench=p;return {found:true,tag:p.tag,template:p.getTemplateResRef?.()||null};})()`);
    report.notes.bench = bench;
    if (!bench.found) throw new Error('Workbench placeable not found');

    // Grant the saber, its parts, the red colour crystal, spare crystals and a blaster (a standard item).
    const grant = await harness.evaluate(`(async()=>{const U=window.__ls,K=window.KotOR,g=K.GameState;
      const before={};
      for(const r of [${JSON.stringify(SABER)},${JSON.stringify(BLUE)},${JSON.stringify(RED)},...${JSON.stringify(Object.values(PARTS))}]) before[r]=U.count(r);
      window.__saber=(await U.addItem(${JSON.stringify(SABER)}))[0];
      window.__blaster=(await U.addItem(${JSON.stringify(BLASTER)}))[0];
      for(const r of ${JSON.stringify(Object.values(PARTS))}) await U.addItem(r);
      await U.addItem(${JSON.stringify(RED)});
      for(const r of ${JSON.stringify(SPARE_CRYSTALS)}){try{await U.addItem(r);}catch(e){}}
      const s=window.__saber;
      const table=g.TwoDAManager.datatables.get('upcrystals').rows;
      const colourRow=(t)=>{for(const k of Object.keys(table)) if(String(table[k].template||'').toLowerCase()===t) return {row:Number(k),...table[k]}; return null;};
      const port=U.up().engine;
      const partInfo={};
      for(const r of ${JSON.stringify(Object.values(PARTS))}){const d=port.displayItem(r);
        partInfo[r]={name:d?.getName?.(),props:U.bonusProps(d?.properties),all:(d?.properties||[]).map(p=>[p.propertyName,p.subType,p.costTable,p.costValue,!!p.isUseable?.()])};}
      return {before,inBag:g.InventoryManager.inventory.includes(s),variation:s.getModelVariation(),level:s.getUpgradeLevel(),baseItem:s.getBaseItemId(),
        model:s.modelResRefFor(s.getModelVariation()),blue:{name:port.displayItem(${JSON.stringify(BLUE)})?.getName?.(),row:colourRow(${JSON.stringify(BLUE)})},
        red:{name:port.displayItem(${JSON.stringify(RED)})?.getName?.(),row:colourRow(${JSON.stringify(RED)}),variation:port.variationForCrystal(s,${JSON.stringify(RED)})},
        partInfo,saberOwnProps:(s.properties||[]).map(p=>[p.propertyName,p.subType,p.costTable,p.costValue,!!p.isUseable?.()]),
        playerGoodEvil:K.PartyManager.Player.getGoodEvil?.(),playerRight:U.resrefOf(K.PartyManager.Player.equipment.RIGHTHAND)};})()`, { timeoutMs: 60000 });
    report.notes.grant = grant;

    const use = await harness.evaluate(`(async()=>{const U=window.__ls,g=window.KotOR.GameState,cm=g.CutsceneManager;
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

    // 1. The Lightsaber tab (clicked) lists only sabers, the granted one among them; All lists it too.
    const tabs = await harness.evaluate(`(async()=>{const U=window.__ls,m=U.sel(),g=window.KotOR.GameState;
      for(let i=0;i<100 && !m.bVisible;i++) await U.pause(100);
      await U.pause(800);
      const opened={...U.selState(),conversationActive:!!g.CutsceneManager.active,notices:window.__upNotices.map(a=>String(a[0]))};
      m.BTN_LIGHTSABER.click(); await U.pause(300);
      const ls=U.selState();
      const lsHasSaber=m.rows.some(r=>r.item===window.__saber);
      m.BTN_ALL.click(); await U.pause(300);
      const all=U.selState();
      const allHasSaber=m.rows.some(r=>r.item===window.__saber), allHasBlaster=m.rows.some(r=>r.item===window.__blaster);
      return {opened:{visible:opened.visible,foreground:opened.foreground,tab:opened.tab,lightsaberDisabled:opened.lightsaberDisabled,
        conversationActive:opened.conversationActive,notices:opened.notices},
        ls:{tab:ls.tab,rows:ls.rows},lsHasSaber,all:{tab:all.tab,rows:all.rows.map(r=>r.resref)},allHasSaber,allHasBlaster};})()`, { timeoutMs: 60000 });
    report.notes.dialogue = { use, transcript: dialogue.transcript, error: dialogue.error };
    check('1_tabLists', use.active && /workbnch/i.test(String(use.resref))
      && dialogue.transcript.some((line) => /\[script=k_workbench_t3\]/i.test(line))
      && tabs.opened.visible && tabs.opened.foreground && !tabs.opened.conversationActive && !tabs.opened.notices.includes(NOTICE)
      && tabs.opened.lightsaberDisabled === false && grant.variation === 1
      && tabs.ls.tab === 'lightsaber' && tabs.lsHasSaber && tabs.ls.rows.length >= 1
      && tabs.ls.rows.every((r) => [8, 9, 10].includes(r.baseItem)) && !tabs.ls.rows.some((r) => r.resref === BLASTER)
      && tabs.all.tab === 'all' && tabs.allHasSaber && tabs.allHasBlaster, { grant: { variation: grant.variation, level: grant.level, baseItem: grant.baseItem }, ...tabs });

    // 2. The saber's slot screen: six _LS buttons, the standard three and 3D_MODEL hidden, 3D_MODEL_LS shown,
    //    LBL_PROPERTY hidden, LB_ITEMS clear of every visible _LS button and of 3D_MODEL_LS.
    const layout = await harness.evaluate(`(async()=>{const U=window.__ls,m=U.up();
      U.sel().BTN_LIGHTSABER.click(); await U.pause(300);
      const opened=await U.openItem(window.__saber);
      const list=U.boxOf(m.LB_ITEMS);
      const lsKeys=Object.keys(m).filter(k=>/_LS$/.test(k) && m[k] && typeof m[k].isVisible==='function' && m[k].isVisible());
      const lsBoxes=Object.fromEntries(lsKeys.map(k=>[k,U.boxOf(m[k])]));
      const overlapping=Object.entries(lsBoxes).filter(([k,b])=>/^BTN_|_3D_MODEL_LS$/.test(k) && U.overlaps(list,b)).map(([k])=>k);
      return {opened,list,lsBoxes,overlapping,slotName:U.boxOf(m.LBL_SLOTNAME)};})()`, { timeoutMs: 60000 });
    const c = layout.opened.controls || {};
    await panelPng('2_layout-panel.png');
    check('2_layout', layout.opened.visible && layout.opened.foreground && layout.opened.item === SABER && layout.opened.layout === 'lightsaber'
      && layout.opened.slots.length === 6 && layout.opened.slots.map((s) => s.type).join() === '0,-1,0,1,2,3'
      && LS_BUTTONS.every((n) => c[n] === true) && LS_BUTTONS.every((n) => c[n.replace('BTN_', 'LBL_')] === true)
      && STD_BUTTONS.every((n) => c[n] === false && c[n.replace('BTN_', 'LBL_')] === false)
      && c._3D_MODEL === false && c._3D_MODEL_LS === true && c.LBL_PROPERTY === false
      && layout.overlapping.length === 0 && layout.list.maxY <= layout.slotName.minY
      && Object.keys(layout.lsBoxes).filter((k) => /^BTN_|_3D_MODEL_LS$/.test(k)).length === 7, layout);

    // 3. Bare saber equipped: the wielder's attack and damage bonus. Then install the five parts through the
    //    screen, equip again: the bonuses equal the bare values plus the parts' (getEffectiveProperties).
    const parts = await harness.evaluate(`(async()=>{const U=window.__ls,K=window.KotOR,g=K.GameState,p=K.PartyManager.Player,s=window.__saber;
      await U.back();
      const prior=p.equipment.RIGHTHAND||null; window.__priorRight=prior;
      await p.equipItem(${RIGHTHAND},s); await U.pause(300);
      const bare={equipped:p.equipment.RIGHTHAND===s,ab:U.ab(p,s),damage:U.damageOf(s),own:U.bonusProps(s.properties)};
      p.unequipSlot(${RIGHTHAND},true); await U.pause(300);
      const bagBack=g.InventoryManager.inventory.includes(s);
      U.sel().refresh(0); await U.pause(200);
      const opened=await U.openItem(s);
      const staged=[];
      for(const [slot,resref] of ${JSON.stringify(Object.entries(PARTS))}){const r=await U.stage(Number(slot),resref);staged.push({slot:Number(slot),resref,staged:r.staged,shown:r.slots[Number(slot)]?.staged});}
      const before=Object.fromEntries(${JSON.stringify(Object.values(PARTS))}.map(r=>[r,U.count(r)]));
      const assembled=await U.assemble();
      const after=Object.fromEntries(${JSON.stringify(Object.values(PARTS))}.map(r=>[r,U.count(r)]));
      const slotsAfter=[0,1,2,3,4,5].map(i=>s.getUpgradeSlot(i));
      await U.back();
      await p.equipItem(${RIGHTHAND},s); await U.pause(300);
      const pp=U.partProps(s);
      const installed={equipped:p.equipment.RIGHTHAND===s,ab:U.ab(p,s),damage:U.damageOf(s),partBonus:U.bonusProps(pp),
        partCount:pp.length,effective:s.getEffectiveProperties().length,own:s.properties.length};
      return {bare,bagBack,openedSlots:opened.slots,staged,before,after,assembled:{slots:assembled.slots,hasChanges:assembled.hasChanges},slotsAfter,installed};})()`, { timeoutMs: 120000 });
    const partAB = parts.installed.partBonus.filter((b) => b.name === 38).map((b) => b.value);
    const partDamage = parts.installed.partBonus.filter((b) => b.name === 11);
    const abSum = partAB.reduce((a, b) => a + b, 0);
    const damageSum = partDamage.reduce((a, b) => a + b.value, 0);
    // Ruling R5: same-kind bonuses do not stack, the best applies. The expected value from the parts follows it
    // (it equals the plain sum when no two sources share a kind, which the notes record).
    const ownAB = Math.max(0, ...parts.bare.own.filter((b) => b.name === 38).map((b) => b.value));
    const bestAB = Math.max(ownAB, ...partAB);
    const expectedAB = parts.bare.ab + (bestAB - ownAB);
    const ownDamageTypes = new Map(Object.entries(parts.bare.damage.byType).map(([k, v]) => [Number(k), v]));
    let expectedDamage = parts.bare.damage.total;
    const partBestByType = new Map();
    for (const d of partDamage) partBestByType.set(d.subType, Math.max(partBestByType.get(d.subType) ?? 0, d.value));
    for (const [type, v] of partBestByType) expectedDamage += Math.max(0, v - (ownDamageTypes.get(type) ?? 0));
    const stacking = { abSum, damageSum, abSumEqualsR5: parts.bare.ab + abSum === expectedAB, damageSumEqualsR5: parts.bare.damage.total + damageSum === expectedDamage };
    check('3_parts', parts.bare.equipped && parts.bagBack && parts.openedSlots.every((s) => s.open)
      && parts.staged.every((s) => s.staged && s.shown === s.resref) && parts.assembled.hasChanges === false
      && Object.values(PARTS).every((r) => parts.after[r] === parts.before[r] - 1)
      && parts.slotsAfter[1] === -1 && [0, 2, 3, 4, 5].every((i) => parts.slotsAfter[i] >= 0)
      && parts.assembled.slots.every((s, i) => i === 1 || s.installed === PARTS[i])
      && parts.installed.equipped && parts.installed.partCount > 0 && (abSum > 0 || damageSum > 0)
      && parts.installed.ab === expectedAB && Math.abs(parts.installed.damage.total - expectedDamage) < 1e-9
      && (expectedAB > parts.bare.ab || expectedDamage > parts.bare.damage.total),
    { ...parts, expectedAB, expectedDamage, stacking });

    // 4. The colour slot: the red crystal listed, the current (blue) not, no Remove row; LBL_SLOTNAME names the blue crystal.
    const colourRows = await harness.evaluate(`(async()=>{const U=window.__ls,s=window.__saber;
      U.sel().refresh(0); await U.pause(200);
      await U.openItem(s);
      const st=await U.pickSlot(1);
      return {...st,blueName:U.up().engine.displayItem(${JSON.stringify(BLUE)})?.getName?.(),blueBag:U.count(${JSON.stringify(BLUE)}),redBag:U.count(${JSON.stringify(RED)})};})()`, { timeoutMs: 60000 });
    check('4_colourRows', colourRows.layout === 'lightsaber' && colourRows.selectedSlot === 1
      && colourRows.slots[1].type === -1 && colourRows.slots[1].installed === BLUE
      && colourRows.rows.includes(RED) && !colourRows.rows.includes(BLUE) && !colourRows.rows.includes('remove')
      && colourRows.slotName === 'Colour Crystal: ' + colourRows.blueName && !!colourRows.blueName, colourRows);

    // 5. The preview: blue at variation 1, then red staged -> previewVariation 2 and the model w_lghtsbr_002.
    const idle1 = await harness.evaluate('window.__ls.texIdle()', { timeoutMs: 60000 });
    const pre = await harness.evaluate('window.__ls.upState()');
    const viewBefore = await viewPng('5_preview-blue.png');
    const panelBefore = await panelPng('5_panel-blue.png');
    const staging = await harness.evaluate(`(async()=>{const U=window.__ls,m=U.up();
      const i=m.listRows.findIndex(r=>r.kind==='part'&&r.part.resref===${JSON.stringify(RED)});
      if(i<0) return {clicked:false};
      U.revealRow(m.LB_ITEMS,i); m.LB_ITEMS.children[i].click(); await U.pause(300);
      return {clicked:true,...U.upState(),itemVariation:window.__saber.getModelVariation()};})()`, { timeoutMs: 30000 });
    const idle2 = await harness.evaluate(`(async()=>{const U=window.__ls,m=U.up();
      for(let i=0;i<80 && m.previewModel?.name!==${JSON.stringify('w_lghtsbr_002')};i++) await U.pause(100);
      return U.texIdle();})()`, { timeoutMs: 60000 });
    const post = await harness.evaluate('window.__ls.upState()');
    const viewAfter = await viewPng('5_preview-red.png');
    const panelAfter = await panelPng('5_panel-red.png');
    const redder = (v) => v && v.meanLit[0] - v.meanLit[2];
    check('5_previewRecolours', idle1.ok && idle2.ok && pre.previewView && pre.previewVariation === 1
      && pre.previewResRef === 'w_lghtsbr_001' && pre.previewModel === 'w_lghtsbr_001'
      && staging.clicked && staging.slots[1].staged === RED && staging.itemVariation === 1
      && post.previewVariation === 2 && post.previewResRef === 'w_lghtsbr_002' && post.previewModel === 'w_lghtsbr_002'
      && !!viewBefore && !!viewAfter && viewBefore.lit > 0 && viewAfter.lit > 0 && redder(viewAfter) > redder(viewBefore),
    { idle1, idle2, pre: { previewVariation: pre.previewVariation, previewResRef: pre.previewResRef, previewModel: pre.previewModel },
      staged: staging.slots?.[1], post: { previewVariation: post.previewVariation, previewResRef: post.previewResRef, previewModel: post.previewModel },
      viewBefore, viewAfter, panelBefore, panelAfter });

    // 6. Assemble with the saber worn: blue back in the bag, red gone, variation 2, the hand's blade reloaded in place.
    const swap = await harness.evaluate(`(async()=>{const U=window.__ls,K=window.KotOR,g=K.GameState,p=K.PartyManager.Player,s=window.__saber;
      const before={blue:U.count(${JSON.stringify(BLUE)}),red:U.count(${JSON.stringify(RED)}),sabers:U.count(${JSON.stringify(SABER)}),
        hand:U.handState(p,s),ab:U.ab(p,s),damage:U.damageOf(s).total};
      const oldModel=s.model;
      const a=await U.assemble();
      const hand=await U.waitForModel(p,s,'w_lghtsbr_002');
      await U.pause(500);
      const settled=U.handState(p,s);
      return {before,after:{blue:U.count(${JSON.stringify(BLUE)}),red:U.count(${JSON.stringify(RED)}),sabers:U.count(${JSON.stringify(SABER)}),
        inBag:g.InventoryManager.inventory.includes(s),variation:s.getModelVariation(),field:s.template.RootNode.hasField('ModelVariation')?s.template.getFieldByLabel('ModelVariation').getValue():null,
        slot1:s.getUpgradeSlot(1),ab:U.ab(p,s),damage:U.damageOf(s).total},
        hand,settled,oldModelDetached:!oldModel||oldModel.parent!==p.model?.rhand,newModelObject:s.model!==oldModel,
        screen:{installed:a.slots[1].installed,staged:a.slots[1].staged,hasChanges:a.hasChanges,slotName:a.slotName,previewModel:a.previewModel}};})()`, { timeoutMs: 60000 });
    check('6_swap', swap.after.blue === swap.before.blue + 1 && swap.before.red === 1 && swap.after.red === 0
      && swap.after.variation === 2 && swap.after.field === 2 && swap.after.slot1 === -1
      && swap.before.hand.equipped && swap.before.hand.model === 'w_lghtsbr_001'
      && swap.hand.polls >= 0 && swap.settled.equipped && swap.settled.model === 'w_lghtsbr_002' && swap.settled.onHand
      && swap.settled.bladeModels === 1 && swap.settled.handModels.length === 1 && swap.settled.heldBridge && swap.settled.presented
      && swap.oldModelDetached && swap.newModelObject && swap.after.sabers === swap.before.sabers && !swap.after.inBag
      && swap.after.ab === swap.before.ab && swap.after.damage === swap.before.damage
      && swap.screen.installed === RED && swap.screen.staged === null && swap.screen.hasChanges === false, swap);

    // 8. Stage blue, Back: the saber stays red, the bag is unchanged, the preview is disposed and never renders again.
    const cancel = await harness.evaluate(`(async()=>{const U=window.__ls,s=window.__saber,m=U.up();
      const bag=()=>({blue:U.count(${JSON.stringify(BLUE)}),red:U.count(${JSON.stringify(RED)}),sabers:U.count(${JSON.stringify(SABER)})});
      const before=bag();
      const staged=await U.stage(1,${JSON.stringify(BLUE)});
      const view=m.previewView;
      const View=view?.constructor;
      let renders=0,thisRenders=0;
      const own=View?.prototype.render;
      if(View) View.prototype.render=function(...a){renders++;if(this===view)thisRenders++;return own.apply(this,a);};
      try{
        await U.pause(600);
        const whileOpen={renders,thisRenders};
        const backed=await U.back();
        renders=0;thisRenders=0;
        await U.pause(1500);
        return {before,staged:{staged:staged.staged,shown:staged.slots[1].staged,previewVariation:staged.previewVariation},whileOpen,
          afterClose:{renders,thisRenders},backed:{upgrade:backed.upgrade,select:backed.select.foreground},
          after:bag(),variation:s.getModelVariation(),previewView:!!m.previewView,previewModel:!!m.previewModel,viewDisposed:!!view?.disposed,
          fillVisible:!!m._3D_MODEL_LS?.getFill?.()?.material?.visible};
      } finally { if(View) View.prototype.render=own; }})()`, { timeoutMs: 60000 });
    check('8_cancelAndClose', cancel.staged.staged && cancel.staged.shown === BLUE && cancel.staged.previewVariation === 1
      && cancel.whileOpen.thisRenders > 0 && cancel.backed.upgrade === false && cancel.backed.select
      && cancel.variation === 2 && JSON.stringify(cancel.after) === JSON.stringify(cancel.before)
      && cancel.previewView === false && cancel.previewModel === false && cancel.viewDisposed
      && cancel.afterClose.thisRenders === 0 && cancel.afterClose.renders === 0, cancel);

    // 8b. A standard item (the blaster) after the saber: standard layout, LBL_PROPERTY shown, _LS controls hidden.
    const standard = await harness.evaluate(`(async()=>{const U=window.__ls,m=U.up();
      U.sel().BTN_ALL.click(); await U.pause(300);
      const opened=await U.openItem(window.__blaster);
      const st=await U.pickSlot(0);
      const out={...st,listBox:U.boxOf(m.LB_ITEMS),slotBox:U.boxOf(m.BTN_UPGRADE31)};
      await U.back();
      return out;})()`, { timeoutMs: 60000 });
    const sc = standard.controls || {};
    const lsShown = Object.entries(sc).filter(([k, v]) => /_LS$/.test(k) && v).map(([k]) => k);
    check('8b_standardAfterSaber', standard.visible && standard.item === BLASTER && standard.layout === 'standard' && standard.slots.length === 3
      && sc.LBL_PROPERTY === true && STD_BUTTONS.every((n) => sc[n] === true) && lsShown.length === 0
      && sc._3D_MODEL === false && sc._3D_MODEL_LS === false && standard.previewView === false
      && standard.listBox.minY >= standard.slotBox.maxY, { ...standard, lsShown });

    // 9. Pointer reach on all six _LS buttons (hit test and the real VR ray) and stick scrolling of LB_ITEMS.
    const reach = await harness.evaluate(`(async()=>{const U=window.__ls,m=U.up(),out={hit:{},ray:{}};
      U.sel().BTN_LIGHTSABER.click(); await U.pause(300);
      await U.openItem(window.__saber);
      await U.pickSlot(0);
      for(const n of ${JSON.stringify(LS_BUTTONS)}) out.hit[n]=U.targetable(m[n]);
      for(const n of ['BTN_ASSEMBLE','BTN_BACK']) out.hit[n]=U.targetable(m[n]);
      out.row0=U.rowTargetable(m.LB_ITEMS,0);
      for(const n of ${JSON.stringify(LS_BUTTONS)}) out.ray[n]=await U.rayHovers(m[n]);
      U.resetAim();
      out.rows=U.upState().rows;
      out.scroll=await U.stickScroll(m.LB_ITEMS);
      U.resetAim();
      return out;})()`, { timeoutMs: 180000 });
    await panelPng('9_reach-panel.png');
    const lsOk = LS_BUTTONS.every((n) => reach.hit[n]?.ok && reach.hit[n]?.inViewport && reach.ray[n]?.aimed && reach.ray[n]?.hover);
    const s9 = reach.scroll;
    check('9_reach', lsOk && reach.hit.BTN_ASSEMBLE.ok && reach.hit.BTN_BACK.ok && reach.row0.ok
      && !!s9.aimed?.ok && s9.hovered === true && s9.maxScroll > 0 && s9.down > s9.before && s9.neutral === s9.down && s9.up < s9.down, reach);

    // 7. Save with the recoloured, upgraded saber worn; reload: variation 2, slots 0 and 2-5, UpgradeSlot1 -1, bonuses.
    const saved = await harness.evaluate(`(async()=>{const U=window.__ls,K=window.KotOR,p=K.PartyManager.Player,s=window.__saber;
      await U.closeAll();
      const before={variation:s.getModelVariation(),slots:[0,1,2,3,4,5].map(i=>s.getUpgradeSlot(i)),equipped:p.equipment.RIGHTHAND===s,
        ab:U.ab(p,s),damage:U.damageOf(s).total};
      await K.SaveGame.SaveCurrentGame('Lightsaber probe',${SCRATCH_SAVE_ID});
      const sv=K.SaveGame.saves.find(x=>x.getSaveNumber()===${SCRATCH_SAVE_ID});if(!sv) return {saved:false,before};
      window.__memoryProbeLoad={module:${JSON.stringify(MODULE)},error:null};await sv.load();return {saved:true,before};})()`, { timeoutMs: 180000 });
    await harness.waitFor(landed, 300000, 500);
    await harness.evaluate(PAGE_HELPERS);
    const reloaded = await harness.evaluate(`(async()=>{const U=window.__ls,K=window.KotOR,p=K.PartyManager.Player;
      const w=p.equipment.RIGHTHAND;
      if(!w) return {weapon:null};
      for(let i=0;i<100 && !(w.model && w.model.parent===p.model?.rhand);i++) await U.pause(100);
      const field=(l)=>w.template.RootNode.hasField(l)?w.template.getFieldByLabel(l).getValue():null;
      return {weapon:U.resrefOf(w),variation:w.getModelVariation(),slots:[0,1,2,3,4,5].map(i=>w.getUpgradeSlot(i)),
        slot1Field:field('UpgradeSlot1'),ab:U.ab(p,w),damage:U.damageOf(w).total,hand:U.handState(p,w)};})()`, { timeoutMs: 60000 });
    check('7_saveReload', saved.saved && saved.before.equipped && saved.before.variation === 2
      && reloaded.weapon === SABER && reloaded.variation === 2
      && [0, 2, 3, 4, 5].every((i) => reloaded.slots[i] === saved.before.slots[i] && reloaded.slots[i] >= 0)
      && reloaded.slots[1] === -1 && (reloaded.slot1Field === null || reloaded.slot1Field === -1)
      && reloaded.ab === saved.before.ab && reloaded.damage === saved.before.damage && reloaded.ab === expectedAB
      && reloaded.hand.model === 'w_lghtsbr_002' && reloaded.hand.onHand && reloaded.hand.bladeModels === 1, { saved, reloaded });

    report.consoleErrors = harness.consoleMessages
      .filter((m) => m.level === 'error' && /upgrade|workbench|lightsaber|blade|MenuUpgrade|LBL_3DView/i.test(String(m.text)))
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

  const EXPECTED = ['1_tabLists', '2_layout', '3_parts', '4_colourRows', '5_previewRecolours', '6_swap', '7_saveReload',
    '8_cancelAndClose', '8b_standardAfterSaber', '9_reach'];
  report.passed = !report.error && EXPECTED.every((name) => report.checks[name] === true)
    && (report.consoleErrors || []).length === 0 && (report.pageErrors || []).length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
