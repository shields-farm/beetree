// OpenTelemetry setup for BeeTree API
// Must be imported BEFORE other imports so auto-instrumentation can patch modules.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { metrics, type Meter, type ObservableGauge, type Histogram } from '@opentelemetry/api';

const OTEL_EXPORTER_URL = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

// ---------------------------------------------------------------------------
// SDK setup
// ---------------------------------------------------------------------------
const traceExporter = new OTLPTraceExporter({
  url: `${OTEL_EXPORTER_URL}/v1/traces`,
});

const metricExporter = new OTLPMetricExporter({
  url: `${OTEL_EXPORTER_URL}/v1/metrics`,
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 10_000, // 10 seconds
});

export const sdk = new NodeSDK({
  serviceName: 'beetree-api',
  traceExporter,
  metricReader,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Enable Express, HTTP, fs instrumentation; disable others to keep noise down.
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: true },
      // Disable noisy instrumentation we don't need
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
    }),
  ],
});

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
export const meter: Meter = metrics.getMeter('beetree-api-meter');

export const hiveCountGauge: ObservableGauge = meter.createObservableGauge('beetree.hive_count', {
  description: 'Total number of hives tracked by BeeTree',
});

export const inspectionCountGauge: ObservableGauge = meter.createObservableGauge('beetree.inspection_count', {
  description: 'Total number of inspections recorded',
});

export const sensorTemperatureGauge: ObservableGauge = meter.createObservableGauge('beetree.sensor_temperature', {
  description: 'Latest temperature reading from a sensor (°F)',
  unit: 'F',
});

export const sensorHumidityGauge: ObservableGauge = meter.createObservableGauge('beetree.sensor_humidity', {
  description: 'Latest humidity reading from a sensor (%)',
  unit: '%',
});

export const sensorBatteryGauge: ObservableGauge = meter.createObservableGauge('beetree.sensor_battery', {
  description: 'Latest battery voltage from a sensor (V)',
  unit: 'V',
});

export const apiRequestDurationHistogram: Histogram = meter.createHistogram('beetree.api_request_duration', {
  description: 'Duration of API requests in milliseconds',
  unit: 'ms',
});

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
export function startTelemetry(): void {
  sdk.start();
  console.log('[telemetry] OpenTelemetry SDK started (service: beetree-api)');
}

// Shut down gracefully if needed
export async function stopTelemetry(): Promise<void> {
  try {
    await sdk.shutdown();
    console.log('[telemetry] OpenTelemetry SDK shut down');
  } catch (err) {
    console.error('[telemetry] Error shutting down SDK:', err);
  }
}

// Re-export for convenience
export { metrics };