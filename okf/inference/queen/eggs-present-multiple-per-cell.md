---
type: Inference Rule
title: Eggs Present Multiple Per Cell
description: Multiple eggs per cell, eggs laid on cell walls, not at the base.
tags:
- beekeeping
- ontology
- inference
- queen
method: queen_inference
key: eggs_present_multiple_per_cell
observes: /classes/queen-status.md
generated:
  by: agent:sam
  at: '2026-09-15T15:45:00Z'
candidates:
- state: LayingWorkers
  confidence: 0.85
  reason: worker bees laying unfertilized eggs in absence of a queen
---

# Description

Multiple eggs per cell, eggs laid on cell walls, not at the base.

# Candidates

- [LayingWorkers](/states/laying-workers.md) (confidence 0.85) — worker bees laying unfertilized eggs in absence of a queen

# Notes

Laying workers. Multiple eggs per cell and eggs on cell walls (not the base) are diagnostic — a real queen lays one egg per cell, centered. Requeening almost always fails (workers reject the queen). Combine with a stronger colony or shake out and let them drift into other hives.
