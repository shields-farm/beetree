import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

const PULL_THRESHOLD = 70;     // px to trigger refresh
const MAX_PULL = 120;          // max visual pull distance
const RESISTANCE = 0.5;        // rubber-band damping

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
}

export function PullToRefresh({ children, onRefresh }: PullToRefreshProps) {
  const [pullDist, setPullDist] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if we're scrolled to top
  const isAtTop = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    // Check nearest scrollable ancestor
    let node: HTMLElement | null = el;
    while (node) {
      if (node.scrollTop > 0) return false;
      node = node.parentElement;
    }
    return window.scrollY <= 0;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    if (!isAtTop()) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, [refreshing, isAtTop]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current || refreshing) return;

    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPullDist(0);
      return;
    }

    // Prevent native pull-to-refresh (Chrome's interstitial)
    if (delta > 4 && isAtTop()) {
      e.preventDefault();
    }

    const resisted = Math.min(delta * RESISTANCE, MAX_PULL);
    setPullDist(resisted);
  }, [refreshing, isAtTop]);

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;

    if (pullDist >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullDist(PULL_THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDist(0);
      }
    } else {
      setPullDist(0);
    }
  }, [pullDist, onRefresh]);

  // Clean up on unmount
  useEffect(() => {
    return () => { pulling.current = false; };
  }, []);

  const showSpinner = refreshing || pullDist >= PULL_THRESHOLD;
  const progress = Math.min(pullDist / PULL_THRESHOLD, 1);

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ position: 'relative' }}
    >
      {/* Pull drawer */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: `${pullDist}px`,
          display: pullDist > 0 || refreshing ? 'flex' : 'none',
          alignItems: 'flex-end',
          justifyContent: 'center',
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 50,
          transition: pulling.current ? 'none' : 'height 0.3s ease-out',
        }}
      >
        <div
          style={{
            marginBottom: '8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {showSpinner ? (
            <BeeSpinner />
          ) : (
            <PullArrow progress={progress} />
          )}
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--color-honey-600, #d97706)',
              opacity: pullDist > 10 ? 1 : 0,
              transition: 'opacity 0.15s',
            }}
          >
            {refreshing ? 'Refreshing…' : pullDist >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      </div>

      {/* Content — translate down to follow the pull */}
      <div
        style={{
          transform: `translateY(${pullDist}px)`,
          transition: pulling.current ? 'none' : 'transform 0.3s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Down-arrow that rotates as you pull, becoming a refresh icon at full pull
function PullArrow({ progress }: { progress: number }) {
  const rotation = progress * 180;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        color: '#d97706',
        transform: `rotate(${rotation}deg)`,
        transition: 'transform 0.1s',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// Spinning bee emoji — matches BeeTree's bee loading pattern
function BeeSpinner() {
  return (
    <span
      style={{
        fontSize: '24px',
        animation: 'bee-spin 0.8s linear infinite',
        display: 'inline-block',
      }}
    >
      🐝
    </span>
  );
}