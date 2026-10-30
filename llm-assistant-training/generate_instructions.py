#!/usr/bin/env python3
"""
generate_instructions.py — Synthetic training data from the BeeTree ontology.

Reads the vocab YAML + live SQLite ontology tables and emits ~1,000
instruction/response pairs in Alpaca-style JSONL for LoRA fine-tuning.

Categories:
  1. threat_lookup      (~400) — alias/name/scientific → threat card
  2. threat_kind_filter (~120) — "list all parasites" etc.
  3. season_reasoning   (~120) — date → season phase + implications
  4. entity_graph       (~150) — live yard: what's on hive-X, relations
  5. colony_state       (~100) — currentState queries w/ confidence + rationale
  6. undefined_behavior (~110) — unknown pest/predicate → checkpoint behavior

Usage:
  python3 generate_instructions.py [--db PATH] [--vocab PATH] [--out PATH]
"""

import argparse
import json
import random
import sqlite3
import sys
from pathlib import Path

import yaml

random.seed(42)

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "data" / "beetree.db"
DEFAULT_VOCAB = REPO / "server" / "ontology" / "beetree-vocab.yaml"
DEFAULT_OUT = Path(__file__).resolve().parent / "data" / "instructions.jsonl"

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

SYSTEM_PREFIX = (
    "You are a certified beekeeper assistant inside BeeTree, with access to a "
    "typed ontology of the beekeeper's yard. Answer using ontology vocabulary "
    "and cite confidence when a state is inferred rather than observed."
)


def load_vocab(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def q1(conn, sql, *args):
    cur = conn.execute(sql, args)
    return cur.fetchall()


def threat_card(sp: dict, vocab: dict) -> str:
    """Canonical one-card answer for a threat species."""
    parts = [f"{sp['name']}"]
    if sp.get("scientific"):
        parts[0] += f" ({sp['scientific']})"
    parts[0] += f" — {sp['kind']}."
    if sp.get("notes"):
        parts.append(sp["notes"])
    if sp.get("vectors"):
        names = []
        for v in sp["vectors"]:
            tgt = next((s for s in vocab["threat_species"] if s["id"] == v), None)
            names.append(tgt["name"] if tgt else v)
        parts.append(f"Known vector of: {', '.join(names)}.")
    if sp.get("vectored_by"):
        names = []
        for v in sp["vectored_by"]:
            tgt = next((s for s in vocab["threat_species"] if s["id"] == v), None)
            names.append(tgt["name"] if tgt else v)
        parts.append(f"Vectored by: {', '.join(names)}.")
    if sp.get("notifiable"):
        parts.append("This is a NOTIFIABLE disease in Georgia — report suspected cases.")
    return " ".join(parts)


def gen_threat_lookup(vocab: dict) -> list:
    out = []
    aliases = vocab["threat_aliases"]
    species = vocab["threat_species"]

    questions = [
        "What is {q}?",
        "Tell me about {q}.",
        "What's {q}?",
        "Have you heard of {q}?",
        "What does {q} do to hives?",
        "Is {q} dangerous?",
        "How worried should I be about {q}?",
        "I found signs of {q} — what am I dealing with?",
        "A beekeeper at the meeting mentioned {q}. What is it?",
        "Can {q} kill a colony?",
        "How do I identify {q}?",
        "Where does {q} come from?",
    ]

    seen = set()
    for alias, sid in sorted(aliases.items()):
        sp = next((s for s in species if s["id"] == sid), None)
        if not sp:
            continue
        pretty = alias.replace("_", " ")
        for tmpl in random.sample(questions, 6):
            key = (alias, tmpl)
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "instruction": tmpl.format(q=pretty),
                "input": "",
                "output": threat_card(sp, vocab),
                "category": "threat_lookup",
            })

    # Also canonical names + scientific names
    for sp in species:
        for q in (sp["name"], sp.get("scientific")):
            if not q:
                continue
            for tmpl in random.sample(questions, 4):
                out.append({
                    "instruction": tmpl.format(q=q),
                    "input": "",
                    "output": threat_card(sp, vocab),
                    "category": "threat_lookup",
                })

    random.shuffle(out)
    return out[:400]


def gen_threat_kind_filter(vocab: dict) -> list:
    out = []
    species = vocab["threat_species"]
    by_kind = {}
    for sp in species:
        by_kind.setdefault(sp["kind"], []).append(sp["name"])

    questions = [
        ("List all {kind}s that threaten honey bees.", "list"),
        ("Which {kind}s should I watch for?", "list"),
        ("What {kind}s are in the threat catalog?", "list"),
    ]
    for kind, names in sorted(by_kind.items()):
        for tmpl, _ in questions:
            out.append({
                "instruction": tmpl.format(kind=kind),
                "input": "",
                "output": f"The catalog lists {len(names)} {kind}(s): {', '.join(sorted(names))}.",
                "category": "threat_kind_filter",
            })
    return out[:120]


