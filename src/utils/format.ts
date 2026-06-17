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
