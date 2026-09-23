const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareCreatures, compareTextures, compareAudio, compareModelPresentation,
  validateEvidenceSidecar, evidenceMatchesFinding, linkEvidence, normalizeFindingForReport,
} = require('./compare');

const sidecarPath = 'tools/parity/out/101per.evidence.json';
function input(resref, restype, source = 'module') {
  return { resref, restype, source, sha256: 'a'.repeat(64) };
}

function linkedFindings(producer, retail, engine, kind, identities) {
  const records = validateEvidenceSidecar({ module: '101PER', records: identities.map((identity) => ({
    ...identity, kind, authority: kind === 'kotormcp' ? 'parsed-retail' : 'human-review', path: sidecarPath,
  })) }, retail, '101PER');
  const findings = [];
  producer(retail, engine, (finding) => findings.push(normalizeFindingForReport(linkEvidence(finding, records, sidecarPath))));
  return findings;
}

const creature = { status: 'ok', template: 'shared', gitIndex: 0, source: 'module', str: 10,
  skills: [], classes: [], feats: [], equipment: {} };
const sound = { status: 'ok', template: 'shared', gitIndex: 0, source: 'module', continuous: true,
  volume: 75, sounds: ['noise'], soundSources: { noise: 'streamsounds' } };
const model = { status: 'ok', template: 'prop', gitIndex: 0, source: 'module', objectType: 'placeable',
  modelName: 'shared', modelKind: 'creature', modelResourceIdentity: input('shared', 'MDL') };

for (const kind of ['kotormcp', 'holocron']) {
  const cases = [
    { name: 'creature stats and equipment', producer: compareCreatures, identity: input('shared', 'UTC'),
      retail: { creatures: [creature] }, engine: { creatures: [{ ...creature, str: 8, equipment: { HEAD: 'helmet' } }] } },
    { name: 'UTS settings, play style, files, and decode', producer: compareAudio, identity: input('shared', 'UTS'),
      retail: { audio: { area: {}, sounds: [sound] } },
      engine: { audio: { area: {}, sounds: [{ ...sound, continuous: false, volume: 25, sounds: [], decoded: [] }] } } },
    { name: 'authored MDL presentation', producer: compareModelPresentation, identity: input('shared', 'MDL'),
      retail: { modelPresentation: [model] }, engine: { modelPresentation: [{ ...model, modelStatus: 'loaded', animationApplied: false }] } },
    { name: 'unspawned UTP', producer: compareModelPresentation, identity: input('prop', 'UTP'),
      retail: { modelPresentation: [model] }, engine: { modelPresentation: [] } },
    ...['TPC', 'TGA'].map((restype) => ({ name: `selected ${restype} texture`, producer: compareTextures,
      identity: input('shared', restype, 'override'),
      retail: { textures: [{ resref: 'shared', retailSource: 'override',
        retail: { source: 'override', resourceIdentity: input('shared', restype, 'override') }, locations: [] }] },
      engine: { textures: [{ requestedResref: 'shared', status: 'missing', searchedSources: [] }] } })),
  ];
  for (const fixture of cases) {
    test(`${kind} evidence links actual ${fixture.name} findings by full resource identity`, () => {
      const retail = { module: '101per', ...fixture.retail, retailInputs: [fixture.identity] };
      const findings = linkedFindings(fixture.producer, retail, fixture.engine, kind, [fixture.identity]);
      assert.ok(findings.length > 0);
      for (const finding of findings) {
        assert.deepEqual(finding.resourceIdentity, fixture.identity);
        assert.deepEqual(finding.evidenceRefs, [sidecarPath]);
      }
      const wrongType = { ...fixture.identity, restype: fixture.identity.restype === 'TPC' ? 'TGA' : 'TPC' };
      for (const mismatchedIdentity of [wrongType,
        { ...fixture.identity, sha256: 'b'.repeat(64) },
        { ...fixture.identity, source: 'another-layer' },
        { ...fixture.identity, source: undefined }]) {
        const unlinked = linkedFindings(fixture.producer, retail, fixture.engine, kind, [mismatchedIdentity]);
        assert.deepEqual(unlinked.map(({ evidenceRefs, ...finding }) => finding), findings.map(({ evidenceRefs, ...finding }) => finding));
        assert.ok(unlinked.every((finding) => finding.evidenceRefs === undefined));
      }
      if (fixture.name.includes('presentation')) assert.equal(findings[0].classification, 'authored-retail-behavior');
      if (fixture.name.includes('play style')) assert.equal(findings[0].classification, 'missing-evidence');
    });
  }
  test(`${kind} evidence distinguishes duplicate layers containing identical selected texture bytes`, () => {
    const selected = input('shared', 'TPC', 'override');
    const shadowed = input('shared', 'TPC', 'texture-pack');
    const retail = { retailInputs: [selected, shadowed], textures: [{ resref: 'shared', retailSource: 'override',
      namedByRetailModels: true, retail: { resourceIdentity: selected },
      locations: [{ resourceIdentity: selected }, { resourceIdentity: shadowed }] }] };
    for (const identities of [[shadowed], [{ ...selected, source: undefined }]]) {
      const findings = linkedFindings(compareTextures, retail, { textures: [] }, kind, identities);
      assert.equal(findings.length, 1);
      assert.deepEqual(findings[0].resourceIdentity, selected);
      assert.equal(findings[0].evidenceRefs, undefined);
    }
    const matching = linkedFindings(compareTextures, retail, { textures: [] }, kind, [shadowed, selected]);
    assert.deepEqual(matching[0].evidenceRefs, [sidecarPath]);
    // An unqualified captured selection cannot establish which layer was used.
    retail.textures[0].retail.resourceIdentity = { ...selected, source: undefined };
    const ambiguous = linkedFindings(compareTextures, retail, { textures: [] }, kind, [selected, shadowed]);
    assert.equal(ambiguous[0].resourceIdentity, undefined);
    assert.equal(ambiguous[0].evidenceRefs, undefined);
  });
}

