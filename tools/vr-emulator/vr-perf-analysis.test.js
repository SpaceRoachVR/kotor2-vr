// Validates .claude/workflows/vr-perf-analysis.js without spawning agents: the
// script body is compiled with stubbed agent()/parallel()/pipeline()/phase()/log()
// hooks, as the Workflow runtime would run it, and driven with fake analyst,
// critic and lead results. Also keeps its inlined HYPOTHESIS schema equal to
// docs/perf/hypothesis.schema.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, '.claude', 'workflows', 'vr-perf-analysis.js'), 'utf8');
const SCHEMA_FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'perf', 'hypothesis.schema.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const META_HEAD = 'export const meta = ';
assert.ok(SCRIPT.startsWith(META_HEAD), 'the script must begin with `export const meta = {`');
const metaEnd = SCRIPT.indexOf('\n}\n') + 2;
const META_SRC = SCRIPT.slice(META_HEAD.length, metaEnd);
const BODY = SCRIPT.slice(metaEnd);

const ARGS = {
  repoRoot: 'C:/Users/allen/source/repos/kotor2-vr-perfteam',
  attributionTable: 'tools/vr-emulator/evidence/perf/attribution-2026-10-20.md',
  bisectJsonl: 'tools/vr-emulator/evidence/perf/bisect-2026-10-20.jsonl',
  traceFiles: ['tools/vr-emulator/evidence/perf/bisect-telos.trace.json'],
  auditPath: 'C:/Users/allen/source/repos/kotor2-vr/PERFORMANCE-AUDIT-2026-10-14.md',
  p1Notes: 'docs/perf/p1-notes.md',
  inFlightBranches: ['codex/grass-wind-perf'],
};

// The subset of JSON Schema the hypothesis schema uses.
function validate(schema, value, at = '$') {
  const errs = [];
  const t = schema.type;
  if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${at}: not an object`];
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${at}.${k}: required`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errs.push(...validate(props[k], v, `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}.${k}: not allowed`);
    }
    if (schema.minProperties && Object.keys(value).length < schema.minProperties) errs.push(`${at}: too few properties`);
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${at}: not an array`];
    if (schema.minItems && value.length < schema.minItems) errs.push(`${at}: too few items`);
    value.forEach((v, i) => errs.push(...(schema.items ? validate(schema.items, v, `${at}[${i}]`) : [])));
  } else if (t === 'string') {
    if (typeof value !== 'string') return [`${at}: not a string`];
    if (schema.minLength && value.length < schema.minLength) errs.push(`${at}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: does not match ${schema.pattern}`);
  } else if (t === 'number') {
    if (!Number.isFinite(value)) return [`${at}: not a number`];
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${at}: below minimum`);
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') return [`${at}: not a boolean`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: not one of ${schema.enum.join('|')}`);
  return errs;
}

const hyp = (domain, n, { ms = 1, confidence = 'med', cost = 'M', files, bigBet = false, id } = {}) => ({
  id: id || `${domain}-h${n}`,
  domain,
  claim: `${domain} claim ${n}`,
  evidence: [`src/somewhere.ts:${10 + n}`],
  expectedMsSaved: { telos: ms },
  confidence,
  cost,
  falsification: 'toggle and measure',
  files: files || [`src/${domain}/${n}.ts`],
  bigBet,
  upstreamCandidate: false,
});

// Ten hypotheses, two per analyst, distinct scores; the cpu analyst repeats an id.
const FAKE = {
  trace: { hypotheses: [hyp('trace', 1, { ms: 1 }), hyp('trace', 2, { ms: 0.5 })] },
  gpu: { hypotheses: [hyp('gpu', 1, { ms: 6, confidence: 'high', cost: 'M', files: ['src/three/odyssey/OdysseyModel3D.ts'] }), hyp('gpu', 2, { ms: 3, bigBet: true, cost: 'L' })] },
  cpu: { hypotheses: [hyp('cpu', 1, { ms: 4, confidence: 'high', cost: 'S' }), hyp('cpu', 2, { ms: 3, confidence: 'high', cost: 'M', id: 'cpu-h1' })] },
  'xr-runtime': { hypotheses: [hyp('xr-runtime', 1, { ms: 2 }), hyp('xr-runtime', 2, { ms: 0.2 })] },
  visual: { hypotheses: [hyp('visual', 1, { ms: 0.1, confidence: 'low' }), hyp('visual', 2, { ms: 0.1, confidence: 'low', cost: 'L' })], invariants: ['fixed-pose screenshots identical'] },
};

