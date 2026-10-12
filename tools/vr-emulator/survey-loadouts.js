const COMPANION_TAGS = Object.freeze({0:'atton',1:'baodur',2:'mand',6:'kreia',8:'t3m4',9:'visasmarr'});
const COMPANIONS = Object.freeze({ 0: 'p_atton', 1: 'p_baodur', 2: 'p_mand', 6: 'p_kreia', 8: 'p_t3m4', 9: 'p_visas' });
const LOADOUTS = Object.freeze({
    '101PER': { level: 3, active: [], roster: [], armor: 'g_a_clothes01', weapon: 'w_blaste_01' },
    '231TEL': { level: 8, active: [0, 6], roster: [0, 6, 8], armor: 'g_a_clothes01', weapon: 'w_blaste_01' },
    '301NAR': { level: 12, active: [0, 1], roster: [0, 1, 6, 8], armor: 'a_robe_01', weapon: 'g_w_lghtsbr01' },
    '401DXN': { level: 12, active: [1, 9], roster: [0, 1, 6, 8, 9], armor: 'a_robe_01', weapon: 'g_w_lghtsbr01' },
    '501OND': { level: 14, active: [2, 6], roster: [0, 1, 2, 6, 8, 9], armor: 'a_robe_01', weapon: 'g_w_lghtsbr01' },
    '601DAN': { level: 12, active: [0, 1], roster: [0, 1, 6, 8, 9], armor: 'a_robe_01', weapon: 'g_w_lghtsbr01' },
    '701KOR': { level: 14, active: [0, 1], roster: [0, 1, 6, 8, 9], armor: 'a_robe_01', weapon: 'g_w_lghtsbr01' },
    '901MAL': { level: 20, active: [], roster: [], armor: 'a_robe_01', weapon: 'g_w_lghtsbr01' },
});
function getSurveyLoadout(module) {
    if (typeof module !== 'string' || !LOADOUTS[module.toUpperCase()])
        throw new Error('Unknown survey module');
    const loadout = LOADOUTS[module.toUpperCase()];
    return { ...loadout, active: [...loadout.active], roster: [...loadout.roster] };
}
function validateEquippedParty(summary, loadout, expectedIds = loadout.active) {
    if (!summary || !Array.isArray(summary.party) || summary.party.length !== expectedIds.length + 1
        || !summary.party[0].isPlayer || summary.party[0].npcId !== -1)
        throw new Error('Equipped survey party identity failed: ' + JSON.stringify(summary));
    const actual = summary.party.slice(1).map(p => p.npcId).sort((a, b) => a - b);
    const expected = [...expectedIds].sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error('Wrong active survey companions');
    for (const p of summary.party) {
        if(!p.isPlayer && p.tag?.toLowerCase() !== COMPANION_TAGS[p.npcId]) throw new Error('Wrong companion in TSL party slot: ' + JSON.stringify(p));
        if (!p.found || !p.modelFound || !Number.isFinite(p.hp) || p.hp <= 0 || !Number.isInteger(p.level)
            || p.level < loadout.level || !p.armor || !p.weapon)
            throw new Error('Unprepared survey character: ' + JSON.stringify(p));
    }
    if (summary.party[0].armor.toLowerCase() !== loadout.armor || summary.party[0].weapon.toLowerCase() !== loadout.weapon)
        throw new Error('Incorrect Exile gear: ' + JSON.stringify(summary));
}
async function configureSurveyLoadout(harness, module) {
    const loadout = getSurveyLoadout(module);
    await harness.evaluate(`(async()=> {
    const K=window.KotOR,gs=K.GameState,pm=K.PartyManager,profile=${JSON.stringify(loadout)},companions=${JSON.stringify(COMPANIONS)};
    if(!pm.Player?.isPlayer) throw new Error('Survey requires the Exile');
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
      if(!bytes?.length) throw new Error('Missing gear '+resref);
      return new K.ModuleItem(new K.GFFObject(bytes));
    }
    const table=gs.TwoDAManager.datatables.get('exptable');
    const xp=Number(table?.rows[profile.level-1]?.xp);
    if(!Number.isFinite(xp)) throw new Error('Missing level XP threshold');
    for(const p of pm.party) {
      p.setXP(Math.max(p.getXP(),xp));
      for(let steps=0;p.getTotalClassLevel()<profile.level;steps++) {
        if(steps>=30 || !await gs.MenuManager.MenuLevelUp.autoLevelUp(p)) throw new Error('Auto-level failed: '+p.tag);
      }
      if(p.isPlayer) {
        await p.equipItem(2,await item(profile.armor));
        await p.equipItem(16,await item(profile.weapon));
      } else {
        if(!p.equipment.ARMOR) await p.equipItem(2,await item('g_a_clothes01'));
        if(!p.equipment.RIGHTHAND) await p.equipItem(16,await item(p.npcId===6 || p.npcId===9?'g_w_lghtsbr01':'w_blaste_01'));
      }
      p.setHP(p.getMaxHP());
      p.forcePoints=p.maxForcePoints;
    }
    for(const [resref,count] of [['g_i_medeqpmnt01',20],['g_i_adrnaline001',5],['w_blaste_01',1]]) {
      const supply=await item(resref); supply.stackSize=count; gs.InventoryManager.addItem(supply);
    }
    gs.MenuManager.InGameOverlay.open(); return true;
  })()`, { timeoutMs: 180000 });
    return loadout;
}
const EQUIPPED_PARTY_SAMPLE = `(()=>{const K=window.KotOR;return {party:K.PartyManager.party.map(p=>({
  found:!!p,modelFound:!!p.model,isPlayer:p.isPlayer,npcId:p.npcId,tag:p.tag,hp:p.getHP(),level:p.getTotalClassLevel(),
  armor:p.equipment.ARMOR?.tag,weapon:p.equipment.RIGHTHAND?.tag}))};})()`;
