import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCENT_AMPLITUDE,
  getClickIntervalSec,
  getMetronomeBeatTimes,
  getMetronomeGridLineKind,
  getMetronomeGridLinesInRange,
  getMetronomeGridStepSec,
  getQuarterIntervalSec,
  isPrimaryAccentBeat,
  isSecondaryAccentBeat,
  METRONOME_GRID_MAX_LINES,
  METRONOME_GRID_MIN_SPACING_PX,
  NORMAL_AMPLITUDE,
  SECONDARY_ACCENT_GAIN,
  synthesizeClickSamples,
} from './metronome';
import {
  DEFAULT_METRONOME_SETTINGS,
  normalizeMetronomeSettings,
  type MetronomeSettings,
} from '@/src/storage/types';

function makeSettings(overrides: Partial<MetronomeSettings> = {}): MetronomeSettings {
  return { ...DEFAULT_METRONOME_SETTINGS, enabled: true, ...overrides };
}

describe('synthesizeClickSamples', () => {
  const sampleRate = 48_000;

  it('keeps normal and accent peaks within full scale', () => {
    for (const [freq, amp] of [
      [1000, NORMAL_AMPLITUDE],
      [1500, ACCENT_AMPLITUDE],
    ] as const) {
      const samples = synthesizeClickSamples(sampleRate, freq, amp);
      let peak = 0;
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
        assert.ok(sample >= -1 && sample <= 1);
      }
      assert.ok(peak > 0.05, 'click should be audible');
      assert.ok(peak <= amp + 1e-6, 'peak should not exceed configured amplitude');
    }
  });

  it('starts and ends near silence so stop() does not cut a hot sample', () => {
    const samples = synthesizeClickSamples(sampleRate, 1500, ACCENT_AMPLITUDE);
    assert.ok(Math.abs(samples[0]!) < 0.02);
    assert.ok(Math.abs(samples[samples.length - 1]!) < 0.02);
  });

  it('exports secondary accent as a relative gain only (volume stays on the bus)', () => {
    assert.equal(SECONDARY_ACCENT_GAIN, 0.75);
    assert.ok(SECONDARY_ACCENT_GAIN < 1);
  });
});

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

  it('includes beat 0 when recording starts on a grid boundary', () => {
    assert.deepEqual(
      getMetronomeBeatTimes(makeSettings({ bpm: 120, timeSignature: '4/4' }), 0, 1),
      [0, 0.5]
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

describe('getMetronomeGridLineKind', () => {
  it('labels downbeats as bar when accent is enabled', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '4/4' });
    assert.equal(getMetronomeGridLineKind(0, settings), 'bar');
    assert.equal(getMetronomeGridLineKind(0.5, settings), 'beat');
  });

  it('labels 6/8 midpoint as secondary', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '6/8' });
    assert.equal(getMetronomeGridLineKind(0.75, settings), 'secondary');
  });

  it('treats all lines as beat when accent is off', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '4/4', accentEnabled: false });
    assert.equal(getMetronomeGridLineKind(0, settings), 'beat');
    assert.equal(getMetronomeGridLineKind(0.5, settings), 'beat');
  });
});

describe('getMetronomeGridStepSec', () => {
  it('uses beat spacing when zoom is wide enough', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '4/4' });
    assert.equal(getMetronomeGridStepSec(settings, 48), 0.5);
  });

  it('steps up to bars when beat spacing is too dense', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '4/4' });
    const beatPx = 0.5 * 8;
    assert.ok(beatPx < METRONOME_GRID_MIN_SPACING_PX);
    assert.equal(getMetronomeGridStepSec(settings, 8), 2);
  });
});

describe('getMetronomeGridLinesInRange', () => {
  it('returns lines even when metronome sound is disabled', () => {
    const settings = makeSettings({ enabled: false, bpm: 120, timeSignature: '4/4' });
    const lines = getMetronomeGridLinesInRange(settings, 0, 2, 48);
    assert.deepEqual(
      lines.map((line) => line.time),
      [0, 0.5, 1, 1.5]
    );
    assert.equal(lines[0]?.kind, 'bar');
    assert.equal(lines[1]?.kind, 'beat');
  });

  it('returns no lines when showGrid is off', () => {
    const settings = makeSettings({ showGrid: false, bpm: 120, timeSignature: '4/4' });
    assert.deepEqual(getMetronomeGridLinesInRange(settings, 0, 2, 48), []);
  });

  it('thins to bar lines at low zoom', () => {
    const settings = makeSettings({ bpm: 120, timeSignature: '4/4' });
    const lines = getMetronomeGridLinesInRange(settings, 0, 8, 8);
    assert.deepEqual(
      lines.map((line) => line.time),
      [0, 2, 4, 6]
    );
    assert.ok(lines.every((line) => line.kind === 'bar'));
  });

  it('respects the hard max line cap', () => {
    const settings = makeSettings({ bpm: 240, timeSignature: '6/8' });
    const lines = getMetronomeGridLinesInRange(settings, 0, 120, 400);
    assert.ok(lines.length <= METRONOME_GRID_MAX_LINES);
  });
});

describe('normalizeMetronomeSettings', () => {
  it('defaults missing time signature to 4/4', () => {
    assert.equal(normalizeMetronomeSettings({}).timeSignature, '4/4');
  });

  it('defaults showGrid to true', () => {
    assert.equal(normalizeMetronomeSettings({}).showGrid, true);
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
