import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, test } from '@jest/globals';

const { parseAssetServerArguments, discoverModLayers } = require('../../tools/asset-http/asset-server');

/**
 * Standing mod layers live in <userRoot>/mods, the location the asset service
 * already sanctions ("mod roots nested under userRoot must be inside
 * userRoot/mods"). They are numbered because later layers win: 03-tslrcm
 * overrides 01-uco-redux, and all of them override retail.
 *
 * The emulator harness passes --no-mods. Parity snapshots and the module sweep
 * are taken through it, and those have to describe retail rather than whatever
 * the player has layered on, or the baselines stop meaning anything.
 */
describe('mod layer discovery', () => {
  const makeUserRoot = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2vr-mods-'));
    fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
    return root;
  };

  test('finds nothing when there is no mods directory', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2vr-empty-'));
    expect(discoverModLayers(empty)).toEqual([]);
  });

  test('returns layers in name order, so the numbering decides precedence', () => {
    const root = makeUserRoot();
    for (const name of ['02-second', '01-first', '03-third']) {
      fs.mkdirSync(path.join(root, 'mods', name));
    }
    expect(discoverModLayers(root).map((p: string) => path.basename(p)))
      .toEqual(['01-first', '02-second', '03-third']);
  });

  test('ignores loose files in the mods directory', () => {
    const root = makeUserRoot();
    fs.mkdirSync(path.join(root, 'mods', '01-layer'));
    fs.writeFileSync(path.join(root, 'mods', 'notes.txt'), 'not a layer');
    expect(discoverModLayers(root).map((p: string) => path.basename(p))).toEqual(['01-layer']);
  });
});

describe('opting out of mod layers', () => {
  const defaults = { gameRoot: 'C:\\game', userRoot: 'C:\\user', distRoot: 'C:\\dist', port: 8479 };

  test('layers are on by default, so playing picks them up', () => {
    expect(parseAssetServerArguments([], defaults).discoverModLayers).toBe(true);
  });

  test('--no-mods turns them off for measurement runs', () => {
    expect(parseAssetServerArguments(['--no-mods'], defaults).discoverModLayers).toBe(false);
  });

  test('--no-mods still allows an explicit --mod root', () => {
    const result = parseAssetServerArguments(['--no-mods', '--mod', 'C:\\layer'], defaults);
    expect(result.discoverModLayers).toBe(false);
    expect(result.modRoots).toEqual([path.resolve('C:\\layer')]);
  });

  test('the emulator harness opts out', () => {
    const harness = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'vr-emulator', 'asset-service.js'), 'utf8');
    expect(harness).toContain("'--no-mods'");
  });
});
