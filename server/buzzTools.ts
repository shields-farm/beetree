// server/buzzTools.ts — Tool definitions for the Buzz agentic chat loop.
// These tools let Buzz call BeeTree's own analysis modules mid-conversation,
// giving it grounded, real-time data instead of relying only on the static
// context blob from the frontend.

import { getInspectionSchedule } from './scheduler.js';
import { calculateSwarmRisk, calculateSwarmRiskAll } from './swarm.js';
import { getAllOutlierReports, getOutlierReport } from './outlier.js';
import { getHealthTrend, getAllHealthTrends } from './trending.js';
import { getTreatmentRecommendation, getAllTreatmentRecommendations } from './treatment.js';
import { getForageForecastWithPreview } from './forage.js';
import { getWeather } from './weather.js';
import { getQueenStatus, getAllQueenStatuses } from './queenTracking.js';
import { db, genId } from './db.js';
import { getWeightTrend, getAllWeightTrends } from './weightTracking.js';
import { getFeedingStatus, getAllFeedingStatuses, recordFeeding } from './feeding.js';
import { syrupTypeForSeason } from './weightTracking.js';

// ────────────────────────────────────────────────────────────────────────────
// Tool schemas (OpenAI function-calling format)
// ────────────────────────────────────────────────────────────────────────────

