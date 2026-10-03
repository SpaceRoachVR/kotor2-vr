import { GameState } from "@/GameState";
import type { GUIListBox, GUILabel, GUIButton } from "@/gui";
import type { ModuleCreature } from "@/module/ModuleCreature";
import { MenuAbilities as K1_MenuAbilities } from "@/game/kotor/KOTOR";
import { GUICreatureSkill } from "@/game/tsl/gui/GUICreatureSkill";
import { GUISpellItem } from "@/game/tsl/gui/GUISpellItem";
import { GUIFeatItem } from "@/game/tsl/gui/GUIFeatItem";
import { type TalentFeat } from "@/talents/TalentFeat";

enum AbilityFilter {
  SKILLS = 1,
  POWERS = 2,
  FEATS = 3
}

/**
 * MenuAbilities class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file MenuAbilities.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuAbilities extends K1_MenuAbilities {

  declare LB_DESC_FEATS: GUIListBox;
  declare LBL_BAR6: GUILabel;
  declare LBL_BAR1: GUILabel;
  declare LBL_INFOBG: GUILabel;
  declare LBL_BAR5: GUILabel;
  declare LB_DESC: GUIListBox;
  declare LBL_NAME: GUILabel;
  declare LBL_SKILLRANK: GUILabel;
  declare LBL_RANKVAL: GUILabel;
  declare LBL_BONUS: GUILabel;
  declare LBL_BONUSVAL: GUILabel;
  declare LBL_TOTAL: GUILabel;
  declare LBL_TOTALVAL: GUILabel;
  declare BTN_POWERS: GUIButton;
  declare BTN_SKILLS: GUIButton;
  declare BTN_FEATS: GUIButton;
  declare LBL_BAR2: GUILabel;
  declare LBL_BAR3: GUILabel;
  declare LBL_BAR4: GUILabel;
  declare LBL_FILTER: GUILabel;
  declare LBL_ABILITIES: GUILabel;
  declare BTN_EXIT: GUIButton;
  declare LB_ABILITY: GUIListBox;

  filter: AbilityFilter = AbilityFilter.SKILLS;

  constructor(){
    super();
    this.gui_resref = 'abilities_p';
    this.background = '1600x1200back';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer(true);
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.BTN_EXIT.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
      this._button_b = this.BTN_EXIT;
      this.LB_ABILITY.onSelected = (node: any) => this.describeAbility(node);

      this.BTN_SKILLS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.filter = AbilityFilter.SKILLS;
        this.updateFilter();
      });

      this.BTN_POWERS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.filter = AbilityFilter.POWERS;
        this.updateFilter();
      });

      this.BTN_FEATS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.filter = AbilityFilter.FEATS;
        this.updateFilter();
      });

      resolve();
    });
  }

  show() {
    super.show();
    this.updateFilter();
  }

  getFilteredItems(): any[] {
    switch(this.filter){
      case AbilityFilter.SKILLS:
        return GameState.PartyManager.party[0].skills.slice();
      case AbilityFilter.POWERS:
        return this.buildSpellsList(GameState.PartyManager.party[0]);
      case AbilityFilter.FEATS:
        return this.buildFeatList(GameState.PartyManager.party[0]);
    }
  }

  buildFeatList(creature: ModuleCreature): any[][] {
    const feats = GameState.SWRuleSet.feats;
    const featCount = feats.length;
    const knownFeats: TalentFeat[] = creature ? creature.feats : [];
    const groups = [];
    for (let i = 0; i < knownFeats.length; i++) {
      const feat = knownFeats[i];
      if (!feat || /^XXXX/i.test(String((feat as any).label ?? ''))) continue;
      const group: TalentFeat[] = [];
      const prereqfeat1 = feats[feat.prereqFeat1];
      const prereqfeat2 = feats[feat.prereqFeat2];
      if (!prereqfeat1 && !prereqfeat2) {
        group.push(feat);
        for (let j = 0; j < featCount; j++) {
          const chainFeat = feats[j];
          // Successors of THIS feat, by feat id: comparing against the list
          // position `i` chained unrelated feats (Power Attack -> Improved
          // Flurry, critic run 13). Internal rows (XXXX_*) are never shown.
          if (!chainFeat || /^XXXX/i.test(String((chainFeat as any).label ?? ''))) continue;
          if (chainFeat.prereqFeat1 == feat.id || chainFeat.prereqFeat2 == feat.id) {
            if (chainFeat.prereqFeat1 != -1 && chainFeat.prereqFeat2 != -1) {
              group[2] = chainFeat;
            } else {
              group[1] = chainFeat;
            }
          }
        }
        // this.LB_FEATS.addItem(group);
      }
      if(group && group.length){
        groups.push(group);
      }
    }
    // groups.sort((groupa, groupb) => groupa[0].toolscategories > groupb[0].toolscategories ? 1 : -1);
    console.log('feats', groups);
    return groups;
  }

  buildSpellsList(creature: ModuleCreature): any[][] {
    const spellsTable = GameState.TwoDAManager.datatables.get('spells');
    const spells = spellsTable.rows;
    const spellCount = spellsTable.RowCount;
    const allowedTypes = [1, 6];
    const knownSpells: any[] = [];



    const allowedSpells: any[] = [];
    for (let i = 0; i < spellCount; i++) {
      const spell = spells[i];
      const id = spell.__index;
      const usertype = parseInt(spell.usertype);

      //skip unsupported spells
      if(allowedTypes.indexOf(usertype) == -1){ continue; }

      // Only powers the character knows. Spells 176-182 (unused rows, one
      // named "Super duper advanced lightning") were always added and showed
      // as nine "?" icons and the screen's title (critic run 12).
      if(!GameState.PartyManager.party[0].getHasSpell(id)){ continue; }

      allowedSpells.push(spell);
    }

    console.log('allowedSpells', allowedSpells);

    const rootSpells: any[] = allowedSpells.filter((spell) => { return parseInt(spell.forcepriority) === 0; });
    const midSpells: any[] = allowedSpells.filter((spell) => { return parseInt(spell.forcepriority) === 1; });
    const endSpells: any[] = allowedSpells.filter((spell) => { return parseInt(spell.forcepriority) === 2; });

    const mapSpells = new Map<number, any[]>();

    for (let i = 0; i < rootSpells.length; i++) {
      const spell = rootSpells[i];
      const id = spell.__index;
      const group = [spell];

      //MID SPELL
      const midSpell = midSpells.find( (curSpell) => {
        const prereqs = curSpell.prerequisites.split('_').map((id:string) => parseInt(id));
        return prereqs[0] == id && GameState.PartyManager.party[0].getHasSpell(curSpell.__index);
      });

      if(midSpell){ 
        group[parseInt(midSpell.forcepriority)] = midSpell; 
      }

      //END SPELL
      const endSpell = endSpells.find( (curSpell) => {
        const prereqs = curSpell.prerequisites.split('_').map((id:string) => parseInt(id));
        return prereqs[0] == id && GameState.PartyManager.party[0].getHasSpell(curSpell.__index);
      });

      if(endSpell){ 
        group[parseInt(endSpell.forcepriority)] = endSpell; 
      }

      mapSpells.set(id, group);
    }

    const groups: any[] = Array.from(mapSpells.values());
    console.log('spells', groups);
    return groups;
  }

  /**
   * Where a hovered or clicked ability's description goes. TSL's Feats tab
   * shows `LB_DESC_FEATS` and hides `LB_DESC` (see updateFilter), so writing
   * the shared list would describe feats into a hidden control.
   */
  getDescriptionList(): GUIListBox {
    return this.filter === AbilityFilter.FEATS ? this.LB_DESC_FEATS : this.LB_DESC;
  }

  updateFilter(){
    console.log('updateFilter');

    this.LB_ABILITY.show();

    this.LB_DESC.hide();
    this.LB_DESC_FEATS.hide();

    this.LB_DESC.setItem(null);
    this.LB_DESC_FEATS.setItem(null);
    const items = this.getFilteredItems();

    switch(this.filter){
      case AbilityFilter.SKILLS:
        this.LB_ABILITY.setProtoBuilder(GUICreatureSkill);
        this.LB_ABILITY.padding = 0;
        this.LB_DESC.show();
        this.LBL_BONUS.show();
        this.LBL_BONUSVAL.show();
        this.LBL_TOTAL.show();
        this.LBL_TOTALVAL.show();
        this.LBL_SKILLRANK.show();
        this.LBL_RANKVAL.show();
        this.LBL_INFOBG.show();
      break;
      case AbilityFilter.POWERS:
        this.LB_ABILITY.GUIProtoItemClass = GUISpellItem;
        this.LB_ABILITY.padding = 5.5;
        this.LB_DESC.show();
        this.LBL_BONUS.show();
        this.LBL_BONUSVAL.show();
        this.LBL_TOTAL.show();
        this.LBL_TOTALVAL.show();
        this.LBL_SKILLRANK.show();
        this.LBL_RANKVAL.show();
        this.LBL_INFOBG.show();
      break;
      case AbilityFilter.FEATS:
        this.LB_ABILITY.setProtoBuilder(GUIFeatItem);
        this.LB_ABILITY.padding = 5.5;
        this.LB_DESC_FEATS.show();
        this.LBL_BONUS.hide();
        this.LBL_BONUSVAL.hide();
        this.LBL_TOTAL.hide();
        this.LBL_TOTALVAL.hide();
        this.LBL_SKILLRANK.hide();
        this.LBL_RANKVAL.hide();
        this.LBL_INFOBG.hide();
      break;
    }
    
    console.log(this.filter);
    console.log(this.LB_ABILITY.GUIProtoItemClass);

    this.LB_ABILITY.setItems(items);
    // Describe the first entry: nothing was selected on open, so the pane
    // showed the GUI's placeholder ("Super duper advanced lightning", +00).
    this.describeAbility(items[0]);

  }

  /**
   * Fills the name, value boxes and description for the selected entry (none
   * of it was ever filled; critic runs 12-13). Skills: rank, ability and feat
   * bonus, total. Powers: base Force point cost, alignment adjustment, cost
   * for this character.
   */
  /** The Powers icons report here: name, text and the cost boxes together (critic run 14). */
  describeSpell(spell: any){
    this.describeAbility(spell);
  }

  describeFeat(feat: any){
    this.describeAbility(feat);
  }

  describeAbility(node: any){
    const creature: any = GameState.PartyManager.party[0];
    const signed = (n: number) => (n >= 0 ? '+' : '') + String(n).padStart(2, '0');
    const tlk = (id: unknown) => {
      const n = Number(id);
      return Number.isInteger(n) && n >= 0 ? String(GameState.TLKManager.GetStringById(n)?.Value ?? '') : '';
    };
    try{
      if(!node){
        this.LBL_NAME?.setText('');
        this.getDescriptionList()?.setItem(null);
        return;
      }
      if(this.filter === AbilityFilter.SKILLS){
        // The boxes' captions are the Powers tab's by default ("Base Cost /
        // Dark Side / Total Rank" over a skill; critic run 14).
        this.LBL_SKILLRANK?.setText(tlk(1579));
        this.LBL_BONUS?.setText(tlk(32129));
        this.LBL_TOTAL?.setText(tlk(41904));
        const rank = Number(node.rank) || 0;
        const total = typeof creature?.getSkillTotal === 'function' ? creature.getSkillTotal(node.id) : rank;
        this.LBL_NAME?.setText(node.getName?.() ?? '');
        this.LBL_RANKVAL?.setText(String(rank).padStart(2, '0'));
        this.LBL_BONUSVAL?.setText(signed(total - rank));
        this.LBL_TOTALVAL?.setText(String(total).padStart(2, '0'));
        this.LB_DESC.setItem(node.getDescription?.() || null);
        return;
      }
      if(this.filter === AbilityFilter.POWERS){
        const group: any[] = Array.isArray(node) ? node.filter(Boolean) : [node];
        const row = group[group.length - 1];
        const id = Number(row?.__index);
        const base = Number.parseInt(String(row?.forcepoints ?? '0'), 10) || 0;
        let cost = base;
        try{ cost = new GameState.TalentSpell(id).getForcePointCostFor(creature); }catch(e){}
        const side = String(row?.goodevil ?? '').trim().toUpperCase();
        this.LBL_SKILLRANK?.setText(tlk(37655));
        this.LBL_BONUS?.setText(side === 'G' ? tlk(41891) : side === 'E' ? tlk(41890) : '');
        this.LBL_TOTAL?.setText('Cost');
        this.LBL_NAME?.setText(tlk(row?.name));
        this.LBL_RANKVAL?.setText(String(base).padStart(2, '0'));
        this.LBL_BONUSVAL?.setText(signed(cost - base));
        this.LBL_TOTALVAL?.setText(String(cost).padStart(2, '0'));
        this.LB_DESC.setItem(tlk(row?.spelldesc) || null);
        return;
      }
      const group: any[] = Array.isArray(node) ? node.filter(Boolean) : [node];
      // The highest feat of the chain this character owns: the last of the
      // chain described an unowned Weapon Specialization (critic run 14).
      const owned = group.filter((f: any) => typeof creature?.getHasFeat !== 'function' || creature.getHasFeat(f?.id));
      const feat = owned[owned.length - 1] ?? group[0];
      this.LBL_NAME?.setText(tlk(feat?.name));
      this.LB_DESC_FEATS.setItem(tlk(feat?.description) || null);
    }catch(e){
      console.warn('MenuAbilities: describe failed', e);
    }
  }
  
}
