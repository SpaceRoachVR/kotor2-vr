/** Exercise the current prompt-selection contract using real loaded targets. */
async function probeWeaponBash(K) {
  const hooks = K.VRSpike?.hooks;
  if (typeof hooks?.getWeaponBashContext !== 'function' || typeof hooks.noteWorldPromptSelection !== 'function') {
    return { hook: false };
  }
  const gs = K.GameState;
  const player = K.PartyManager.Player;
  const area = gs.module?.area;
  if (!player || !area) throw new Error('Weapon Bash probe needs a loaded player and area');
  const locked = [...area.doors, ...area.placeables].filter(target => target?.position &&
    typeof target.isLocked === 'function' && target.isLocked());
  const home = player.position.clone();
  const equipment = [];
  try {
    // A blaster has no melee swing route. Unequip through the engine, preserving
    // the same items in inventory, then restore them after the probe.
    for (const [key, slot] of [['RIGHTHAND', 0x10], ['LEFTHAND', 0x20]]) {
      const item = player.equipment[key];
      if (item) { equipment.push({ slot, item }); player.unequipSlot(slot, true); }
    }
    for (const target of locked) {
      if (![target.position.x, target.position.y, target.position.z].every(Number.isFinite)) continue;
      player.position.set(target.position.x + 1, target.position.y, target.position.z);
      player.getCurrentRoom();
      gs.ModuleObjectManager.GetSelectableObjectsInRange(player);
      const promptId = 'module-object:' + target.id;
      const prompt = K.buildVRWorldActionPrompt(promptId);
      if (!prompt) continue;
      hooks.noteWorldPromptSelection(null, '');
      const unselectedBlocked = hooks.getWeaponBashContext(target.id) === null;
      const entries = prompt.pages.flatMap(page => page.entries);
      const bash = entries.find(entry => entry.kind === 'action' && entry.label === 'Bash');
      if (!bash) {
        return { hook: true, lockedCount: locked.length, targetTag: target.getTag(),
          unselectedBlocked, authoredBashAbsent: true, started: false, secondStarted: false };
      }
      if (!bash.revalidate()) continue;
      // This is the selection callback VRSpike invokes when the player picks
      // the authored Bash entry. The swing dispatch activates that same entry.
      hooks.noteWorldPromptSelection(promptId, bash.label);
      const context = hooks.getWeaponBashContext(target.id);
      const started = context?.bash() === true;
      return { hook: true, lockedCount: locked.length, targetTag: target.getTag(), unselectedBlocked,
        authoredBashAbsent: false, started, secondStarted: context?.bash() === true,
        inCombat: !!player.combatData?.combatState };
    }
    return { hook: true, lockedCount: locked.length, sampled: false, started: null };
  } finally {
    hooks.noteWorldPromptSelection(null, '');
    player.clearAllActions(true);
    player.cancelCombat();
    player.position.copy(home);
    player.getCurrentRoom();
    for (const { slot, item } of equipment) await player.equipItem(slot, item);
    gs.ModuleObjectManager.GetSelectableObjectsInRange(player);
  }
}

module.exports = { probeWeaponBash };
