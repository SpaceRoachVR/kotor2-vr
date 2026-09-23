import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The swoop and turret minigames load their data (211TEL: 47 enemies, 105
 * obstacles, 48 tracks; 107PER: the Peragus turret with its gun bank), but
 * every minigame script was dead: `loadScripts()` is defined on the player,
 * enemies and obstacles and was never called from anywhere, so `this.scripts`
 * stayed empty and onCreate / onHeartbeat / onAccelerate / onBrake / onFire /
 * onHitObstacle / onTrackLoop / onDeath all looked up nothing.
 *
 * `initMiniGameObjects()` does fire onCreate during area init, which is how the
 * gap stayed hidden: the call happened, the handler found no script.
 *
 * Verified live afterwards: 211TEL loads OnCreate, OnHeartbeat, OnAccelerate,
 * OnBrake, OnHitFollower and OnHitObstacle, and driving the player advances the
 * track 119 units with steering applied. 107PER has no scripts in its data
 * (retail ships none) and its gun bank fires a bullet.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('minigame objects load their scripts', () => {
  test.each([
    ['module/ModuleMGPlayer.ts', '  load(){'],
    ['module/ModuleMGEnemy.ts', '  async load(){'],
    ['module/ModuleMGObstacle.ts', '  setTemplate(template: GFFObject){'],
  ])('%s calls loadScripts() when it initialises', (file, entry) => {
    const source = read(file);
    const at = source.indexOf(entry);
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at, at + 600)).toContain('this.loadScripts();');
  });

  test('the script keys match the field labels in the ARE MiniGame struct', () => {
    // Retail 211TEL names them OnCreate, OnHeartbeat, OnAccelerate, OnBrake,
    // OnHitFollower, OnHitObstacle; the enum has to agree or nothing loads.
    const enumSource = read('enums/module/ModuleObjectScript.ts');
    for (const [key, label] of [
      ['MGPlayerOnCreate', 'OnCreate'], ['MGPlayerOnHeartbeat', 'OnHeartbeat'],
      ['MGPlayerOnAccelerate', 'OnAccelerate'], ['MGPlayerOnBrake', 'OnBrake'],
      ['MGPlayerOnHitObstacle', 'OnHitObstacle'], ['MGPlayerOnTrackLoop', 'OnTrackLoop'],
    ]) {
      expect(enumSource).toContain(`${key} = '${label}'`);
    }
  });
});

describe('SWMG routines the shipped scripts call', () => {
  const k2 = read('nwscript/NWScriptDefK2.ts');
  const body = (id: number) => {
    const at = k2.indexOf(`\n  ${id}: {`);
    expect(at).toBeGreaterThan(-1);
    return k2.slice(at, at + 1400);
  };

  test.each([
    [619, 'SWMG_GetSphereRadius', 'sphere_radius'],
    [648, 'SWMG_SetPlayerInvincibility', 'invince_period'],
    [789, 'SWMG_GetTrackPosition', 'track'],
    [790, 'SWMG_SetFollowerPosition', 'track.position.copy'],
    [792, 'SWMG_DestroyMiniGameObject', 'splice'],
    [804, 'SWMG_SetJumpSpeed', 'jumpVelcolity'],
    [825, 'SWMG_PlayerApplyForce', 'track?.position.add'],
  ])('%i %s is implemented', (id, name, needle) => {
    const source = body(id as number);
    expect(source).toContain(`name: '${name}'`);
    expect(source).toContain('action: function');
    expect(source).toContain(needle as string);
  });
});
