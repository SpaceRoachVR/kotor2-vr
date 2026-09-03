import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { resolveSavedCreatureName } from '@/module/CreatureNamePersistence';

/**
 * `ModuleCreature.save()` wrote FirstName/LastName straight back out of
 * `this.template` while every other field serialized live state, so the name
 * chosen in character generation was discarded on the first save and the
 * randomly generated one from `CharGenManager` persisted into
 * `ActualPlayerTemplate` and `pc.utc`.
 *
 * That template backs every `<FullName>` token, so the Peragus medbay dummy —
 * whose name field is literally `{Dummy Medbay PC}<FullName>` — rendered a
 * random name. Confirmed against a live session: the template held
 * "Urias Tainess". Reported from a headset session.
 */
const CEXOLOCSTRING = { tlkStringReference: 1234 };

function templateField(value: unknown, locString: unknown = CEXOLOCSTRING) {
  return { getValue: () => value, getCExoLocString: () => locString };
}

describe('resolveSavedCreatureName', () => {
  // The overwhelmingly common case: a TLK-backed NPC name. Writing the resolved
  // string back as a substring would discard the string reference and hard-code
  // one language into the save, so the CExoLocString must survive untouched.
  test('keeps the template CExoLocString when the live name is unchanged', () => {
    expect(resolveSavedCreatureName('Sensor Droid', templateField('Sensor Droid')))
      .toBe(CEXOLOCSTRING);
  });

  test('keeps the template CExoLocString when there is no live name', () => {
    expect(resolveSavedCreatureName(undefined, templateField('Sensor Droid')))
      .toBe(CEXOLOCSTRING);
  });

  test('keeps the template CExoLocString when the live name is not a string', () => {
    expect(resolveSavedCreatureName(42, templateField('Sensor Droid'))).toBe(CEXOLOCSTRING);
  });

  // The defect this exists to fix.
  test('writes the live name once it has diverged from the template', () => {
    expect(resolveSavedCreatureName('Meetra Surik', templateField('Urias Tainess')))
      .toBe('Meetra Surik');
  });

  test('preserves the unsubstituted token name the medbay dummy ships with', () => {
    const raw = '{Dummy Medbay PC}<FullName>';
    expect(resolveSavedCreatureName(raw, templateField(raw))).toBe(CEXOLOCSTRING);
  });

  test('uses the live name when the template has no such field', () => {
    expect(resolveSavedCreatureName('Meetra Surik', undefined)).toBe('Meetra Surik');
    expect(resolveSavedCreatureName('Meetra Surik', null)).toBe('Meetra Surik');
  });

  test('returns undefined when neither a template field nor a live name exists', () => {
    expect(resolveSavedCreatureName(undefined, undefined)).toBeUndefined();
  });

  // Losing a name is recoverable; losing the save is not.
  test('a throwing template field does not propagate out of save', () => {
    const throwing = {
      getValue: () => { throw new Error('malformed'); },
      getCExoLocString: () => { throw new Error('malformed'); },
    };
    expect(() => resolveSavedCreatureName('Meetra Surik', throwing)).not.toThrow();
    expect(resolveSavedCreatureName('Meetra Surik', throwing)).toBe('Meetra Surik');
  });
});

/**
 * The call sites. ModuleCreature cannot be imported here — its module graph
 * reaches GameState and the managers barrel.
 */
describe('ModuleCreature.save name serialization', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/module/ModuleCreature.ts'),
    'utf8',
  );

  test.each([
    ['FirstName', 'firstName'],
    ['LastName', 'lastName'],
  ])('%s serializes through the live-name rule', (field, live) => {
    const line = source
      .split('\n')
      .find((candidate) => candidate.includes(`'${field}'`) && candidate.includes('addField'));
    expect(line).toBeDefined();
    expect(line).toContain('resolveSavedCreatureName');
    expect(line).toContain(`this.${live}`);
  });

  test('no longer reads the name straight out of the template', () => {
    expect(source).not.toMatch(
      /addField\([^)]*'FirstName'\s*\)\s*\)\.setValue\(\s*this\.template\.RootNode/,
    );
  });
});
