import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `SwitchPlayerCharacter` returned the new party member synchronously but only
 * assigned `PartyManager.party[0]` inside the `loadModel()` promise. The
 * NWScript action therefore returned before the swap was observable, and
 * `GetObjectByTag` — which searches `PartyManager.party` — could not find the
 * incoming character.
 *
 * The Peragus "become T3-M4" script `a_bet3m4` calls SwitchPlayerCharacter and
 * then looks the new character up by tag for everything that follows. Decoding
 * its bytecode shows the calls in order:
 *
 *   @1384 SwitchPlayerCharacter
 *   @1446 GetObjectByTag  ->  @1451 SetMinOneHP        (target unresolved)
 *   @1492 GetObjectByTag  ->  @1526 ApplyEffectToObject (non-ModuleObject)
 *   @1590 GetObjectByTag  ->  @1618 ApplyEffectToObject (non-ModuleObject)
 *   @1756 DestroyObject                                 (undefined)
 *
 * Every one of those failed in a headset session, which is also why T3-M4
 * arrived late and behaved oddly.
 *
 * `PartyManager` reaches GameState and the whole engine graph, so the ordering
 * is pinned at source level beside a model of the race.
 */
const SOURCE = 'src/managers/PartyManager.ts';
const contents = fs.readFileSync(path.join(process.cwd(), SOURCE), 'utf8');

const switchBody = (() => {
  const at = contents.indexOf('static SwitchPlayerCharacter(');
  expect(at).toBeGreaterThan(-1);
  const rest = contents.slice(at);
  const body = rest.slice(0, rest.indexOf('\n  /**'));
  // The rationale comment names the very defect it fixed, so prose must not
  // be able to satisfy these assertions.
  return body
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
})();

describe('SwitchPlayerCharacter ordering', () => {
  test('assigns party[0] before loadModel is called', () => {
    const assign = switchBody.indexOf('PartyManager.party[0] = partyMember');
    const load = switchBody.indexOf('partyMember.loadModel()');
    expect(assign).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    expect(assign).toBeLessThan(load);
  });

  test('assigns party[0] exactly once', () => {
    const matches = switchBody.match(/PartyManager\.party\[0\]\s*=\s*partyMember/g) || [];
    expect(matches.length).toBe(1);
  });

  // Identity is synchronous; the 3D model is what is asynchronous. These stay
  // deferred because they genuinely need the loaded model or a settled swap.
  test.each([
    ['model.userData.moduleObject', 'model.userData.moduleObject = partyMember'],
    ['collision', 'model.hasCollision = true'],
    ['old character teardown', 'oldPC.destroy()'],
    ['spawn script', 'partyMember.onSpawn()'],
  ])('keeps %s inside the loadModel promise', (_name, needle) => {
    const load = switchBody.indexOf('partyMember.loadModel()');
    expect(switchBody.indexOf(needle)).toBeGreaterThan(load);
  });
});

/**
 * A model of the race, so the defect is asserted as behaviour and not only as
 * source order.
 */
describe('the race', () => {
  function makeManager(assignEarly: boolean) {
    const party: string[] = ['old-pc'];
    let resolveModel: () => void = () => {};
    const modelLoaded = new Promise<void>((resolve) => { resolveModel = resolve; });

    function switchPlayerCharacter(incoming: string): string {
      if (assignEarly) party[0] = incoming;
      void modelLoaded.then(() => { party[0] = incoming; });
      return incoming;
    }

    return {
      switchPlayerCharacter,
      finishModelLoad: async () => { resolveModel(); await modelLoaded; },
      // Mirrors ModuleObjectManager.GetObjectByTag, which searches the party.
      getObjectByTag: (tag: string) => party.find((member) => member === tag),
    };
  }

  test('the old ordering loses the lookup the script makes next', async () => {
    const m = makeManager(false);
    m.switchPlayerCharacter('t3m4');
    expect(m.getObjectByTag('t3m4')).toBeUndefined();
    await m.finishModelLoad();
    expect(m.getObjectByTag('t3m4')).toBe('t3m4');
  });

  test('assigning before the await makes the lookup succeed immediately', async () => {
    const m = makeManager(true);
    m.switchPlayerCharacter('t3m4');
    expect(m.getObjectByTag('t3m4')).toBe('t3m4');
    await m.finishModelLoad();
    expect(m.getObjectByTag('t3m4')).toBe('t3m4');
  });
});
