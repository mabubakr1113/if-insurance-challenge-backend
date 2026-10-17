import { TZDate } from '@date-fns/tz';

/** The app timezone. Every calendar date and every "18:00" in the rules is in this zone. */
export const TZ = process.env.APP_TIMEZONE || 'Europe/Helsinki';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/** The Helsinki calendar date (YYYY-MM-DD) of an instant. */
export function ymd(at: Date | string | number = new Date()): string {
  const t = new TZDate(new Date(at).getTime(), TZ);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** Today's date in Helsinki. */
export function today(): string {
  return ymd(new Date());
}

/** Calendar arithmetic on YYYY-MM-DD strings (no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

/** The instant of a Helsinki wall-clock time on a Helsinki date, e.g. atHelsinki('2026-10-21', '18:00'). */
export function atHelsinki(date: string, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, TZ).getTime());
}

/** 18:00 Helsinki, `days` after the Helsinki date of `from`. The standard due time for tasks. */
export function dueAfter(from: Date | string, days: number): Date {
  return atHelsinki(addDays(ymd(from), days), '18:00');
}

/** The Helsinki hour (0–23) of an instant. */
export function helsinkiHour(at: Date = new Date()): number {
  return new TZDate(at.getTime(), TZ).getHours();
}

export function iso(at: Date | number): string {
  return new Date(at).toISOString();
}

/* ---------------- formatting for activity and notification text ---------------- */

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });

/** "Tue 21 Oct" for a YYYY-MM-DD date. */
export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return dayFormat.format(new Date(Date.UTC(y, m - 1, d, 12))).replace(',', '');
}

/** "Tue 21 Oct" for an instant, using its Helsinki date. */
export function fmtDay(at: Date | string): string {
  return fmtDate(ymd(at));
}

/** "18:00" in Helsinki. */
export function fmtTime(at: Date | string): string {
  return timeFormat.format(new Date(at));
}

/** "Tue 21 Oct, 09:00–11:00". */
export function fmtSlot(start: Date | string, end: Date | string): string {
  return `${fmtDay(start)}, ${fmtTime(start)}–${fmtTime(end)}`;
}

/** "−18 °C" with a real minus sign. */
export function fmtTemp(c: number): string {
  const rounded = Math.round(c * 10) / 10;
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1);
  return `${rounded < 0 ? '−' : ''}${text} °C`;
}

/** "€69" or "€69.50". */
export function fmtMoney(cents: number): string {
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
