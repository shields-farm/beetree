---
type: Inference Rule
title: No Queen No Eggs No Cells
description: No queen spotted, no eggs, no queen cells of any kind.
tags:
- beekeeping
- ontology
- inference
- queen
method: queen_inference
key: no_queen_no_eggs_no_cells
observes: /classes/queen-status.md
generated:
  by: agent:sam
  at: '2026-09-15T15:45:00Z'
candidates:
- state: Queenless
  confidence: 0.5
  reason: queen died and colony didn't raise cells
- state: Queenright
  confidence: 0.15
  reason: temporary break, queen may resume
---

# Description

No queen spotted, no eggs, no queen cells of any kind.

# Candidates

- [Queenless](/states/queenless.md) (confidence 0.5) — queen died and colony didn't raise cells
- [Queenright](/states/queenright.md) (confidence 0.15) — temporary break, queen may resume

# Notes

This is the hard case. Introduce a test frame: take a frame with eggs and young larvae from another colony and put it in this hive. Come back in 3-5 days. If they built emergency cells → queenless. If the larvae are being raised normally → you missed the queen. If there are now eggs → the queen was there and just wasn't laying.
