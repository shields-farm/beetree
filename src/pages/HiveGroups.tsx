import { useState, useMemo } from 'react';
import { Plus, Boxes, Trash2, Users } from 'lucide-react';
import { useStore } from '../store/useStore';
import { Card } from '../components/Card';
import { PageHeader } from '../components/Layout';
import { YardLayout } from '../components/YardLayout';
import { HIVE_GROUP_TEMPLATES } from '../lib/hiveGroups';
import type { Hive, HiveGroup } from '../types';

/**
 * Yard groups tab — physical hive groupings in the apiary.
 *
 * The Ellis Special (Jamie Ellis's recommendation at his GBA talk) pairs two
 * production hives with a nuc between them; it can be created as a fresh trio
 * from the template or assembled from hives that already exist in the yard.
 */
export function HiveGroups({ apiaryFilter }: { apiaryFilter?: string }) {
  const { hives, apiaries, hiveGroups, updateHiveGroup, deleteHiveGroup, addHiveGroupFromTemplate, syncFromServer } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [showRegroup, setShowRegroup] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupApiaryId, setGroupApiaryId] = useState(apiaryFilter ?? apiaries[0]?.id ?? '');
  const [regroupSelection, setRegroupSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(
    () => (hiveGroups ?? []).filter((g) => !apiaryFilter || g.apiaryId === apiaryFilter),
    [hiveGroups, apiaryFilter],
  );

  // Hives visible for regrouping: same apiary, and not already in another group.
  const ungroupedHives = useMemo(
    () => hives.filter((h) =>
      (!apiaryFilter || h.apiaryId === (apiaryFilter || h.apiaryId)) &&
      h.apiaryId === (apiaryFilter ?? h.apiaryId) &&
      !h.groupId,
    ),
    [hives, apiaryFilter],
  );

  const handleAddFromTemplate = async () => {
    if (!groupApiaryId || busy) return;
    setBusy(true);
    const created = await addHiveGroupFromTemplate('ellis-special', groupApiaryId, groupName.trim() || undefined);
    setBusy(false);
    if (created) {
      setShowAdd(false);
      setGroupName('');
      // The server created three new hives server-side; re-sync so they appear.
      syncFromServer();
    }
  };

  const handleRegroupSave = (groupId: string) => {
    if (regroupSelection.length < 2) return;
    const group = (hiveGroups ?? []).find((g) => g.id === groupId);
    if (!group) return;
    updateHiveGroup(groupId, { members: regroupSelection });
    setShowRegroup(null);
    setRegroupSelection([]);
    // Membership side-effect (hive.groupId) is server-owned; re-sync.
    syncFromServer();
  };

  const startRegroup = (group: HiveGroup) => {
    setShowRegroup(group.id);
    setRegroupSelection(group.members);
  };

  const toggleRegroupHive = (hiveId: string) => {
    setRegroupSelection((sel) =>
      sel.includes(hiveId) ? sel.filter((id) => id !== hiveId) : [...sel, hiveId],
    );
  };

  const handleDeleteGroup = (group: HiveGroup) => {
    if (!confirm(`Delete group "${group.name}"? The hives stay — only the grouping is removed.`)) return;
    deleteHiveGroup(group.id);
    syncFromServer();
  };

  const groupHives = (group: HiveGroup): Hive[] =>
    group.members
      .map((id) => hives.find((h) => h.id === id))
      .filter((h): h is Hive => Boolean(h));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Groups"
        subtitle={`${groups.length} group${groups.length !== 1 ? 's' : ''}${apiaryFilter ? '' : ' · all apiaries'}`}
        action={
          <button
            onClick={() => { setShowAdd(!showAdd); setShowRegroup(null); }}
            className="w-10 h-10 rounded-full bg-honey-500 text-white flex items-center justify-center shadow-sm hover:bg-honey-600"
            title="Add group"
          >
            <Plus size={22} />
          </button>
        }
      />

      {showAdd && (
        <Card className="mb-4 animate-fade-in">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Boxes size={16} className="text-honey-600 dark:text-honey-400" />
              <p className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider">
                Add Ellis Special
              </p>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {HIVE_GROUP_TEMPLATES['ellis-special'].description}
            </p>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name (optional — defaults to 'Ellis Special')"
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm"
            />
            <select
              value={groupApiaryId}
              onChange={(e) => setGroupApiaryId(e.target.value)}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 px-3.5 py-2.5 text-sm appearance-none"
            >
              {apiaries.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              onClick={handleAddFromTemplate}
              disabled={!groupApiaryId || busy}
              className="w-full py-2.5 rounded-xl bg-honey-500 text-white font-medium text-sm disabled:opacity-40 hover:bg-honey-600"
            >
              {busy ? 'Creating…' : 'Create Group (2 hives + nuc)'}
            </button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {groups.map((group) => {
          const apiary = apiaries.find((a) => a.id === group.apiaryId);
          const members = groupHives(group);
          const isRegrouping = showRegroup === group.id;
          return (
            <Card key={group.id} pad>
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0">
                  <div className="font-semibold text-stone-800 dark:text-stone-100 truncate">
                    {group.name}
                  </div>
                  <div className="text-xs text-stone-400 dark:text-stone-500 truncate flex items-center gap-1.5">
                    {!apiaryFilter && apiary && <span>{apiary.name}</span>}
                    {!apiaryFilter && apiary && <span className="text-stone-300 dark:text-stone-600">·</span>}
                    <span>{members.length} member{members.length !== 1 ? 's' : ''}</span>
                    {group.template === 'ellis-special' && (
                      <span className="text-honey-600 dark:text-honey-400 font-medium">Ellis Special</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startRegroup(group)}
                    className="p-2 rounded-lg text-stone-400 hover:text-honey-600 hover:bg-honey-50 dark:hover:bg-honey-950"
                    title="Regroup hives"
                  >
                    <Users size={15} />
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(group)}
                    className="p-2 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                    title="Delete group (hives remain)"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Visual yard arrangement */}
              <YardLayout group={group} hives={hives} />

              {isRegrouping && (
                <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800 space-y-2">
                  <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide">
                    Tap hives to set the arrangement (left to right)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {/* Current members first (they keep their spot unless deselected), then ungrouped hives in this apiary */}
                    {[...members, ...ungroupedHives.filter((uh) => uh.apiaryId === group.apiaryId)].map((hive) => {
                      const selected = regroupSelection.includes(hive.id);
                      const order = regroupSelection.indexOf(hive.id) + 1;
                      return (
                        <button
                          key={hive.id}
                          onClick={() => toggleRegroupHive(hive.id)}
                          className={
                            'px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ' +
                            (selected
                              ? 'bg-honey-500 text-white'
                              : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700')
                          }
                        >
                          {selected && <span className="text-[10px] opacity-80">{order}</span>}
                          {hive.name}
                        </button>
                      );
                    })}
                    {members.length + ungroupedHives.filter((uh) => uh.apiaryId === group.apiaryId).length === 0 && (
                      <p className="text-xs text-stone-400">No hives available in this apiary.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRegroupSave(group.id)}
                      disabled={regroupSelection.length < 2}
                      className="px-3 py-1.5 rounded-xl bg-honey-500 text-white text-xs font-medium disabled:opacity-40 hover:bg-honey-600"
                    >
                      Save arrangement
                    </button>
                    <button
                      onClick={() => { setShowRegroup(null); setRegroupSelection([]); }}
                      className="px-3 py-1.5 rounded-xl text-xs text-stone-400 hover:text-stone-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}

        {groups.length === 0 && !showAdd && (
          <div className="text-center py-12">
            <p className="text-sm text-stone-400 dark:text-stone-500">
              No groups yet. Tap + to add an Ellis Special, or group existing hives.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-3 text-sm text-honey-600 dark:text-honey-400 font-medium hover:underline"
            >
              Add Ellis Special
            </button>
          </div>
        )}
      </div>
    </div>
  );
}