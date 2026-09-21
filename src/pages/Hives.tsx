import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Boxes, Thermometer, ChevronRight, MapPin, Search, ArrowUpDown, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';
import { HIVE_TYPES, makeEmptyFrames } from '../lib/hiveTypes';
import { HEALTH_META } from '../lib/health';
import type { HiveType, HealthStatus } from '../types';

type SortKey = 'name' | 'lastInspected' | 'health';
type HealthFilter = 'all' | HealthStatus;

export function Hives({ apiaryFilter }: { apiaryFilter?: string }) {
  const { hives, apiaries, addHive, inspections, hiveGroups } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [apiaryId, setApiaryId] = useState(apiaryFilter ?? apiaries[0]?.id ?? '');
  const [type, setType] = useState<HiveType>('langstroth-10');

  // Search + filter + sort state
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [typeFilter, setTypeFilter] = useState<HiveType | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Last inspection date per hive
  const lastInspectedMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const h of hives) {
      const hiveInspections = inspections
        .filter((i) => i.hiveId === h.id)
        .sort((a, b) => b.date.localeCompare(a.date));
      map[h.id] = hiveInspections[0]?.date ?? null;
    }
    return map;
  }, [hives, inspections]);

  // Filter by apiary
  const apiaryFiltered = apiaryFilter
    ? hives.filter((h) => h.apiaryId === apiaryFilter)
    : hives;

  // Apply search + filters
  const filteredHives = useMemo(() => {
    let result = apiaryFiltered;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((h) =>
        h.name.toLowerCase().includes(q) ||
        (h.notes ?? '').toLowerCase().includes(q) ||
        HIVE_TYPES[h.type].label.toLowerCase().includes(q)
      );
    }

    if (healthFilter !== 'all') {
      result = result.filter((h) => h.healthStatus === healthFilter);
    }

    if (typeFilter !== 'all') {
      result = result.filter((h) => h.type === typeFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'health') {
        const order: Record<HealthStatus, number> = { critical: 0, poor: 1, fair: 2, good: 3, excellent: 4 };
        return order[a.healthStatus] - order[b.healthStatus];
      }
      if (sortBy === 'lastInspected') {
        const aDate = lastInspectedMap[a.id];
        const bDate = lastInspectedMap[b.id];
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;  // never inspected goes last
        if (!bDate) return -1;
        return aDate.localeCompare(bDate); // oldest first = most overdue
      }
      return 0;
    });

    return result;
  }, [apiaryFiltered, search, healthFilter, typeFilter, sortBy, lastInspectedMap]);

  const handleAdd = () => {
    if (!name.trim() || !apiaryId) return;
    const def = HIVE_TYPES[type];
    const boxes = def.defaultBoxes.map((bt) => ({
      id: `box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: bt,
      frames: makeEmptyFrames(def.frameCountFor(bt)),
      sensorIds: [] as string[],
    }));
    addHive({
      apiaryId,
      name: name.trim(),
      type,
      boxes,
      healthStatus: 'good',
      sensorIds: [],
      notes: '',
    });
    setName('');
    setShowAdd(false);
  };

  const activeFilters = (healthFilter !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0);

  /** The yard group this hive belongs to, if any (for the list badge). */
  function hiveGroupOf(h: { id: string; groupId?: string }) {
    if (!h.groupId) return undefined;
    return (hiveGroups ?? []).find((g) => g.id === h.groupId);
  }

  function daysSinceInspected(dateStr: string | null): number | null {
    if (!dateStr) return null;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000));
  }

  function lastInspectedLabel(hiveId: string): string {
    const dateStr = lastInspectedMap[hiveId];
    const days = daysSinceInspected(dateStr);
    if (days === null) return 'Never';
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Hives"
        subtitle={`${filteredHives.length} hive${filteredHives.length !== 1 ? 's' : ''}${apiaryFilter ? '' : ' · all apiaries'}`}
        action={
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="w-10 h-10 rounded-full bg-honey-500 text-white flex items-center justify-center shadow-sm hover:bg-honey-600"
            title="Add hive"
          >
            <Plus size={22} />
          </button>
        }
      />

      {showAdd && (
        <Card className="mb-4 animate-fade-in">
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hive name"
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm"
            />
            <select
              value={apiaryId}
              onChange={(e) => setApiaryId(e.target.value)}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none"
            >
              {apiaries.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as HiveType)}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none"
            >
              {Object.values(HIVE_TYPES).map((def) => (
                <option key={def.type} value={def.type}>{def.label}</option>
              ))}
            </select>
            <p className="text-xs text-stone-400 dark:text-stone-500">{HIVE_TYPES[type].description}</p>
            <button
              onClick={handleAdd}
              disabled={!name.trim() || !apiaryId}
              className="w-full py-2.5 rounded-xl bg-honey-500 text-white font-medium text-sm disabled:opacity-40 hover:bg-honey-600"
            >
              Add Hive
            </button>
          </div>
        </Card>
      )}

      {/* Search + sort + filter bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hives..."
            className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 pl-9 pr-3 py-2 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-3 py-2 text-sm appearance-none"
          title="Sort by"
        >
          <option value="name">Name A-Z</option>
          <option value="lastInspected">Last Inspected</option>
          <option value="health">Health (worst first)</option>
        </select>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={
            'shrink-0 px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors ' +
            (showFilters || activeFilters > 0
              ? 'bg-honey-50 dark:bg-honey-950 text-honey-600 dark:text-honey-400 border border-honey-200 dark:border-honey-800'
              : 'border border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400')
          }
          title="Filters"
        >
          <ArrowUpDown size={14} />
          {activeFilters > 0 && <span className="text-xs">{activeFilters}</span>}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card className="mb-3 animate-fade-in">
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">Health Status</p>
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'excellent', 'good', 'fair', 'poor', 'critical'] as HealthFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setHealthFilter(s)}
                    className={
                      'px-3 py-1.5 rounded-full text-xs font-medium transition-colors ' +
                      (healthFilter === s
                        ? 'bg-honey-500 text-white'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700')
                    }
                  >
                    {s === 'all' ? 'All' : HEALTH_META[s as HealthStatus].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">Hive Type</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setTypeFilter('all')}
                  className={
                    'px-3 py-1.5 rounded-full text-xs font-medium transition-colors ' +
                    (typeFilter === 'all'
                      ? 'bg-honey-500 text-white'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700')
                  }
                >
                  All Types
                </button>
                {(Object.keys(HIVE_TYPES) as HiveType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={
                      'px-3 py-1.5 rounded-full text-xs font-medium transition-colors ' +
                      (typeFilter === t
                        ? 'bg-honey-500 text-white'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700')
                    }
                  >
                    {HIVE_TYPES[t].label}
                  </button>
                ))}
              </div>
            </div>
            {activeFilters > 0 && (
              <button
                onClick={() => { setHealthFilter('all'); setTypeFilter('all'); }}
                className="text-xs text-stone-400 hover:text-honey-600"
              >
                Clear filters
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Hive list */}
      <div className="space-y-3">
        {filteredHives.map((h) => {
          const apiary = apiaries.find((a) => a.id === h.apiaryId);
          const meta = HEALTH_META[h.healthStatus];
          const hasSensor = h.sensorIds && h.sensorIds.length > 0;
          const daysSince = daysSinceInspected(lastInspectedMap[h.id]);
          const overdue = daysSince !== null && daysSince >= 14;
          return (
            <Card key={h.id} onClick={() => {}} pad={false}>
              <Link to={`/hives/${h.id}`} className="flex items-center gap-3 p-4">
                <div className="w-11 h-11 rounded-xl bg-honey-50 dark:bg-honey-950 text-honey-600 dark:text-honey-400 flex items-center justify-center shrink-0">
                  <Boxes size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-stone-800 dark:text-stone-100 truncate">{h.name}</div>
                  <div className="text-xs text-stone-400 dark:text-stone-500 truncate flex items-center gap-1.5 flex-wrap">
                    {!apiaryFilter && apiary && <span className="truncate">{apiary.name}</span>}
                    {!apiaryFilter && apiary && <span className="text-stone-300 dark:text-stone-600">·</span>}
                    <span>{(HIVE_TYPES[h.type] || HIVE_TYPES['langstroth-10']).label}</span>
                    {hiveGroupOf(h) && (
                      <span className="px-1.5 py-0.5 rounded-full bg-honey-50 dark:bg-honey-950 text-honey-600 dark:text-honey-400 font-medium">
                        {hiveGroupOf(h)?.name}
                      </span>
                    )}
                    {hasSensor && <Thermometer size={11} className="text-sky-500" />}
                    {h.location && <MapPin size={11} className="text-honey-500" />}
                  </div>
                  {/* Last inspected indicator */}
                  <div className={'text-[10px] mt-0.5 ' + (overdue ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-stone-400 dark:text-stone-500')}>
                    Inspected: {lastInspectedLabel(h.id)}
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>{meta.label}</span>
                <ChevronRight size={18} className="text-stone-300 dark:text-stone-600" />
              </Link>
            </Card>
          );
        })}
        {filteredHives.length === 0 && !showAdd && (
          <p className="text-center text-sm text-stone-400 dark:text-stone-500 py-12">
            {search || activeFilters > 0 ? 'No hives match your filters.' : 'No hives yet. Tap + to add one.'}
          </p>
        )}
      </div>
    </div>
  );
}