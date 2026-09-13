import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Apiary, AppState, Hive, Inspection, Sensor, Task } from '../types';
import { API_BASE, apiFetch } from '../lib/apiBase';

const STORAGE_KEY = 'beetree-state-v3'; // v3 — bust stale localStorage from server crash period

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
  refreshTick: number;  // bumps on every syncFromServer — components can depend on this to re-fetch
  /** True while a syncFromServer call is in flight. */
  syncing: boolean;
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
  setBoxContent: (hiveId: string, boxId: string, content: import('../types').BoxContent) => void;
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
  const [refreshTick, setRefreshTick] = useState(0);
  const [syncing, setSyncing] = useState(false);
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

    /**
     * Apply a box/frame edit and persist the hive's boxes to the server.
     *
     * These edits used to be localStorage-only. syncFromServer() REPLACES local
     * state with server data, so every box add/remove/content change was wiped
     * on the next reload. Boxes have no endpoint of their own; the hive PUT
     * takes the full boxes array and rebuilds boxes + frame_slots from it.
     */
    const updateAndPersistBoxes = (fn: (s: AppState) => AppState, hiveId: string) => {
      update(fn);
      setState((cur) => {
        const hive = cur.hives.find((h) => h.id === hiveId);
        if (hive) {
          apiFetch(API_BASE + '/api/hives/' + hiveId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boxes: hive.boxes }),
          }).catch((e: any) => console.error('[setBoxes] server sync failed:', e));
        }
        return cur;
      });
    };

    return {
      ...state,
      refreshTick,
      syncing,

      addApiary: (a) => {
        const apiary: Apiary = { ...a, id: uid('apiary') };
        update((s) => ({ ...s, apiaries: [...s.apiaries, apiary] }));
        apiFetch(API_BASE + '/api/apiaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiary),
        }).catch((e: any) => console.error('[addApiary] server sync failed:', e));
        return apiary;
      },
      updateApiary: (id, patch) => {
        update((s) => ({ ...s, apiaries: s.apiaries.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
        apiFetch(API_BASE + '/api/apiaries/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch((e: any) => console.error('[updateApiary] server sync failed:', e));
      },
      deleteApiary: (id) => {
        update((s) => ({
          ...s,
          apiaries: s.apiaries.filter((x) => x.id !== id),
          hives: s.hives.filter((h) => h.apiaryId !== id),
        }));
        apiFetch(API_BASE + '/api/apiaries/' + id, { method: 'DELETE' })
          .catch((e: any) => console.error('[deleteApiary] server sync failed:', e));
      },

      addHive: (h) => {
        const hive: Hive = { ...h, id: uid('hive'), createdAt: new Date().toISOString() };
        update((s) => ({ ...s, hives: [...s.hives, hive] }));
        apiFetch(API_BASE + '/api/hives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hive),
        }).catch((e: any) => console.error('[addHive] server sync failed:', e));
        return hive;
      },
      updateHive: (id, patch) => {
        update((s) => ({ ...s, hives: s.hives.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
        apiFetch(API_BASE + '/api/hives/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch((e: any) => console.error('[updateHive] server sync failed:', e));
      },
      deleteHive: (id) => {
        update((s) => ({
          ...s,
          hives: s.hives.filter((x) => x.id !== id),
          inspections: s.inspections.filter((i) => i.hiveId !== id),
          tasks: s.tasks.map((t) => (t.hiveId === id ? { ...t, hiveId: undefined } : t)),
          sensors: s.sensors.map((sn) => (sn.hiveId === id ? { ...sn, hiveId: undefined, boxId: undefined } : sn)),
        }));
        apiFetch(API_BASE + '/api/hives/' + id, { method: 'DELETE' })
          .catch((e: any) => console.error('[deleteHive] server sync failed:', e));
      },

      addBox: (hiveId, boxType) =>
        updateAndPersistBoxes((s) => ({
          ...s,
          hives: s.hives.map((h) => {
            if (h.id !== hiveId) return h;
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
              ],
            };
          }),
        }), hiveId),

      removeBox: (hiveId, boxId) =>
        updateAndPersistBoxes((s) => ({
          ...s,
          hives: s.hives.map((h) =>
            h.id === hiveId ? { ...h, boxes: h.boxes.filter((b) => b.id !== boxId) } : h,
          ),
          sensors: s.sensors.map((sn) => (sn.boxId === boxId ? { ...sn, boxId: undefined } : sn)),
        }), hiveId),

      setBoxContent: (hiveId, boxId, content) =>
        updateAndPersistBoxes((s) => ({
          ...s,
          hives: s.hives.map((h) =>
            h.id === hiveId
              ? { ...h, boxes: h.boxes.map((b) => (b.id === boxId ? { ...b, content } : b)) }
              : h,
          ),
        }), hiveId),

      updateFrameContent: (hiveId, boxId, framePosition, content) =>
        updateAndPersistBoxes((s) => ({
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
        }), hiveId),

      cycleFrameContent: (hiveId, boxId, framePosition) =>
        updateAndPersistBoxes((s) => {
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
        }, hiveId),


      addSensor: (sn) => {
        const sensor: Sensor = { ...sn, id: uid('sensor') };
        update((s) => ({ ...s, sensors: [...s.sensors, sensor] }));
        // Persist to server
        apiFetch(API_BASE + '/api/sensors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...sn, id: sensor.id }),
        }).catch((e) => console.error('[addSensor] server sync failed:', e));
        return sensor;
      },
      updateSensor: (id, patch) => {
        update((s) => ({ ...s, sensors: s.sensors.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
        // Persist to server
        apiFetch(API_BASE + '/api/sensors/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch((e) => console.error('[updateSensor] server sync failed:', e));
      },
      deleteSensor: (id) => {
        update((s) => ({
          ...s,
          sensors: s.sensors.filter((x) => x.id !== id),
          hives: s.hives.map((h) => ({
            ...h,
            boxes: h.boxes.map((b) => ({ ...b, sensorIds: b.sensorIds.filter((sid) => sid !== id) })),
            sensorIds: h.sensorIds?.filter((sid) => sid !== id),
          })),
        }));
        // Persist to server
        apiFetch(API_BASE + '/api/sensors/' + id, {
          method: 'DELETE',
        }).catch((e) => console.error('[deleteSensor] server sync failed:', e));
      },
      assignSensor: (sensorId, hiveId, boxId, position) => {
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
        }));
        // Persist to server
        apiFetch(API_BASE + '/api/sensors/' + sensorId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hiveId, boxId, position }),
        }).catch((e) => console.error('[assignSensor] server sync failed:', e));
      },

      refreshSensorReadings: () =>
        // No-op — real sensor readings come from the server via syncFromServer
        update((s) => s),

      addInspection: (i) => {
        const insp: Inspection = { ...i, id: uid('insp') };
        update((s) => ({ ...s, inspections: [...s.inspections, insp] }));
        // Persist — without this the record vanished on the next syncFromServer,
        // which replaces state with server data.
        apiFetch(API_BASE + '/api/inspections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(insp),
        }).catch((e: any) => console.error('[addInspection] server sync failed:', e));
        return insp;
      },
      updateInspection: (id, patch) => {
        update((s) => ({ ...s, inspections: s.inspections.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
        apiFetch(API_BASE + '/api/inspections/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch((e: any) => console.error('[updateInspection] server sync failed:', e));
      },
      deleteInspection: (id) => {
        update((s) => ({ ...s, inspections: s.inspections.filter((x) => x.id !== id) }));
        apiFetch(API_BASE + '/api/inspections/' + id, { method: 'DELETE' })
          .catch((e: any) => console.error('[deleteInspection] server sync failed:', e));
      },

      addTask: (t) => {
        const task: Task = { ...t, id: uid('task') };
        update((s) => ({ ...s, tasks: [...s.tasks, task] }));
        apiFetch(API_BASE + '/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(task),
        }).catch((e: any) => console.error('[addTask] server sync failed:', e));
        return task;
      },
      updateTask: (id, patch) => {
        update((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
        apiFetch(API_BASE + '/api/tasks/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch((e: any) => console.error('[updateTask] server sync failed:', e));
      },
      toggleTask: (id) => {
        // Read the intended next value from current state, then persist it.
        setState((cur) => {
          const t = cur.tasks.find((x) => x.id === id);
          if (t) {
            apiFetch(API_BASE + '/api/tasks/' + id, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ completed: !t.completed }),
            }).catch((e: any) => console.error('[toggleTask] server sync failed:', e));
          }
          return { ...cur, tasks: cur.tasks.map((x) => (x.id === id ? { ...x, completed: !x.completed } : x)) };
        });
      },
      deleteTask: (id) => {
        update((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id) }));
        apiFetch(API_BASE + '/api/tasks/' + id, { method: 'DELETE' })
          .catch((e: any) => console.error('[deleteTask] server sync failed:', e));
      },

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
        setSyncing(true);
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
          // Bump tick so components like TelemetryTab re-fetch their own data
          setRefreshTick((t) => t + 1);
        } catch {
          // server not running — keep local state
        } finally {
          setSyncing(false);
        }
      },
    };
  }, [state, refreshTick, syncing]);

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