test('full identity requires nonempty exact original source strings on both sides', () => {
  const selected = input('shared', 'TPC', 'Override/Shared.tpc');
  const sources = [undefined, null, 123, '', '   ', '\t', 'override/shared.tpc',
    ' Override/Shared.tpc', 'Override/Shared.tpc '];
  for (const source of sources) {
    for (const [recordSource, findingSource] of [[source, selected.source], [selected.source, source],
      ...([undefined, null, 123, '', '   ', '\t'].includes(source) ? [[source, source]] : [])]) {
      const finding = Object.freeze({ resourceIdentity: { ...selected, source: findingSource } });
      const record = { ...selected, source: recordSource };
      assert.equal(evidenceMatchesFinding(record, finding), false);
      assert.equal(linkEvidence(finding, [record], sidecarPath), finding);
    }
  }
  for (const source of [selected.source, ' Override/Shared.tpc ']) {
    assert.equal(evidenceMatchesFinding({ ...selected, source }, { resourceIdentity: { ...selected, source } }), true);
  }
});

for (const kind of ['kotormcp', 'holocron']) {
  test(`${kind} producer/linker refuses missing, blank, or normalized source provenance`, () => {
    for (const [capturedSource, recordSource] of [[undefined, undefined], ['', ''], ['   ', '   '],
      ['Override/Shared.tpc', 'override/shared.tpc'], ['Override/Shared.tpc', ' Override/Shared.tpc ']]) {
      const selected = { ...input('shared', 'TPC'), source: capturedSource };
      const findings = linkedFindings(compareTextures, { retailInputs: [selected], textures: [{
        resref: 'shared', namedByRetailModels: true, retailSource: 'override', retail: { resourceIdentity: selected },
      }] }, { textures: [] }, kind, [{ ...selected, source: recordSource }]);
      assert.equal(findings.length, 1);
      assert.equal(findings[0].evidenceRefs, undefined);
    }
  });
}

test('linking requires a complete valid captured hash and preserves the input finding', () => {
  const selected = input('shared', 'TPC', 'override');
  const record = { ...selected, path: sidecarPath };
  for (const sha256 of [undefined, null, 123, '', 'not-a-hash']) {
    const finding = Object.freeze({ resourceIdentity: { ...selected, sha256 }, evidenceRefs: ['existing.json'] });
    assert.equal(linkEvidence(finding, [record], sidecarPath), finding);
  }
  const finding = Object.freeze({ resourceIdentity: selected, evidenceRefs: Object.freeze(['existing.json']) });
  assert.deepEqual(linkEvidence(finding, [{ ...record, sha256: selected.sha256.toUpperCase() }], sidecarPath).evidenceRefs,
    ['existing.json', sidecarPath]);
  assert.deepEqual(finding.evidenceRefs, ['existing.json']);
});

