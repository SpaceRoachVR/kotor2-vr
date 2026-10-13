/**
 * Headset test saves, one per world, for a Jedi Consular named "SpaceRoach VR".
 *
 * Built on the equipped-survey machinery (upgrade-survey-saves.js): a fresh
 * character through the real chargen UI, then for each world a direct warp
 * with a level, party, gear and inventory profile that matches a typical
 * playthrough route (Peragus, Telos, Nar Shaddaa, Dantooine, Dxun, Onderon,
 * Korriban, Malachor V). Each save is reloaded and its party re-checked before
 * it is published into %LOCALAPPDATA%\Kotor2VR\Saves at fresh slot numbers.
 *
 * These are direct-warp fixtures: story globals for the skipped campaign are
 * not established, so quest state and arrival scripts may not match a real
 * playthrough.
 *
 *   node tools/vr-emulator/spaceroach-world-saves.js            build + publish
 *   node tools/vr-emulator/spaceroach-world-saves.js --no-publish
 */
const fs = require('node:fs'), path = require('node:path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');
const { DESTINATIONS, publishSaves } = require('./planet-survey-saves');
const { loadModule, landed, runtimeFailures } = require('./probe-memory-growth');
const { enterVrSession, newGameThroughCharacterCreation } = require('./playthrough-steps');
const { awaitBootReadyForNewGame } = require('../parity/engine-snapshot');
const { COMPANIONS, EQUIPPED_PARTY_SAMPLE, validateEquippedParty, validateRestoredProgress } = require('./survey-loadouts');
const { settleArrival, ready } = require('./upgrade-survey-saves');
const { configureParty } = require('./memory-soak');

const PLAYER_NAME = 'SpaceRoach VR';
// TSLCharGenClasses slot 0 (BTN_SEL1): male, small body, classes.2da row 4 Jedi Consular.
const CONSULAR_BUTTON = 'BTN_SEL1';
const CONSULAR_CLASS_ID = 4;

// Slot bits from ModuleCreatureArmorSlot.
const SLOT = { HEAD: 0x1, ARMOR: 0x2, ARMS: 0x8, RIGHTHAND: 0x10 };

/**
 * Per-world profile. `active`/`roster` are TSL npc slots (0 Atton, 1 Bao-Dur,
 * 2 Mandalore, 6 Kreia, 8 T3-M4, 9 Visas). Telos's party is set by its
 * authored introduction (Atton + Bao-Dur) in settleArrival, at level 8.
 * Lightsaber 03 is green; retail hands the Exile a saber after Telos.
 */