async function run(options = {}) {
  const args = 'args' in options ? options.args : ARGS;
  const { lead } = options;
  const calls = [];
  const phases = [];
  const logs = [];
  const live = { now: 0, maxVerify: 0 };
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts });
    if (opts.phase === 'Verify') {
      // Yield while "running", so concurrent critics would overlap here.
      live.now++;
      live.maxVerify = Math.max(live.maxVerify, live.now);
      await new Promise((r) => setTimeout(r, 5));
      live.now--;
    }
    if (opts.phase === 'Analyze') {
      const domain = Object.keys(FAKE).find((d) => prompt.includes(`YOUR DOMAIN (${d})`));
      return JSON.parse(JSON.stringify(FAKE[domain]));
    }
    if (opts.phase === 'Verify') {
      const id = /"id": "([^"]+)"/.exec(prompt)[1];
      return { id, verdict: id === 'cpu-h1' ? 'refuted' : 'survives', reason: 'stub', emulatorRun: { ran: false } };
    }
    if (opts.phase === 'Rank') {
      return lead || {
        ledgerPath: 'docs/perf/ledger.md',
        ranked: [{ rank: 1, id: 'gpu-h1', claim: 'c', score: 3, verdict: 'survives', files: ['src/three/odyssey/OdysseyModel3D.ts'], bigBet: false }],
        wave1: [{ id: 'gpu-h1', files: ['src/three/odyssey/OdysseyModel3D.ts'], flag: 'perf.gpu-h1' }, { id: 'xr-runtime-h1', files: ['src/xr-runtime/1.ts'], flag: 'perf.xr' }],
        spikes: ['gpu-h2'],
        preserved: [],
      };
    }
    throw new Error(`agent() with unexpected phase ${opts.phase}`);
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let v = item;
    try {
      for (const s of stages) v = await s(v, item, i);
      return v;
    } catch {
      return null;
    }
  }));
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', BODY);
  const result = await fn(agent, parallel, pipeline, (t) => phases.push(t), (m) => logs.push(m), args, { total: null, spent: () => 0, remaining: () => Infinity });
  return { result, calls, phases, logs, live };
}

