---
type: Inference Rule
title: Drone Only Pupal
description: Only drone pupal brood visible — no worker larvae or eggs.
tags:
- beekeeping
- ontology
- inference
- brood
method: brood_inference
key: drone_only_pupal
observes: /classes/brood-pattern.md
generated:
  by: agent:sam
  at: '2026-09-15T15:45:00Z'
candidates:
- state: DroneLayer
  confidence: 0.75
- state: LayingWorkers
  confidence: 0.5
---

# Description

Only drone pupal brood visible — no worker larvae or eggs.

# Candidates

- [DroneLayer](/states/drone-layer.md) (confidence 0.75)
- [LayingWorkers](/states/laying-workers.md) (confidence 0.5)

# Notes

Similar to spotty_drone_dominant but at the pupal stage — means the colony has been drone-laying for at least 24 days (drone development time). More likely laying workers if it's been this way for a while. Check for multiple eggs per cell to distinguish.
