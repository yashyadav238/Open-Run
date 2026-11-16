import React from 'react';
import { Activity, Bike, Footprints, Mountain, Trees } from 'lucide-react';
import { ALL_WORKOUT_TYPES, getWorkoutMeta, normalizeWorkoutType } from '../data/workouts';
import type { WorkoutType } from '../types/run';

interface WorkoutIconProps {
  type?: WorkoutType | string | null;
  className?: string;
}

export const WorkoutIcon: React.FC<WorkoutIconProps> = ({ type, className = 'h-4 w-4' }) => {
  const norm = normalizeWorkoutType(type);
  switch (norm) {
    case 'cycling':
      return <Bike className={className} />;
    case 'walking':
      return <Footprints className={className} />;
    case 'hiking':
      return <Mountain className={className} />;
    case 'trail_run':
      return <Trees className={className} />;
    case 'running':
    default:
      return <Activity className={className} />;
  }
};

interface WorkoutSelectorProps {
  value: WorkoutType;
  onChange: (next: WorkoutType) => void;
  compact?: boolean;
  darkSurface?: boolean;
  disabled?: boolean;
}

export const WorkoutSelector: React.FC<WorkoutSelectorProps> = ({
  value,
  onChange,
  compact = false,
  darkSurface = false,
  disabled = false,
}) => {
  return (
    <div
      role="tablist"
      aria-label="Workout type"
      className={`grid grid-cols-5 gap-1 rounded-xl p-1 ${
        darkSurface
          ? 'border border-white/15 bg-black/25'
          : 'border border-[#E5E3DC] bg-[#F6F5F0]'
      }`}
    >
      {ALL_WORKOUT_TYPES.map((wType) => {
        const meta = getWorkoutMeta(wType);
        const active = value === wType;
        return (
          <button
            key={wType}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(wType)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition whitespace-nowrap disabled:opacity-50 ${
              compact ? 'min-h-[38px] px-2 text-[11px]' : 'min-h-[42px] px-2.5 text-xs'
            } ${
              active
                ? darkSurface
                  ? 'bg-[#9AE62E] text-[#172D27] shadow-sm'
                  : 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                : darkSurface
                ? 'text-white/80 hover:bg-white/10 hover:text-white'
                : 'text-[#5B6B64] hover:text-[#141F1B]'
            }`}
          >
            <WorkoutIcon type={wType} className={compact ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'} />
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
};
