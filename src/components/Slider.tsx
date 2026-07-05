interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
  displayValue?: string;
  labels?: string[];
  className?: string;
}

export function Slider({ value, min, max, step = 1, onChange, label, displayValue, labels, className = '' }: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className={className}>
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-stone-700">{label}</span>
          <span className="text-sm font-semibold text-honey-700">{displayValue ?? value}</span>
        </div>
      )}
      <div className="relative">
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-honey-500 pointer-events-none"
          style={{ width: `calc(${percent}% - 0px)`, left: 0 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full relative"
          style={{ background: 'transparent' }}
        />
      </div>
      {labels && (
        <div className="flex justify-between mt-1 px-0.5">
          {labels.map((l, i) => (
            <span key={i} className="text-[10px] text-stone-400 flex-1 text-center first:text-left last:text-right">
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface LabelSliderProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}

export function LabelSlider<T extends string>({ value, options, onChange, label, className = '' }: LabelSliderProps<T>) {
  const idx = options.findIndex((o) => o.value === value);
  const percent = options.length > 1 ? (idx / (options.length - 1)) * 100 : 0;
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-stone-700">{label}</span>
        <span className="text-sm font-semibold text-honey-700">{options[idx]?.label ?? value}</span>
      </div>
      <div className="relative">
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-honey-500 pointer-events-none"
          style={{ width: `calc(${percent}% - 0px)` }}
        />
        <input
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={idx < 0 ? 0 : idx}
          onChange={(e) => onChange(options[Number(e.target.value)].value)}
          className="w-full relative"
          style={{ background: 'transparent' }}
        />
      </div>
      <div className="flex justify-between mt-1 px-0.5">
        {options.map((o, i) => (
          <span key={i} className="text-[10px] text-stone-400 flex-1 text-center first:text-left last:text-right">
            {o.label}
          </span>
        ))}
      </div>
    </div>
  );
}