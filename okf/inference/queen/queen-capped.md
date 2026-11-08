---
type: Inference Rule
title: Queen Capped
description: A capped queen cell is present — the new queen is developing inside and will emerge soon.
tags:
- beekeeping
- ontology
- inference
- queen
method: queen_inference
key: queen_capped
observes: /classes/queen-status.md
generated:
  by: agent:sam
  at: '2026-09-15T15:45:00Z'
candidates:
- state: SwarmPrep
  confidence: 0.4
  reason: if swarm cells
- state: Queenright
  confidence: 0.4
  reason: if supersedure — new queen emerging
---

# Description

A capped queen cell is present — the new queen is developing inside and will emerge soon.

# Candidates

- [SwarmPrep](/states/swarm-prep.md) (confidence 0.4) — if swarm cells
- [Queenright](/states/queenright.md) (confidence 0.4) — if supersedure — new queen emerging

# Notes

A capped queen cell means emergence is 7-8 days after capping. Determine if these are swarm cells (bottom edge, multiple → act now) or supersedure cells (face of frame, 1-3 → let nature run).
