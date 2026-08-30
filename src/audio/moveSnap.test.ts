import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getDefaultMoveSnapSelection,
  getMoveSnapIntervalSec,
  getMoveSnapOptions,
  isMoveSnapSelectionValid,
} from '@/src/audio/moveSnap';
import { DEFAULT_METRONOME_SETTINGS, type MetronomeSettings } from '@/src/storage/types';

function makeSettings(overrides: Partial<MetronomeSettings> = {}): MetronomeSettings {
  return { ...DEFAULT_METRONOME_SETTINGS, ...overrides };
}

test('getDefaultMoveSnapSelection returns off when grid is hidden', () => {
  assert.equal(getDefaultMoveSnapSelection(makeSettings({ showGrid: false })), 'off');
});

test('getDefaultMoveSnapSelection returns metronome subdivision when grid is on', () => {
  assert.equal(
    getDefaultMoveSnapSelection(
      makeSettings({ showGrid: true, metronomeGridSubdivision: '1/16' })
    ),
    '1/16'
  );
});

test('getDefaultMoveSnapSelection returns time subdivision when grid basis is time', () => {
  assert.equal(
    getDefaultMoveSnapSelection(
      makeSettings({
        showGrid: true,
        gridBasis: 'time',
        timeGridSubdivision: '0.25s',
      })
    ),
    '0.25s'
  );
});

test('getMoveSnapOptions lists metronome subdivisions', () => {
  assert.deepEqual(
    getMoveSnapOptions(makeSettings({ gridBasis: 'metronome' })).map((option) => option.id),
    ['off', '1/4', '1/8', '1/16', '1/32']
  );
});

test('getMoveSnapOptions lists time subdivisions', () => {
  assert.deepEqual(
    getMoveSnapOptions(makeSettings({ gridBasis: 'time' })).map((option) => option.id),
    ['off', '1s', '0.5s', '0.25s', '0.125s']
  );
});

test('getMoveSnapIntervalSec returns null for off', () => {
  assert.equal(getMoveSnapIntervalSec(makeSettings(), 'off'), null);
});

test('getMoveSnapIntervalSec returns metronome interval for subdivision', () => {
  assert.equal(
    getMoveSnapIntervalSec(
      makeSettings({ bpm: 120, timeSignature: '4/4' }),
      '1/8'
    ),
    0.25
  );
});

test('getMoveSnapIntervalSec returns time interval for subdivision', () => {
  assert.equal(
    getMoveSnapIntervalSec(makeSettings({ gridBasis: 'time' }), '0.125s'),
    0.125
  );
});

test('isMoveSnapSelectionValid rejects cross-basis selections', () => {
  assert.equal(isMoveSnapSelectionValid(makeSettings({ gridBasis: 'time' }), '1/8'), false);
  assert.equal(isMoveSnapSelectionValid(makeSettings({ gridBasis: 'metronome' }), '0.5s'), false);
  assert.equal(isMoveSnapSelectionValid(makeSettings({ gridBasis: 'time' }), '0.5s'), true);
});