def gen_season_reasoning(vocab: dict) -> list:
    out = []
    phases = vocab["season_phase_inference"]

    implications = {
        "Buildup": "Colonies are ramping brood production. Watch for early swarm signs as congestion builds; ensure feed through the gap before the flow.",
        "HoneyFlow": "Primary nectar flow. Add supers ahead of need; monitor weight gain and swarm prep.",
        "Dearth": "Nectar gap. Robbing risk is high — reduce entrances, avoid open feeding, watch for dwindling colonies.",
        "WinterCluster": "Cluster season. Minimal intervention; monitor weight via sensors and heft; heft before warm spells.",
    }

    def phase_for_month(m: int) -> str | None:
        for phase, cfg in phases.items():
            months = cfg["months"]
            if m in months:
                # note: overlapping months (e.g. 1 in Buildup and WinterCluster) —
                # prefer whichever phase the YAML lists first, matching server logic order
                return phase
        return None

    questions = [
        "What beekeeping season is {month}?",
        "What phase are hives in during {month}?",
        "It's {month} — what should I expect from my colonies?",
        "What season frame applies in {month} in middle Georgia?",
        "In {month}, what are my bees doing?",
        "What should I be watching for in {month}?",
        "Is {month} a good time to add supers?",
        "What's on my beekeeping calendar for {month}?",
    ]

    for m in range(1, 13):
        phase = phase_for_month(m)
        if not phase:
            continue
        cfg = phases[phase]
        band = cfg.get("mean_temp_band_c", [None, None])
        temp = f" Typical mean temperature band: {band[0]}–{band[1]}°C." if band[0] is not None else ""
        for tmpl in random.sample(questions, 6):
            out.append({
                "instruction": tmpl.format(month=MONTH_NAMES[m - 1]),
                "input": "",
                "output": f"{MONTH_NAMES[m - 1]} falls in the {phase} phase (months {cfg['months']}).{temp} {implications[phase]}",
                "category": "season_reasoning",
            })

        # ISO date variant
        out.append({
            "instruction": f"What season phase is 2026-{m:02d}-15?",
            "input": "",
            "output": f"{phase}. {implications[phase]}",
            "category": "season_reasoning",
        })
    random.shuffle(out)
    return out[:120]


def gen_entity_graph(conn, vocab) -> list:
    out = []
    entities = q1(conn, "SELECT entity_id, entity_type, name FROM onto_entity WHERE superseded_by IS NULL")
    relations = q1(conn, "SELECT subject_id, predicate, object_id FROM onto_relation WHERE superseded_by IS NULL")
    by_id = {e[0]: {"type": e[1], "name": e[2]} for e in entities}

    rel_index = {}
    for s, p, o in relations:
        rel_index.setdefault(s, []).append((p, o))

    questions = [
        "What's on {name}?",
        "Describe {name}.",
        "What do you know about {name}?",
        "Show me the graph for {name}.",
        "What's connected to {name}?",
        "Walk me through everything attached to {name}.",
        "Give me the full picture of {name}.",
        "What relations does {name} have?",
    ]

    for eid, meta in by_id.items():
        rels = rel_index.get(eid, [])
        if not rels:
            continue
        human = meta["name"] or eid
        lines = [f"{human} is a {meta['type']}."]
        for pred, obj in rels:
            tgt = by_id.get(obj)
            tgt_name = (tgt["name"] or obj) if tgt else obj
            lines.append(f"  - {pred} → {tgt_name}")
        for tmpl in random.sample(questions, 4):
            out.append({
                "instruction": tmpl.format(name=human),
                "input": "",
                "output": "\n".join(lines),
                "category": "entity_graph",
            })

        # id form too
        out.append({
            "instruction": f"What relations exist for entity {eid}?",
            "input": "",
            "output": "\n".join(lines),
            "category": "entity_graph",
        })
    random.shuffle(out)
    return out[:150]


def gen_colony_state(conn, vocab) -> list:
    out = []
    rows = q1(
        conn,
        """SELECT i.state_class, i.subject_id, i.confidence, i.rationale, e.name
           FROM onto_instantiation i
           LEFT JOIN onto_entity e ON e.entity_id = i.subject_id AND e.superseded_by IS NULL
           WHERE i.valid_to IS NULL AND i.superseded_by IS NULL""",
    )
    for state, subj, conf, rationale, name in rows:
        human = name or subj
        pct = f"{int(round(conf * 100))}%"
        base = f"{human} is currently {state} (confidence {pct})."
        if rationale:
            r = rationale.rstrip(".")
            base += f" Rationale: {r}."
        if conf < 0.75:
            base += " This is an inferred state — confirm by inspection before acting on it."
        for q in (
            f"Is {human} {state.lower()}?",
            f"What's the current state of {human}?",
            f"How is {human} doing right now?",
        ):
            out.append({
                "instruction": q,
                "input": "",
                "output": base,
                "category": "colony_state",
            })
    random.shuffle(out)
    return out[:100]


