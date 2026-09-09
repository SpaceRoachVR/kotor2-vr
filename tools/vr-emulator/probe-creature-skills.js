/**
 * Ad-hoc probe: which creatures reach save() with no skills, and why.
 *
 * `ModuleCreature.save()` reports "'<tag>' has 8 of 8 skills missing - it reached
 * save() without initProperties()". The sweep sees it in up to 5 of 82 modules,
 * always for the same three tags - HK50, 3CFD and MEDBAY_PC - which are all
 * creatures of 001EBO, the saved module that establishes the party. The save
 * message states a cause it cannot actually observe, so this reads the live
 * objects instead of inferring: an empty `skills` array has two very different
 * explanations, and only one of them is "initProperties never ran".
 *
 *   node tools/vr-emulator/probe-creature-skills.js
 *   node tools/vr-emulator/probe-creature-skills.js --url "<launch url>"
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');


const EVIDENCE_DIR = path.join(__dirname, 'evidence');

const { startAssetService } = require('./asset-service');

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate('(() => {\n' +
    '  const wanted = ' + JSON.stringify(text) + '.toLowerCase();\n' +
    '  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };\n' +
    '  const btn = Array.from(document.querySelectorAll("button")).filter(visible)\n' +
    '    .find(b => (b.textContent || "").trim().toLowerCase() === wanted);\n' +
    '  if (!btn) return null;\n' +
    '  const r = btn.getBoundingClientRect();\n' +
    '  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };\n' +
    '})()');
  if (!box) throw new Error('No visible button labelled "' + text + '"');
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

const INSPECT = [
  '(() => {',
  '  const gs = window.KotOR.GameState;',
  '  const out = {',
  '    module: gs.module && gs.module.filename,',
  '    rulesetSkillCount: (gs.SWRuleSet && gs.SWRuleSet.skills) ? gs.SWRuleSet.skills.length : null,',
  '    rulesetSkillHoles: 0,',
  '    creatures: [],',
  '    party: [],',
  '  };',
  '  if (gs.SWRuleSet && Array.isArray(gs.SWRuleSet.skills)) {',
  '    for (let i = 0; i < gs.SWRuleSet.skills.length; i++) {',
  '      if (!gs.SWRuleSet.skills[i]) out.rulesetSkillHoles++;',
  '    }',
  '  }',
  '  const describe = (c, origin) => {',
  '    let tag = null, template = null, name = null;',
  '    try { tag = c.getTag(); } catch (e) {}',
  '    try { template = c.getTemplateResRef(); } catch (e) {}',
  '    try { name = c.getName(); } catch (e) {}',
  '    return {',
  '      origin: origin,',
  '      tag: tag,',
  '      name: name,',
  '      ctor: c && c.constructor ? c.constructor.name : null,',
  '      skills: Array.isArray(c.skills) ? c.skills.length : null,',
  '      classes: Array.isArray(c.classes) ? c.classes.length : null,',
  '      feats: Array.isArray(c.feats) ? c.feats.length : null,',
  '      initialized: !!c.initialized,',
  '      templateResRef: template,',
  '      templateIsGFF: !!(c.template && c.template.RootNode),',
  '      hasAppearance: !!c.creatureAppearance,',
  '    };',
  '  };',
  '  const area = gs.module && gs.module.area;',
  '  if (area && Array.isArray(area.creatures)) {',
  '    for (const c of area.creatures) out.creatures.push(describe(c, "area"));',
  '  }',
  '  const pm = window.KotOR.PartyManager;',
  '  if (pm && Array.isArray(pm.party)) {',
  '    for (const c of pm.party) out.party.push(describe(c, "party"));',
  '  }',
  '  if (pm && pm.Player) out.party.push(describe(pm.Player, "player"));',
  '  return out;',
  '})()',
].join('\n');

const LOAD_SAVE = [
  '(async () => {',
  '  const gs = window.KotOR.GameState;',
  '  gs.MenuManager.ClearMenus();',
  '  if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }',
  '  Promise.resolve(window.KotOR.SaveGame.saves[0].load()).catch(() => undefined);',
  '  return true;',
  '})()',
].join('\n');

const SAVE_LANDED = [
  '(() => {',
  '  const gs = window.KotOR.GameState;',
  '  const p = window.KotOR.PartyManager && window.KotOR.PartyManager.Player;',
  '  return !!(gs && gs.module && p && p.position && Number.isFinite(p.position.x));',
  '})()',
].join('\n');

async function main() {
  const argv = process.argv.slice(2);
  const urlFlag = argv.indexOf('--url');
  let service = null;
  let url = urlFlag > -1 ? argv[urlFlag + 1] : null;
  if (!url) {
    service = await startAssetService();
    url = service.url;
  }

  const harness = new VrHarness({ port: 9446 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        'Array.from(document.querySelectorAll("button")).some(b => (b.textContent||"").trim() === "OK")', 60000);
      await clickButtonByText(harness, 'OK');
    } catch (e) { /* already accepted */ }
    await harness.waitFor('!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)', 240000);
    await harness.waitFor('!!window.KotOR.GameState.MenuManager.MainMenu', 240000);

    await harness.evaluate('(async () => { await window.KotOR.SaveGame.GetSaveGames(); return window.KotOR.SaveGame.saves.length; })()',
      { timeoutMs: 120000 });

    // MenuSaveLoad's exact LOADGAME path; anything less leaves the engine in GUI
    // mode and the load never lands.
    await harness.evaluate(LOAD_SAVE);
    await harness.waitFor(SAVE_LANDED, 300000, 3000);

    const report = await harness.evaluate(INSPECT, { timeoutMs: 90000 });

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const outFile = path.join(EVIDENCE_DIR, 'creature-skills.json');
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

    console.log('module: ' + report.module);
    console.log('SWRuleSet.skills: ' + report.rulesetSkillCount + ' (holes: ' + report.rulesetSkillHoles + ')');
    const all = report.creatures.concat(report.party);
    const broken = all.filter((c) => !c.skills);
    console.log('\ncreatures with no skills:');
    if (!broken.length) console.log('  (none)');
    for (const c of broken) {
      console.log('  ' + String(c.tag).padEnd(14) +
        ' origin=' + c.origin +
        ' ctor=' + c.ctor +
        ' initialized=' + c.initialized +
        ' classes=' + c.classes +
        ' feats=' + c.feats +
        ' appearance=' + c.hasAppearance +
        ' template=' + JSON.stringify(c.templateResRef) +
        ' gff=' + c.templateIsGFF);
    }
    console.log('\n' + (all.length - broken.length) + ' of ' + all.length + ' creatures have skills.');
    console.log('full report -> ' + path.relative(process.cwd(), outFile));
  } finally {
    await harness.close();
    if (service) service.stop();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
