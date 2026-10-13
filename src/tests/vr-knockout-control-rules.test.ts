import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { decideVRKnockoutControl, VR_KNOCKOUT_SWITCH_DELAY_SECONDS, type VRControlMember } from '@/vr/runtime/VRKnockoutControlRules';

const exile = (downed = false, distance = 0): VRControlMember => ({ npcId: -1, isExile: true, downed, distance });
const atton = (downed = false, distance = 3): VRControlMember => ({ npcId: 0, isExile: false, downed, distance });
const kreia = (downed = false, distance = 1.5): VRControlMember => ({ npcId: 6, isExile: false, downed, distance });

describe('knockout hands control to a standing companion (decision 6)', () => {
  test('the Exile down with companions standing: the nearest standing one, after a moment', () => {
    const base = { controlled: exile(true), others: [atton(), kreia()], fightOn: true, knockoutSwitched: false };
    expect(decideVRKnockoutControl({ ...base, controlledDownSeconds: 0.2 })).toEqual({ kind: 'none' });
    expect(decideVRKnockoutControl({ ...base, controlledDownSeconds: VR_KNOCKOUT_SWITCH_DELAY_SECONDS })).toEqual({ kind: 'switch', npcId: 6 });
  });

  test('a downed companion is never chosen', () => {
    const r = decideVRKnockoutControl({ controlled: exile(true), others: [atton(), kreia(true)], fightOn: true, knockoutSwitched: false, controlledDownSeconds: 2 });
    expect(r).toEqual({ kind: 'switch', npcId: 0 });
  });

  test('nobody standing stays the engine\'s defeat (retail game over, dialog.tlk 41883)', () => {
    const r = decideVRKnockoutControl({ controlled: exile(true), others: [atton(true), kreia(true)], fightOn: true, knockoutSwitched: false, controlledDownSeconds: 5 });
    expect(r).toEqual({ kind: 'none' });
  });

  test('control comes back to the Exile once she is up and the fight is over', () => {
    const during = { controlled: kreia(false, 0), others: [atton(), exile(true, 2)], knockoutSwitched: true, controlledDownSeconds: 0 };
    expect(decideVRKnockoutControl({ ...during, fightOn: true })).toEqual({ kind: 'none' });
    // Still down after the fight: the engine revives her first.
    expect(decideVRKnockoutControl({ ...during, fightOn: false })).toEqual({ kind: 'none' });
    expect(decideVRKnockoutControl({ ...during, others: [atton(), exile(false, 2)], fightOn: false })).toEqual({ kind: 'return' });
  });

  test('a switch the player chose is never undone', () => {
    const r = decideVRKnockoutControl({ controlled: kreia(false, 0), others: [atton(), exile(false, 2)], fightOn: false, knockoutSwitched: false, controlledDownSeconds: 0 });
    expect(r).toEqual({ kind: 'none' });
  });
});

describe('GameState wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/GameState.ts'), 'utf8');

  test('runs every in-game frame in VR and switches through SwitchPlayerCharacter, keeping the Exile', () => {
    expect(source).toContain('updateVRLeaderControl(delta);');
    const body = source.slice(source.indexOf('function updateVRLeaderControl('), source.indexOf('function presentVRLeaderSwitch('));
    expect(body).toContain('if (!VRSpike.isPresenting');
    expect(body).toContain('GameState.PartyManager.SwitchPlayerCharacter(decision.npcId, true);');
    expect(body).toContain('GameState.PartyManager.SwitchPlayerCharacter(-1, true);');
  });

  test('every leader switch fades, names the new body and plays its retail select line', () => {
    const present = source.slice(source.indexOf('function presentVRLeaderSwitch('), source.indexOf('function seatVRLeaderClear('));
    expect(present).toContain('VRSpike.presentLeaderSwitch(`Now: ${');
    const spike = fs.readFileSync(path.join(process.cwd(), 'src/vr/VRSpike.ts'), 'utf8');
    const fade = spike.slice(spike.indexOf('static presentLeaderSwitch('), spike.indexOf('private static applyLeaderSwitchFade('));
    expect(fade).toContain("VRSpike.showNotice(text, 1500, 'info');");
    expect(fade).toContain("VRSpike.playBark(actorId, 'select');");
    expect(spike).toContain('VRSpike.applyLeaderSwitchFade();');
  });
});
