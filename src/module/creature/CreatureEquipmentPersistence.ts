import { ModuleCreatureArmorSlot } from '@/enums/module/ModuleCreatureArmorSlot';

export const CREATURE_EQUIPMENT_PERSISTENCE_SLOTS = [
  ['ARMOR', ModuleCreatureArmorSlot.ARMOR],
  ['ARMS', ModuleCreatureArmorSlot.ARMS],
  ['BELT', ModuleCreatureArmorSlot.BELT],
  ['CLAW1', ModuleCreatureArmorSlot.CLAW1],
  ['CLAW2', ModuleCreatureArmorSlot.CLAW2],
  ['CLAW3', ModuleCreatureArmorSlot.CLAW3],
  ['HEAD', ModuleCreatureArmorSlot.HEAD],
  ['HIDE', ModuleCreatureArmorSlot.HIDE],
  ['IMPLANT', ModuleCreatureArmorSlot.IMPLANT],
  ['LEFTARMBAND', ModuleCreatureArmorSlot.LEFTARMBAND],
  ['LEFTHAND', ModuleCreatureArmorSlot.LEFTHAND],
  ['LEFTHAND2', ModuleCreatureArmorSlot.LEFTHAND2],
  ['RIGHTARMBAND', ModuleCreatureArmorSlot.RIGHTARMBAND],
  ['RIGHTHAND', ModuleCreatureArmorSlot.RIGHTHAND],
  ['RIGHTHAND2', ModuleCreatureArmorSlot.RIGHTHAND2],
] as const;
