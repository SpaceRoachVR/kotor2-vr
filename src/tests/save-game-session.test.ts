import { expect, jest, test } from '@jest/globals';
import { prepareSavedGameLoad } from '@/engine/SaveGameSession';
import { EngineMode } from '@/enums/engine/EngineMode';

function session() {
  const player = {destroy:jest.fn()};
  return {loadingModule:false,module:{dispose:jest.fn()},SetEngineMode:jest.fn(),MenuManager:{ClearMenus:jest.fn()},PartyManager:{Player:player,party:[player],PlayerTemplate:{old:true},ActualPlayerTemplate:{old:true}}};
}
test('save replacement releases the outgoing world and player before reading incoming saved templates', () => {
 const state=session(),world=state.module,player=state.PartyManager.Player;
 prepareSavedGameLoad(state);
 expect(state.SetEngineMode).toHaveBeenCalledWith(EngineMode.LOADING);
 expect(state.MenuManager.ClearMenus).toHaveBeenCalledTimes(1);
 expect(world.dispose).toHaveBeenCalledTimes(1);
 expect(player.destroy).toHaveBeenCalledTimes(1);
 expect(state.module).toBeUndefined();
 expect(state.PartyManager).toEqual({Player:undefined,party:[],PlayerTemplate:undefined,ActualPlayerTemplate:undefined});
 prepareSavedGameLoad(state);
 expect(player.destroy).toHaveBeenCalledTimes(1);
});
test('an overlapping transition is rejected without discarding the current world', () => {
 const state=session();state.loadingModule=true;
 expect(()=>prepareSavedGameLoad(state)).toThrow(/transition/);
 expect(state.module.dispose).not.toHaveBeenCalled();
 expect(state.PartyManager.Player.destroy).not.toHaveBeenCalled();
});
test('a teardown failure still detaches all outgoing references and propagates its error', () => {
 const state=session(),player=state.PartyManager.Player;
 state.module.dispose.mockImplementation(()=>{throw new Error('world disposal failed');});
 expect(()=>prepareSavedGameLoad(state)).toThrow('world disposal failed');
 expect(player.destroy).toHaveBeenCalledTimes(1);
 expect(state.module).toBeUndefined();expect(state.PartyManager.party).toEqual([]);
});
test('player disposal failure cannot leave a stale player or template in the next save session', () => {
 const state=session();state.PartyManager.Player.destroy.mockImplementation(()=>{throw new Error('player disposal failed');});
 expect(()=>prepareSavedGameLoad(state)).toThrow('player disposal failed');
 expect(state.PartyManager.Player).toBeUndefined();expect(state.PartyManager.PlayerTemplate).toBeUndefined();
});

test('pc.utc restores the Exile when a saved module has no controlled-player template', () => {
 const {restoreSavedPlayerTemplates} = require('@/engine/SaveGameSession');
 const pc={tag:'Exile',gear:'saved'}; const party: {PlayerTemplate?: typeof pc; ActualPlayerTemplate?: typeof pc} = {};
 restoreSavedPlayerTemplates(party,pc);
 expect(party.PlayerTemplate).toBe(pc);expect(party.ActualPlayerTemplate).toBe(pc);
});
test('a saved companion PIFO keeps control while pc.utc restores the actual Exile backup', () => {
 const {restoreSavedPlayerTemplates} = require('@/engine/SaveGameSession');
 const controlled={tag:'T3M4'},pc={tag:'Exile'},party={PlayerTemplate:controlled,ActualPlayerTemplate:controlled};
 restoreSavedPlayerTemplates(party,pc);
 expect(party.PlayerTemplate).toBe(controlled);expect(party.ActualPlayerTemplate).toBe(pc);
 restoreSavedPlayerTemplates(party,undefined);
 expect(party.ActualPlayerTemplate).toBe(pc);
});

test('menu close callbacks cannot restore INGAME after the outgoing module is detached', () => {
 const state=session();let mode=EngineMode.INGAME;
 state.SetEngineMode.mockImplementation(next=>{mode=next as EngineMode;});
 state.MenuManager.ClearMenus.mockImplementation(()=>{mode=EngineMode.INGAME;});
 prepareSavedGameLoad(state);
 expect(mode).toBe(EngineMode.LOADING);expect(state.module).toBeUndefined();
});

test('equipped item teardown retains the outgoing area context until player disposal completes', () => {
 const state=session(),world=state.module;
 state.PartyManager.Player.destroy.mockImplementation(()=>{expect(state.module).toBe(world);});
 prepareSavedGameLoad(state);
 expect(state.module).toBeUndefined();
});