def gen_undefined_behavior(vocab: dict) -> list:
    out = []
    ub = vocab["undefined_behavior"]

    unknown_pests = [
        "murder hornet", "zombie mites", "bee lice deluxe", "razzmatazz beetle",
        "hive gremlins", "space varroa", "quantum wax moth", "the yellow thing",
    ]
    for pest in unknown_pests:
        out.append({
            "instruction": f"Should I worry about {pest} in my hives?",
            "input": "",
            "output": (
                f"I don't have '{pest}' in the threat catalog. {ub['alias_miss']} "
                "If you can describe what you're seeing, I can try to match it to a "
                "defined threat species (varroa, small hive beetle, wax moths, etc.)."
            ),
            "category": "undefined_behavior",
        })

    unknown_preds = ["isFriendsWith", "marriedTo", "eatsHoneyFrom", "owesMoneyTo", "vibesWith"]
    for pred in unknown_preds:
        out.append({
            "instruction": f"Assert that hive-1 {pred} hive-2.",
            "input": "",
            "output": (
                f"'{pred}' is not a defined relation in the ontology. {ub['predicate_miss']} "
                "Defined predicates: heads, isOn, emits, detectedIn, descendedFrom, "
                "precedes, vectorOf, resolvedBy."
            ),
            "category": "undefined_behavior",
        })
    random.shuffle(out)
    return out[:110]


def gen_brood_patterns(vocab: dict) -> list:
    """Brood pattern observation → differential diagnosis. This is the
    reasoning layer — the model learns to interpret what the beekeeper
    sees at the frame face and narrow to colony states with appropriate
    confidence + follow-up questions."""
    out = []
    rules = vocab.get("brood_inference", {})
    if not rules:
        return out

    # User phrasings for each pattern — the ways a beekeeper actually describes
    # what they see, not the canonical enum name.
    PHRASINGS = {
        "solid_capped": [
            "The brood is solid and fully capped across the frame.",
            "I'm seeing tight, fully capped brood — looks good.",
            "Frame is wall-to-wall capped brood, nice tight pattern.",
            "Solid capped brood, edge to edge.",
            "Brood looks great — fully capped, no gaps.",
        ],
        "solid_scattered_uncapped": [
            "Mostly solid brood but there are some uncapped and empty cells scattered through.",
            "The pattern is mostly good but there's scattered uncapped brood.",
            "Frame is mostly capped but with some empty cells mixed in.",
            "Solid brood pattern with a few uncapped cells throughout.",
            "Looks good overall but some scattered empty cells in the brood nest.",
        ],
        "spotty_mixed": [
            "The brood is spotty — lots of empty cells mixed with capped and uncapped.",
            "I'm seeing a shotgun pattern on this frame — really patchy brood.",
            "Spotty brood, no clear pattern, mixed capped and empty cells.",
            "The brood nest looks irregular — empty cells everywhere, not solid at all.",
            "Patchy brood pattern, can't tell what's going on.",
        ],
        "spotty_drone_dominant": [
            "Spotty brood and most of the capped cells are bullet-shaped drone cells.",
            "I'm seeing mostly drone brood — bullet cappings raised up, spotty pattern.",
            "The brood is spotty with raised bullet-shaped cappings — looks like all drones.",
            "Almost all the capped brood is drone — bullet cells everywhere, really patchy.",
            "Spotty pattern, drone cappings dominant, raised bullet shapes.",
        ],
        "center_cluster_only": [
            "Brood is only in the center of the frame — tight cluster, nothing at the edges.",
            "The brood is clustered tight in the middle, empty cells around the periphery.",
            "Just a small patch of brood in the center, rest of the frame is empty.",
            "Center-only brood, tightly clustered, nothing on the sides.",
            "The bees are only rearing brood in the center — tight little cluster.",
        ],
        "peripheral_brood": [
            "Weird — there's brood on the edges of the frame but not in the center.",
            "Brood on the frame periphery but the center is empty.",
            "The queen laid on the edges but not the center of the frame.",
            "Unusual pattern — brood around the outside, empty in the middle.",
        ],
        "absent": [
            "There's no brood on this frame at all — nothing.",
            "No brood. No eggs, no larvae, no capped cells. Empty frame.",
            "I can't find any brood on this frame.",
            "Zero brood on this frame. Is that normal?",
            "No brood at all — should I be worried?",
        ],
        "drone_only_pupal": [
            "The only brood I can find is drone pupae — no worker larvae or eggs.",
            "Just drone pupal brood, no workers at any stage.",
            "All I see is capped drone pupae — no worker brood at all.",
            "Drone pupae only — no eggs, no worker larvae, just capped drones.",
        ],
    }

    SEASON_CONTEXTS = [
        "",  # no season context
        "It's March. ",
        "It's June. ",
        "It's August. ",
        "It's January. ",
        "It's October. ",
        "We're in the buildup. ",
        "We're in the honey flow. ",
        "We're in the dearth. ",
        "We're in winter cluster. ",
    ]

    for pattern_id, rule in rules.items():
        phrasings = PHRASINGS.get(pattern_id, [rule["description"]])

        # For each phrasing, generate a training example
        for user_desc in phrasings:
            for season_prefix in random.sample(SEASON_CONTEXTS, min(3, len(SEASON_CONTEXTS))):
                instruction = season_prefix + user_desc
                # Build the response: diagnosis + confidence + differential
                diagnoses = rule["indicates"]
                notes = rule.get("notes", "").strip()

                if len(diagnoses) == 1 and diagnoses[0]["confidence"] >= 0.85:
                    # High confidence — direct answer
                    d = diagnoses[0]
                    answer = f"This indicates {d['state']} (confidence {int(d['confidence']*100)}%)."
                    if "reason" in d:
                        answer += f" Likely cause: {d['reason']}."
                    answer += f" {notes}"
                elif len(diagnoses) == 1 and diagnoses[0]["confidence"] >= 0.60:
                    # Medium confidence — answer with monitoring advice
                    d = diagnoses[0]
                    answer = f"This suggests {d['state']} (confidence {int(d['confidence']*100)}%)."
                    if "reason" in d:
                        answer += f" {d['reason']}."
                    answer += f" {notes}"
                else:
                    # Low confidence / differential — ask follow-up questions
                    candidates = []
                    for d in diagnoses:
                        cands = f"{d['state']} ({int(d['confidence']*100)}%)"
                        if "reason" in d:
                            cands += f" — {d['reason']}"
                        candidates.append(cands)
                    answer = "This could be several things. Differential diagnosis:\n"
                    for c in candidates:
                        answer += f"  - {c}\n"
                    answer += f"\n{notes}"

                out.append({
                    "instruction": instruction,
                    "input": "",
                    "output": answer.strip(),
                    "category": "brood_pattern",
                })

        # Also generate "what does X brood pattern mean?" style questions
        canonical_q = f"What does {pattern_id.replace('_', ' ')} brood mean?"
        d0 = rule["indicates"][0]
        answer = f"{rule['description']} This indicates {d0['state']} (confidence {int(d0['confidence']*100)}%). {rule.get('notes', '').strip()}"
        out.append({
            "instruction": canonical_q,
            "input": "",
            "output": answer.strip(),
            "category": "brood_pattern",
        })

    random.shuffle(out)
    return out[:250]


