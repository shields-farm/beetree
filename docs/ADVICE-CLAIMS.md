# Advice Claims — the closed loop

BeeTree's chat already has a reactive tool loop (5 rounds, 27 tools, every call
logged to `agentic_log`). What it did not have is a **closed** loop: nothing
recorded what the assistant predicted, so nothing could ever find out whether it
was right.

Since BeeTree has no actuators — no heater, no gate — the only way to close a
loop is through the beekeeper: advise → human acts → sensors observe → grade.
That makes the ledger the load-bearing piece, not a nice-to-have. It is also the
eval set: real predictions against real hives, which no competitor has.

## Shape

```
Buzz gives advice
   └─ record_advice_claim tool → advice_claims row (status='open')
                                     │  window_end + tolerance_days passes
                                     ▼
                          npm run grade:advice
                                     │
                    ┌────────────────┴─────────────────┐
            numeric metric                     inspection/observation
        (SQL, no model call)                (one batched model call)
                    └────────────────┬─────────────────┘
                                     ▼
                      advice_claim_grades (append-only)
                      advice_claims.grade  (current verdict, cached)
                                     ▼
                        get_advice_accuracy → the dashboard number
```

## Schema

`advice_claims` — one row per prediction. The columns that matter:

- `advice` — what the beekeeper was told, verbatim.
- `claim` — the same thing as one falsifiable sentence.
- `metric` — `temperature` | `humidity` | `weight` | `battery` | `inspection` | `observation`.
  The first four resolve against data that already exists; the last two need judgment.
- `predicate` + `threshold` + `threshold2` + `unit` — the machine-checkable half.
- `basis` — how the window is reduced: `final` (last reading), `majority`,
  `any`, `all`. A threshold claim defaults to `final` ("has it come back down by
  the end?"), a presence claim to `any` ("did it happen at all?").
- `window_start` / `window_end` / `tolerance_days` — when it can be tested, plus
  grace for telemetry lag so a claim is not graded on a gap.
- `confidence` — 0..1, stated by the agent. Feeds the calibration curve.
- `rationale` — why it believed it. **Never shown to the grader.**
- `status`, `grade`, `grade_reason`, `grade_basis` — the cached current verdict.

`advice_claim_grades` — append-only audit trail (`grader`, `grade`, `reason`,
`observed` evidence packet). A re-grade after a model change, or a human
override, adds a row instead of rewriting one. Same spirit as copy-on-write
elsewhere in this schema, simpler: a grade is an immutable observation of the
world, not a mutable entity.

## Three rules the code enforces

1. **Unverifiable is a real verdict.** A claim the sensors could not see is not
   a wrong call. Counting it as one would make an honest number untrustworthy.
   Too few readings, a gap over 6h, or no bound sensor all produce
   `unverifiable`, and `accuracy` excludes it.
2. **The grader never sees the reasoning.** `adviceGrader.ts` selects explicit
   columns and builds a separate evidence packet. A grader shown the original
   rationale grades the rationale. Do not change it to `SELECT *`.
3. **Deterministic before LLM.** Anything with a numeric predicate is decided in
   SQL. Only `inspection` and `observation` claims reach a model, batched 8 at a
   time. On a Pi 5 with no local model, every turn is on the customer's API key,
   so the cheap path is the default path.

## Running it

```bash
npm run grade:advice:dry     # print verdicts, write nothing
npm run grade:advice         # grade everything due
npm run grade:advice -- --limit 50
npm run grade:advice -- --claim claim-abc123   # one claim, ignoring due state
```

A provider outage does not poison the ledger: the claims stay `open` and the
next run picks them up.

## Known data issue

Telemetry device ids live in two formats — `sensors.deviceId` is `47:12:C8`,
`telemetry_cache.deviceId` is `4712c8`. Both sides are normalized
(`lower(replace(deviceId, ':', ''))`); a raw join returns zero rows and silently
grades everything unverifiable. Separately, `data/beetree.db` has a sensor row
`47:0B:AF` whose traffic appears in telemetry as `470bb0` — either a stale
pairing or a typo'd MAC, and worth a look because those readings are currently
unattributable to a hive.