function validateTelosSpeakers(speakers) {
    if (!Array.isArray(speakers))
        throw new Error('Missing Telos dialogue speaker diagnostics');
    const baoLines = speakers.filter(speaker => speaker?.requestedTag === 'BaoDur');
    if (!baoLines.length || baoLines.some(speaker => speaker.found !== true || speaker.actualTag !== 'BaoDur' || speaker.appearance !== 451)) {
        throw new Error('Bao-Dur dialogue speaker failed: ' + JSON.stringify(baoLines));
    }
}
function validateRestoredProgress(summary, saved) {
    if (!Array.isArray(summary?.party) || !Array.isArray(saved?.party) || summary.party.length !== saved.party.length)
        throw new Error('Restored party differs from saved party');
    for (const expected of saved.party) {
        const actual = summary.party.find(actor => actor.npcId === expected.npcId);
        if (!actual || actual.level !== expected.level || actual.isPlayer !== expected.isPlayer
            || actual.armor?.toLowerCase() !== expected.armor?.toLowerCase()
            || actual.weapon?.toLowerCase() !== expected.weapon?.toLowerCase()) {
            throw new Error('Save did not restore character progression: ' + JSON.stringify({ expected, actual }));
        }
    }
}
function needsNarArrivalStaging(state) {
    if (state?.module !== '301NAR' || state.found !== true
        || typeof state.firstEnter !== 'boolean' || typeof state.arrivalSeen !== 'boolean')
        throw new Error('Nar Shaddaa arrival target missing or invalid: ' + JSON.stringify(state));
    return !state.firstEnter || !state.arrivalSeen;
}
module.exports = { needsNarArrivalStaging, validateRestoredProgress, validateTelosSpeakers, COMPANIONS, LOADOUTS, getSurveyLoadout, validateEquippedParty, configureSurveyLoadout, EQUIPPED_PARTY_SAMPLE };