def gen_comb_conditions(vocab: dict) -> list:
    """Comb condition observations → age assessment + rotation action."""
    out = []
    rules = vocab.get("comb_inference", {})
    if not rules:
        return out

    PHRASINGS = {
        "white_new": [
            "The comb is bright white — freshly drawn.",
            "I'm seeing new white wax on this frame.",
            "Fresh white comb, never had brood in it.",
            "The bees just drew this out — pure white.",
        ],
        "light_cream": [
            "The comb is slightly off-white, light cream colored.",
            "Comb is a light cream color — looks fairly new.",
            "Off-white comb, maybe a cycle or two old.",
        ],
        "golden_light": [
            "The comb is a light golden color.",
            "Golden-yellow comb, been through a few brood cycles.",
            "Light golden comb — looks like it's been used a few times.",
            "The wax is golden but still fairly light.",
        ],
        "golden_medium": [
            "The comb is medium golden-brown.",
            "Comb is getting darker — medium brown/gold.",
            "Golden-brown comb, definitely been through several brood cycles.",
            "The wax on this frame is a solid golden brown.",
        ],
        "dark_brown": [
            "This comb is dark brown — been in the hive a while.",
            "Dark brown comb, lots of cocoon buildup.",
            "The comb on this frame is really dark — brown to dark brown.",
            "Old dark brown comb, cells look a bit smaller.",
            "This frame has dark brown wax — definitely needs attention.",
        ],
        "black_old": [
            "This comb is black — really old.",
            "Black comb, cells are noticeably narrow.",
            "The wax is black and crusty — this frame is ancient.",
            "Black comb with heavy cocoon buildup — cells look tiny.",
            "This is the darkest comb I've seen — practically black.",
        ],
        "distorted_cells": [
            "The cells on this frame are all wavy and uneven.",
            "Comb is distorted — irregular cell sizes, wonky walls.",
            "The comb pattern is really uneven on this frame.",
            "Distorted comb — cells aren't uniform at all.",
        ],
        "drone_comb_in_worker_area": [
            "There's drone comb mixed in with the worker brood area.",
            "I'm seeing bigger drone cells in the worker section.",
            "Drone comb showing up where it shouldn't be — in the worker area.",
            "Lots of drone comb being drawn in the worker zone.",
        ],
        "wax_moth_damage": [
            "There's webbing and tunnels in the comb — looks like wax moth.",
            "I see wax moth larvae in this frame, webbing everywhere.",
            "Wax moth damage — comb is tunneled and silken.",
            "This frame has wax moth — webbing and larvae visible.",
        ],
        "burr_comb": [
            "There's burr comb between the frames — wax in all the wrong places.",
            "Burr comb on the top bars again, they keep building in the gaps.",
            "Wax built up between frames and on the inner cover — burr comb everywhere.",
            "They're filling every gap with burr comb. Do they need more space?",
            "Lots of burr comb on these frames — is this genetic?",
            "Burr comb between every frame, had to scrape it all off to pull them.",
        ],
        "cross_comb": [
            "The comb is going across frames instead of along them — they're stuck together.",
            "Cross comb — they built at right angles, I can't pull frames separately.",
            "Comb connecting multiple frames, going the wrong direction.",
            "Frames are stuck together with cross comb. This is a mess.",
        ],
        "brace_comb": [
            "Small wax connections between the top bars — brace comb.",
            "Brace comb connecting the frames, had to break them apart.",
            "Wax bridges between frame top bars — minor but annoying.",
            "Brace comb on the top bars, frames stuck together slightly.",
        ],
    }

    for condition_id, rule in rules.items():
        phrasings = PHRASINGS.get(condition_id, [rule["description"]])

        for user_desc in phrasings:
            desc = rule["description"]
            action = rule["action"]
            notes = rule.get("notes", "").strip()
            age = rule.get("age_cycles", "")
            causes = rule.get("causes", [])

            # Build response
            answer = f"{desc}"
            if age != "":
                answer += f" Estimated age: {age} brood cycles."
            if causes:
                answer += " Could be:"
                for c in causes:
                    answer += f" {c['cause']} ({int(c['confidence']*100)}%)"
                    if c.get("notes"):
                        answer += f" — {c['notes']}"
                    answer += "."
            answer += f" {action}"
            if notes:
                answer += f" {notes}"

            out.append({
                "instruction": user_desc,
                "input": "",
                "output": answer.strip(),
                "category": "comb_condition",
            })

        # Also "when should I rotate" style questions
        if age != "":
            out.append({
                "instruction": f"When should I rotate comb that's {condition_id.replace('_', ' ')}?",
                "input": "",
                "output": f"{desc} {action} {notes}".strip(),
                "category": "comb_condition",
            })

    # General rotation question
    out.append({
        "instruction": "How often should I rotate my brood comb?",
        "input": "",
        "output": (
            "Rotate brood comb every 3-4 years (12-16 brood cycles). Each brood cycle "
            "leaves a silk cocoon lining in the cell, darkening the wax and slightly "
            "narrowing the cells. After 12+ cycles, bees raised in old comb are smaller, "
            "and pesticide/acaricide residues accumulate to concerning levels. Move dark "
            "frames to the outside of the brood box so the queen stops laying in them, "
            "then remove when empty of brood. Replace with fresh foundation or starter strips."
        ),
        "category": "comb_condition",
    })

    random.shuffle(out)
    return out[:150]


