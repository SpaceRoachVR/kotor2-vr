/** The engine actor state that desktop selected-object activation resets. */
export interface SelectedObjectActivationActor {
  clearAllActions(): void;
}

/** The native semantic hook used by the flatscreen selected-object click path. */
export interface SelectedObjectActivationTarget<TActor extends SelectedObjectActivationActor> {
  onClick(actor: TActor): void;
}

export type SelectedObjectActivationResult =
  | { readonly status: 'activated' }
  | { readonly status: 'failed'; readonly error: Error };

/**
 * Performs the one native operation used whenever the currently selected world
 * object is activated.  This deliberately preserves desktop semantics: clear
 * the actor's queued actions, then let the target's authored `onClick` route
 * decide whether that means walking, opening, dialogue, combat, or refusal.
 */
export function activateSelectedObject<TActor extends SelectedObjectActivationActor>(
  actor: TActor,
  target: SelectedObjectActivationTarget<TActor>,
): SelectedObjectActivationResult {
  validateActor(actor);
  validateTarget(target);
  try {
    actor.clearAllActions();
    target.onClick(actor);
    return { status: 'activated' };
  } catch (error) {
    return { status: 'failed', error: toError(error) };
  }
}

function validateActor(actor: unknown): asserts actor is SelectedObjectActivationActor {
  if (!actor || typeof (actor as SelectedObjectActivationActor).clearAllActions !== 'function') {
    throw new TypeError('selected-object activation actor must expose clearAllActions');
  }
}

function validateTarget<TActor extends SelectedObjectActivationActor>(
  target: unknown,
): asserts target is SelectedObjectActivationTarget<TActor> {
  if (!target || typeof (target as SelectedObjectActivationTarget<TActor>).onClick !== 'function') {
    throw new TypeError('selected-object activation target must expose onClick');
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
