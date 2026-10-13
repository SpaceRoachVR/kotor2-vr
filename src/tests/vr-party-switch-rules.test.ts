import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { buildPartySwitchEntries, nextPartyCycleEntry, PLAYER_SWITCH_ENTRY_ID } from '@/vr/runtime/VRPartySwitchRules';

const exile = { id: '1', name: 'Torm Hobaar', npcId: -1, isPlayer: true, portrait: 'po_pmhh' };
const atton = { id: '2', name: 'Atton', npcId: 0, isPlayer: false, portrait: 'po_patton' };
const t3 = { id: '3', name: 'T3-M4', npcId: 8, isPlayer: false, portrait: 'po_pt3m4' };

describe('buildPartySwitchEntries', () => {
  test('with the Exile in control, every companion is offered as a possession target', () => {
    const entries = buildPartySwitchEntries([exile, atton, t3], 'Torm Hobaar');
    expect(entries).toEqual([
      { id: '2', label: 'Atton', icon: 'po_patton', npcId: 0 },
      { id: '3', label: 'T3-M4', icon: 'po_pt3m4', npcId: 8 },
    ]);
  });

  test('with a companion in control and the Exile following, the Exile is offered by her recorded name', () => {
    // A leader switch keeps the Exile in the party as a follower.
    const entries = buildPartySwitchEntries([t3, atton, exile], 'Torm Hobaar', 'po_pmhh');
    expect(entries).toEqual([
      { id: '2', label: 'Atton', icon: 'po_patton', npcId: 0 },
      { id: PLAYER_SWITCH_ENTRY_ID, label: 'Torm Hobaar', icon: 'po_pmhh', npcId: -1 },
    ]);
  });

  test('in a scripted possession (the Exile not in the party) the Exile is not offered (headset round 16)', () => {
    // 001EBO prologue as T3: offering the Exile built a second one who joined for good.
    expect(buildPartySwitchEntries([t3, atton], 'Torm Hobaar', 'po_pmhh')).toEqual([
      { id: '2', label: 'Atton', icon: 'po_patton', npcId: 0 },
    ]);
  });

  test('the leader is never offered to themselves, and an unnamed Exile is not offered', () => {
    expect(buildPartySwitchEntries([t3, atton], '')).toEqual([{ id: '2', label: 'Atton', icon: 'po_patton', npcId: 0 }]);
    expect(buildPartySwitchEntries([exile], 'Torm Hobaar')).toEqual([]);
    expect(buildPartySwitchEntries([], 'Torm Hobaar')).toEqual([]);
  });

  test('the wheel snapshot possesses through SwitchPlayerCharacter, not SwitchLeaderAtIndex', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    const start = source.indexOf('function snapshotVRPartyMembers()');
    const body = source.slice(start, source.indexOf('function resolveVRCombatWeaponMode(', start));
    expect(body).toContain('buildVRPartySwitchEntries()');
    const builder = source.slice(source.indexOf('function buildVRPartySwitchEntries() {'), start);
    expect(builder).toContain('return buildPartySwitchEntries(');
    expect(body).toContain('GameState.PartyManager.SwitchPlayerCharacter(entry.npcId, true)');
    expect(body).not.toContain('SwitchLeaderAtIndex');
  });
});

describe('nextPartyCycleEntry (the Y button)', () => {
  const kreia = { id: '4', name: 'Kreia', npcId: 6, isPlayer: false, portrait: 'po_pkreia' };
  const entriesWhen = (party: typeof exile[]) => buildPartySwitchEntries(party, 'Torm Hobaar', 'po_pmhh');

  test('cycles Exile -> Atton -> Kreia -> Exile instead of bouncing between companions', () => {
    // Round P1: the first entry was always taken, so Y went Atton -> Kreia ->
    // Atton and never offered the Exile back.
    const fromExile = nextPartyCycleEntry(entriesWhen([exile, atton, kreia]), -1);
    expect(fromExile?.npcId).toBe(0);
    const fromAtton = nextPartyCycleEntry(entriesWhen([atton, kreia, exile]), 0);
    expect(fromAtton?.npcId).toBe(6);
    const fromKreia = nextPartyCycleEntry(entriesWhen([kreia, atton, exile]), 6);
    expect(fromKreia?.npcId).toBe(-1);
    expect(fromKreia?.id).toBe(PLAYER_SWITCH_ENTRY_ID);
  });

  test('with nobody to switch to there is no entry', () => {
    expect(nextPartyCycleEntry([], -1)).toBeNull();
  });

  test('a knocked-out member is passed over (Hive: Y put you in Kreia at -9 HP)', () => {
    const downedAtton = { ...atton, downed: true };
    const fromExile = nextPartyCycleEntry(entriesWhen([exile, downedAtton, kreia]), -1);
    expect(fromExile?.npcId).toBe(6);
    // Kreia in control, the Exile down: Atton next, never the Exile.
    const downedExile = { ...exile, downed: true };
    expect(nextPartyCycleEntry(entriesWhen([kreia, atton, downedExile]), 6)?.npcId).toBe(0);
    // Everyone else down: nobody to switch to.
    expect(nextPartyCycleEntry(entriesWhen([kreia, downedAtton, downedExile]), 6)).toBeNull();
  });

  test('the Y button sees who is down', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    const builder = source.slice(source.indexOf('function buildVRPartySwitchEntries() {'), source.indexOf('function snapshotVRPartyMembers()'));
    expect(builder).toContain('downed: typeof member.isDead === \'function\' && member.isDead(),');
  });

  test('the Y button uses the fixed order, not the first entry', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    const start = source.indexOf('cyclePartyLeader: () => {');
    const body = source.slice(start, source.indexOf('teleportPlayer:', start));
    expect(body).toContain('nextPartyCycleEntry(buildVRPartySwitchEntries(), controlledNpcId)');
    expect(body).toContain('SwitchPlayerCharacter(next.npcId, true)');
  });
});

describe('a module transition while a companion is possessed', () => {
  // Round P1: crossing the Peragus lift as Atton made Atton the player
  // character ("Loading Player" sets npcId -1) and left the Exile behind.
  const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
  const party = fs.readFileSync(path.join(__dirname, '..', 'managers', 'PartyManager.ts'), 'utf8');

  test('LoadModule hands control back before unloading and possesses again once ready', () => {
    const start = game.indexOf('static async LoadModule(');
    const body = game.slice(start, game.indexOf('GameState.loadingModule = false;', start));
    const handBack = body.indexOf('HandBackControlForTransition()');
    expect(handBack).toBeGreaterThan(0);
    expect(handBack).toBeLessThan(body.indexOf('GameState.UnloadModule();'));
    const retake = body.indexOf('SwitchPlayerCharacter(possessedNpcId, true)');
    expect(retake).toBeGreaterThan(body.indexOf('readyToProcessEvents = true'));
  });

  test('handing back does not respawn the companion into the dying module', () => {
    const start = party.indexOf('static HandBackControlForTransition()');
    const body = party.slice(start, party.indexOf('static ReinstatePlayer(', start));
    expect(body).toContain('PartyManager.ReinstatePlayer(followerIndex, false);');
    expect(party).toContain('if(restoreCompanion && outgoingNpcId >= 0');
  });
});

describe('eye height without a head bone', () => {
  test('a humanoid sits below its mesh top; only a droid sits above', () => {
    // The Exile's Peragus space suit has no head nodes; "top + 0.15" put the
    // camera at 2.06 m.
    const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    expect(game).toContain('eye = top - actor.position.z + (droid ? 0.15 : -0.22);');
  });
});
