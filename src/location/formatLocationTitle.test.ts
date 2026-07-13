import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deduplicateTitle,
  formatLocationTitle,
  type LocationAddress,
} from './formatLocationTitle';

describe('formatLocationTitle', () => {
  it('prefers POI name over street', () => {
    const address: LocationAddress = {
      name: 'Central Park',
      street: '5th Ave',
      city: 'New York',
    };
    assert.equal(formatLocationTitle(address), 'Central Park');
  });

  it('formats street with number when name is missing', () => {
    const address: LocationAddress = {
      streetNumber: '123',
      street: 'Main St',
      city: 'Springfield',
    };
    assert.equal(formatLocationTitle(address), '123 Main St');
  });

  it('falls back through district, subregion, and city', () => {
    assert.equal(formatLocationTitle({ district: 'SoHo' }), 'SoHo');
    assert.equal(formatLocationTitle({ subregion: 'Manhattan' }), 'Manhattan');
    assert.equal(formatLocationTitle({ city: 'Boston' }), 'Boston');
  });

  it('returns null when no usable fields exist', () => {
    assert.equal(formatLocationTitle({}), null);
    assert.equal(formatLocationTitle(null), null);
  });

  it('ignores blank strings', () => {
    assert.equal(formatLocationTitle({ name: '  ', street: 'Oak Ave' }), 'Oak Ave');
  });
});

describe('deduplicateTitle', () => {
  it('returns the base title when unused', () => {
    assert.equal(deduplicateTitle('Home', ['Office']), 'Home');
  });

  it('adds numeric suffix for duplicate titles', () => {
    assert.equal(deduplicateTitle('Home', ['Home']), 'Home 2');
    assert.equal(deduplicateTitle('Home', ['Home', 'Home 2']), 'Home 3');
  });

  it('matches duplicates case-insensitively', () => {
    assert.equal(deduplicateTitle('home', ['HOME']), 'home 2');
  });
});
