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
  subgraph Apiary["🐝 Apiary — Shields Farm"]
    BM1["BroodMinder TH<br/>47:12:87"]
    BM2["BroodMinder TH-Pro<br/>47:12:C8"]
    BM3["BroodMinder TH-Pro2<br/>47:0B:AF"]
    BM4["3 more sensors<br/>TH / TH-Pro"]
  end

  subgraph Garage["🏠 Garage — Mains Power"]
    PI["Raspberry Pi Zero W<br/>ARMv6 · 512MB<br/>btmon + hcitool"]
  end

  subgraph MacMini["🖥️ Mac Mini — 192.168.1.40"]
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
            Mac Mini — 192.168.1.40
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

      {/* Solar Power Kit */}
      <h2 className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 mt-6">
        Solar Power Kit
      </h2>

      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <Sun size={16} className="text-honey-600 dark:text-honey-400" />
            Off-Grid Power for Remote Pi
          </h3>
          <StatusBadge status="planned" label="Planned / Optional" />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          For a solar-powered LoRa relay at a far apiary. Pi Zero W + LoRa HAT draws ~1W total.
          A 20W panel + UPS HAT with 18650 batteries provides indefinite off-grid runtime with 2+ days
          of battery reserve for cloudy weather. All components Prime-eligible.
        </p>

        {/* Power budget */}
        <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3 mb-4">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2">
            Power Budget
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Spec label="Pi Zero W idle" value="0.4W" />
            <Spec label="BLE scanning" value="0.6W" />
            <Spec label="LoRa HAT TX" value="0.3W" />
            <Spec label="Total load" value="~1W" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
            <Spec label="Daily usage" value="~12 Wh" />
            <Spec label="20W panel" value="~80 Wh/day*" />
            <Spec label="3× 18650" value="~33 Wh" />
            <Spec label="Reserve" value="~2.7 days" />
          </div>
          <p className="text-[9px] text-stone-400 dark:text-stone-500 mt-2">
            *At 4 hrs full sun equivalent. Georgia avg ~4.5 peak sun hours/day.
          </p>
        </div>

        {/* Solar Panel */}
        <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Sun size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Solar Panel</span>
          </div>
          <div className="space-y-2">
            <ProductLink
              name="FlexSolar 20W USB Solar Panel"
              desc="5V USB-A + USB-C · IP67 waterproof · foldable · 20W headroom for charging + load"
              price="$31.99"
              url="https://www.amazon.com/dp/B0D7BTJJ2D"
              tag="Top pick · Prime"
            />
            <ProductLink
              name="BLAVOR 10W Portable Solar Charger"
              desc="5V/2A USB-A + USB-C · IPX4 · foldable · budget option, adequate for ~1W load"
              price="$26.99"
              url="https://www.amazon.com/dp/B0BJDBQXQ3"
              tag="Prime"
            />
          </div>
        </div>

        {/* Battery / UPS */}
        <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Battery size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Battery / UPS (Pass-Through Charging)</span>
          </div>
          <div className="space-y-2">
            <ProductLink
              name="UPS HAT for Pi Zero (Solar 5V–24V Input)"
              desc="Accepts solar directly · I2C battery monitoring · 5V stable output · uses 18650 cells · pass-through by design"
              price="$27.90"
              url="https://www.amazon.com/dp/B0F8MZM43C"
              tag="Top pick · Prime"
            />
            <ProductLink
              name="Waveshare Solar Power Management Module"
              desc="MPPT charge controller · 6V–24V solar input · USB output to Pi · works with any Pi model"
              price="$13.60"
              url="https://www.amazon.com/dp/B07PBRK8KG"
              tag="Prime"
            />
            <ProductLink
              name="Waveshare Solar Power Mgmt Module (D)"
              desc="MPPT · 6V–24V solar + Type-C input · newer variant with USB-C charging option"
              price="$19.19"
              url="https://www.amazon.com/dp/B0CT83WN6N"
              tag="Prime"
            />
          </div>
          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-2">
            The UPS HAT handles solar input, battery charging, and 5V output to the Pi in one board —
            no separate charge controller needed. Uses standard 18650 cells (not included).
          </p>
        </div>

        {/* Waterproof Case */}
        <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Waterproof Enclosure (RF-Transparent)</span>
          </div>
          <div className="space-y-2">
            <ProductLink
              name="Zulkit IP65 Clear Box w/ Cable Glands"
              desc="5.9 × 3.9 × 2.8 in · hinged clear cover · 2 cable glands · ABS (RF-transparent) · fits Pi Zero + HAT + battery"
              price="$9.99"
              url="https://www.amazon.com/dp/B08KY7VK8W"
              tag="Top pick · Prime"
            />
            <ProductLink
              name="LeMotech IP67 Clear Waterproof Box"
              desc="11.8 × 7.7 × 5.2 in · IP67 (better sealing) · clear hinged cover · cable glands + mounting plate · room for battery"
              price="$39.99"
              url="https://www.amazon.com/dp/B0BP7DZCJG"
              tag="Prime"
            />
            <ProductLink
              name="Sixfab IP65 Pi Enclosure"
              desc="4.9 × 8.3 × 2.3 in · purpose-built for Raspberry Pi · dustproof/water-resistant · IoT-rated"
              price="$75.00"
              url="https://www.amazon.com/dp/B09TRZ5BTB"
              tag="Prime"
            />
          </div>
          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-2">
            All options are ABS plastic — critical for LoRa antenna signal penetration.
            Metal enclosures block RF. Cable glands feed the solar panel cable and antenna through the case wall.
          </p>
        </div>

        {/* Shopping list summary */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Complete Solar Kit Total</span>
            <span className="text-lg font-bold text-honey-600 dark:text-honey-400">~$69.88</span>
          </div>
          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-1">
            FlexSolar 20W ($31.99) + UPS HAT ($27.90) + Zulkit case ($9.99) + 18650 cells (not included).
            Add LoRa HAT ($34.55) for a complete remote relay node: ~$104.43.
          </p>
        </div>
      </Card>

      {/* Low-Power Alternatives */}
      <h2 className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 mt-6">
        Low-Power Alternatives
      </h2>

      <Card className="mb-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 flex items-center gap-2">
            <CpuIcon2 size={16} className="text-honey-600 dark:text-honey-400" />
            Microcontroller vs Pi Zero W
          </h3>
          <StatusBadge status="planned" label="Alternative" />
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          The Pi Zero W is a full Linux computer — great for flexibility, terrible for battery life.
          It draws 0.4W even at idle and can't truly deep sleep. For a solar or battery-powered
          remote relay, a microcontroller with built-in BLE + LoRa can run for weeks on AA batteries.
        </p>

        {/* Sleep comparison */}
        <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3 mb-4">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2 flex items-center gap-1.5">
            <Moon size={12} /> Pi Zero W Sleep: Why It's Bad
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-stone-400 dark:text-stone-500 uppercase border-b border-stone-100 dark:border-stone-800">
                  <th className="text-left py-1.5 pr-3">Method</th>
                  <th className="text-left py-1.5 pr-3">Power</th>
                  <th className="text-left py-1.5 pr-3">Wake Time</th>
                  <th className="text-left py-1.5 pr-3">AA Li Runtime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                <tr>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">Always on (current)</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">0.4W</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">—</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~1.5 days</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">Suspend-to-RAM</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">0.15W</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">10–15s (WiFi/BLE re-init)</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~5 days</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">Shutdown + RTC wake</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">0.01W</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">30–60s (full boot)</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~75 days*</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[9px] text-stone-400 dark:text-stone-500 mt-2">
            *But every boot cycle wears the SD card and takes 30–60s. Suspend keeps RAM powered (0.15W floor).
            The BCM2835 SoC has no deep sleep mode — 0.15W is the hardware floor.
          </p>
        </div>

        {/* Microcontroller comparison */}
        <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3 mb-4">
          <h4 className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase mb-2 flex items-center gap-1.5">
            <CpuIcon2 size={12} /> Microcontroller Alternatives
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-stone-400 dark:text-stone-500 uppercase border-b border-stone-100 dark:border-stone-800">
                  <th className="text-left py-1.5 pr-3">Platform</th>
                  <th className="text-left py-1.5 pr-3">BLE</th>
                  <th className="text-left py-1.5 pr-3">LoRa</th>
                  <th className="text-left py-1.5 pr-3">Python</th>
                  <th className="text-left py-1.5 pr-3">Sleep</th>
                  <th className="text-left py-1.5 pr-3">AA Li</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                <tr className="bg-honey-50/50 dark:bg-honey-950/20">
                  <td className="py-1.5 pr-3 font-medium text-honey-700 dark:text-honey-300">LilyGO T-Echo</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">✓ nRF52840</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">✓ SX1262</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">CircuitPython</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400 font-medium">0.01W</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400 font-medium">~2 weeks</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-medium text-stone-700 dark:text-stone-200">Heltec LoRa 32 V3</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">✓ ESP32-S3</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">✓ SX1262</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">MicroPython</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">0.02W</td>
                  <td className="py-1.5 pr-3 text-stone-500 dark:text-stone-400">~1 week</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-medium text-stone-700 dark:text-stone-200">Seeed XIAO nRF52840</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">✓ nRF52840</td>
                  <td className="py-1.5 pr-3 text-amber-600 dark:text-amber-400">+ RFM95 wing</td>
                  <td className="py-1.5 pr-3 text-stone-600 dark:text-stone-300">CircuitPython</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">0.01W</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">~2 weeks</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-medium text-stone-700 dark:text-stone-200">Pi Zero W + HAT</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">✓ built-in</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">✓ HAT</td>
                  <td className="py-1.5 pr-3 text-green-600 dark:text-green-400">CPython</td>
                  <td className="py-1.5 pr-3 text-red-500 dark:text-red-400">0.15W best</td>
                  <td className="py-1.5 pr-3 text-red-500 dark:text-red-400">~5 days</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-2">
            All run a scan → send → deepsleep loop. No Linux boot, no SD card, no SSH.
            BLE scan starts in milliseconds, not seconds. Runtime estimates use 20s scan / 5min sleep duty cycle.
          </p>
        </div>

        {/* Product links */}
        <div className="space-y-3">
          {/* T-Echo */}
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <CpuIcon2 size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Best: LilyGO T-Echo (all-in-one)</span>
            </div>
            <div className="space-y-2">
              <ProductLink
                name="LilyGO T-Echo (915MHz, nRF52840 + SX1262, BME280)"
                desc="BLE + LoRa + GPS + e-ink display · CircuitPython · 0.01W sleep · built-in battery charging · Amazon's Choice"
                price="$68.00"
                url="https://www.amazon.com/dp/B0B658DZ9Z"
                tag="Top pick"
              />
              <ProductLink
                name="LilyGO T-Echo (915MHz, no BME280)"
                desc="Same board without BME280 temp/humidity sensor · cheaper variant"
                price="$62.00"
                url="https://www.amazon.com/dp/B0B659536P"
              />
              <ProductLink
                name="LilyGO T-Echo (older revision)"
                desc="Original T-Echo · SoftRF lineage · $13 delivery fee · cheapest but slower shipping"
                price="$48.00"
                url="https://www.amazon.com/dp/B097T5TC3P"
              />
            </div>
          </div>

          {/* Heltec */}
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Radio size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Budget: Heltec WiFi LoRa 32 V3</span>
            </div>
            <div className="space-y-2">
              <ProductLink
                name="Heltec LoRa 32 V3 (915MHz, ESP32-S3 + SX1262)"
                desc="BLE + LoRa + OLED display · MicroPython · 0.02W sleep · cheapest option with display"
                price="$22.99"
                url="https://www.amazon.com/dp/B076MSLFC9"
                tag="Budget"
              />
              <ProductLink
                name="Heltec LoRa 32 V3 (2-pack + cases + batteries)"
                desc="2× boards + 1100mAh batteries + protective cases · both ends of the link"
                price="$63.99"
                url="https://www.amazon.com/dp/B0F1CXG94J"
              />
            </div>
          </div>

          {/* XIAO nRF52840 */}
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Modular: Seeed XIAO nRF52840 + LoRa Wing</span>
            </div>
            <div className="space-y-2">
              <ProductLink
                name="Seeed XIAO nRF52840 (CircuitPython, BLE 5.0)"
                desc="Tiny nRF52840 board · CircuitPython · 0.01W sleep · needs separate LoRa module"
                price="$16.99"
                url="https://www.amazon.com/dp/B09T9VVQG7"
              />
              <ProductLink
                name="RFM95W 915MHz LoRa Transceiver Module"
                desc="SX1276 LoRa module · wire to XIAO via SPI · 915MHz · 2-pack available"
                price="$11.64"
                url="https://www.amazon.com/dp/B08BCGR7SK"
              />
            </div>
          </div>

          {/* Batteries */}
          <div className="bg-stone-50 dark:bg-stone-950 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Battery size={14} className="text-honey-600 dark:text-honey-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Batteries (Lithium AA)</span>
            </div>
            <div className="space-y-2">
              <ProductLink
                name="Energizer Ultimate Lithium AA (8-pack)"
                desc="1.5V lithium · ~4.5Wh per cell · 8 cells = ~36Wh · Amazon's Choice"
                price="$16.99"
                url="https://www.amazon.com/dp/B00EAKP8S0"
                tag="Prime"
              />
              <ProductLink
                name="4× AA Battery Holder with USB Port (2-pack)"
                desc="4 AA → 6V USB output · on/off switch · fits T-Echo and Heltec USB input"
                price="$5.99"
                url="https://www.amazon.com/dp/B0DDT2JGKZ"
              />
            </div>
          </div>
        </div>

        {/* Trade-off note */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
          <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Trade-off:</span> Microcontrollers run CircuitPython/MicroPython,
                not full CPython. The <code className="font-mono text-[10px]">bleak</code> scanner library is
                CPython-only, but BroodMinder's 21-byte BLE protocol decodes in ~10 lines of MicroPython using
                <code className="font-mono text-[10px]"> ubluetooth.lescan()</code>. No SSH, no Linux, no SD card —
                just flash a <code className="font-mono text-[10px]">.py</code> file over USB. The Pi Zero W stays
                the best choice for the garage (mains power, full Linux, bleak, HA REST API); microcontrollers
                are better for the solar remote node.
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