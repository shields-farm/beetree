# 🌳 BeeTree

**Beekeeping management & sensor monitoring.** Like a B-tree, but for bees.

A mobile-first React web app for tracking apiaries, hives, inspections, and BroodMinder sensor data. Named after the traditional "bee tree" — a hollow tree where wild bees establish a colony — and the B-tree data structure, because every good beekeeper knows their data structures.

## Features

- **Apiary & Hive Management** — Track multiple apiaries with hive types including Langstroth (10/8-frame), Horizontal Long Hive (25 deep frames), 5-frame Nuc, 7-frame Apimaye, and Apimaye Queen Castle
- **Visual Hive Editor** — Stacked box/frame layout with tap-to-cycle frame content (honey, brood, pollen, feeder, queen excluder, foundation)
- **BroodMinder Sensor Integration** — Assign BLE sensors to hives/boxes with position labels; view temperature, humidity, battery voltage, and signal strength
- **Inspection Records** — Full inspection forms with brood status, queen health, temperament, stores, population, weight, concerns, and notes
- **Task Management** — Apiary/hive-linked tasks with due dates and priorities
- **Dashboard** — Overview of apiary health, sensor readings, recent inspections, and tasks due
- **PWA** — Installable on iOS/Android home screen

## Tech Stack

- **Frontend:** Vite + React 18 + TypeScript + Tailwind CSS v3
- **Charts:** Recharts
- **Icons:** Lucide React
- **Routing:** React Router v6
- **Storage:** localStorage (frontend) → SQLite + InfluxDB (backend, planned)
- **Sensor Data:** BroodMinder BLE → Home Assistant → InfluxDB

## Getting Started

```bash
npm install
npm run dev      # Development server at http://localhost:5173
npm run build    # Production build to dist/
npm run preview # Preview production build at http://localhost:4173
```

## Architecture (Target)

```
BeeLog app (React)
  ├── SQLite (Express API)     → apiaries, hives, inspections, tasks
  └── InfluxDB (existing)       → sensor time-series (temp, humidity, battery)
                                   ↓
                                 Grafana dashboards
```

## License

Private — the home apiary