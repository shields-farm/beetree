import { useState, useEffect } from 'react';
import {
  Cpu, Server, Radio, Thermometer, Activity, Cloud, Database,
  Zap, Wifi, HardDrive, Brain, Mic, ArrowDownRight, CheckCircle2,
  Circle, Satellite, ExternalLink, Gauge, AlertTriangle, Sun, Battery, Shield,
  Moon, Cpu as CpuIcon2,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { Mermaid } from '../components/Mermaid';
import { apiFetch } from '../lib/apiBase';

// ─── Mermaid Diagrams ──────────────────────────────────────────────────────

const ARCH_DIAGRAM = `graph TB
  subgraph Apiary["🐝 Apiary — Back Yard"]
    BM1["BroodMinder TH<br/>47:12:87"]
    BM2["BroodMinder TH-Pro<br/>47:12:C8"]
    BM3["BroodMinder TH-Pro2<br/>47:0B:AF"]
    BM4["3 more sensors<br/>TH / TH-Pro"]
  end

  subgraph Garage["🏠 Garage — Mains Power"]
    PI["Raspberry Pi Zero W<br/>ARMv6 · 512MB<br/>btmon + hcitool"]
  end

  subgraph MacMini["🖥️ Mac Mini — 192.0.2.10"]
    HA["Home Assistant<br/>MQTT + REST API"]
    INFLUX["InfluxDB<br/>Time-series store"]
    OLLAMA["Ollama :11434<br/>LLM Inference"]
    BEETREE["BeeTree Server<br/>Express + SQLite :3001"]
    HERMES["Hermes Agent<br/>Automation + Omi"]
  end

  subgraph Telemetry["📊 Docker Telemetry"]
    OTEL["OTel Collector :4318"]
    PROM["Prometheus :9090"]
    GRAFANA["Grafana :3000"]
  end

  subgraph External["🌐 External Access"]
    FUNNEL["Tailscale Funnel<br/>beetree-host.ts.net"]
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
  end
  subgraph MacMini["Mac Mini"]
    HA2["Home Assistant<br/>MQTT discovery"]
    INFLUX2["InfluxDB<br/>temp · humidity · battery"]
  end
  subgraph App["BeeTree"]
    API["Express API :3001<br/>sensor readings"]
    UI["React Frontend<br/>charts + alerts"]
  end

  BM -.->|"BLE adv"| SCAN
  SCAN --> DECODE
  DECODE --> PUB
  PUB -->|"HTTP POST"| HA2
  HA2 --> INFLUX2
  INFLUX2 --> API
  API --> UI
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

  CHAT --> GLM
  VISION --> KIMI
  VARROA --> KIMI
  ACOUSTIC --> KIMI
  OMI --> GLM
`;

const LORA_DIAGRAM = `graph LR
  subgraph Apiary["🐝 Far Apiary — Battery Powered"]
    BM["6× BroodMinder<br/>TH · TH-Pro · TH-Pro2"]
    RAK["RAK4631 WisBlock<br/>nRF52840 BLE + SX1262 LoRa<br/>Arduino C · 0.01W sleep<br/>4× AA lithium"]
  end
  subgraph House["🖥️ Mac Mini — 192.0.2.10"]
    USB["Waveshare USB LoRa<br/>SX1262 dongle<br/>/dev/cu.usbmodem*"]
    HA["Home Assistant"]
  end

  BM -.->|"BLE 4.1"| RAK
  RAK -.->|"LoRa 915MHz P2P<br/>~200 bytes / 5 min"| USB
  USB -->|"Serial → Python"| HA
`;

// ─── Hardware Page ─────────────────────────────────────────────────────────

export function Hardware() {
  const [health, setHealth] = useState<{ status: string; uptime?: number } | null>(null);

  useEffect(() => {
    apiFetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <PageHeader
        title="Hardware & Infrastructure"
        subtitle="System architecture, devices, and software stack"
      />

      {/* Architecture Overview Diagram */}
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3 flex items-center gap-2">
          <Activity size={16} className="text-honey-600 dark:text-honey-400" />
          System Architecture
        </h3>
        <Mermaid chart={ARCH_DIAGRAM} />
      </Card>

      {/* Hardware Components */}
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
          </div>
        </div>
      </Card>

      {/* Mac Mini */}
      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Server size={16} className="text-honey-600 dark:text-honey-400" />
            Mac Mini — 192.0.2.10
          </h3>
          <StatusBadge status="active" label={health?.status === 'ok' ? 'Healthy' : 'Online'} />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          Primary server — runs all infrastructure services. Accessible externally via Tailscale Funnel.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Spec label="Role" value="Primary server" />
          <Spec label="Network" value="Tailscale tailnet-id" />
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

      {/* LoRa / T-Echo Section */}
      <h2 className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 mt-6">
        LoRa Relay — RAK4631
      </h2>

      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Satellite size={16} className="text-honey-600 dark:text-honey-400" />
            BroodMinder BLE → LoRa → Mac Mini
          </h3>
          <StatusBadge status="planned" label="Planned" />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          A RAK4631 WisBlock at the far apiary scans BroodMinder BLE sensors, sends readings via
          LoRa P2P to a USB dongle on the Mac Mini, which forwards to Home Assistant. No Pi, no solar,
          no Linux — just a modular microcontroller on AA batteries talking to a USB receiver.
          Chosen over the LilyGO T-Echo for better build quality and field-repairable modular design.
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
              <div>• Scans BroodMinder BLE every 5 min (20s scan window)</div>
              <div>• Decodes 21-byte protocol (company ID 0x028D)</div>
              <div>• Packs ~200 bytes, TX via SX1262 LoRa</div>
              <div>• Deep sleeps at 0.01W between scans</div>
              <div>• Modular WisBlock — swap modules if one fails</div>
              <div>• Arduino C (best BLE stack on nRF52840)</div>
              <div>• Runs on 4× AA lithium ≈ 2 weeks</div>
            </div>
          </div>
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Radio size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Mac Mini Receiver (USB)</span>
            </div>
            <div className="space-y-1 text-[11px] text-stone-500 dark:text-stone-400">
              <div>• Waveshare USB LoRa dongle (SX1262, 915MHz)</div>
              <div>• Appears as /dev/cu.usbmodem* — no drivers</div>
              <div>• Python script reads serial, forwards to HA</div>
              <div>• Powered by Mac Mini USB — no battery</div>
              <div>• Same SX1262 chip as T-Echo for compatibility</div>
            </div>
          </div>
        </div>

        {/* Power budget */}
        <div className="mt-3 bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2 flex items-center gap-1.5">
            <Battery size={12} /> Power Budget (Apiary RAK4631)
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Spec label="Active scan" value="0.05W" />
            <Spec label="LoRa TX" value="0.3W" />
            <Spec label="Deep sleep" value="0.01W" />
            <Spec label="Avg (5min cycle)" value="~0.02W" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
            <Spec label="4× AA lithium" value="~18 Wh" />
            <Spec label="Runtime" value="~2 weeks" />
            <Spec label="No solar needed" value="✓" />
          </div>
          <p className="text-[9px] text-stone-400 dark:text-stone-500 mt-2">
            20s active scan / 5min sleep = 6.7% duty cycle. Energizer Ultimate Lithium AA: 4.5Wh/cell × 4 = 18Wh.
            At 0.02W avg, runtime ≈ 18Wh / 0.02W = 900h ≈ 37 days theoretical (real-world ~2 weeks with overhead).
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
              <span><strong className="text-green-700 dark:text-green-300">Telemetry fits easily.</strong> 6 sensors × 21 bytes = 126 bytes per batch. At SF7 (~11,000 bps) that's ~0.1s of airtime every 5 minutes.</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <span><strong className="text-amber-700 dark:text-amber-300">No SSH over LoRa.</strong> LoRa is for sensor data only (66 B/s at SF12, 1,375 B/s at SF7). For remote access to the apiary, use a phone hotspot or cellular.</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <span><strong className="text-amber-700 dark:text-amber-300">Arduino C, not Python.</strong> RAK4631 runs Arduino IDE / PlatformIO (C/C++). No CircuitPython or MicroPython officially. BroodMinder's 21-byte BLE protocol decodes in ~20 lines of C using the nRF52840's native SoftDevice BLE API. More verbose than Python but more reliable BLE stack. Flash via USB — no Linux, no SD card.</span>
            </div>
          </div>
        </div>

        {/* Shopping List */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-3">
            Shopping List
          </h4>
          <div className="space-y-2">
            <ProductLink
              name="RAK4631 LPWAN Node (nRF52840 + SX1262, 915MHz)"
              desc="Core module · BLE + LoRa · Arduino C · modular WisBlock system · RAK Wireless official"
              price="$17.99"
              url="https://store.rakwireless.com/products/rak4631-lpwan-node"
              tag="Apiary node"
            />
            <ProductLink
              name="RAK19007 WisBlock Base Board (2nd Gen)"
              desc="Required base board for RAK4631 · USB-C · battery connector · sensor slots"
              price="$9.99"
              url="https://store.rakwireless.com/products/rak19007-wisblock-base-board-2nd-gen"
              tag="Required"
            />
            <ProductLink
              name="RAK WisBlock Basic Starter Kit (RAK4631 + RAK19007, 915MHz)"
              desc="Bundle: RAK4631 + base board + antenna + USB cable · Amazon listing"
              price="$31.97"
              url="https://www.amazon.com/dp/B0DP74SKM1"
              tag="Amazon bundle"
            />
            <ProductLink
              name="Waveshare USB to LoRa Module (SX1262)"
              desc="USB-A · CDC serial on macOS (/dev/cu.usbmodem*) · Prime · XTAL"
              price="$25.99"
              url="https://www.amazon.com/dp/B0C24735XX"
              tag="Mac Mini receiver · Prime"
            />
            <ProductLink
              name="Energizer Ultimate Lithium AA (8-pack)"
              desc="1.5V lithium · ~4.5Wh/cell · 4 for RAK4631 + 4 spare · Amazon's Choice"
              price="$16.99"
              url="https://www.amazon.com/dp/B00EAKP8S0"
              tag="Prime"
            />
            <ProductLink
              name="4× AA Battery Holder with USB Port (2-pack)"
              desc="4 AA → 6V USB output · on/off switch · powers RAK4631 via USB-C"
              price="$5.99"
              url="https://www.amazon.com/dp/B0DDT2JGKZ"
            />
            <ProductLink
              name="Zulkit IP65 Clear Box w/ Cable Glands"
              desc="5.9 × 3.9 × 2.8 in · hinged clear cover · 2 cable glands · ABS (RF-transparent) · weatherproof"
              price="$9.99"
              url="https://www.amazon.com/dp/B08KY7VK8W"
              tag="Prime"
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Total (RAK store + Prime items)</span>
            <span className="text-lg font-bold text-honey-600 dark:text-honey-400">~$81.94</span>
          </div>
          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-1">
            RAK4631 ($17.99) + RAK19007 ($9.99) + USB LoRa dongle ($25.99) + AA lithium ($16.99) + battery holder ($5.99) + case ($9.99).
            Or buy the Amazon starter kit bundle (B0DP74SKM1, $31.97) to get RAK4631 + base board + antenna in one package.
            ~$40 cheaper than the T-Echo equivalent, and modular — replace individual modules if they fail.
          </p>
        </div>
      </Card>

      {/* Software Stack */}
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

function ProductLink({ name, desc, price, url, tag }: { name: string; desc: string; price: string; url: string; tag?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-stone-700 dark:text-stone-200 group-hover:text-honey-600 dark:group-hover:text-honey-400">
              {name}
            </span>
            {tag && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-honey-100 dark:bg-honey-950 text-honey-700 dark:text-honey-300 shrink-0">
                {tag}
              </span>
            )}
          </div>
          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5 leading-tight">{desc}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">{price}</span>
          <ExternalLink size={12} className="text-stone-300 dark:text-stone-600 group-hover:text-honey-500" />
        </div>
      </div>
    </a>
  );
}