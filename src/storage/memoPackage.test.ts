import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { strToU8 } from 'fflate';

import {
  PROJECT_FORMAT_ID,
  PROJECT_MANIFEST_PATH,
  PROJECT_MEDIA_PREFIX,
  PROJECT_PACKAGE_META_PATH,
  PROJECT_SCHEMA_VERSION,
  buildExportableManifest,
  buildPackageMeta,
  isProjectFileName,
  remapImportedMemo,
  unzipProjectFiles,
  validateProjectArchive,
  zipProjectFiles,
} from './memoPackageFormat';
import type { Memo } from './types';
import { normalizeLayers } from './types';

function makeMemo(overrides: Partial<Memo> = {}): Memo {
  return {
    id: 'memo-source',
    title: 'Session A',
    titleSource: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    duration: 10,
    trimStart: 0,
    trimEnd: 10,
    loopStart: 1,
    loopEnd: 4,
    loopEnabled: true,
    loopSnapToGrid: false,
    metronome: {
      enabled: true,
      bpm: 120,
      timeSignature: '4/4',
      accentEnabled: true,
      showGrid: true,
      volume: 80,
      gridBasis: 'metronome',
      metronomeGridSubdivision: '1/4',
      timeGridSubdivision: '1s',
    },
    precount: 'sound',
    folderId: 'folder-local',
    deletedAt: 'should-be-stripped',
    layers: [
      {
        id: 'layer-a',
        order: 0,
        fileName: 'layer-0.wav',
        label: 'Track 1',
        color: '#FF0000',
        startTime: 0.5,
        duration: 8,
        loopUntil: 12,
        waveformPeaks: [0.1, 0.2, 0.3],
        effects: {
          trimIn: 0.1,
          trimOut: 7.5,
          volumeDb: -3,
          pan: -0.5,
          fadeInSec: 0.05,
          fadeOutSec: 0.1,
          fadeInCurve: 0,
          fadeOutCurve: 0,
          reverb: { preset: 'room', mix: 0.2, decay: 1.2 },
          delay: {
            preset: 'eighth',
            sync: '1/8',
            timeMs: 250,
            mix: 0.15,
            feedback: 0.2,
          },
          eq: {
            preset: 'custom',
            bands: [0, 1, -1, 0, 2],
            frequencies: [60, 250, 1000, 4000, 8000],
            qFactors: [1, 1, 1, 1, 1],
          },
        },
      },
      {
        id: 'layer-b',
        order: 1,
        fileName: 'layer-1.m4a',
        label: 'Track 2',
        startTime: 2,
        duration: 5,
        effects: {
          trimIn: 0,
          trimOut: 5,
          volumeDb: 0,
          pan: 0,
          muted: true,
          locked: true,
          fadeInSec: 0,
          fadeOutSec: 0,
          fadeInCurve: 0,
          fadeOutCurve: 0,
          reverb: { preset: 'off', mix: 0, decay: 0.5 },
          delay: {
            preset: 'off',
            sync: 'off',
            timeMs: 200,
            mix: 0,
            feedback: 0,
          },
          eq: {
            preset: 'off',
            bands: [0, 0, 0, 0, 0],
            frequencies: [100, 250, 1000, 4000, 10000],
            qFactors: [1, 1, 1, 1, 1],
          },
        },
      },
    ],
    ...overrides,
  };
}

function buildArchiveFiles(memo: Memo = makeMemo()): Record<string, Uint8Array> {
  const exportable = buildExportableManifest(memo);
  const meta = buildPackageMeta({
    exportedAt: '2026-08-01T12:00:00.000Z',
    appVersion: '1.0.0',
  });
  return {
    [PROJECT_PACKAGE_META_PATH]: strToU8(JSON.stringify(meta)),
    [PROJECT_MANIFEST_PATH]: strToU8(JSON.stringify(exportable)),
    [`${PROJECT_MEDIA_PREFIX}layer-0.wav`]: new Uint8Array([1, 2, 3, 4]),
    [`${PROJECT_MEDIA_PREFIX}layer-1.m4a`]: new Uint8Array([5, 6, 7, 8]),
  };
}

describe('isProjectFileName', () => {
  it('accepts .vmp and rejects other extensions', () => {
    assert.equal(isProjectFileName('Session A.vmp'), true);
    assert.equal(isProjectFileName('Session A.VMP'), true);
    assert.equal(isProjectFileName('Session A.zip'), false);
    assert.equal(isProjectFileName('Session A.m4a'), false);
  });
});

describe('buildExportableManifest', () => {
  it('rewrites layer fileNames under media/ and strips folder/trash fields', () => {
    const exported = buildExportableManifest(makeMemo());
    assert.equal(exported.folderId, undefined);
    assert.equal(exported.deletedAt, undefined);
    assert.equal(exported.layers[0]?.fileName, 'media/layer-0.wav');
    assert.equal(exported.layers[1]?.fileName, 'media/layer-1.m4a');
    assert.equal(exported.layers[0]?.effects?.volumeDb, -3);
    assert.equal(exported.layers[0]?.effects?.pan, -0.5);
    assert.equal(exported.metronome?.bpm, 120);
    assert.equal(exported.loopEnabled, true);
    assert.deepEqual(exported.layers[0]?.waveformPeaks, [0.1, 0.2, 0.3]);
  });

  it('includes trackAccordionEnabled when enabled on the memo', () => {
    const exported = buildExportableManifest(
      makeMemo({ trackAccordionEnabled: true, accordionAutoEnablePromptSeen: true })
    );
    assert.equal(exported.trackAccordionEnabled, true);
    assert.equal(exported.accordionAutoEnablePromptSeen, true);
  });

  it('omits trackAccordionEnabled when disabled on the memo', () => {
    const exported = buildExportableManifest(makeMemo({ trackAccordionEnabled: false }));
    assert.equal(exported.trackAccordionEnabled, undefined);
  });
});

