export const meta = {
  name: 'vr-perf-analysis',
  description: 'VR perf team Phase 1: five domain analysts propose hypotheses, a critic attacks the top four in the emulator, the lead ranks them into docs/perf/ledger.md and proposes wave 1',
  whenToUse: 'After a Phase 0 bisect headset round, with the attribution table and bisect JSONL in hand. args: {repoRoot, attributionTable, bisectJsonl, traceFiles[], auditPath, p1Notes, inFlightBranches[], priorLedgerMarkdown?, dryRun?}',
  phases: [
    { title: 'Analyze', detail: '5 analysts in parallel (trace, GPU/WebGL, JS/CPU & GC, XR runtime, retail/visual guard); hypotheses per docs/perf/hypothesis.schema.json' },
    { title: 'Verify', detail: 'critic per hypothesis, top 4 by provisional score, one at a time, emulator on CDP 9480+i and assets 8520+i; refutes, never confirms' },
    { title: 'Rank', detail: 'lead merges duplicates, ranks by ms x confidence / cost, writes docs/perf/ledger.md, proposes wave 1' },
  ],
}

// ---------------------------------------------------------------------------
// Spec: docs/superpowers/specs/2026-10-15-vr-perf-team-design.md, "Team" and
// "Phase 1". 7 roles, at most 10 agents: 5 analysts + up to CRITIC_CAP critic
// instances + 1 lead. tools/vr-emulator/vr-perf-analysis.test.js runs this
// script with stubbed hooks (no agents) and keeps HYPOTHESIS equal to
// docs/perf/hypothesis.schema.json.
// ---------------------------------------------------------------------------

const CRITIC_CAP = 4
// Controller ruling R18: critics run one at a time, each with its own CDP port,
// asset-service port, user root and Chrome profile, clear of 9422 (vr:play),
// 8479 (the default asset service) and 9431 (playthrough.js).
const CRITIC_CDP_BASE = 9480
const CRITIC_ASSET_BASE = 8520
const TARGET_P90_MS = 13.9
const CONFIDENCE_WEIGHT = { high: 1, med: 0.6, low: 0.3 }
const COST_WEIGHT = { S: 1, M: 2, L: 4 }
const SETS = ['peragus', 'ebon-hawk', 'conversation', 'combat', 'telos']

// Keep equal to docs/perf/hypothesis.schema.json (minus $schema/$id/title/description).
const HYPOTHESIS = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'domain', 'claim', 'evidence', 'expectedMsSaved', 'confidence', 'cost', 'falsification', 'files', 'bigBet', 'upstreamCandidate'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', description: 'Short kebab-case id, unique within the run, e.g. gpu-static-batching' },
    domain: { type: 'string', enum: ['trace', 'gpu', 'cpu', 'xr-runtime', 'visual'] },
    claim: { type: 'string', minLength: 1, description: 'What costs time, where, and what change would remove it, in one or two sentences' },
    evidence: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'file:line references or trace references (file plus event/label)' },
    expectedMsSaved: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      description: 'Predicted headset p90 ms saved per benchmark set (perf-benchmarks.json)',
      properties: {
        peragus: { type: 'number', minimum: 0 },
        'ebon-hawk': { type: 'number', minimum: 0 },
        conversation: { type: 'number', minimum: 0 },
        combat: { type: 'number', minimum: 0 },
        telos: { type: 'number', minimum: 0 },
      },
    },
    confidence: { type: 'string', enum: ['low', 'med', 'high'] },
    cost: { type: 'string', enum: ['S', 'M', 'L'] },
    falsification: { type: 'string', minLength: 1, description: 'A cheap test whose failure would refute the claim' },
    files: { type: 'array', items: { type: 'string' }, description: "Repo-relative files a fix would touch; wave items must not overlap" },
    bigBet: { type: 'boolean', description: 'Multiview, workers, WebGPU or similar: never a normal wave item, becomes a spike proposal' },
    upstreamCandidate: { type: 'boolean', description: 'Worth offering to KotOR.js upstream (tagged only, never posted)' },
  },
}

