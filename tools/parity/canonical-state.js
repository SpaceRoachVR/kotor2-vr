/** Shared by capture and promotion: labels cannot substitute for observed state. */
function assertCanonicalEngineState(state, expectedModule) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('Canonical parity capture rejected: engine state is unavailable');
  }
  if (state.loadedFromSave === true) throw new Error('Canonical parity capture rejected: module is save-derived');
  if (state.loadedFromSave !== false) throw new Error('Canonical parity capture rejected: save origin could not be verified');
  if (Object.hasOwn(state, 'freshState') && state.freshState !== true) {
    throw new Error('Canonical parity capture rejected: fresh bootstrap state is contradicted');
  }
  if (state.bootstrap !== 'new-game-ui') throw new Error('Canonical parity capture rejected: expected fresh new-game bootstrap');
  if (state.playerName !== 'T3-M4' || state.partySize !== 1) {
    throw new Error('Canonical parity capture rejected: expected fresh T3-M4 single-member party');
  }
  if (expectedModule !== undefined && (typeof state.module !== 'string'
      || state.module.trim().toUpperCase() !== String(expectedModule).trim().toUpperCase())) {
    throw new Error('Canonical parity capture rejected: module mismatch');
  }
}

module.exports = { assertCanonicalEngineState };