const PROFILES = Object.freeze({
  '101PER': { level: 3, active: [], roster: [], armor: 'g_a_clothes01', weapon: 'w_blaste_01',
    extras: {}, gold: 0,
    supplies: [['g_i_medeqpmnt01', 5], ['g_i_secspike01', 2], ['g_w_fraggren01', 3], ['g_i_parts01', 3]] },
  '231TEL': { level: 8, active: [0, 1], roster: [0, 1, 6, 8], armor: 'g_a_clothes01', weapon: 'w_blaste_09',
    extras: { ARMS: 'a_gloves_05' }, gold: 1500,
    supplies: [['g_i_medeqpmnt01', 10], ['g_i_adrnaline001', 3], ['g_i_secspike01', 3], ['g_w_fraggren01', 5], ['g_w_stungren01', 3], ['g_i_drdrepeqp001', 3], ['g_i_parts01', 5]] },
  '301NAR': { level: 11, active: [0, 6], roster: [0, 1, 6, 8], armor: 'a_robe_08', weapon: 'g_w_lghtsbr03',
    extras: { HEAD: 'a_helmet_12', ARMS: 'a_gloves_22' }, gold: 4000,
    supplies: [['g_i_medeqpmnt02', 10], ['g_i_adrnaline002', 3], ['g_i_cmbtshot001', 3], ['g_i_secspike01', 5], ['g_w_fraggren01', 5], ['g_w_iongren01', 3], ['g_i_drdrepeqp002', 3], ['g_i_parts01', 8]] },
  '601DAN': { level: 14, active: [6, 9], roster: [0, 1, 6, 8, 9], armor: 'a_robe_08', weapon: 'g_w_lghtsbr03',
    extras: { HEAD: 'a_helmet_23', ARMS: 'a_gloves_22' }, gold: 6000,
    supplies: [['g_i_medeqpmnt02', 12], ['g_i_adrnaline002', 3], ['g_i_cmbtshot002', 3], ['g_i_secspike02', 3], ['g_w_fraggren01', 5], ['g_w_iongren01', 5], ['g_i_drdrepeqp002', 3], ['g_i_parts01', 10]] },
  // The module entry sits ~4 m from tr_ehawk_custom, the "board the Ebon Hawk"
  // trigger that sends the leader to 003EBO; retail arrives from that cutscene
  // instead. Start in the camp clearing (WP_PC_1), ~24 m from the trigger.
  '401DXN': { level: 16, active: [1, 9], roster: [0, 1, 6, 8, 9], armor: 'a_robe_13', weapon: 'g_w_lghtsbr03',
    extras: { HEAD: 'a_helmet_23', ARMS: 'a_gloves_22' }, gold: 8000, arriveAt: ['WP_PC_1', 'WP_PC_2', 'WP_Kreia_1'],
    supplies: [['g_i_medeqpmnt02', 12], ['g_i_medeqpmnt03', 3], ['g_i_adrnaline005', 3], ['g_i_cmbtshot002', 3], ['g_i_secspike02', 3], ['g_w_fraggren01', 5], ['g_w_iongren01', 5], ['g_i_parts01', 10]] },
  '501OND': { level: 17, active: [2, 6], roster: [0, 1, 2, 6, 8, 9], armor: 'a_robe_13', weapon: 'g_w_lghtsbr03',
    extras: { HEAD: 'a_helmet_23', ARMS: 'a_gloves_22' }, gold: 10000,
    supplies: [['g_i_medeqpmnt02', 12], ['g_i_medeqpmnt03', 3], ['g_i_adrnaline005', 3], ['g_i_cmbtshot002', 3], ['g_i_secspike02', 3], ['g_w_fraggren01', 5], ['g_w_iongren01', 5], ['g_i_parts01', 10]] },
  '701KOR': { level: 19, active: [6, 9], roster: [0, 1, 2, 6, 8, 9], armor: 'a_robe_13', weapon: 'g_w_lghtsbr03',
    extras: { HEAD: 'a_helmet_30', ARMS: 'a_gloves_22' }, gold: 12000,
    supplies: [['g_i_medeqpmnt03', 10], ['g_i_medeqpmnt08', 3], ['g_i_adrnaline005', 3], ['g_i_cmbtshot003', 3], ['g_i_secspike02', 3], ['g_w_fraggren01', 5], ['g_w_iongren01', 5], ['g_i_parts01', 10]] },
  // Retail sends the Exile into Malachor alone.
  '901MAL': { level: 23, active: [], roster: [], armor: 'a_robe_17', weapon: 'g_w_lghtsbr03',
    extras: { HEAD: 'a_helmet_30', ARMS: 'a_gloves_22' }, gold: 15000,
    supplies: [['g_i_medeqpmnt03', 15], ['g_i_medeqpmnt08', 5], ['g_i_adrnaline005', 5], ['g_i_cmbtshot003', 5], ['g_w_fraggren01', 5], ['g_w_iongren01', 5]] },
});

function profileFor(module) {
  const p = PROFILES[module];
  if (!p) throw new Error('No SpaceRoach profile for ' + module);
  return { ...p, active: [...p.active], roster: [...p.roster] };
}