const ANALYST_OUTPUT = {
  type: 'object',
  required: ['hypotheses'],
  properties: {
    hypotheses: { type: 'array', items: HYPOTHESIS },
    invariants: { type: 'array', items: { type: 'string' }, description: 'Visual guard only: what must not change visually, each checkable' },
    notes: { type: 'string' },
  },
}

const CRITIC_VERDICT = {
  type: 'object',
  required: ['id', 'verdict', 'reason', 'emulatorRun'],
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['survives', 'weakened', 'refuted'] },
    reason: { type: 'string', minLength: 1 },
    evidenceChecked: { type: 'array', items: { type: 'string' }, description: 'Each evidence reference and what was found there' },
    emulatorRun: {
      type: 'object',
      required: ['ran'],
      properties: {
        ran: { type: 'boolean' },
        port: { type: 'number' },
        scenes: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
    visualRisk: { type: 'string', description: 'Any way the fix could change what the player sees; empty if none' },
  },
}

const LEAD_OUTPUT = {
  type: 'object',
  required: ['ledgerPath', 'ranked', 'wave1', 'spikes', 'preserved'],
  properties: {
    ledgerPath: { type: 'string' },
    ranked: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rank', 'id', 'claim', 'score', 'verdict', 'files', 'bigBet'],
        properties: {
          rank: { type: 'number' },
          id: { type: 'string' },
          mergedFrom: { type: 'array', items: { type: 'string' } },
          claim: { type: 'string' },
          score: { type: 'number' },
          verdict: { type: 'string', enum: ['survives', 'weakened', 'refuted', 'unverified'] },
          movesBelowTarget: { type: 'boolean' },
          files: { type: 'array', items: { type: 'string' } },
          bigBet: { type: 'boolean' },
          upstreamCandidate: { type: 'boolean' },
        },
      },
    },
    wave1: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'files', 'flag'],
        properties: {
          id: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          flag: { type: 'string', description: 'perf.<id> launch option the fix ships behind' },
          predictedMs: { type: 'object' },
        },
      },
    },
    spikes: { type: 'array', items: { type: 'string' }, description: 'bigBet ids proposed as spike sessions' },
    preserved: { type: 'array', items: { type: 'string' }, description: 'ids of prior ledger rows carried forward that are not in `ranked` this run' },
    priorIds: { type: 'array', items: { type: 'string' }, description: 'every id in the Ranked items table of the ledger as you found it, before editing' },
    dropped: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } } } },
    notes: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Input packet
// ---------------------------------------------------------------------------

const input = args || {}
const missing = ['repoRoot', 'attributionTable', 'bisectJsonl', 'auditPath', 'p1Notes']
  .filter((k) => typeof input[k] !== 'string' || !input[k].trim())
if (!Array.isArray(input.traceFiles)) missing.push('traceFiles (array)')
if (!Array.isArray(input.inFlightBranches)) missing.push('inFlightBranches (array)')
if (missing.length) throw new Error(`vr-perf-analysis args missing: ${missing.join(', ')}`)

const ROOT = input.repoRoot.replace(/[\\/]+$/, '')
const LEDGER = `${ROOT}/docs/perf/ledger.md`

