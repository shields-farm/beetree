import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Thermometer } from 'lucide-react';
import { BOX_TYPE_LABELS, HIVE_TYPES, BOX_CONTENT_META, BOX_CONTENT_ORDER } from '../lib/hiveTypes';
import type { Box, BoxContent, BoxType, Hive } from '../types';
import { SensorPicker } from './SensorPicker';
import { useStore } from '../store/useStore';

interface HiveVisualProps {
  hive: Hive;
  editable?: boolean;
  showSensors?: boolean;
}

export function HiveVisual({ hive, editable = false, showSensors = true }: HiveVisualProps) {
  const { addBox, removeBox, setBoxContent, sensors } = useStore();
  const def = HIVE_TYPES[hive.type] || HIVE_TYPES['langstroth-10'];
  const [expandedBox, setExpandedBox] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {/* Hive stack: render bottom-to-top visually (index 0 = bottom) */}
      <div className="flex flex-col-reverse gap-2">
        {hive.boxes.map((box, idx) => (
          <BoxDiagram
            key={box.id}
            box={box}
            boxIndex={idx}
            hive={hive}
            editable={editable}
            expanded={expandedBox === box.id}
            onToggleExpand={() => setExpandedBox(expandedBox === box.id ? null : box.id)}
            onSetContent={(c) => setBoxContent(hive.id, box.id, c)}
            onRemoveBox={() => removeBox(hive.id, box.id)}
            sensors={sensors}
            showSensors={showSensors}
          />
        ))}
      </div>

      {editable && !def.singleBox && (
        <button
          type="button"
          onClick={() => addBox(hive.id, def.allowedBoxTypes[0])}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-stone-300 dark:border-stone-700 text-stone-500 dark:text-stone-400 text-sm font-medium hover:border-honey-400 hover:text-honey-600 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus size={18} /> Add Box / Super
        </button>
      )}
    </div>
  );
}

function BoxDiagram({
  box,
  boxIndex,
  hive,
  editable,
  expanded,
  onToggleExpand,
  onSetContent,
  onRemoveBox,
  sensors,
  showSensors,
}: {
  box: Box;
  boxIndex: number;
  hive: Hive;
  editable: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSetContent: (c: BoxContent) => void;
  onRemoveBox: () => void;
  sensors: import('../types').Sensor[];
  showSensors: boolean;
}) {
  const def = HIVE_TYPES[hive.type] || HIVE_TYPES['langstroth-10'];
  const frameCount = def.frameCountFor(box.type);
  const isApimaye = box.type === 'apimaye' || box.type === 'apimaye-split';
  const boxSensors = sensors.filter((s) => s.boxId === box.id);
  const contentMeta = box.content ? BOX_CONTENT_META[box.content] : null;

  // Wood color tones by box type
  const boxColors: Record<BoxType, { bg: string; border: string; label: string }> = {
    deep: { bg: 'bg-amber-900/10', border: 'border-amber-900/30', label: 'Deep' },
    medium: { bg: 'bg-amber-800/10', border: 'border-amber-800/30', label: 'Medium' },
    shallow: { bg: 'bg-amber-700/10', border: 'border-amber-700/30', label: 'Shallow' },
    nuc: { bg: 'bg-stone-300/40', border: 'border-stone-400/40', label: 'Nuc' },
    apimaye: { bg: 'bg-orange-100 dark:bg-orange-900', border: 'border-orange-300', label: 'Apimaye Deep' },
    'apimaye-split': { bg: 'bg-orange-50 dark:bg-orange-950', border: 'border-orange-200', label: 'Apimaye Split' },
    'queen-castle-comp': { bg: 'bg-stone-200 dark:bg-stone-700', border: 'border-stone-400', label: 'Queen Castle' },
  };
  const colors = boxColors[box.type] || boxColors.deep;

  return (
    <div className={`rounded-xl border-2 ${colors.bg} ${colors.border} overflow-hidden`}>
      {/* Box header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-stone-900/5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">#{boxIndex + 1}</span>
          <span className="text-xs font-medium text-stone-700 dark:text-stone-200 truncate">{BOX_TYPE_LABELS[box.type]}</span>
          <span className="text-[10px] text-stone-400 dark:text-stone-500">· {frameCount} frames</span>
          {isApimaye && (
            <span className="text-[10px] bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200 px-1.5 py-0.5 rounded-full">
              Insulated
            </span>
          )}
          {boxSensors.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-full">
              <Thermometer size={10} /> {boxSensors.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {editable && !def.singleBox && hive.boxes.length > 1 && (
            <button type="button" onClick={onRemoveBox} className="p-1 text-stone-400 dark:text-stone-500 hover:text-red-500 transition-colors" title="Remove box">
              <Trash2 size={14} />
            </button>
          )}
          {editable && (
            <button type="button" onClick={onToggleExpand} className="p-1 text-stone-400 dark:text-stone-500 hover:text-stone-700">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Physical box diagram */}
      <div className="p-2.5 bg-white/60 dark:bg-stone-900/60">
        {/* Content classification badge */}
        {contentMeta && !editable && (
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: contentMeta.color, color: contentMeta.textColor }}>
              {contentMeta.icon} {contentMeta.label}
            </span>
          </div>
        )}

        {/* Box body — physical representation */}
        <div className={`relative rounded-lg border-2 ${colors.border} ${colors.bg} p-2`} style={{ minHeight: '60px' }}>
          {/* Frame slots — visual representation */}
          <div className="flex gap-0.5 justify-center">
            {Array.from({ length: frameCount }, (_, i) => {
              // Color frames based on box content classification
              const frameColor = contentMeta ? contentMeta.color : '#e7e5e4';
              const frameLabel = contentMeta ? contentMeta.icon : '';
              return (
                <div
                  key={i}
                  className="rounded-sm flex items-center justify-center text-[8px] transition-all"
                  style={{
                    width: `${100 / frameCount}%`,
                    maxWidth: '28px',
                    minWidth: '12px',
                    height: '48px',
                    background: frameColor,
                    color: contentMeta?.textColor || '#44403c',
                    border: '1px solid rgba(0,0,0,0.1)',
                  }}
                  title={`Frame ${i + 1}`}
                >
                  {frameLabel}
                </div>
              );
            })}
          </div>
          {/* Apimaye divider line if split */}
          {box.type === 'apimaye-split' && (
            <div className="absolute top-2 bottom-2 left-1/2 w-0.5 bg-orange-300 dark:bg-orange-700" />
          )}
        </div>

        {/* Content classification picker (when editable) */}
        {editable && (
          <div className="mt-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">Majority content:</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(BOX_CONTENT_ORDER as readonly string[]).map((c) => {
                const meta = BOX_CONTENT_META[c];
                const active = box.content === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onSetContent(c as BoxContent)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                      active ? 'ring-2 ring-honey-500 scale-105' : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ background: meta.color, color: meta.textColor }}
                  >
                    {meta.icon} {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sensors in this box */}
        {showSensors && boxSensors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {boxSensors.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full border border-sky-100">
                <Thermometer size={10} />
                {s.name} {s.position ? `· ${s.position}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* Sensor picker when expanded */}
        {expanded && editable && showSensors && (
          <div className="mt-2 pt-2 border-t border-stone-200/60 dark:border-stone-800/60">
            <SensorPicker hiveId={hive.id} boxId={box.id} boxSensorIds={box.sensorIds} />
          </div>
        )}
      </div>
    </div>
  );
}