import { useState, useEffect } from 'react';
import {
  Cpu, Server, Radio, Thermometer, Activity, Cloud, Database,
  Zap, Wifi, HardDrive, Brain, Mic, ArrowDownRight, CheckCircle2,
  Circle, Satellite, ExternalLink, Gauge, AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { Mermaid } from '../components/Mermaid';
import { apiFetch } from '../lib/apiBase';

// ─── Mermaid Diagrams ──────────────────────────────────────────────────────

const ARCH_DIAGRAM = `graph TB
  subgraph Apiary["🐝 Apiary — Shields Farm"]
    BM1["BroodMinder TH<br/>47:12:87"]
    BM2["BroodMinder TH-Pro<br/>47:12:C8"]
    BM3["BroodMinder TH-Pro2<br/>47:0B:AF"]
    BM4["3 more sensors<br/>TH / TH-Pro"]
  end

  subgraph Garage["🏠 Garage — Mains Power"]
    PI["Raspberry Pi Zero W<br/>ARMv6 · 512MB<br/>btmon + hcitool"]
  end

  subgraph MacMini["🖥️ Mac Mini — 192.0.2.20"]
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
  subgraph Near["Near Hives — WiFi Range"]
    BM_NEAR["BroodMinder sensors"]
    PI_GARAGE["Pi Zero W<br/>garage · mains power"]
  end
  subgraph Far["Far Hives — Beyond WiFi"]
    BM_FAR["BroodMinder sensors"]
    PI_SOLAR["Pi Zero 2 W<br/>solar · LoRa module"]
  end
  subgraph Gateway["House Gateway"]
    PI_GW["Pi Zero 2 W<br/>LoRa → WiFi relay"]
  end
  subgraph MacMini["Mac Mini"]
    HA_GW["Home Assistant"]
  end

  BM_NEAR -.->|"BLE"| PI_GARAGE
  PI_GARAGE -->|"WiFi"| HA_GW
  BM_FAR -.->|"BLE"| PI_SOLAR
  PI_SOLAR -.->|"LoRa 915MHz<br/>1-2 mi"| PI_GW
  PI_GW -->|"WiFi"| HA_GW
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
            Mac Mini — 192.0.2.20
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

      {/* LoRa Section */}
      <h2 className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 mt-6">
        Connectivity
      </h2>

      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Satellite size={16} className="text-stone-400 dark:text-stone-500" />
            LoRa — Long Range Extension
          </h3>
          <StatusBadge status="planned" label="Planned / Optional" />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          Not currently deployed. LoRa at 915 MHz can extend sensor coverage to hives beyond WiFi range
          (1–2 miles line-of-sight). Architecture: a solar-powered Pi Zero 2 W at the far apiary relays
          BLE → LoRa, and a LoRa USB dongle on the Mac Mini receives LoRa → Home Assistant.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
          <Spec label="Frequency" value="915 MHz" />
          <Spec label="Range" value="1–2 mi LOS" />
          <Spec label="Power" value="Solar + 18650" />
        </div>
        <Mermaid chart={LORA_DIAGRAM} />

        {/* Recommended Hardware */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-3">
            Recommended Hardware
          </h4>

          {/* Pi Zero W HAT */}
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">For Pi Zero W — LoRa HAT</span>
            </div>
            <div className="space-y-2">
              <ProductLink
                name="Waveshare SX1262 LoRa HAT (B) 915MHz"
                desc="SX1262 · 40-pin GPIO pass-through · +22 dBm · IPEX antenna · ~5km range"
                price="$34.55"
                url="https://www.amazon.com/dp/B0822Z3CX8"
                tag="Top pick"
              />
              <ProductLink
                name="Waveshare SX1262 LoRa HAT (868/915)"
                desc="SX1262 · SMA antenna · full pass-through header · configurable pins"
                price="$35.99"
                url="https://www.amazon.com/dp/B07VS1S2P7"
              />
              <ProductLink
                name="RAK2287/RAK5146 Pi HAT"
                desc="SX1302 concentrator · multi-channel gateway · SPI/USB · for LoRaWAN gateway use"
                price="$19.00 (HAT only) + $84.00 module"
                url="https://store.rakwireless.com/products/rak2287-pi-hat"
                tag="Gateway"
              />
            </div>
          </div>

          {/* Mac Mini USB */}
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Radio size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">For Mac Mini — LoRa USB</span>
            </div>
            <div className="space-y-2">
              <ProductLink
                name="Waveshare USB to LoRa Module (SX1262)"
                desc="SX1262 · 850–930MHz · USB-A · CDC serial on macOS (/dev/cu.usbmodem*) · Prime · XTAL"
                price="$25.99"
                url="https://www.amazon.com/dp/B0C24735XX"
                tag="Top pick · Prime"
              />
              <ProductLink
                name="Waveshare USB to LoRa (2-pack)"
                desc="SX1262 · 2× USB dongles for both ends of the link · TCXO crystal"
                price="$48.99"
                url="https://www.amazon.com/dp/B0DTKDXMN2"
              />
              <ProductLink
                name="RAK3172 Evaluation Board"
                desc="STM32WLE5 + SX1262 · USB-CDC serial · AT commands · 915MHz · bare module $6"
                price="$27.00"
                url="https://store.rakwireless.com/collections/wisduo/products/rak3172-evaluation-board"
              />
            </div>
          </div>

          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-3">
            Both ends use SX1262 for chip compatibility. The Waveshare USB dongle appears as a serial
            device on macOS — no drivers needed. Pi HAT uses SPI pins but passes through all unused GPIO.
          </p>
        </div>

        {/* LoRa vs LoRaWAN */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-3 flex items-center gap-1.5">
            <Radio size={12} /> LoRa P2P vs LoRaWAN
          </h4>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
            The recommended SX1262 hardware uses <strong>LoRa P2P</strong> (point-to-point) — two devices
            talk directly with a simple send/receive protocol. This is the right choice for a single
            apiary-to-house relay: simpler, cheaper, lower latency, no gateway infrastructure needed.
          </p>
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-stone-400 dark:text-stone-500 uppercase border-b border-stone-100 dark:border-stone-800">
                  <th className="text-left py-1.5 pr-3"></th>
                  <th className="text-left py-1.5 pr-3">LoRa P2P</th>
                  <th className="text-left py-1.5 pr-3">LoRaWAN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                <tr>
                  <td className="py-1.5 pr-3 text-stone-400 dark:text-stone-500">Chip</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">SX1262 (transceiver)</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">SX1302 (concentrator)</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-400 dark:text-stone-500">Protocol</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">Direct send/receive</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">Join → gateway → network server</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-400 dark:text-stone-500">Channels</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">1</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">8 simultaneous</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-400 dark:text-stone-500">Infrastructure</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">None — just 2 radios</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">Gateway + network server (TTN, Chirpstack)</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-400 dark:text-stone-500">Best for</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">Single relay link (our use case)</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">Many devices, multi-site, TTN/Helium</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-400 dark:text-stone-500">Can do P2P?</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400 font-medium">✓ Yes (native)</td>
                  <td className="py-1.5 pr-3 text-amber-600 dark:text-amber-400 font-medium">✗ No (gateway-only)</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-400 dark:text-stone-500">Can do LoRaWAN?</td>
                  <td className="py-1.5 pr-3 text-amber-600 dark:text-amber-400 font-medium">As node only</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400 font-medium">✓ Yes (gateway)</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-400 dark:text-stone-500">Cost (both ends)</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">~$61 (HAT + USB dongle)</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">~$103+ (RAK2287 HAT + module)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="bg-stone-50 dark:bg-stone-950 rounded-lg p-2.5">
            <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-relaxed">
              <strong className="text-stone-600 dark:text-stone-300">Why P2P here:</strong> One apiary → one Mac Mini.
              No need for LoRaWAN's multi-device gateway infrastructure, join procedures, or network server.
              The SX1302 concentrator can't do P2P — it's optimized for receiving 8 channels simultaneously
              and forwarding raw frames to a packet forwarder. If you later scale to multiple scattered apiaries
              or want to join The Things Network / Helium, add a RAK2287 gateway as a separate device alongside
              the P2P link — it won't replace it.
            </p>
          </div>
        </div>

        {/* LoRa Bandwidth & Limitations */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-3 flex items-center gap-1.5">
            <Gauge size={12} /> Bandwidth &amp; Limitations
          </h4>

          {/* Bandwidth table */}
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-stone-400 dark:text-stone-500 uppercase border-b border-stone-100 dark:border-stone-800">
                  <th className="text-left py-1.5 pr-3">Spreading Factor</th>
                  <th className="text-left py-1.5 pr-3">Bit Rate</th>
                  <th className="text-left py-1.5 pr-3">Latency</th>
                  <th className="text-left py-1.5 pr-3">Range (LOS)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-stone-600 dark:text-stone-300">SF7</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~11,000 bps (1,375 B/s)</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~47ms</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">1–2 km</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-stone-600 dark:text-stone-300">SF9</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~3,000 bps (375 B/s)</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~227ms</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">3–4 km</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-stone-600 dark:text-stone-300">SF12</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~530 bps (66 B/s)</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">1.8 seconds</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">8–15 km</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Telemetry fit assessment */}
          <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-2.5 mb-2.5">
            <div className="flex items-start gap-2 text-xs text-green-700 dark:text-green-300">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Telemetry fits comfortably.</span> 6 sensors × 21 bytes = 126 bytes
                per 20s scan cycle. With framing: ~200–300 bytes. Even at SF12 (66 B/s), that's ~4.5s of airtime
                — well within the cycle.
              </div>
            </div>
          </div>

          {/* SSH warning */}
          <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">No SSH or mosh over LoRa.</span> SSH handshake alone is 2–4 KB
                (3–8s at SF7, 60s+ at SF12). Each keystroke round-trip is 50ms–1.8s. LoRa is a telegraph, not a
                telephone — sensor data only. For remote shell access to a far Pi, use cellular (SIM7600 4G HAT,
                ~$30) or WiFi mesh (Ubiquiti NanoStation, ~$50/pair) if line-of-sight is available.
              </div>
            </div>
          </div>
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