// The ids already in the ledger's "Ranked items" table, when the caller passes
// the current ledger text (the script has no fs). A re-run must not lose them.
function ledgerIds(markdown) {
  if (typeof markdown !== 'string') return []
  const ids = []
  let inRanked = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inRanked = /^##\s+Ranked items/i.test(line); continue }
    if (!inRanked || !line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    const id = (cells[1] || '').replace(/↑/g, '').trim()
    if (!id || id === 'id' || /^-+$/.test(id)) continue
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}
const PRIOR_IDS = ledgerIds(input.priorLedgerMarkdown)

const PACKET = [
  'INPUT PACKET (read these; paths are absolute or relative to the repo root):',
  `- repo root (your worktree): ${ROOT}`,
  `- attribution table (first rung over 13.9 ms per scene, and the stage): ${input.attributionTable}`,
  `- raw bisect records (JSON lines: before/after STATE, report.frametimeMs, cpuMs.simulation/render, gpuMs, xrCadence.integrity): ${input.bisectJsonl}`,
  `- headset traces and CPU profiles: ${input.traceFiles.length ? input.traceFiles.join(', ') : '(none in this packet)'}`,
  `- performance audit 2026-10-14 (measured at 90 Hz, not 72): ${input.auditPath}`,
  `- P1 notes and open ROADMAP items: ${input.p1Notes}`,
  `- in-flight branches (rebase onto, never overwrite; avoid files they touch): ${input.inFlightBranches.length ? input.inFlightBranches.join(', ') : '(none)'}`,
  '- spec: docs/superpowers/specs/2026-10-15-vr-perf-team-design.md ("Team", "Phase 1"); benchmark sets: tools/vr-emulator/perf-benchmarks.json',
].join('\n')

const SAFETY = [
  'HARD RULES (a previous agent broke ~38 worktrees by breaking the first two):',
  '- NEVER run `git worktree add` or `git worktree remove`. Never create or delete junctions or symlinks.',
  `- Never modify or delete anything outside your own worktree, ${ROOT} (reading packet files elsewhere is fine). Never git stash, reset, switch branches, commit or push.`,
  '- Never modify the main checkout (other Claude sessions and Codex edit it), and never connect to port 9422 (the headset browser).',
  '- Writing scratch files under %TEMP% is allowed (and is where emulator profiles and user roots go). Never write to %LOCALAPPDATA%\\Kotor2VR, the real user root.',
  '- VISUAL TRADE-OFFS ARE FORBIDDEN: resolution, render scale, shadows, LOD, grass density, post-processing, authored animation and lighting stay exactly as they are. A hypothesis that changes what the player sees is out of scope, however much time it saves.',
  '- Only headset numbers prove a fix. Emulator and desktop traces generate and refute hypotheses; they never confirm one.',
].join('\n')

const SCHEMA_NOTE = [
  'Return hypotheses matching docs/perf/hypothesis.schema.json: id (kebab-case, prefix it with your domain), domain,',
  'claim, evidence (file:line or trace refs you actually opened), expectedMsSaved per benchmark set',
  `(${SETS.join(', ')}; headset p90 ms at 72 Hz), confidence low|med|high, cost S|M|L, a cheap falsification test,`,
  'files a fix would touch, bigBet (multiview/workers/WebGPU-class), upstreamCandidate. Prefer 2-5 strong hypotheses over',
  `many weak ones. The target is p90 <= ${TARGET_P90_MS} ms and p99 <= 20 ms on every set; say which scene a fix moves below it.`,
].join('\n')

// The audit's three unlanded items (PERFORMANCE-AUDIT-2026-10-14.md, items 2-4).
// Seeds, not accepted items: re-derive or reject them from the packet.
const SEEDS = [
  'SEEDS from the 2026-10-14 audit (unlanded; seeds, NOT accepted items: confirm, re-size or reject each against the packet):',
  '1. Gravity-particle transforms: src/three/odyssey/OdysseyEmitter3D.ts tickP2PGravity calls localToWorld/worldToLocal per live particle, each walking the parent matrix chain and worldToLocal inverting a matrix. Update the emitter world matrix once per tick and reuse it plus one inverse. ~5.8% of sampled engine update on Telos.',
  '2. Static matrices and render batching: three.js recomposes local matrices and traverses for world updates every frame, hidden rooms included (src/three/odyssey/OdysseyModel3D.ts, its node parser, src/module/ModuleRoom.ts, the render path in src/vr/VRSpike.ts). Classify provably static nodes with explicit invalidation; batch compatible static opaque meshes. ~2.5 s matrix self time in a 21 s profile; 1,100+ draw calls on Telos; batching saving unmeasured.',
  '3. Duplicate VR pose processing: src/vr/VRSpike.ts updateTrackedInput and refreshTrackedPresentationPose (and src/vr/runtime/XRInputFrameBuilder.ts) process the same XRFrame twice. The second refresh fixes real presentation bugs and must stay; read tracking once and reproject. ~2% of sampled engine CPU.',
].join('\n')

const ANALYSTS = [
  {
    domain: 'trace',
    title: 'Trace & frame-pacing analyst',
    focus: 'The ~15/31 ms frame quantization: vsync misses, whether frames are late from submit timing or from running over budget, XR callback cadence, long main-thread tasks and their position in the frame. Use the traces and the bisect records (xrCadence, frametime percentiles) to say where each frame\'s time goes.',
    seeds: false,
  },
  {
    domain: 'gpu',
    title: 'GPU/WebGL renderer analyst',
    focus: 'Draw calls, GL state changes, overdraw, shaders, batching, instancing, multiview (OVR_multiview2 is a bigBet). The engine defaults to WebGL1 (RendererOptions.ts); gpuMs in the records comes from EXT_disjoint_timer_query. Seed 2\'s batching half is yours.',
    seeds: true,
  },
  {
    domain: 'cpu',
    title: 'JS/CPU & GC analyst',
    focus: 'Main-thread JS: matrix work, per-frame allocators (e.g. updateAnimationNode), cursor raycasts, GC, moving work to workers (a bigBet). Seeds 1, 3 and the static-matrix half of seed 2 are yours. Use the CPU profiles and cpuMs.simulation/render.',
    seeds: true,
  },
  {
    domain: 'xr-runtime',
    title: 'XR runtime analyst',
    focus: 'Electron/Chromium version and flags, the WebXR path, VDXR vs SteamVR, Virtual Desktop codec/bitrate/encode latency, OpenXR frame timing. Phase 0 isolation hit only ~35-52 FPS with an almost empty scene, so part of the ceiling may sit below the game: use the l0/l1 rungs to say how much.',
    seeds: false,
  },
  {
    domain: 'visual',
    title: 'Retail/visual guard',
    focus: 'Define what must not change visually so the critic can reject trade-offs: list concrete, checkable invariants in `invariants` (fixed-pose screenshot identity, transparency ordering, lightmaps, envmaps, grass density and motion, particle look, animation, dialogue/theater framing). Telos character rendering is already broken and is not a baseline. Propose a hypothesis only for work that is provably invisible (e.g. a pass whose output is never shown).',
    seeds: false,
  },
]

function analystPrompt(a) {
  return [
    `You are the ${a.title} on the KotOR II VR performance team. Goal: native 72 Hz, no dropped frames, RTX 3060 -> Quest 3 over Virtual Desktop/VDXR, SSW off. Clean play sits on a ~31 ms plateau.`,
    '',
    `YOUR DOMAIN (${a.domain}): ${a.focus}`,
    '',
    PACKET,
    '',
    a.seeds ? `${SEEDS}\n` : '',
    SCHEMA_NOTE,
    '',
    'You are read-only: do not edit, create or delete any file, and do not start the game, the emulator or anything that binds a port.',
    '',
    SAFETY,
  ].join('\n')
}

const provisionalMs = (h) => Math.max(0, ...Object.values(h.expectedMsSaved || {}).filter((v) => Number.isFinite(v)))
const provisionalScore = (h) => (provisionalMs(h) * (CONFIDENCE_WEIGHT[h.confidence] || 0)) / (COST_WEIGHT[h.cost] || 4)

function criticSetup(i) {
  const cdp = CRITIC_CDP_BASE + i
  const assets = CRITIC_ASSET_BASE + i
  const dir = `%TEMP%\\kotor2vr-critic-${i}`
  return { cdp, assets, dir, userRoot: `${dir}\\user`, userDataDir: `${dir}\\chrome` }
}

function criticPrompt(h, i, invariants) {
  const s = criticSetup(i)
  return [
    'You are the adversarial critic on the KotOR II VR performance team. You build nothing. Attack this hypothesis on evidence, retail parity and visual identity.',
    '',
    'HYPOTHESIS:',
    JSON.stringify(h, null, 2),
    '',
    'VISUAL INVARIANTS from the retail/visual guard (any fix that breaks one is refuted):',
    invariants.length ? invariants.map((v) => `- ${v}`).join('\n') : '- (none supplied: apply "the game must look identical")',
    '',
    PACKET,
    '',
    'WHAT TO DO:',
    '1. Open every evidence reference. A file:line that does not say what the claim needs weakens or refutes it.',
    '2. Check expectedMsSaved against the bisect records and the attribution table: is the stage it targets actually the dominant one in those scenes at 72 Hz? The audit numbers are 90 Hz.',
    '3. Run the falsification test in the emulator where it means anything. You are the only critic running right now; this is your own isolated emulator (see .claude/skills/kotor2-vr/references/vr-testing.md):',
    `   - Create ${s.userRoot} and ${s.userDataDir} (absolute paths; resolve %TEMP% yourself). If you need checkpoint saves, COPY only the save folders you need from %LOCALAPPDATA%\\Kotor2VR\\Saves into ${s.userRoot}\\Saves; never write to the source.`,
    '   - Drive it from a Node script (a scratch file under your %TEMP% dir), with exactly these ports:',
    "       const { startAssetService } = require('<repo>/tools/vr-emulator/asset-service');",
    "       const { VrHarness } = require('<repo>/tools/vr-emulator/harness');",
    `       const service = await startAssetService({ port: ${s.assets}, userRoot: '<absolute ${s.userRoot}>' });`,
    `       const harness = new VrHarness({ port: ${s.cdp}, userDataDir: '<absolute ${s.userDataDir}>' });`,
    '       await harness.launch(service.url);  /* ... */  finally { await harness.close(); service.stop(); }',
    `   - perf-round.js may be pointed at it with --port ${s.cdp} --round critic-${h.id || i}.`,
    `   - Do NOT run anything with hard-coded ports: playthrough.js, probe-*.js, collect.js, npm run vr:check or vr:play. If CDP ${s.cdp} or asset port ${s.assets} is in use, do not kill whatever holds it: report that and fall back to an evidence-only review.`,
    '   - Do not build (no webpack); use the existing dist/. Stop every process you started before you return.',
    '4. Look for any way the fix would change what the player sees, or diverge from retail behaviour.',
    '',
    'THE EMULATOR CAN REFUTE BUT NEVER CONFIRM. Emulator timings do not predict the headset. "survives" means you tried and failed to break it, not that it is proven.',
    'Never refute on emulator timing alone: an emulator frame time that does not move is not a refutation. A refutation needs a logical or code-level reason (the evidence does not say what the claim needs, the code path is not hot or never reached, the targeted stage is not the bottleneck in the HEADSET records) or a functional failure in the emulator (an exception, wrong output, a visual change).',
    'Verdicts:',
    '- refuted: the evidence is wrong, the code path or stage is not what the claim says, the falsification test fails on logic or function, or the fix needs a visual trade-off.',
    '- weakened: the claim holds in part, or the saving is clearly smaller or confined to fewer scenes than predicted.',
    '- survives: nothing you could check breaks it.',
    'Default to weakened when you could not run a meaningful check.',
    '',
    'You may write emulator evidence under tools/vr-emulator/evidence/ and scratch under your %TEMP% dir only; edit nothing else.',
    '',
    SAFETY,
  ].join('\n')
}

function leadPrompt(items, invariants) {
  return [
    'You are the lead/integrator of the KotOR II VR performance team. Rank the Phase 1 hypotheses and write the ledger.',
    '',
    'HYPOTHESES with the critic\'s verdicts (verdict "unverified" = outside the critic\'s top-4 cap; provisionalScore = max per-set ms x confidence / cost):',
    JSON.stringify(items, null, 2),
    '',
    'VISUAL INVARIANTS:',
    invariants.length ? invariants.map((v) => `- ${v}`).join('\n') : '- (none supplied)',
    '',
    PACKET,
    '',
    'RANKING:',
    '1. Merge duplicates (same mechanism or same files) into one item; list the merged ids in mergedFrom. Resolve conflicts between analysts on the evidence.',
    '2. Score = ms x confidence / cost, with ms the predicted headset p90 saving on the set it helps most, confidence high=1, med=0.6, low=0.3, cost S=1, M=2, L=4. A weakened verdict lowers confidence one step.',
    `3. Down-weight (halve) any item that does not move some scene below ${TARGET_P90_MS} ms p90 or unblock one that will: read each scene's current p90 off the attribution table.`,
    '4. Refuted items stay in the ledger at the bottom with their reason; they are never in a wave.',
    '',
    `UPDATE ${LEDGER}. Read the current ledger first: it may already hold rows from earlier rounds, and a re-run must not wipe them.`,
    PRIOR_IDS.length ? `- The caller says it currently ranks: ${PRIOR_IDS.join(', ')}. Every one must stay in the ledger.` : '- Report every id you find in its Ranked items table as priorIds.',
    '- For every existing row, carry forward its wave, owner session, flag, headset result and status unchanged. Re-score and re-rank it with the new evidence if relevant, but never downgrade a status: the order is proposed < building < merged-off < confirmed | rejected < removed, and a row only moves forward (e.g. never confirmed -> proposed).',
    '- An existing row that this run\'s hypotheses do not cover stays as it is; list its id in `preserved`. A new hypothesis that duplicates an existing row merges into that row instead of adding a second one.',
    '- New rows get status "proposed". Upstream candidates are tagged with an up-arrow after the id.',
    '- Keep the header and "How to read this" section; update "Ranked items" (columns: rank, id, claim, ms x conf / cost, verdict, wave, owner session, flag, headset result, status), "Proposed wave" and "Spikes (big bets)"; stamp "Last ranked" with today\'s date.',
    '- APPEND one line for this run to the "Round log"; never replace or edit earlier Round log lines.',
    '- Edit no other file.',
    '',
    'WAVE 1: propose 2-4 items that are not refuted, not bigBet, and whose `files` are pairwise disjoint and not touched by the in-flight branches. Each gets a flag perf.<id>. bigBet items go to spikes instead. If fewer than 2 items qualify, say why in notes.',
    '',
    SAFETY,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Dry run: the plan and every prompt, no agents.
// ---------------------------------------------------------------------------

if (input.dryRun) {
  log('dry run: no agents spawned')
  return {
    dryRun: true,
    ledgerPath: LEDGER,
    maxAgents: ANALYSTS.length + CRITIC_CAP + 1,
    analysts: ANALYSTS.map((a) => ({ domain: a.domain, label: a.title, prompt: analystPrompt(a) })),
    critic: {
      cap: CRITIC_CAP,
      sequential: true,
      ports: Array.from({ length: CRITIC_CAP }, (_, i) => criticSetup(i).cdp),
      assetPorts: Array.from({ length: CRITIC_CAP }, (_, i) => criticSetup(i).assets),
      samplePrompt: criticPrompt({ id: 'example' }, 0, []),
    },
    priorLedgerIds: PRIOR_IDS,
    lead: { prompt: leadPrompt([], []) },
    schemas: { HYPOTHESIS, ANALYST_OUTPUT, CRITIC_VERDICT, LEAD_OUTPUT },
  }
}

// ---------------------------------------------------------------------------
// Analyze: barrier, because the critic cap needs every hypothesis ranked first.
// ---------------------------------------------------------------------------

phase('Analyze')
const analystResults = await parallel(ANALYSTS.map((a) => () =>
  agent(analystPrompt(a), { label: a.title, phase: 'Analyze', schema: ANALYST_OUTPUT })))

const invariants = []
const hypotheses = []
const seenIds = new Set()
analystResults.forEach((r, i) => {
  if (!r) {
    log(`${ANALYSTS[i].title} returned nothing (skipped or failed); its domain is uncovered`)
    return
  }
  for (const v of r.invariants || []) invariants.push(v)
  for (const h of r.hypotheses || []) {
    let id = h.id
    for (let n = 2; seenIds.has(id); n++) id = `${h.id}-${n}`
    seenIds.add(id)
    hypotheses.push({ ...h, id, provisionalScore: +provisionalScore(h).toFixed(3) })
  }
})
hypotheses.sort((a, b) => b.provisionalScore - a.provisionalScore)
log(`${hypotheses.length} hypotheses from ${analystResults.filter(Boolean).length}/${ANALYSTS.length} analysts, ${invariants.length} visual invariants`)

// ---------------------------------------------------------------------------
// Verify: one critic per hypothesis, capped at the top CRITIC_CAP, run one at a
// time (R18): one emulator at a time, so emulators never contend for the GPU,
// the CPU or a port.
// ---------------------------------------------------------------------------

phase('Verify')
const toVerify = hypotheses.slice(0, CRITIC_CAP)
const unverified = hypotheses.slice(CRITIC_CAP)
if (unverified.length) log(`critic cap ${CRITIC_CAP}: ${unverified.length} lower-scored hypotheses pass through unverified (${unverified.map((h) => h.id).join(', ')})`)

const verdicts = []
for (let i = 0; i < toVerify.length; i++) {
  const h = toVerify[i]
  const s = criticSetup(i)
  verdicts.push(await agent(criticPrompt(h, i, invariants), {
    label: `Critic: ${h.id} (CDP ${s.cdp}, assets ${s.assets})`,
    phase: 'Verify',
    schema: CRITIC_VERDICT,
  }))
}

const judged = [
  ...toVerify.map((h, i) => {
    const v = verdicts[i]
    return v
      ? { ...h, verdict: v.verdict, criticReason: v.reason, visualRisk: v.visualRisk || '', emulatorRun: v.emulatorRun }
      : { ...h, verdict: 'unverified', criticReason: 'critic returned nothing (skipped or failed)' }
  }),
  ...unverified.map((h) => ({ ...h, verdict: 'unverified', criticReason: `outside the critic cap of ${CRITIC_CAP}` })),
]
const refutedCount = judged.filter((h) => h.verdict === 'refuted').length
log(`critic: ${toVerify.length} checked, ${refutedCount} refuted`)

// ---------------------------------------------------------------------------
// Rank: the lead writes the ledger and proposes wave 1; the script checks it.
// ---------------------------------------------------------------------------

phase('Rank')
const ranking = await agent(leadPrompt(judged, invariants), { label: 'Lead: rank + ledger', phase: 'Rank', schema: LEAD_OUTPUT })

const waveProblems = []
let lostLedgerIds = []
if (!ranking) {
  waveProblems.push('lead returned nothing: ledger not written')
} else {
  // The critic's verdict and the analyst's bigBet come from `judged`, never
  // from the lead's re-labelling, so a refuted item cannot be laundered. A
  // merged item answers for every hypothesis merged into it.
  const byId = new Map(judged.map((h) => [h.id, h]))
  const rankedById = new Map((ranking.ranked || []).map((r) => [r.id, r]))
  const sourcesOf = (id) => {
    if (byId.has(id)) return [byId.get(id)]
    const r = rankedById.get(id)
    const merged = ((r && r.mergedFrom) || []).map((m) => byId.get(m)).filter(Boolean)
    return merged.length ? merged : (r ? [r] : [])
  }
  const wave = ranking.wave1 || []
  if (wave.length < 2 || wave.length > 4) waveProblems.push(`wave 1 has ${wave.length} items, want 2-4`)
  const owner = new Map()
  for (const w of wave) {
    const sources = sourcesOf(w.id)
    if (sources.some((s) => s.bigBet)) waveProblems.push(`${w.id} is a bigBet: spike, not wave`)
    if (sources.some((s) => s.verdict === 'refuted')) waveProblems.push(`${w.id} was refuted`)
    const files = w.files || []
    // Unknown files cannot be proven disjoint from the other items'.
    if (!files.length) waveProblems.push(`${w.id} lists no files: cannot prove it disjoint`)
    for (const f of files) {
      const key = String(f).replace(/\\/g, '/').toLowerCase()
      if (owner.has(key)) waveProblems.push(`${w.id} and ${owner.get(key)} both touch ${f}`)
      else owner.set(key, w.id)
    }
  }
  for (const p of waveProblems) log(`wave 1 check: ${p}`)

  // Ledger rows from earlier rounds must survive a re-run.
  const prior = [...new Set([...PRIOR_IDS, ...(ranking.priorIds || [])])]
  const kept = new Set([...(ranking.ranked || []).flatMap((r) => [r.id, ...(r.mergedFrom || [])]), ...(ranking.preserved || [])])
  lostLedgerIds = prior.filter((id) => !kept.has(id))
  if (lostLedgerIds.length) log(`LEDGER: prior rows missing from ranked + preserved, check ${LEDGER} by hand: ${lostLedgerIds.join(', ')}`)
}

return {
  ledgerPath: LEDGER,
  agents: { analysts: ANALYSTS.length, critics: toVerify.length, lead: 1 },
  hypotheses: judged,
  invariants,
  ranking,
  waveProblems,
  priorLedgerIds: [...new Set([...PRIOR_IDS, ...((ranking && ranking.priorIds) || [])])],
  lostLedgerIds,
}
