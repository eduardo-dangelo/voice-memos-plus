import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCENT_AMPLITUDE,
  getClickIntervalSec,
  getGridSnapIntervalSec,
  getMinPixelsPerSecondForGrid,
  getMetronomeBeatTimes,
  getMetronomeGridLineKind,
  getMetronomeGridLinesInRange,
  getMetronomeGridStepSec,
  getQuarterIntervalSec,
  getTimeGridAlignedMarkerTimes,
  getTimeGridMarkerTimesFromLines,
  isPrimaryAccentBeat,
  isSecondaryAccentBeat,
  METRONOME_GRID_MAX_LINES,
  METRONOME_GRID_MIN_SPACING_PX,
  NORMAL_AMPLITUDE,
  pickGridSubdivisionForPixelsPerSecond,
  pickMetronomeGridSubdivisionForPixelsPerSecond,
  pickTimeGridSubdivisionForPixelsPerSecond,
  SECONDARY_ACCENT_GAIN,
  synthesizeClickSamples,
} from './metronome';
import { TIMELINE_DEFAULT_PIXELS_PER_SECOND, TIMELINE_MAX_PIXELS_PER_SECOND } from './timelineZoom';
import {
  DEFAULT_METRONOME_SETTINGS,
  getMetronomeMode,
  nextMetronomeMode,
  normalizeMetronomeSettings,
  settingsForMetronomeMode,
  type MetronomeSettings,
} from '@/src/storage/types';

function makeSettings(overrides: Partial<MetronomeSettings> = {}): MetronomeSettings {
  return { ...DEFAULT_METRONOME_SETTINGS, enabled: true, showGrid: true, ...overrides };
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

  it('uses 1/4 metronome spacing matching the click grid at 120 4/4', () => {
    const settings = makeSettings({
      bpm: 120,
      timeSignature: '4/4',
      metronomeGridSubdivision: '1/4',
    });
    const lines = getMetronomeGridLinesInRange(settings, 0, 2, 48);
    assert.deepEqual(
      lines.map((line) => line.time),
      [0, 0.5, 1, 1.5]
    );
  });

  it('subdivides metronome 1/8 lines at 120 4/4', () => {
    const settings = makeSettings({
      bpm: 120,
      timeSignature: '4/4',
      metronomeGridSubdivision: '1/8',
    });
    const lines = getMetronomeGridLinesInRange(settings, 0, 1, 48);
    assert.deepEqual(
      lines.map((line) => ({ time: line.time, kind: line.kind })),
      [
        { time: 0, kind: 'bar' },
        { time: 0.25, kind: 'beat' },
        { time: 0.5, kind: 'beat' },
        { time: 0.75, kind: 'beat' },
      ]
    );
  });

  it('draws a 0.25s time grid with 1s bars', () => {
    const settings = makeSettings({
      gridBasis: 'time',
      timeGridSubdivision: '0.25s',
    });
    const lines = getMetronomeGridLinesInRange(settings, 0, 1.25, 48);
    assert.deepEqual(
      lines.map((line) => ({ time: line.time, kind: line.kind })),
      [
        { time: 0, kind: 'bar' },
        { time: 0.25, kind: 'beat' },
        { time: 0.5, kind: 'secondary' },
        { time: 0.75, kind: 'beat' },
        { time: 1, kind: 'bar' },
      ]
    );
  });
});

describe('getGridSnapIntervalSec', () => {
  it('returns null when the grid is hidden', () => {
    assert.equal(getGridSnapIntervalSec(makeSettings({ showGrid: false })), null);
  });

  it('snaps to metronome 1/32 subdivision', () => {
    assert.equal(
      getGridSnapIntervalSec(
        makeSettings({ bpm: 120, timeSignature: '4/4', metronomeGridSubdivision: '1/32' })
      ),
      0.0625
    );
  });

  it('snaps to the time subdivision', () => {
    assert.equal(
      getGridSnapIntervalSec(
        makeSettings({ gridBasis: 'time', timeGridSubdivision: '0.25s' })
      ),
      0.25
    );
    assert.equal(
      getGridSnapIntervalSec(
        makeSettings({ gridBasis: 'time', timeGridSubdivision: '0.125s' })
      ),
      0.125
    );
  });
});

