import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * UTS sound objects have three play styles: Looping (seamless), Continuous
 * (repeat on Interval), and neither ("once": play one sound and stop, used by
 * inactive objects a script plays). ModuleSound saved Continuous but never
 * loaded it, and AudioEmitter repeated every emitter regardless, so a
 * script-triggered one-shot replayed forever. Found by tools/parity: retail
 * Continuous=true on 11 Peragus sound objects, engine false on all of them.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('sound object play style', () => {
  test('ModuleSound loads Continuous and hands it to the emitter', () => {
    const source = read('module/ModuleSound.ts');
    expect(source).toContain("hasField('Continuous')");
    expect(source).toContain('this.audioEmitter.isContinuous = this.continuous;');
  });

  test('an emitter that is neither looping nor continuous stops after one sound', () => {
    const source = read('audio/AudioEmitter.ts');
    const onEnded = source.slice(source.indexOf('  playNextSound(): void {'), source.indexOf('  async addSound('));
    expect(onEnded).toMatch(/if\(!this\.isLooping && !this\.isContinuous\)\{\s*this\.state = AudioEmitterState\.STOPPED;/);
    // Non-sound-object emitters keep the old always-repeat behaviour.
    expect(source).toContain('isContinuous: boolean = true;');
  });
});
