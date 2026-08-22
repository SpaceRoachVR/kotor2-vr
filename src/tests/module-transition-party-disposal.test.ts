import { describe, expect, jest, test } from '@jest/globals';
import { detachPartyForModuleTransition } from '@/module/transition/detachPartyForModuleTransition';

describe('detachPartyForModuleTransition', () => {
  test('retains the live T3 player identity while clearing the outgoing party', () => {
    const detachPlayerModel = jest.fn();
    const destroyPlayer = jest.fn();
    const destroyCompanion = jest.fn();
    const t3Player = {
      tag: 'T3_M4',
      container: { removeFromParent: detachPlayerModel },
      destroy: destroyPlayer,
    };
    const companion = {
      container: { removeFromParent: jest.fn() },
      destroy: destroyCompanion,
    };
    const party = [t3Player, companion];

    detachPartyForModuleTransition(party, t3Player);

    expect(detachPlayerModel).toHaveBeenCalledTimes(1);
    expect(destroyPlayer).not.toHaveBeenCalled();
    expect(destroyCompanion).toHaveBeenCalledTimes(1);
    expect(party).toEqual([]);
    expect(t3Player.tag).toBe('T3_M4');
  });

  test('destroys every departing companion when no controlled player is present', () => {
    const first = { container: { removeFromParent: jest.fn() }, destroy: jest.fn() };
    const second = { container: { removeFromParent: jest.fn() }, destroy: jest.fn() };
    const party = [first, second];

    detachPartyForModuleTransition(party, undefined);

    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(party).toEqual([]);
  });

  test('rejects a malformed transition party collection', () => {
    expect(() => detachPartyForModuleTransition(null as never, undefined)).toThrow(
      'Module transition party must be an array'
    );
  });
});
