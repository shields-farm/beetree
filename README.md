# BeeTree

Beekeeping management and hive sensor monitoring. Yard records, inspections, an
ontology-backed knowledge model, sensor telemetry, and an assistant that answers
questions about your own hives.

Named after the B-tree, because we thought that was funny.

## What's in here

| Path | What it is |
| --- | --- |
| `src/` | React frontend (Vite, Tailwind, React Router) |
| `server/` | Express + SQLite API, ontology engine, assistant tools |
| `server/ontology/` | The beekeeping vocabulary: species, relations, seasonal windows |
| `pi/` | Mentra glasses receiver: a Pi-side HTTP webhook for photo capture |
| `ml/` | Colony-strength research pipeline (sensor baseline, acoustics, LLM) |
| `training/` | LoRA fine-tuning and RAG evaluation for the in-app assistant |
| `e2e/` | Playwright end-to-end tests |
| `grafana/` | Sensor dashboards and provisioning |

The custom BLE sensor hardware (firmware, enclosure, BOM) is not part of this
repository.

## Architecture

```mermaid
flowchart LR
    subgraph HIVE [At the hive]
        BS[BeeStick sensor<br/>BLE 5.0 advertising<br/>30B telemetry + 20B acoustic]
        BM[BroodMinder sensors<br/>BLE 0x028D]
    end

    subgraph HUB [BeeTree hub — this repo]
        SCAN[BLE scanner daemon<br/>bleak]
        API[Express + SQLite API<br/>:3001]
        CAD[cadence.ts<br/>sampling scheduler]
        ONT[ontology engine<br/>beetree-vocab.yaml]
        ASSIST[assistant tools<br/>buzz, inference, tasks]
    end

    subgraph CLIENT [Beekeeper]
        UI[React PWA<br/>Vite :5173]
        PH[Phone / Tailscale]
    end

    subgraph RESEARCH [Research pipeline]
        ML[ml/ colony-strength<br/>sensor baseline]
        TR[training/ LoRA + RAG<br/>assistant fine-tune]
    end

    BS -- "advertise" --> SCAN
    BM -- "advertise" --> SCAN
    SCAN -- "decode + write" --> API
    API <--> CAD
    CAD -- "sunrise/sunset" --> WX[Open-Meteo]
    API <--> ONT
    ASSIST <--> ONT
    API <--> UI
    PH -- "Tailscale serve" --> UI
    API -- "labels" --> ML
    API -- "inspection corpus" --> TR
    TR -- "adapter" --> ASSIST
```

## Quick start

```bash
npm install
npm --prefix server install

# Server config (see .env.example)
cp .env.example server/.env

npm run dev            # frontend (Vite)
npm --prefix server run dev   # API
```

The API listens on `:3001` by default and the frontend on `:5173`. On first run
the app shows a setup wizard; a fresh database starts empty by design.

The API generates a random bearer token on boot if `BEETREE_API_KEY` is unset and
prints it to the console. Set it explicitly for anything beyond local dev —
`GET /api/key` will hand it back to a localhost caller, which is convenient for
device pairing and is not a security boundary you should rely on.

## Configuration

Copy `.env.example` to `server/.env`. Everything is optional; see the file for
what each variable does. Nothing in the repo ships a working credential.

## Tests

```bash
npm test               # unit (Vitest)
npm run typecheck
npm run lint
npm run test:e2e       # Playwright
```

Tests that touch the database use an in-memory SQLite instance, so no fixture
data is required.

## Status

Early. The data model, ontology engine, and inspection workflow are in daily use
by one beekeeper. Research code under `ml/` and `training/` is exploratory —
results reported there are not validated across apiaries.

## Credits and data

- UrBAN hive audio and inspection annotations — CC BY 4.0. See `ml/README.md`.
- Beekeeping vocabulary in `server/ontology/beetree-vocab.yaml` draws on published
  extension guidance and standard apiculture terminology.

## License

MIT — see `LICENSE`. Third-party data and dependencies keep their own terms;
notably the UrBAN dataset is CC BY 4.0 and requires attribution.