test('meta is a pure literal with name, description and the three phases', () => {
  assert.doesNotMatch(META_SRC, /\$\{|`|\.\.\.|=>/, 'meta must be a pure literal');
  const meta = new Function(`return (${META_SRC})`)();
  assert.strictEqual(meta.name, 'vr-perf-analysis');
  assert.ok(meta.description.length > 20);
  assert.deepStrictEqual(meta.phases.map((p) => p.title), ['Analyze', 'Verify', 'Rank']);
});

test('the inlined HYPOTHESIS schema equals docs/perf/hypothesis.schema.json', async () => {
  const { result } = await run({ args: { ...ARGS, dryRun: true } });
  const { $schema, $id, title, description, ...shape } = SCHEMA_FILE;
  assert.deepStrictEqual(result.schemas.HYPOTHESIS, shape);
  assert.deepStrictEqual(result.schemas.ANALYST_OUTPUT.properties.hypotheses.items, shape);
});

test('the fake hypotheses are valid against the schema (and the validator rejects junk)', () => {
  for (const out of Object.values(FAKE)) for (const h of out.hypotheses) assert.deepStrictEqual(validate(SCHEMA_FILE, h), []);
  const bad = { ...hyp('cpu', 1), domain: 'audio', cost: 'XL', expectedMsSaved: { tatooine: 1 } };
  delete bad.falsification;
  assert.strictEqual(validate(SCHEMA_FILE, bad).length, 4);
});

test('dry run spawns no agents and returns every prompt', async () => {
  const { result, calls } = await run({ args: { ...ARGS, dryRun: true } });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(result.dryRun, true);
  assert.strictEqual(result.maxAgents, 10);
  assert.deepStrictEqual(result.analysts.map((a) => a.domain), ['trace', 'gpu', 'cpu', 'xr-runtime', 'visual']);
  assert.deepStrictEqual(result.critic.ports, [9480, 9481, 9482, 9483]);
  assert.deepStrictEqual(result.critic.assetPorts, [8520, 8521, 8522, 8523]);
  assert.strictEqual(result.critic.sequential, true);
  assert.strictEqual(result.ledgerPath, 'C:/Users/allen/source/repos/kotor2-vr-perfteam/docs/perf/ledger.md');
});

test('missing args fail before any agent', async () => {
  await assert.rejects(() => run({ args: { repoRoot: 'x' } }), /args missing: attributionTable, bisectJsonl, auditPath, p1Notes, traceFiles \(array\), inFlightBranches \(array\)/);
  await assert.rejects(() => run({ args: undefined }), /args missing: repoRoot/);
});

test('a full stubbed run: 5 analysts, critic capped at 4, sequential, 1 lead, at most 10 agents', async () => {
  const { result, calls, phases, live } = await run();
  assert.strictEqual(live.maxVerify, 1, 'critics must run one at a time (one emulator at a time)');
  assert.deepStrictEqual(phases, ['Analyze', 'Verify', 'Rank']);
  assert.ok(calls.length <= 10);
  const by = (p) => calls.filter((c) => c.opts.phase === p);
  assert.strictEqual(by('Analyze').length, 5);
  assert.strictEqual(by('Verify').length, 4);
  assert.strictEqual(by('Rank').length, 1);
  for (const c of calls) assert.ok(c.opts.schema && c.opts.schema.type === 'object', `${c.opts.label} has a schema`);

  // Top 4 by ms × conf ÷ cost: cpu-h1 (4), gpu-h1 (3), cpu-h1-2 (1.5), xr-runtime-h1 (0.6).
  const critiqued = by('Verify').map((c) => /"id": "([^"]+)"/.exec(c.prompt)[1]);
  assert.deepStrictEqual(critiqued, ['cpu-h1', 'gpu-h1', 'cpu-h1-2', 'xr-runtime-h1']);
  by('Verify').forEach((c, i) => {
    assert.ok(c.prompt.includes(`new VrHarness({ port: ${9480 + i}, userDataDir: `), `critic ${i} CDP port`);
    assert.ok(c.prompt.includes(`startAssetService({ port: ${8520 + i}, userRoot: `), `critic ${i} asset port`);
    assert.ok(c.prompt.includes(`%TEMP%\\kotor2vr-critic-${i}\\user`) && c.prompt.includes(`%TEMP%\\kotor2vr-critic-${i}\\chrome`), `critic ${i} temp roots`);
    assert.ok(c.prompt.includes(`--port ${9480 + i}`));
    assert.match(c.prompt, /CAN REFUTE BUT NEVER CONFIRM/);
    assert.match(c.prompt, /never refute on emulator timing alone/i);
    for (const banned of ['playthrough.js', 'probe-*.js', 'collect.js']) assert.ok(c.prompt.includes(banned), `critic ${i} bans ${banned}`);
    assert.doesNotMatch(c.prompt, /port 943\d/);
  });
  // The duplicate id was renamed, the rest pass through unverified.
  assert.strictEqual(result.hypotheses.length, 10);
  assert.strictEqual(new Set(result.hypotheses.map((h) => h.id)).size, 10);
  assert.strictEqual(result.hypotheses.filter((h) => h.verdict === 'unverified').length, 6);
  assert.strictEqual(result.hypotheses.find((h) => h.id === 'cpu-h1').verdict, 'refuted');
  assert.deepStrictEqual(result.invariants, ['fixed-pose screenshots identical']);
  // The lead sees the verdicts and the invariants.
  assert.match(by('Rank')[0].prompt, /"verdict": "refuted"/);
  assert.match(by('Rank')[0].prompt, /fixed-pose screenshots identical/);
  assert.deepStrictEqual(result.waveProblems, []);
});

test('every prompt carries the safety rules and forbids visual trade-offs', async () => {
  const { calls } = await run();
  for (const c of calls) {
    assert.match(c.prompt, /NEVER run `git worktree add` or `git worktree remove`/, c.opts.label);
    assert.match(c.prompt, /junctions or symlinks/, c.opts.label);
    assert.match(c.prompt, /outside your own worktree/, c.opts.label);
    assert.match(c.prompt, /VISUAL TRADE-OFFS ARE FORBIDDEN/, c.opts.label);
    assert.match(c.prompt, /Writing scratch files under %TEMP% is allowed/, c.opts.label);
    assert.ok(c.prompt.includes(ARGS.bisectJsonl) && c.prompt.includes(ARGS.attributionTable) && c.prompt.includes('codex/grass-wind-perf'), `${c.opts.label} has the packet`);
  }
});

test('the audit seeds go to the cpu and gpu analysts only', async () => {
  const { calls } = await run();
  for (const c of calls.filter((x) => x.opts.phase === 'Analyze')) {
    const seeded = ['tickP2PGravity', 'updateTrackedInput', 'refreshTrackedPresentationPose', 'batch'].every((s) => c.prompt.includes(s));
    const wanted = /YOUR DOMAIN \((cpu|gpu)\)/.test(c.prompt);
    assert.strictEqual(seeded, wanted, c.opts.label);
    if (wanted) assert.match(c.prompt, /NOT accepted items/);
  }
});

test('the wave 1 check flags overlapping files, big bets, refuted items and a bad count', async () => {
  const { result } = await run({
    lead: {
      ledgerPath: 'docs/perf/ledger.md',
      ranked: [],
      wave1: [
        { id: 'gpu-h1', files: ['src/a.ts'], flag: 'perf.a' },
        { id: 'gpu-h2', files: ['src\\A.ts'], flag: 'perf.b' },
        { id: 'cpu-h1', files: ['src/c.ts'], flag: 'perf.c' },
        { id: 'trace-h1', files: [], flag: 'perf.d' },
        { id: 'trace-h2', files: [], flag: 'perf.e' },
      ],
      spikes: [],
    },
  });
  const p = result.waveProblems.join('\n');
  assert.match(p, /5 items, want 2-4/);
  assert.match(p, /gpu-h2 is a bigBet/);
  assert.match(p, /cpu-h1 was refuted/);
  assert.match(p, /gpu-h2 and gpu-h1 both touch/);
  assert.match(p, /trace-h1 lists no files/);
});

test('the wave 1 check uses the critic\'s verdict, so the lead cannot launder a refuted item', async () => {
  const { result } = await run({
    lead: {
      ledgerPath: 'docs/perf/ledger.md',
      // The lead re-labels the refuted cpu-h1 as surviving and not a big bet.
      ranked: [
        { rank: 1, id: 'cpu-h1', claim: 'c', score: 4, verdict: 'survives', files: ['src/cpu/1.ts'], bigBet: false },
        { rank: 2, id: 'gpu-h2', claim: 'c', score: 1, verdict: 'unverified', files: ['src/gpu/2.ts'], bigBet: false },
      ],
      wave1: [{ id: 'cpu-h1', files: ['src/cpu/1.ts'], flag: 'perf.a' }, { id: 'gpu-h2', files: ['src/gpu/2.ts'], flag: 'perf.b' }],
      spikes: [],
      preserved: [],
    },
  });
  const p = result.waveProblems.join('\n');
  assert.match(p, /cpu-h1 was refuted/);
  assert.match(p, /gpu-h2 is a bigBet/);
});

const PRIOR_LEDGER = [
  '# VR performance ledger', '', '## Ranked items', '',
  '| rank | id | claim | ms × conf ÷ cost | verdict | wave | owner session | flag | headset result | status |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| 1 | cpu-gravity ↑ | reuse emitter transforms | 2.1 | survives | 1 | perf-gravity | perf.gravity | +1.9 ms confirmed | confirmed |',
  '| 2 | gpu-batching | batch static meshes | 1.5 | weakened | 1 | perf-batch | perf.batching | 0.2 ms | rejected |',
  '| | | | | | | | | | |',
  '', '## Proposed wave', '', '| id | files | predicted ms (set) | falsification |', '|---|---|---|---|', '| not-an-item | x | 1 | y |',
].join('\n');

test('a re-run keeps the ledger: the lead is told to carry rows forward, and lost prior ids are logged', async () => {
  const { result, calls, logs } = await run({
    args: { ...ARGS, priorLedgerMarkdown: PRIOR_LEDGER },
    lead: {
      ledgerPath: 'docs/perf/ledger.md',
      ranked: [{ rank: 1, id: 'gpu-h1', claim: 'c', score: 3, verdict: 'survives', files: ['src/three/odyssey/OdysseyModel3D.ts'], bigBet: false }],
      wave1: [{ id: 'gpu-h1', files: ['src/three/odyssey/OdysseyModel3D.ts'], flag: 'perf.gpu-h1' }, { id: 'xr-runtime-h1', files: ['src/xr-runtime/1.ts'], flag: 'perf.xr' }],
      spikes: [],
      preserved: ['cpu-gravity'],
      priorIds: ['cpu-gravity', 'gpu-batching', 'telos-old'],
    },
  });
  const lead = calls.find((c) => c.opts.phase === 'Rank').prompt;
  assert.match(lead, /read the current ledger/i);
  assert.match(lead, /never downgrade a status/i);
  assert.match(lead, /append/i);
  assert.match(lead, /Round log/);
  // Parsed from the ranked table only (the up-arrow tag stripped), and shown to the lead.
  assert.deepStrictEqual(result.priorLedgerIds, ['cpu-gravity', 'gpu-batching', 'telos-old']);
  assert.ok(lead.includes('cpu-gravity') && lead.includes('gpu-batching'));
  assert.ok(!result.priorLedgerIds.includes('not-an-item'));
  assert.deepStrictEqual(result.lostLedgerIds, ['gpu-batching', 'telos-old']);
  assert.ok(logs.some((l) => /gpu-batching/.test(l) && /telos-old/.test(l)));
});

test('the lead output schema requires `preserved`', async () => {
  const { result } = await run({ args: { ...ARGS, dryRun: true } });
  assert.ok(result.schemas.LEAD_OUTPUT.required.includes('preserved'));
});
