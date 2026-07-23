import { FRAME_CONTENT_META, FRAME_CONTENT_ORDER } from '../lib/hiveTypes';
import type { FrameContent } from '../types';

interface FrameCellProps {
  content: FrameContent;
  position: number;
  onClick?: () => void;
  compact?: boolean;
  selected?: boolean;
  onSelect?: (c: FrameContent) => void;
}

export function FrameCell({ content, position, onClick, compact, selected, onSelect }: FrameCellProps) {
  const meta = FRAME_CONTENT_META[content];
  const w = compact ? 'min-w-[20px] flex-1' : 'min-w-[26px] flex-1';
  const h = compact ? 'h-12' : 'h-16 sm:h-20';

  if (onSelect) {
    // selection mode (picker)
    return (
      <button
        type="button"
        onClick={() => onSelect(content)}
        className={`${w} ${h} rounded-md flex flex-col items-center justify-center transition-all ${
          selected ? 'ring-2 ring-honey-500 scale-105' : 'opacity-80 hover:opacity-100'
        }`}
        style={{ background: meta.color, color: meta.textColor }}
        title={`${meta.label}`}
      >
        <span className={compact ? 'text-[10px]' : 'text-xs'}>{meta.icon}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${w} ${h} rounded-md flex flex-col items-center justify-center transition-all active:scale-95 hover:brightness-105 relative`}
      style={{ background: meta.color, color: meta.textColor }}
      title={`Frame ${position + 1}: ${meta.label}`}
    >
      <span className={compact ? 'text-[10px]' : 'text-sm'}>{meta.icon}</span>
      {!compact && <span className="text-[9px] font-medium leading-none mt-0.5">{meta.label}</span>}
    </button>
  );
}

export function FrameContentPicker({ value, onSelect }: { value: FrameContent; onSelect: (c: FrameContent) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {FRAME_CONTENT_ORDER.map((c) => (
        <FrameCell
          key={c}
          content={c}
          position={-1}
          compact
          selected={value === c}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}