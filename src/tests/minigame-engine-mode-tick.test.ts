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

/**
 * A minigame player rides a track node: its own `position` stays at the local
 * origin for the whole race while the container's world matrix is what moves.
 * The VR rig anchors to getPlayerPosition(), so in a minigame it parked the
 * rider at the world origin — measured in-headset on 211TEL: rig at y 0.1 with
 * the bike at y -183 and climbing, no bike in sight and the track streaming
 * past.
 */
describe('the VR rig rides the minigame vehicle', () => {
  const gameState = read('GameState.ts');
  // Not bodyOf(): the return type annotation carries braces of its own, which
  // would close the body before it began.
  const seatAt = gameState.indexOf('public static getMiniGameSeat()');
  const seat = gameState.slice(seatAt, gameState.indexOf('public static getCurrentPlayer()', seatAt));

  test('the seat comes from the container world matrix, not the local position', () => {
    expect(seat).toMatch(/container\.updateMatrixWorld\(true\)/);
    expect(seat).toMatch(/matrixWorld\.decompose/);
  });

  test('it only applies inside a minigame', () => {
    expect(seat).toMatch(/GameState\.Mode != EngineMode\.MINIGAME/);
  });

  // The correction grew to a full half turn once it was measured in a headset
  // rather than derived: rig yaw read pi against a travel heading of pi/2.
  // swoop-seat-and-performance.test.ts owns that assertion now.
  test('facing is taken from the direction of travel', () => {
    expect(seat).toMatch(/set\(0, 1, 0\)/);
    expect(seat).toMatch(/Math\.atan2\(/);
  });

  test('the position and facing hooks both consult it', () => {
    for (const hook of ['getPlayerPosition', 'getFacing']) {
      const at = gameState.indexOf(`      ${hook}: () =>`);
      expect(at).toBeGreaterThan(-1);
      expect(gameState.slice(at, at + 260)).toMatch(/getMiniGameSeat\(\)/);
    }
  });

  test('VRSpike still yaws the rig by facing + 90 degrees, which is what that assumes', () => {
    expect(read('vr/VRSpike.ts')).toMatch(/facing \+ Math\.PI \/ 2 \+ VRSpike\.yawOffset/);
  });
});

/**
 * The wall soft-block nudges the rig back when physical head tracking carries
 * the player's head through a wall. It reads the current room's walkmesh, and
 * in a minigame that is a trap: the vehicle rides a track far outside any room,
 * so every frame pushed the rig to "correct" a head that was never coming back
 * inside, which moved the head further out again. Measured in-headset on
 * 211TEL: the rig climbed from y 0.47 to y 1817 within seconds while the bike
 * sat at y -183. From the rider's seat that is a flashing world with no bike.
 */
describe('the wall soft-block stands down in a minigame', () => {
  const gameState = read('GameState.ts');
  const at = gameState.indexOf('getCurrentRoomWalkmesh: () =>');
  const hook = gameState.slice(at, at + 320);

  test('no walkmesh is offered while a minigame owns the frame', () => {
    expect(at).toBeGreaterThan(-1);
    expect(hook).toMatch(/GameState\.Mode == EngineMode\.MINIGAME[\s\S]*return null/);
  });

  test('ordinary play still gets the room walkmesh', () => {
    expect(hook).toMatch(/room\?\.collisionManager\?\.walkmesh/);
  });

  test('VRSpike still applies a correction when one is offered', () => {
    const spike = read('vr/VRSpike.ts');
    expect(spike).toMatch(/getCurrentRoomWalkmesh\?\.\(\)/);
    expect(spike).toMatch(/resolveWallSoftBlockCorrection\(probe, floor\)/);
  });

  // The floor query is tried before the walkmesh, so it must stand down too or
  // the minigame rig runs away exactly as it did before the walkmesh guard.
  test('the walkable-floor query stands down in a minigame as well', () => {
    const floorAt = gameState.indexOf('getSoftBlockFloor: (floorZ) =>');
    expect(floorAt).toBeGreaterThan(-1);
    expect(gameState.slice(floorAt, floorAt + 240)).toMatch(/GameState\.Mode == EngineMode\.MINIGAME[\s\S]*return null/);
  });
});

/**
 * The bug this guards: the minigame policy read `buttons['squeeze']` and
 * `buttons['trigger']`, but XRInputFrameBuilder keys buttons by the gamepad's
 * own index as a string and XRInputRouter binds by index too. No named key ever
 * exists on a real frame, so every read returned 0 — in the headset the grip
 * never closed, the swoop never steered and the throttle never opened. The unit
 * tests passed throughout, because their fixtures were written to the same
 * invention. Assert the two ends agree, at the source, so they cannot drift.
 */
describe('minigame input reads the frame shape the builder writes', () => {
  test('the builder keys buttons by gamepad index', () => {
    expect(read('vr/runtime/XRInputFrameBuilder.ts')).toMatch(/buttons\[String\(index\)\]/);
  });

  test('the policy reads those indices, not invented names', () => {
    const policy = read('vr/runtime/VRMiniGameInputPolicy.ts');
    expect(policy).toMatch(/const XR_STANDARD_TRIGGER = '0';/);
    expect(policy).toMatch(/const XR_STANDARD_SQUEEZE = '1';/);
    expect(policy).toMatch(/SQUEEZE_BUTTONS = \[XR_STANDARD_SQUEEZE\]/);
    expect(policy).toMatch(/TRIGGER_BUTTONS = \[XR_STANDARD_TRIGGER\]/);
  });

  test('no named button key survives anywhere in the policy', () => {
    const policy = read('vr/runtime/VRMiniGameInputPolicy.ts');
    for (const invented of ["'squeeze'", "'trigger'", "'xr-standard-squeeze'", "'xr-standard-trigger'"]) {
      expect(policy.includes(`buttons[${invented}]`)).toBe(false);
    }
  });

  test('the router binds by index too, which is why indices are the shared language', () => {
    expect(read('vr/runtime/XRInputRouter.ts')).toMatch(/controller\.buttons\[binding\.input\.index\]/);
  });
});

/**
 * The swoop carries its own rider: `trider`, a 994-vertex figure inside
 * v_supertrike01, seated exactly where the player is. In first person it reads
 * as a second pair of arms in front of the player's own hands. Measured on
 * 211TEL: 0.47 x 1.53 x 0.81, spanning z +0.42 to +1.24 from the bike origin.
 */
describe('the bike rider is not drawn in first person', () => {
  const gameState = read('GameState.ts');
  const at = gameState.indexOf('public static getFirstPersonHiddenBody()');
  const body = gameState.slice(at, gameState.indexOf('public static getMiniGameSeat()', at));

  test('a minigame hides the vehicle rider', () => {
    expect(at).toBeGreaterThan(-1);
    expect(body).toMatch(/'trider'/);
  });

  test('ordinary play still hides the controlled character', () => {
    // Not the fixed main-PC slot: see vr-first-person-body.test.ts.
    expect(body).toMatch(/GameState\.Mode != EngineMode\.MINIGAME[\s\S]*GameState\.getCurrentPlayer\(\)\?\.model/);
    expect(body).not.toMatch(/PartyManager\.Player/);
  });

  test('the render call asks for it rather than the party leader directly', () => {
    expect(gameState).toMatch(/VRSpike\.render\([\s\S]{0,120}getFirstPersonHiddenBody\(\)/);
  });

  test('the lookup is cached, since it runs once a frame over 340 nodes', () => {
    expect(body).toMatch(/miniGameRiderCache/);
  });
});
