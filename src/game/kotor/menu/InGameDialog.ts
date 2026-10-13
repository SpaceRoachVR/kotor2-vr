import { GameState } from "@/GameState";
import { GameMenu } from "@/gui";
import type { GUIListBox, GUILabel } from "@/gui";
import * as THREE from "three";
import { CutsceneMode } from "@/enums/dialog/CutsceneMode";
import { DLGNode } from "@/resource/DLGNode";
import { ConversationState } from "@/enums/dialog/ConversationState";
import { EngineMode } from "@/enums/engine/EngineMode";

const LETTERBOX_HEIGHT = 100;

/** Gap between the spoken line and the reply list in the VR world layout, in GUI pixels. */
const VR_WORLD_MESSAGE_GAP = 12;
/** Gap kept between the spoken line and the canvas edge. */
const MESSAGE_EDGE_MARGIN = 8;
/** Horizontal breathing room either side of the dialogue in the VR world crop. */
const VR_WORLD_REGION_MARGIN = 48;
/** Breathing room above the spoken line and below the last reply. */
const VR_WORLD_REGION_VERTICAL_MARGIN = 24;

/**
 * InGameDialog class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file InGameDialog.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class InGameDialog extends GameMenu {

  LBL_MESSAGE: GUILabel;
  LB_REPLIES: GUIListBox;

  /** Whether the VR world-conversation layout is currently applied. */
  vrWorldLayout: boolean = false;
  private lastTextListening: boolean = false;

  //letterbox
  canLetterbox: boolean;
  letterBoxed: boolean;
  topBar: THREE.Mesh;
  bottomBar: THREE.Mesh;

  constructor(){
    super();
    this.gui_resref = 'dialog';
    this.background = '';
    this.voidFill = false;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.LBL_MESSAGE.setText('');
      this.LBL_MESSAGE.setTextColor(this.LBL_MESSAGE.defaultColor.r, this.LBL_MESSAGE.defaultColor.g, this.LBL_MESSAGE.defaultColor.b);

      this.LB_REPLIES.extent.left = -(GameState.ResolutionManager.getViewportWidth()/2) + this.LB_REPLIES.extent.width/2 + 16;
      this.LB_REPLIES.extent.top = (GameState.ResolutionManager.getViewportHeight()/2) - this.LB_REPLIES.extent.height/2;
      this.LB_REPLIES.calculatePosition();
      this.LB_REPLIES.calculateBox();
      this.LB_REPLIES.onSelected = (entry: DLGNode, control: any, index: number) => {
        GameState.CutsceneManager.selectReplyAtIndex(index);
      }

      const geometry = new THREE.PlaneGeometry( 1, 1, 1 );
      const material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.FrontSide });
      this.topBar = new THREE.Mesh( geometry, material );
      this.bottomBar = new THREE.Mesh( geometry, material );

      this.resetLetterBox();

      this.tGuiPanel.widget.add(this.topBar);
      this.tGuiPanel.widget.add(this.bottomBar);
      resolve();
    });
  }

  show(){
    super.show();
    GameState.SetEngineMode(EngineMode.DIALOG);
  }

  setReplies(replies: DLGNode[]) {
    const texts = replies
      .filter(r => !r.isContinueDialog())
      .map((r, i) => (i + 1) + '. ' + r.getCompiledString());
    this.LB_REPLIES.setItems(texts);
    this.fitVRWorldReplies();
  }

  /** The list's authored height, restored outside the VR world layout. */
  private authoredRepliesHeight: number | null = null;

  /**
   * In the VR world layout the reply list grows to show every reply: the
   * authored box held 4 of HK-50's 6, with a scrollbar that didn't scroll
   * (critic runs 15-20). Capped at 45% of the canvas, after which it scrolls.
   */
  fitVRWorldReplies(){
    try{
      const list = this.LB_REPLIES;
      if(!list?.extent) return;
      if(this.authoredRepliesHeight === null) this.authoredRepliesHeight = list.extent.height;
      const authored = this.authoredRepliesHeight;
      const wanted = this.vrWorldLayout
        ? Math.min(Math.max(authored, Math.ceil(list.getContentHeight())), Math.floor(GameState.ResolutionManager.getViewportHeight() * 0.45))
        : authored;
      if(Math.abs(wanted - list.extent.height) < 1) return;
      list.extent.height = wanted;
      list.resizeControl();
      this.positionReplies();
      this.updateTextPosition(this.lastTextListening);
    }catch(e){
      console.warn('InGameDialog: fitting the VR reply list failed', e);
    }
  }

  setDialogMode(state: ConversationState) {
    if(state == ConversationState.LISTENING_TO_SPEAKER){
      this.LBL_MESSAGE.setText(GameState.CutsceneManager.lastSpokenString);
      this.LB_REPLIES.hide();
      this.LB_REPLIES.setItems([]);
      this.updateTextPosition(true);
    }else{
      this.updateTextPosition(false);
      this.LB_REPLIES.show();
      this.LB_REPLIES.updateList();
    }
  }

  update(delta: number = 0) {
    super.update(delta);
    this.updateVRWorldLayout();
    this.updateLetterBox(delta);
  }

  /**
   * In VR a conversation held in the world shows only the lower part of this
   * menu. The retail layout puts the spoken line at the top of the screen and
   * the replies in the bottom-left corner — 27 degrees off to the side at the
   * panel's distance — so the world layout centres the replies and seats the
   * line just above them. Toggled per shot: the theater composites this same
   * menu over an authored camera, and there the retail layout is right.
   */
  updateVRWorldLayout(){
    const active = GameState.vrDialogWorldPresentation === true;
    if(active === this.vrWorldLayout) return;
    this.vrWorldLayout = active;
    this.positionReplies();
    this.fitVRWorldReplies();
    this.updateTextPosition(this.lastTextListening);
  }

  /**
   * The canvas region the VR panel shows for a world conversation: the bottom
   * half, trimmed to the width of the dialogue itself.
   */
  getVRWorldDialogueRegion(){
    const viewportWidth = GameState.ResolutionManager.getViewportWidth();
    const contentWidth = Math.max(this.LB_REPLIES?.extent?.width ?? 0, this.LBL_MESSAGE?.extent?.width ?? 0) +
      VR_WORLD_REGION_MARGIN * 2;
    const widthFraction = Math.min(1, Math.max(0.2, contentWidth / Math.max(1, viewportWidth)));
    const { vMin, vMax } = this.getVRWorldDialogueVerticalExtent();
    return {
      uMin: 0.5 - widthFraction / 2,
      uMax: 0.5 + widthFraction / 2,
      vMin,
      vMax,
    };
  }

  /**
   * The rows the dialogue actually uses, top of the spoken line to the last
   * reply, in panel UVs (0 = bottom). The whole bottom half was shown, so the
   * plate was half empty and twice the size it needed to be over the speaker
   * (critic runs 12-17).
   */
  private getVRWorldDialogueVerticalExtent(): { vMin: number, vMax: number } {
    const fallback = { vMin: 0, vMax: 0.5 };
    try{
      const viewportHeight = GameState.ResolutionManager.getViewportHeight();
      if(!(viewportHeight > 0)) return fallback;
      let top = -Infinity;
      let bottom = Infinity;
      const box = this.LBL_MESSAGE?.box;
      if(this.LBL_MESSAGE?.text?.text && box && Number.isFinite(box.max.y) && Number.isFinite(box.min.y)){
        top = Math.max(top, box.max.y);
        bottom = Math.min(bottom, box.min.y);
      }
      if(this.LB_REPLIES?.isVisible?.() && this.LB_REPLIES.children.length){
        const listTop = this.LB_REPLIES.widget.position.y + this.LB_REPLIES.extent.height / 2;
        const used = Math.min(this.LB_REPLIES.getContentHeight(), this.LB_REPLIES.extent.height);
        top = Math.max(top, listTop);
        bottom = Math.min(bottom, listTop - used);
      }
      if(!Number.isFinite(top) || !Number.isFinite(bottom) || top <= bottom) return fallback;
      const toV = (y: number) => Math.min(1, Math.max(0, (y + viewportHeight / 2) / viewportHeight));
      const vMin = toV(bottom - VR_WORLD_REGION_VERTICAL_MARGIN);
      const vMax = toV(top + VR_WORLD_REGION_VERTICAL_MARGIN);
      // Quantised so the plate doesn't resize for every pixel of text change.
      const q = (v: number) => Math.round(v * 40) / 40;
      const min = Math.max(0, q(vMin) - (q(vMin) > vMin ? 0.025 : 0));
      const max = Math.min(1, q(vMax) + (q(vMax) < vMax ? 0.025 : 0));
      return max - min >= 0.075 ? { vMin: min, vMax: max } : fallback;
    }catch(e){
      return fallback;
    }
  }

  private positionReplies(){
    this.LB_REPLIES.extent.left = this.vrWorldLayout
      ? 0
      : -(GameState.ResolutionManager.getViewportWidth() / 2) + this.LB_REPLIES.extent.width / 2 + 16;
    this.LB_REPLIES.extent.top = GameState.ResolutionManager.getViewportHeight() / 2 - this.LB_REPLIES.extent.height / 2;
    this.LB_REPLIES.calculatePosition();
    this.LB_REPLIES.calculateBox();
  }

  updateLetterBox(delta: number = 0){
    // In VR a conversation is a floating subtitle panel in the world; the
    // cinema letterbox would draw two black slabs across it.
    if(this.topBar && this.bottomBar){
      this.topBar.visible = this.bottomBar.visible = !GameState.vrDialogWorldPresentation;
    }
    if(!this.canLetterbox || this.letterBoxed) return;

    if (GameState.CutsceneManager.cutsceneMode == CutsceneMode.ANIMATED) {
      this.bottomBar.position.y = -(GameState.ResolutionManager.getViewportHeight() / 2) + LETTERBOX_HEIGHT / 2;
      this.topBar.position.y = GameState.ResolutionManager.getViewportHeight() / 2 - LETTERBOX_HEIGHT / 2;
      this.letterBoxed = true;
      this.LBL_MESSAGE.show();
      return;
    }
    
    if (this.bottomBar.position.y < -(GameState.ResolutionManager.getViewportHeight() / 2) + LETTERBOX_HEIGHT / 2) {
      this.bottomBar.position.y += 5;
      this.topBar.position.y -= 5;
      this.LBL_MESSAGE.hide();
    } else {
      this.bottomBar.position.y = -(GameState.ResolutionManager.getViewportHeight() / 2) + LETTERBOX_HEIGHT / 2;
      this.topBar.position.y = GameState.ResolutionManager.getViewportHeight() / 2 - LETTERBOX_HEIGHT / 2;
      this.letterBoxed = true;
      this.LBL_MESSAGE.show();
    }
  }

  /** Where the text mesh sits relative to the label widget (y, GUI units). */
  private getMessageTextOffsetY(): number {
    const widget = this.LBL_MESSAGE.widget;
    let offset = 0;
    let node: THREE.Object3D | null = this.LBL_MESSAGE.text.mesh;
    for (; node && node !== widget; node = node.parent) {
      offset += node.position.y;
    }
    // Not attached under the widget yet: the label lays text out from its top.
    return node === widget ? offset : this.LBL_MESSAGE.extent.height / 2;
  }

  updateTextPosition(isListening: boolean = false) {
    this.lastTextListening = isListening;
    if (typeof this.LBL_MESSAGE.text.geometry !== 'undefined') {
      this.LBL_MESSAGE.text.geometry.computeBoundingBox();
      let bb = this.LBL_MESSAGE.text.geometry.boundingBox;
      let width = Math.abs(bb.min.x) + Math.abs(bb.max.x);
      // The text is not centred on the widget: its geometry hangs down from
      // y = 0 and the mesh sits half the label's height above the widget, so a
      // long line grows downward from a fixed top. Placing the widget as if the
      // text were centred put the cinematic caption's first line on the top
      // edge of the image (cut off in the theater) and ran long world-dialogue
      // lines off the bottom of the panel (headset round 17).
      const viewportHeight = GameState.ResolutionManager.getViewportHeight();
      const offset = this.getMessageTextOffsetY();
      const textTop = offset + bb.max.y;
      const textBottom = offset + bb.min.y;
      const edge = viewportHeight / 2 - MESSAGE_EDGE_MARGIN;
      let y: number;
      if (isListening) {
        // Centred 50 above the bottom edge, never past it.
        y = Math.max(-viewportHeight / 2 + 50 - (textTop + textBottom) / 2, -edge - textBottom);
      } else if (this.vrWorldLayout) {
        // Directly above the reply list, and never above the middle of the
        // canvas: the VR panel shows only the lower half.
        const repliesTop = this.LB_REPLIES.widget.position.y + this.LB_REPLIES.extent.height / 2;
        y = Math.min(
          repliesTop + VR_WORLD_MESSAGE_GAP - textBottom,
          -VR_WORLD_MESSAGE_GAP - textTop,
        );
        y = Math.max(y, -edge - textBottom);
      } else {
        // Centred 50 below the top edge, never past it.
        y = Math.min(viewportHeight / 2 - 50 - (textTop + textBottom) / 2, edge - textTop);
      }
      this.LBL_MESSAGE.widget.position.y = y;
      this.LBL_MESSAGE.box = new THREE.Box2(new THREE.Vector2(this.LBL_MESSAGE.widget.position.x - width / 2, y + textBottom), new THREE.Vector2(this.LBL_MESSAGE.widget.position.x + width / 2, y + textTop));
    }
  }

  resize() {
    this.resetLetterBox();
    this.recalculatePosition();
    this.updateTextPosition();
  }

  recalculatePosition() {
    this.positionReplies();
    this.resetLetterBox();
  }

  resetLetterBox() {
    this.letterBoxed = false;
    this.topBar.scale.x = this.bottomBar.scale.x = GameState.ResolutionManager.getViewportWidth();
    this.topBar.scale.y = this.bottomBar.scale.y = LETTERBOX_HEIGHT;
    if (!this.letterBoxed) {
      this.topBar.position.y = GameState.ResolutionManager.getViewportHeight() / 2 + LETTERBOX_HEIGHT / 2;
      this.bottomBar.position.y = -this.topBar.position.y;
    } else {
      this.bottomBar.position.y = -(GameState.ResolutionManager.getViewportHeight() / 2) + LETTERBOX_HEIGHT / 2;
      this.topBar.position.y = GameState.ResolutionManager.getViewportHeight() / 2 - LETTERBOX_HEIGHT / 2;
    }
  }

  triggerControllerAPress() {
    if(!this.LB_REPLIES.isVisible()) return;
    if (!this.LB_REPLIES.selectedItem) return;
    this.LB_REPLIES.selectedItem.click();
  }

  triggerControllerDUpPress() {
    if(!this.LB_REPLIES.isVisible()) return;
    this.LB_REPLIES.directionalNavigate('up');
  }

  triggerControllerDDownPress() {
    if(!this.LB_REPLIES.isVisible()) return;
    this.LB_REPLIES.directionalNavigate('down');
  }
  
}
