import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Thermometer, X } from 'lucide-react';
import { BOX_TYPE_LABELS, HIVE_TYPES } from '../lib/hiveTypes';
import type { Box, BoxType, FrameContent, Hive } from '../types';
import { FrameCell, FrameContentPicker } from './FrameCell';
import { SensorPicker } from './SensorPicker';
import { useStore } from '../store/useStore';

interface HiveVisualProps {
  hive: Hive;
  editable?: boolean;
  showSensors?: boolean;
}

export function HiveVisual({ hive, editable = false, showSensors = true }: HiveVisualProps) {
  const { updateFrameContent, cycleFrameContent, addBox, removeBox, sensors } = useStore();
  const def = HIVE_TYPES[hive.type];
  const [expandedBox, setExpandedBox] = useState<string | null>(null);
  const [editingFrame, setEditingFrame] = useState<{ boxId: string; pos: number } | null>(null);

  const handleFrameClick = (boxId: string, pos: number) => {
    if (!editable) return;
    if (pos < 0) {
      setEditingFrame(null);
      return;
    }
    if (editingFrame && editingFrame.boxId === boxId && editingFrame.pos === pos) {
      setEditingFrame(null);
      cycleFrameContent(hive.id, boxId, pos);
    } else {
      setEditingFrame({ boxId, pos });
    }
  };

  const handleAddBox = () => {
    const bt = def.allowedBoxTypes[0];
    addBox(hive.id, bt);
  };

  return (
    <div className="space-y-3">
      {/* Hive stack: render bottom-to-top visually (index 0 = bottom) */}
      <div className="flex flex-col-reverse gap-2">
        {hive.boxes.map((box, idx) => (
          <BoxView
            key={box.id}
            box={box}
            boxIndex={idx}
            hive={hive}
            editable={editable}
            expanded={expandedBox === box.id}
            onToggleExpand={() => setExpandedBox(expandedBox === box.id ? null : box.id)}
            editingFrame={editingFrame}
            onFrameClick={handleFrameClick}
            onSelectFrameContent={(c) => {
              if (editingFrame) {
                updateFrameContent(hive.id, editingFrame.boxId, editingFrame.pos, c);
                setEditingFrame(null);
              }
            }}
            onCycleFrame={(boxId, pos) => cycleFrameContent(hive.id, boxId, pos)}
            onRemoveBox={() => removeBox(hive.id, box.id)}
            sensors={sensors}
            showSensors={showSensors}
          />
        ))}
      </div>

      {editable && !def.singleBox && (
        <button
          type="button"
          onClick={handleAddBox}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-stone-300 text-stone-500 text-sm font-medium hover:border-honey-400 hover:text-honey-600 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus size={18} /> Add Box / Super
        </button>
      )}
    </div>
  );
}

function BoxView({
  box,
  boxIndex,
  hive,
  editable,
  expanded,
  onToggleExpand,
  editingFrame,
  onFrameClick,
  onSelectFrameContent,
  onCycleFrame,
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
  editingFrame: { boxId: string; pos: number } | null;
  onFrameClick: (boxId: string, pos: number) => void;
  onSelectFrameContent: (c: FrameContent) => void;
  onCycleFrame: (boxId: string, pos: number) => void;
  onRemoveBox: () => void;
  sensors: import('../types').Sensor[];
  showSensors: boolean;
}) {
  const def = HIVE_TYPES[hive.type];
  const frameCount = def.frameCountFor(box.type);
  const isWide = frameCount > 12;
  const compact = isWide || frameCount > 10;
  const boxSensors = sensors.filter((s) => s.boxId === box.id);

  // Wood color tones by box type
  const woodTone: Record<BoxType, string> = {
    deep: 'bg-amber-900/10 border-amber-900/30',
    medium: 'bg-amber-800/10 border-amber-800/30',
    shallow: 'bg-amber-700/10 border-amber-700/30',
    nuc: 'bg-stone-300/40 border-stone-400/40',
    apimaye: 'bg-orange-100 border-orange-300',
    'apimaye-split': 'bg-orange-50 border-orange-200',
    'queen-castle-comp': 'bg-stone-200 border-stone-400',
  };

  return (
    <div className={`rounded-xl border-2 ${woodTone[box.type]} overflow-hidden`}>
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-stone-900/5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-stone-600">#{boxIndex + 1}</span>
          <span className="text-xs font-medium text-stone-700 truncate">{BOX_TYPE_LABELS[box.type]}</span>
          <span className="text-[10px] text-stone-400">· {frameCount} frames</span>
          {boxSensors.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-full">
              <Thermometer size={10} /> {boxSensors.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {editable && !def.singleBox && hive.boxes.length > 1 && (
            <button
              type="button"
              onClick={onRemoveBox}
              className="p-1 text-stone-400 hover:text-red-500 transition-colors"
              title="Remove box"
            >
              <Trash2 size={14} />
            </button>
          )}
          {editable && (
            <button type="button" onClick={onToggleExpand} className="p-1 text-stone-400 hover:text-stone-700">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      <div className="p-2 bg-white/60">
        <div className={`flex gap-1 ${compact ? '' : 'gap-1.5'}`}>
          {box.frames.map((f) => (
            <FrameCell
              key={f.position}
              content={f.content}
              position={f.position}
              compact={compact}
              onClick={editable ? () => onFrameClick(box.id, f.position) : undefined}
            />
          ))}
        </div>

        {editingFrame?.boxId === box.id && editable && (
          <div className="mt-2 p-2 rounded-lg bg-honey-50 border border-honey-200 animate-fade-in">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-stone-700">
                Frame {editingFrame.pos + 1} — tap to set content:
              </span>
              <button onClick={() => onFrameClick(box.id, editingFrame.pos)} className="text-stone-400">
                <X size={14} />
              </button>
            </div>
            <FrameContentPicker
              value={box.frames.find((f) => f.position === editingFrame.pos)?.content ?? 'empty'}
              onSelect={onSelectFrameContent}
            />
            <button
              type="button"
              onClick={() => {
                if (editingFrame) {
                  onCycleFrame(box.id, editingFrame.pos);
                  onFrameClick(box.id, editingFrame.pos);
                }
              }}
              className="mt-2 w-full text-xs py-1.5 rounded-lg bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
            >
              Cycle to next →
            </button>
          </div>
        )}

        {showSensors && boxSensors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {boxSensors.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 text-[10px] bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full border border-sky-100"
              >
                <Thermometer size={10} />
                {s.name} {s.position ? `· ${s.position}` : ''}
              </span>
            ))}
          </div>
        )}

        {expanded && editable && showSensors && (
          <div className="mt-2 pt-2 border-t border-stone-200/60">
            <SensorPicker hiveId={hive.id} boxId={box.id} boxSensorIds={box.sensorIds} />
          </div>
        )}
      </div>
    </div>
  );
}