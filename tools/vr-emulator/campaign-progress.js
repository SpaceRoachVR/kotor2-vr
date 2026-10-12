/** Read-only progression evidence for the fresh-game Peragus acceptance run. */
const GLOBAL_NAMES = Object.freeze([
  '101PER_Kreia_Spawn', '101PER_Talk_Kreia', '101PER_Know_Adm_Code',
  '101PER_Switch', '101PER_Open_Hatch', '103PER_T3_Ambush',
]);

const CAMPAIGN_PROGRESS = `(() => {
  const K = window.KotOR;
  const gs = K && K.GameState;
  const area = gs && gs.module && gs.module.area;
  const party = K && K.PartyManager;
  const player = party && party.party && party.party[0];
  const manager = gs && gs.GlobalVariableManager;
  const journal = K && K.JournalManager;
  if (!area || !player || !manager || !journal || !Array.isArray(journal.Entries)) {
    return { found: false, areaFound: !!area, playerFound: !!player,
      globalsFound: !!manager, journalFound: !!journal };
  }
  const identity = (object) => ({ found: true, id: object.id,
    tag: String(object.tag || ''), type: object.objectType,
    resref: String(object.templateResRef || object.template && object.template.resRef || ''),
    npcId: object.npcId, isPlayer: object.isPlayer === true,
    position: { x: object.position.x, y: object.position.y, z: object.position.z } });
  const numbers = manager.Globals && manager.Globals.Number;
  const globals = {};
  for (const name of ${JSON.stringify(GLOBAL_NAMES)}) {
    const found = numbers instanceof Map && numbers.has(name.toLowerCase());
    globals[name] = { found, value: found ? manager.GetGlobalNumber(name) : null };
  }
  return { found: true, module: String(area.name || '').toLowerCase(),
    presenting: !!(K.VRSpike && K.VRSpike.isPresenting),
    ready: gs.module.readyToProcessEvents === true, mode: gs.Mode,
    player: identity(player), party: party.party.map(identity),
    companions: (area.creatures || []).filter((c) => c && /^(Kreia|Atton|t3m4)$/i.test(c.tag || '')).map(identity),
    roster: Object.entries(party.NPCS || {}).map(([id, npc]) => ({ id: Number(id),
      available: npc.available === true || npc.available === 1,
      spawned: npc.spawned === true || npc.spawned === 1 })),
    globals, journal: journal.Entries.map((entry) => ({ tag: entry.plot_id, state: entry.state })) };
})()`;

function assertCampaignMilestone(name, snapshot) {
  if (!snapshot || snapshot.found !== true) throw new Error(`${name}: progression subjects not located`);
  if (!snapshot.presenting || !snapshot.ready || snapshot.mode !== 1) {
    throw new Error(`${name}: expected ready, presenting gameplay; ${JSON.stringify(snapshot)}`);
  }
  const expectedModule = name === 'mining-tunnels' ? '102per' :
    name === 't3-hangar' ? '106per' : name === 't3-fuel-depot' ? '103per' : '101per';
  if (snapshot.module !== expectedModule) throw new Error(`${name}: expected ${expectedModule}, got ${snapshot.module}`);
  const requireGlobal = (key, value) => {
    const global = snapshot.globals && snapshot.globals[key];
    if (!global || global.found !== true || global.value !== value) {
      throw new Error(`${name}: expected declared ${key}=${value}; got ${JSON.stringify(global)}`);
    }
  };
  if (name === 'kreia-awakened') {
    requireGlobal('101PER_Kreia_Spawn', 2);
    requireGlobal('101PER_Talk_Kreia', 1);
    if (!Array.isArray(snapshot.companions) || !snapshot.companions.some((c) => /^kreia$/i.test(c.tag))) {
      throw new Error(`${name}: live Kreia not found`);
    }
    if (!Array.isArray(snapshot.journal) || !snapshot.journal.some((q) =>
      /^recoverebonhawk$/i.test(q.tag) && q.state === 10)) {
      throw new Error(`${name}: RecoverEbonHawk journal state 10 not found`);
    }
  } else if (name === 'atton-freed') {
    requireGlobal('101PER_Know_Adm_Code', 1);
    if (!Array.isArray(snapshot.companions) || !snapshot.companions.some((c) => /^atton$/i.test(c.tag))) {
      throw new Error(`${name}: live Atton not found`);
    }
  } else if (name === 't3-hangar' || name === 't3-fuel-depot') {
    if (!snapshot.player || snapshot.player.found !== true ||
        !/^t3m4$/i.test(snapshot.player.tag) || snapshot.player.npcId !== 8) {
      throw new Error(`${name}: T3-M4 is not the controlled party leader: ${JSON.stringify(snapshot.player)}`);
    }
    if (!Array.isArray(snapshot.roster) || !snapshot.roster.some((npc) => npc.id === 8 && npc.available)) {
      throw new Error(`${name}: T3-M4 is not registered as available`);
    }
  } else if (name === 'hatch-opened' || name === 'mining-tunnels') {
    // a_sett3ambush arms the scene at 1; a_creforhk50amb starts it at 2.
    requireGlobal('103PER_T3_Ambush', 2);
    requireGlobal('101PER_Open_Hatch', 1);
    if (!snapshot.player || snapshot.player.found !== true || snapshot.player.isPlayer !== true ||
        snapshot.player.npcId !== -1 || /^t3m4$/i.test(snapshot.player.tag)) {
      throw new Error(`${name}: the Exile is not the controlled party leader: ${JSON.stringify(snapshot.player)}`);
    }
    if (!Array.isArray(snapshot.party) || snapshot.party.length !== 1 ||
        snapshot.party[0]?.isPlayer !== true || snapshot.party[0]?.npcId !== -1) {
      throw new Error(`${name}: expected the solo Exile before the authored companion rescue: ${JSON.stringify(snapshot.party)}`);
    }
  } else {
    throw new Error(`unsupported campaign milestone: ${name}`);
  }
  return snapshot;
}

