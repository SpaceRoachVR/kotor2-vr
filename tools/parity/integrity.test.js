const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { deriveCaptureId, validateCanonicalCaptureManifest } = require('./parity-contract');
const { createEngineIdentity } = require('./engine-snapshot');
const { classifyModelPresentation, compareModelPresentation } = require('./compare');
const { rewriteRuntimeDocument } = require('../asset-http/runtime-document');

const fresh = { module: '101per', loadedFromSave: false, bootstrap: 'new-game-ui', playerName: 'T3-M4', partySize: 1 };
const identity = { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) };
const retail = { module: '101per', creatures: [], textures: [], retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }] };

test('promotion revalidates actual retained state despite a forged fresh identity', () => {
  for (const invalid of [{ loadedFromSave: true }, { loadedFromSave: null }, { freshState: false }, { bootstrap: 'save-load' }, { playerName: 'Exile' }, { partySize: 3 }, { module: '102per' }]) {
    const contents = { engine: JSON.stringify({ ...fresh, ...invalid, engineIdentity: identity }), retail: JSON.stringify(retail), comparison: JSON.stringify({ module: '101per', findings: [] }) };
    const artifacts = Object.fromEntries(Object.entries(contents).map(([name, bytes]) => [name, { sha256: crypto.createHash('sha256').update(bytes).digest('hex') }]));
    const captureId = deriveCaptureId('101per', artifacts);
    for (const [name, artifact] of Object.entries(artifacts)) artifact.path = `tools/parity/out/captures/101per/${captureId}/${name}.json`;
    assert.throws(() => validateCanonicalCaptureManifest({ schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts }, Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [artifact.path, contents[name]]))), /save|bootstrap|T3-M4|module/i);
    assert.throws(() => createEngineIdentity({ ...fresh, ...invalid }, { servingBundleSha256: identity.servingBundleSha256, requestedModule: '101PER' }), /save|bootstrap|T3-M4|module/i);
  }
});

test('promotion reconciles optional duplicated identity fields with retained observations', () => {
  for (const contradiction of [{ bootstrap: 'save-load' }, { playerName: 'Exile' }, { partySize: 3 }]) {
    const contents = {
      engine: JSON.stringify({ ...fresh, engineIdentity: { ...identity, ...contradiction } }),
      retail: JSON.stringify(retail), comparison: JSON.stringify({ module: '101per', findings: [] }),
    };
    const artifacts = Object.fromEntries(Object.entries(contents).map(([name, bytes]) => [name, {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }]));
    const captureId = deriveCaptureId('101per', artifacts);
    for (const [name, artifact] of Object.entries(artifacts)) artifact.path = `tools/parity/out/captures/101per/${captureId}/${name}.json`;
    const retained = Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [artifact.path, contents[name]]));
    assert.throws(() => validateCanonicalCaptureManifest({ schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts }, retained), /disagrees/i);
  }
});

test('authored creature bind pose requires the loaded retail model identity', () => {
  const authored = { template: 'kreia', gitIndex: 0, objectType: 'placeable', modelKind: 'creature', modelName: ' P_Kreia ' };
  assert.equal(classifyModelPresentation(authored, { modelStatus: 'loaded', modelName: 'p_kreia', animationApplied: false }), 'authored-retail-behavior');
  for (const modelName of [undefined, null, '', 'plc_chair']) {
    const observed = { template: 'kreia', modelStatus: 'loaded', modelName, animationApplied: false };
    assert.equal(classifyModelPresentation(authored, observed), 'missing-evidence');
    const findings = [];
    compareModelPresentation({ modelPresentation: [authored] }, { modelPresentation: [observed] }, (finding) => findings.push(finding));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].classification, 'missing-evidence');
  }
});

