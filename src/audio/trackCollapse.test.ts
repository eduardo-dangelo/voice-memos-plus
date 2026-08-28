import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPerformanceWarningMessage } from './performanceBudget';
import {
  COLLAPSED_TRACK_HEIGHT,
  computeAccordionCollapsedIds,
  computeTrackHeights,
  focalTrackIndexFromScrollY,
  scrollYForFocalTrackIndex,
} from './trackCollapse';

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

test('getPerformanceWarningMessage mentions accordion remedy', () => {
  assert.match(getPerformanceWarningMessage(true, false), /Collapse Unselected Tracks/);
  assert.match(getPerformanceWarningMessage(false, true), /Collapse Unselected Tracks/);
  assert.match(getPerformanceWarningMessage(true, true), /layers and heavy audio effects/);
});