describe('getMinPixelsPerSecondForGrid', () => {
  it('needs 160 pps (~3.3×) for 1/16 at 120 4/4', () => {
    assert.equal(
      getMinPixelsPerSecondForGrid(
        makeSettings({ bpm: 120, timeSignature: '4/4', metronomeGridSubdivision: '1/16' })
      ),
      160
    );
  });

  it('needs 320 pps (~6.7×) for 1/32 at 120 4/4', () => {
    assert.equal(
      getMinPixelsPerSecondForGrid(
        makeSettings({ bpm: 120, timeSignature: '4/4', metronomeGridSubdivision: '1/32' })
      ),
      320
    );
  });

  it('needs 40 pps for 1/4 at 120 4/4, below 1× default', () => {
    assert.equal(
      getMinPixelsPerSecondForGrid(
        makeSettings({ bpm: 120, timeSignature: '4/4', metronomeGridSubdivision: '1/4' })
      ),
      40
    );
  });
});

describe('normalizeMetronomeSettings', () => {
  it('defaults missing time signature to 4/4', () => {
    assert.equal(normalizeMetronomeSettings({}).timeSignature, '4/4');
  });

  it('defaults showGrid to false', () => {
    assert.equal(normalizeMetronomeSettings({}).showGrid, false);
  });

  it('ignores legacy showGridFollowsMetronome', () => {
    const settings = normalizeMetronomeSettings({
      showGridFollowsMetronome: true,
      showGrid: true,
    } as Parameters<typeof normalizeMetronomeSettings>[0]);
    assert.equal(settings.showGrid, true);
    assert.equal('showGridFollowsMetronome' in settings, false);
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
    assert.equal(
      normalizeMetronomeSettings({ subdivision: '1/8' } as Parameters<typeof normalizeMetronomeSettings>[0])
        .metronomeGridSubdivision,
      '1/4'
    );
  });

  it('defaults grid basis and subdivisions', () => {
    const settings = normalizeMetronomeSettings({});
    assert.equal(settings.gridBasis, 'metronome');
    assert.equal(settings.metronomeGridSubdivision, '1/4');
    assert.equal(settings.timeGridSubdivision, '1s');
  });

  it('preserves valid grid settings', () => {
    const settings = normalizeMetronomeSettings({
      gridBasis: 'time',
      metronomeGridSubdivision: '1/32',
      timeGridSubdivision: '0.25s',
    });
    assert.equal(settings.gridBasis, 'time');
    assert.equal(settings.metronomeGridSubdivision, '1/32');
    assert.equal(settings.timeGridSubdivision, '0.25s');
  });

  it('preserves 0.125s time grid subdivision', () => {
    const settings = normalizeMetronomeSettings({
      gridBasis: 'time',
      timeGridSubdivision: '0.125s',
    });
    assert.equal(settings.timeGridSubdivision, '0.125s');
  });

  it('falls back for invalid grid fields', () => {
    const settings = normalizeMetronomeSettings({
      gridBasis: 'bars' as MetronomeSettings['gridBasis'],
      metronomeGridSubdivision: '1/64' as MetronomeSettings['metronomeGridSubdivision'],
      timeGridSubdivision: '0.1s' as MetronomeSettings['timeGridSubdivision'],
    });
    assert.equal(settings.gridBasis, 'metronome');
    assert.equal(settings.metronomeGridSubdivision, '1/4');
    assert.equal(settings.timeGridSubdivision, '1s');
  });
});