// partyOnly re-applies the roster and levels after arrival scripts have moved
// the party, and leaves the player's gear and the bag alone. A full second pass
// added every supply twice and pushed the first copy of each worn item into the
// bag (critic Holocron, 2026-10-13: Nar Shaddaa held 84 items against 40).
async function configureProfile(harness, module, { partyOnly = false } = {}) {
  const profile = profileFor(module);
  const result = await harness.evaluate(`(async()=>{
    const K=window.KotOR,gs=K.GameState,pm=K.PartyManager,profile=${JSON.stringify(profile)},companions=${JSON.stringify(COMPANIONS)},SLOT=${JSON.stringify(SLOT)},partyOnly=${JSON.stringify(partyOnly)};
    if(!pm.Player?.isPlayer) throw new Error('Profile requires the player character');
    gs.MenuManager.ClearMenus(); gs.Mode=0;
    pm.MakePlayerLeader();
    for(const p of [...pm.party].slice(1)) pm.RemoveNPCById(p.npcId);
    for(const [slot,npc] of Object.entries(pm.NPCS)) if(!profile.roster.includes(Number(slot))) {npc.available=false;npc.canSelect=false;}
    for(const id of profile.roster) {
      const bytes=await K.ResourceLoader.loadResource(2027,companions[id]);
      if(!bytes?.length || !pm.AddAvailableNPCByTemplate(id,new K.GFFObject(bytes))) throw new Error('Missing companion '+id);
    }
    for(const id of profile.active) await pm.AddNPCById(id);
    async function item(resref) {
      const bytes=await K.ResourceLoader.loadResource(2025,resref);
      if(!bytes?.length) throw new Error('Missing item '+resref);
      return new K.ModuleItem(new K.GFFObject(bytes));
    }
    const xp=Number(gs.TwoDAManager.datatables.get('exptable')?.rows[profile.level-1]?.xp);
    if(!Number.isFinite(xp)) throw new Error('Missing level XP threshold');
    const extrasEquipped={};
    for(const p of pm.party) {
      p.setXP(Math.max(p.getXP(),xp));
      for(let steps=0;p.getTotalClassLevel()<profile.level;steps++) {
        if(steps>=40 || !await gs.MenuManager.MenuLevelUp.autoLevelUp(p)) throw new Error('Auto-level failed: '+(p.tag||'player'));
      }
      if(p.isPlayer && partyOnly) {
        // Gear was equipped by the first pass.
      } else if(p.isPlayer) {
        await p.equipItem(SLOT.ARMOR,await item(profile.armor));
        await p.equipItem(SLOT.RIGHTHAND,await item(profile.weapon));
        for(const [slot,resref] of Object.entries(profile.extras)) {
          try { await p.equipItem(SLOT[slot],await item(resref)); extrasEquipped[slot]=resref; }
          catch(e) { extrasEquipped[slot]='FAILED '+resref+': '+String(e&&e.message||e); }
        }
      } else {
        if(!p.equipment.ARMOR) await p.equipItem(SLOT.ARMOR,await item('g_a_clothes01'));
        if(!p.equipment.RIGHTHAND) await p.equipItem(SLOT.RIGHTHAND,await item(p.npcId===6 || p.npcId===9?'g_w_lghtsbr01':'w_blaste_01'));
      }
      p.setHP(p.getMaxHP());
      p.forcePoints=p.maxForcePoints;
    }
    if(!partyOnly) for(const [resref,count] of profile.supplies) {
      const supply=await item(resref); supply.stackSize=count; gs.InventoryManager.addItem(supply);
    }
    if(profile.gold>pm.Gold) pm.AddGold(profile.gold-pm.Gold);
    gs.MenuManager.InGameOverlay.open();
    return partyOnly ? {gold:pm.Gold} : {extrasEquipped,gold:pm.Gold};
  })()`, { timeoutMs: 240000 });
  return { ...profile, ...result };
}

const IDENTITY_SAMPLE = `(()=>{const K=window.KotOR,p=K.PartyManager.Player;return {
  name:String(p?.firstName||''),classes:(p?.classes||[]).map(c=>({id:c.id,level:c.level})),
  forcePowers:(p?.getSpells?.()||p?.spells||[]).length,maxFP:p?.maxForcePoints,
  head:p?.equipment.HEAD?.tag,arms:p?.equipment.ARMS?.tag,gold:K.PartyManager.Gold,
  inventory:K.GameState.InventoryManager.getNonQuestInventory?.().length ?? K.GameState.InventoryManager.items?.length};})()`;

