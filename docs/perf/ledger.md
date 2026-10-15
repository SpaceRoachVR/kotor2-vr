# VR performance ledger

The single source of truth for the VR perf team (spec:
`docs/superpowers/specs/2026-10-15-vr-perf-team-design.md`). Target: every
benchmark set at **p90 ≤ 13.9 ms and p99 ≤ 20 ms** at 72 Hz, SSW off, in two
consecutive headset rounds. No visual trade-offs.

- Last ranked: _(date, workflow run id)_
- Input packet: _(attribution table, bisect JSONL, traces, audit, P1 notes, in-flight branches)_
- Current wave: _(none)_

## How to read this

- **Score** is `ms × confidence ÷ cost`: `ms` is the predicted headset p90 saving on
  the set it helps most, confidence high = 1, med = 0.6, low = 0.3, cost S = 1,
  M = 2, L = 4. An item that moves no scene below 13.9 ms (and unblocks none
  that will) is down-weighted.
- **Verdict** is the critic's, from evidence and the emulator: `survives`,
  `weakened`, `refuted`, or `unverified` when it was outside the critic's top 4.
  The emulator can refute but never confirm; only the headset result column can.
- **Flag** is the launch option `perf.<id>=on|off` the fix ships behind.
- **Headset result** is the `confirmFlag` verdict: the A/B/A gain in ms p90 on the
  worst set, against the prediction (confirmed within ±30%, or a gain of at least
  70% of it; rejected below that; inconclusive on drift > 0.5 m within or between
  the windows, a refresh-rate change, an untrustworthy window, or a suite
  regression > 1 ms p90 against the baseline). `perf-round.js wave` runs the
  windows and, only when given `--predicted <ms>`, finishes by running
  `confirmFlag` for each flag against the worst set and printing the verdict,
  `deltaMs`, drift and notes. `--baseline <round>` supplies an earlier round's
  records for the regression check; without it that check is skipped and the
  output says so. `predictedMs` in the workflow's `wave1[]` is a per-set object:
  the lead passes the WORST set's value. For example:
  `perf-round.js --round wave1 --refresh-hz 72 wave perf.x,perf.y --worst peragus --predicted 4,2.5 --baseline bisect-<date>`.
  Without `--predicted`, `wave` prints only the A/B/A table (`formatAba`); the lead
  then records the verdict by hand.
- **Status:** `proposed` → `building` → `merged-off` (merged to
  `perf/integration`, flag off) → `confirmed` (flag on by default) or `rejected`
  (stays merged with its flag off) → `removed` (code dropped two waves after
  rejection unless revived). A status only moves forward.
- A re-run of the analysis workflow updates this file in place: existing rows
  keep their wave, owner, flag, headset result and status, and the Round log
  is only appended to.
- Big bets (multiview, workers, WebGPU) are listed under Spikes, never in a wave.
- Upstream candidates are tagged `↑` after the id; nothing is posted upstream.

## Ranked items

| rank | id | claim | ms × conf ÷ cost | verdict | wave | owner session | flag | headset result | status |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## Proposed wave

_(2–4 non-refuted, non-big-bet items with disjoint `files`; Allen reviews before any fix code is written.)_

| id | files | predicted ms (set) | falsification |
|---|---|---|---|
| | | | |

## Spikes (big bets)

| id | claim | rung to measure | status |
|---|---|---|---|
| | | | |

## Round log

_(one line per headset round: date, round name, flags tested, verdicts.)_
