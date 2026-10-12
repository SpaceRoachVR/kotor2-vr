const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DESTINATIONS, nextUnusedSaveId, validateLocation, publishSaves } = require('./planet-survey-saves');

test('planet fixtures have unique names and modules', () => {
  assert.equal(DESTINATIONS.length, 8);
  assert.equal(new Set(DESTINATIONS.map(d => d.name)).size, 8);
  assert.equal(new Set(DESTINATIONS.map(d => d.module)).size, 8);
});
test('publisher preserves existing saves, checks bytes, and rejects repeated or incomplete manifests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-publish-test-'));
  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(target, '000708 - Game707'), {recursive:true});
  const sentinel = path.join(target, '000708 - Game707', 'savenfo.res');
  fs.writeFileSync(sentinel, 'existing');
  const manifestPath = path.join(root, 'manifest.json');
  const report = {completed:true, userRoot:path.join(root, 'user'), saves:[]};
  for (let i = 0; i < DESTINATIONS.length; i++) {
    const directory = `Saves/${String(i + 3).padStart(6, '0')} - Game${i + 2}`;
    fs.mkdirSync(path.join(report.userRoot, directory), {recursive:true});
    for (const name of ['savenfo.res', 'SAVEGAME.sav', 'GLOBALVARS.res', 'PARTYTABLE.res', 'Screen.tga']) {
      fs.writeFileSync(path.join(report.userRoot, directory, name), `fixture-${i}-${name}`);
    }
    report.saves.push({...DESTINATIONS[i], directory, reloadVerified:true});
  }
  fs.writeFileSync(manifestPath, JSON.stringify({...report, completed:false}));
  assert.throws(() => publishSaves(manifestPath, target), /complete/);
  fs.writeFileSync(manifestPath, JSON.stringify(report));
  const published = publishSaves(manifestPath, target);
  assert.equal(published.length, 8);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'existing');
  assert.equal(path.basename(published[0].directory), '000709 - Game708');
  assert.match(published[0].hashes['savenfo.res'], /^[a-f0-9]{64}$/);
  assert.throws(() => publishSaves(manifestPath, target), /not already published/);
});
test('publishing allocates beyond existing slots, ignoring unrelated folders', () => {
  assert.equal(nextUnusedSaveId(['000708 - Game707', '001025 - Game1024', 'unrelated']), 1026);
  assert.equal(nextUnusedSaveId([]), 2);
  assert.throws(() => nextUnusedSaveId(['999999 - Game999998']), /exhausted/);
});
test('readiness requires live player, intended location, gameplay and advancing XR frames', () => {
  const d = DESTINATIONS[0];
  const state = {module:d.module, ready:true, loading:false, playerFound:true, modelFound:true,
    presenting:true, advancedFrames:10, mode:1, hp:30, position:{x:1,y:2,z:3}};
  validateLocation(state, d);
  for (const [key, value] of Object.entries({module:'102PER', ready:false, loading:true,
    playerFound:false, modelFound:false, presenting:false, advancedFrames:9, mode:3, hp:0,
    position:{x:NaN,y:0,z:0}})) {
    assert.throws(() => validateLocation({...state, [key]:value}, d), /not playable/);
  }
  for (const patch of [{position:{}}, {advancedFrames:NaN}, {hp:NaN}]) {
    assert.throws(() => validateLocation({...state, ...patch}, d), /not playable/);
  }
});
