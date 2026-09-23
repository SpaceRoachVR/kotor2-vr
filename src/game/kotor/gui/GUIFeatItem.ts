import { GUIProtoItem, GUIButton } from "@/gui";
import type { GUIControl, GameMenu } from "@/gui";
import * as THREE from "three";
import { TextureType } from "@/enums/loaders/TextureType";
import { OdysseyTexture } from "@/three/odyssey/OdysseyTexture";
import type { GFFStruct } from "@/resource/GFFStruct";
import { GameState } from "@/GameState";
import { TextureLoader } from "@/loaders";
import { resolveGUIFeatActor } from "@/game/kotor/gui/resolveGUIFeatActor";

/**
 * GUIFeatItem class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file GUIFeatItem.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class GUIFeatItem extends GUIProtoItem {

  /** Stops a fill drawing while it has no texture; see the call sites. */
  static hideFill(material: THREE.Material | undefined): void {
    if(!material) return;
    const shader = material as THREE.ShaderMaterial;
    if(shader.uniforms?.opacity) shader.uniforms.opacity.value = 0;
    (material as any).opacity = 0;
    material.transparent = true;
    material.needsUpdate = true;
  }

  /** Reveals a fill once its texture has actually loaded. */
  static showFill(material: THREE.Material | undefined): void {
    if(!material) return;
    const shader = material as THREE.ShaderMaterial;
    if(shader.uniforms?.opacity) shader.uniforms.opacity.value = 1;
    (material as any).opacity = 1;
    material.needsUpdate = true;
  }


  private static missingActorWarningLogged = false;

  constructor(menu: GameMenu, control: GFFStruct, parent: GUIControl = null as any, scale = false){
    super(menu, control, parent, scale);
    this.disableSelection = true;
    this.extent.height = 48;
  }

  buildFill(){}
  buildBorder(){}
  buildHighlight(){}
  buildText(){}

  createControl(){
    try{
      super.createControl();
      //Create the actual control elements below

      const actor = resolveGUIFeatActor(this.menu, GameState.getCurrentPlayer());
      if (!actor) {
        if (!GUIFeatItem.missingActorWarningLogged) {
          GUIFeatItem.missingActorWarningLogged = true;
          console.warn('GUIFeatItem: no feat actor is available for this menu');
        }
        return this.widget;
      }

      let featList = this.node;
      let spacing = 5;
      for(let i = 0; i < featList.length; i++){
        let feat = featList[i];

        // feats.2da carries padding rows, so a filtered list can contain holes.
        // One undefined entry threw here and aborted the whole list build,
        // leaving the Abilities screen empty — reported from a headset session
        // opening Abilities from the VR action wheel.
        if(!feat) continue;

        const prereqFeat1 = Number(feat.prereqFeat1);
        const prereqFeat2 = Number(feat.prereqFeat2);
        const featId = Number(feat.id);
        if (!Number.isInteger(featId)) continue;
        let hasPrereqfeat1 = (!Number.isInteger(prereqFeat1) || prereqFeat1 < 0 || actor.getHasFeat(prereqFeat1));
        let hasPrereqfeat2 = (!Number.isInteger(prereqFeat2) || prereqFeat2 < 0 || actor.getHasFeat(prereqFeat2));
        let hasFeat = actor.getHasFeat(featId);


        // On a SELECTION screen the menu decides how a feat reads — see
        // CharGenFeats.getFeatPresentation. Without that contract this keeps its
        // original meaning: the Abilities screen reviews what a character holds,
        // so "not held" genuinely is not shown there.
        const presentation = typeof (this.menu as any)?.getFeatPresentation === 'function'
          ? (this.menu as any).getFeatPresentation(feat)
          : null;
        let locked = presentation
          ? false
          : (!hasFeat || (!hasPrereqfeat1 || !hasPrereqfeat2));
        // Dimmed rather than hidden. A feat that cannot be taken yet still has
        // to be visible, or the grid shows only what is already owned and there
        // is nothing to choose between.
        const iconOpacity = presentation
          ? (presentation.state === 'unavailable' ? 0.25 : 1.0)
          : 1.0;
        const marksOwned = !!presentation && presentation.state === 'owned';

        let buttonIcon = new GUIButton(this.menu, this.control, this, this.scale);
        buttonIcon.setText('');
        buttonIcon.disableTextAlignment();
        buttonIcon.extent.width = 56;
        buttonIcon.extent.height = 56;
        buttonIcon.extent.top = 0;
        buttonIcon.extent.left = 0;
        buttonIcon.hasBorder = false;
        buttonIcon.hasHighlight = false;
        buttonIcon.hasText = false;
        buttonIcon.autoCalculatePosition = false;
        this.children.push(buttonIcon);

        let _buttonIconWidget = buttonIcon.createControl();
        switch(i){
          case 2:
            _buttonIconWidget.position.x = (this.extent.width/2 - buttonIcon.extent.width/2);
          break;
          case 1:
            _buttonIconWidget.position.x = 0;
          break;
          default:
            _buttonIconWidget.position.x = -(this.extent.width/2 - buttonIcon.extent.width/2);
          break;
        }
        _buttonIconWidget.position.y = 0;
        _buttonIconWidget.position.z = this.zIndex + 1;

        this.widget.add(_buttonIconWidget);

        // `lbl_indent` is a K1 resref. TSL ships no such texture and authors no
        // fill for these rows either, so the load simply fails there and the
        // callback below never runs — leaving these materials at their default
        // opaque white, which is what the feat grid rendered as. Hide them
        // first and let a successful load reveal them, so K1 is unchanged and
        // TSL draws nothing, as retail does.
        //
        // The row's OWN fill needs the same treatment. `GUIControl.createControl`
        // only enqueues a fill when the GUI file names one, and TSL names none
        // here, so nothing ever touches this material — it is the mesh the
        // scene graph reports as `PROTOITEM center fill`, map null, opacity 1.
        GUIFeatItem.hideFill(this.border.fill.material);
        GUIFeatItem.hideFill(this.highlight.fill.material);
        GUIFeatItem.hideFill(buttonIcon.border.fill.material);
        GUIFeatItem.hideFill(buttonIcon.highlight.fill.material);
        // The button's own fill has no authored texture in TSL either, so it
        // drew as a plain white square behind each feat icon.
        GUIFeatItem.hideFill(buttonIcon.getFill()?.material as THREE.Material);
        TextureLoader.enQueue('lbl_indent', this.border.fill.material, TextureType.TEXTURE, (texture: OdysseyTexture) => {
          if(!texture) return;
          buttonIcon.setMaterialTexture( buttonIcon.border.fill.material, texture);
          buttonIcon.border.fill.material.transparent = true;
          buttonIcon.setMaterialTexture( buttonIcon.highlight.fill.material, texture);
          buttonIcon.highlight.fill.material.transparent = true;
          GUIFeatItem.showFill(buttonIcon.border.fill.material);
          GUIFeatItem.showFill(buttonIcon.highlight.fill.material);
          GUIFeatItem.showFill(buttonIcon.getFill()?.material as THREE.Material);
          // K1 does have this texture, so restore the row's own fill there.
          GUIFeatItem.showFill(this.border.fill.material);
          GUIFeatItem.showFill(this.highlight.fill.material);
          if(locked){
            (buttonIcon.getFill().material as THREE.ShaderMaterial).uniforms.opacity.value = 0.00;
          }else{
            (buttonIcon.getFill().material as THREE.ShaderMaterial).uniforms.opacity.value = iconOpacity;
            // A feat the character already holds keeps its frame drawn, so
            // "taken" reads differently from "available to take".
            if(marksOwned) buttonIcon.showBorder();
          }
          this.list?.markListRttDirty?.();
        });

        // On a selection screen a click selects (see
        // CharGenFeats.selectFeatFromList). Elsewhere a click highlights the
        // feat, reported the same way as hover so the description panel and
        // the Select button can never be looking at different feats.
        buttonIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          const select = (this.menu as any)?.selectFeatFromList;
          if(typeof select === 'function'){
            // Deferred: selecting rebuilds the whole grid, which would destroy
            // this control while its own click event is still dispatching.
            const menu = this.menu;
            setTimeout(() => select.call(menu, feat), 0);
            return;
          }
          const highlight = (this.menu as any)?.highlightFeat;
          if(typeof highlight === 'function') highlight.call(this.menu, feat);
        });

        // Selection state frame. TSL ships no `lbl_indent`, so the authored
        // border that K1 uses to mark an owned feat never draws there, and the
        // grid gave no sign of which feat was chosen or already held —
        // reported as needing "a highlight to show the selected feat" and "a
        // different highlight for already owned feats". Drawn from primitives
        // so it does not depend on any texture: gold for the feat last clicked,
        // green for a pick made on this screen, steel blue for a feat held.
        if(presentation){
          const frameColour = presentation.highlighted ? 0xf2c14e
            : presentation.picked ? 0x46c46e
            : presentation.state === 'owned' ? 0x6f8fb0
            : null;
          if(frameColour !== null){
            const frameSize = (buttonIcon.extent.width || 56) + 8;
            const frame = new THREE.Mesh(
              new THREE.PlaneGeometry(frameSize, frameSize),
              new THREE.MeshBasicMaterial({ color: frameColour, transparent: true, opacity: presentation.highlighted ? 0.95 : 0.8, depthTest: false }),
            );
            frame.name = 'FEAT_SELECTION_FRAME';
            frame.position.z = 4;
            frame.renderOrder = 4;
            _buttonIconWidget.add(frame);
          }
        }

        // The feats screen has a Description panel and a name label that
        // nothing ever wrote to. Report the feat under the pointer so the menu
        // can fill them; the item itself stays ignorant of which menu it is in.
        buttonIcon.addEventListener('hover', () => {
          const describe = (this.menu as any)?.describeFeat;
          if(typeof describe === 'function') describe.call(this.menu, feat);
        });

        /* FEAT ICON */

        this.widget.userData.iconMaterial = new THREE.SpriteMaterial( { map: null, color: 0xffffff } );
        this.widget.userData.iconSprite = new THREE.Sprite( this.widget.userData.iconMaterial );

        this.widget.userData.iconSprite.scale.x = 32;
        this.widget.userData.iconSprite.scale.y = 32;
        this.widget.userData.iconSprite.position.z = 5;
        this.widget.userData.iconSprite.renderOrder = 5;
        TextureLoader.enQueue(feat.icon, this.widget.userData.iconMaterial, TextureType.TEXTURE, (texture: OdysseyTexture) => {
          if(!texture) return;
          // Size the icon from the SLOT, not the texture. Retail icons are 32x32
          // so the two agreed, but a texture-replacement mod ships the same icon
          // at a higher resolution and this drew it at that size — one UCO Redux
          // icon rendered several times its slot and spilled outside the grid.
          this.widget.userData.iconSprite.scale.x = buttonIcon.extent.width || 32;
          this.widget.userData.iconSprite.scale.y = buttonIcon.extent.height || 32;
          if(locked){
            this.widget.userData.iconMaterial.opacity = 0.00;
          }else{
            // A selection screen dims what cannot be taken yet instead of
            // hiding it, so "available" and "already taken" are both legible.
            this.widget.userData.iconMaterial.opacity = iconOpacity;
          }
          this.widget.userData.iconMaterial.transparent = true;
          this.widget.userData.iconMaterial.needsUpdate = true;
          // The list draws its rows into a render target that is published
          // once. Texture loads finish *after* that publish, so the icons
          // arrived into a scene nobody re-rendered and the list kept showing
          // the pre-load frame — untextured white squares — indefinitely.
          // Every other thing that changes a row's appearance marks the list
          // dirty; a late texture has to as well.
          this.list?.markListRttDirty?.();
        });

        _buttonIconWidget.add(this.widget.userData.iconSprite);

        /*
        * BLUE ARROW
        */
        
        let arrowOffset = (this.extent.width/2 - buttonIcon.extent.width/2)/2;
        if(i > 0){
          let arrowIcon = new GUIButton(this.menu, this.control, this, this.scale);
          arrowIcon.setText('');
          arrowIcon.disableTextAlignment();
          arrowIcon.extent.width = 32;
          arrowIcon.extent.height = 32;
          arrowIcon.extent.top = 0;
          arrowIcon.extent.left = 0;
          arrowIcon.hasBorder = false;
          arrowIcon.hasHighlight = false;
          arrowIcon.disableBorder();
          arrowIcon.disableHighlight();
          arrowIcon.hasText = false;
          arrowIcon.autoCalculatePosition = false;
          this.children.push(arrowIcon);

          let _arrowIconWidget = arrowIcon.createControl();
          switch(i){
            case 2:
              _arrowIconWidget.position.x = arrowOffset;
            break;
            case 1:
              _arrowIconWidget.position.x = -arrowOffset;
            break;
          }
          _arrowIconWidget.position.y = 0;
          _arrowIconWidget.position.z = this.zIndex + 1;

          this.widget.add(_arrowIconWidget);

          // Same as `lbl_indent` above: a K1 resref TSL does not ship.
          GUIFeatItem.hideFill(arrowIcon.border.fill.material);
          GUIFeatItem.hideFill(arrowIcon.highlight.fill.material);
          GUIFeatItem.hideFill(arrowIcon.getFill()?.material as THREE.Material);
          TextureLoader.enQueue('lbl_skarr', this.border.fill.material, TextureType.TEXTURE, (texture: OdysseyTexture) => {
            if(!texture) return;
            arrowIcon.setMaterialTexture( arrowIcon.border.fill.material, texture);
            arrowIcon.border.fill.material.transparent = true;
            arrowIcon.setMaterialTexture( arrowIcon.highlight.fill.material, texture);
            arrowIcon.highlight.fill.material.transparent = true;
            GUIFeatItem.showFill(arrowIcon.border.fill.material);
            GUIFeatItem.showFill(arrowIcon.highlight.fill.material);
            if(locked){
              arrowIcon.border.fill.material.uniforms.opacity.value = 0.25;
              arrowIcon.highlight.fill.material.uniforms.opacity.value = 0.25;
            }
            this.list?.markListRttDirty?.();
          });

          //lbl_skarr
        }

      }
      return this.widget;
    }catch(e){
      console.error(e);
    }
    return this.widget;

  }

}
