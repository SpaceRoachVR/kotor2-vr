import {beforeEach, afterEach, expect, jest, test} from '@jest/globals';
jest.mock('@/GameState',()=>({GameState:{}}));
jest.mock('@/engine/CurrentGame',()=>({CurrentGame:{}}));
jest.mock('@/module/ModulePlayer',()=>({ModulePlayer:class{}}));
jest.mock('@/module/ModuleCreature',()=>({ModuleCreature:class{
 position=new (require('three').Vector3)();container={};
 load=jest.fn();clearAllActions=jest.fn();getCurrentRoom=jest.fn();setFacing=jest.fn();onSpawn=jest.fn();
 model={userData:{},hasCollision:false};loadModel=jest.fn(async()=>this.model);
 getPortraitResRef(){return 'po_atton';}
 constructor(public template:unknown){}
}}));
import {PartyManager} from '@/managers/PartyManager';
import {GameState} from '@/GameState';
import {GFFObject} from '@/resource/GFFObject';
import {GFFField} from '@/resource/GFFField';
import {GFFDataType} from '@/enums/resource/GFFDataType';
import * as THREE from 'three';
beforeEach(()=>{
 const template=new GFFObject();template.RootNode.addField(new GFFField(GFFDataType.CEXOSTRING,'Tag')).setValue('Atton');
 PartyManager.NPCS={0:{template}} as any;
 PartyManager.CurrentMembers=[{memberID:0,isLeader:false}];PartyManager.party=[];
 PartyManager.Player={getTag:()=> 'Exile'} as any;PartyManager.PortraitOrder=['po_exile'];
 Object.assign(GameState,{PartyManager,ModuleObjectManager:{GetNextPlayerId:()=>101},group:{party:{add:jest.fn()}}});
 jest.spyOn(PartyManager,'GetSpawnLocation').mockReturnValue({position:new THREE.Vector3(),getFacing:()=>0} as any);
});
afterEach(()=>jest.restoreAllMocks());
test('area party hydration defers spawn scripts until the saved-game-aware initialization phase',async()=>{
 await PartyManager.LoadPartyMember(0,false);
 const member=PartyManager.party[0];
 expect(member).toBeDefined();expect(member.model.hasCollision).toBe(true);
 expect(member.onSpawn).not.toHaveBeenCalled();
 expect(PartyManager.CurrentMembers).toEqual([{memberID:0,isLeader:false}]);
});
test('explicit recruitment still initializes the newly spawned companion immediately',async()=>{
 await PartyManager.LoadPartyMember(0);
 expect(PartyManager.party[0].onSpawn).toHaveBeenCalledTimes(1);
});
