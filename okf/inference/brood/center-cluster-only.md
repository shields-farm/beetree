---
type: Inference Rule
title: Center Cluster Only
description: Brood tightly clustered in the center of the frame, empty cells at the periphery.
tags:
- beekeeping
- ontology
- inference
- brood
method: brood_inference
key: center_cluster_only
observes: /classes/brood-pattern.md
generated:
  by: agent:sam
  at: '2026-09-15T15:45:00Z'
candidates:
- state: Queenright
  confidence: 0.4
  reason: small colony or cold-weather contraction
- state: Dwindling
  confidence: 0.25
  reason: if colony is shrinking across inspections
---

# Description

Brood tightly clustered in the center of the frame, empty cells at the periphery.

# Candidates

- [Queenright](/states/queenright.md) (confidence 0.4) — small colony or cold-weather contraction
- [Dwindling](/states/dwindling.md) (confidence 0.25) — if colony is shrinking across inspections

# Notes

Season-dependent. In winter/early spring: normal — the colony is clustered tight and only rearing brood where they can keep it warm. In active season with good temperatures: suggests the colony is small or stressed. Check: colony size vs neighbors, food stores, varroa load.