const BAG_SAMPLE = `(()=>{const out={};for(const it of window.KotOR.GameState.InventoryManager.inventory||[]){
  const r=String(it.getTemplateResRef?.()||it.templateResRef||it.tag||'?').toLowerCase();
  out[r]=(out[r]||0)+(Number(it.getStackSize?.())||1);}return out;})()`;

/** Each supply exactly as profiled, and no spare copy of the player's worn gear. */
function validateBag(bag, profile) {
  const problems = [];
  for (const [resref, count] of profile.supplies) {
    if ((bag[resref] || 0) !== count) problems.push(`${resref} ${bag[resref] || 0} (want ${count})`);
  }
  for (const resref of [profile.armor, profile.weapon, ...Object.values(profile.extras || {})]) {
    if (bag[resref]) problems.push(`spare worn item ${resref} x${bag[resref]}`);
  }
  if (problems.length) throw new Error('Bag does not match the profile: ' + problems.join(', ') + ' — bag ' + JSON.stringify(bag));
}

/** Jumps the party onto the profile's waypoints, as ActionJumpToPoint does. */
async function placeParty(harness, waypoints) {
  return harness.evaluate(`(()=>{const K=window.KotOR,gs=K.GameState,pm=K.PartyManager,tags=${JSON.stringify(waypoints)};
    const placed=[];
    pm.party.forEach((p,i)=>{
      const wp=gs.module.area.waypoints.find(w=>String(w.tag).toLowerCase()===tags[Math.min(i,tags.length-1)].toLowerCase());
      if(!wp) throw new Error('Missing waypoint '+tags[i]);
      p.clearAllActions?.();
      p.setPosition(wp.position.clone());
      p.collisionManager.groundFace=undefined; p.collisionManager.lastGroundFace=undefined;
      p.collisionManager.findWalkableFace();
      placed.push({tag:p.tag||'player',x:+p.position.x.toFixed(1),y:+p.position.y.toFixed(1)});
    });
    return placed;})()`);
}

// partytable.2da slot → the creature tag each companion's template carries.
const COMPANION_TAG_BY_SLOT = Object.freeze({ 0: 'atton', 1: 'baodur', 2: 'mand', 6: 'kreia', 8: 't3m4', 9: 'visasmarr' });

// Arrival scripts spawn the world's authored companions (Telos's Bao-Dur and
// Atton, Nar Shaddaa's pair) beside the profiled party, and those bodies share
// object ids with the party and go into the save's GIT. In Telos they took
// half the troopers' fire and blocked every shot (critic Hive, 2026-10-13).
// Only companions on the profile's roster count as strays: an empty roster
// (Peragus) keeps its story NPCs, Atton in his cell and T3. Remove them, then
// put the party back in the id registry the duplicates shared.
function strayTags(module) {
  return profileFor(module).roster.map(slot => COMPANION_TAG_BY_SLOT[slot]).filter(Boolean);
}

const strayCompanions = (module) => `(()=>{const K=window.KotOR,gs=K.GameState,pm=K.PartyManager,tags=${JSON.stringify(strayTags(module))};
  const party=new Set(pm.party);
  return gs.module.area.creatures.filter(c=>!party.has(c)&&tags.includes(String(c.tag).toLowerCase()));})()`;

async function removeStrayCompanions(harness, module) {
  return harness.evaluate(`(()=>{const K=window.KotOR,gs=K.GameState,pm=K.PartyManager,removed=[];
    for(const c of ${strayCompanions(module)}) {
      removed.push(c.tag+'#'+c.id); gs.module.area.detachObject(c); try{c.destroy();}catch(e){}
    }
    for(const p of pm.party) gs.ModuleObjectManager.ObjectList.set(p.id,p);
    return removed;})()`);
}

async function validateNoStrayCompanions(harness, destination) {
  const strays = await harness.evaluate(`${strayCompanions(destination.module)}.map(c=>c.tag+'#'+c.id)`);
  if (strays.length) throw new Error(`${destination.name} reloaded with stray companion bodies: ${strays.join(', ')}`);
}