export const buzzToolSchemas = [
  {
    type: 'function' as const,
    function: {
      name: 'get_hives',
      description: 'Get all hives with their boxes, frames, sensors, health status, and location. Use this to answer questions about specific hives or the overall apiary.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_inspection_schedule',
      description: 'Get the smart inspection schedule for all hives. Returns priority (urgent/soon/routine/low), recommended date, days until due, reasons, and contributing factors. Use when asked "what should I inspect?" or "what needs attention?"',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_swarm_risk',
      description: 'Get swarm risk assessment for all hives (or a specific hive). Returns risk score (0-100), risk level, contributing factors, and recommendations. Use when asked about swarming or queen cells.',
      parameters: {
        type: 'object',
        properties: {
          hiveId: {
            type: 'string',
            description: 'Optional: specific hive entity ID. Omit for all hives.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_outlier_report',
      description: 'Get outlier report showing which hives are falling behind the apiary average. Returns per-hive scores and flagged outliers with severity. Use when asked "which hive is struggling?" or comparing hives.',
      parameters: {
        type: 'object',
        properties: {
          apiaryId: {
            type: 'string',
            description: 'Optional: specific apiary ID. Omit for all apiaries.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_health_trends',
      description: 'Get health trend analysis for all hives (or a specific hive). Returns trend direction (improving/stable/declining), history, and commentary. Use when asked about health trends or progress.',
      parameters: {
        type: 'object',
        properties: {
          hiveId: {
            type: 'string',
            description: 'Optional: specific hive entity ID. Omit for all hives.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_treatment_recs',
      description: 'Get treatment recommendations for all hives (or a specific hive). Returns recommended treatments with timing, temperature range, priority, and notes. Use when asked about varroa treatment, pest control, or disease management.',
      parameters: {
        type: 'object',
        properties: {
          hiveId: {
            type: 'string',
            description: 'Optional: specific hive entity ID. Omit for all hives.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_forage_forecast',
      description: 'Get the forage and nectar flow forecast for the current month (and next month preview). Returns active flows, upcoming flows, management tips, and recommendations. Use when asked about nectar flow, what\'s blooming, or forage.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Get current weather and inspection window analysis for the apiary. Returns current conditions, 48h hourly forecast, 7-day daily forecast, and rated inspection windows. Use when asked about weather, inspection timing, or flight conditions.',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
        },
        required: ['lat', 'lng'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_queen_status',
      description: 'Get queen tracking status for all hives (or a specific hive). Returns current queen info, history, supersedure detection, and days since last seen. Use when asked about queens, marking, or supersedure.',
      parameters: {
        type: 'object',
        properties: {
          hiveId: {
            type: 'string',
            description: 'Optional: specific hive entity ID. Omit for all hives.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_inspections',
      description: 'Get recent inspections for all hives (or a specific hive). Returns inspection records with queen status, brood, temperament, stores, concerns, and notes. Use when asked about inspection history or past findings.',
      parameters: {
        type: 'object',
        properties: {
          hiveId: {
            type: 'string',
            description: 'Optional: specific hive entity ID. Omit for all hives.',
          },
          limit: {
            type: 'number',
            description: 'Max inspections to return per hive (default 5)',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_sensors',
      description: 'Get all BroodMinder sensors with their latest readings (temperature, humidity, battery voltage, signal). Use when asked about sensor data, temps, or battery levels.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_tasks',
      description: 'Get all open tasks. Returns tasks with hive association, due dates, and priorities. Use when asked about tasks or what needs to be done.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_task',
      description: 'Create a new task linked to a hive. Use when Buzz identifies something that needs follow-up (e.g., re-inspect after queen cells found, treatment needed after varroa detected).',
      parameters: {
        type: 'object',
        properties: {
          hiveId: { type: 'string', description: 'Hive entity ID' },
          title: { type: 'string', description: 'Task title' },
          dueDate: { type: 'string', description: 'ISO date string for due date' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Priority level' },
        },
        required: ['hiveId', 'title', 'priority'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_weight_trends',
      description: 'Get hive weight trend analysis for all hives (or a specific hive). Returns current weight, trend (gaining/stable/declining), rate per week, seasonal threshold, and alerts if below minimum. Use when asked about hive weight, stores, or starvation risk.',
      parameters: {
        type: 'object',
        properties: {
          hiveId: { type: 'string', description: 'Optional: specific hive entity ID. Omit for all hives.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_feeding_status',
      description: 'Get feeding status for all hives (or a specific hive). Returns last feeding date, calibrated consumption rate, estimated days until feeder empty, recommended syrup type, refill alerts, and calibration factor. Use when asked about feeding, syrup, or when to refill.',
      parameters: {
        type: 'object',
        properties: {
          hiveId: { type: 'string', description: 'Optional: specific hive entity ID. Omit for all hives.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'record_feeding',
      description: 'Record a feeding event (syrup, fondant, etc.). Includes optional refill calibration: log what was left in the feeder ("empty", "partial" with remaining amount, or "full") to calibrate the consumption model for this hive. Use when Mark says he fed or refilled a feeder.',
      parameters: {
        type: 'object',
        properties: {
          hiveId: { type: 'string', description: 'Hive entity ID' },
          feedType: { type: 'string', enum: ['syrup-1:1', 'syrup-2:1', 'fondant', 'dry-sugar', 'patty', 'pollen-patty'], description: 'Type of feed' },
          amount: { type: 'number', description: 'Amount added in mL (syrup) or grams (solid)' },
          feederType: { type: 'string', enum: ['apimaye-inner-cover', 'entrance', 'mountain-camp', 'top', 'candy-board'], description: 'Type of feeder used' },
          refillState: { type: 'string', enum: ['empty', 'partial', 'full'], description: 'What was in the feeder when refilled: empty, partial (some left), or full (untouched). Used to calibrate consumption estimates.' },
          remainingAmount: { type: 'number', description: 'Amount remaining when refilled (for partial). In mL or grams.' },
          note: { type: 'string', description: 'Optional note' },
        },
        required: ['hiveId', 'feedType', 'amount'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_syrup_recommendation',
      description: 'Get the recommended syrup/feed type for the current season. Returns type, ratio, and reason. Use when asked what to feed or what ratio to use.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Tool dispatch — execute a tool call and return the result as a string
// ────────────────────────────────────────────────────────────────────────────

export async function dispatchBuzzTool(
  toolName: string,
  args: Record<string, any>,
): Promise<string> {
  try {
    switch (toolName) {
      case 'get_hives': {
        const rows = db.prepare('SELECT * FROM hives WHERE superseded_by IS NULL').all();
        return JSON.stringify(rows);
      }

      case 'get_inspection_schedule': {
        const schedule = await getInspectionSchedule();
        return JSON.stringify(schedule);
      }

      case 'get_swarm_risk': {
        if (args.hiveId) {
          const risk = await calculateSwarmRisk(args.hiveId);
          return JSON.stringify(risk);
        }
        const all = await calculateSwarmRiskAll();
        return JSON.stringify(all);
      }

      case 'get_outlier_report': {
        if (args.apiaryId) {
          const report = getOutlierReport(args.apiaryId);
          return JSON.stringify(report);
        }
        const all = getAllOutlierReports();
        return JSON.stringify(all);
      }

      case 'get_health_trends': {
        if (args.hiveId) {
          const trend = getHealthTrend(args.hiveId);
          return JSON.stringify(trend);
        }
        const all = getAllHealthTrends();
        return JSON.stringify(all);
      }

      case 'get_treatment_recs': {
        if (args.hiveId) {
          const recs = getTreatmentRecommendation(args.hiveId);
          return JSON.stringify(recs);
        }
        const all = getAllTreatmentRecommendations();
        return JSON.stringify(all);
      }

      case 'get_forage_forecast': {
        const forecast = getForageForecastWithPreview();
        return JSON.stringify(forecast);
      }

      case 'get_weather': {
        const weather = await getWeather(args.lat, args.lng);
        return JSON.stringify(weather);
      }

      case 'get_queen_status': {
        if (args.hiveId) {
          const status = getQueenStatus(args.hiveId);
          return JSON.stringify(status);
        }
        const all = getAllQueenStatuses();
        return JSON.stringify(all);
      }

      case 'get_inspections': {
        const limit = args.limit ?? 5;
        if (args.hiveId) {
          const rows = db
            .prepare('SELECT * FROM inspections WHERE hiveId = ? AND superseded_by IS NULL ORDER BY date DESC LIMIT ?')
            .all(args.hiveId, limit);
          return JSON.stringify(rows);
        }
        const all = db
          .prepare('SELECT * FROM inspections WHERE superseded_by IS NULL ORDER BY date DESC LIMIT ?')
          .all(limit * 10);
        return JSON.stringify(all);
      }

      case 'get_sensors': {
        const rows = db.prepare('SELECT * FROM sensors WHERE superseded_by IS NULL').all();
        return JSON.stringify(rows);
      }

      case 'get_tasks': {
        const rows = db.prepare('SELECT * FROM tasks WHERE superseded_by IS NULL AND completed = 0').all();
        return JSON.stringify(rows);
      }

      case 'create_task': {
        const { hiveId, title, dueDate, priority } = args;
        if (!hiveId || !title) return JSON.stringify({ error: 'hiveId and title are required' });
        const entityId = genId('task');
        const rowId = genId('task');
        db.prepare(
          'INSERT INTO tasks (id, entity_id, version, superseded_by, superseded_at, hiveId, title, dueDate, priority, completed) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, 0)',
        ).run(rowId, entityId, hiveId, title, dueDate ?? null, priority ?? 'medium');
        return JSON.stringify({ ok: true, taskId: entityId, title, hiveId, dueDate, priority });
      }

      case 'get_weight_trends': {
        if (args.hiveId) {
          return JSON.stringify(getWeightTrend(args.hiveId));
        }
        return JSON.stringify(getAllWeightTrends());
      }

      case 'get_feeding_status': {
        if (args.hiveId) {
          return JSON.stringify(getFeedingStatus(args.hiveId));
        }
        return JSON.stringify(getAllFeedingStatuses());
      }

      case 'record_feeding': {
        const { hiveId, feedType, amount, feederType, refillState, remainingAmount, note } = args;
        if (!hiveId || !feedType || typeof amount !== 'number') {
          return JSON.stringify({ error: 'hiveId, feedType, and amount are required' });
        }
        const event = recordFeeding({
          hiveId, feedType, amount,
          feederType: feederType ?? 'apimaye-inner-cover',
          refillState: refillState ?? null,
          remainingAmount: remainingAmount ?? null,
          note: note ?? '',
        });
        return JSON.stringify({ ok: true, ...event });
      }

      case 'get_syrup_recommendation': {
        return JSON.stringify(syrupTypeForSeason());
      }

      default:
        return JSON.stringify({ error: 'Unknown tool: ' + toolName });
    }
  } catch (e) {
    console.error('[buzzTools] dispatch error for', toolName, ':', e);
    return JSON.stringify({ error: e instanceof Error ? e.message : 'Tool execution failed' });
  }
}