describe('metronome mode cycle', () => {
  it('derives mode from enabled and showGrid', () => {
    assert.equal(getMetronomeMode({ enabled: true, showGrid: true }), 'metronome');
    assert.equal(getMetronomeMode({ enabled: true, showGrid: false }), 'metronome');
    assert.equal(getMetronomeMode({ enabled: false, showGrid: true }), 'grid');
    assert.equal(getMetronomeMode({ enabled: false, showGrid: false }), 'off');
  });

  it('maps each mode to enabled/showGrid pairs', () => {
    assert.deepEqual(settingsForMetronomeMode('metronome'), {
      enabled: true,
      showGrid: true,
    });
    assert.deepEqual(settingsForMetronomeMode('grid'), {
      enabled: false,
      showGrid: true,
    });
    assert.deepEqual(settingsForMetronomeMode('off'), {
      enabled: false,
      showGrid: false,
    });
  });

  it('cycles off → metronome → grid → off with headphones', () => {
    let settings = settingsForMetronomeMode('off');
    settings = nextMetronomeMode(settings, { headphonesConnected: true });
    assert.deepEqual(settings, { enabled: true, showGrid: true });
    settings = nextMetronomeMode(settings, { headphonesConnected: true });
    assert.deepEqual(settings, { enabled: false, showGrid: true });
    settings = nextMetronomeMode(settings, { headphonesConnected: true });
    assert.deepEqual(settings, { enabled: false, showGrid: false });
  });

  it('cycles off → grid → off without headphones', () => {
    let settings = settingsForMetronomeMode('off');
    settings = nextMetronomeMode(settings, { headphonesConnected: false });
    assert.deepEqual(settings, { enabled: false, showGrid: true });
    settings = nextMetronomeMode(settings, { headphonesConnected: false });
    assert.deepEqual(settings, { enabled: false, showGrid: false });
  });

  it('advances from metronome to grid even without headphones', () => {
    assert.deepEqual(
      nextMetronomeMode(
        { enabled: true, showGrid: true },
        { headphonesConnected: false }
      ),
      { enabled: false, showGrid: true }
    );
  });
});

