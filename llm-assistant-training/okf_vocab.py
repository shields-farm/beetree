"""Read the BeeTree vocabulary from its Open Knowledge Format (OKF) bundle.

OKF v0.2 replaced `server/ontology/beetree-vocab.yaml`. A bundle is a directory
of markdown files: one *concept* per file, frontmatter for the machine-readable
fields, body for the prose, markdown links for relationships.

This module rebuilds the same dict the YAML used to parse into, so the training
and inference scripts keep working unchanged. It mirrors `server/okf-vocab.ts` —
if you change one, change the other. The parity script that proved the two agree
has been retired along with the YAML; `server/__tests__/okf-vocab.test.ts` is the
TypeScript guard, and `python3 okf_vocab.py` self-checks this side.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
DEFAULT_BUNDLE = HERE.parent / "okf"

_RESERVED = {"index.md", "log.md"}


def _split(text: str) -> tuple[dict | None, str]:
    """Split a concept document into (frontmatter, body)."""
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    try:
        fm = yaml.safe_load(text[3:end]) or {}
    except yaml.YAMLError:
        return None, text
    body = text[end + 4:].lstrip("\n")
    return fm, body


def _sections(body: str) -> dict[str, str]:
    """Split a body into `# Heading` → text."""
    out: dict[str, str] = {}
    current = None
    buf: list[str] = []
    for line in body.split("\n"):
        m = re.match(r"^#\s+(.*)$", line)
        if m:
            if current is not None:
                out[current] = "\n".join(buf).strip()
            current = m.group(1).strip()
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        out[current] = "\n".join(buf).strip()
    return out


def read_bundle(root: str | Path) -> list[dict]:
    """Every concept in the bundle, sorted by id."""
    root = Path(root)
    concepts = []
    for path in sorted(root.rglob("*.md")):
        # Only skip dot-directories *inside* the bundle — the bundle itself may
        # live under a dotted path, which is not a reason to skip its files.
        rel = path.relative_to(root)
        if path.name in _RESERVED or any(p.startswith(".") for p in rel.parts):
            continue
        fm, body = _split(path.read_text(encoding="utf-8"))
        if not fm or not fm.get("type"):
            continue  # not a conformant concept
        concepts.append({
            "id": str(rel)[:-3],
            "frontmatter": fm,
            "body": body,
        })
    return concepts


def build_vocab(concepts: list[dict]) -> dict:
    """Rebuild the vocabulary dict from OKF concepts."""
    classes: dict[str, dict] = {}
    relations: dict[str, dict] = {}
    season_phase_inference: dict[str, dict] = {}
    blocks = {
        "brood_inference": {}, "comb_inference": {}, "queen_inference": {},
        "varroa_inference": {}, "deadout_inference": {},
    }
    threat_species: list[dict] = []
    threat_aliases: dict[str, str] = {}
    undefined_behavior: dict[str, str] = {}
    name, version, schema_version = "beetree-vocab", "0.0.0", ""

    def carried(d: dict, keys) -> dict:
        return {k: d[k] for k in keys if d.get(k) is not None}

    for c in concepts:
        fm = c["frontmatter"]
        sec = _sections(c["body"])
        typ = fm.get("type")

        if typ == "Knowledge Bundle":
            name = fm.get("name", name)
            version = str(fm.get("version", version))
            schema_version = str(fm.get("schema_version", schema_version))

        elif typ == "Ontology Class":
            key = fm.get("key") or fm.get("title")
            if not key:
                continue
            cls = carried(fm, ["extends", "description", "parent_of",
                               "inferred_states", "headed_by", "events",
                               "observed_via", "vector_of"])
            if fm.get("kind_enum"):
                cls["kind"] = {"enum": fm["kind_enum"]}
            if fm.get("phase_enum"):
                cls["phase"] = {"enum": fm["phase_enum"]}
            classes[key] = cls

        elif typ == "Ontology Relation":
            key = fm.get("key") or fm.get("title")
            if key:
                relations[key] = {"inverse": fm["inverse"]} if fm.get("inverse") else {}

        elif typ == "Season Window":
            key = fm.get("key") or fm.get("title")
            if key:
                entry = {"months": fm.get("months", [])}
                if fm.get("mean_temp_band_c"):
                    entry["mean_temp_band_c"] = fm["mean_temp_band_c"]
                season_phase_inference[key] = entry

        elif typ == "Inference Rule":
            block, key = fm.get("method"), fm.get("key")
            if not block or not key or block not in blocks:
                continue
            cue: dict = {}
            if fm.get("description"):
                cue["description"] = fm["description"]
            if isinstance(fm.get("candidates"), list):
                cue["indicates"] = [
                    {"state": x["state"],
                     **({"confidence": x["confidence"]} if "confidence" in x else {}),
                     **({"reason": x["reason"]} if x.get("reason") else {})}
                    for x in fm["candidates"]
                ]
            if fm.get("age_cycles") is not None:
                cue["age_cycles"] = fm["age_cycles"]
            if fm.get("action"):
                cue["action"] = fm["action"]
            if isinstance(fm.get("causes"), list):
                cue["causes"] = fm["causes"]
            if sec.get("Notes"):
                cue["notes"] = sec["Notes"]
            if fm.get("diagnosis"):
                cue["diagnosis"] = fm["diagnosis"]
            blocks[block][key] = cue

        elif typ == "Threat Species":
            sid = fm.get("key") or fm.get("title")
            if not sid:
                continue
            sp = {"id": sid, "name": fm.get("title", sid),
                  "kind": fm.get("kind", "pest")}
            if fm.get("scientific_name"):
                sp["scientific"] = fm["scientific_name"]
            sp.update(carried(fm, ["vectors", "vectored_by", "severity", "region"]))
            if fm.get("notifiable"):
                sp["notifiable"] = True
            # Present only when the source had notes — never synthesised.
            if sec.get("Notes"):
                sp["notes"] = sec["Notes"]
            threat_species.append(sp)
            # Aliases ride on the species concept; the resolver index is their inverse.
            for a in fm.get("aliases") or []:
                threat_aliases[a] = sid

        elif typ == "Behavior Contract":
            for m in re.finditer(r"^-\s+\*\*`([^`]+)`\*\*\s+—\s+(.*)$",
                                 c["body"], re.MULTILINE):
                undefined_behavior[m.group(1)] = m.group(2).strip()

    threat_species.sort(key=lambda s: s["id"])
    return {
        "name": name, "version": version, "schema_version": schema_version,
        "classes": classes, "relations": relations,
        "season_phase_inference": season_phase_inference,
        **blocks,
        "threat_aliases": threat_aliases,
        "threat_species": threat_species,
        "undefined_behavior": undefined_behavior,
    }


def load_vocab(bundle: str | Path = DEFAULT_BUNDLE) -> dict:
    """Load the vocabulary from an OKF bundle directory."""
    return build_vocab(read_bundle(bundle))


if __name__ == "__main__":  # self-check
    v = load_vocab()
    assert len(v["classes"]) == 20, len(v["classes"])
    assert len(v["relations"]) == 10
    assert len(v["threat_species"]) == 33
    assert len(v["threat_aliases"]) == 22
    assert v["threat_aliases"]["varroa"] == "varroa_destructor"
    assert sum(len(v[b]) for b in
               ("brood_inference", "comb_inference", "queen_inference",
                "varroa_inference", "deadout_inference")) == 47
    assert v["brood_inference"]["spotty_mixed"]["indicates"][0] == {
        "state": "Queenright", "confidence": 0.25, "reason": "failing queen"}
    assert v["comb_inference"]["white_new"]["age_cycles"] == 0
    print(f"OK — {v['name']} {v['version']}: "
          f"{len(v['classes'])} classes, {len(v['relations'])} relations, "
          f"{len(v['threat_species'])} species, 47 inference rules")