def gen_queen_status(vocab: dict) -> list:
    """Queen and egg observations → diagnosis and action.

    The distinction between swarm cells and supersedure cells is the
    highest-stakes call a beekeeper makes. This function generates
    diverse paraphrased training examples from the queen_inference rules.
    """
    out = []
    rules = vocab.get("queen_inference", {})
    if not rules:
        return out

    PHRASINGS = {
        "eggs_present_single": [
            "I see single eggs in the cells, standing upright at the base.",
            "There's one egg per cell, nice and upright — looks good.",
            "Single eggs per cell, centered at the base. Queen's been here recently.",
            "I found eggs — one per cell, upright. She's laying.",
            "Eggs present, one per cell, standing on end. Looks normal.",
        ],
        "eggs_present_multiple_per_cell": [
            "I'm seeing multiple eggs in some cells — like 2-3 per cell.",
            "There are eggs on the cell walls, not at the base. Multiple per cell.",
            "More than one egg per cell — some are on the sides of the cells.",
            "I found multiple eggs per cell and they're not at the base.",
            "Eggs everywhere — multiple per cell, some on the walls. Is this normal?",
        ],
        "queen_spotted_marked": [
            "I found the queen — she's marked with a blue dot.",
            "Spotted the marked queen on frame 3. She looks good.",
            "The queen is here, marked with a green dot.",
            "I located the marked queen. She's walking and laying.",
            "Found her — marked queen, easy to spot with the color dot.",
        ],
        "queen_spotted_unmarked": [
            "I spotted the queen but she's not marked.",
            "Found the queen — unmarked, but she's definitely the queen.",
            "I see her — unmarked queen walking across the frame.",
            "Located an unmarked queen. Should I mark her?",
            "The queen is visible but doesn't have a mark on her.",
        ],
        "queen_not_found_eggs_present": [
            "I can't find the queen but there are eggs in the cells.",
            "No queen spotted, but eggs are present — one per cell, looks normal.",
            "Couldn't locate the queen, but I see fresh eggs. She must be in there.",
            "I didn't see the queen, but there are upright eggs in the brood nest.",
            "Queen not found, but eggs are there. Should I be worried?",
        ],
        "queen_not_found_no_eggs": [
            "I can't find the queen and I don't see any eggs.",
            "No queen, no eggs — looked through every frame.",
            "Couldn't spot her and there are no eggs anywhere.",
            "I went through the whole hive — no queen, no eggs visible.",
            "Missing queen and no eggs. What should I do?",
        ],
        "virgin_queen": [
            "I think I see a virgin queen — small, fast-moving, no eggs around.",
            "There's a small queen-looking bee running fast on the frame, no eggs laid yet.",
            "I spotted what might be a virgin queen — she's small and quick.",
            "Small fast queen, no eggs in the cells. Could she be unmated?",
            "I see a virgin queen I think — she's smaller than normal and moving fast.",
        ],
        "swarm_cells": [
            "There are queen cells along the bottom edges of the frames — multiple peanut-shaped cells.",
            "I'm seeing swarm cells — several on the bottom of the frames, peanut-shaped.",
            "Multiple queen cells on the bottom edge. Are they going to swarm?",
            "Queen cells hanging off the bottom of the frames — looks like swarm prep.",
            "I count at least 5 queen cells on the bottom edges. Swarm?",
        ],
        "supersedure_cells": [
            "I see a couple of queen cells on the face of the frame, not the bottom edge.",
            "There are 1-2 queen cells on the side of the frame. Supersedure?",
            "Queen cells on the face of the frame — just a couple, not on the bottom.",
            "I found 2 queen cells mid-frame. They look like supersedure cells.",
            "A few queen cells on the frame face — is the colony replacing the queen?",
        ],
        "emergency_cells": [
            "I see rough-looking queen cells scattered around — shorter than usual.",
            "There are emergency queen cells — raised from worker cells, kind of rough.",
            "Queen cells but they look odd — short and scattered, not on the bottom edge.",
            "Emergency cells visible — the colony must have lost its queen.",
            "I see rough, short queen cells in the middle of the frame. Emergency requeening?",
        ],
        "queen_capped": [
            "There's a capped queen cell on the frame.",
            "I found a capped queen cell — she'll emerge soon.",
            "One of the queen cells is capped. How long until she emerges?",
            "Capped queen cell visible on the bottom of the frame.",
            "I see a capped queen cell. What does that mean?",
        ],
        "queen_cups_empty": [
            "I see queen cups on the bottom bars but they're empty — no eggs.",
            "There are play cups on the bottom of the frames. Are these queen cells?",
            "Empty queen cups — just the cup, no egg, no larva. Should I be worried?",
            "I found what looks like queen cups on the bottom bars, all empty.",
            "The workers have drawn queen cups but there's nothing in them.",
            "Queen cups, no eggs inside — is my hive going to swarm?",
        ],
        "no_queen_no_eggs_no_cells": [
            "No queen, no eggs, no queen cells — nothing. This hive looks queenless.",
            "I went through every frame — no queen, no eggs, no cells of any kind.",
            "The hive has no queen, no eggs, and no queen cells. What do I do?",
            "Completely empty — no queen spotted, no eggs, no queen cells.",
            "I can't find anything — no queen, no eggs, no cells. Is this hive dead?",
        ],
    }

    SEASON_CONTEXTS = [
        "",  # no season context
        "It's March. ",
        "It's June. ",
        "It's August. ",
        "It's January. ",
        "It's October. ",
        "We're in the buildup. ",
        "We're in the honey flow. ",
        "We're in the dearth. ",
        "We're in winter cluster. ",
    ]

    for pattern_id, rule in rules.items():
        phrasings = PHRASINGS.get(pattern_id, [rule["description"]])

        for user_desc in phrasings:
            for season_prefix in random.sample(SEASON_CONTEXTS, min(3, len(SEASON_CONTEXTS))):
                instruction = season_prefix + user_desc
                diagnoses = rule["indicates"]
                notes = rule.get("notes", "").strip()

                if len(diagnoses) == 1 and diagnoses[0]["confidence"] >= 0.85:
                    # High confidence — direct answer
                    d = diagnoses[0]
                    answer = f"This indicates {d['state']} (confidence {int(d['confidence']*100)}%)."
                    if "reason" in d:
                        answer += f" Likely cause: {d['reason']}."
                    answer += f" {notes}"
                elif len(diagnoses) == 1 and diagnoses[0]["confidence"] >= 0.60:
                    # Medium confidence — answer with monitoring advice
                    d = diagnoses[0]
                    answer = f"This suggests {d['state']} (confidence {int(d['confidence']*100)}%)."
                    if "reason" in d:
                        answer += f" {d['reason']}."
                    answer += f" {notes}"
                else:
                    # Low confidence / differential — ask follow-up questions
                    candidates = []
                    for d in diagnoses:
                        cands = f"{d['state']} ({int(d['confidence']*100)}%)"
                        if "reason" in d:
                            cands += f" — {d['reason']}"
                        candidates.append(cands)
                    answer = "This could be several things. Differential diagnosis:\n"
                    for c in candidates:
                        answer += f"  - {c}\n"
                    answer += f"\n{notes}"

                out.append({
                    "instruction": instruction,
                    "input": "",
                    "output": answer.strip(),
                    "category": "queen_status",
                })

        # Also generate "what does X mean?" style canonical questions
        canonical_q = f"What does {pattern_id.replace('_', ' ')} mean?"
        d0 = rule["indicates"][0]
        answer = f"{rule['description']} This indicates {d0['state']} (confidence {int(d0['confidence']*100)}%). {rule.get('notes', '').strip()}"
        out.append({
            "instruction": canonical_q,
            "input": "",
            "output": answer.strip(),
            "category": "queen_status",
        })

    random.shuffle(out)
    return out[:200]


