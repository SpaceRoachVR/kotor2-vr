import type { ModuleObject } from "@/module";
import type { TalentSpell } from "@/talents";
import * as THREE from "three";
import { OdysseyModel3D } from "@/three/odyssey";
// import { NWScript } from "@/nwscript/NWScript";
import { OdysseyModel } from "@/odyssey";
import { GameState } from "@/GameState";
import { MDLLoader } from "@/loaders";

/**
 * SpellCastInstance class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file SpellCastInstance.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class SpellCastInstance {

  context: GameState;
  spell: TalentSpell;
  owner: ModuleObject;
  target: ModuleObject;
  targetLocation: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  container: THREE.Object3D = new THREE.Object3D();

  conjtime: string;
  casttime: string;
  catchtime: string;
  conjanim: string;
  hostilesetting: number;
  iconresref: any;
  projectileHook: any;
  projectileOrigin: THREE.Vector3;
  projectileTarget: THREE.Vector3;
  projectileCurve: THREE.QuadraticBezierCurve3;

  projectile: OdysseyModel3D;
  castTimeProgress: number = 0;
  projectileDistance: THREE.Vector3;
  casthandmodel: OdysseyModel3D;
  impactscript: string;
  casthandvisual: string;
  flags: number;

  impacted: boolean = false;
  completed: boolean = false;
  conjureTime = 3000;
  conjuring: boolean = false;
  castTime: number = 0;

  constructor(caster: ModuleObject, target: ModuleObject, spell: TalentSpell){
    this.context = caster.context;
    this.owner = caster;
    this.target = target;
    this.spell = spell;
    // spells.2da drives the cast. None of these were copied, so `impactscript`
    // was undefined and impact() loaded a script by that name: no spell or
    // grenade ever applied anything. Round 8: "thrown grenades still appear to
    // do nothing. they do not cause damage to mining droids or show animated
    // explosion" — the Frag Grenade's k_sup_grenade never ran.
    this.impactscript = typeof spell?.impactscript === 'string' ? spell.impactscript : '';
    this.casthandvisual = typeof spell?.casthandvisual === 'string' ? spell.casthandvisual : '';
    // The authored timing, not a flat 3 s in the hand with no flight: a Frag
    // Grenade is 170 ms conjure and a 1330 ms throw, and the projectile only
    // travels its arc while castTime is counting down.
    const conjure = Number(spell?.conjtime);
    if(Number.isFinite(conjure) && conjure >= 0) this.conjureTime = conjure;
    const cast = Number(spell?.casttime);
    if(Number.isFinite(cast) && cast > 0) this.castTime = cast;
  }

  init(){
    this.projectileHook = undefined;
    this.projectileOrigin = new THREE.Vector3();
    this.projectileTarget = new THREE.Vector3();
    this.projectileCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3( 0, 0, 0 ),
      new THREE.Vector3( 0, 0, 0 ),
      new THREE.Vector3( 0, 0, 0 )
    );

    if(this.target){
      this.projectileTarget.copy(this.target.position);
      this.projectileTarget.x += Math.random() * (0.25 - -0.25) + -0.25;
      this.projectileTarget.y += Math.random() * (0.25 - -0.25) + -0.25;
      this.projectileCurve.v2.copy(this.projectileTarget);
    }

    if(this.spell.projmodel != ''){
      console.log('projectile', this.spell.projmodel);
      MDLLoader.loader.load(this.spell.projmodel.toLowerCase())
      .then((mdl: OdysseyModel) => {
        OdysseyModel3D.FromMDL(mdl, {
          context: this.owner.context
        }).then((model: OdysseyModel3D) => {
          this.projectile = model;
          console.log('projectile', model);
          if(this.owner.model){
            if(this.owner.model.rhand){
              this.owner.context.group.effects.add(model);
              this.projectileHook = this.owner.model.rhand;
              //TextureLoader.LoadQueue();
            }else{
              this.projectile.dispose();
            }
          }else{
            this.projectile.dispose();
          }

        });
      });
    }
  }

  update(delta: number = 0){
    if(this.conjureTime > 0){
      this.conjuring = true;
      this.conjureTime -= (1000 * delta);

      if(this.projectile && this.projectileHook){
        this.projectileHook.getWorldPosition(this.projectile.position);
        this.projectileOrigin.copy(this.projectile.position);
        this.projectileCurve.v0.copy(this.projectileOrigin);
      }
      //combatAction.casting = true;
    }else if(this.castTime > 0){
      this.conjuring = false;

      this.castTimeProgress = this.castTime / (this.spell.getCastTime() * 0.5);
      if(this.castTimeProgress > 1){
        this.castTimeProgress = 1;
      }

      if(this.projectile && !this.projectileDistance){
        this.projectileDistance = this.projectileTarget.clone().sub(this.projectileOrigin);
        this.projectileCurve.v1.copy(this.projectileDistance).multiplyScalar(0.25).add(this.projectileOrigin);
        this.projectileCurve.v1.z += 2
      }

      if(this.spell.range != 'L'){
        this.impact();
      }

      if(this.projectile && this.projectileDistance){
        this.projectile.position.copy( this.projectileCurve.getPoint((1 - this.castTimeProgress)) );
      }

      this.castTime -= (1000 * delta);
      //this.casting = true;
    }else{
      this.conjuring = false;

      if(this.spell.range == 'L'){
        this.impact();
      }

      //I guess the spell is over now
      this.completed = true;
    }

    if(this.casthandmodel){
      this.casthandmodel.update(delta);
    }

    if(this.projectile){
      this.projectile.update(delta);
    }
  }  

  impact(){
    //We only want to run the impact script once
    if(this.impacted) return;
    this.impacted = true;

    // What the impact script asks for: GetSpellTargetObject reads the caster's
    // lastSpellTarget and GetSpellTargetLocation the talent's target. A power
    // chosen from a menu records both when queued (TalentSpell.useTalentOnObject);
    // an item cast — a thrown grenade — never did, so k_sup_grenade centred its
    // blast and its damage sphere on the world origin.
    if(this.spell){
      this.spell.oCaster = this.owner;
      if(this.target) this.spell.oTarget = this.target;
    }
    if(this.target && this.owner?.combatData){
      this.owner.combatData.lastSpellTarget = this.target;
    }
    if(this.owner && this.target?.combatData){
      this.target.combatData.lastSpellAttacker = this.owner;
    }

    if(this.impactscript){
      console.log('Casting spell', this.impactscript, this);
      const instance = GameState.NWScript.Load(this.impactscript);
      if(instance) {
        //pass the talent to the script instance and run it
        instance.talent = this.spell;
        //instance.spellTarget = oTarget;
        instance.run(this.owner, 0);
      };
    }

    if(this.casthandvisual){
      MDLLoader.loader.load(this.casthandvisual)
      .then((mdl: OdysseyModel) => {
        OdysseyModel3D.FromMDL(mdl, {
          context: this.owner.context
        }).then((model: OdysseyModel3D) => {
          this.casthandmodel = model;

          if(this.owner.model){
            if(this.owner.model.lhand){
              this.owner.model.lhand.add(this.casthandmodel);
              //TextureLoader.LoadQueue();

              const anim = this.casthandmodel.playAnimation('cast01', false);
              setTimeout(() => {
                //Clean up the impact effect
                this.casthandmodel.dispose();
              }, (anim ? anim.length * 1000 : 1500) )
            }else{
              this.casthandmodel.dispose();
            }
          }else{
            this.casthandmodel.dispose();
          }

        });
      });
    }

    if(this.projectile){
      this.projectile.dispose();
    }

  }

  dispose(){

    if(this.casthandmodel) this.casthandmodel.dispose();
    if(this.projectile) this.projectile.dispose();
    if(this.container) this.container.removeFromParent();
  }

}