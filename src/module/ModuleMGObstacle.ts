import * as THREE from "three";
import { ModuleObject } from "@/module/ModuleObject";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ILayoutObstacle } from "@/interface/resource/ILayoutObstacle";
import { NWScript } from "@/nwscript/NWScript";
import { NWScriptInstance } from "@/nwscript/NWScriptInstance";
import { GFFObject } from "@/resource/GFFObject";
import { ModuleObjectScript } from "@/enums/module/ModuleObjectScript";
import { GameState } from "@/GameState";

/**
* ModuleMGObstacle class.
* 
* Class representing a obstacle found in minigame modules.
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleMGObstacle.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleMGObstacle extends ModuleObject {
  invince: number;
  hit_points: number;
  max_hps: number = 0;
  invince_period: number;
  layout: ILayoutObstacle;

  /**
   * How close the rider must come to count as striking this obstacle.
   *
   * Retail ships no radius for an obstacle: the ARE entry carries only a name
   * and its scripts, and the LYT carries only a name and a position. There is
   * no obstacle model either - no MDL in the module matches these names, so the
   * thing the rider sees is baked into the room, and the obstacle is purely a
   * marker for where that geometry stands. A radius therefore has to be chosen.
   * This one is a little wider than the swoop's own sphere (2) so that clipping
   * the edge of a hazard registers, and is a single named constant precisely
   * because it is a judgement rather than data.
   */
  static readonly DEFAULT_RADIUS = 3;

  /** Collision sphere, in the same track space the player moves through. */
  sphere: THREE.Sphere = new THREE.Sphere(new THREE.Vector3(), ModuleMGObstacle.DEFAULT_RADIUS);

  constructor(template: GFFObject, layout: ILayoutObstacle){
    super(template);
    this.objectType |= ModuleObjectType.ModuleMGObstacle;
    this.name = '';
    this.invince = 0;
    this.layout = layout;
    if(layout?.position){
      this.sphere.center.copy(layout.position);
    }
  }

  /** Whether the rider is inside this obstacle and it is not already spent. */
  isStruckBy(position: THREE.Vector3): boolean {
    if(this.invince > 0){ return false; }
    return this.sphere.containsPoint(position);
  }

  setTemplate(template: GFFObject){
    this.template = template;
    this.initProperties();
    this.loadScripts(); // see ModuleMGPlayer.load
  }

  update(delta: number = 0){

    this.invince -= delta;
    if(this.invince < 0) this.invince = 0;

  }

  updatePaused(delta: number = 0){
    
  }

  damage(damage = 0){

  }

  adjustHitPoints(nHP = 0, nAbsolute = 0){
    this.hit_points += nHP;
  }

  startInvulnerability(){
    this.invince = this.invince_period || 0;
  }

  onAnimEvent(){
    const onAnimEvent = this.scripts[ModuleObjectScript.MGObstacleOnAnimEvent];
    if(!onAnimEvent){ return; }
    onAnimEvent.run(this, 0);
  }

  onCreate(){
    const onCreate = this.scripts[ModuleObjectScript.MGObstacleOnCreate];
    if(!onCreate){ return; }
    onCreate.run(this, 0);
  }

  onHitBullet(){
    const onHitBullet = this.scripts[ModuleObjectScript.MGObstacleOnHitBullet];
    if(!onHitBullet){ return; }
    onHitBullet.run(this, 0);
  }

  onHitFollower(){
    const onHitFollower = this.scripts[ModuleObjectScript.MGObstacleOnHitFollower];
    if(!onHitFollower){ return; }
    onHitFollower.run(this, 0);
  }

  loadScripts(){
    const scriptKeys = [
      ModuleObjectScript.MGObstacleOnAnimEvent,
      ModuleObjectScript.MGObstacleOnCreate,
      ModuleObjectScript.MGObstacleOnHeartbeat,
      ModuleObjectScript.MGObstacleOnHitBullet,
      ModuleObjectScript.MGObstacleOnHitFollower,
    ];

    for(const scriptKey of scriptKeys){
      if(!scriptKey){ continue; }
      const nwscript = GameState.NWScript.Load(scriptKey);
      if(!nwscript){ 
        console.warn(`ModuleMGObstacle.loadScripts: Failed to load script [${scriptKey}] for object ${this.name}`);
        continue; 
      }
      nwscript.caller = this;
      this.scripts[scriptKey] = nwscript;
    }

  }

  initProperties(){
    if(this.template.RootNode.hasField('Name'))
      this.name = this.template.getFieldByLabel('Name').getValue().toLowerCase();

    this.initialized = true;
  }


}
