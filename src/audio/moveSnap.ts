import { getClickIntervalSec } from '@/src/audio/metronome';
import {
  METRONOME_GRID_SUBDIVISIONS,
  TIME_GRID_SUBDIVISIONS,
  type MetronomeGridSubdivision,
  type MetronomeSettings,
  type TimeGridSubdivision,
} from '@/src/storage/types';

export type MoveSnapSelection = 'off' | MetronomeGridSubdivision | TimeGridSubdivision;

const METRONOME_GRID_SUBDIVISION_DIVISOR: Record<MetronomeGridSubdivision, number> = {
  '1/4': 1,
  '1/8': 2,
  '1/16': 4,
  '1/32': 8,
};

const TIME_GRID_INTERVAL_SEC: Record<TimeGridSubdivision, number> = {
  '1s': 1,
  '0.5s': 0.5,
  '0.25s': 0.25,
  '0.125s': 0.125,
};

const OFF_OPTION = { id: 'off' as const, label: 'Off' };

function isMetronomeGridSubdivision(value: string): value is MetronomeGridSubdivision {
  return (METRONOME_GRID_SUBDIVISIONS as readonly string[]).includes(value);
}

function isTimeGridSubdivision(value: string): value is TimeGridSubdivision {
  return (TIME_GRID_SUBDIVISIONS as readonly string[]).includes(value);
}

export function getDefaultMoveSnapSelection(settings: MetronomeSettings): MoveSnapSelection {
  if (!settings.showGrid) {
    return 'off';
  }
  if (settings.gridBasis === 'time') {
    return settings.timeGridSubdivision;
  }
  return settings.metronomeGridSubdivision;
}

export function getMoveSnapOptions(
  settings: MetronomeSettings
): { id: MoveSnapSelection; label: string }[] {
  if (settings.gridBasis === 'time') {
    return [
      OFF_OPTION,
      ...TIME_GRID_SUBDIVISIONS.map((id) => ({ id, label: id })),
    ];
  }
  return [
    OFF_OPTION,
    ...METRONOME_GRID_SUBDIVISIONS.map((id) => ({ id, label: id })),
  ];
}

export function isMoveSnapSelectionValid(
  settings: MetronomeSettings,
  selection: MoveSnapSelection
): boolean {
  if (selection === 'off') {
    return true;
  }
  if (settings.gridBasis === 'time') {
    return isTimeGridSubdivision(selection);
  }
  return isMetronomeGridSubdivision(selection);
}

export function getMoveSnapIntervalSec(
  settings: MetronomeSettings,
  selection: MoveSnapSelection
): number | null {
  if (selection === 'off') {
    return null;
  }
  if (settings.gridBasis === 'time') {
    if (!isTimeGridSubdivision(selection)) {
      return null;
    }
    return TIME_GRID_INTERVAL_SEC[selection];
  }
  if (!isMetronomeGridSubdivision(selection)) {
    return null;
  }
  return getClickIntervalSec(settings) / METRONOME_GRID_SUBDIVISION_DIVISOR[selection];
}
