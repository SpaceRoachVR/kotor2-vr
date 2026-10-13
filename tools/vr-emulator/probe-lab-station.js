/**
 * Lab Station probe (ROADMAP 7.7).
 *
 * Boots the browser build against an emulated Quest 3 on an isolated copy of
 * the SpaceRoach Peragus save (101PER medbay), and drives the real Lab Station:
 * the placeable's OnUsed script (k_medstation) starts the help conversation,
 * its "[Use the Lab Station now.]" reply runs k_ptar_startmed, and
 * ShowChemicalUpgradeScreen must open MenuChemicals once the conversation ends.
 * Then: create a Medpac, break one down, check the VR panel and pointer reach,
 * press Accept with nothing selected; aim the emulated right controller's ray
 * at a greyed recipe (it stays grey under hover and selection), push the right
 * stick over both lists (each scrolls), Accept on a scrolled list (the scroll
 * is kept); close, run the retail k_medstation as the station's OnUsed (the
 * screen opens with no conversation), save, reload, and check the chemicals.
 *
 *   node tools/vr-emulator/probe-lab-station.js
 *
 * Build first (npm run webpack:dev): the asset service serves dist/.
 * Prints a JSON summary; exits non-zero when any check fails.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');
const { landed } = require('./probe-memory-growth');
const { enterVrSession, playDialogue } = require('./playthrough-steps');

const CDP_PORT = 9471;
const ASSET_PORT = 8511;
const SAVE_DIRECTORY = 'Saves/000100 - Game99';
const SCRATCH_SAVE_ID = 140;
const MEDPAC = 'g_i_medeqpmnt01';
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const FIXTURE_CANDIDATES = [
  path.join(EVIDENCE_DIR, 'spaceroach-saves-ZaBsC0', 'user'),
  path.join('C:', 'Users', 'allen', 'source', 'repos', 'kotor2-vr', 'tools', 'vr-emulator', 'evidence', 'spaceroach-saves-ZaBsC0', 'user'),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isolatedUserRoot() {
  const fixture = FIXTURE_CANDIDATES.find((candidate) => fs.existsSync(path.join(candidate, SAVE_DIRECTORY)));
  if (!fixture) throw new Error('SpaceRoach save fixture not found: ' + FIXTURE_CANDIDATES.join(' | '));
  const userRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2-lab-station-')), 'user');
  fs.cpSync(path.join(fixture, SAVE_DIRECTORY), path.join(userRoot, SAVE_DIRECTORY), { recursive: true });
  return { fixture, userRoot };
}

/** Page-side helpers, installed once per page as window.__lab. */
const PAGE_HELPERS = `(() => {
  const K = window.KotOR, g = K.GameState;
  const menu = () => g.MenuManager.MenuChemicals;
  const count = (resref) => g.InventoryManager.inventory
    .filter((i) => String(i.getTemplateResRef?.() || i.getTag?.() || '').toLowerCase() === resref)
    .reduce((n, i) => n + (Number(i.getStackSize()) || 0), 0);
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
  /** Whether the engine's own pointer hit-test (the route the VR pointer adapter uses) finds this control. */
  const targetable = (control) => {
    if (!control || !control.box) return { ok: false, reason: 'no box' };
    control.updateBounds?.();
    const c = centre(control.box);
    pointAt(c);
    const hits = g.controls.MenuGetActiveUIElements();
    return { ok: hits.includes(control), centre: c, inViewport: inViewport(control.box),
      box: { minX: control.box.min.x, minY: control.box.min.y, maxX: control.box.max.x, maxY: control.box.max.y } };
  };
  const rowTargetable = (list, index) => {
    const row = list.children[index];
    if (!row) return { ok: false, reason: 'no row ' + index };
    row.updateBounds?.();
    const c = centre(row.box);
    pointAt(c);
    const semantic = list.getVRPointerTargetsAtPointer ? list.getVRPointerTargetsAtPointer() : [];
    const hits = g.controls.MenuGetActiveUIElements();
    return { ok: semantic.length > 0 || hits.includes(row), semantic: semantic.map((t) => t.name), centre: c,
      inViewport: inViewport(row.box) };
  };
  const state = () => {
    const m = menu();
    return {
      visible: !!m.bVisible,
      foreground: g.MenuManager.GetCurrentMenu() === m,
      chemicals: K.PartyManager.ChemicalCount,
      medpacs: count(${JSON.stringify(MEDPAC)}),
      breakdownMode: m.breakdownMode, category: m.category,
      shopRows: m.LB_SHOPITEMS.children.length, invRows: m.LB_INVITEMS.children.length,
      labels: {
        credits: m.LBL_CREDITS_VALUE.getText(), cost: m.LBL_COST_VALUE.getText(),
        stock: m.LBL_STOCK_VALUE.getText(), skill: m.LBL_RELATEDSKILL.getText(),
        accept: m.BTN_Accept.getText(), examine: m.BTN_Examine.getText(),
        costLabel: m.LBL_COST.getText(), title: m.LBL_TITLE.getText(), title2: m.LBL_TITLE2.getText(),
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
  /**
   * Aims the controller so its ray lands on target (GUI units): Newton steps on
   * yaw and pitch with a measured Jacobian. This is the headset's input path
   * (VRPanelPointerHost -> LegacyGUIVRPointerAdapter -> Mouse -> hover).
   */
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
  window.__lab = { menu, count, targetable, rowTargetable, state, aimAt, resetAim, boxCentre, revealRow,
    lastVisibleRow, sampleColours, stickScroll, pause };
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
    await harness.evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='OK');b.dataset.labEula='true';return true;})()`);
    await harness.clickSelector('[data-lab-eula]');
    await harness.waitFor(`document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`, 240000, 1000);
    await harness.evaluate('window.KotOR.SaveGame.GetSaveGames()', { timeoutMs: 120000 });
    await harness.evaluate(`(async()=>{const K=window.KotOR;const s=K.SaveGame.saves.find(s=>s.directory===${JSON.stringify(SAVE_DIRECTORY)});
      if(!s)throw new Error('Peragus save missing');window.__memoryProbeLoad={module:'101PER',error:null};await s.load();return true;})()`, { timeoutMs: 180000 });
    await harness.waitFor(landed, 300000, 500);
    await enterVrSession(harness);
    // Clear any arrival conversation the save queues, as the survey fixtures do.
    await harness.evaluate(`(async()=>{const g=window.KotOR.GameState;for(let n=0;n<8;n++){
      await new Promise(r=>setTimeout(r,250));if(g.CutsceneManager.active)g.CutsceneManager.endConversation(true);
      g.MenuManager.InGameOverlay.open();}return true;})()`, { timeoutMs: 30000 });
    await harness.evaluate(PAGE_HELPERS);

    // 1. Treat Injury total 10 through the skill data; 100 chemicals.
    const setup = await harness.evaluate(`(()=>{const K=window.KotOR,p=K.PartyManager.Player;
      const before={rank:p.skills[7].rank,total:p.getSkillTotal(7),name:p.getName?.()};
      for(let i=0;i<5 && p.getSkillTotal(7)!==10;i++) p.skills[7].rank=Math.max(0,p.skills[7].rank+10-p.getSkillTotal(7));
      K.PartyManager.ChemicalCount=100;
      return {before,rank:p.skills[7].rank,total:p.getSkillTotal(7),chemicals:K.PartyManager.ChemicalCount,
        leaderIsPlayer:K.PartyManager.party[0]===p,medpacs:window.__lab.count(${JSON.stringify(MEDPAC)})};})()`);
    report.notes.setup = setup;
    check('treatInjuryTotal10', setup.total === 10, setup);

    // 2. The real Lab Station: OnUsed -> help conversation -> "[Use the Lab Station now.]".
    const station = await harness.evaluate(`(()=>{const K=window.KotOR,g=K.GameState,gv=g.GlobalVariableManager;
      const list=g.module.area.placeables;
      const p=list.find(p=>String(p.scripts?.['OnUsed']?.name||'').toLowerCase()==='k_medstation')
        || list.find(p=>/lab station/i.test(String(p.getName?.()||'')));
      if(!p) return {found:false,names:list.map(p=>p.getName?.()).slice(0,40)};
      const before=gv.GetGlobalNumber('000_MedStation');
      if(before!==0) gv.SetGlobalNumber('000_MedStation',0);
      window.__labStation=p;
      p.use(K.PartyManager.Player);
      return {found:true,tag:p.tag,name:p.getName?.(),medStationGlobalBefore:before};})()`);
    report.notes.station = station;
    check('labStationFound', station.found === true, station);
    if (!station.found) throw new Error('Lab Station placeable not found');
    await harness.waitFor(`window.KotOR.GameState.CutsceneManager.active || window.KotOR.GameState.MenuManager.MenuChemicals.bVisible`, 30000, 250);
    const startedConversation = await harness.evaluate(`(()=>{const cm=window.KotOR.GameState.CutsceneManager;return {active:!!cm.active,resref:cm.dialog?.resref||null,computer:cm.dialog?.getConversationType?.()===1};})()`);
    report.notes.conversation = startedConversation;
    check('helpConversationStarted', startedConversation.active === true && /000_medstation/i.test(String(startedConversation.resref)), startedConversation);
    const dialogue = await playDialogue(harness, {
      label: 'Lab Station help', maxTurns: 80, menuName: startedConversation.computer ? 'InGameComputer' : 'InGameDialog',
      choose: (replies) => {
        const index = replies.findIndex((text) => /use the lab station now/i.test(String(text)));
        return index >= 0 ? index : 0;
      },
    });
    report.notes.dialogue = dialogue.transcript;
    check('choseUseLabStationNow', dialogue.transcript.some((line) => /^> \[\d+\].*use the lab station now/i.test(line)), dialogue.transcript);
    await harness.waitFor(`window.KotOR.GameState.MenuManager.MenuChemicals.bVisible`, 30000, 250);
    await sleep(1500);
    const opened = await harness.evaluate(`(()=>{const g=window.KotOR.GameState;return {...window.__lab.state(),conversationActive:!!g.CutsceneManager.active,
      user:window.__lab.menu().activeUser()===window.KotOR.PartyManager.Player};})()`);
    report.notes.opened = opened;
    check('menuOpenAfterConversation', opened.visible && opened.foreground && !opened.conversationActive && opened.category === 'health' && opened.shopRows > 0
      && opened.labels.credits === '100' && opened.labels.skill === 'Treat Injury 10' && opened.labels.title === 'Create New Items', opened);

    // 3. Create a Medpac: 100 -> 80, one more Medpac.
    const created = await harness.evaluate(`(async()=>{const m=window.__lab.menu();
      const index=m.createViews.findIndex(v=>v.recipe.resref===${JSON.stringify(MEDPAC)});
      if(index<0) return {index};
      m.LB_SHOPITEMS.select(m.LB_SHOPITEMS.children[index]);
      const selected=window.__lab.state();
      const before={chemicals:window.KotOR.PartyManager.ChemicalCount,medpacs:window.__lab.count(${JSON.stringify(MEDPAC)})};
      m.BTN_Accept.click();
      for(let i=0;i<40 && window.KotOR.PartyManager.ChemicalCount===before.chemicals;i++) await new Promise(r=>setTimeout(r,100));
      await new Promise(r=>setTimeout(r,300));
      return {index,view:m.createViews[index] && {value:m.createViews[index].value,creatable:m.createViews[index].creatable},selected,before,after:window.__lab.state()};})()`, { timeoutMs: 30000 });
    report.notes.create = created;
    check('createMedpac', created.index >= 0 && created.before.chemicals === 100 && created.after.chemicals === 80
      && created.after.medpacs === created.before.medpacs + 1, created);

    // 4. Breakdown: 80 -> 90 (floor(20 x 10 x 5%) = 10), one fewer Medpac.
    const broken = await harness.evaluate(`(async()=>{const m=window.__lab.menu();
      m.BTN_Examine.click();
      await new Promise(r=>setTimeout(r,300));
      const index=m.breakRows.findIndex(r=>r.resref===${JSON.stringify(MEDPAC)});
      if(index<0) return {index,rows:m.breakRows.map(r=>r.resref)};
      m.LB_INVITEMS.select(m.LB_INVITEMS.children[index]);
      const selected=window.__lab.state();
      const before={chemicals:window.KotOR.PartyManager.ChemicalCount,medpacs:window.__lab.count(${JSON.stringify(MEDPAC)})};
      m.BTN_Accept.click();
      await new Promise(r=>setTimeout(r,300));
      return {index,selected,before,after:window.__lab.state()};})()`, { timeoutMs: 30000 });
    report.notes.breakdown = broken;
    check('breakdownMedpac', broken.index >= 0 && broken.before.chemicals === 80 && broken.after.chemicals === 90
      && broken.after.medpacs === broken.before.medpacs - 1 && broken.selected.labels.cost === '10'
      && broken.selected.labels.accept === 'Breakdown Item' && broken.selected.labels.examine === 'View Createable Items'
      && broken.selected.labels.title === 'Breakdown Inventory Items', broken);

    // 5. The VR panel: placement, foreground, a PNG of what it shows, pointer reach.
    const panelFor = async (file) => {
      await sleep(1500);
      const panel = await harness.evaluate(`(()=>{const K=window.KotOR,g=K.GameState,host=K.VRSpike.panelHost,m=window.__lab.menu();
        if(!host) return {host:false};
        const rt=host.renderTarget,w=rt.width,h=rt.height,px=new Uint8Array(w*h*4);
        g.renderer.readRenderTargetPixels(rt,0,0,w,h,px);
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d'),img=ctx.createImageData(w,h);
        for(let y=0;y<h;y++) img.data.set(px.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);
        ctx.putImageData(img,0,0);
        let lit=0;for(let i=0;i<px.length;i+=4) if(px[i]+px[i+1]+px[i+2]>30) lit++;
        const o=host.object;
        return {host:true,presenting:K.VRSpike.isPresenting===true,ownerIsMenu:host.owner===m,visible:host.isVisible,
          foreground:g.MenuManager.GetCurrentMenu()===m,
          position:o.position.toArray().map(v=>+v.toFixed(3)),scale:o.scale.toArray().map(v=>+v.toFixed(3)),
          renderTarget:{w,h},litFraction:+(lit/(w*h)).toFixed(3),png:canvas.toDataURL('image/png')};})()`, { timeoutMs: 30000 });
      if (panel.png) {
        fs.writeFileSync(file, Buffer.from(panel.png.split(',')[1], 'base64'));
        delete panel.png;
        panel.file = file;
      }
      return panel;
    };
    const breakdownPanel = await panelFor(path.join(EVIDENCE_DIR, 'lab-station-panel-breakdown.png'));
    report.notes.breakdownPanel = breakdownPanel;
    const breakdownReach = await harness.evaluate(`(()=>{const m=window.__lab.menu();return {
      LB_INVITEMS_row0:window.__lab.rowTargetable(m.LB_INVITEMS,0),BTN_Examine:window.__lab.targetable(m.BTN_Examine)};})()`);
    report.notes.breakdownReach = breakdownReach;
    check('breakdownRowsTargetable', breakdownReach.LB_INVITEMS_row0.ok && breakdownReach.LB_INVITEMS_row0.inViewport, breakdownReach);

    // Back to create mode on the Health tab for the main capture.
    await harness.evaluate(`(()=>{const m=window.__lab.menu();m.BTN_CREATE_HEALTH.click();return true;})()`);
    const panel = await panelFor(path.join(EVIDENCE_DIR, 'lab-station-panel.png'));
    report.notes.panel = panel;
    check('panelPresentsMenu', panel.host && panel.presenting && panel.ownerIsMenu && panel.visible && panel.foreground && panel.litFraction > 0.05, panel);
    const reach = await harness.evaluate(`(()=>{const m=window.__lab.menu(),t=window.__lab.targetable;return {
      BTN_CREATE_HEALTH:t(m.BTN_CREATE_HEALTH),BTN_CREATE_STIMS:t(m.BTN_CREATE_STIMS),
      BTN_CREATE_GRENADES:t(m.BTN_CREATE_GRENADES),BTN_CREATE_MINES:t(m.BTN_CREATE_MINES),
      BTN_Accept:t(m.BTN_Accept),BTN_Examine:t(m.BTN_Examine),BTN_Cancel:t(m.BTN_Cancel),
      LB_SHOPITEMS_row0:window.__lab.rowTargetable(m.LB_SHOPITEMS,0),
      LB_SHOPITEMS_inViewport:{ok:true,inViewport:(()=>{const b=m.LB_SHOPITEMS.box;const w=window.KotOR.GameState.ResolutionManager.getViewportWidth()/2,h=window.KotOR.GameState.ResolutionManager.getViewportHeight()/2;return b.min.x>=-w-0.5&&b.max.x<=w+0.5&&b.min.y>=-h-0.5&&b.max.y<=h+0.5;})()},
      LB_DESCRIPTION_inViewport:{ok:true,inViewport:(()=>{const b=m.LB_DESCRIPTION.box;const w=window.KotOR.GameState.ResolutionManager.getViewportWidth()/2,h=window.KotOR.GameState.ResolutionManager.getViewportHeight()/2;return b.min.x>=-w-0.5&&b.max.x<=w+0.5&&b.min.y>=-h-0.5&&b.max.y<=h+0.5;})()},
    };})()`);
    report.notes.reach = reach;
    for (const [name, result] of Object.entries(reach)) {
      check('pointer_' + name, result.ok === true && result.inViewport === true, result);
    }

    // 5b. Nothing selected: Accept changes nothing.
    const unselected = await harness.evaluate(`(async()=>{const m=window.__lab.menu();
      m.LB_SHOPITEMS.clearSelection();
      const before=window.__lab.state();
      m.BTN_Accept.click();
      await new Promise(r=>setTimeout(r,800));
      return {before,after:window.__lab.state()};})()`, { timeoutMs: 30000 });
    report.notes.unselected = unselected;
    check('acceptWithoutSelectionIsNoop', unselected.before.chemicals === unselected.after.chemicals
      && unselected.before.medpacs === unselected.after.medpacs, unselected);

    const grey = (c) => Math.abs(c.r - 0.5) < 0.01 && Math.abs(c.g - 0.5) < 0.01 && Math.abs(c.b - 0.5) < 0.01;

    // 5c. Final review #1: a greyed recipe stays grey under the VR ray's hover,
    // when selected, and after the ray leaves. A creatable row is hovered first
    // as the control: it must be painted with the highlight colour, which shows
    // the hover path really ran.
    const hoverGrey = await harness.evaluate(`(async()=>{const L=window.__lab,m=L.menu(),list=m.LB_SHOPITEMS,g=window.KotOR.GameState;
      if(m.category!=='health'){m.BTN_CREATE_HEALTH.click();await L.pause(300);}
      const greyIndex=m.createViews.findIndex(v=>!v.creatable), liveIndex=m.createViews.findIndex(v=>v.creatable);
      if(greyIndex<0||liveIndex<0) return {greyIndex,liveIndex,reason:'need one greyed and one creatable row'};
      const out={greyIndex,liveIndex,grey:m.createViews[greyIndex].recipe.resref,live:m.createViews[liveIndex].recipe.resref};
      out.liveRevealed=L.revealRow(list,liveIndex);
      const liveLabel=list.children[liveIndex].children[0];
      out.liveAim=await L.aimAt(L.boxCentre(liveLabel));
      out.liveHover=!!liveLabel.hover;
      out.liveSamples=await L.sampleColours(liveLabel);
      const h=liveLabel.defaultHighlightColor;
      out.liveHighlight={r:+h.r.toFixed(3),g:+h.g.toFixed(3),b:+h.b.toFixed(3)};
      out.revealed=L.revealRow(list,greyIndex);
      const row=list.children[greyIndex],label=row.children[0];
      out.aim=await L.aimAt(L.boxCentre(label));
      out.hovered={label:!!label.hover,row:!!row.hover,listUnderRay:g.MenuManager.hoveredGUIElement===list};
      out.hoverSamples=await L.sampleColours(label);
      list.select(row);
      out.selected=!!row.selected;
      out.selectedSamples=await L.sampleColours(label);
      return out;})()`, { timeoutMs: 120000 });
    const hoverGreyPanel = await panelFor(path.join(EVIDENCE_DIR, 'lab-station-panel-hover-grey.png'));
    hoverGrey.panelFile = hoverGreyPanel.file;
    hoverGrey.hoverOut = await harness.evaluate(`(async()=>{const L=window.__lab,m=L.menu(),list=m.LB_SHOPITEMS;
      const label=list.children[m.createViews.findIndex(v=>!v.creatable)].children[0];
      list.clearSelection();
      const aim=await L.aimAt(L.boxCentre(m.BTN_Cancel));
      return {aim,hover:!!label.hover,samples:await L.sampleColours(label,450)};})()`, { timeoutMs: 120000 });
    report.notes.hoverGrey = hoverGrey;
    const painted = (hoverGrey.liveSamples || []).some((c) => !grey(c) && c.r === hoverGrey.liveHighlight.r
      && c.g === hoverGrey.liveHighlight.g && c.b === hoverGrey.liveHighlight.b);
    check('hoverPaintsCreatableRow', !!hoverGrey.liveAim?.ok && hoverGrey.liveHover === true && painted, hoverGrey);
    check('greyedRowStaysGreyUnderHover', !!hoverGrey.aim?.ok && hoverGrey.revealed === true
      && (hoverGrey.hovered?.label || hoverGrey.hovered?.row) && (hoverGrey.hoverSamples || []).every(grey), hoverGrey);
    check('greyedRowStaysGreyWhenSelected', hoverGrey.selected === true && (hoverGrey.selectedSamples || []).every(grey), hoverGrey.selectedSamples);
    check('greyedRowStaysGreyAfterHoverOut', !!hoverGrey.hoverOut?.aim?.ok && hoverGrey.hoverOut.hover === false
      && hoverGrey.hoverOut.samples.every(grey), hoverGrey.hoverOut);

    // 5d. Final review #3: the right stick scrolls the recipe list under the ray
    // (the first tab whose recipes overflow the list).
    const shopScroll = await harness.evaluate(`(async()=>{const L=window.__lab,m=L.menu();
      for(const name of ['BTN_CREATE_HEALTH','BTN_CREATE_STIMS','BTN_CREATE_GRENADES','BTN_CREATE_MINES']){
        m[name].click(); await L.pause(400); if(m.LB_SHOPITEMS.maxScroll>0) break; }
      return {category:m.category,...await L.stickScroll(m.LB_SHOPITEMS)};})()`, { timeoutMs: 120000 });
    report.notes.shopScroll = shopScroll;
    check('stickScrollsRecipeList', !!shopScroll.aimed?.ok && shopScroll.hovered === true && shopScroll.maxScroll > 0
      && shopScroll.down > shopScroll.before && shopScroll.neutral === shopScroll.down && shopScroll.up < shopScroll.down, shopScroll);

    // 5e. Final review #2: Create on a scrolled recipe list keeps the scroll.
    const keptCreate = await harness.evaluate(`(async()=>{const L=window.__lab,m=L.menu(),list=m.LB_SHOPITEMS,K=window.KotOR;
      K.PartyManager.ChemicalCount=1000; m.refresh(0); await L.pause(300);
      list.scroll=list.maxScroll; list.updateList();
      const index=L.lastVisibleRow(list,(i)=>!!m.createViews[i]?.creatable);
      if(index<0) return {index,maxScroll:list.maxScroll};
      list.select(list.children[index]);
      const before={scroll:list.scroll,chemicals:K.PartyManager.ChemicalCount,resref:m.createViews[index].recipe.resref};
      m.BTN_Accept.click();
      for(let i=0;i<40 && K.PartyManager.ChemicalCount===before.chemicals;i++) await L.pause(100);
      await L.pause(300);
      return {category:m.category,index,maxScroll:list.maxScroll,before,after:{scroll:list.scroll,
        chemicals:K.PartyManager.ChemicalCount,selectedIndex:list.children.indexOf(list.selectedItem)}};})()`, { timeoutMs: 60000 });
    report.notes.keptCreate = keptCreate;
    check('scrollKeptAfterCreate', keptCreate.index >= 0 && keptCreate.before.scroll > 0 && keptCreate.after.chemicals < keptCreate.before.chemicals
      && keptCreate.after.scroll === keptCreate.before.scroll && keptCreate.after.selectedIndex === keptCreate.index, keptCreate);

    // 5f. Breakdown with a bag that overflows LB_INVITEMS (two of each of up to
    // 12 more lab items): the stick scrolls it, and Breakdown keeps the scroll.
    const invScroll = await harness.evaluate(`(async()=>{const L=window.__lab,m=L.menu(),K=window.KotOR,g=K.GameState,list=m.LB_INVITEMS;
      const added=[];
      for(const resref of m.displayItems.keys()){
        if(added.length>=12) break;
        if(resref===${JSON.stringify(MEDPAC)}) continue;
        try{const buffer=await K.ResourceLoader.loadResource(2025,resref);
          for(let n=0;n<2;n++) g.InventoryManager.addItem(new K.GFFObject(buffer));
          added.push(resref);}catch(e){}
      }
      m.BTN_Examine.click(); await L.pause(400);
      return {added,breakdownMode:m.breakdownMode,...await L.stickScroll(list)};})()`, { timeoutMs: 120000 });
    report.notes.invScroll = invScroll;
    check('stickScrollsBreakdownList', invScroll.breakdownMode === true && !!invScroll.aimed?.ok && invScroll.hovered === true
      && invScroll.maxScroll > 0 && invScroll.down > invScroll.before && invScroll.up < invScroll.down, invScroll);
    const keptBreakdown = await harness.evaluate(`(async()=>{const L=window.__lab,m=L.menu(),list=m.LB_INVITEMS,K=window.KotOR;
      list.scroll=list.maxScroll; list.updateList();
      const index=L.lastVisibleRow(list,(i)=>(m.breakRows[i]?.stackSize||0)>1);
      if(index<0) return {index,maxScroll:list.maxScroll};
      list.select(list.children[index]);
      const before={scroll:list.scroll,chemicals:K.PartyManager.ChemicalCount,resref:m.breakRows[index].resref};
      m.BTN_Accept.click(); await L.pause(400);
      return {index,maxScroll:list.maxScroll,before,after:{scroll:list.scroll,chemicals:K.PartyManager.ChemicalCount,
        selectedIndex:list.children.indexOf(list.selectedItem)}};})()`, { timeoutMs: 60000 });
    report.notes.keptBreakdown = keptBreakdown;
    check('scrollKeptAfterBreakdown', keptBreakdown.index >= 0 && keptBreakdown.before.scroll > 0
      && keptBreakdown.after.chemicals > keptBreakdown.before.chemicals && keptBreakdown.after.scroll === keptBreakdown.before.scroll, keptBreakdown);
    await harness.evaluate(`(async()=>{const L=window.__lab,m=L.menu();L.resetAim();
      if(m.breakdownMode)m.BTN_Examine.click();await L.pause(300);return true;})()`);

    // 6. Close.
    const closed = await harness.evaluate(`(async()=>{const g=window.KotOR.GameState,m=window.__lab.menu();
      m.BTN_Cancel.click();await new Promise(r=>setTimeout(r,500));
      return {visible:!!m.bVisible,mode:g.Mode,foreground:g.MenuManager.GetCurrentMenu()?.constructor?.name};})()`);
    report.notes.closed = closed;
    check('menuClosesToPlay', closed.visible === false && closed.mode === 1, closed);

    // 6b. Final review #5, the path outside any conversation. 101PER's Lab
    // Station runs a_compdlg, which always starts the help conversation. The
    // retail k_medstation is only ShowChemicalUpgradeScreen(GetLastUsedBy())
    // (its NCS: ACTION 330, ACTION 773; it reads no global), so it is put on
    // this station's OnUsed for this step: using the station must open the
    // screen for the player with no conversation at all.
    const secondUse = await harness.evaluate(`(async()=>{const K=window.KotOR,g=K.GameState,cm=g.CutsceneManager;
      const m=window.__lab.menu(),p=window.__labStation,pause=window.__lab.pause;
      const script=K.NWScript.Load('k_medstation');
      if(!script) return {loaded:false};
      window.__labOnUsed=p.scripts['OnUsed'];
      p.scripts['OnUsed']=script;
      let conversationSeen=!!cm.active;
      p.use(K.PartyManager.Player);
      for(let i=0;i<200 && !m.bVisible;i++){ if(cm.active) conversationSeen=true; await pause(50); }
      await pause(800);
      if(cm.active) conversationSeen=true;
      return {loaded:true,conversationSeen,user:m.activeUser()===K.PartyManager.Player,...window.__lab.state()};})()`, { timeoutMs: 60000 });
    report.notes.secondUse = secondUse;
    check('kMedstationOpensWithoutConversation', secondUse.loaded === true && secondUse.conversationSeen === false && secondUse.visible
      && secondUse.foreground && secondUse.user && secondUse.category === 'health' && secondUse.shopRows > 0, secondUse);
    const closedAgain = await harness.evaluate(`(async()=>{const g=window.KotOR.GameState,m=window.__lab.menu();
      if(m.bVisible){m.BTN_Cancel.click();await new Promise(r=>setTimeout(r,500));}
      if(window.__labOnUsed!==undefined) window.__labStation.scripts['OnUsed']=window.__labOnUsed;
      return {visible:!!m.bVisible,mode:g.Mode};})()`);
    report.notes.closedAgain = closedAgain;
    check('kMedstationClosesToPlay', closedAgain.visible === false && closedAgain.mode === 1, closedAgain);

    // 7. Save, reload: the chemicals persist.
    const reloaded = await harness.evaluate(`(async()=>{const K=window.KotOR;
      const savedChemicals=K.PartyManager.ChemicalCount;
      await K.SaveGame.SaveCurrentGame('Lab Station probe',${SCRATCH_SAVE_ID});
      const s=K.SaveGame.saves.find(s=>s.getSaveNumber()===${SCRATCH_SAVE_ID});if(!s) return {saved:false,savedChemicals};
      K.PartyManager.ChemicalCount=0;
      window.__memoryProbeLoad={module:'101PER',error:null};await s.load();return {saved:true,directory:s.directory,savedChemicals};})()`, { timeoutMs: 180000 });
    await harness.waitFor(landed, 300000, 500);
    reloaded.chemicals = await harness.evaluate('window.KotOR.PartyManager.ChemicalCount');
    report.notes.reload = reloaded;
    check('chemicalsPersistAcrossSave', reloaded.saved && reloaded.savedChemicals > 0 && reloaded.chemicals === reloaded.savedChemicals, reloaded);

    report.consoleErrors = harness.consoleMessages
      .filter((m) => m.level === 'error' && /chemical|lab station|ShowChemicalUpgradeScreen/i.test(String(m.text)))
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
