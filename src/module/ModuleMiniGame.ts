import { GameState } from "@/GameState";
import { MiniGameType } from "@/enums/engine/MiniGameType";
import { ModuleObjectScript } from "@/enums/module/ModuleObjectScript";
import { NWScriptInstance } from "@/nwscript/NWScriptInstance";
import { GFFObject } from "@/resource/GFFObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { ModuleMGEnemy } from "@/module/ModuleMGEnemy";
import type { ModuleMGObstacle } from "@/module/ModuleMGObstacle";
import type { ModuleMGPlayer } from "@/module/ModuleMGPlayer";
import type { ModuleMGTrack } from "@/module/ModuleMGTrack";

/**
* ModuleMiniGame class.
* 
* Class representing the minigame instance in a minigame module.
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleMiniGame.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleMiniGame {
  type: MiniGameType;

  bumpPlane: number = 0;
  cameraViewAngle: number = 0;
  dof: number = 0;
  doBumping: number = 0;
  player: ModuleMGPlayer;

  farClip: number = 0;
  lateralAccel: number = 0;
  movementPerSec: number = 0;
  music: number = 0;
  nearClip: number = 0;
  useInertia: number = 0;

  enemies: ModuleMGEnemy[] = [];
  obstacles: ModuleMGObstacle[] = [];
  /** ARE obstacle templates by lowercase name; the LYT places them. */
  obstacleTemplates: Map<string, GFFObject> = new Map();
  tracks: ModuleMGTrack[] = [];

  constructor(struct: GFFStruct){
    this.bumpPlane = struct.getFieldByLabel('Bump_Plane').getValue();
    this.cameraViewAngle = struct.getFieldByLabel('CameraViewAngle').getValue();
    this.dof = struct.getFieldByLabel('DOF').getValue();
    this.doBumping = struct.getFieldByLabel('DoBumping').getValue();
    this.farClip = struct.getFieldByLabel('Far_Clip').getValue();
    this.lateralAccel = struct.getFieldByLabel('LateralAccel').getValue();
    this.movementPerSec = struct.getFieldByLabel('MovementPerSec').getValue();
    this.music = struct.getFieldByLabel('Music').getValue();
    this.nearClip = struct.getFieldByLabel('Near_Clip').getValue();
    this.type = struct.getFieldByLabel('Type').getValue();
    this.useInertia = struct.getFieldByLabel('UseInertia').getValue();

    this.player = new GameState.Module.ModuleArea.ModuleMGPlayer(
      GFFObject.FromStruct(struct.getFieldByLabel('Player').getChildStructs()[0])
    );

    const enemies = struct.getFieldByLabel('Enemies').getChildStructs();
    for(let i = 0; i < enemies.length; i++){
      this.enemies.push(
        new ModuleMGEnemy(
          GFFObject.FromStruct(enemies[i])
        )
      );
    }

    // Obstacle templates, keyed by name. The obstacles themselves are placed by
    // the LYT, which carries only a name and a position; the ARE carries the
    // scripts for the same names. This list was never read at all, so every
    // obstacle reached the track with no scripts - and 211TEL's six scripted
    // obstacles (OnHitFollower: spec_obst_hit) did nothing when struck.
    const obstacles = struct.getFieldByLabel('Obstacles')?.getChildStructs() ?? [];
    for(let i = 0; i < obstacles.length; i++){
      const template = GFFObject.FromStruct(obstacles[i]);
      const name = template.getFieldByLabel('Name')?.getValue();
      if(!name){ continue; }
      this.obstacleTemplates.set(String(name).toLowerCase(), template);
    }
  }

  /**
   * Attaches each placed obstacle's template, matched to the LYT by name. The
   * area builds the obstacles from the layout, so this runs once they exist.
   * All 105 of 211TEL's placed obstacles match an ARE entry exactly.
   */
  applyObstacleTemplates(){
    for(let i = 0; i < this.obstacles.length; i++){
      const obstacle = this.obstacles[i];
      const name = obstacle?.layout?.name;
      if(!obstacle || !name){ continue; }
      const template = this.obstacleTemplates.get(String(name).toLowerCase());
      if(!template){ continue; }
      obstacle.setTemplate(template);
    }
  }

  tick(delta: number = 0){
    this.player.update(delta);

    for(let i = 0; i < this.enemies.length; i++){
      this.enemies[i].update(delta);
    }
    
    for(let i = 0; i < this.obstacles.length; i++){
      this.obstacles[i].update(delta);
    }
  }

  tickPaused(delta: number = 0){
    this.player.updatePaused(delta);
    
    for(let i = 0; i < this.enemies.length; i++){
      this.enemies[i].updatePaused(delta);
    }

    for(let i = 0; i < this.obstacles.length; i++){
      this.obstacles[i].updatePaused(delta);
    }
  }

  async load(){
    try { await this.loadMGTracks(); } catch(e){ console.error(e); }
    try { await this.loadMGPlayer(); } catch(e){ console.error(e); }
    try { await this.loadMGEnemies(); } catch(e){ console.error(e); }
  }

  initMiniGameObjects(){
    for(let i = 0; i < this.enemies.length; i++){
      if(this.enemies[i]){
        this.enemies[i].onCreate();
        this.enemies[i].spawned = true;
      }
    }

    for(let i = 0; i < this.obstacles.length; i++){
      if(this.obstacles[i]){
        this.obstacles[i].onCreate();
        this.obstacles[i].spawned = true;
      }
    }

    if(this.player){
      this.player.onCreate();
      // `spawned` is the gate on triggerHeartbeat(), and it is only ever set by
      // onSpawn(), which the area runs for creatures and party members - never
      // for minigame objects. So no minigame object had a heartbeat, and on the
      // swoop the heartbeat script *is* the race: the gear countdown, the lap
      // timer, the engine sound, the finish. This is the minigame's spawn.
      this.player.spawned = true;
    }
  }

  async loadMGPlayer(): Promise<void> {
    console.log('Loading MG Player')
    const player: ModuleMGPlayer = this.player;
      await player.load();
      await player.loadCamera();
      await player.loadModel();
      await player.loadGunBanks();
      // find() yields undefined when no track matches the declared trackName.
      // Reaching through it threw out of the minigame load entirely.
      const track = this.tracks.find(o => o.track === player.trackName);
      if(track){
        player.setTrack(track.model);
      }else{
        console.warn('ModuleMiniGame: no track named', player.trackName, 'for the player;',
          'available:', this.tracks.map(t => t.track));
      }
      player.getCurrentRoom();
  }

  async loadMGTracks(): Promise<void>{
    for(let i = 0; i < this.tracks.length; i++){
      const track = this.tracks[i];
      await track.load();
      const model = await track.loadModel();
      track.model = model;
      model.userData.moduleObject = track;
      model.userData.index = i;
      //model.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1), -Math.atan2(spawnLoc.XOrientation, spawnLoc.YOrientation));
      model.hasCollision = true;
      GameState.group.creatures.add( track.model );

      track.computeBoundingBox();
      track.getCurrentRoom();
    }
  }

  async loadMGEnemies(): Promise<void> {
    for(let i = 0; i < this.enemies.length; i++){
      const enemy = this.enemies[i];
      await enemy.load();
      await enemy.loadModel();
      await enemy.loadGunBanks();
      // Same unmatched-trackName case as the player, and worse: this loop is not
      // wrapped, so one enemy with no matching track threw out of loadMGEnemies
      // and every enemy after it was silently never loaded. Measured on 371NAR.
      const track = this.tracks.find(o => o.track === enemy.trackName);
      if(track){
        enemy.setTrack(track.model);
      }else{
        console.warn('ModuleMiniGame: no track named', enemy.trackName, 'for enemy', i);
      }
      enemy.computeBoundingBox();
      enemy.getCurrentRoom();
    }
  }

  runMiniGameScripts(){
    // OnCreate for the player and the obstacles already ran in
    // initMiniGameObjects(), which runs just before this; only the enemies are
    // (re)started here.
    for(let i = 0; i < this.enemies.length; i++){
      const enemy = this.enemies[i];
      const onCreate = enemy.scripts[ModuleObjectScript.MGEnemyOnCreate];
      // `continue`, not `return`: one enemy without an OnCreate used to abort
      // the loop, so every enemy after it stayed uninitialised too.
      if(!onCreate){ continue; }
      onCreate.run(enemy, 0);
    }
  }

}