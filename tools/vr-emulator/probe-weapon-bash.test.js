const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vector3 } = require('three');
const { probeWeaponBash } = require('./probe-weapon-bash');
const { CHECKS } = require('./checks');
const check = CHECKS.find(entry => entry.id === 'weapon-bash-route');

function fixture({ bash = true, fail = false, bypassSelection = false, revalidates = true } = {}) {
  let armed = false, swings = 0, refreshed = 0;
  const weapon = {};
  const player = { position: new Vector3(), equipment: { RIGHTHAND: weapon }, combatData: {},
    getCurrentRoom() {}, clearAllActions() {}, cancelCombat() {},
    unequipSlot() { this.equipment.RIGHTHAND = undefined; },
    async equipItem(slot, item) { this.equipment.RIGHTHAND = item; },
  };
  const target = { id: 12, position: new Vector3(10, 10, 0), getTag: () => 'door', isLocked: () => true };
  const K = { PartyManager: { Player: player }, GameState: { module: { area: { doors: [target], placeables: [] } },
    ModuleObjectManager: { GetSelectableObjectsInRange() { refreshed++; } } },
    VRSpike: { hooks: {
      noteWorldPromptSelection(id, label) { armed = id !== null && label === 'Bash'; },
      getWeaponBashContext() { return armed || bypassSelection ? { bash: () => ++swings === 1 } : null; },
    } },
    buildVRWorldActionPrompt() {
      if (fail) throw new Error('prompt failed');
      assert.equal(refreshed, 1);
      assert.equal(player.position.x, 11);
      return { pages: [{ entries: bash ? [{ kind: 'action', label: 'Bash', revalidate: () => revalidates }] : [] }] };
    },
  };
  return { K, player, weapon };
}

test('samples a real in-range prompt and requires selection before dispatch', async () => {
  const { K, player, weapon } = fixture();
  const result = await probeWeaponBash(K);
  assert.equal(check.run({ weaponBash: result }).ok, true);
  assert.equal(result.unselectedBlocked, true);
  assert.equal(result.started, true);
  assert.equal(result.secondStarted, false);
  assert.equal(player.equipment.RIGHTHAND, weapon);
  assert.equal(player.position.length(), 0);
});
test('accepts the refusal only when an authored prompt has no Bash', async () => {
  const result = await probeWeaponBash(fixture({ bash: false }).K);
  assert.equal(result.authoredBashAbsent, true);
  assert.equal(check.run({ weaponBash: result }).ok, true);
  assert.equal(check.run({ weaponBash: { hook: true, lockedCount: 0, started: null } }).ok, false);
});
test('rejects a route that permits swings without selecting Bash', async () => {
  const result = await probeWeaponBash(fixture({ bypassSelection: true }).K);
  assert.equal(check.run({ weaponBash: result }).ok, false);
});
test('a Bash that fails revalidation cannot count as an authored refusal', async () => {
  const result = await probeWeaponBash(fixture({ revalidates: false }).K);
  assert.equal(check.run({ weaponBash: result }).ok, false);
});
test('restores location and equipment even when prompt building fails', async () => {
  const { K, player, weapon } = fixture({ fail: true });
  await assert.rejects(probeWeaponBash(K), /prompt failed/);
  assert.equal(player.equipment.RIGHTHAND, weapon);
  assert.equal(player.position.length(), 0);
});
test('fails clearly when the live engine contracts are unavailable', async () => {
  assert.deepEqual(await probeWeaponBash({}), { hook: false });
  const { K } = fixture();
  K.GameState.module = undefined;
  await assert.rejects(probeWeaponBash(K), /loaded player and area/);
});
