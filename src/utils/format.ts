export function formatMarkerTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function formatDurationWithTenths(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00.00';
  }
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const centis = Math.min(99, Math.floor((total % 1) * 100));
  const fractional = `${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${fractional}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${fractional}`;
}

const DURATION_PART = /^\d+(\.\d+)?$/;

/** Parses a typed timecode (`mm:ss.cc`, `h:mm:ss`, or bare seconds). Returns null if invalid. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '.');
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(':');
  if (parts.length < 1 || parts.length > 3) {
    return null;
  }
  const nums: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!DURATION_PART.test(part)) {
      return null;
    }
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    if (index < parts.length - 1 && !Number.isInteger(value)) {
      return null;
    }
    nums.push(value);
  }
  if (parts.length === 1) {
    return nums[0];
  }
  if (parts.length === 2) {
    return nums[0] * 60 + nums[1];
  }
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

export const MAX_TIMECODE_DIGITS = 8;
export const MIN_TIMECODE_DIGITS = 6;

export function digitsFromTimecode(input: string, maxDigits = MIN_TIMECODE_DIGITS): string {
  return input.replace(/\D/g, '').slice(-maxDigits);
}

/** Formats a digit buffer as `mm:ss.cc` (6) or `hh:mm:ss.cc` (8). */
export function formatTimecodeDigits(digits: string, maxDigits = MIN_TIMECODE_DIGITS): string {
  const width = maxDigits > MIN_TIMECODE_DIGITS ? MAX_TIMECODE_DIGITS : MIN_TIMECODE_DIGITS;
  const padded = digitsFromTimecode(digits, width).padStart(width, '0');
  if (width === MAX_TIMECODE_DIGITS) {
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}.${padded.slice(6)}`;
  }
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}.${padded.slice(4)}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function createDefaultTitle(): string {
  const now = new Date();
  return `New Recording ${now.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

/** Sanitizes a memo title for use as a share/export filename (no extension). */
export function sanitizeExportFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 120)
    .trim();
  return cleaned.length > 0 ? cleaned : 'Recording';
}