/** Thirty seconds in the world after a reload: a save must not leave its module on its own. */
async function validateStays(harness, destination) {
  await new Promise(r => setTimeout(r, 30000));
  const module = await harness.evaluate(`String(window.KotOR.GameState.module?.filename||'').toUpperCase()`);
  if (module !== destination.module) throw new Error(`${destination.name} left for ${module} within 30 s of loading`);
}

function validateIdentity(identity) {
  if (identity.name !== PLAYER_NAME) throw new Error('Wrong player name: ' + JSON.stringify(identity));
  if (!identity.classes.length || identity.classes[0].id !== CONSULAR_CLASS_ID)
    throw new Error('Player is not a Jedi Consular: ' + JSON.stringify(identity));
}

async function settleMenus(harness, destination) {
  await harness.waitFor(landed, 300000, 500);
  await harness.evaluate(`(async()=>{const g=window.KotOR.GameState;for(let n=0;n<12;n++){
    await new Promise(r=>setTimeout(r,250));if(g.CutsceneManager.active)g.CutsceneManager.endConversation(true);
    g.MenuManager.InGameOverlay.open();}return true;})()`);
  return ready(harness, destination);
}

async function loadSave(harness, directory, module) {
  await harness.evaluate(`(async()=>{const K=window.KotOR,g=K.GameState;g.MenuManager.ClearMenus();g.Mode=-1;
    if(g.module){g.module.dispose();g.module=undefined;}
    await K.SaveGame.GetSaveGames();
    const s=K.SaveGame.saves.find(s=>s.directory===${JSON.stringify(directory)});if(!s)throw new Error('Save missing: '+${JSON.stringify(directory)});
    window.__memoryProbeLoad={module:${JSON.stringify(module)},error:null};await s.load();return true;})()`, { timeoutMs: 180000 });
  await harness.waitFor(landed, 300000, 500);
}

