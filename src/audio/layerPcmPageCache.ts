/**
 * Disk-paged PCM for long mono WAV layers (DAW-style working set).
 *
 * Full-file decodeAudioData keeps ~50 MB/layer in RAM. For long stems we page
 * PCM16 windows via readWavMonoSamplesWindow into short AudioBuffers and evict
 * pages far from the playhead.
 *
 * Spike notes (Phase C):
 * - react-native-audio-api exposes AudioBuffer + AudioBufferSourceNode only;
 *   there is no AVAudioFile scheduleSegment API in JS.
 * - Paging through WAV slice + createBuffer is the feasible path without a
 *   native module. Non-WAV / looped native-loop layers still full-decode.
 * - Ideal future: native AVAudioPlayerNode + AVAudioFile for zero-copy paging.
 */

import type { AudioBuffer, AudioContext } from 'react-native-audio-api';

/** Page length in seconds (covers one PLAYBACK_SCHEDULE_CHUNK_SEC + lead). */
export const LAYER_PCM_PAGE_SEC = 16;
/** Keep this many pages per path (before/current/ahead). */
export const LAYER_PCM_MAX_PAGES_PER_PATH = 3;
/** Prefer paging when layer duration exceeds this. */
export const LAYER_PCM_PAGE_MIN_DURATION_SEC = 45;

export type LayerPcmPage = {
  path: string;
  startSec: number;
  durationSec: number;
  buffer: AudioBuffer;
  lastUsedAt: number;
};

export function shouldPageLayerPcm(path: string, durationSec: number): boolean {
  return (
    durationSec >= LAYER_PCM_PAGE_MIN_DURATION_SEC &&
    path.toLowerCase().endsWith('.wav')
  );
}

export function pageStartForOffset(fileOffsetSec: number): number {
  const pageIndex = Math.floor(Math.max(0, fileOffsetSec) / LAYER_PCM_PAGE_SEC);
  return pageIndex * LAYER_PCM_PAGE_SEC;
}

export class LayerPcmPageCache {
  private pages = new Map<string, LayerPcmPage>();
  private useCounter = 0;

  private key(path: string, startSec: number): string {
    return `${path}@${startSec.toFixed(3)}`;
  }

  clear(): void {
    this.pages.clear();
  }

  clearPath(path: string): void {
    for (const key of [...this.pages.keys()]) {
      if (key.startsWith(`${path}@`)) {
        this.pages.delete(key);
      }
    }
  }

  getCached(path: string, startSec: number): LayerPcmPage | null {
    const page = this.pages.get(this.key(path, startSec));
    if (!page) {
      return null;
    }
    page.lastUsedAt = ++this.useCounter;
    return page;
  }

  /** Find a cached page that fully covers [offset, offset+length). */
  findCovering(path: string, offsetSec: number, lengthSec: number): LayerPcmPage | null {
    const end = offsetSec + lengthSec;
    for (const page of this.pages.values()) {
      if (page.path !== path) {
        continue;
      }
      if (offsetSec >= page.startSec - 1e-4 && end <= page.startSec + page.durationSec + 1e-4) {
        page.lastUsedAt = ++this.useCounter;
        return page;
      }
    }
    return null;
  }

  private evictIfNeeded(path: string): void {
    const forPath = [...this.pages.values()].filter((page) => page.path === path);
    if (forPath.length < LAYER_PCM_MAX_PAGES_PER_PATH) {
      return;
    }
    forPath.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const drop = forPath[0];
    if (drop) {
      this.pages.delete(this.key(drop.path, drop.startSec));
    }
  }

  async loadPage(
    context: AudioContext,
    path: string,
    startSec: number
  ): Promise<LayerPcmPage | null> {
    const aligned = pageStartForOffset(startSec);
    const cached = this.getCached(path, aligned);
    if (cached) {
      return cached;
    }

    const { readWavMonoSamplesWindow } = await import('@/src/audio/wavLeadingRead');
    const window = await readWavMonoSamplesWindow(path, {
      startSec: aligned,
      maxSec: LAYER_PCM_PAGE_SEC,
    });
    if (!window || window.samples.length === 0) {
      return null;
    }

    const buffer = context.createBuffer(1, window.samples.length, window.sampleRate);
    const channel =
      window.samples.buffer.byteLength === window.samples.length * 4 &&
      window.samples.byteOffset === 0
        ? window.samples
        : new Float32Array(window.samples);
    buffer.copyToChannel(channel, 0);

    const page: LayerPcmPage = {
      path,
      startSec: aligned,
      durationSec: buffer.duration,
      buffer,
      lastUsedAt: ++this.useCounter,
    };
    this.evictIfNeeded(path);
    this.pages.set(this.key(path, aligned), page);
    return page;
  }

  /** Prefetch page containing fileOffset and the next page. */
  async prefetchAround(
    context: AudioContext,
    path: string,
    fileOffsetSec: number
  ): Promise<void> {
    const start = pageStartForOffset(fileOffsetSec);
    await this.loadPage(context, path, start);
    await this.loadPage(context, path, start + LAYER_PCM_PAGE_SEC);
  }

  stats(): { pageCount: number; approxSeconds: number } {
    let approxSeconds = 0;
    for (const page of this.pages.values()) {
      approxSeconds += page.durationSec;
    }
    return { pageCount: this.pages.size, approxSeconds };
  }
}
