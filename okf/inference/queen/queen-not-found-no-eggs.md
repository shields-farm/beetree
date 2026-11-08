---
type: Inference Rule
title: Queen Not Found No Eggs
description: Couldn't find the queen and no eggs visible.
tags:
- beekeeping
- ontology
- inference
- queen
method: queen_inference
key: queen_not_found_no_eggs
observes: /classes/queen-status.md
generated:
  by: agent:sam
  at: '2026-09-15T15:45:00Z'
candidates:
- state: Queenless
  confidence: 0.35
  reason: queen may have died or failed
- state: Queenright
  confidence: 0.2
  reason: queen may be on a frame you didn't pull, or she stopped laying temporarily
---

# Description

Couldn't find the queen and no eggs visible.

# Candidates

- [Queenless](/states/queenless.md) (confidence 0.35) — queen may have died or failed
- [Queenright](/states/queenright.md) (confidence 0.2) — queen may be on a frame you didn't pull, or she stopped laying temporarily

# Notes

Check for queen cells — if present, the colony is requeening itself. Look harder for the queen on frames you didn't fully inspect. If no queen, no eggs, no cells: add a frame of eggs/young larvae from another colony — if they build emergency cells, they're queenless.
