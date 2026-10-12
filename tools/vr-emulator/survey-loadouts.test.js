const test = require('node:test'), assert = require('node:assert/strict');
const { getSurveyLoadout, validateEquippedParty } = require('./survey-loadouts');
test('loadouts preserve Telos arrival speakers, Onderon Mandalore, and solo Malachor', () => {
    assert.deepEqual(getSurveyLoadout('231tel').active, [0, 6]);
    assert.deepEqual(getSurveyLoadout('501OND').active, [2, 6]);
    assert.deepEqual(getSurveyLoadout('901MAL').active, []);
    assert.throws(() => getSurveyLoadout('unknown'), /Unknown/);
    const copy = getSurveyLoadout('231TEL');
    copy.active.length = 0;
    assert.deepEqual(getSurveyLoadout('231TEL').active, [0, 6]);
});
test('reload acceptance rejects absent party members, dead or unequipped actors and wrong Exile equipment', () => {
    const l = getSurveyLoadout('231TEL');
    const actor = { found: true, modelFound: true, hp: 80, level: 8, armor: l.armor, weapon: l.weapon };
    const s = { party: [{ ...actor, isPlayer: true, npcId: -1 }, { ...actor, npcId: 0, tag:'Atton' }, { ...actor, npcId: 6,tag:'Kreia' }] };
    validateEquippedParty(s, l);
    for (const patch of [{ found: false }, { modelFound: false }, { hp: 0 }, { level: 7 }, { weapon: '' }, { armor: '' }, { npcId: 8 }])
        assert.throws(() => validateEquippedParty({ party: [s.party[0], { ...s.party[1], ...patch }, s.party[2]] }, l));
    assert.throws(() => validateEquippedParty({ party: s.party.slice(0, 1) }, l));
    assert.throws(() => validateEquippedParty({ party: [{ ...s.party[0], weapon: 'wrong' }, ...s.party.slice(1)] }, l));
});
test('Telos speaker diagnostics reject missing Bao-Dur and owner fallback to the sentry', () => {
    const { validateTelosSpeakers } = require('./survey-loadouts');
    const bao = { requestedTag: 'BaoDur', found: true, actualTag: 'BaoDur', appearance: 451 };
    validateTelosSpeakers([bao]);
    for (const speakers of [null, [], [{ ...bao, found: false }], [{ ...bao, actualTag: '231_D_SentryCut', appearance: 490 }], [{ ...bao, appearance: 490 }]]) {
        assert.throws(() => validateTelosSpeakers(speakers), /speaker|diagnostics/);
    }
});
test('cross-save restore rejects retained level or gear from the previous world', () => {
    const { validateRestoredProgress } = require('./survey-loadouts');
    const saved = { party: [{ npcId: -1, isPlayer: true, level: 8, armor: 'G_A_CLOTHES01', weapon: 'w_blaste_01' }] };
    validateRestoredProgress({ party: [{ ...saved.party[0], armor: 'g_a_clothes01' }] }, saved);
    for (const patch of [{ level: 20 }, { armor: 'a_robe_01' }, { weapon: 'g_w_lghtsbr01' }, { npcId: 8 }, { isPlayer: false }])
        assert.throws(() => validateRestoredProgress({ party: [{ ...saved.party[0], ...patch }] }, saved), /restore|Restored/);
});
test('Nar arrival staging requires the authored global and trigger flags',()=>{
    const {needsNarArrivalStaging}=require('./survey-loadouts');
    const state={module:'301NAR',found:true,firstEnter:true,arrivalSeen:true};
    assert.equal(needsNarArrivalStaging(state),false);
    for(const patch of [{firstEnter:false},{arrivalSeen:false}]) assert.equal(needsNarArrivalStaging({...state,...patch}),true);
    for(const patch of [{module:'231TEL'},{found:false},{firstEnter:undefined},{arrivalSeen:undefined}]) assert.throws(()=>needsNarArrivalStaging({...state,...patch}),/arrival target/);
});
test('Mandalore uses his authored slot and cannot masquerade as HK-47',()=>{
    const {COMPANIONS}=require('./survey-loadouts');
    assert.equal(COMPANIONS[2],'p_mand');assert.equal(COMPANIONS[5],undefined);
    const profile=getSurveyLoadout('501OND'),actor={found:true,modelFound:true,hp:100,level:14,armor:profile.armor,weapon:profile.weapon};
    const summary={party:[{...actor,isPlayer:true,npcId:-1},{...actor,npcId:2,tag:'Mand'},{...actor,npcId:6,tag:'Kreia'}]};
    validateEquippedParty(summary,profile);
    assert.throws(()=>validateEquippedParty({party:[summary.party[0],{...summary.party[1],tag:'HK47'},summary.party[2]]},profile),/TSL party slot/);
});