test('area audio uses the captured GIT identity and missing tracks use their authored 2DA', () => {
  const git = input('area_layout', 'GIT');
  const table = input('ambientmusic', 'TWODA');
  const findings = linkedFindings(compareAudio, { module: '101per', retailInputs: [git, table], audio: {
    resourceIdentity: git, area: { MusicDay: 4 }, sounds: [],
    tracks: { MusicDay: { resource: 'missing_music', retailSource: 'none', resourceIdentity: table } },
  } }, { audio: { area: { MusicDay: 2 }, sounds: [] } }, 'kotormcp', [git, table]);
  assert.deepEqual(findings.map((finding) => finding.resourceIdentity), [git, table]);
  assert.ok(findings.every((finding) => finding.evidenceRefs?.includes(sidecarPath)));
});

test('texture winner controls identity even when the same name exists in both formats', () => {
  const tga = input('shared', 'TGA', 'override');
  const tpc = input('shared', 'TPC', 'texture-pack');
  const retail = { retailInputs: [tga, tpc], textures: [{ resref: 'shared', retailSource: 'override',
    namedByRetailModels: true, retail: { resourceIdentity: tga }, locations: [{ resourceIdentity: tga }, { resourceIdentity: tpc }] }] };
  const findings = linkedFindings(compareTextures, retail, { textures: [] }, 'holocron', [tpc]);
  assert.deepEqual(findings[0].resourceIdentity, tga);
  assert.equal(findings[0].evidenceRefs, undefined);
  delete retail.textures[0].retail.resourceIdentity;
  const unknown = linkedFindings(compareTextures, retail, { textures: [] }, 'holocron', [tga, tpc]);
  assert.equal(unknown[0].resourceIdentity, undefined);
  assert.equal(unknown[0].evidenceRefs, undefined);
});

test('ordinary creature findings cannot link a same-name validated DeNCS hypothesis', () => {
  const utc = input('shared', 'UTC');
  const ncs = input('shared', 'NCS');
  const retail = { creatures: [creature], retailInputs: [utc, ncs] };
  const records = validateEvidenceSidecar({ module: '101PER', records: [{ ...ncs, kind: 'dencs', authority: 'hypothesis' }] }, retail, '101PER');
  const findings = [];
  compareCreatures(retail, { creatures: [{ ...creature, str: 8 }] }, (finding) => findings.push(linkEvidence(finding, records, sidecarPath)));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].resourceIdentity.restype, 'UTC');
  assert.equal(findings[0].evidenceRefs, undefined);
  assert.equal(findings[0].confidence, 'defect');
});

test('absent, ambiguous, malformed, and stale retail identities do not manufacture links', () => {
  const selected = input('shared', 'TPC', 'override');
  for (const identity of [undefined, { resref: 'shared', restype: 'TPC' },
    { ...selected, sha256: 123 }, { ...selected, sha256: 'b'.repeat(64) }]) {
    const findings = linkedFindings(compareTextures, { retailInputs: [selected, input('shared', 'TPC', 'texture-pack')],
      textures: [{ resref: 'shared', namedByRetailModels: true, retailSource: 'override', retail: { resourceIdentity: identity } }],
    }, { textures: [] }, 'kotormcp', [selected]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].resourceIdentity, undefined);
    assert.equal(findings[0].evidenceRefs, undefined);
  }
});

test('each model load and identity finding retains its MDL, with UTP fallback if unavailable', () => {
  const mdl = input('shared', 'MDL');
  const utp = input('prop', 'UTP');
  for (const observed of [{ modelStatus: 'missing' }, { modelStatus: 'loaded', modelName: 'wrong_model' }]) {
    for (const retailInputs of [[mdl, utp], [utp]]) {
      const findings = linkedFindings(compareModelPresentation, { retailInputs, modelPresentation: [model] },
        { modelPresentation: [{ template: 'prop', ...observed }] }, 'holocron', retailInputs);
      assert.equal(findings.length, 1);
      assert.deepEqual(findings[0].resourceIdentity, retailInputs[0]);
      assert.deepEqual(findings[0].evidenceRefs, [sidecarPath]);
      assert.equal(findings[0].classification, 'missing-evidence');
    }
  }
});
