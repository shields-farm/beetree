---
type: Behavior Contract
title: Undefined behavior
description: What the agent must do when a lookup does not resolve to a defined entity.
tags:
- beekeeping
- ontology
- contract
generated:
  by: agent:sam
  at: '2026-09-15T15:45:00Z'
---

# Contract

- **`alias_miss`** — Unknown pest name — agent should checkpoint with user: 'I don't recognize that pest. Did you mean small hive beetle?'
- **`predicate_miss`** — Unknown relation type — agent asks which of the defined relations was intended rather than asserting.
- **`species_miss`** — Species lookup returned nothing — agent states plainly and offers nearest defined species.
