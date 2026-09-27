# VERIFY.md — the post-change verification loop

Unit tests prove pure functions. The e2e suite proves routing, persistence, and
API contracts. Neither one answers the question you actually ask after a change:
**does the app still come up, and did the layout move under my thumb?**

This is that gate.

```bash
npm run verify          # check the current dist/ build
npm run verify:build    # rebuild first, then check (use this normally)
```

Exit codes: `0` pass, `1` a route needs attention, `2` environment/setup problem.

## What it checks

It boots the real server against a **scratch copy** of the database, then drives
every nav route in headless Chromium at phone width (iPhone 13) and reports per
route:

- **Console errors / uncaught exceptions.** A React route that crashes renders a
  blank shell without throwing anything a test would fail on. This catches it.
- **Blank-shell detection.** If `main` renders empty, the route failed — a
  registered route that renders nothing does not exist for a beekeeper.
- **Layout movement.** Geometry is sampled at 50 / 750 / 2050 / 4350 ms after
  navigation. Anything that moves more than `VERIFY_DRIFT_PX` (default 5px) is
  reported with the pixel delta. This is the class of bug that passes every
  existing assertion and still looks broken on a phone: the route renders
  correctly, *then* something late pushes it around.

Notes (not failures) are printed for elements that render after first paint —
that is normal progressive rendering, and it is only a problem if it moves
something already on screen, which shows up as a drift number.

## Routes covered, and keeping them covered

`ROUTES` in `scripts/verify-app.mjs` lists every **static** route from the
router in `src/App.tsx` — currently 25. Detail routes that need a real record id
(`/hives/:id`, `/sensors/:id`, `/inspections/:id`) are not listed; drive those
through `npm run test:e2e`.

When you add a route, add it here too. A route missing from the list is one this
gate certifies as fine without ever looking at it — the same false PASS the
stale-build check exists to prevent, arriving through a different door. The list
and the router are two places encoding one fact; nothing enforces that they
agree, so the drift is silent.

## What it does not check

- **Buzz chat.** Driving a real conversation needs a model provider; that lives
  in `e2e/`.
- **Replacement for `npm run test:e2e`.** Run both. This is the fast
  post-change gate; that is the thorough suite.
- **Absolute row counts.** The scratch DB is copied from live data, so checks
  assert structure and stability, never a hardcoded number.

## The stale-build trap

`server/index.ts` serves `dist/`. Source edits are invisible until you build —
so verifying after an edit but before `npm run build` reports **PASS for code
that was never executed**. The script refuses to run in that state:

```
SETUP FAIL: dist/ is 392s older than src/ — the server would serve stale code
and report a false PASS.
```

Use `npm run verify:build`, or set `VERIFY_ALLOW_STALE=1` if you deliberately
want to check the build as it stands.

## Trusting the result

A check that has never failed has not been tested. This loop was proven both
ways before being committed:

| Build | Result |
|---|---|
| A banner mounted late in `Layout.tsx` that pushes content down 44px | `FAIL — 25/25 routes need attention`, each reported as `main shifted 44px after load` |
| The same banner reverted | `PASS — 25/25 routes clean` |

Both directions were re-proven against the full 25-route list. If you change the
checks, re-break something deliberately and confirm it still reports FAIL before
trusting a green run — and re-run the failure case if you extend `ROUTES`, so
the new routes are proven able to fail rather than only proven to pass.

Note the injection has to appear **after first paint**. A banner rendered on the
first frame is present at every geometry sample, so nothing moves and the run
passes — which is correct behavior, not a miss: the gate detects *drift*, not
the mere presence of a banner.

## Known baseline

The dashboard header reflows ~4px when `DataFreshness` mounts (it renders `null`
until the first sync, then the chip appears beside the `h1`). Real but
imperceptible, so the tolerance is 5px rather than 2px. Set
`VERIFY_DRIFT_PX=2` to have it flagged.

## Requirements

Playwright's chromium must be installed. If you see
`Executable doesn't exist at .../chromium_headless_shell-*`:

```bash
npx playwright install chromium
```

This is a one-time setup step and is the reason the e2e suite fails 51 of 62
tests on a fresh machine — see the note in `TESTING.md`.
