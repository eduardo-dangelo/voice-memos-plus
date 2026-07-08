import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getClickIntervalSec,
  getMetronomeBeatTimes,
  getQuarterIntervalSec,
  isPrimaryAccentBeat,
  isSecondaryAccentBeat,
} from './metronome';
import {
  DEFAULT_METRONOME_SETTINGS,
  normalizeMetronomeSettings,
  type MetronomeSettings,
} from '@/src/storage/types';

function makeSettings(overrides: Partial<MetronomeSettings> = {}): MetronomeSettings {
  return { ...DEFAULT_METRONOME_SETTINGS, enabled: true, ...overrides };
}

describe('getClickIntervalSec', () => {
  it('uses quarter-note spacing for 4/4 at 120 bpm', () => {
    assert.equal(getClickIntervalSec(makeSettings({ bpm: 120, timeSignature: '4/4' })), 0.5);
  });

  it('uses eighth-note spacing for 6/8 at 120 bpm', () => {
    assert.equal(getClickIntervalSec(makeSettings({ bpm: 120, timeSignature: '6/8' })), 0.25);
  });

  it('uses quarter-note spacing for 3/4 at 120 bpm', () => {
    assert.equal(getClickIntervalSec(makeSettings({ bpm: 120, timeSignature: '3/4' })), 0.5);
  });
});

describe('isPrimaryAccentBeat', () => {
  it('accents the downbeat of each 3/4 bar', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '3/4' });
    assert.equal(isPrimaryAccentBeat(0, settings), true);
    assert.equal(isPrimaryAccentBeat(0.5, settings), false);
    assert.equal(isPrimaryAccentBeat(1.5, settings), true);
    assert.equal(isPrimaryAccentBeat(2, settings), false);
  });

  it('accents every bar downbeat in 6/8', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '6/8' });
    assert.equal(isPrimaryAccentBeat(0, settings), true);
    assert.equal(isPrimaryAccentBeat(0.25, settings), false);
    assert.equal(isPrimaryAccentBeat(1.5, settings), true);
  });
});

describe('isSecondaryAccentBeat', () => {
  it('accents the midpoint grouping in 6/8', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '6/8' });
    assert.equal(isSecondaryAccentBeat(0, settings), false);
    assert.equal(isSecondaryAccentBeat(0.75, settings), true);
    assert.equal(isSecondaryAccentBeat(1.5, settings), false);
    assert.equal(isSecondaryAccentBeat(2.25, settings), true);
  });

  it('has no secondary accent for 4/4', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '4/4' });
    assert.equal(isSecondaryAccentBeat(0.5, settings), false);
  });
});

describe('getMetronomeBeatTimes', () => {
  it('returns no beats when disabled', () => {
    assert.deepEqual(
      getMetronomeBeatTimes(makeSettings({ enabled: false }), 0, 2),
      []
    );
  });

  it('anchors beats to timeline zero in 4/4', () => {
    assert.deepEqual(
      getMetronomeBeatTimes(makeSettings({ bpm: 120, timeSignature: '4/4' }), 0.2, 1.2),
      [0.5, 1]
    );
  });

  it('schedules eighth-note clicks for 6/8', () => {
    assert.deepEqual(
      getMetronomeBeatTimes(makeSettings({ bpm: 120, timeSignature: '6/8' }), 0, 1),
      [0, 0.25, 0.5, 0.75]
    );
  });

  it('respects playback end boundary', () => {
    const beats = getMetronomeBeatTimes(
      makeSettings({ bpm: 120, timeSignature: '4/4' }),
      0,
      0.5
    );
    assert.deepEqual(beats, [0]);
    assert.equal(getQuarterIntervalSec(120), 0.5);
  });
});

describe('normalizeMetronomeSettings', () => {
  it('defaults missing time signature to 4/4', () => {
    assert.equal(normalizeMetronomeSettings({}).timeSignature, '4/4');
  });

  it('preserves a valid time signature preset', () => {
    assert.equal(normalizeMetronomeSettings({ timeSignature: '3/4' }).timeSignature, '3/4');
  });

  it('migrates legacy subdivision field to 4/4', () => {
    assert.equal(
      normalizeMetronomeSettings({ subdivision: '1/8' } as Parameters<typeof normalizeMetronomeSettings>[0])
        .timeSignature,
      '4/4'
    );
    assert.equal(
      normalizeMetronomeSettings({ subdivision: '1/4' } as Parameters<typeof normalizeMetronomeSettings>[0])
        .timeSignature,
      '4/4'
    );
  });
});
