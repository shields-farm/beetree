import type { Hive, Inspection, Sensor, Task } from '../types';

export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'urgent';
  hiveId?: string;
  hiveName?: string;
  title: string;
  message: string;
  category: 'inspection' | 'sensor' | 'task' | 'seasonal' | 'health';
  actionLabel?: string;
  actionRoute?: string;
}

/**
 * Generate proactive "it's time to..." alerts based on:
 * - Last inspection date (overdue inspections)
 * - Sensor temp trends (brood temperature, swarm risk)
 * - Battery voltage (low battery)
 * - Task due dates
 * - Health status changes
 * - Seasonal reminders
 */
export function generateAlerts(
  hives: Hive[],
  inspections: Inspection[],
  sensors: Sensor[],
  tasks: Task[],
): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();

  // 1. Overdue inspections
  for (const hive of hives) {
    const hiveInspections = inspections
      .filter((i) => i.hiveId === hive.id)
      .sort((a, b) => b.date.localeCompare(a.date));

    const lastInspection = hiveInspections[0];
    const daysSince = lastInspection
      ? Math.floor((now - new Date(lastInspection.date).getTime()) / (24 * 60 * 60 * 1000))
      : Infinity;

    if (!lastInspection) {
      alerts.push({
        id: `alert-noinsp-${hive.id}`,
        severity: 'warning',
        hiveId: hive.id,
        hiveName: hive.name,
        title: "It's time to inspect",
        message: `${hive.name} has never been inspected. Time for your first check!`,
        category: 'inspection',
        actionLabel: 'New inspection',
        actionRoute: `/inspections/new?hiveId=${hive.id}`,
      });
    } else if (daysSince >= 21) {
      alerts.push({
        id: `alert-overdue-${hive.id}`,
        severity: 'urgent',
        hiveId: hive.id,
        hiveName: hive.name,
        title: "It's time to inspect",
        message: `${hive.name} was last inspected ${daysSince} days ago — well past the 3-week mark.`,
        category: 'inspection',
        actionLabel: 'Inspect now',
        actionRoute: `/inspections/new?hiveId=${hive.id}`,
      });
    } else if (daysSince >= 14) {
      alerts.push({
        id: `alert-due-${hive.id}`,
        severity: 'warning',
        hiveId: hive.id,
        hiveName: hive.name,
        title: "It's time to inspect",
        message: `${hive.name} was last inspected ${daysSince} days ago. Due for a check.`,
        category: 'inspection',
        actionLabel: 'New inspection',
        actionRoute: `/inspections/new?hiveId=${hive.id}`,
      });
    }
  }

  // 2. Sensor-based alerts
  for (const sensor of sensors) {
    const hive = hives.find((h) => h.id === sensor.hiveId);
    const hiveName = hive?.name ?? sensor.name;

    if (!sensor.latestReading) continue;

    const r = sensor.latestReading;

    // Low battery
    if (r.batteryVoltage > 0 && r.batteryVoltage < 2.5) {
      alerts.push({
        id: `alert-batt-${sensor.id}`,
        severity: r.batteryVoltage < 2.2 ? 'urgent' : 'warning',
        hiveId: sensor.hiveId,
        hiveName,
        title: "It's time to replace batteries",
        message: `${sensor.name} on ${hiveName} battery at ${r.batteryVoltage}V — replace soon.`,
        category: 'sensor',
      });
    }

    // High brood temp (swarm risk indicator)
    if (r.temperature > 99) {
      alerts.push({
        id: `alert-temp-high-${sensor.id}`,
        severity: 'warning',
        hiveId: sensor.hiveId,
        hiveName,
        title: "It's time to check for swarm cells",
        message: `${hiveName} temp at ${r.temperature.toFixed(1)}°F — elevated brood temp may indicate swarm prep.`,
        category: 'sensor',
        actionLabel: 'Inspect',
        actionRoute: sensor.hiveId ? `/inspections/new?hiveId=${sensor.hiveId}` : undefined,
      });
    }

    // Low brood temp (queen may have stopped laying)
    if (r.temperature > 0 && r.temperature < 88) {
      alerts.push({
        id: `alert-temp-low-${sensor.id}`,
        severity: 'info',
        hiveId: sensor.hiveId,
        hiveName,
        title: "It's time to check hive health",
        message: `${hiveName} temp dropped to ${r.temperature.toFixed(1)}°F — brood may be at risk.`,
        category: 'sensor',
      });
    }

    // Sensor not seen recently
    if (r.timestamp) {
      const hoursSinceSeen = (now - new Date(r.timestamp).getTime()) / (60 * 60 * 1000);
      if (hoursSinceSeen > 6) {
        alerts.push({
          id: `alert-missing-${sensor.id}`,
          severity: hoursSinceSeen > 24 ? 'urgent' : 'warning',
          hiveId: sensor.hiveId,
          hiveName,
          title: "It's time to check sensor",
          message: `${sensor.name} on ${hiveName} hasn't reported in ${Math.round(hoursSinceSeen)}h.`,
          category: 'sensor',
        });
      }
    }
  }

  // 3. Task due alerts
  for (const task of tasks) {
    if (task.completed) continue;
    const hive = hives.find((h) => h.id === task.hiveId);
    const hiveName = hive?.name;

    if (task.dueDate) {
      const dueTime = new Date(task.dueDate).getTime();
      const daysOverdue = Math.floor((now - dueTime) / (24 * 60 * 60 * 1000));

      if (daysOverdue >= 1) {
        alerts.push({
          id: `alert-task-overdue-${task.id}`,
          severity: task.priority === 'high' ? 'urgent' : 'warning',
          hiveId: task.hiveId,
          hiveName,
          title: "It's time to do this task",
          message: `"${task.title}"${hiveName ? ` for ${hiveName}` : ''} was due ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} ago.`,
          category: 'task',
          actionLabel: 'View tasks',
          actionRoute: '/tasks',
        });
      } else if (daysOverdue === 0) {
        alerts.push({
          id: `alert-task-today-${task.id}`,
          severity: 'info',
          hiveId: task.hiveId,
          hiveName,
          title: "It's time to do this task",
          message: `"${task.title}"${hiveName ? ` for ${hiveName}` : ''} is due today.`,
          category: 'task',
          actionLabel: 'View tasks',
          actionRoute: '/tasks',
        });
      }
    }
  }

  // 4. Health-based alerts
  for (const hive of hives) {
    if (hive.healthStatus === 'critical') {
      alerts.push({
        id: `alert-health-critical-${hive.id}`,
        severity: 'urgent',
        hiveId: hive.id,
        hiveName: hive.name,
        title: "It's time to intervene",
        message: `${hive.name} is in critical health. Inspect and take action immediately.`,
        category: 'health',
        actionLabel: 'Inspect',
        actionRoute: `/inspections/new?hiveId=${hive.id}`,
      });
    } else if (hive.healthStatus === 'poor') {
      alerts.push({
        id: `alert-health-poor-${hive.id}`,
        severity: 'warning',
        hiveId: hive.id,
        hiveName: hive.name,
        title: "It's time to check",
        message: `${hive.name} health is poor. Consider a closer inspection.`,
        category: 'health',
        actionLabel: 'Inspect',
        actionRoute: `/inspections/new?hiveId=${hive.id}`,
      });
    }
  }

  // 5. Seasonal reminders
  const month = new Date().getMonth(); // 0-indexed
  const seasonalReminders: { month: number; title: string; message: string }[] = [
    { month: 2, title: "It's time to start spring prep", message: 'March: Check winter survival, clean bottom boards, consider pollen patties.' },
    { month: 3, title: "It's time for spring inspections", message: 'April: Full inspections, check brood pattern, consider splits for swarm prevention.' },
    { month: 4, title: "It's time to add supers", message: 'May: Nectar flow starting — add supers as needed, monitor for swarm cells.' },
    { month: 5, title: "It's time to monitor for swarming", message: 'June: Peak swarm season — check every 7-9 days for queen cells.' },
    { month: 6, title: "It's time to extract honey", message: 'July: Main flow — monitor supers, extract when capped, watch for dearth.' },
    { month: 7, title: "It's time to treat for varroa", message: 'August: Test and treat for varroa mites — critical time for winter prep.' },
    { month: 8, title: "It's time to prep for winter", message: 'September: Fall inspections, combine weak hives, feed syrup if needed.' },
    { month: 9, title: "It's time to winterize", message: 'October: Reduce entrances, add mouse guards, wrap hives if in cold climate.' },
    { month: 10, title: "It's time to check winter stores", message: 'November: Ensure hives have enough honey for winter, heft test.' },
    { month: 0, title: "It's time to check winter survival", message: 'January: Quick heft tests, clear dead entrances, don\'t open hives.' },
  ];

  const reminder = seasonalReminders.find((r) => r.month === month);
  if (reminder) {
    alerts.push({
      id: `alert-seasonal-${month}`,
      severity: 'info',
      title: reminder.title,
      message: reminder.message,
      category: 'seasonal',
    });
  }

  // Sort by severity (urgent > warning > info)
  const severityOrder = { urgent: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

export const ALERT_META = {
  urgent: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500', icon: '🔴' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500', icon: '🟡' },
  info: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', dot: 'bg-sky-500', icon: '🔵' },
};