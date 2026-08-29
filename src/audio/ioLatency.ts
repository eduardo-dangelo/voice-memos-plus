/** Hardware-reported I/O latency in seconds (Logic-style overdub placement). */
export type ResolvedIoLatency = {
  inputLatencySec: number;
  outputLatencySec: number;
  /** True when at least one of input/output came from the device, not zeros. */
  measured: boolean;
};

export type IoLatencyReadings = {
  /** AudioContext.outputLatency when the library exposes it (0.13+). */
  contextOutputLatency?: number;
  /** AudioContext.baseLatency — used only when outputLatency is missing. */
  contextBaseLatency?: number;
  /** AudioRecorder.inputLatency when the library exposes it (0.13+). */
  recorderInputLatency?: number;
  /** AVAudioSession.inputLatency (built-in mic after pin). */
  sessionInputLatency?: number;
  /** AVAudioSession.outputLatency (current output route). */
  sessionOutputLatency?: number;
};

/** Reject 0, NaN, and implausible multi-second values. */
export function isUsableLatencySec(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0.001 &&
    value < 1
  );
}

function pickLatency(...candidates: Array<number | undefined>): number {
  for (const candidate of candidates) {
    if (isUsableLatencySec(candidate)) {
      return candidate;
    }
  }
  return 0;
}

/** Read a numeric host property (e.g. context.outputLatency) if present. */
export function readOptionalNumberProp(
  source: object | null | undefined,
  key: string
): number | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Prefer audio-api host figures, then AVAudioSession. Do not add baseLatency
 * on top of outputLatency (that would double-count the output buffer).
 */
export function resolveIoLatencySeconds(
  readings: IoLatencyReadings
): ResolvedIoLatency {
  const outputLatencySec = pickLatency(
    readings.contextOutputLatency,
    readings.sessionOutputLatency,
    readings.contextBaseLatency
  );
  const inputLatencySec = pickLatency(
    readings.recorderInputLatency,
    readings.sessionInputLatency
  );
  return {
    inputLatencySec,
    outputLatencySec,
    measured: inputLatencySec > 0 || outputLatencySec > 0,
  };
}