describe('zip/unzip project files', () => {
  it('round-trips archive contents', () => {
    const files = buildArchiveFiles();
    const zipped = zipProjectFiles(files);
    const unzipped = unzipProjectFiles(zipped);
    assert.ok(unzipped[PROJECT_PACKAGE_META_PATH]);
    assert.ok(unzipped[PROJECT_MANIFEST_PATH]);
    assert.deepEqual(
      Array.from(unzipped[`${PROJECT_MEDIA_PREFIX}layer-0.wav`] ?? []),
      [1, 2, 3, 4]
    );
  });
});

describe('validateProjectArchive', () => {
  it('accepts a complete archive and exposes media by basename', () => {
    const validated = validateProjectArchive(buildArchiveFiles());
    assert.equal(validated.meta.format, PROJECT_FORMAT_ID);
    assert.equal(validated.meta.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.equal(validated.manifest.layers.length, 2);
    assert.equal(validated.media.size, 2);
    assert.deepEqual(Array.from(validated.media.get('layer-0.wav') ?? []), [1, 2, 3, 4]);
  });

  it('rejects a missing format marker', () => {
    const files = buildArchiveFiles();
    files[PROJECT_PACKAGE_META_PATH] = strToU8(
      JSON.stringify({
        format: 'other',
        schemaVersion: 1,
        exportedAt: '2026-08-01T12:00:00.000Z',
      })
    );
    assert.throws(() => validateProjectArchive(files), /not a Voice Memos Plus project/);
  });

  it('rejects a future schemaVersion', () => {
    const files = buildArchiveFiles();
    files[PROJECT_PACKAGE_META_PATH] = strToU8(
      JSON.stringify({
        format: PROJECT_FORMAT_ID,
        schemaVersion: PROJECT_SCHEMA_VERSION + 1,
        exportedAt: '2026-08-01T12:00:00.000Z',
      })
    );
    assert.throws(() => validateProjectArchive(files), /newer app/);
  });

  it('rejects missing media for a recorded layer', () => {
    const files = buildArchiveFiles();
    delete files[`${PROJECT_MEDIA_PREFIX}layer-1.m4a`];
    assert.throws(() => validateProjectArchive(files), /missing media/);
  });
});

describe('remapImportedMemo', () => {
  it('assigns new ids, local fileNames, and preserves editable state', () => {
    const packaged = buildExportableManifest(makeMemo());
    const remapped = remapImportedMemo(packaged, {
      newMemoId: 'memo-imported',
      folderId: 'folder-target',
      now: '2026-08-01T15:00:00.000Z',
    });

    assert.equal(remapped.id, 'memo-imported');
    assert.equal(remapped.folderId, 'folder-target');
    assert.equal(remapped.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(remapped.updatedAt, '2026-08-01T15:00:00.000Z');
    assert.equal(remapped.title, 'Session A');
    assert.notEqual(remapped.layers[0]?.id, 'layer-a');
    assert.notEqual(remapped.layers[1]?.id, 'layer-b');
    assert.equal(remapped.layers[0]?.fileName, 'layer-0.wav');
    assert.equal(remapped.layers[1]?.fileName, 'layer-1.m4a');
    assert.equal(remapped.layers[0]?.startTime, 0.5);
    assert.equal(remapped.layers[0]?.effects?.volumeDb, -3);
    assert.equal(remapped.layers[0]?.loopUntil, 12);
    assert.equal(remapped.metronome?.bpm, 120);
    assert.equal(remapped.loopStart, 1);
    assert.equal(remapped.loopEnd, 4);
    assert.equal(remapped.precount, 'sound');

    const normalized = normalizeLayers({
      ...remapped,
      layers: remapped.layers.map((layer) => ({ ...layer })),
    });
    assert.equal(normalized.layers.length, 2);
  });

  it('preserves trackAccordionEnabled on import', () => {
    const remapped = remapImportedMemo(
      buildExportableManifest(makeMemo({ trackAccordionEnabled: true })),
      { newMemoId: 'memo-accordion', now: '2026-08-01T15:00:00.000Z' }
    );
    assert.equal(remapped.trackAccordionEnabled, true);
  });
});

describe('pack → validate round-trip', () => {
  it('preserves layer count, effects, startTimes, and metronome/loop', () => {
    const memo = makeMemo();
    const zipped = zipProjectFiles(buildArchiveFiles(memo));
    const validated = validateProjectArchive(unzipProjectFiles(zipped));
    const remapped = remapImportedMemo(validated.manifest, {
      newMemoId: 'round-trip',
      now: '2026-08-01T16:00:00.000Z',
    });

    assert.equal(remapped.layers.length, 2);
    assert.equal(remapped.layers[0]?.startTime, 0.5);
    assert.equal(remapped.layers[1]?.startTime, 2);
    assert.equal(remapped.layers[0]?.effects?.reverb?.preset, 'room');
    assert.equal(remapped.layers[1]?.effects?.muted, true);
    assert.equal(remapped.layers[1]?.effects?.locked, true);
    assert.equal(remapped.metronome?.enabled, true);
    assert.equal(remapped.loopEnabled, true);
    assert.equal(remapped.loopSnapToGrid, false);
  });
});