test('classic script eligibility applies legacy for/event and ASCII normalization', () => {
  const rewrite = (attributes) => rewriteRuntimeDocument(`<script ${attributes} src="/KotOR.js"></script>`, 'http://localhost/game/index.html', { sha256: 'a'.repeat(64), integrity: 'sha256-fixture' });
  for (const attributes of ['for="document" event="onload"', 'for="window" event="onclick"', 'for="" event=""', 'for="\u00a0window" event="onload"', 'for="window" event="\ufeffonload"', 'type="\u00a0text/javascript"', 'type="text/javascript\ufeff"', 'type="\ufeffmodule"', 'language="javaſcript"']) assert.equal(rewrite(attributes), null, attributes);
  for (const attributes of ['for="window" event="onload"', 'for=" WINDOW " event=" ONLOAD() "', 'for="document"', 'event="onclick"', 'type="module" for="document" event="onclick"', 'type="text/javascript"', 'type=" \tTEXT/JAVASCRIPT\n"']) assert.match(rewrite(attributes), /\/bundles\//, attributes);
});

test('JavaScript essence matching does not parse MIME parameters from script type', () => {
  const bundle = { sha256: 'a'.repeat(64), integrity: 'sha256-fixture' };
  for (const type of ['text/javascript; charset=utf-8', ' APPLICATION/JAVASCRIPT ; charset=UTF-8 ']) {
    const inert = `<script type="${type}" src="/KotOR.js"></script>`;
    assert.equal(rewriteRuntimeDocument(inert, 'http://localhost/game/index.html', bundle), null);
    for (const document of [inert + '<script src="/KotOR.js"></script>', '<script src="/KotOR.js"></script>' + inert]) {
      const rewritten = rewriteRuntimeDocument(document, 'http://localhost/game/index.html', bundle);
      assert.ok(rewritten.includes(inert));
      assert.equal(rewritten.match(/src="\/bundles\//g).length, 1);
    }
  }
});

test('a refresh after comparison cannot replace bytes retained with MusicDay findings', () => {
  const root = path.join(__dirname, 'out');
  fs.mkdirSync(root, { recursive: true });
  const moduleName = `race_${crypto.randomBytes(4).toString('hex')}`;
  const file = (suffix) => path.join(root, `${moduleName}.${suffix}`);
  const engine = { ...fresh, module: moduleName, engineIdentity: { ...identity, module: moduleName.toUpperCase() }, creatures: [], textures: [], audio: { area: { MusicDay: 2 }, sounds: [] } };
  const inputRetail = { ...retail, module: moduleName, audio: { area: { MusicDay: 1 }, tracks: {}, sounds: [] } };
  const originalWrite = fs.writeFileSync;
  let retainedDirectory;
  try {
    originalWrite(file('engine.json'), JSON.stringify(engine));
    originalWrite(file('retail.json'), JSON.stringify(inputRetail));
    originalWrite(file('evidence.json'), JSON.stringify({ module: moduleName, records: [] }));
    fs.writeFileSync = function (target, ...args) {
      const result = originalWrite.call(this, target, ...args);
      if (target === file('parity.md')) {
        originalWrite(file('engine.json'), JSON.stringify({ ...engine, audio: { area: { MusicDay: 99 }, sounds: [] } }));
        originalWrite(file('retail.json'), JSON.stringify({ ...inputRetail, audio: { area: { MusicDay: 99 }, tracks: {}, sounds: [] } }));
        originalWrite(file('evidence.json'), JSON.stringify({ module: 'foreign', records: [] }));
      }
      return result;
    };
    require('./compare').main(['--module', moduleName]);
    const report = JSON.parse(fs.readFileSync(file('parity.json'), 'utf8'));
    retainedDirectory = path.dirname(report.captureManifestPath);
    const { toParityDefectRecords } = require('./ledger-adapter');
    const records = toParityDefectRecords(report, file('parity.json'));
    assert.equal(records.length, 1);
    const savedEngine = JSON.parse(fs.readFileSync(path.join(retainedDirectory, 'engine.json'), 'utf8'));
    const savedRetail = JSON.parse(fs.readFileSync(path.join(retainedDirectory, 'retail.json'), 'utf8'));
    assert.equal(fs.readFileSync(path.join(retainedDirectory, 'engine.json'), 'utf8'), JSON.stringify(engine));
    assert.equal(fs.readFileSync(path.join(retainedDirectory, 'retail.json'), 'utf8'), JSON.stringify(inputRetail));
    assert.equal(fs.readFileSync(path.join(retainedDirectory, 'sidecar.json'), 'utf8'), JSON.stringify({ module: moduleName, records: [] }));
    assert.equal(savedEngine.audio.area.MusicDay, 2);
    assert.equal(savedRetail.audio.area.MusicDay, 1);
    assert.match(records[0].observed, /2/);
  } finally {
    fs.writeFileSync = originalWrite;
    for (const suffix of ['engine.json', 'retail.json', 'evidence.json', 'parity.json', 'parity.md']) if (fs.existsSync(file(suffix))) fs.unlinkSync(file(suffix));
    if (retainedDirectory) fs.rmSync(retainedDirectory, { recursive: true, force: true });
  }
});
