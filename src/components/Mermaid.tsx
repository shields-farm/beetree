import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let initDone = false;

export function Mermaid({ chart, className = '' }: { chart: string; className?: string }) {
  const [svg, setSvg] = useState('');
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 11)}`);

  useEffect(() => {
    if (!initDone) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', fontFamily: 'system-ui, sans-serif' });
      initDone = true;
    }

    let cancelled = false;
    const isDark = document.documentElement.classList.contains('dark');

    mermaid
      .initialize({ startOnLoad: false, securityLevel: 'loose', theme: isDark ? 'dark' : 'default', fontFamily: 'system-ui, sans-serif' });
    mermaid
      .render(idRef.current, chart)
      .then(({ svg: rendered }) => { if (!cancelled) setSvg(rendered); })
      .catch(() => { if (!cancelled) setSvg('<p style="color:#999;padding:1rem">Diagram unavailable</p>'); });

    return () => { cancelled = true; };
  }, [chart]);

  return (
    <div
      className={`mermaid-container overflow-x-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}