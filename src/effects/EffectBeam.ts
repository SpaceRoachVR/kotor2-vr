import { GameEffect } from "@/effects/GameEffect";
import { GameState } from "@/GameState";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { MDLLoader } from "@/loaders";
// import { TwoDAManager } from "@/managers/TwoDAManager";
import { OdysseyModel } from "@/odyssey";
import { OdysseyModel3D } from "@/three/odyssey";

/**
 * EffectBeam class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EffectBeam.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectBeam extends GameEffect {
  modelName: string;
  model: OdysseyModel3D;
  visualEffect: any;
  /** Set once the effect is gone, so a model that finishes loading late is dropped. */
  private removed = false;

  constructor(){
    super();
    this.type = GameEffectType.EffectBeam;

    //intList[0] : visualeffects.2da id
    //intList[1] : bodypart constant
    //intList[2] : hit or miss

    //objectList[0] : caster

    // this.modelName = undefined;
    // this.model = undefined;

  }

  initialize() {
    if(this.initialized)
      return this;
      
    const visualeffects2DA = GameState.TwoDAManager.datatables.get('visualeffects');
    if(visualeffects2DA){
      this.visualEffect = visualeffects2DA.getByID(this.getInt(0));
    }

    super.initialize();

    // 2DA cells arrive as strings; a strict switch on '614' matched no case,
    // so every beam (flame spray, ion ray, stun ray) drew the cold ray default.
    switch(Number(this.visualEffect?.progfx_duration)){
      case 616:
        this.modelName = 'v_coldray_dur';
      break;
      case 612: 
        this.modelName = 'v_deathfld_dur';
      break;
      case 613: 
        this.modelName = 'v_drain_dur';
      break;
      case 611:
        this.modelName = 'v_drdkill_dur';
      break;
      case 610:
        this.modelName = 'v_drddisab_dur';
      break;
      case 620: 
        this.modelName = 'v_drdstun_dur';
      break;
      case 614:
        this.modelName = 'v_flame_dur';
      break;
      case 619:
        this.modelName = 'v_fstorm_dur';
      break;
      case 617:
        this.modelName = 'v_ionray01_dur';
      break;
      case 618:
        this.modelName = 'v_ionray02_dur';
      break;
      case 609:
        this.modelName = 'v_lightnx_dur';
      break;
      case 608:
        this.modelName = 'v_lightns_dur';
      break;
      case 621:
        this.modelName = 'v_fshock_dur';
      break;
      case 615:
        this.modelName = 'v_stunray_dur';
      break;
      default:
        this.modelName = 'v_coldray_dur';
      break;
    }
    return this;
  }

  loadModel(): Promise<void> {
    return new Promise<void>( ( resolve, reject) => {
      MDLLoader.loader.load(this.modelName)
      .then((mdl: OdysseyModel) => {
        OdysseyModel3D.FromMDL(mdl, {
          context: this.object.context,
          onComplete: (model: OdysseyModel3D) => {
            this.model = model;
            // addEffect starts the load and applies at once, so the model is
            // almost never ready in onApply: attach it here if it was applied.
            if(this.applied) this.attachBeam();
            resolve();
          }
        });
      }).catch(() => {
        resolve();
      });
    });
  }

  onApply(){
    if(this.applied)
      return;
      
    super.onApply();
    this.attachBeam();
    // The beam's own sound (v_bem_ionray, v_bem_flamespray, ...) from the caster.
    const sound = this.visualEffect?.soundduration;
    const caster = this.getCaster() as any;
    if(typeof sound === 'string' && sound && sound !== '****' && caster?.audioEmitter?.playSound){
      try { caster.audioEmitter.playSound(sound); } catch { /* sound is optional */ }
    }
  }

  /**
   * Round 12 (F14): the droid shock arm and flamethrower showed no beam. The
   * beam was attached only if its model had already loaded when the effect was
   * applied, which it never had, and applied then stayed true for good.
   */
  private attachBeam(){
    if(this.removed || !(this.model instanceof OdysseyModel3D)) return;
    const caster = this.getCaster();
    if(!(caster?.model instanceof OdysseyModel3D) || this.model.parent === caster.model) return;
    //Add the effect to the casters model
    caster.model.add(this.model);
    //Set the target node of the BeamEffect emitter
    this.model.setEmitterTarget(this.object.model);
  }

  onRemove(){
    this.removed = true;
    // The beam lasts as long as the effect (a second for the droid devices).
    if(this.model){
      this.model.removeFromParent();
    }
    super.onRemove();
  }

  update(delta = 0){
    super.update(delta);

    if(this.durationEnded && this.getDurationType() == GameEffectDurationType.TEMPORARY){
      return;
    }
  }

  getCaster(){
    return this.getObject(0);
  }

}