def gen_varroa_indicators(vocab: dict) -> list:
    """Visible varroa symptom observations → triage without a mite wash.

    Lets the agent do triage from a description or photo. DWV prevalence
    is a proxy for mite burden. Generates diverse paraphrased training
    examples from the varroa_inference rules.
    """
    out = []
    rules = vocab.get("varroa_inference", {})
    if not rules:
        return out

    PHRASINGS = {
        "deformed_wings": [
            "I'm seeing bees with shriveled, crumpled wings coming out of the cells.",
            "Some newly emerged bees have stunted or deformed wings.",
            "There are bees with shriveled wings crawling around the entrance.",
            "I notice deformed wings on some of the newly emerged bees.",
            "Bees with crumpled wings — looks like DWV to me.",
        ],
        "k_wing": [
            "Some bees have their wings held at a weird angle — like a K shape.",
            "I'm seeing K-wing on some bees — wings not folded flat over the body.",
            "Wings are sticking out at an unnatural angle, not folded flat.",
            "A few bees have K-wing — wings held out instead of folded over the abdomen.",
            "Some bees on the landing board have wings at an odd angle, like a K.",
        ],
        "hairless_black_bees": [
            "I see bees that look hairless and shiny black — almost like they've been shaved.",
            "There are dark, hairless bees on the frames, some seem to be trembling.",
            "Some bees are shiny and black with no body hair. Is that normal?",
            "I'm seeing hairless black bees — they look greasy and dark.",
            "A handful of bees look hairless, shiny, and dark. Some are trembling.",
        ],
        "phoretic_mites_visible": [
            "I can see varroa mites on the backs of some bees — little brown discs.",
            "There are mites visible on the bees — small red-brown spots on their bodies.",
            "I spotted varroa mites riding on adult bees. That can't be good.",
            "Mites are visible on the thorax of some bees — brownish discs.",
            "I can actually see mites on the bees. How bad is this?",
        ],
        "no_visible_symptoms": [
            "The bees look healthy — no deformed wings, no hairless bees, no mites visible.",
            "I don't see any wing deformities or hairless bees. They look fine.",
            "No visible varroa symptoms — bees look normal and healthy.",
            "Everything looks good — no deformed wings, no shiny bees, no visible mites.",
            "I checked for varroa symptoms but everything looks clean.",
        ],
        "parasitic_mite_syndrome": [
            "I'm seeing deformed wings AND hairless black bees AND spotty brood — the colony is shrinking.",
            "Multiple problems: deformed wings, hairless bees, spotty brood, and the population is way down.",
            "This hive has everything — DWV, hairless bees, patchy brood, and it's getting smaller.",
            "I see deformed wings, hairless shiny bees, spotty brood, and reduced population all at once.",
            "The colony has deformed wings, hairless bees, spotty brood — is this PMS?",
        ],
    }

    SEASON_CONTEXTS = [
        "",
        "It's March. ",
        "It's June. ",
        "It's August. ",
        "It's January. ",
        "It's October. ",
        "We're in the buildup. ",
        "We're in the honey flow. ",
        "We're in the dearth. ",
        "We're in winter cluster. ",
    ]

    for pattern_id, rule in rules.items():
        phrasings = PHRASINGS.get(pattern_id, [rule["description"]])

        for user_desc in phrasings:
            for season_prefix in random.sample(SEASON_CONTEXTS, min(2, len(SEASON_CONTEXTS))):
                instruction = season_prefix + user_desc
                diagnoses = rule["indicates"]
                notes = rule.get("notes", "").strip()

                if len(diagnoses) == 1 and diagnoses[0]["confidence"] >= 0.85:
                    d = diagnoses[0]
                    answer = f"This indicates {d['state']} (confidence {int(d['confidence']*100)}%)."
                    if "reason" in d:
                        answer += f" Likely cause: {d['reason']}."
                    answer += f" {notes}"
                elif len(diagnoses) == 1 and diagnoses[0]["confidence"] >= 0.60:
                    d = diagnoses[0]
                    answer = f"This suggests {d['state']} (confidence {int(d['confidence']*100)}%)."
                    if "reason" in d:
                        answer += f" {d['reason']}."
                    answer += f" {notes}"
                else:
                    candidates = []
                    for d in diagnoses:
                        cands = f"{d['state']} ({int(d['confidence']*100)}%)"
                        if "reason" in d:
                            cands += f" — {d['reason']}"
                        candidates.append(cands)
                    answer = "This could be several things. Differential diagnosis:\n"
                    for c in candidates:
                        answer += f"  - {c}\n"
                    answer += f"\n{notes}"

                out.append({
                    "instruction": instruction,
                    "input": "",
                    "output": answer.strip(),
                    "category": "varroa_indicator",
                })

        # Canonical "what does X mean?" style questions
        canonical_q = f"What does {pattern_id.replace('_', ' ')} mean?"
        d0 = rule["indicates"][0]
        answer = f"{rule['description']} This indicates {d0['state']} (confidence {int(d0['confidence']*100)}%). {rule.get('notes', '').strip()}"
        out.append({
            "instruction": canonical_q,
            "input": "",
            "output": answer.strip(),
            "category": "varroa_indicator",
        })

    random.shuffle(out)
    return out[:100]


