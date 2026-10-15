import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { parsePerfLayer, readPerfFlag } from '@/utility/RendererOptions';

/**
 * The jest environment is `node`, which has no `localStorage`. These tests
 * install a minimal Map-backed one so the "never read storage" and "may read
 * storage" contracts are exercised for real rather than vacuously.
 */
const globals = globalThis as unknown as { localStorage?: Storage };
let original: Storage | undefined;
let store: Map<string, string>;

beforeEach(() => {
  original = globals.localStorage;
  store = new Map();
  globals.localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
  } as unknown as Storage;
});

afterEach(() => {
  if (original === undefined) delete globals.localStorage;
  else globals.localStorage = original;
});

describe('perflayer launch option', () => {
  test('parsePerfLayer reads l0..l5', () => {
    expect(parsePerfLayer('?perflayer=l0')).toBe(0);
    expect(parsePerfLayer('?perflayer=L3')).toBe(3);
    expect(parsePerfLayer('?key=tsl&perflayer=l5')).toBe(5);
  });

  test('parsePerfLayer defaults to 5 for absent or garbage', () => {
    expect(parsePerfLayer('')).toBe(5);
    expect(parsePerfLayer('?perflayer=l9')).toBe(5);
    expect(parsePerfLayer('?perflayer=3')).toBe(5);
    expect(parsePerfLayer('?perflayer=')).toBe(5);
  });

  test('ignores localStorage for perflayer', () => {
    localStorage.setItem('kotor2vr.perflayer', 'l0');
    expect(parsePerfLayer('')).toBe(5);
    expect(parsePerfLayer('?perflayer=l2')).toBe(2);
    localStorage.removeItem('kotor2vr.perflayer');
  });
});

describe('perf.<name> fix flags', () => {
  test('readPerfFlag honours on/off and default', () => {
    expect(readPerfFlag('?perf.batching=off', 'batching', true)).toBe(false);
    expect(readPerfFlag('?perf.batching=on', 'batching', false)).toBe(true);
    expect(readPerfFlag('', 'batching', true)).toBe(true);
    expect(readPerfFlag('', 'batching', false)).toBe(false);
  });

  test('readPerfFlag accepts 1/true/0/false case-insensitively', () => {
    expect(readPerfFlag('?perf.x=1', 'x', false)).toBe(true);
    expect(readPerfFlag('?perf.x=TRUE', 'x', false)).toBe(true);
    expect(readPerfFlag('?perf.x=0', 'x', true)).toBe(false);
    expect(readPerfFlag('?perf.x=False', 'x', true)).toBe(false);
  });

  test('readPerfFlag falls back to the default for garbage', () => {
    expect(readPerfFlag('?perf.x=maybe', 'x', true)).toBe(true);
    expect(readPerfFlag('?perf.x=maybe', 'x', false)).toBe(false);
  });

  test('readPerfFlag falls back to localStorage, and the URL wins', () => {
    localStorage.setItem('kotor2vr.perf.batching', 'off');
    expect(readPerfFlag('', 'batching', true)).toBe(false);
    expect(readPerfFlag('?perf.batching=on', 'batching', true)).toBe(true);
  });
});
