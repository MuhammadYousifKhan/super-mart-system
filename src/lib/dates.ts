// Calendar dates are kept as YYYY-MM-DD strings in the store's local time.
// `new Date().toISOString().slice(0, 10)` is the UTC date, which is the previous day
// for the first hours after midnight in timezones ahead of UTC (e.g. Pakistan, UTC+5).

export type Frequency = 'daily' | 'weekly' | 'monthly';

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayLocal(): string {
  return toLocalISODate(new Date());
}

/** Reads YYYY-MM-DD as a local date (new Date('YYYY-MM-DD') would be UTC midnight). */
export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function addPeriod(value: string, frequency: Frequency): string {
  const date = parseLocalDate(value);
  if (frequency === 'daily') {
    date.setDate(date.getDate() + 1);
  } else if (frequency === 'weekly') {
    date.setDate(date.getDate() + 7);
  } else {
    // Clamp to the end of shorter months instead of overflowing (Jan 31 -> Feb 28, not Mar 3).
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  }
  return toLocalISODate(date);
}

/** True for a real calendar day written as YYYY-MM-DD (rejects '', '2026-02-31', ...). */
export function isValidLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && toLocalISODate(parseLocalDate(value)) === value;
}

/** The timestamp `iso` moved to the calendar day `date` (YYYY-MM-DD), keeping its local time of day. */
export function withLocalDate(iso: string, date: string): string {
  const moment = new Date(iso);
  const day = parseLocalDate(date);
  moment.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
  return moment.toISOString();
}

/** Next due date after `today`, skipping any periods that were missed. */
export function nextDueDate(current: string, frequency: Frequency, today: string = todayLocal()): string {
  let next = addPeriod(current, frequency);
  for (let guard = 0; next <= today && guard < 1000; guard++) {
    next = addPeriod(next, frequency);
  }
  return next;
}
