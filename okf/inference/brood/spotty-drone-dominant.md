---
type: Inference Rule
title: Spotty Drone Dominant
description: Spotty brood with mostly drone cells — bullet-shaped cappings raised above the frame surface.
tags:
- beekeeping
- ontology
- inference
- brood
method: brood_inference
key: spotty_drone_dominant
observes: /classes/brood-pattern.md
generated:
  by: agent:sam
  at: '2026-09-15T15:45:00Z'
candidates:
- state: DroneLayer
  confidence: 0.85
  reason: drone-laying queen (lost queen, failed to mate, or queen too old)
- state: LayingWorkers
  confidence: 0.6
  reason: if no queen cells seen and colony has been queenless >3 weeks
---

# Description

Spotty brood with mostly drone cells — bullet-shaped cappings raised above the frame surface.

# Candidates

- [DroneLayer](/states/drone-layer.md) (confidence 0.85) — drone-laying queen (lost queen, failed to mate, or queen too old)
- [LayingWorkers](/states/laying-workers.md) (confidence 0.6) — if no queen cells seen and colony has been queenless >3 weeks

# Notes

High-confidence diagnosis. Bullet-shaped drone cappings = drones being raised in worker cells. Means only unfertilized eggs are being laid. Distinguish drone-laying queen vs laying workers:
  - Single egg per cell, orderly pattern → drone-laying queen
  - Multiple eggs per cell, eggs on cell walls → laying workers
Drone-laying queen: requeen immediately. Laying workers: combine with another colony — requeening almost always fails.
