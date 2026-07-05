import { useState } from 'react';
import { MapPin, Crosshair, Check, X, Trash2 } from 'lucide-react';
import type { Hive } from '../types';

interface GpsPinProps {
  hive: Hive;
  onPin: (location: Hive['location']) => void;
  onClear: () => void;
  compact?: boolean;
}

/**
 * GpsPin — lets the user drop a precise GPS pin for a hive.
 * Uses the browser Geolocation API (works on iOS Safari + Android Chrome).
 * Shows the pinned coordinates with accuracy in meters.
 */
export function GpsPin({ hive, onPin, onClear, compact = false }: GpsPinProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState(hive.location?.label ?? '');
  const [editingLabel, setEditingLabel] = useState(false);
  const loc = hive.location;

  const get_location = () => {
    setLoading(true);
    setError(null);

    if (!navigator.geolocation) {
      setError('Geolocation not supported by this browser');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false);
        onPin({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          pinnedAt: new Date().toISOString(),
          label: hive.location?.label,
        });
      },
      (err) => {
        setLoading(false);
        let msg = 'Failed to get location';
        switch (err.code) {
          case err.PERMISSION_DENIED:
            msg = 'Location permission denied. Enable location access in your browser settings.';
            break;
          case err.POSITION_UNAVAILABLE:
            msg = 'Location unavailable. Check your GPS signal.';
            break;
          case err.TIMEOUT:
            msg = 'Location request timed out. Try again.';
            break;
        }
        setError(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  if (compact && loc) {
    // Compact mode: just show coords
    return (
      <div className="flex items-center gap-1.5 text-xs text-stone-500">
        <MapPin size={12} className="text-honey-600" />
        <span>{loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}</span>
        {loc.accuracy && (
          <span className="text-stone-400">±{Math.round(loc.accuracy)}m</span>
        )}
      </div>
    );
  }

  if (!loc) {
    return (
      <div>
        <button
          onClick={get_location}
          disabled={loading}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-honey-300 text-honey-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-honey-50 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <>
              <Crosshair size={16} className="animate-pulse" /> Getting GPS…
            </>
          ) : (
            <>
              <Crosshair size={16} /> Pin GPS Location
            </>
          )}
        </button>
        {error && (
          <p className="text-xs text-red-500 mt-1.5 px-1">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-honey-50 border border-honey-200 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin size={18} className="text-honey-600 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-800 truncate">GPS Pin Dropped</div>
            <div className="text-xs text-stone-500 font-mono">
              {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
            </div>
          </div>
        </div>
        <button
          onClick={get_location}
          disabled={loading}
          className="text-xs text-honey-700 font-medium px-2 py-1 rounded-lg hover:bg-honey-100 disabled:opacity-50"
        >
          {loading ? 'Updating…' : 'Re-pin'}
        </button>
      </div>

      {loc.accuracy != null && (
        <div className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="bg-honey-100 text-honey-800 px-1.5 py-0.5 rounded font-medium">
            ±{Math.round(loc.accuracy)}m accuracy
          </span>
          {loc.pinnedAt && (
            <span className="text-stone-400">
              · {new Date(loc.pinnedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {editingLabel ? (
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g., near the oak tree"
            className="flex-1 rounded-lg border border-stone-200 px-3 py-1.5 text-sm"
            autoFocus
          />
          <button
            onClick={() => {
              onPin({ ...loc, label: label.trim() || undefined });
              setEditingLabel(false);
            }}
            className="w-8 h-8 rounded-lg bg-honey-500 text-white flex items-center justify-center"
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => {
              setLabel(loc.label ?? '');
              setEditingLabel(false);
            }}
            className="w-8 h-8 rounded-lg bg-stone-200 text-stone-600 flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          {loc.label ? (
            <button
              onClick={() => setEditingLabel(true)}
              className="text-xs text-stone-600 italic hover:text-honey-700"
            >
              "{loc.label}" ✎
            </button>
          ) : (
            <button
              onClick={() => setEditingLabel(true)}
              className="text-xs text-stone-400 hover:text-honey-700"
            >
              + Add location label
            </button>
          )}
          <a
            href={`https://maps.apple.com/?ll=${loc.lat},${loc.lng}&q=Hive`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-600 hover:underline font-medium"
          >
            Open in Maps →
          </a>
        </div>
      )}

      <button
        onClick={onClear}
        className="w-full py-1.5 rounded-lg border border-red-200 text-red-600 text-xs flex items-center justify-center gap-1.5 hover:bg-red-50"
      >
        <Trash2 size={12} /> Remove pin
      </button>
    </div>
  );
}