def gen_deadout_forensics(vocab: dict) -> list:
    """Dead-out forensic observations → cause of death from the pattern.

    These are forensics, not differentials — the pattern tells you the cause.
    Uses the `diagnosis` field instead of `indicates`. Output is always direct:
    diagnosis + notes.
    """
    out = []
    rules = vocab.get("deadout_inference", {})
    if not rules:
        return out

    PHRASINGS = {
        "starved_headfirst": [
            "I opened the hive and the dead bees are head-first in the cells. No honey left.",
            "Dead bees stuck head-first in empty cells, no stores remaining.",
            "The bees died with their heads in the cells — looks like they starved. No honey anywhere.",
            "I found dead bees headfirst in cells and zero honey stores.",
            "Starvation? Bees are head-down in empty cells and there's no honey in the hive.",
        ],
        "pesticide_tongues_out": [
            "There's a huge pile of dead bees at the entrance, tongues sticking out.",
            "Dead bees everywhere outside the hive, tongues extended. Pesticide?",
            "I see hundreds of dead bees at the entrance with their tongues out.",
            "Big pile of dead bees, tongues sticking out — looks like poisoning to me.",
            "Dead bees with tongues extended at the hive entrance and on the ground.",
        ],
        "nosema_dysentery": [
            "There are brown streaks all over the front of the hive and the top bars.",
            "Brown splatter on the hive front — looks like dysentery. Nosema?",
            "I'm seeing brown streaks on the frames and entrance. Bee feces everywhere.",
            "The hive front is covered in brown streaks. Is this nosema?",
            "Brown stains on the landing board and top bars — dysentery signs.",
        ],
        "chilled_brood": [
            "I found grey and brown pupae on the bottom board — brood left uncovered.",
            "Dead brood on the bottom board, grey/brown colored. Chilled?",
            "There are chilled pupae on the bottom board — the cluster couldn't cover them.",
            "I see grey larvae and pupae dropped on the bottom board. Cold damage?",
            "Brood was left uncovered and died — grey/brown on the bottom board.",
        ],
        "dead_queen_only": [
            "Only the queen is dead — the rest of the colony looks fine.",
            "I found the queen dead but the rest of the hive seems normal.",
            "The queen died but the colony is otherwise OK. What happened?",
            "Dead queen, living colony. Should I be concerned?",
            "Just the queen is dead — everything else looks normal.",
        ],
        "absconded": [
            "The hive is empty — no dead bees, some honey and pollen left, brood abandoned.",
            "They absconded — empty hive, no bees, brood left behind, some stores remaining.",
            "The colony left. Empty hive, no dead bees, brood still on the frames.",
            "Nobody home — no bees, no queen, but there's honey and pollen. They absconded.",
            "The hive is completely empty of bees but there's brood and stores left behind.",
        ],
        "mice_damage": [
            "I see chewed comb, shredded nesting material, and mouse droppings in the hive.",
            "There's mouse damage — chewed comb, droppings, and a nasty smell.",
            "A mouse nested in the hive over winter — comb is chewed, droppings everywhere.",
            "I found shredded wood and leaves in the hive, comb chewed up. Mouse?",
            "Mouse damage: chewed comb, nesting material, droppings, foul odor.",
        ],
        "robbing_destroyed": [
            "The comb is torn up, cappings ripped open, no honey left, dead bees everywhere.",
            "I think robbing destroyed this hive — torn cappings, ripped comb, no stores.",
            "Robbing damage: honey cells ripped open, dead bees, disorganized comb, nothing left.",
            "The hive was robbed out — torn cappings, dead bees, no honey. Robbing killed it.",
            "I see torn cappings and destroyed comb with no stores remaining. Robbing?",
        ],
    }

    for pattern_id, rule in rules.items():
        phrasings = PHRASINGS.get(pattern_id, [rule["description"]])

        for user_desc in phrasings:
            diagnosis = rule["diagnosis"]
            notes = rule.get("notes", "").strip()
            answer = f"{diagnosis} {notes}"

            out.append({
                "instruction": user_desc,
                "input": "",
                "output": answer.strip(),
                "category": "deadout_forensic",
            })

        # Canonical "what does X mean?" style questions
        canonical_q = f"What does {pattern_id.replace('_', ' ')} mean?"
        diagnosis = rule["diagnosis"]
        notes = rule.get("notes", "").strip()
        answer = f"{rule['description']} {diagnosis} {notes}"
        out.append({
            "instruction": canonical_q,
            "input": "",
            "output": answer.strip(),
            "category": "deadout_forensic",
        })

    random.shuffle(out)
    return out[:120]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--vocab", type=Path, default=DEFAULT_VOCAB)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    vocab = load_vocab(args.vocab)
    conn = sqlite3.connect(str(args.db))

    buckets = [
        gen_threat_lookup(vocab),
        gen_threat_kind_filter(vocab),
        gen_season_reasoning(vocab),
        gen_entity_graph(conn, vocab),
        gen_colony_state(conn, vocab),
        gen_undefined_behavior(vocab),
        gen_brood_patterns(vocab),
        gen_comb_conditions(vocab),
        gen_queen_status(vocab),
        gen_varroa_indicators(vocab),
        gen_deadout_forensics(vocab),
    ]

    all_rows = [r for bucket in buckets for r in bucket]
    random.shuffle(all_rows)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        for row in all_rows:
            row_with_sys = {"system": SYSTEM_PREFIX, **row}
            f.write(json.dumps(row_with_sys, ensure_ascii=False) + "\n")

    counts = {}
    for r in all_rows:
        counts[r["category"]] = counts.get(r["category"], 0) + 1
    print(f"Wrote {len(all_rows)} examples to {args.out}")
    for cat, n in sorted(counts.items()):
        print(f"  {cat:20s} {n}")


if __name__ == "__main__":
    main()
