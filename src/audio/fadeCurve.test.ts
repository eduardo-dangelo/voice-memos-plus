import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { scheduleLayerFades } from '@/src/audio/fadeCurve';

type ScheduledEvent =
  | { kind: 'set'; time: number; value: number }
  | { kind: 'curve'; start: number; end: number };

function createMockParam() {
  let events: ScheduledEvent[] = [];
  const conflicts: string[] = [];

  const assertNoConflict = (time: number, kind: string) => {
    for (const event of events) {
      if (event.kind !== 'curve') {
        continue;
      }
      if (time > event.start && time < event.end) {
        conflicts.push(
          `Cannot schedule ${kind} at time ${time} because it conflicts with an existing curve event from time ${event.start} to ${event.end}.`
        );
      }
    }
  };

  return {
    conflicts,
    get events() {
      return events;
    },
    cancelScheduledValues(time: number) {
      events = events.filter((event) => {
        if (event.kind === 'set') {
          return event.time < time;
        }
        // Matches Web Audio: curve event time is its start; overlapping tails survive.
        return event.start < time;
      });
    },
    cancelAndHoldAtTime(time: number) {
      this.cancelScheduledValues(time);
    },
    setValueAtTime(value: number, time: number) {
      assertNoConflict(time, 'SetValueAtTime');
      if (conflicts.length > 0) {
        throw new Error(conflicts[conflicts.length - 1]);
      }
      events.push({ kind: 'set', time, value });
    },
    setValueCurveAtTime(values: Float32Array, startTime: number, duration: number) {
      assertNoConflict(startTime, 'SetValueCurveAtTime');
      if (conflicts.length > 0) {
        throw new Error(conflicts[conflicts.length - 1]);
      }
      events.push({ kind: 'curve', start: startTime, end: startTime + duration });
      return values;
    },
  };
}

const fadeInOptions = {
  playLength: 10,
  activeOffset: 0,
  activeDuration: 10,
  fadeInSec: 1.5,
  fadeOutSec: 0,
  fadeInCurve: 0,
  fadeOutCurve: 0,
};

describe('scheduleLayerFades', () => {
  it('cancels overlapping prior curves before rescheduling at a later startWhen', () => {
    const param = createMockParam();

    scheduleLayerFades(param, { ...fadeInOptions, startWhen: 218.949 });
    assert.ok(param.events.some((event) => event.kind === 'curve'));

    // Rapid seek/play: new schedule starts while the previous fade-in curve still spans.
    assert.doesNotThrow(() => {
      scheduleLayerFades(param, { ...fadeInOptions, startWhen: 220.098 });
    });
    assert.equal(param.conflicts.length, 0);

    const curves = param.events.filter((event) => event.kind === 'curve');
    assert.equal(curves.length, 1);
    assert.ok(curves[0] && curves[0].kind === 'curve' && curves[0].start === 220.098);
  });

  it('does not place SetValueAtTime inside its own fade-in curve', () => {
    const param = createMockParam();

    assert.doesNotThrow(() => {
      scheduleLayerFades(param, { ...fadeInOptions, startWhen: 100 });
    });
    assert.equal(param.conflicts.length, 0);

    const curve = param.events.find((event) => event.kind === 'curve');
    assert.ok(curve && curve.kind === 'curve');
    const setsInside = param.events.filter(
      (event) => event.kind === 'set' && event.time > curve.start && event.time < curve.end
    );
    assert.equal(setsInside.length, 0);
  });

  it('clears from 0 so cancelScheduledValues(startWhen) alone is not relied on', () => {
    const param = createMockParam();
    // Seed a curve the way a buggy cancel(startWhen) would leave behind.
    param.setValueCurveAtTime(new Float32Array([0, 1]), 218.949, 1.333);

    scheduleLayerFades(param, { ...fadeInOptions, startWhen: 220.098 });
    assert.equal(param.conflicts.length, 0);
    const leftover = param.events.filter(
      (event) => event.kind === 'curve' && event.start === 218.949
    );
    assert.equal(leftover.length, 0);
  });
});
