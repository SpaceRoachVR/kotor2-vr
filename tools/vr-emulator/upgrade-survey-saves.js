const fs = require('node:fs'), path = require('node:path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');
const { DESTINATIONS, publishSaves } = require('./planet-survey-saves');
const { loadModule, landed, runtimeFailures } = require('./probe-memory-growth');
const { enterVrSession, playDialogue } = require('./playthrough-steps');
const { configureSurveyLoadout, EQUIPPED_PARTY_SAMPLE, validateEquippedParty, validateTelosSpeakers, validateRestoredProgress, needsNarArrivalStaging } = require('./survey-loadouts');
async function ready(harness, destination) {
    await harness.waitFor(landed, 300000, 500);
    const start = await harness.evaluate('window.KotOR.GameState.renderer.info.render.frame');
    await harness.waitFor(`window.KotOR.GameState.renderer.info.render.frame >= ${start + 10}`, 30000, 250);
    const result = await harness.evaluate(`(()=>{const g=window.KotOR.GameState;return {module:String(g.module?.filename).toUpperCase(),ready:g.module?.readyToProcessEvents,loading:g.loadingModule,presenting:g.renderer.xr.isPresenting,frames:g.renderer.info.render.frame-${start},mode:g.Mode};})()`);
    if (result.module !== destination.module || !result.ready || result.loading || !result.presenting || result.frames < 10 || result.mode !== 1)
        throw new Error('Survey readiness failed: ' + JSON.stringify(result));
    return result;
}
const NAR_ARRIVAL_SAMPLE = `(()=>{const K=window.KotOR,g=K.GameState,t=g.module?.area.triggers.find(t=>t.tag==='301Arrival');return {module:String(g.module?.filename).toUpperCase(),found:!!t,tag:t?.tag,id:t?.id,type:t?.objectType,resref:t?.getTemplateResRef(),firstEnter:g.GlobalVariableManager.GetGlobalBoolean('301_FIRST_ENTER'),arrivalSeen:t?.getLocalBoolean(30)};})()`;
async function stageNarArrival(harness) {
    const before = await harness.evaluate(NAR_ARRIVAL_SAMPLE);
    if (needsNarArrivalStaging(before)) {
        await harness.evaluate(`(()=>{const K=window.KotOR,t=K.GameState.module.area.triggers.find(t=>t.tag==='301Arrival');if(!t)throw new Error('Nar arrival trigger missing');t.onEnter(K.PartyManager.Player);return true;})()`);
        await harness.waitFor(`(()=>{const K=window.KotOR,t=K.GameState.module.area.triggers.find(t=>t.tag==='301Arrival');return K.GameState.GlobalVariableManager.GetGlobalBoolean('301_FIRST_ENTER') && t?.getLocalBoolean(30);})()`,30000,250);
    }
    const after = await harness.evaluate(NAR_ARRIVAL_SAMPLE);
    if (needsNarArrivalStaging(after)) throw new Error('Nar arrival did not complete');
    return {before,after};
}
async function settleArrival(harness, destination, report, introductionCompleted = false) {
    await harness.waitFor(landed, 300000, 500);
    if (destination.module === '231TEL') {
        if (!introductionCompleted) {
            await harness.evaluate(`(()=>{const g=window.KotOR.GameState,cm=g.CutsceneManager;
   window.__surveySpeakers=[];
   const original=cm.showEntry;
   window.__surveyOriginalShowEntry=original;
   cm.showEntry=function(entry){const result=original.call(this,entry);
    if(entry?.speakerTag) {const target=g.ModuleObjectManager.GetObjectByTag(entry.speakerTag),actual=entry.speaker;
     window.__surveySpeakers.push({requestedTag:entry.speakerTag,found:!!target,actualTag:actual?.tag,id:actual?.id,type:actual?.objectType,resref:actual?.getTemplateResRef?.(),appearance:actual?.appearance});}
    return result;};return true;})()`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Levelling a fixture may queue Kreia's generic lesson. Clear that before the location's authored introduction.
            {
                await harness.evaluate(`(()=>{const g=window.KotOR.GameState; if(g.CutsceneManager.active && g.CutsceneManager.dialog?.resref==='231sntry') return true;
    if(g.CutsceneManager.active)g.CutsceneManager.endConversation(true);g.MenuManager.InGameOverlay.open();
    const s=g.module.area.creatures.find(c=>c.tag==='231_D_SentryCut');
    if(!s?.conversation) throw new Error('Telos sentry staging dialogue not found');
    g.CutsceneManager.startConversation(s.conversation,s);return true;})()`);
            }
            try {
                report.telosIntroduction = await playDialogue(harness, { label: 'Telos authored introduction', maxTurns: 200,
                    choose: replies => { const index = replies.findIndex(text => /let.s go|ready to go|let.s get|lead the way|get moving/i.test(text)); return index >= 0 ? index : 0; } });
                report.telosSpeakers = await harness.evaluate('window.__surveySpeakers');
                validateTelosSpeakers(report.telosSpeakers);
            }
            finally {
                await harness.evaluate('window.KotOR.GameState.CutsceneManager.showEntry=window.__surveyOriginalShowEntry; true');
            }
        }
        else {
            await harness.evaluate(`(()=>{const g=window.KotOR.GameState;if(g.CutsceneManager.active)g.CutsceneManager.endConversation(true);return true;})()`);
        }
        await harness.evaluate(`(async()=>{const K=window.KotOR,pm=K.PartyManager;pm.MakePlayerLeader();
    for(const p of [...pm.party].slice(1)) if(![0,1].includes(p.npcId)) pm.RemoveNPCById(p.npcId);
    for(const id of [0,1]) if(!pm.party.some(p=>p.npcId===id)) await pm.AddNPCById(id);
    if(!pm.party.some(p=>p.npcId===1)) throw new Error('Bao-Dur did not join');
    const bao=pm.party.find(p=>p.npcId===1),profile=${JSON.stringify(require('./survey-loadouts').getSurveyLoadout('231TEL'))};
    const xp=Number(K.GameState.TwoDAManager.datatables.get('exptable').rows[profile.level-1].xp);bao.setXP(Math.max(bao.getXP(),xp));
    for(let steps=0;bao.getTotalClassLevel()<profile.level;steps++) if(steps>=30 || !await K.GameState.MenuManager.MenuLevelUp.autoLevelUp(bao)) throw new Error('Bao-Dur level-up failed');
    for(const [slot,resref] of [[2,'g_a_clothes01'],[16,'w_blaste_01']]) if(!bao.equipment[slot===2?'ARMOR':'RIGHTHAND']) {
      const bytes=await K.ResourceLoader.loadResource(2025,resref);await bao.equipItem(slot,new K.ModuleItem(new K.GFFObject(bytes)));}
    for(const p of pm.party)p.setHP(p.getMaxHP());
    K.GameState.MenuManager.InGameOverlay.open();return true;})()`, { timeoutMs: 120000 });
    }
    else {
        if(destination.module === '301NAR') report.narArrival = await stageNarArrival(harness);
        await harness.evaluate(`(async()=>{const g=window.KotOR.GameState;for(let n=0;n<12;n++){
    await new Promise(r=>setTimeout(r,250));if(g.CutsceneManager.active)g.CutsceneManager.endConversation(true);
    g.MenuManager.InGameOverlay.open();}return true;})()`);
    }
    return ready(harness, destination);
}
async function settleFixtureMenus(harness, destination) {
    await harness.waitFor(landed, 300000, 500);
    // Test fixtures skip queued introductory conversations; this does not alter party or equipment.
    await harness.evaluate(`(async()=>{const g=window.KotOR.GameState;for(let n=0;n<12;n++){
        await new Promise(resolve=>setTimeout(resolve,250));
        if(g.CutsceneManager.active)g.CutsceneManager.endConversation(true);
        g.MenuManager.InGameOverlay.open();
    }return true;})()`);
    return ready(harness, destination);
}
function validateResumeReport(report, manifestPath) {
    if (!report || report.completed || report.published || !Array.isArray(report.saves) || report.saves.length > DESTINATIONS.length
        || path.resolve(report.userRoot || '') !== path.join(path.dirname(path.resolve(manifestPath)), 'user')) {
        throw new Error('Invalid failed survey manifest');
    }
    for (let index = 0; index < report.saves.length; index++) {
        const save = report.saves[index], destination = DESTINATIONS[index];
        if (!save || save.module !== destination.module || save.name !== destination.name || save.reloadVerified !== true
            || !/^Saves\/\d{6} - Game\d+$/.test(save.directory))
            throw new Error('Invalid verified survey prefix');
    }
}
async function main() {
    const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'evidence', 'planet-survey-avL25O', 'manifest.json'), 'utf8'));
    if (!original.completed)
        throw new Error('Original survey manifest is incomplete');
    if (process.argv.length > 3)
        throw new Error('Usage: upgrade-survey-saves.js [failed-manifest.json]');
    const resumePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
    const resume = resumePath ? JSON.parse(fs.readFileSync(resumePath, 'utf8')) : null;
    if (resume)
        validateResumeReport(resume, resumePath);
    const out = fs.mkdtempSync(path.join(__dirname, 'evidence', 'equipped-survey-'));
    const userRoot = path.join(out, 'user');
    fs.mkdirSync(path.join(userRoot, 'Saves'), { recursive: true });
    const baseline = 'Saves/000002 - Game1';
    fs.cpSync(path.join(original.userRoot, baseline), path.join(userRoot, baseline), { recursive: true, errorOnExist: true, force: false });
    if (resume) {
        for (const save of resume.saves)
            fs.cpSync(path.join(resume.userRoot, save.directory), path.join(userRoot, save.directory), { recursive: true, errorOnExist: true, force: false });
    }
    const report = { ...(resume || {}), createdAt: new Date().toISOString(), userRoot, completed: false, saves: resume ? resume.saves : [], purpose: 'Equipped direct-warp survey fixtures. Campaign progression is not established. Telos introduction completed through authored dialogue; Malachor remains solo.' };
    delete report.error;
    delete report.runtimeFailures;
    report.resumedFrom = resumePath;
    const telosBase = 'Saves/000101 - Game100';
    const resumeTelos = !!(resume?.saves.length < 2 && resume?.telosIntroduction?.finished && fs.existsSync(path.join(resume.userRoot, telosBase)));
    if (resumeTelos) {
        validateTelosSpeakers(resume.telosSpeakers);
        fs.cpSync(path.join(resume.userRoot, telosBase), path.join(userRoot, telosBase), { recursive: true, errorOnExist: true, force: false });
        report.telosIntroduction = resume.telosIntroduction;
        report.telosSpeakers = resume.telosSpeakers;
        report.telosIntroductionSource = resumePath;
    }
    const manifest = path.join(out, 'manifest.json'), persist = () => fs.writeFileSync(manifest, JSON.stringify(report, null, 2));
    const harness = new VrHarness({ port: 9453, observeServingBundle: true });
    let service;
    try {
        persist();
        console.log('Manifest: ' + manifest);
        service = await startAssetService({ port: 8493, userRoot });
        await harness.launch(service.url);
        await harness.waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='OK')`, 90000, 500);
        await harness.evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='OK');b.dataset.surveyEula='true';return true;})()`);
        await harness.clickSelector('[data-survey-eula]');
        await harness.waitFor(`document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`, 240000, 1000);
        await harness.evaluate('window.KotOR.SaveGame.GetSaveGames()', { timeoutMs: 120000 });
        report.bundle = await harness.getTrustedServingBundle();
        const startIndex = report.saves.length;
        if(startIndex===DESTINATIONS.length) {
            for(const [index,name] of ['Nar Shaddaa','Onderon'].entries()) {
                const saved=report.saves.find(save=>save.name===name);
                await harness.evaluate(`(async()=>{const K=window.KotOR,s=K.SaveGame.saves.find(save=>save.directory===${JSON.stringify(saved.directory)});if(!s)throw new Error('Resume seed missing');window.__memoryProbeLoad={module:${JSON.stringify(saved.module)},error:null};await s.load();return true;})()`,{timeoutMs:180000});
                await harness.waitFor(landed,300000,500);
                if(index===0) await enterVrSession(harness);
                if(saved.module==='301NAR') report.narArrival=await stageNarArrival(harness);
                await settleFixtureMenus(harness,saved);
                saved.loadout=await configureSurveyLoadout(harness,saved.module);
                saved.expectedActive=[...saved.loadout.active];
                saved.prepared=await harness.evaluate(EQUIPPED_PARTY_SAMPLE);
                validateEquippedParty(saved.prepared,saved.loadout,saved.expectedActive);
                const saveId=100+DESTINATIONS.findIndex(destination=>destination.module===saved.module);
                await harness.evaluate(`window.KotOR.SaveGame.SaveCurrentGame(${JSON.stringify(saved.saveName)},${saveId})`,{timeoutMs:180000});
                persist();
                console.log('Repaired fixture: '+name);
            }
        }
        for (let index = startIndex; index < DESTINATIONS.length; index++) {
            const d = DESTINATIONS[index];
            console.log('Preparing ' + d.name);
            const reuseIntroduction = d.module === '231TEL' && resumeTelos;
            const sourceSave = reuseIntroduction ? telosBase : baseline;
            const sourceModule = reuseIntroduction ? '231TEL' : '101PER';
            await harness.evaluate(`(async()=>{const K=window.KotOR,g=K.GameState;g.MenuManager.ClearMenus();g.Mode=-1;
    if(g.module){g.module.dispose();g.module=undefined;}
    const s=K.SaveGame.saves.find(s=>s.directory===${JSON.stringify(sourceSave)});if(!s)throw new Error('Baseline missing');
    window.__memoryProbeLoad={module:${JSON.stringify(sourceModule)},error:null};await s.load();return true;})()`, { timeoutMs: 180000 });
            await harness.waitFor(landed, 300000, 500);
            if (index === startIndex)
                await enterVrSession(harness);
            const loadout = await configureSurveyLoadout(harness, d.module);
            if (d.module !== '101PER' && !reuseIntroduction)
                await harness.evaluate(loadModule(d.module));
            let before = await settleArrival(harness, d, report, reuseIntroduction);
            // Arrival scripts may temporarily remove companions; establish the test party after that staging.
            if (!['101PER', '231TEL'].includes(d.module)) {
                await configureSurveyLoadout(harness, d.module);
                before = await settleFixtureMenus(harness, d);
            }
            const expected = d.module === '231TEL' ? [0, 1] : loadout.active;
            const prepared = await harness.evaluate(EQUIPPED_PARTY_SAMPLE);
            validateEquippedParty(prepared, loadout, expected);
            if (d.module === '231TEL')
                report.telosSaveActors = await harness.evaluate(`(()=>{const K=window.KotOR;return [...K.GameState.module.area.creatures,...K.PartyManager.party].filter(p=>p.tag==='BaoDur').map(p=>({found:true,tag:p.tag,id:p.id,type:p.objectType,resref:p.getTemplateResRef(),npcId:p.npcId,inParty:K.PartyManager.party.includes(p),level:p.getTotalClassLevel(),armor:p.equipment.ARMOR?.tag,weapon:p.equipment.RIGHTHAND?.tag}));})()`);
            const id = 100 + index, displayName = d.name + ' - Equipped VR test';
            const metadata = await harness.evaluate(`(async()=>{const K=window.KotOR;await K.SaveGame.SaveCurrentGame(${JSON.stringify(displayName)},${id});
    const s=K.SaveGame.saves.find(s=>s.getSaveNumber()===${id});if(!s || s.getSaveName()!==${JSON.stringify(displayName)})throw new Error('Save metadata mismatch');
    const r={directory:s.directory,saveName:s.getSaveName()};window.__memoryProbeLoad={module:${JSON.stringify(d.module)},error:null};await s.load();return r;})()`, { timeoutMs: 180000 });
            const after = await settleFixtureMenus(harness, d), reloaded = await harness.evaluate(EQUIPPED_PARTY_SAMPLE);
            validateEquippedParty(reloaded, loadout, expected);
            report.saves.push({ ...d, ...metadata, loadout, expectedActive: expected, before, after, prepared, reloaded, reloadVerified: true });
            persist();
            console.log('Verified ' + displayName + ': ' + JSON.stringify(reloaded.party));
            if (d.module === '231TEL')
                report.grass = await harness.evaluate(`(()=>{const g=window.KotOR.GameState;return g.module.area.rooms.filter(r=>r.grass).map(r=>({found:true,room:r.roomName,minFilter:r.grass.material.uniforms.map.value?.minFilter,mips:r.grass.material.uniforms.map.value?.mipmaps?.length}));})()`);
            await harness.cdp.send('Runtime.discardConsoleEntries');
            await harness.cdp.send('HeapProfiler.collectGarbage');
        }
        await harness.evaluate(`(()=>{const K=window.KotOR,pm=K.PartyManager;window.__partyRestoreProbe=[];
        const load=pm.LoadPartyMember;pm.LoadPartyMember=async function(index,...options){
          const slot=pm.CurrentMembers[index]?.memberID,npc=pm.NPCS[slot];
          const record={method:'LoadPartyMember',index,slot,found:!!npc?.template,templateTag:npc?.template?.RootNode?.getFieldByLabel('Tag')?.getValue(),playerTag:pm.Player?.tag};
          await load.call(this,index,...options);record.after=pm.party.map(p=>({npcId:p.npcId,tag:p.tag,found:!!p.model}));window.__partyRestoreProbe.push(record);};
        const remove=pm.RemoveNPCById;pm.RemoveNPCById=function(id,leave){window.__partyRestoreProbe.push({method:'RemoveNPCById',id,leave,found:pm.party.some(p=>p.npcId===id),conversation:K.GameState.CutsceneManager.dialog?.resref});return remove.call(this,id,leave);};
        return true;})()`);
        report.crossSaveChecks = [];
        for (const name of ['Onderon', 'Malachor V', 'Telos', 'Nar Shaddaa', 'Telos']) {
            const saved = report.saves.find(save => save.name === name);
            await harness.evaluate(`(async()=>{const K=window.KotOR,s=K.SaveGame.saves.find(save=>save.directory===${JSON.stringify(saved.directory)});if(!s)throw new Error('Cross-save fixture missing');window.__memoryProbeLoad={module:${JSON.stringify(saved.module)},error:null};await s.load();return true;})()`, { timeoutMs: 180000 });
            const state = await settleFixtureMenus(harness, saved), party = await harness.evaluate(EQUIPPED_PARTY_SAMPLE);
            validateEquippedParty(party, saved.loadout, saved.expectedActive);
            validateRestoredProgress(party, saved.prepared);
            saved.reloaded=party;
            report.crossSaveChecks.push({ name, module: saved.module, state, party });
            persist();
            console.log('Cross-save restore verified: ' + name);
        }
        report.runtimeFailures = runtimeFailures(harness.consoleMessages, harness.pageErrors);
        if (report.runtimeFailures.length)
            throw new Error(report.runtimeFailures.slice(0, 5).join('\n'));
        report.completed = true;
        persist();
        report.published = publishSaves(manifest, path.join(process.env.LOCALAPPDATA, 'Kotor2VR', 'Saves'));
    }
    catch (error) {
        report.error = String(error.stack || error);
        report.consoleErrors=harness.consoleMessages.filter(message=>message.level==='error').slice(-30).map(message=>message.text);
        try {report.partyRestoreProbe=await harness.evaluate('window.__partyRestoreProbe || []');} catch(diagnosticError){report.diagnosticError=String(diagnosticError);}
        report.runtimeFailures = runtimeFailures(harness.consoleMessages, harness.pageErrors);
        throw error;
    }
    finally {
        persist();
        await harness.close();
        if (service)
            service.stop();
        console.log('Manifest: ' + manifest);
    }
}
if (require.main === module)
    main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { ready, settleArrival, validateResumeReport };
