import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Three faults reported from the headset, all confirmed by driving the real VR
 * input path against a live 211TEL race through the emulator harness.
 *
 * Source-level assertions: importing these modules pulls in THREE's ESM build,
 * which Jest cannot parse here. The behaviour is covered by that probe.
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

/**
 * "Letting off the trigger does nothing as the throttle stays open." The swoop
 * accelerated every frame for as long as a gear was engaged — nothing read
 * whether accelerate was still held, so the bike climbed to the gear ceiling
 * and stayed. Probe before: speed pinned at maximum. After: 38 while held,
 * falling to the gear floor of 28 on release.
 */
describe('the throttle can be let off', () => {
  const player = read('module/ModuleMGPlayer.ts');
  const update = player.slice(player.indexOf('  update(delta'), player.indexOf('  updatePaused('));

  test('acceleration only applies while it is being asked for', () => {
    expect(update).toMatch(/if\(this\.isAccelerating\(\)\)\{[\s\S]*?this\.speed \+= \(this\.accel_secs \* delta\)/);
  });

  test('letting off falls back towards the gear floor, not to a standstill', () => {
    expect(update).toMatch(/this\.speed -= \(this\.accel_secs \* delta\)/);
    expect(update).toMatch(/if\(this\.speed < this\.speed_min\)\{[\s\S]{0,60}this\.speed = this\.speed_min/);
  });

  test('the request is a timestamp, because neither input path has a release event', () => {
    expect(player).toMatch(/accelerationRequestedAt/);
    expect(bodyOf(player, '  isAccelerating()')).toMatch(/ACCELERATION_REQUEST_TTL_MS/);
  });

  test.each([
    ['flatscreen', 'controls/IngameControls.ts'],
    ['VR', 'GameState.ts'],
  ])('%s renews the request while the control is held', (_label, file) => {
    expect(read(file)).toMatch(/requestAcceleration\??\.?\(\)/);
  });
});

/**
 * "Area obstacles had no effect as I drove through several solid structures."
 * The scripts set the tunnel and the engine stored it, but only the turret read
 * it — to clamp rotation. Nothing confined the swoop, so a rider who kept
 * steering left the track entirely.
 */
describe('the tunnel keeps the bike on the track', () => {
  const player = read('module/ModuleMGPlayer.ts');
  const clamp = bodyOf(player, '  clampToTunnel()');

  // The clamp moved from the track node to the rider's offset from the hook
  // once the course animation took over forward motion: the track node is no
  // longer translated at all, so clamping it would confine nothing.
  // Clamped about the measured middle of the road, not the line the hook
  // happens to drop the rider on.
  test('the lateral offset is clamped to the tunnel', () => {
    expect(clamp).toMatch(/this\.container\.position\.x > centre \+ pos\.x/);
    expect(clamp).toMatch(/this\.container\.position\.x < centre \+ neg\.x/);
  });

  test('hop height is clamped too', () => {
    expect(clamp).toMatch(/this\.container\.position\.z/);
  });

  test('the along-track axis is deliberately left alone', () => {
    expect(clamp).not.toMatch(/position\.y/);
  });

  test('it runs after the frame movement is applied', () => {
    const step = bodyOf(player, '  stepLateral(delta: number)');
    const move = step.indexOf('this.container.position.x = centre + result.state.position');
    const call = step.indexOf('this.clampToTunnel()');
    expect(move).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(move);
  });
});

/**
 * Found while verifying the tunnel, and far wider than the swoop: every
 * NWScript routine taking a vector received it reversed.
 *
 * The compiler pushes x, then y, then z, so z is on top and the first pop is z.
 * Building a Vector3 straight from three pops made the first pop x. Measured on
 * 211TEL: onaccelerate assigns struct1.x = -20, .y = 3, .z = 0 and calls
 * SWMG_SetPlayerTunnelNeg(struct1), and the engine stored tunnel.neg.x = 0. The
 * swoop's tunnel came out 0..10 across rather than -20..20 — which pins the
 * bike at centre and makes a left turn impossible. After the fix the probe
 * reads pos.x 20, neg.x -20, and steering moves +/-14 symmetrically.
 */
describe('NWScript vectors arrive the right way round', () => {
  const body = read('nwscript/NWScriptInstructionSet.ts');
  const vectorCase = body.slice(
    body.indexOf('case NWScriptDataType.VECTOR:'),
    body.indexOf('default:', body.indexOf('case NWScriptDataType.VECTOR:')),
  );

  test('z is popped first, x last', () => {
    const z = vectorCase.indexOf('const z =');
    const y = vectorCase.indexOf('const y =');
    const x = vectorCase.indexOf('const x =');
    expect(z).toBeGreaterThan(-1);
    expect(y).toBeGreaterThan(z);
    expect(x).toBeGreaterThan(y);
  });

  test('and the vector is assembled x, y, z', () => {
    expect(vectorCase).toMatch(/new THREE\.Vector3\(x, y, z\)/);
  });

  test('the push side writes x first too, so a script reading .z off a returned vector gets z', () => {
    // Pushed z-first, the top float of a returned vector was x: 211TEL's
    // onjump read the rider's lateral offset as height and refused every jump
    // taken right of centre (probe-swoop-vr.js: midAirPressIgnored went from
    // false to true with this order alone).
    expect(read('nwscript/NWScriptStack.ts')).toMatch(
      /VECTOR[\s\S]{0,700}value: data\.x[\s\S]{0,120}value: data\.y[\s\S]{0,120}value: data\.z/,
    );
  });
});
