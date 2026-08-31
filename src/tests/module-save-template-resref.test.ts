import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every module object save path dropped `TemplateResRef`.
 *
 * The 82-module sweep reported 39 template-missing findings in 001EBO — 25
 * placeables, all 11 doors, 3 creatures — while the module itself loaded
 * correctly: every object had a model, names resolved, 30 frames rendered. That
 * combination is what made it worth chasing rather than dismissing.
 *
 * Loading 001EBO cold gives all 57 objects a templateResRef. Reaching it the way
 * the sweep does — transitioning out of the save's module — gives 0 of 57, and
 * the template struct they hold reports `no-field`: the field is not empty, it
 * is absent. The engine loads a visited module's GIT from the saved `.sav`
 * rather than the pristine RIM (`Module.GetModuleArchives`), and `save()` never
 * wrote the field, on any of the eight object types. So the blueprint reference
 * survived only until the first save of that module.
 *
 * Reproduce with `tools/vr-emulator/probe-001ebo.js --via-save`.
 *
 * Pinned at source level for the same reason as `script-object-guards`: these
 * classes import GameState, which pulls a module chain Jest cannot parse. This
 * asserts the write is present, not that a round trip restores it — proving that
 * needs the probe and an install.
 */
const SAVE_PATHS = [
  'ModulePlaceable', 'ModuleDoor', 'ModuleCreature', 'ModuleTrigger',
  'ModuleWaypoint', 'ModuleSound', 'ModuleStore', 'ModuleEncounter',
];

const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const saveBody = (name: string): string => {
  const source = stripComments(
    fs.readFileSync(path.join(__dirname, '..', 'module', `${name}.ts`), 'utf8'));
  const start = source.search(/\n\s*save\s*\(\s*\)\s*\{/);
  expect(start).toBeGreaterThan(-1);
  // Bounded window: long enough to cover the field writes, short enough not to
  // spill into whatever method follows and borrow its text.
  return source.slice(start, start + 14000);
};

describe('module object saves preserve the blueprint reference', () => {

  test.each(SAVE_PATHS)('%s.save() writes TemplateResRef', (name) => {
    const body = saveBody(name);
    expect(body).toMatch(/GFFDataType\.RESREF, 'TemplateResRef'\s*\)\s*\)\.setValue\(/);
  });

  test.each(SAVE_PATHS)('%s.save() writes it from the object, not a literal', (name) => {
    const body = saveBody(name);
    const write = body.match(
      /GFFDataType\.RESREF, 'TemplateResRef'\s*\)\s*\)\.setValue\(([^;]*)\);/);
    expect(write).not.toBeNull();
    // An empty-string default is fine for an object that never had one; a save
    // that hard-codes '' for everything would satisfy the test above while
    // preserving nothing.
    expect(write![1]).toContain('this.templateResRef');
  });

});
