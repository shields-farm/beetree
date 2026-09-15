import { useState, useEffect } from 'react';
import {
  Cpu, Server, Radio, Thermometer, Activity, Cloud,
  Zap, Wifi, HardDrive, Brain, Mic, ArrowDownRight, CheckCircle2,
  Circle, Satellite, Gauge, AlertTriangle, Sun, Glasses, Database,
  CheckSquare, AlertCircle,
  Cpu as CpuIcon2,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { Mermaid } from '../components/Mermaid';
import { apiFetch } from '../lib/apiBase';

// ─── Mermaid Diagrams ──────────────────────────────────────────────────────

const ARCH_DIAGRAM = `graph TB
  subgraph Apiary["Apiary — Shields Farm"]
    BM1["BroodMinder TH<br/>47:12:87"]
    BM2["BroodMinder TH-Pro<br/>47:12:C8"]
    BM3["BroodMinder TH-Pro2<br/>47:0B:AF"]
    BM4["3 more sensors<br/>TH / TH-Pro"]
  end

  subgraph Garage["Garage — Mains Power"]
    PI["Raspberry Pi Zero W<br/>ARMv6 · 512MB<br/>btmon + hcitool"]
  end

  subgraph MacMini["Mac Mini — 192.168.1.40"]
    HA["Home Assistant<br/>MQTT + REST API"]
    INFLUX["InfluxDB<br/>Time-series store"]
    OLLAMA["Ollama :11434<br/>LLM Inference"]
    BEETREE["BeeTree Server<br/>Express + SQLite :3001"]
    HERMES["Hermes Agent<br/>Automation + Omi + Buzz"]
    BUZZ["Buzz Chat API<br/>Hermes profile :8642"]
  end

  subgraph Telemetry["Docker Telemetry"]
    OTEL["OTel Collector :4318"]
    PROM["Prometheus :9090"]
    GRAFANA["Grafana :3000"]
  end

  subgraph External["External Access"]
    FUNNEL["Tailscale Funnel<br/>your-host.ts.net"]
  end

  BM1 -.->|"BLE 4.1"| PI
  BM2 -.->|"BLE"| PI
  BM3 -.->|"BLE"| PI
  BM4 -.->|"BLE"| PI
  PI -->|"WiFi · HA REST API"| HA
  HA --> INFLUX
  HA -->|"sensor data"| BEETREE
  BEETREE -->|"Ollama API"| OLLAMA
  HERMES --> OLLAMA
  BEETREE -->|"Buzz chat"| BUZZ
  BUZZ -->|"agent loop"| HERMES
  BEETREE -->|"OTLP"| OTEL
  OTEL --> PROM
  PROM --> GRAFANA
  FUNNEL -.->|"HTTPS proxy"| BEETREE
  FUNNEL -.->|"HTTPS proxy"| HERMES
`;

const DATA_FLOW_DIAGRAM = `flowchart LR
  subgraph Sensors["BLE Broadcast"]
    BM["6× BroodMinder<br/>TH · TH-Pro · TH-Pro2"]
  end
  subgraph PiZero["Pi Zero W"]
    SCAN["btmon + hcitool<br/>20s capture cycle"]
    DECODE["bm_btmon_decode.py<br/>21-byte parser"]
    PUB["repeater_btmon.py<br/>HA REST publisher"]
    RECV2["mentra_receiver.py<br/>:8790 /upload"]
    SPOOL2[("spool/<br/>store + forward")]
  end
  subgraph MacMini["Mac Mini"]
    HA2["Home Assistant<br/>MQTT discovery"]
    INFLUX2["InfluxDB<br/>temp · humidity · battery"]
    CAP2["/api/mentra/photo<br/>vision + inference"]
  end
  subgraph App["BeeTree"]
    API["Express API :3001<br/>sensor readings"]
    UI["React Frontend<br/>charts + alerts"]
  end
  subgraph Glass["Glasses"]
    ML["Mentra Live<br/>Wi-Fi upload"]
  end

  BM -.->|"BLE adv"| SCAN
  SCAN --> DECODE
  DECODE --> PUB
  PUB -->|"HTTP POST"| HA2
  HA2 --> INFLUX2
  INFLUX2 --> API
  API --> UI

  ML -->|"JPEG over Wi-Fi"| RECV2
  RECV2 --> SPOOL2
  SPOOL2 -->|"HTTPS + Bearer"| CAP2
  CAP2 --> API
`;

const AI_DIAGRAM = `graph TB
  subgraph Features["BeeTree AI Features"]
    CHAT["Buzz Chat<br/>Jamie Ellis persona"]
    VISION["Frame Analysis<br/>brood · queen · pests"]
    VARROA["Varroa Counter<br/>sticky board AI"]
    ACOUSTIC["Acoustic Analysis<br/>hive health audio"]
    OMI["Omi Voice<br/>inspection transcripts"]
  end

  subgraph Ollama["Ollama — localhost:11434"]
    GLM["glm-5.2:cloud<br/>Chat · Buzz"]
    KIMI["kimi-k2.7-code:cloud<br/>Vision · Varroa"]
    NOMIC["nomic-embed-text<br/>274MB embeddings"]
    ORNITH["ornith:9b · 5.6GB<br/>Local fallback"]
  end

  subgraph HermesBox["Hermes Agent — :8642"]
    HERMES2["beetree profile<br/>SOUL.md · memory · fallback"]
  end

  CHAT --> GLM
  VISION --> KIMI
  VARROA --> KIMI
  ACOUSTIC --> KIMI
  OMI --> HERMES2
  HERMES2 --> GLM
`;

const LORA_DIAGRAM = `graph LR
  subgraph Apiary["Far Apiary — Solar Powered"]
    BLE["Any BLE device<br/>in range"]
    RAK["WisMesh Repeater Mini<br/>RAK4631 · SX1262 LoRa<br/>3200mAh LiPo + solar<br/>IP67 · SMA antenna"]
  end
  subgraph House["Mac Mini — 192.168.1.40"]
    USB["RAK4631 + RAK19009<br/>USB LoRa receiver<br/>/dev/cu.usbmodem*"]
    PY["Python decoder<br/>company ID routing"]
    HA["Home Assistant"]
  end

  BLE -.->|"BLE adv"| RAK
  RAK -.->|"LoRa 915MHz P2P<br/>raw BLE packets / 5 min"| USB
  USB -->|"Serial"| PY
  PY -->|"0x028D → BroodMinder"| HA
  PY -.->|"unknown → log"| HA
`;

/**
 * Glasses capture path.
 *
 * The split that matters: the glasses upload the JPEG *directly over Wi-Fi to a
 * webhook*, while *issuing* the capture needs the Mentra Bluetooth SDK. So the
 * receiver half runs on infrastructure we own, and the trigger half must be a
 * phone app. There is no Linux/Python binding for the SDK, which is why the Pi
 * cannot fire the shutter.
 */
const GLASSES_DIAGRAM = `flowchart TB
  subgraph Wear["On the beekeeper"]
    GL["Mentra Live<br/>12MP · 119° FOV · 43g"]
    PH["Phone app<br/>Mentra Bluetooth SDK"]
  end

  subgraph Pi["Pi Zero W — 192.168.1.49"]
    RECV["mentra_receiver.py<br/>:8790 /upload"]
    SPOOL[("spool/<br/>uploads + forwarded")]
    FWD["forward worker<br/>backoff retry"]
  end

  subgraph Mac["Mac Mini"]
    CAP["POST /api/mentra/photo"]
    VIS["vision analysis"]
    INF["ontology inference<br/>differential checks"]
    ONT[("state ledger<br/>≥0.6 only")]
    CAND[("candidate only")]
    MEDIA[("data/media/*.jpg")]
  end

  GL -->|"1 · JPEG over Wi-Fi"| RECV
  PH -.->|"BLE: requestPhoto(webhookUrl)"| GL
  PH -.->|"BT fallback relay"| GL
  RECV -->|"2 · ack 202 immediately"| PH
  RECV --> SPOOL
  SPOOL --> FWD
  FWD -->|"3 · HTTPS + Bearer"| CAP
  CAP --> VIS --> INF
  INF -->|"clears threshold"| ONT
  INF -->|"below threshold"| CAND
  CAP --> MEDIA

  classDef ours fill:#fef3c7,stroke:#f59e0b,color:#78350f
  classDef them fill:#e0e7ff,stroke:#6366f1,color:#312e81
  class RECV,SPOOL,FWD,CAP,VIS,INF,ONT,CAND,MEDIA ours
  class GL,PH them
`;

// ─── Hardware Page ─────────────────────────────────────────────────────────

export function Hardware() {
  const [health, setHealth] = useState<{ status: string; uptime?: number } | null>(null);
  const [tab, setTab] = useState<'overview' | 'hardware' | 'glasses' | 'lora' | 'software'>('overview');
  const [receiver, setReceiver] = useState<{ queued?: number; beetreeReachable?: boolean } | null>(null);

  useEffect(() => {
    apiFetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  // The Pi's receiver exposes /health. It is only reachable once the receiver is
  // actually installed on the Pi, so a failure here is the normal state, not an
  // error worth showing.
  useEffect(() => {
    if (tab !== 'glasses') return;
    let cancelled = false;
    fetch('http://192.168.1.49:8790/health')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setReceiver(d); })
      .catch(() => { if (!cancelled) setReceiver(null); });
    return () => { cancelled = true; };
  }, [tab]);

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <PageHeader
        title="Hardware & Infrastructure"
        subtitle="System architecture, devices, and software stack"
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 p-1 bg-stone-100 dark:bg-stone-900 rounded-xl">
        {([
          ['overview', 'Overview'],
          ['hardware', 'Hardware'],
          ['glasses', 'Glasses'],
          ['lora', 'LoRa Relay'],
          ['software', 'Software & AI'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              tab === key
                ? 'bg-white dark:bg-stone-800 text-honey-700 dark:text-honey-300 shadow-sm'
                : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Architecture Overview Diagram */}
      {tab === 'overview' && (
        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
            <Activity size={16} className="text-honey-600 dark:text-honey-400" />
            System Architecture
          </h3>
          <Mermaid chart={ARCH_DIAGRAM} />
        </Card>
      )}

      {/* Hardware Components */}
      {tab === 'hardware' && (
        <>
        <h2 className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 mt-6">
          Hardware
        </h2>

      {/* Raspberry Pi Zero W */}
      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Cpu size={16} className="text-honey-600 dark:text-honey-400" />
            Raspberry Pi Zero W
          </h3>
          <StatusBadge status="active" label="Active" />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          BroodMinder BLE host — scans beehive sensors and forwards readings to Home Assistant.
          Also receives Mentra Live photo uploads over Wi-Fi (see the Glasses tab), which needs no
          Bluetooth and so does not contend for the radio.
          Installed in garage with mains power.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Spec label="CPU" value="ARMv6 · 1GHz" />
          <Spec label="RAM" value="512MB" />
          <Spec label="OS" value="Pi OS Lite 32-bit" />
          <Spec label="BLE" value="4.1 built-in" />
          <Spec label="Power" value="5V / 2A mains" />
          <Spec label="Network" value="WiFi" />
        </div>
        <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2">Software Stack</h4>
          <div className="space-y-1.5">
            <StackItem icon={Radio} name="btmon + hcitool" desc="Kernel-level BLE capture (bypasses BlueZ/dbus)" />
            <StackItem icon={Brain} name="bm_btmon_decode.py" desc="21-byte BroodMinder protocol parser (company ID 0x028D)" />
            <StackItem icon={Wifi} name="repeater_btmon.py" desc="Publishes to HA REST API — 20s scan cycles" />
            <StackItem icon={Glasses} name="mentra_receiver.py" desc="Glasses photo webhook on :8790 — HTTP only, no Bluetooth" />
          </div>
        </div>
      </Card>

      {/* Mac Mini */}
      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Server size={16} className="text-honey-600 dark:text-honey-400" />
            Mac Mini — 192.168.1.40
          </h3>
          <StatusBadge status="active" label={health?.status === 'ok' ? 'Healthy' : 'Online'} />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          Primary server — runs all infrastructure services. Accessible externally via Tailscale Funnel.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Spec label="Role" value="Primary server" />
          <Spec label="Network" value="Tailscale tailnet" />
          <Spec label="BeeTree" value="Express :3001 (127.0.0.1)" />
          <Spec label="Ollama" value=":11434" />
          <Spec label="HA" value=":8123" />
          <Spec label="Grafana" value=":3000 (Docker)" />
        </div>
        <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2">Services</h4>
          <div className="flex flex-wrap gap-1.5">
            {['Hermes Agent', 'Ollama', 'Home Assistant', 'InfluxDB', 'BeeTree', 'k8s/ArgoCD', 'Grafana', 'Prometheus', 'OTel Collector'].map((svc) => (
              <span key={svc} className="text-[10px] px-2 py-1 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                {svc}
              </span>
            ))}
          </div>
        </div>
      </Card>

      {/* BroodMinder Sensors */}
      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Thermometer size={16} className="text-honey-600 dark:text-honey-400" />
            BroodMinder BLE Sensors
          </h3>
          <StatusBadge status="active" label="6 Active" />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          Passive BLE beacons inside hive bodies — no pairing required. Broadcast 21-byte
          manufacturer-specific advertising data (company ID 0x028D).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-stone-400 dark:text-stone-500 uppercase border-b border-stone-100 dark:border-stone-800">
                <th className="text-left py-2 pr-3">Model</th>
                <th className="text-left py-2 pr-3">Type Code</th>
                <th className="text-left py-2 pr-3">Readings</th>
                <th className="text-left py-2 pr-3">Battery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
              <SensorRow model="BroodMinder TH" code="0x08" readings="Temp · Humidity" battery="CR2032 · 2.0–3.0V" />
              <SensorRow model="BroodMinder TH-Pro" code="0x0a" readings="Temp · Humidity" battery="CR2032 · 2.0–3.0V" />
              <SensorRow model="BroodMinder TH-Pro2" code="0x0f" readings="Temp · Humidity" battery="CR2032 · 2.0–3.0V" />
              <SensorRow model="BroodMinder T2" code="0x0d" readings="Temp (gateway)" battery="CR2032 · 2.0–3.0V" />
            </tbody>
          </table>
        </div>
      </Card>

      {/* Omi Pendant */}
      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Mic size={16} className="text-honey-600 dark:text-honey-400" />
            Omi Pendant
          </h3>
          <StatusBadge status="active" label="Active" />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          Wearable voice recorder for hands-free inspection notes. Transcripts arrive via
          Tailscale Funnel webhook and are parsed into BeeTree inspections.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Spec label="Webhook" value="Funnel → :18789" />
          <Spec label="Endpoint" value="/hooks/omi/" />
          <Spec label="Parser" value="omi.ts → inspection" />
        </div>
      </Card>
      </>
      )}

      {/* Glasses Capture */}
      {tab === 'glasses' && (
        <>
        <h2 className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 mt-4">
          Capture Path
        </h2>

        <Card className="mb-4">
          <Mermaid chart={GLASSES_DIAGRAM} />
          <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-3">
            Amber runs on our own hardware, with no third-party cloud in the path.
          </p>
        </Card>

        <Card className="mb-4">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
              <Glasses size={16} className="text-honey-600 dark:text-honey-400" />
              Mentra Live
            </h3>
            <StatusBadge status="planned" label="Not purchased" />
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
            Camera glasses chosen because the whole stack is open (MentraOS is MIT) and photos
            upload straight to an endpoint you own. No model provider is locked in anywhere in
            this path.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Spec label="Camera" value="12MP · 3264×2448" />
            <Spec label="Field of view" value="119°" />
            <Spec label="Weight" value="43g" />
            <Spec label="Audio" value="Mic + speaker" />
            <Spec label="Upload" value="Wi-Fi → own webhook" />
            <Spec label="SDK" value="Android · iOS · RN" />
          </div>
          <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
            <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2">
              Open question
            </h4>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              <strong className="text-amber-700 dark:text-amber-300">Minimum focus distance is
              unverified.</strong> Every candidate is a fixed-focus point-of-view camera built for
              roughly a metre and beyond. Reading a frame at 15–30&nbsp;cm — which is what
              spotting eggs requires — is the opposite of that. This is the make-or-break test and
              it cannot be settled from a spec sheet.
            </p>
          </div>
        </Card>

        <Card className="mb-4">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
              <Wifi size={16} className="text-honey-600 dark:text-honey-400" />
              Pi Zero W — photo receiver
            </h3>
            <StatusBadge
              status={receiver ? 'active' : 'planned'}
              label={receiver ? 'Receiving' : 'Not installed'}
            />
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
            The glasses push JPEGs over Wi-Fi to a webhook on this Pi, which spools them and
            forwards to BeeTree. It does not talk Bluetooth, so it runs alongside the BroodMinder
            repeater without contending for the single BLE radio.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Spec label="Port" value="8790" />
            <Spec label="Endpoint" value="POST /upload" />
            <Spec label="Delivery" value="Store and forward" />
            <Spec label="Queue now" value={receiver ? String(receiver.queued ?? 0) : '—'} />
            <Spec label="BeeTree" value={receiver ? (receiver.beetreeReachable ? 'Reachable' : 'Unreachable') : '—'} />
            <Spec label="Bluetooth" value="Not used" />
          </div>
          <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800">
            <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2">
              Software Stack
            </h4>
            <div className="space-y-1.5">
              <StackItem icon={Radio} name="mentra_receiver.py" desc="Multipart upload receiver — answers 202 immediately" />
              <StackItem icon={Database} name="spool/" desc="Uploads persist to disk before forwarding, so a hive visit survives a dead network" />
              <StackItem icon={Wifi} name="forward worker" desc="Backoff retry; permanently-rejected uploads are archived so they cannot block the queue" />
            </div>
          </div>
        </Card>

        <Card className="mb-4">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
              <Server size={16} className="text-honey-600 dark:text-honey-400" />
              BeeTree capture loop
            </h3>
            <StatusBadge status="active" label="Built" />
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
            Analyses the frame, runs the ontology's differential rules, and records a colony state
            only when the evidence clears the threshold. A single photo is weak evidence, so
            anything below the bar is kept as a candidate and nothing more.
          </p>
          <div className="space-y-1.5">
            <StackItem icon={Brain} name="POST /api/mentra/photo" desc="Vision analysis → ontology inference → state ledger → spoken reply" />
            <StackItem icon={CheckSquare} name="POST /api/mentra/correct" desc="Beekeeper's verdict over the model's — this is what becomes a training label" />
            <StackItem icon={Database} name="GET /api/mentra/labels" desc="Labelled pairs (ai_top, human_state, agreed) as they accumulate" />
          </div>
        </Card>

        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2 mb-3">
            <AlertCircle size={16} className="text-amber-600 dark:text-amber-400" />
            What is built, and what is not
          </h3>
          <div className="space-y-2 text-xs text-stone-500 dark:text-stone-400">
            <p>
              <strong className="text-green-700 dark:text-green-400">Built and tested:</strong> the
              receiver, the capture loop, the ontology join, and the correction-to-label path.
              Verified end to end with a real photograph travelling Pi&nbsp;→&nbsp;Tailscale&nbsp;→&nbsp;BeeTree
              and coming back a colony state.
            </p>
            <p>
              <strong className="text-amber-700 dark:text-amber-300">Not built:</strong> the phone
              app that triggers a capture. Issuing <code className="text-[11px]">requestPhoto()</code> requires
              the Mentra Bluetooth SDK, which ships for Android, iOS, and React&nbsp;Native only — there
              is no Linux or Python binding, so the Pi cannot fire the shutter. Nothing calls the
              receiver from real glasses yet.
            </p>
            <p>
              <strong className="text-amber-700 dark:text-amber-300">Also missing:</strong> audio
              narration is not wired. The server-side transcript&#8209;to&#8209;inspection parser exists and
              works, but nothing connects the glasses' microphone to it, and nothing speaks the
              reply back through the glasses' speaker.
            </p>
            <p>
              <strong className="text-amber-700 dark:text-amber-300">No session grouping:</strong> each
              capture is currently a standalone observation. Nothing yet binds a run of captures
              into a single inspection record.
            </p>
          </div>
        </Card>
        </>
      )}

      {/* LoRa Relay Section */}
      {tab === 'lora' && (
        <>
        <h2 className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 mt-6">
          LoRa Relay — WisMesh Repeater Mini
        </h2>

      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Satellite size={16} className="text-honey-600 dark:text-honey-400" />
            Generic BLE → LoRa Bridge
          </h3>
          <StatusBadge status="planned" label="Planned" />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          A RAKwireless WisMesh Repeater Mini at the far apiary acts as a dumb BLE-to-LoRa relay — it
          captures all BLE advertisements in range and forwards raw packets via LoRa P2P to a second
          RAK4631 on the Mac Mini. All decoding happens in Python on the Mac Mini, so adding new
          sensor types requires zero firmware changes on the apiary node. The Repeater Mini is a
          complete all-in-one node — RAK4631 core, 3200mAh LiPo battery, integrated solar panel,
          IP67 enclosure, and SMA antenna. All hardware sourced from RAKwireless.
        </p>
        <Mermaid chart={LORA_DIAGRAM} />

        {/* Architecture details */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <CpuIcon2 size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Apiary Node (RAK4631)</span>
            </div>
            <div className="space-y-1 text-[11px] text-stone-500 dark:text-stone-400">
              <div>• WisMesh Repeater Mini (RAK4631 + IP67 enclosure)</div>
              <div>• Passive BLE scan — captures all advertisements</div>
              <div>• No protocol decoding on device — dumb relay</div>
              <div>• Deduplicates by MAC, keeps latest per scan window</div>
              <div>• Packs raw adv data, TX via SX1262 LoRa</div>
              <div>• Deep sleeps at 0.01W between scans</div>
              <div>• 3200mAh LiPo + integrated solar panel</div>
              <div>• Arduino C (~100 lines: scan, dedup, pack, TX, sleep)</div>
            </div>
          </div>
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Radio size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Mac Mini Receiver (USB)</span>
            </div>
            <div className="space-y-1 text-[11px] text-stone-500 dark:text-stone-400">
              <div>• RAK4631 module on RAK19009 mini base board</div>
              <div>• USB-C connected — appears as /dev/cu.usbmodem*</div>
              <div>• Python script: routes by BLE company ID</div>
              <div>• 0x028D → BroodMinder decoder → HA</div>
              <div>• Unknown company IDs → logged for discovery</div>
              <div>• Powered by Mac Mini USB — no battery</div>
              <div>• Same SX1262 chip as apiary node for compatibility</div>
            </div>
          </div>
        </div>

        {/* Power budget */}
        <div className="mt-3 bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2 flex items-center gap-1.5">
            <Sun size={12} /> Power Budget (WisMesh Repeater Mini)
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Spec label="Active scan" value="0.05W" />
            <Spec label="LoRa TX" value="0.3W" />
            <Spec label="Deep sleep" value="0.01W" />
            <Spec label="Avg (5min cycle)" value="~0.02W" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
            <Spec label="LiPo battery" value="3200mAh" />
            <Spec label="Solar panel" value="Integrated" />
            <Spec label="IP rating" value="IP67" />
          </div>
          <p className="text-[9px] text-stone-400 dark:text-stone-500 mt-2">
            20s active scan / 5min sleep = 6.7% duty cycle. 3200mAh at 3.7V = ~11.8Wh.
            At 0.02W avg, battery-only runtime ≈ 24 days. Integrated solar panel trickle-charges
            during daylight, extending runtime indefinitely with intermittent sun.
          </p>
        </div>

        {/* Bandwidth */}
        <div className="mt-3 bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2 flex items-center gap-1.5">
            <Gauge size={12} /> Bandwidth &amp; Limitations
          </h4>
          <div className="space-y-1.5 text-[11px] text-stone-500 dark:text-stone-400">
            <div className="flex items-start gap-2">
              <CheckCircle2 size={12} className="text-green-500 shrink-0 mt-0.5" />
              <span><strong className="text-green-700 dark:text-green-300">Protocol-agnostic relay.</strong> Apiary firmware captures all BLE advertisements and forwards raw data — no sensor-specific decoding. Adding new BLE devices (BroodMinder, RuuviTag, custom probes) requires only a Python decoder on the Mac Mini, zero firmware changes on the apiary node.</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={12} className="text-green-500 shrink-0 mt-0.5" />
              <span><strong className="text-green-700 dark:text-green-300">Fits in one LoRa packet.</strong> Per sensor: 8B header (MAC + RSSI + len) + adv payload. 6 sensors × 29B = 174B — fits single SX1262 packet (255B max). At SF7, ~0.15s airtime per 5-min cycle.</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <span><strong className="text-amber-700 dark:text-amber-300">No SSH over LoRa.</strong> LoRa is for sensor data only (66 B/s at SF12, 1,375 B/s at SF7). For remote access to the apiary, use a phone hotspot or cellular.</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <span><strong className="text-amber-700 dark:text-amber-300">BLE noise filtering.</strong> Passive scan captures everything — passing phones, cars, etc. Python decoder on Mac Mini filters by company ID (0x028D = BroodMinder) and drops unknown devices. Relay sends everything; receiver decides what matters.</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <span><strong className="text-amber-700 dark:text-amber-300">Arduino C, not Python.</strong> RAK4631 runs Arduino IDE / PlatformIO (C/C++). The apiary firmware is ~100 lines (scan, dedup, pack, TX, sleep). All decoding logic lives on the Mac Mini in Python — easy to update without a site visit. Flash via USB-C.</span>
            </div>
          </div>
        </div>

        {/* Component Summary */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-3">
            Components Required — All RAKwireless
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
              <CheckCircle2 size={12} className="text-green-500 shrink-0" />
              <span><strong>WisMesh Repeater Mini</strong> — RAK4631 + 3200mAh LiPo + solar + IP67 enclosure + SMA antenna (RAK10718)</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
              <CheckCircle2 size={12} className="text-green-500 shrink-0" />
              <span><strong>RAK4631 module</strong> — Mac Mini LoRa receiver (nRF52840 + SX1262)</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
              <CheckCircle2 size={12} className="text-green-500 shrink-0" />
              <span><strong>RAK19009 mini base board</strong> — USB-C interface for Mac Mini receiver</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
              <CheckCircle2 size={12} className="text-green-500 shrink-0" />
              <span><strong>USB-C cable</strong> — included with Repeater Mini for flashing firmware</span>
            </div>
          </div>
          <p className="text-[9px] text-stone-400 dark:text-stone-500 mt-2">
            All components sourced directly from RAKwireless store. No third-party cases, batteries, or antennas.
          </p>
        </div>
      </Card>
      </>
      )}

      {/* Software Stack */}
      {tab === 'software' && (
        <>
        <h2 className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 mt-6">
          Software & AI
        </h2>

      {/* AI / LLM Models */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
          <Brain size={16} className="text-honey-600 dark:text-honey-400" />
          AI Models — Ollama
        </h3>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          BeeTree uses Ollama on the Mac Mini for all AI inference. Chat (Buzz) uses glm-5.2:cloud;
          vision tasks use kimi-k2.7-code:cloud. A local ornith:9b model provides offline fallback.
        </p>
        <Mermaid chart={AI_DIAGRAM} />
        <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800 space-y-1.5">
          <ModelRow name="glm-5.2:cloud" role="Chat — Buzz the beekeeper AI" size="Cloud" active />
          <ModelRow name="kimi-k2.7-code:cloud" role="Vision — frame analysis, varroa, acoustics" size="Cloud" active />
          <ModelRow name="nomic-embed-text" role="Text embeddings" size="274 MB" />
          <ModelRow name="ornith:9b" role="Local inference fallback" size="5.6 GB" />
        </div>
      </Card>

      {/* BeeTree Stack */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
          <HardDrive size={16} className="text-honey-600 dark:text-honey-400" />
          BeeTree Application Stack
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2">Frontend</h4>
            <div className="space-y-1">
              <TechItem name="React 19" />
              <TechItem name="Vite 8" />
              <TechItem name="TypeScript 6" />
              <TechItem name="Tailwind CSS 3" />
              <TechItem name="React Router 7" />
              <TechItem name="lucide-react" />
            </div>
          </div>
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2">Backend</h4>
            <div className="space-y-1">
              <TechItem name="Express 4" />
              <TechItem name="better-sqlite3" />
              <TechItem name="tsx (no build)" />
              <TechItem name="OpenTelemetry" />
              <TechItem name="Bearer auth" />
            </div>
          </div>
        </div>
      </Card>

      {/* Telemetry Stack */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
          <Cloud size={16} className="text-honey-600 dark:text-honey-400" />
          Telemetry & Observability
        </h3>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          Docker Compose stack — BeeTree server emits OTLP metrics to the collector, Prometheus scrapes
          and stores them, Grafana visualizes sensor health with auto-provisioned dashboards.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Spec label="Collector" value="OTel :4318" />
          <Spec label="Metrics" value="Prometheus :9090" />
          <Spec label="Dashboard" value="Grafana :3000" />
        </div>
      </Card>

      {/* Data Flow Diagram */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
          <ArrowDownRight size={16} className="text-honey-600 dark:text-honey-400" />
          Sensor Data Flow
        </h3>
        <Mermaid chart={DATA_FLOW_DIAGRAM} />
      </Card>

      {/* Security */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
          <Zap size={16} className="text-honey-600 dark:text-honey-400" />
          Security & Access
        </h3>
        <div className="space-y-2 text-xs text-stone-500 dark:text-stone-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            BeeTree server bound to 127.0.0.1 — no direct LAN exposure
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            Bearer token auth on all API endpoints (timing-safe comparison)
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            Tailscale Funnel proxies external HTTPS — no open ports
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            Self-signed HTTPS certs for local dev (Vite SSL plugin)
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            SSH key (ed25519) for Pi Zero W — hermes@macmini
          </div>
        </div>
      </Card>
      </>
      )}
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────────────────────

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-stone-50 dark:bg-stone-950 rounded-xl px-3 py-2">
      <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">{value}</div>
      <div className="text-[10px] text-stone-400 dark:text-stone-500">{label}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: 'active' | 'planned' | 'offline'; label: string }) {
  const styles = {
    active: 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300',
    planned: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
    offline: 'bg-stone-100 dark:bg-stone-800 text-stone-500',
  };
  const Icon = status === 'active' ? CheckCircle2 : status === 'planned' ? Circle : Circle;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg ${styles[status]}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

function StackItem({ icon: Icon, name, desc }: { icon: typeof Radio; name: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} className="text-stone-400 dark:text-stone-500 mt-0.5 shrink-0" />
      <div>
        <span className="text-xs font-medium text-stone-700 dark:text-stone-200">{name}</span>
        <span className="text-[10px] text-stone-400 dark:text-stone-500 ml-1.5">{desc}</span>
      </div>
    </div>
  );
}

function SensorRow({ model, code, readings, battery }: { model: string; code: string; readings: string; battery: string }) {
  return (
    <tr>
      <td className="py-2 pr-3 font-medium text-stone-700 dark:text-stone-200">{model}</td>
      <td className="py-2 pr-3 font-mono text-[10px] text-stone-400 dark:text-stone-500">{code}</td>
      <td className="py-2 pr-3 text-stone-500 dark:text-stone-400">{readings}</td>
      <td className="py-2 pr-3 text-stone-500 dark:text-stone-400">{battery}</td>
    </tr>
  );
}

function ModelRow({ name, role, size, active }: { name: string; role: string; size: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-green-500' : 'bg-stone-300 dark:bg-stone-700'}`} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-mono font-medium text-stone-700 dark:text-stone-200">{name}</span>
        <span className="text-[10px] text-stone-400 dark:text-stone-500 ml-2">{role}</span>
      </div>
      <span className="text-[10px] text-stone-400 dark:text-stone-500 shrink-0">{size}</span>
    </div>
  );
}

function TechItem({ name }: { name: string }) {
  return (
    <div className="text-xs text-stone-600 dark:text-stone-300 flex items-center gap-1.5">
      <div className="w-1 h-1 rounded-full bg-honey-400" />
      {name}
    </div>
  );
}

// (ProductLink component removed — BeeTree pages don't show product links per project convention)