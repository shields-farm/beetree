# BeeTree RL Gym

A replayable evaluation environment for Buzz's **inspect / wait / ask** decisions.
This is the environment and reward layer that an RL trainer can consume later; it
does not train weights and does not require Modal or a GPU.

## Safety model

- `build` opens the live DB read-only and uses SQLite's online backup API. All
  later work happens under `~/.hermes/cache/scratch/beetree-rl-gym/` by default.
- Every episode gets two fresh copies:
  - `act.db` is pruned at the task cutoff. Buzz and its tools can write only here.
  - `label.db` is pruned at the outcome horizon. Only the scorer reads it.
- The worker pins `Date.now()` and `new Date()` to the cutoff before importing
  BeeTree modules, so schedule and seasonal tools do not answer in real time.
- `sensors.latestReading` is rebuilt from the cutoff-pruned telemetry. Without
  that step, `get_sensors` would leak the real present into a historical replay.
- Tools are allowlisted. Live weather and feeding writes are excluded. Task and
  advice-claim writes go to the acting copy and disappear with the scratch run.
- Observation/inspection claims are `unverifiable` in v1, not guessed by an LLM.
  Numeric claims reuse `gradeNumericWith()` from the production advice grader.

## Commands

```bash
# Back up the live DB safely and build a balanced task set.
npm run rl:build -- --limit 40

# Deterministic controls. Null always waits; rules derives its answer from the
# visible sensor context, not from task.label.
npm run rl:run -- --policy null --limit 4
npm run rl:run -- --policy rules --limit 4

# Real OpenAI-compatible model + Buzz tool loop. Reads HERMES_API_URL,
# HERMES_API_KEY and HERMES_MODEL from server/.env when present.
npm run rl:run -- --policy model --limit 4
npm run rl:run -- --policy model --limit 4 --model some-other-model

npm run rl:report
```

Optional flags on `build`: `--step-days 3`, `--context-days 14`,
`--horizon-days 7`, `--out /path/to/run`. `run` also accepts `--out`; use the
same directory as the build. Use `--task rl-hive-...` to rerun one episode;
results for other tasks are preserved.

## Task contract

Each task has a cutoff, a 14-day visible context window, and a 7-day withheld
label window. A cutoff is admitted only when both sides have at least 24 sensor
readings. Selection round-robins across hives and interleaves anomaly/quiet
controls, so a small run is not silently one hive or one class.

V1 anomaly labels are sustained-reading heuristics over each bound sensor:

- `heat`: at least 20% of readings at or above 99F
- `cold`: at least 20% at or below 85F
- `wet`: at least 20% at or above 92% RH
- `dry`: at least 20% between 0% (exclusive) and 25% RH

An anomaly produces `kind=anomaly` and `expectedDecision=inspect`. With no sensor
anomaly, an overdue high-priority task produces `kind=maintenance` and also
expects inspection; this prevents ordinary maintenance from being mislabeled as a
quiet-control false positive. Only a hive with neither signal is `kind=quiet` and
expects `wait`.

These are **operational labels for triage behavior**, not biological ground truth
and not evidence that an inspection caused a later improvement.

The build summary also reports source-data coverage: claims, graded claims,
inspections, chat messages, hives covered, and every skipped hive with a reason.
That makes an empty reward dataset visible instead of letting a run look healthy.

## Reward

The total is a weighted mean over available components; missing outcome or
calibration components are removed rather than treated as zero.

- `decision` — 0.40: exact expected decision = 1, `ask` = 0.5, otherwise 0
- `claimProcess` — 0.20: anomaly advice must record a claim; maintenance does
  not require a prediction; quiet controls should not manufacture predictions
- `outcome` — 0.25: confirmed = 1, partial = 0.5, refuted = 0;
  `unverifiable` is excluded
- `toolDiscipline` — 0.10: disallowed calls and tool errors reduce the score
- `calibration` — 0.05: one minus Brier error for graded, confidence-bearing
  claims

Flags expose the failure mode directly: `missed_anomaly`, `missed_maintenance`,
`false_positive_inspection`, `unnecessary_urgency`,
`missing_falsifiable_claim`, `claim_beyond_label_horizon`, and `tool_errors`.

Claims are read from `record_advice_claim` in the acting DB. A claim written only
in final prose receives no claim credit. A claim whose `windowEnd` exceeds the
replay horizon is masked as unverifiable.

## Output

```text
~/.hermes/cache/scratch/beetree-rl-gym/
  source.db                  # safe online backup; read by builders/pruners
  tasks.jsonl                # context + labels
  tasks.summary.json         # class/hive/source-data coverage
  episodes/<task-id>/
    task.json
    act.db                   # visible through cutoff; all episode writes land here
    label.db                 # scorer-only, visible through labelEnd
    result-<policy>.json
  results-<policy>.jsonl
```

## Deliberate limits / next work

- Telemetry is the only automated outcome label in v1. Real inspections, human
  corrections, action acceptance, and `advice_claim_grades` are the next dataset.
  Track capture with `npm run audit:advice`; authenticated ledger and human-grade
  routes are documented in `docs/ADVICE-CLAIMS.md`.
- A confirmed forecast is not a causal effect estimate. Do not turn this reward
  into a claim that BeeTree advice improved colony survival.
- Tasks lack `createdAt`, so pruning future-dated tasks is conservative. Hive
  `healthStatus` and some ontology rows may still describe the latest known state
  rather than the exact historical version. Treat results as engineering evals,
  not a validated scientific benchmark.
- Weather is not replayable yet. Store weather snapshots before adding it.
- The deterministic rules baseline is a positive control for the reward pipeline,
  not proof that its beekeeping thresholds are optimal.
- GRPO/LoRA training is intentionally not wired up. First accumulate diverse,
  auditable tasks and show a repeatable baseline failure worth training against.
