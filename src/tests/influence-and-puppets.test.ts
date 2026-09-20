import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * TSL influence and puppets, against the shapes a retail PARTYTABLE.res uses
 * (read with PyKotor from saves/000002 - Game1):
 *
 *   PT_INFLUENCE   LIST of 12 structs, each { PT_NPC_INFLUENCE: Int32 }, -1 seeded
 *   PT_AVAIL_PUPS  LIST of 3 structs, each { PT_PUP_AVAIL: UInt8, PT_PUP_SELECT: UInt8 }
 *   PT_PUPPETS     LIST of the puppets in the party
 *   PT_NUM_PUPPETS BYTE
 *
 * All four were in save_schema.py's "retail writes it, we never do" list.
 *
 * Semantics come from tsl_nwscript.nss: GetInfluence returns 0 for a companion
 * who is not an available party member and -1 for one who is ambivalent;
 * SetInfluence/ModifyInfluence do nothing for an unavailable companion; a
 * spawned puppet is not a party puppet until AddPartyPuppet takes it.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const party = read('managers/PartyManager.ts');
const k2 = read('nwscript/NWScriptDefK2.ts');

function routineBody(id: number): string {
  const at = k2.indexOf(`\n  ${id}: {`);
  expect(at).toBeGreaterThan(-1);
  return k2.slice(at, at + 1200);
}

describe('party table fields', () => {
  test.each([
    ["new GFFField(GFFDataType.LIST, 'PT_INFLUENCE')", 'PT_INFLUENCE'],
    ["new GFFField(GFFDataType.INT, 'PT_NPC_INFLUENCE')", 'PT_NPC_INFLUENCE as Int32'],
    ["new GFFField(GFFDataType.LIST, 'PT_AVAIL_PUPS')", 'PT_AVAIL_PUPS'],
    ["new GFFField(GFFDataType.BYTE, 'PT_PUP_AVAIL')", 'PT_PUP_AVAIL as BYTE'],
    ["new GFFField(GFFDataType.BYTE, 'PT_PUP_SELECT')", 'PT_PUP_SELECT as BYTE'],
    ["new GFFField(GFFDataType.LIST, 'PT_PUPPETS')", 'PT_PUPPETS'],
    ["new GFFField(GFFDataType.BYTE, 'PT_NUM_PUPPETS')", 'PT_NUM_PUPPETS as BYTE'],
  ])('Export writes %s', (needle) => {
    expect(party).toContain(needle);
  });

  test('influence is written for every one of the twelve slots', () => {
    expect(party).toContain('for(let i = 0; i < PartyManager.MaxPartyCount; i++){');
    expect(party).toContain("struct.addField( new GFFField(GFFDataType.INT, 'PT_NPC_INFLUENCE') ).setValue(typeof value === 'number' ? value : -1);");
  });

  test.each([
    ["new GFFField(GFFDataType.DWORD, 'PT_ITEM_CHEMICAL')", 'chemicals'],
    ["new GFFField(GFFDataType.DWORD, 'PT_ITEM_COMPONEN')", 'components'],
    ["new GFFField(GFFDataType.DWORD, 'PT_SWOOP1')", 'swoop upgrade 1'],
    ["new GFFField(GFFDataType.CEXOSTRING, 'PT_PCNAME')", 'PC name'],
  ])('Export also writes %s', (needle) => {
    // Values the engine already tracked from load but never saved.
    expect(party).toContain(needle);
  });

  test('saved puppets are read back on load', () => {
    expect(party).toContain("gff.RootNode.hasField('PT_PUPPETS')");
    expect(party).toContain('slot.inParty = true;');
  });
});

describe('influence semantics', () => {
  test('an unavailable companion reports 0 and cannot be changed', () => {
    const get = party.slice(party.indexOf('static getInfluence('), party.indexOf('static setInfluence('));
    expect(get).toContain('if(!npc || !npc.available) return 0;');
    const set = party.slice(party.indexOf('static setInfluence('), party.indexOf('static modifyInfluence('));
    expect(set).toContain('if(!npc || !npc.available) return;');
  });

  test('influence is clamped to 0-100', () => {
    expect(party).toContain('Math.max(0, Math.min(100, Math.trunc(Number.isFinite(value) ? value : 0)))');
  });

  test('modifying an unset (-1) slot starts from the ambivalent midpoint', () => {
    expect(party).toContain('const base = (typeof current === \'number\' && current >= 0) ? current : 50;');
  });
});

describe('puppet semantics', () => {
  test('a spawned puppet is not a party puppet until it is added', () => {
    const isPuppet = party.slice(party.indexOf('static GetIsPuppet('), party.indexOf('static GetPUPOwner('));
    expect(isPuppet).toContain('slot.inParty');
  });

  test('AssignPUP requires both the puppet and the companion to be available', () => {
    const assign = party.slice(party.indexOf('static AssignPUP('), party.indexOf('SpawnAvailablePUP: build'));
    expect(assign).toContain('if(!slot || !slot.available || !npc || !npc.available) return false;');
  });

  test('a puppet follows its owner rather than the party leader', () => {
    const follow = read('actions/ActionFollowLeader.ts');
    expect(follow).toContain('GameState.PartyManager.GetPUPOwner(this.owner as any)');
    expect(follow).toContain('this.target = owner || GameState.PartyManager.party[0];');
  });
});

describe('routines are wired to the systems', () => {
  test.each([
    [795, 'getInfluence'], [796, 'setInfluence'], [797, 'modifyInfluence'],
    [836, 'AddAvailablePUPByTemplate'], [837, 'AddAvailablePUPByObject'], [838, 'AssignPUP'],
    [839, 'SpawnAvailablePUPSync'], [840, 'AddPartyPuppet'], [841, 'GetPUPOwner'],
    [842, 'GetIsPuppet'], [874, 'SavePUPByObject'],
  ])('%i calls PartyManager.%s', (id, method) => {
    expect(routineBody(id as number)).toContain(`GameState.PartyManager.${method}(`);
  });

  test('843 ActionFollowOwner queues the follow action', () => {
    expect(routineBody(843)).toContain('ActionFollowLeader()');
  });
});
