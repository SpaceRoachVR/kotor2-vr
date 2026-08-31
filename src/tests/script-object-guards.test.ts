import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The four `page-exception` criticals from the 82-module sweep were all the same
 * shape: engine code dereferencing an object a script handed it, without asking
 * whether that object resolved. Scripts reference objects that do not exist in a
 * given playthrough all the time — a tag lookup that found nothing, OBJECT_INVALID,
 * an appearance id with no 2DA row. Retail treats those as no-ops. Here they threw
 * a TypeError out of the script VM, which aborted the running script and every
 * action queued behind it.
 *
 * | module | site                                    |
 * |--------|-----------------------------------------|
 * | 103PER | GetLastPerceived, `lastPerceived` unset  |
 * | 107PER | actionDialogObject, unresolved target    |
 * | 410DXN | loadBody, no appearance row              |
 * | 604DAN | SetLocalBoolean, non-object argument     |
 *
 * These are pinned at source level rather than by calling the functions, because
 * they cannot be called from a test: `NWScriptDefK1` imports `GameState`, which
 * pulls the manager barrel and a module chain Jest cannot parse — the same
 * constraint recorded in `ActiveControlDescent.ts` and `PointerHitPadding`. So
 * this asserts the guard is *present*, which is weaker than asserting behaviour.
 * It cannot prove the guard is correct; it does stop one being quietly deleted.
 */
/**
 * Comments are stripped before matching. These fixes are documented in prose
 * that necessarily names the very expressions being asserted on — the guard
 * comments mention `target.id` and `appearance.2da` — so a naive search finds
 * the explanation rather than the code and reports order backwards.
 */
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const read = (...parts: string[]): string =>
  stripComments(fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8'));

describe('script-facing guards against unresolved objects', () => {

  test('both Local setters guard their object, as their getters already did', () => {
    const source = read('nwscript', 'NWScriptDefK1.ts');

    // The asymmetry that caused 604DAN: getters 679/681 guarded and returned a
    // default, setters 680/682 dereferenced straight through.
    for (const setter of ['setLocalBoolean', 'setLocalNumber']) {
      const call = source.indexOf(`args[0].${setter}(`);
      expect(call).toBeGreaterThan(-1);
      const preceding = source.slice(Math.max(0, call - 400), call);
      expect(preceding).toContain('BitWise.InstanceOfObject(args[0]');
    }
  });

  test('every lastPerceived read is optional-chained', () => {
    const source = read('nwscript', 'NWScriptDefK1.ts');

    // `lastPerceived` is declared on NWScriptInstance but never initialised, so
    // it is undefined until a perception event assigns it. The accessors already
    // guarded `.object`; they just reached through `lastPerceived` to do it.
    expect(source).not.toMatch(/this\.lastPerceived\.[a-zA-Z]/);
    expect(source).toMatch(/this\.lastPerceived\?\./);
  });

  test('actionDialogObject refuses a target that is not a module object', () => {
    const source = read('module', 'ModuleObject.ts');
    const start = source.indexOf('actionDialogObject(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('actionQueue.add(action)', start));

    // Guarded here rather than at the two NWScript call sites (K1 204, K2 204),
    // because `target.id` is this method's own precondition.
    expect(body).toContain('BitWise.InstanceOfObject(target');
    expect(body.indexOf('BitWise.InstanceOfObject(target'))
      .toBeLessThan(body.indexOf('target.id'));
  });

  test('loadBody and loadHead tolerate a creature with no appearance row', () => {
    const source = read('module', 'ModuleCreature.ts');

    for (const method of ['async loadBody()', 'async loadHead()']) {
      const start = source.indexOf(method);
      expect(start).toBeGreaterThan(-1);
      // Guard must come before the first use of the appearance object.
      const body = source.slice(start, start + 900);
      const guard = body.indexOf('if(!appearance)');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(body.indexOf('appearance.'));
    }
  });

});