async function captureCampaignMilestone(harness, name) {
  return assertCampaignMilestone(name, await harness.evaluate(CAMPAIGN_PROGRESS));
}

function selectObjectAtPlacement(objects, position, label, maximumDistance = 0.75) {
  if (!Array.isArray(objects) || !position || ![position.x, position.y, position.z].every(Number.isFinite) ||
      typeof label !== 'string' || !label.trim() || !Number.isFinite(maximumDistance) || maximumDistance <= 0) {
    throw new TypeError('object placement requires objects, finite coordinates, a label, and a positive distance');
  }
  const matches = objects.filter((object) => object && Number.isInteger(object.id) && object.position &&
    [object.position.x, object.position.y, object.position.z].every(Number.isFinite) &&
    Math.hypot(object.position.x - position.x, object.position.y - position.y,
      object.position.z - position.z) <= maximumDistance);
  if (matches.length !== 1) {
    throw new Error(`${label}: found=${matches.length > 0}, expected exactly one object at the retail placement, got ${matches.length}`);
  }
  return matches[0];
}

function evaluateCampaignAcceptance(report) {
  const failures = [];
  if (!report || report.acceptance !== true) return { passed: false, failures: ['not an acceptance run'] };
  if (!report.bootstrap || report.bootstrap.freshGame !== true || report.bootstrap.loadedFromSave !== false ||
      report.bootstrap.prologueRoute !== 'continue') failures.push('not a fresh authored game');
  if (!/^[a-f0-9]{64}$/i.test(report.bootstrap && report.bootstrap.servingBundleSha256 || '')) {
    failures.push('missing trusted serving bundle identity');
  }
  if (!report.target || report.targetReached !== true) failures.push('requested checkpoint not reached');
  if (report.blocked) failures.push(`blocked: ${report.blocked.step}`);
  if (!Array.isArray(report.passes) || report.passes.length !== 1 || report.passes[0].resume !== null) {
    failures.push('campaign restarted or resumed');
  }
  if (!Array.isArray(report.steps) || !report.steps.length ||
      report.steps.some((entry) => entry.ok !== true || entry.retriedAfterDeath)) failures.push('failed or retried gameplay step');
  if (!Array.isArray(report.pageErrors) || report.pageErrors.length) failures.push('page exceptions or missing exception evidence');
  if (!Array.isArray(report.vrLoopFailures) || report.vrLoopFailures.length) failures.push('VR loop failures or missing loop evidence');
  if (!Number.isInteger(report.finalXrFrames) || report.finalXrFrames < 10) failures.push('XR frames did not advance at arrival');
  return { passed: failures.length === 0, failures };
}

/** 001EBO's corridor turns through the first security doorway before the second. */
function getEbonSecurityDoorApproach(target, doors) {
  if (!target || !target.position || ![target.position.x, target.position.y, target.position.z].every(Number.isFinite) ||
      !Array.isArray(doors)) throw new TypeError('security approach requires a placed target and the live door list');
  if (Math.hypot(target.position.x - 47.3369, target.position.y - 36.1489) > 0.75) return [];
  const entrance = selectObjectAtPlacement(doors, { x: 49.7567, y: 39.7578, z: 1.805 }, 'first security doorway');
  if (entrance.open !== true) throw new Error('first security doorway is not open; refusing to walk through it');
  return [
    { x: entrance.position.x, y: entrance.position.y + 1.25, z: entrance.position.z },
    entrance.position,
    { x: entrance.position.x, y: entrance.position.y - 1.25, z: entrance.position.z },
  ];
}

/** 101PER's medical corridor must enter the room before turning south. */
function getMedbayCombatCornerRecovery(position) {
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new TypeError('medical corridor recovery requires finite coordinates');
  }
  if (position.x < -23 || position.x > -19 || position.y < -17 || position.y > -12 ||
      Math.abs(position.z - 9.06) > 0.5) return [];
  return [{ x: -25, y: -15, z: 9.06 }, { x: -24.3, y: -18.6, z: 9.06 }];
}

module.exports = { GLOBAL_NAMES, CAMPAIGN_PROGRESS, assertCampaignMilestone, captureCampaignMilestone,
  selectObjectAtPlacement, evaluateCampaignAcceptance, getEbonSecurityDoorApproach, getMedbayCombatCornerRecovery };
