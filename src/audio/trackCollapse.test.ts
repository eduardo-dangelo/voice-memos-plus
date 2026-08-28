import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACCORDION_AUTO_ENABLE_LAYER_COUNT,
  COLLAPSED_TRACK_HEIGHT,
  computeAccordionCollapsedIds,
  computeRecordingLayoutCollapsedIds,
  computeTrackHeights,
  didCrossAccordionAutoEnableThreshold,
  focalTrackIndexFromScrollY,
  scrollYForFocalTrackIndex,
  shouldShowAccordionAutoEnableAlert,
} from './trackCollapse';
import { getPerformanceWarningMessage } from './performanceBudget';

test('computeAccordionCollapsedIds keeps only active expanded', () => {
  const collapsed = computeAccordionCollapsedIds({
    playableLayerIds: ['a', 'b', 'c', 'd'],
    activeLayerId: 'c',
  });
  assert.deepEqual([...collapsed].sort(), ['a', 'b', 'd']);
});

test('computeAccordionCollapsedIds collapses all when nothing selected', () => {
  const collapsed = computeAccordionCollapsedIds({
    playableLayerIds: ['a', 'b', 'c'],
    activeLayerId: null,
  });
  assert.deepEqual([...collapsed].sort(), ['a', 'b', 'c']);
});

test('computeAccordionCollapsedIds skips non-collapsible ids', () => {
  const collapsed = computeAccordionCollapsedIds({
    playableLayerIds: ['a', 'b', 'c'],
    activeLayerId: 'b',
    nonCollapsibleIds: new Set(['c']),
  });
  assert.deepEqual([...collapsed], ['a']);
});

test('computeAccordionCollapsedIds force-expands processing layer when unselected', () => {
  const collapsed = computeAccordionCollapsedIds({
    playableLayerIds: ['a', 'b', 'c', 'd', 'e'],
    activeLayerId: null,
    forceExpandedLayerId: 'e',
  });
  assert.deepEqual([...collapsed].sort(), ['a', 'b', 'c', 'd']);
});

test('computeAccordionCollapsedIds prefers forceExpanded over null active selection', () => {
  const collapsed = computeAccordionCollapsedIds({
    playableLayerIds: ['a', 'b', 'c'],
    activeLayerId: 'a',
    forceExpandedLayerId: 'c',
  });
  assert.deepEqual([...collapsed], ['b']);
});

test('computeTrackHeights allocates collapsed and expanded rows', () => {
  const heights = computeTrackHeights([false, true, false], 300, 1);
  assert.equal(heights[1], COLLAPSED_TRACK_HEIGHT);
  assert.ok(heights[0]! > COLLAPSED_TRACK_HEIGHT);
  assert.ok(heights[2]! > COLLAPSED_TRACK_HEIGHT);
  assert.equal(heights[0], heights[2]);
});

test('focalTrackIndexFromScrollY handles mixed row heights', () => {
  const heights = [100, COLLAPSED_TRACK_HEIGHT, 100];
  const index = focalTrackIndexFromScrollY(100, 15, heights);
  assert.ok(index > 1 && index < 2);
});

test('scrollYForFocalTrackIndex inverts focal mapping', () => {
  const heights = [100, COLLAPSED_TRACK_HEIGHT, 100];
  const index = 1.5;
  const focalY = 10;
  const scrollY = scrollYForFocalTrackIndex(index, focalY, heights);
  const roundTrip = focalTrackIndexFromScrollY(scrollY, focalY, heights);
  assert.ok(Math.abs(roundTrip - index) < 0.01);
});

test('getPerformanceWarningMessage uses original performance copy', () => {
  assert.match(getPerformanceWarningMessage(true, false), /8 or more layers/);
  assert.match(getPerformanceWarningMessage(false, true), /audio effects/);
  assert.match(getPerformanceWarningMessage(true, true), /many layers and heavy effects/);
  assert.doesNotMatch(getPerformanceWarningMessage(true, false), /Collapse Unselected Tracks/);
});

test('shouldShowAccordionAutoEnableAlert at layer threshold', () => {
  assert.equal(
    shouldShowAccordionAutoEnableAlert(ACCORDION_AUTO_ENABLE_LAYER_COUNT - 1, false),
    false
  );
  assert.equal(
    shouldShowAccordionAutoEnableAlert(ACCORDION_AUTO_ENABLE_LAYER_COUNT, false),
    true
  );
  assert.equal(
    shouldShowAccordionAutoEnableAlert(ACCORDION_AUTO_ENABLE_LAYER_COUNT, true),
    false
  );
});

test('didCrossAccordionAutoEnableThreshold detects 5th layer crossing', () => {
  assert.equal(didCrossAccordionAutoEnableThreshold(3, 4), false);
  assert.equal(didCrossAccordionAutoEnableThreshold(4, 5), true);
  assert.equal(didCrossAccordionAutoEnableThreshold(5, 6), false);
  assert.equal(didCrossAccordionAutoEnableThreshold(6, 7), false);
});

test('computeRecordingLayoutCollapsedIds collapses all layers during stack', () => {
  const collapsed = computeRecordingLayoutCollapsedIds({
    isStackLayout: true,
    playableLayerIds: ['a', 'b', 'c'],
    activeLayerId: 'b',
  });
  assert.deepEqual([...collapsed].sort(), ['a', 'b', 'c']);
});

test('computeRecordingLayoutCollapsedIds keeps active layer expanded during replace', () => {
  const collapsed = computeRecordingLayoutCollapsedIds({
    isStackLayout: false,
    playableLayerIds: ['a', 'b', 'c'],
    activeLayerId: 'b',
  });
  assert.deepEqual([...collapsed].sort(), ['a', 'c']);
});