async function main() {
  const publish = !process.argv.includes('--no-publish');
  const out = fs.mkdtempSync(path.join(__dirname, 'evidence', 'spaceroach-saves-'));
  const userRoot = path.join(out, 'user');
  fs.mkdirSync(path.join(userRoot, 'Saves'), { recursive: true });
  const manifest = path.join(out, 'manifest.json');
  const report = { createdAt: new Date().toISOString(), userRoot, completed: false, saves: [],
    purpose: `Per-world headset test saves for ${PLAYER_NAME} (Jedi Consular). Direct-warp fixtures; campaign progression is not established.` };
  const persist = () => fs.writeFileSync(manifest, JSON.stringify(report, null, 2));
  const harness = new VrHarness({ port: 9455, observeServingBundle: true });
  let service;
  try {
    persist();
    console.log('Manifest: ' + manifest);
    service = await startAssetService({ port: 8495, userRoot });
    await harness.launch(service.url);
    await harness.evaluate(`window.__surveySkip = setInterval(() => {
      const v = window.KotOR?.GameState?.VideoManager;
      if (v?.currentMovie?.skippable) v.skipMovie();
    }, 250); true`);
    await awaitBootReadyForNewGame(harness, console.log);
    report.chargen = await newGameThroughCharacterCreation(harness, { classButton: CONSULAR_BUTTON, name: PLAYER_NAME });
    report.bundle = await harness.getTrustedServingBundle();
    await harness.evaluate(`(() => { const gs = window.KotOR.GameState;
      if (gs.CutsceneManager.active) gs.CutsceneManager.endConversation(true);
      gs.MenuManager.InGameOverlay.open(); return true; })()`);
    report.identity = await harness.evaluate(IDENTITY_SAMPLE);
    validateIdentity(report.identity);
    console.log('Created ' + JSON.stringify(report.identity));
    await enterVrSession(harness);
    // A new game starts in the 001EBO prologue possessing T3; take back the player character.
    await configureParty(harness, false);
    await harness.evaluate(loadModule('101PER'));
    await settleMenus(harness, DESTINATIONS[0]);
    await harness.evaluate(`window.KotOR.SaveGame.SaveCurrentGame(${JSON.stringify(PLAYER_NAME + ' baseline')}, 2)`, { timeoutMs: 180000 });
    const baseline = await harness.evaluate(`(async()=>{const K=window.KotOR;await K.SaveGame.GetSaveGames();return K.SaveGame.saves.find(s=>s.getSaveNumber()===2)?.directory;})()`);
    if (!baseline) throw new Error('Baseline save missing');
    persist();

    for (let index = 0; index < DESTINATIONS.length; index++) {
      const d = DESTINATIONS[index];
      console.log('Preparing ' + d.name);
      await loadSave(harness, baseline, '101PER');
      const loadout = await configureProfile(harness, d.module);
      if (d.module !== '101PER') await harness.evaluate(loadModule(d.module));
      let before = await settleArrival(harness, d, report, false);
      // Arrival scripts may rearrange the party; apply the profile after them (Telos keeps its authored pair).
      if (!['101PER', '231TEL'].includes(d.module)) {
        Object.assign(loadout, await configureProfile(harness, d.module, { partyOnly: true }));
        before = await settleMenus(harness, d);
      }
      loadout.strayCompanionsRemoved = await removeStrayCompanions(harness, d.module);
      if (loadout.arriveAt) loadout.placed = await placeParty(harness, loadout.arriveAt);
      validateBag(await harness.evaluate(BAG_SAMPLE), loadout);
      const prepared = await harness.evaluate(EQUIPPED_PARTY_SAMPLE);
      validateEquippedParty(prepared, loadout, loadout.active);
      const identity = await harness.evaluate(IDENTITY_SAMPLE);
      validateIdentity(identity);
      const id = 100 + index, displayName = `${PLAYER_NAME} - ${d.name}`;
      const metadata = await harness.evaluate(`(async()=>{const K=window.KotOR;await K.SaveGame.SaveCurrentGame(${JSON.stringify(displayName)},${id});
        const s=K.SaveGame.saves.find(s=>s.getSaveNumber()===${id});if(!s || s.getSaveName()!==${JSON.stringify(displayName)})throw new Error('Save metadata mismatch');
        return {directory:s.directory,saveName:s.getSaveName()};})()`, { timeoutMs: 180000 });
      await loadSave(harness, metadata.directory, d.module);
      const after = await settleMenus(harness, d);
      await validateNoStrayCompanions(harness, d);
      await validateStays(harness, d);
      const reloaded = await harness.evaluate(EQUIPPED_PARTY_SAMPLE);
      validateEquippedParty(reloaded, loadout, loadout.active);
      validateRestoredProgress(reloaded, prepared);
      const reloadedIdentity = await harness.evaluate(IDENTITY_SAMPLE);
      validateIdentity(reloadedIdentity);
      report.saves.push({ ...d, ...metadata, loadout, before, after, prepared, reloaded, identity: reloadedIdentity, reloadVerified: true });
      persist();
      console.log('Verified ' + displayName + ': ' + JSON.stringify({ party: reloaded.party.map(p => `${p.tag || 'player'} L${p.level} ${p.armor}/${p.weapon}`), identity: reloadedIdentity }));
      await harness.cdp.send('Runtime.discardConsoleEntries');
      await harness.cdp.send('HeapProfiler.collectGarbage');
    }
    report.runtimeFailures = runtimeFailures(harness.consoleMessages, harness.pageErrors);
    if (report.runtimeFailures.length) throw new Error(report.runtimeFailures.slice(0, 5).join('\n'));
    report.completed = true;
    persist();
    if (publish) {
      report.published = publishSaves(manifest, path.join(process.env.LOCALAPPDATA, 'Kotor2VR', 'Saves'));
      persist();
    }
  } catch (error) {
    report.error = String(error.stack || error);
    report.consoleErrors = harness.consoleMessages.filter(m => m.level === 'error').slice(-30).map(m => m.text);
    report.runtimeFailures = runtimeFailures(harness.consoleMessages, harness.pageErrors);
    throw error;
  } finally {
    persist();
    await harness.close();
    if (service) service.stop();
    console.log('Manifest: ' + manifest);
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { PROFILES, PLAYER_NAME, CONSULAR_CLASS_ID, profileFor, validateIdentity };
