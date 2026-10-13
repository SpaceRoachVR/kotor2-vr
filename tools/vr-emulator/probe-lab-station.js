/**
 * Lab Station probe (ROADMAP 7.7).
 *
 * Boots the browser build against an emulated Quest 3 on an isolated copy of
 * the SpaceRoach Peragus save (101PER medbay), and drives the real Lab Station:
 * the placeable's OnUsed script (k_medstation) starts the help conversation,
 * its "[Use the Lab Station now.]" reply runs k_ptar_startmed, and
 * ShowChemicalUpgradeScreen must open MenuChemicals once the conversation ends.
 * Then: create a Medpac, break one down, check the VR panel and pointer reach,
 * press Accept with nothing selected, save, reload, and check the chemicals.
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
  window.__lab = { menu, count, targetable, rowTargetable, state };
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

    // 6. Close, save, reload: the chemicals persist.
    const closed = await harness.evaluate(`(async()=>{const g=window.KotOR.GameState,m=window.__lab.menu();
      m.BTN_Cancel.click();await new Promise(r=>setTimeout(r,500));
      return {visible:!!m.bVisible,mode:g.Mode,foreground:g.MenuManager.GetCurrentMenu()?.constructor?.name};})()`);
    report.notes.closed = closed;
    check('menuClosesToPlay', closed.visible === false && closed.mode === 1, closed);
    const reloaded = await harness.evaluate(`(async()=>{const K=window.KotOR;
      await K.SaveGame.SaveCurrentGame('Lab Station probe',${SCRATCH_SAVE_ID});
      const s=K.SaveGame.saves.find(s=>s.getSaveNumber()===${SCRATCH_SAVE_ID});if(!s) return {saved:false};
      K.PartyManager.ChemicalCount=0;
      window.__memoryProbeLoad={module:'101PER',error:null};await s.load();return {saved:true,directory:s.directory};})()`, { timeoutMs: 180000 });
    await harness.waitFor(landed, 300000, 500);
    reloaded.chemicals = await harness.evaluate('window.KotOR.PartyManager.ChemicalCount');
    report.notes.reload = reloaded;
    check('chemicalsPersistAcrossSave', reloaded.saved && reloaded.chemicals === 90, reloaded);

    report.consoleErrors = harness.consoleMessages
      .filter((m) => m.level === 'error' && /chemical|lab station|ShowChemicalUpgradeScreen/i.test(String(m.text)))
      .map((m) => String(m.text).slice(0, 300)).slice(0, 10);
    report.pageErrors = harness.pageErrors.map((e) => String(e).slice(0, 300)).slice(0, 10);
  } catch (error) {
    report.error = String(error && error.stack || error);
  } finally {
    await harness.close().catch(() => {});
    if (service) service.stop();
  }

  report.passed = !report.error && Object.keys(report.checks).length > 0 && Object.values(report.checks).every(Boolean);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
