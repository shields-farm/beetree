import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { API_BASE, apiFetch } from './apiBase';

export interface OutlierEntry {
  hiveId: string;
  hiveName: string;
  reason: string;
  severity: 'minor' | 'moderate' | 'significant';
  detail: string;
}

export interface OutlierReport {
  apiaryId: string;
  apiaryName: string;
  outliers: OutlierEntry[];
}

export interface AnomalyItem {
  count: number;
  label: string;
  detail: string; // comma-separated sensor/hive names
  severity: 'high' | 'moderate' | 'low';
}

export interface AnomalySummary {
  total: number;
  items: AnomalyItem[]; // only non-zero items
  allClear: boolean;
}

/**
 * Shared anomaly detection — used by both the Dashboard (compact banner)
 * and the Sensors hub (full summary). Fetches outlier reports from the
 * server and combines them with client-side sensor threshold checks.
 */
export function useAnomalies(): AnomalySummary {
  const { sensors } = useStore();
  const [outlierReports, setOutlierReports] = useState<OutlierReport[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch(API_BASE + '/api/outlier');
        if (resp.ok && !cancelled) setOutlierReports(await resp.json());
      } catch { /* server not running */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    const sensorsWithReadings = sensors.filter((s) => s.latestReading);
    const highTemp = sensorsWithReadings.filter((s) => s.latestReading!.temperature > 99);
    const lowTemp = sensorsWithReadings.filter((s) => s.latestReading!.temperature > 0 && s.latestReading!.temperature < 88);
    const lowBattery = sensorsWithReadings.filter((s) => s.latestReading!.batteryVoltage > 0 && s.latestReading!.batteryVoltage < 2.5);
    const staleSensors = sensorsWithReadings.filter((s) => {
      if (!s.latestReading!.timestamp) return false;
      const hours = (Date.now() - new Date(s.latestReading!.timestamp).getTime()) / (60 * 60 * 1000);
      return hours > 6;
    });

    const allOutliers = outlierReports.flatMap((r) => r.outliers);
    const significantOutliers = allOutliers.filter((o) => o.severity === 'significant');
    const moderateOutliers = allOutliers.filter((o) => o.severity === 'moderate');

    const items: AnomalyItem[] = ([
      { count: highTemp.length, label: 'High temp (>99°F)', detail: highTemp.map((s) => s.name).join(', '), severity: 'high' as const },
      { count: lowTemp.length, label: 'Low temp (<88°F)', detail: lowTemp.map((s) => s.name).join(', '), severity: 'high' as const },
      { count: lowBattery.length, label: 'Low battery (<2.5V)', detail: lowBattery.map((s) => s.name).join(', '), severity: 'moderate' as const },
      { count: staleSensors.length, label: 'Stale (>6h)', detail: staleSensors.map((s) => s.name).join(', '), severity: 'low' as const },
      { count: significantOutliers.length, label: 'Significant outliers', detail: significantOutliers.map((o) => o.hiveName).join(', '), severity: 'high' as const },
      { count: moderateOutliers.length, label: 'Moderate outliers', detail: moderateOutliers.map((o) => o.hiveName).join(', '), severity: 'moderate' as const },
    ] as AnomalyItem[]).filter((s) => s.count > 0);

    const total = items.reduce((sum, s) => sum + s.count, 0);

    return { total, items, allClear: total === 0 };
  }, [sensors, outlierReports]);
}