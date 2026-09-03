import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { FadeOverlayState } from '@/enums/engine/FadeOverlayState';

/**
 * A conversation carrying an authored fade-out node left the overlay parked at
 * full opacity. The restore in `CutsceneManager.endConversation` only ran for
 * ANIMATED cutscenes, so the Peragus intro — whose last node is
 * `{Placed Camera 6, fade out}` — ended with the screen black and nothing to
 * lift it.
 *
 * The fade quad lives in `scene_gui`, which every VR GUI panel composites, so
 * the stuck fade rendered the container and computer menus as solid black
 * boxes. Reported from a headset session after skipping the intro movie; the
 * live overlay read `state=FADED_OUT, material.visible=true, opacity=1`.
 *
 * `FadeOverlayManager` reaches GameState (and therefore the whole engine
 * graph), so these are source-level plus a model of the guard.
 */
describe('FadeInFromCutscene guard', () => {
  // Mirrors FadeOverlayManager.FadeInFromCutscene: a no-op unless the overlay
  // is actually faded, or fading, out. This is what makes calling it on every
  // conversation end safe rather than a source of spurious fade-ins.
  function wouldFadeIn(state: FadeOverlayState): boolean {
    return state === FadeOverlayState.FADED_OUT || state === FadeOverlayState.FADING_OUT;
  }

  test.each([
    ['FADED_OUT', FadeOverlayState.FADED_OUT, true],
    ['FADING_OUT', FadeOverlayState.FADING_OUT, true],
    ['FADED_IN', FadeOverlayState.FADED_IN, false],
    ['FADING_IN', FadeOverlayState.FADING_IN, false],
    ['NONE', FadeOverlayState.NONE, false],
  ])('from %s restores=%s', (_name, state, expected) => {
    expect(wouldFadeIn(state)).toBe(expected);
  });

  // The observed stuck state.
  test('the reported headset state is one the restore acts on', () => {
    expect(wouldFadeIn(FadeOverlayState.FADED_OUT)).toBe(true);
  });
});

describe('CutsceneManager.endConversation restores a conversation fade', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/managers/CutsceneManager.ts'),
    'utf8',
  );
  // Comments are stripped first: the rationale above the guard names the same
  // identifiers the guard does, so matching raw source would pass on prose.
  const code = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  const guard = (() => {
    const at = code.indexOf('FadeInFromCutscene');
    const before = code.slice(0, at);
    return before.slice(before.lastIndexOf('if('));
  })();

  test('no longer restores only for ANIMATED cutscenes', () => {
    expect(guard).toContain('holdForScript');
  });

  test('still restores for ANIMATED cutscenes', () => {
    expect(guard).toContain('CutsceneMode.ANIMATED');
  });

  // A fade deliberately held across a module transition fades in on the far
  // side; forcing one here would flash the outgoing area.
  test('defers to a script that has claimed the fade', () => {
    expect(guard).toMatch(/!\s*GameState\.FadeOverlayManager\.holdForScript/);
  });
});

/**
 * `holdForScript` was set by SetFadeUntilScript and cleared by
 * SetGlobalFadeIn/Out but read nowhere, so the engine's own "a script owns this
 * fade" signal was inert. The guard above is its first consumer; pinned so it
 * is not deleted as dead state.
 */
describe('holdForScript is wired', () => {
  const k1 = fs.readFileSync(
    path.join(process.cwd(), 'src/nwscript/NWScriptDefK1.ts'),
    'utf8',
  );
  const k2 = fs.readFileSync(
    path.join(process.cwd(), 'src/nwscript/NWScriptDefK2.ts'),
    'utf8',
  );

  test('SetGlobalFadeIn and SetGlobalFadeOut clear it', () => {
    expect((k1.match(/holdForScript\s*=\s*false/g) || []).length).toBe(2);
  });

  test('SetFadeUntilScript sets it', () => {
    expect(k2).toMatch(/holdForScript\s*=\s*true/);
  });
});
