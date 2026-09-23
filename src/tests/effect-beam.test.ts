import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Round 12 (F14): T3's shock arm and flamethrower showed no beam. Three faults:
 * the beam attached only if its model had already loaded when applied (never);
 * it was never taken down; and 2DA cells arrive as strings, so the strict
 * switch on progfx_duration matched no case and every beam drew the cold ray.
 */
const beam = fs.readFileSync(path.join(__dirname, '..', 'effects', 'EffectBeam.ts'), 'utf8');

describe('EffectBeam', () => {
  test('picks the beam model from the numeric progfx_duration', () => {
    expect(beam).toContain('switch(Number(this.visualEffect?.progfx_duration)){');
    expect(beam).toMatch(/case 614:\s*this\.modelName = 'v_flame_dur';/);
    expect(beam).toMatch(/case 615:\s*this\.modelName = 'v_stunray_dur';/);
  });

  test('attaches when the model finishes loading, not only if it already had', () => {
    expect(beam).toMatch(/onComplete: \(model: OdysseyModel3D\) => \{\s*this\.model = model;[\s\S]{0,200}if\(this\.applied\) this\.attachBeam\(\);/);
    expect(beam).toMatch(/super\.onApply\(\);\s*this\.attachBeam\(\);/);
  });

  test('is taken down with the effect, and a late load is dropped', () => {
    expect(beam).toMatch(/onRemove\(\)\{\s*this\.removed = true;[\s\S]{0,200}this\.model\.removeFromParent\(\);/);
    expect(beam).toContain('if(this.removed || !(this.model instanceof OdysseyModel3D)) return;');
  });

  test('plays the beam sound from the caster', () => {
    expect(beam).toContain('this.visualEffect?.soundduration');
    expect(beam).toContain('caster.audioEmitter.playSound(sound)');
  });
});
