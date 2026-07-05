import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  pad?: boolean;
}

export function Card({ children, className = '', onClick, pad = true }: CardProps) {
  const base = 'bg-white rounded-2xl shadow-card border border-stone-100 transition-shadow';
  const interactive = onClick ? 'cursor-pointer active:scale-[0.99] hover:shadow-card-hover' : '';
  const padding = pad ? 'p-4' : '';
  return (
    <div
      className={`${base} ${interactive} ${padding} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function SectionCard({ title, icon, children, className = '', action }: { title?: string; icon?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={`bg-white rounded-2xl shadow-card border border-stone-100 ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
            {icon}
            {title}
          </h3>
          {action}
        </div>
      )}
      <div className="p-4 pt-2">{children}</div>
    </div>
  );
}