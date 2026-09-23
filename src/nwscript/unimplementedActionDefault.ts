import { NWScriptDataType } from "@/enums/nwscript/NWScriptDataType";

/**
 * The value an unimplemented NWScript action leaves on the stack.
 *
 * A non-VOID action always returns exactly one value, and the compiled script
 * reads it back at a fixed stack offset whether or not the engine implemented
 * the action. `CALL_ACTION` used to push nothing when `action` was undefined,
 * so the script's next read took whatever sat one slot lower and every offset
 * after it in that frame was misaligned — silently corrupting the rest of the
 * call rather than failing a single query.
 *
 * Measured in a headset session: TSL's `IsStealthed` (810, INTEGER) was called
 * 1,127 times inside AI-frequency scripts with no implementation, alongside the
 * report that Peragus enemies never attack the player. `IsMeditating` beside it
 * is stubbed to return 0; this gives every unimplemented action that shape.
 *
 * The defaults are the "nothing" of each type, matching what a real
 * implementation returns on error: FALSE, 0.0, an empty string, and an invalid
 * object. VECTOR is handled by `NWScriptStack.push`, which expands a non-object
 * into three zero floats.
 */
export function defaultValueForUnimplementedAction(type: NWScriptDataType): unknown {
  switch (type) {
    case NWScriptDataType.INTEGER: return 0;
    case NWScriptDataType.FLOAT: return 0.0;
    case NWScriptDataType.STRING: return '';
    default: return undefined;
  }
}
