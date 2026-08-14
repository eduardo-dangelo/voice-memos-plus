import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDurationWithTenths, formatTimecodeDigits, parseDuration } from './format';

describe('parseDuration', () => {
  it('parses bare seconds and fractional seconds', () => {
    assert.equal(parseDuration('12'), 12);
    assert.equal(parseDuration('12.34'), 12.34);
    assert.equal(parseDuration('0'), 0);
  });

  it('parses mm:ss and mm:ss.cc', () => {
    assert.equal(parseDuration('1:02'), 62);
    assert.equal(parseDuration('01:02.50'), 62.5);
    assert.equal(parseDuration('00:00.00'), 0);
  });

  it('parses h:mm:ss and h:mm:ss.cc', () => {
    assert.equal(parseDuration('1:02:03'), 3723);
    assert.equal(parseDuration('1:02:03.40'), 3723.4);
  });

  it('accepts comma decimals and surrounding whitespace', () => {
    assert.equal(parseDuration('  12,5  '), 12.5);
    assert.equal(parseDuration('1:02,25'), 62.25);
  });

  it('round-trips formatDurationWithTenths', () => {
    assert.equal(parseDuration(formatDurationWithTenths(0)), 0);
    assert.equal(parseDuration(formatDurationWithTenths(62.5)), 62.5);
    assert.equal(parseDuration(formatDurationWithTenths(3661.25)), 3661.25);
  });

  it('returns null for invalid input', () => {
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration('   '), null);
    assert.equal(parseDuration('abc'), null);
    assert.equal(parseDuration('-1'), null);
    assert.equal(parseDuration('1:02:03:04'), null);
    assert.equal(parseDuration('1.5:00'), null);
    assert.equal(parseDuration(':12'), null);
  });
});

describe('formatTimecodeDigits', () => {
  it('inserts colon and dot for six digits', () => {
    assert.equal(formatTimecodeDigits(''), '00:00.00');
    assert.equal(formatTimecodeDigits('5'), '00:00.05');
    assert.equal(formatTimecodeDigits('12345'), '01:23.45');
    assert.equal(formatTimecodeDigits('012345'), '01:23.45');
  });

  it('inserts hours separators for eight digits', () => {
    assert.equal(formatTimecodeDigits('1020340', 8), '01:02:03.40');
    assert.equal(formatTimecodeDigits('', 8), '00:00:00.00');
  });
});
