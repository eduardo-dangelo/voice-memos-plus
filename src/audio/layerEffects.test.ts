import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampPan,
  clampTrimValues,
  createDefaultLayerEffects,
  hasActivePan,
  isLayerLocked,
  isLockedLayerEffectsChangeAllowed,
  MIN_TRIM_SELECTION,
  normalizeLayerEffects,
  TRIM_SNAP_SECONDS,
} from '@/src/audio/layerEffects';

describe('clampTrimValues', () => {
  it('quantizes to TRIM_SNAP_SECONDS by default', () => {
    const next = clampTrimValues(1.04, 3.06, 10);
    assert.equal(next.trimIn, Math.round(1.04 / TRIM_SNAP_SECONDS) * TRIM_SNAP_SECONDS);
    assert.equal(next.trimOut, Math.round(3.06 / TRIM_SNAP_SECONDS) * TRIM_SNAP_SECONDS);
  });

  it('skips quantization when quantizeSec is null', () => {
    const next = clampTrimValues(1.04, 3.06, 10, null);
    assert.equal(next.trimIn, 1.04);
    assert.equal(next.trimOut, 3.06);
  });

  it('still enforces min selection without quantization', () => {
    const next = clampTrimValues(2, 2.1, 10, null);
    assert.equal(next.trimIn, 2);
    assert.equal(next.trimOut, 2 + MIN_TRIM_SELECTION);
  });
});

describe('layer lock', () => {
  it('isLayerLocked reads the locked flag', () => {
    const unlocked = createDefaultLayerEffects(5);
    const locked = { ...unlocked, locked: true };
    assert.equal(isLayerLocked(unlocked), false);
    assert.equal(isLayerLocked(locked), true);
  });

  it('allows mute/solo/locked changes while locked', () => {
    const locked = { ...createDefaultLayerEffects(5), locked: true };
    assert.equal(isLockedLayerEffectsChangeAllowed(locked, { muted: true }), true);
    assert.equal(isLockedLayerEffectsChangeAllowed(locked, { solo: true }), true);
    assert.equal(isLockedLayerEffectsChangeAllowed(locked, { locked: false }), true);
  });

  it('rejects edit changes while locked', () => {
    const locked = { ...createDefaultLayerEffects(5), locked: true };
    assert.equal(isLockedLayerEffectsChangeAllowed(locked, { volumeDb: -3 }), false);
    assert.equal(isLockedLayerEffectsChangeAllowed(locked, { trimIn: 0.5 }), false);
  });

  it('allows any change while unlocked', () => {
    const unlocked = createDefaultLayerEffects(5);
    assert.equal(isLockedLayerEffectsChangeAllowed(unlocked, { volumeDb: -3 }), true);
  });
});

describe('pan', () => {
  it('defaults to center and clamps to −1…1', () => {
    const defaults = createDefaultLayerEffects(5);
    assert.equal(defaults.pan, 0);
    assert.equal(clampPan(0.5), 0.5);
    assert.equal(clampPan(-2), -1);
    assert.equal(clampPan(2), 1);
    assert.equal(clampPan(Number.NaN), 0);
  });

  it('normalizes missing pan and reports active when off-center', () => {
    const normalized = normalizeLayerEffects({
      duration: 5,
      effects: { ...createDefaultLayerEffects(5), pan: undefined as unknown as number },
    });
    assert.equal(normalized.pan, 0);
    assert.equal(hasActivePan(normalized), false);
    assert.equal(hasActivePan({ ...normalized, pan: 0.5 }), true);
  });
});
