import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Apiary, AppState, Hive, Inspection, Sensor, Task } from '../types';
import { API_BASE, apiFetch } from '../lib/apiBase';

const STORAGE_KEY = 'beetree-state-v2'; // v2 — cleared seed data, server-only

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.apiaries)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return {
    apiaries: [],
    hives: [],
    inspections: [],
    sensors: [],
    tasks: [],
  };
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface StoreContextValue extends AppState {
  // Apiaries
  addApiary: (a: Omit<Apiary, 'id'>) => Apiary;
  updateApiary: (id: string, patch: Partial<Apiary>) => void;
  deleteApiary: (id: string) => void;
  // Hives
  addHive: (h: Omit<Hive, 'id' | 'createdAt'>) => Hive;
  updateHive: (id: string, patch: Partial<Hive>) => void;
  deleteHive: (id: string) => void;
  // Boxes
  addBox: (hiveId: string, boxType: import('../types').BoxType) => void;
  removeBox: (hiveId: string, boxId: string) => void;
  updateFrameContent: (hiveId: string, boxId: string, framePosition: number, content: import('../types').FrameContent) => void;
  cycleFrameContent: (hiveId: string, boxId: string, framePosition: number) => void;
  // Sensors
  addSensor: (s: Omit<Sensor, 'id'>) => Sensor;
  updateSensor: (id: string, patch: Partial<Sensor>) => void;
  deleteSensor: (id: string) => void;
  assignSensor: (sensorId: string, hiveId: string | undefined, boxId: string | undefined, position?: string) => void;
  refreshSensorReadings: () => void;
  // Inspections
  addInspection: (i: Omit<Inspection, 'id'>) => Inspection;
  updateInspection: (id: string, patch: Partial<Inspection>) => void;
  deleteInspection: (id: string) => void;
  // Tasks
  addTask: (t: Omit<Task, 'id'>) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  // Misc
  resetToSeed: () => void;
  clearAll: () => void;
  syncFromServer: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const firstRender = useRef(true);

  // Persist to localStorage on every change (except first render)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
  }, [state]);

  // Sync from Express server on mount — merges server data (SQLite) into local store
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [apiaries, hives, inspections, sensors, tasks] = await Promise.all([
          apiFetch(API_BASE + '/api/apiaries').then((r) => r.ok ? r.json() : []).catch(() => []),
          apiFetch(API_BASE + '/api/hives').then((r) => r.ok ? r.json() : []).catch(() => []),
          apiFetch(API_BASE + '/api/inspections').then((r) => r.ok ? r.json() : []).catch(() => []),
          apiFetch(API_BASE + '/api/sensors').then((r) => r.ok ? r.json() : []).catch(() => []),
          apiFetch(API_BASE + '/api/tasks').then((r) => r.ok ? r.json() : []).catch(() => []),
        ]);
        if (cancelled) return;
        // Replace local state entirely with server data
        setState({ apiaries, hives, inspections, sensors, tasks });
      } catch {
        // Server not running — keep local state
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<StoreContextValue>(() => {
    const update = (fn: (s: AppState) => AppState) => setState((s) => fn(s));

    return {
      ...state,

      addApiary: (a) => {
        const apiary: Apiary = { ...a, id: uid('apiary') };
        update((s) => ({ ...s, apiaries: [...s.apiaries, apiary] }));
        return apiary;
      },
      updateApiary: (id, patch) =>
        update((s) => ({ ...s, apiaries: s.apiaries.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteApiary: (id) =>
        update((s) => ({
          ...s,
          apiaries: s.apiaries.filter((x) => x.id !== id),
          hives: s.hives.filter((h) => h.apiaryId !== id),
        })),

      addHive: (h) => {
        const hive: Hive = { ...h, id: uid('hive'), createdAt: new Date().toISOString() };
        update((s) => ({ ...s, hives: [...s.hives, hive] }));
        return hive;
      },
      updateHive: (id, patch) =>
        update((s) => ({ ...s, hives: s.hives.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteHive: (id) =>
        update((s) => ({
          ...s,
          hives: s.hives.filter((x) => x.id !== id),
          inspections: s.inspections.filter((i) => i.hiveId !== id),
          tasks: s.tasks.map((t) => (t.hiveId === id ? { ...t, hiveId: undefined } : t)),
          sensors: s.sensors.map((sn) => (sn.hiveId === id ? { ...sn, hiveId: undefined, boxId: undefined } : sn)),
        })),

      addBox: (hiveId, boxType) =>
        update((s) => ({
          ...s,
          hives: s.hives.map((h) => {
            if (h.id !== hiveId) return h;
            const def = h.boxes.length;
            return {
              ...h,
              boxes: [
                ...h.boxes,
                {
                  id: uid('box'),
                  type: boxType,
                  frames: Array.from({ length: 10 }, (_, i) => ({ position: i, content: 'empty' as const })),
                  sensorIds: [],
                },
              ].map((b, idx) => (idx === def ? b : b)),
            };
          }),
        })),

      removeBox: (hiveId, boxId) =>
        update((s) => ({
          ...s,
          hives: s.hives.map((h) =>
            h.id === hiveId ? { ...h, boxes: h.boxes.filter((b) => b.id !== boxId) } : h,
          ),
          sensors: s.sensors.map((sn) => (sn.boxId === boxId ? { ...sn, boxId: undefined } : sn)),
        })),

      updateFrameContent: (hiveId, boxId, framePosition, content) =>
        update((s) => ({
          ...s,
          hives: s.hives.map((h) =>
            h.id === hiveId
              ? {
                  ...h,
                  boxes: h.boxes.map((b) =>
                    b.id === boxId
                      ? { ...b, frames: b.frames.map((f) => (f.position === framePosition ? { ...f, content } : f)) }
                      : b,
                  ),
                }
              : h,
          ),
        })),

      cycleFrameContent: (hiveId, boxId, framePosition) =>
        update((s) => {
          const order: import('../types').FrameContent[] = ['empty', 'honey', 'brood', 'pollen', 'feeder', 'queen-excluder', 'foundation'];
          return {
            ...s,
            hives: s.hives.map((h) =>
              h.id === hiveId
                ? {
                    ...h,
                    boxes: h.boxes.map((b) =>
                      b.id === boxId
                        ? {
                            ...b,
                            frames: b.frames.map((f) =>
                              f.position === framePosition
                                ? { ...f, content: order[(order.indexOf(f.content) + 1) % order.length] }
                                : f,
                            ),
                          }
                        : b,
                    ),
                  }
                : h,
            ),
          };
        }),

      addSensor: (sn) => {
        const sensor: Sensor = { ...sn, id: uid('sensor') };
        update((s) => ({ ...s, sensors: [...s.sensors, sensor] }));
        return sensor;
      },
      updateSensor: (id, patch) =>
        update((s) => ({ ...s, sensors: s.sensors.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteSensor: (id) =>
        update((s) => ({
          ...s,
          sensors: s.sensors.filter((x) => x.id !== id),
          hives: s.hives.map((h) => ({
            ...h,
            boxes: h.boxes.map((b) => ({ ...b, sensorIds: b.sensorIds.filter((sid) => sid !== id) })),
            sensorIds: h.sensorIds?.filter((sid) => sid !== id),
          })),
        })),
      assignSensor: (sensorId, hiveId, boxId, position) =>
        update((s) => ({
          ...s,
          sensors: s.sensors.map((sn) => (sn.id === sensorId ? { ...sn, hiveId, boxId, position } : sn)),
          hives: s.hives.map((h) => {
            const ids = new Set(h.sensorIds ?? []);
            // remove this sensor from any box
            let boxes = h.boxes.map((b) => ({ ...b, sensorIds: b.sensorIds.filter((sid) => sid !== sensorId) }));
            if (hiveId && h.id === hiveId) {
              ids.add(sensorId);
              if (boxId) {
                boxes = boxes.map((b) => (b.id === boxId ? { ...b, sensorIds: [...b.sensorIds, sensorId] } : b));
              }
            } else {
              ids.delete(sensorId);
            }
            return { ...h, sensorIds: Array.from(ids), boxes };
          }),
        })),

      refreshSensorReadings: () =>
        // No-op — real sensor readings come from the server via syncFromServer
        update((s) => s),

      addInspection: (i) => {
        const insp: Inspection = { ...i, id: uid('insp') };
        update((s) => ({ ...s, inspections: [...s.inspections, insp] }));
        return insp;
      },
      updateInspection: (id, patch) =>
        update((s) => ({ ...s, inspections: s.inspections.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteInspection: (id) =>
        update((s) => ({ ...s, inspections: s.inspections.filter((x) => x.id !== id) })),

      addTask: (t) => {
        const task: Task = { ...t, id: uid('task') };
        update((s) => ({ ...s, tasks: [...s.tasks, task] }));
        return task;
      },
      updateTask: (id, patch) =>
        update((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      toggleTask: (id) =>
        update((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, completed: !x.completed } : x)) })),
      deleteTask: (id) => update((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id) })),

      resetToSeed: () =>
        update(() => ({
          apiaries: [],
          hives: [],
          inspections: [],
          sensors: [],
          tasks: [],
        })),
      clearAll: () => update(() => ({ apiaries: [], hives: [], inspections: [], sensors: [], tasks: [] })),

      syncFromServer: async () => {
        try {
          const [apiaries, hives, inspections, sensors, tasks] = await Promise.all([
            apiFetch(API_BASE + '/api/apiaries').then((r) => r.ok ? r.json() : []).catch(() => []),
            apiFetch(API_BASE + '/api/hives').then((r) => r.ok ? r.json() : []).catch(() => []),
            apiFetch(API_BASE + '/api/inspections').then((r) => r.ok ? r.json() : []).catch(() => []),
            apiFetch(API_BASE + '/api/sensors').then((r) => r.ok ? r.json() : []).catch(() => []),
            apiFetch(API_BASE + '/api/tasks').then((r) => r.ok ? r.json() : []).catch(() => []),
          ]);
          // Replace local state entirely with server data
          update(() => ({ apiaries, hives, inspections, sensors, tasks }));
        } catch {
          // server not running — keep local state
        }
      },
    };
  }, [state]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

// Convenience selectors
export function useApiary(id?: string) {
  const { apiaries } = useStore();
  return apiaries.find((a) => a.id === id);
}

export function useHive(id?: string) {
  const { hives } = useStore();
  return hives.find((h) => h.id === id);
}