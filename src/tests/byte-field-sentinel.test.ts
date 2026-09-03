import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { GFFField } from '@/resource/GFFField';
import { GFFDataType } from '@/enums/resource/GFFDataType';

/**
 * `ModuleStore` initialised `buySellFlag` to -1 as an "unset" sentinel, but
 * `BuySellFlag` is a BYTE and -1 is not a value a BYTE can hold.
 *
 * It escaped whenever a store's UTM could not be resolved: `load()` logs
 * "Failed to load ModuleStore template", `initProperties()` then finds no
 * BuySellFlag field, the -1 survives, and `save()` writes it into the BYTE.
 * `GFFField.setValue` reports "BYTE OutOfBounds" and stores the value anyway,
 * so serialization wraps it to 255 — the same -1/255 confusion that silently
 * disabled every item property after a save/load (see
 * item-property-upgrade-sentinel.test.ts).
 *
 * The 82-module sweep found the BYTE error in 13 modules and the template
 * failure that produces it in 12.
 */
describe('GFFField BYTE bounds', () => {
  test.each([
    ['zero', 0],
    ['a mid value', 3],
    ['the maximum', 255],
  ])('accepts %s', (_name, value) => {
    const field = new GFFField(GFFDataType.BYTE, 'BuySellFlag');
    field.setValue(value);
    expect(field.getValue()).toBe(value);
  });

  // Pins the behaviour that makes an out-of-range value dangerous rather than
  // merely noisy: the guard reports it and then stores it regardless, so the
  // bad value reaches serialization. Fixing the sources is what keeps -1 out;
  // this documents why a source fix is required rather than optional.
  test('stores an out-of-range value despite reporting it', () => {
    const field = new GFFField(GFFDataType.BYTE, 'BuySellFlag');
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args[0]); };
    try {
      field.setValue(-1);
    } finally {
      console.error = original;
    }
    expect(errors.length).toBe(1);
    expect(String(errors[0])).toContain('BYTE OutOfBounds');
    // Names the offending field, so a sweep line identifies the source.
    expect(String(errors[0])).toContain("label='BuySellFlag'");
    expect(field.getValue()).toBe(-1);
  });

  test('an undefined value defaults to zero rather than going out of range', () => {
    const field = new GFFField(GFFDataType.BYTE, 'BuySellFlag');
    field.setValue(undefined);
    expect(field.getValue()).toBe(0);
  });
});

/**
 * The source of the -1. `ModuleStore` reaches GameState and the whole engine
 * graph, so this is source-level.
 */
describe('ModuleStore.buySellFlag default', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/module/ModuleStore.ts'),
    'utf8',
  );

  test('is a valid BYTE, not the -1 sentinel', () => {
    expect(source).toMatch(/this\.buySellFlag\s*=\s*0\s*;/);
    expect(source).not.toMatch(/this\.buySellFlag\s*=\s*-1\s*;/);
  });

  test('is still written to the BuySellFlag BYTE field on save', () => {
    const line = source
      .split('\n')
      .find((candidate) => candidate.includes("'BuySellFlag'") && candidate.includes('addField'));
    expect(line).toBeDefined();
    expect(line).toContain('GFFDataType.BYTE');
    expect(line).toContain('this.buySellFlag');
  });
});

/**
 * The bounds diagnostics name their field. Without the label a sweep line reads
 * "Field.setValue BYTE OutOfBounds -1 GFFField", which identifies neither the
 * field nor the object — the reason this defect sat unattributed across 13
 * modules.
 */
describe('bounds diagnostics identify the field', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/resource/GFFField.ts'),
    'utf8',
  );

  test.each(['BYTE', 'SHORT', 'INT', 'WORD', 'DWORD'])('%s reports its label', (type) => {
    const line = source
      .split('\n')
      .find((candidate) => candidate.includes(`${type} OutOfBounds`));
    expect(line).toBeDefined();
    expect(line).toContain('${this.label}');
  });
});
