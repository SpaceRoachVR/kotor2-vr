import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The swoop and the turret never ran a single frame of simulation.
 *
 * `ModuleMiniGame.tick()` is reached only from `ModuleArea.update()`, which is
 * reached only from `Module.tick()` — and `GameState.UpdateMinigame()`, the one
 * engine mode that owns a minigame, was the one Update* that never called it.
 * UpdateInGame and UpdateDialog both do. Observed live in 211TEL: engine mode
 * MINIGAME, module ready, 47 enemies placed, and the player's update() ran zero
 * times in two seconds, so MIN_RACE_GEAR sat at -5 (the pre-countdown value its
 * OnCreate writes) and the bike never left the line.
 *
 * Two smaller faults kept it dead even once it ticked:
 *  - `spawned` gates triggerHeartbeat(), and only onSpawn() sets it, which the
 *    area runs for creatures and party members but never for minigame objects.
 *    On the swoop the heartbeat script *is* the race.
 *  - Pausing showed InGamePause, whose GameMenu.show() assigns its own
 *    engineMode (INGAME), silently ending the race with no way back.
 *
 * Source-level assertions: importing GameState pulls in the whole engine and
 * THREE's ESM build, which Jest cannot parse here.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const bodyOf = (source: string, signature: string): string => {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
};

describe('minigame mode ticks the module', () => {
  const gameState = read('GameState.ts');
  const updateMinigame = bodyOf(gameState, 'static UpdateMinigame(delta');

  test('UpdateMinigame ticks the module, which is what reaches ModuleMiniGame.tick', () => {
    expect(updateMinigame).toMatch(/GameState\.module\.tick\(delta\)/);
  });

  test('and honours pause the same way UpdateInGame does', () => {
    expect(updateMinigame).toMatch(/GameState\.module\.tickPaused\(delta\)/);
    expect(updateMinigame).toMatch(/EngineState\.PAUSED/);
  });

  test('the minigame tick is still gated on MINIGAME mode inside the area', () => {
    expect(read('module/ModuleArea.ts')).toMatch(
      /GameState\.Mode == EngineMode\.MINIGAME\)\s*\{\s*this\.miniGame\.tick\(delta\)/,
    );
  });
});

describe('the pause overlay does not take ownership of the engine mode', () => {
  const syncPauseOverlay = bodyOf(read('GameState.ts'), 'static syncPauseOverlay()');

  test('any mode change the overlay caused is put back', () => {
    expect(syncPauseOverlay).toMatch(/const modeBeforeOverlay = GameState\.Mode;/);
    expect(syncPauseOverlay).toMatch(
      /GameState\.Mode !== modeBeforeOverlay[\s\S]*SetEngineMode\(modeBeforeOverlay\)/,
    );
  });
});

describe('minigame objects are spawned', () => {
  const init = bodyOf(read('module/ModuleMiniGame.ts'), 'initMiniGameObjects()');

  test.each([
    ['the player', /this\.player\.spawned = true;/],
    ['each enemy', /this\.enemies\[i\]\.spawned = true;/],
    ['each obstacle', /this\.obstacles\[i\]\.spawned = true;/],
  ])('%s is marked spawned, so its heartbeat can run', (_label, pattern) => {
    expect(init).toMatch(pattern);
  });

  test('triggerHeartbeat still requires spawned, so the flag is what unblocks it', () => {
    expect(read('module/ModuleObject.ts')).toMatch(
      /triggerHeartbeat\(\)\{[\s\S]{0,200}this\.spawned === true/,
    );
  });

  test('one enemy without an OnCreate no longer aborts the rest', () => {
    const body = bodyOf(read('module/ModuleMiniGame.ts'), 'runMiniGameScripts()');
    expect(body).toMatch(/if\(!onCreate\)\{ continue; \}/);
    expect(body).not.toMatch(/if\(!onCreate\)\{ return; \}/);
  });
});

/**
 * The swoop's throttle is a gear shift: OnAccelerate upshifts once the current
 * gear's speed is reached and writes the next gear's min/max speed, acceleration
 * and tunnel bounds. Both SWOOPRACE cases in IngameControls were empty, so the
 * bike had no throttle on any input path — flatscreen included — and every race
 * sat at gear 0 doing nothing.
 *
 * TSL puts its jump script in the brake slot (211TEL ships OnBrake = `onjump`,
 * which calls SWMG_SetJumpSpeed), so the brake control is the retail jump.
 */
describe('the swoop has a throttle', () => {
  const controls = read('controls/IngameControls.ts');

  const caseBody = (action: string): string => {
    const at = controls.indexOf(`KeyMapAction.${action}`);
    expect(at).toBeGreaterThan(-1);
    const slice = controls.slice(at, at + 1200);
    const start = slice.indexOf('case MiniGameType.SWOOPRACE:');
    expect(start).toBeGreaterThan(-1);
    return slice.slice(start, slice.indexOf('break;', start));
  };

  test('accelerate runs the OnAccelerate script, which is the gear shift', () => {
    expect(caseBody('MGActionUp')).toMatch(/player\.onAccelerate\(\)/);
  });

  test('brake runs the OnBrake script', () => {
    expect(caseBody('MGActionDown')).toMatch(/player\.onBrake\(\)/);
  });

  test('onBrake exists and falls back to the engine jump when no script is set', () => {
    const player = read('module/ModuleMGPlayer.ts');
    const at = player.indexOf('  onBrake(){');
    expect(at).toBeGreaterThan(-1);
    const body = player.slice(at, at + 300);
    expect(body).toMatch(/MGPlayerOnBrake/);
    expect(body).toMatch(/this\.jump\(\)/);
  });
});