describe('getTimeGridAlignedMarkerTimes', () => {
  const timeSettings = makeSettings({
    gridBasis: 'time',
    timeGridSubdivision: '1s',
    showGrid: true,
  });

  it('aligns tick times to whole-second grid lines', () => {
    const { tickTimes } = getTimeGridAlignedMarkerTimes(timeSettings, 0, 4, 60, 48, 48);
    assert.deepEqual(tickTimes, [0, 1, 2, 3, 4]);
  });

  it('places labels only on grid-aligned whole seconds at low zoom', () => {
    const settings = makeSettings({
      gridBasis: 'time',
      timeGridSubdivision: '1s',
      showGrid: true,
    });
    const pps = 8;
    const gridStep = getMetronomeGridStepSec(settings, pps);
    assert.ok(gridStep >= 2, `expected coarse grid step at low zoom, got ${gridStep}`);

    const { tickTimes, labelTimes } = getTimeGridAlignedMarkerTimes(
      settings,
      0,
      20,
      60,
      pps,
      48
    );

    for (const label of labelTimes) {
      assert.ok(tickTimes.includes(label), `label ${label} should have a tick`);
      assert.ok(label % gridStep === 0 || Math.abs((label % gridStep)) < 0.001);
    }
    assert.ok(!labelTimes.includes(5), '5s should not be labeled when grid steps every 4s');
  });

  it('uses denser labels when zoomed in', () => {
    const { labelTimes } = getTimeGridAlignedMarkerTimes(timeSettings, 0, 10, 60, 48, 48);
    assert.deepEqual(labelTimes, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('getTimeGridMarkerTimesFromLines', () => {
  const timeSettings = makeSettings({
    gridBasis: 'time',
    timeGridSubdivision: '1s',
    showGrid: true,
  });

  for (const pps of [48, 100.8, 8]) {
    it(`labels align with bar grid lines at ${pps} px/s`, () => {
      const lines = getMetronomeGridLinesInRange(timeSettings, 0, 12, pps);
      const barTimes = new Set(
        lines.filter((line) => line.kind === 'bar').map((line) => line.time)
      );
      const { labelTimes } = getTimeGridMarkerTimesFromLines(lines, pps, 48, 60);

      for (const label of labelTimes) {
        assert.ok(
          barTimes.has(label),
          `label ${label} at ${pps} px/s should match a bar grid line`
        );
      }
    });
  }

  it('omits labels on seconds with no bar line at low zoom LOD', () => {
    const settings = makeSettings({
      gridBasis: 'time',
      timeGridSubdivision: '1s',
      showGrid: true,
    });
    const pps = 8;
    const lines = getMetronomeGridLinesInRange(settings, 0, 20, pps);
    const barTimes = new Set(
      lines.filter((line) => line.kind === 'bar').map((line) => line.time)
    );
    const { labelTimes } = getTimeGridMarkerTimesFromLines(lines, pps, 48, 60);

    assert.ok(!barTimes.has(1), 'sanity: 1s should not have a bar line when grid steps every 2s');
    assert.ok(!labelTimes.includes(1));
    for (const label of labelTimes) {
      assert.ok(barTimes.has(label));
    }
  });

  it('matches getTimeGridAlignedMarkerTimes for the same range', () => {
    const aligned = getTimeGridAlignedMarkerTimes(timeSettings, 0, 10, 60, 48, 48);
    const gridStep = getMetronomeGridStepSec(timeSettings, 48);
    const lines = getMetronomeGridLinesInRange(timeSettings, 0, 10 + gridStep, 48);
    const fromLines = getTimeGridMarkerTimesFromLines(lines, 48, 48, 60);
    assert.deepEqual(fromLines, aligned);
  });
});

describe('pickGridSubdivisionForPixelsPerSecond', () => {
  const defaultPps = TIMELINE_DEFAULT_PIXELS_PER_SECOND;
  const maxPps = TIMELINE_MAX_PIXELS_PER_SECOND;

  it('picks coarsest subdivisions at default zoom', () => {
    const metronomeSettings = makeSettings({
      bpm: 120,
      timeSignature: '4/4',
      gridBasis: 'metronome',
      metronomeGridSubdivision: '1/16',
    });
    assert.equal(
      pickMetronomeGridSubdivisionForPixelsPerSecond(
        metronomeSettings,
        defaultPps,
        defaultPps,
        maxPps
      ),
      '1/4'
    );

    const timeSettings = makeSettings({ gridBasis: 'time', timeGridSubdivision: '0.125s' });
    assert.equal(
      pickTimeGridSubdivisionForPixelsPerSecond(timeSettings, defaultPps, defaultPps, maxPps),
      '1s'
    );
  });

  it('picks finest subdivisions at max horizontal zoom', () => {
    const metronomeSettings = makeSettings({
      bpm: 120,
      timeSignature: '4/4',
      gridBasis: 'metronome',
    });
    assert.equal(
      pickMetronomeGridSubdivisionForPixelsPerSecond(
        metronomeSettings,
        maxPps,
        defaultPps,
        maxPps
      ),
      '1/32'
    );

    const timeSettings = makeSettings({ gridBasis: 'time' });
    assert.equal(
      pickTimeGridSubdivisionForPixelsPerSecond(timeSettings, maxPps, defaultPps, maxPps),
      '0.125s'
    );
  });

  it('picks mid-bracket subdivisions between default and max zoom', () => {
    const metronomeSettings = makeSettings({
      bpm: 120,
      timeSignature: '4/4',
      gridBasis: 'metronome',
    });
    assert.equal(
      pickMetronomeGridSubdivisionForPixelsPerSecond(
        metronomeSettings,
        100,
        defaultPps,
        maxPps
      ),
      '1/8'
    );

    const timeSettings = makeSettings({ gridBasis: 'time' });
    assert.equal(
      pickTimeGridSubdivisionForPixelsPerSecond(timeSettings, 60, defaultPps, maxPps),
      '0.5s'
    );
  });

  it('returns only the active grid basis field from the wrapper', () => {
    const metronomeSettings = makeSettings({
      gridBasis: 'metronome',
      metronomeGridSubdivision: '1/4',
      timeGridSubdivision: '1s',
    });
    assert.deepEqual(
      pickGridSubdivisionForPixelsPerSecond(metronomeSettings, maxPps, defaultPps, maxPps),
      { metronomeGridSubdivision: '1/32', timeGridSubdivision: '1s' }
    );

    const timeSettings = makeSettings({
      gridBasis: 'time',
      metronomeGridSubdivision: '1/4',
      timeGridSubdivision: '1s',
    });
    assert.deepEqual(
      pickGridSubdivisionForPixelsPerSecond(timeSettings, maxPps, defaultPps, maxPps),
      { metronomeGridSubdivision: '1/4', timeGridSubdivision: '0.125s' }
    );
  });
});