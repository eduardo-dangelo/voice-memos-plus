import { getAvAudioSessionIoLatency } from 'audio-session-latency';

import {
  readOptionalNumberProp,
  resolveIoLatencySeconds,
  type ResolvedIoLatency,
} from '@/src/audio/ioLatency';

/** Snapshot I/O latency from audio-api host props, then AVAudioSession. */
export function readRecordingIoLatency(
  context: object | null,
  recorder: object | null
): ResolvedIoLatency {
  const session = getAvAudioSessionIoLatency();
  return resolveIoLatencySeconds({
    contextOutputLatency: readOptionalNumberProp(context, 'outputLatency'),
    contextBaseLatency: readOptionalNumberProp(context, 'baseLatency'),
    recorderInputLatency: readOptionalNumberProp(recorder, 'inputLatency'),
    sessionInputLatency: session?.inputLatency,
    sessionOutputLatency: session?.outputLatency,
  });
}
