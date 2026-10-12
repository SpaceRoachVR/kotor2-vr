import { canUseWornItemCast, resolveItemCastUseLimit, spendWornItemCast, type ItemCastUseClock, type ItemCastUseLimit, type ItemCastUseState } from "@/actions/ItemCastUseLimit";
import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { Action } from "@/actions/Action";
import { ItemCastSpellParameter } from "@/actions/ItemCastSpellParameters";
import { isItemCastSpellSourceUsable } from "@/actions/ItemCastSpellValidation";
import { releaseUnstartedItemCastCombatAction } from "@/actions/ItemCastSpellRoundCleanup";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { GameState } from "@/GameState";
import { SpellCastInstance } from "@/combat";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
import { BitWise } from "@/utility/BitWise";
import { ActionApproachPolicy } from "@/engine/interaction/ActionApproachPolicy";
import type { ModuleCreature, ModuleItem, ModuleObject } from "@/module";

/**
 * ActionItemCastSpell class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionItemCastSpell.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionItemCastSpell extends Action {

  spell: any = undefined;

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionItemCastSpell;

  }

  update(delta: number = 0): ActionStatus {
    const target = this.getParameter<ModuleObject>(ItemCastSpellParameter.Target);
    const item = this.getParameter<ModuleItem>(ItemCastSpellParameter.Item);
    const spellId = this.getParameter<number>(ItemCastSpellParameter.SpellId);

    if (!BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature)) return ActionStatus.FAILED;
    const owner = this.owner as ModuleCreature;
    if (!BitWise.InstanceOfObject(target, ModuleObjectType.ModuleObject) || target.isDead()) {
      return this.rejectItemCast(owner, 'target gone');
    }
    if (!Number.isSafeInteger(spellId) || spellId < 0) {
      return this.rejectItemCast(owner, 'item cast rejected');
    }

    if (!isItemCastSpellSourceUsable({
      sourceItem: item,
      requestedSpellId: spellId,
      isOwnedByCaster: (candidate) => this.isSourceItemOwnedBy(owner, candidate),
      castSpellPropertyType: ModuleItemProperty.CastSpell,
    })) {
      return this.rejectItemCast(owner, 'item unavailable');
    }

    const combatRound = owner.combatRound;
    if (!combatRound) {
      return ActionStatus.FAILED;
    }
    if (combatRound.roundPaused) {
      return ActionStatus.IN_PROGRESS;
    }

    this.spell = new GameState.TalentSpell(spellId);
    if (!this.spell || !this.spell.inRange(target, owner)) {
      const moveStatus = this.moveIntoCastRange(owner, target);
      return moveStatus === ActionStatus.FAILED ? this.rejectItemCast(owner, 'out of throw range') : moveStatus;
    }

    // VR moves the player from the stick, which sets force every frame; zeroing it here rooted a player strafing while an attack or cast waited for its round (critic run 4).
    if (!ActionApproachPolicy.isApproachSuppressedFor(owner)) {
      owner.force = 0;
      owner.speed = 0;
    }
    combatRound.beginCombatRound();
    combatRound.pauseRound(owner, combatRound.roundLength);
    if (combatRound.action) {
      combatRound.action.animation = ModuleCreatureAnimState.CASTOUT1;
    }
    if (!combatRound.roundStarted) {
      return ActionStatus.IN_PROGRESS;
    }

    const spellCastInstance = new SpellCastInstance(owner, target, this.spell);
    owner.area.attachSpellInstance(spellCastInstance);
    spellCastInstance.init();
    this.consumeSourceItem(owner, item);
    return ActionStatus.COMPLETE;
  }

  private moveIntoCastRange(owner: ModuleCreature, target: ModuleObject): ActionStatus {
    if (!this.spell || !target?.position || !target.area) {
      return ActionStatus.FAILED;
    }
    // VR owns the player's position; walking them into cast range drags the
    // rig through the world. Same actor-scoped rule as every other approach.
    // Failing (rather than waiting) releases the unstarted round action.
    if (ActionApproachPolicy.isApproachSuppressedFor(owner)) {
      return ActionStatus.FAILED;
    }

    const actionMoveToTarget = new GameState.ActionFactory.ActionMoveToPoint(this.groupId);
    actionMoveToTarget.setParameter(0, ActionParameterType.FLOAT, target.position.x);
    actionMoveToTarget.setParameter(1, ActionParameterType.FLOAT, target.position.y);
    actionMoveToTarget.setParameter(2, ActionParameterType.FLOAT, target.position.z);
    actionMoveToTarget.setParameter(3, ActionParameterType.DWORD, target.area.id);
    actionMoveToTarget.setParameter(4, ActionParameterType.DWORD, target.id || ModuleObjectConstant.OBJECT_INVALID);
    actionMoveToTarget.setParameter(5, ActionParameterType.INT, 1);
    actionMoveToTarget.setParameter(6, ActionParameterType.FLOAT, this.spell.getCastRange());
    actionMoveToTarget.setParameter(7, ActionParameterType.INT, 0);
    actionMoveToTarget.setParameter(8, ActionParameterType.FLOAT, 30.0);
    owner.actionQueue.addFront(actionMoveToTarget);
    return ActionStatus.IN_PROGRESS;
  }

  private rejectItemCast(owner: ModuleCreature, reason = 'item cast rejected'): ActionStatus {
    // A scheduled cast that dies at release (the target moved out of range,
    // the item is gone) used to vanish silently; VR plays its refusal cue
    // (critic run 4). See GameState.onItemCastRejected.
    try { GameState.onItemCastRejected?.(owner, this.getParameter<ModuleItem>(ItemCastSpellParameter.Item), reason); } catch { /* feedback is best effort */ }
    releaseUnstartedItemCastCombatAction(owner.combatRound);
    return ActionStatus.FAILED;
  }

  private isSourceItemOwnedBy(owner: ModuleCreature, candidate: unknown): boolean {
    if (!candidate) {
      return false;
    }
    // A worn item with an activate property (a belt, an implant) is used in
    // place. Only the bag counted, so it could never be used (critic runs 3
    // and 4). One with charges needs one left.
    if (isWornBy(owner, candidate)) {
      const item = candidate as ModuleItem;
      // The property's own retail limit (iprp_chargecost): charges per use,
      // uses per day, once per N minutes, or unlimited (critic run 5).
      const limit = this.wornCastLimit(item);
      // No CastSpell property for this spell on the item: nothing to use.
      // Treating the miss as "single use" destroyed the item (critic run 6).
      if (!limit) return false;
      return canUseWornItemCast(limit, wornCastState(item), wornCastClock());
    }
    const party = GameState.PartyManager?.party;
    if (Array.isArray(party) && party.includes(owner)) {
      return Array.isArray(GameState.InventoryManager?.inventory) &&
        GameState.InventoryManager.inventory.includes(candidate as ModuleItem);
    }
    return Array.isArray(owner.inventory) && owner.inventory.includes(candidate as ModuleItem);
  }

  private wornCastLimit(item: ModuleItem): ItemCastUseLimit | null {
    const spellId = this.getParameter<number>(ItemCastSpellParameter.SpellId);
    const property = (item.properties || []).find((p: any) =>
      p && p.propertyName === ModuleItemProperty.CastSpell && Number(p.subType) === Number(spellId));
    if (!property) return null;
    return resolveItemCastUseLimit(Number((property as any).costValue));
  }

  private consumeSourceItem(owner: ModuleCreature, item: ModuleItem): void {
    // Worn: spend a charge if it has them, never the item itself.
    if (isWornBy(owner, item)) {
      const state = wornCastState(item);
      const limit = this.wornCastLimit(item);
      if (!limit) return;
      const spent = spendWornItemCast(limit, state, wornCastClock());
      item.charges = state.charges;
      if (spent && typeof (owner as any).takeOffWornItem === 'function') (owner as any).takeOffWornItem(item);
      return;
    }
    const party = GameState.PartyManager?.party;
    if (Array.isArray(party) && party.includes(owner)) {
      GameState.InventoryManager.removeItem(item, 1);
      return;
    }
    owner.removeItem(item, 1);
  }

}

function isWornBy(owner: ModuleCreature, candidate: unknown): boolean {
  const equipment = (owner as any)?.equipment;
  if (!equipment || !candidate) return false;
  return Object.values(equipment).includes(candidate);
}

function wornCastState(item: ModuleItem): ItemCastUseState {
  const holder = item as any;
  if (!holder.wornCastUseState) holder.wornCastUseState = { charges: Number(item.charges) || 0 };
  holder.wornCastUseState.charges = Number(item.charges) || 0;
  return holder.wornCastUseState;
}

function wornCastClock(): ItemCastUseClock {
  const day = Number((GameState.module as any)?.timeManager?.pauseDay) || 0;
  return { day, nowMs: typeof performance !== 'undefined' ? performance.now() : Date.now() };
}
