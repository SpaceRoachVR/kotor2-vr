import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { Action } from "@/actions/Action";
import { ItemCastSpellParameter } from "@/actions/ItemCastSpellParameters";
import { isItemCastSpellSourceUsable } from "@/actions/ItemCastSpellValidation";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { GameState } from "@/GameState";
import { SpellCastInstance } from "@/combat";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
import { BitWise } from "@/utility/BitWise";
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

    if (!BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature)) {
      return ActionStatus.FAILED;
    }
    if (!BitWise.InstanceOfObject(target, ModuleObjectType.ModuleObject) || target.isDead()) {
      return ActionStatus.FAILED;
    }
    if (!Number.isSafeInteger(spellId) || spellId < 0) {
      return ActionStatus.FAILED;
    }

    const owner = this.owner as ModuleCreature;
    if (!isItemCastSpellSourceUsable({
      sourceItem: item,
      requestedSpellId: spellId,
      isOwnedByCaster: (candidate) => this.isSourceItemOwnedBy(owner, candidate),
      castSpellPropertyType: ModuleItemProperty.CastSpell,
    })) {
      return ActionStatus.FAILED;
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
      return this.moveIntoCastRange(owner, target);
    }

    owner.force = 0;
    owner.speed = 0;
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

  private isSourceItemOwnedBy(owner: ModuleCreature, candidate: unknown): boolean {
    if (!candidate) {
      return false;
    }
    const party = GameState.PartyManager?.party;
    if (Array.isArray(party) && party.includes(owner)) {
      return Array.isArray(GameState.InventoryManager?.inventory) &&
        GameState.InventoryManager.inventory.includes(candidate as ModuleItem);
    }
    return Array.isArray(owner.inventory) && owner.inventory.includes(candidate as ModuleItem);
  }

  private consumeSourceItem(owner: ModuleCreature, item: ModuleItem): void {
    const party = GameState.PartyManager?.party;
    if (Array.isArray(party) && party.includes(owner)) {
      GameState.InventoryManager.removeItem(item, 1);
      return;
    }
    owner.removeItem(item, 1);
  }

}
