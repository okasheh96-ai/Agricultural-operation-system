// Time handling. Instants are stored as UTC ISO strings; shift dates are local calendar dates in the farm
// time zone (Asia/Amman by default). A shift date is the local date on which the shift starts, so an
// overnight shift 18:00–04:00 keeps one shift date.
import { normalizeDigits } from './num';

export const DEFAULT_TZ = 'Asia/Amman';

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function localParts(ms: number, tz = DEFAULT_TZ) {
  const p: Record<string, string> = {};
  for (const x of dtf(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    seconds: Number(p.second),
  };
}

function offsetMs(ms: number, tz: string): number {
  const { date, time, seconds } = localParts(ms, tz);
  const asUtc = Date.parse(`${date}T${time}:${String(seconds).padStart(2, '0')}Z`);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Local wall-clock date+time in tz -> UTC epoch ms. */
export function localToUtcMs(date: string, time: string, tz = DEFAULT_TZ): number {
  const guess = Date.parse(`${date}T${time.length === 5 ? time + ':00' : time}Z`);
  if (Number.isNaN(guess)) throw new Error(`bad local time ${date} ${time}`);
  let ms = guess - offsetMs(guess, tz);
  ms = guess - offsetMs(ms, tz);
  return ms;
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function addDays(date: string, n: number): string {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Shift date of an instant, given the shift's local start time (e.g. "18:00" for a night shift). */
export function shiftDateOf(ms: number, shiftStart = '00:00', tz = DEFAULT_TZ): string {
  const { date, time } = localParts(ms, tz);
  return time < shiftStart ? addDays(date, -1) : date;
}

/** A time-of-day on a shift: times before the shift start belong to the next calendar day. */
export function shiftTimeToUtcMs(shiftDate: string, time: string, shiftStart = '00:00', tz = DEFAULT_TZ): number {
  const day = time < shiftStart ? addDays(shiftDate, 1) : shiftDate;
  return localToUtcMs(day, time, tz);
}

export type DateIssue = 'ambiguous_date' | 'unreadable_date';
export interface ParsedDate { date: string | null; time?: string; issue?: DateIssue }

/** Excel serial (1900 system) -> local wall-clock date/time, as written in the sheet. */
export function excelSerialToLocal(serial: number): ParsedDate {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return { date: null, issue: 'unreadable_date' };
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return { date, time: serial % 1 === 0 ? undefined : time };
}

/** Parse a date written as text. dd/mm vs mm/dd ambiguity is flagged, never guessed silently. */
export function parseDateText(input: unknown, preferDayFirst = true): ParsedDate {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { date: null, issue: 'unreadable_date' };
    const iso = input.toISOString();
    const time = iso.slice(11, 16);
    return { date: iso.slice(0, 10), time: time === '00:00' ? undefined : time };
  }
  if (typeof input === 'number') return excelSerialToLocal(input);
  if (input === null || input === undefined) return { date: null };
  const s = normalizeDigits(String(input)).trim();
  if (!s) return { date: null };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (!validDate(date)) return { date: null, issue: 'unreadable_date' };
    return { date, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined };
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const dayFirst = a > 12 ? true : b > 12 ? false : preferDayFirst;
    const ambiguous = a <= 12 && b <= 12 && a !== b;
    const d = dayFirst ? a : b;
    const mo = dayFirst ? b : a;
    const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!validDate(date)) return { date: null, issue: 'unreadable_date' };
    return { date, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined, issue: ambiguous ? 'ambiguous_date' : undefined };
  }
  const n = Number(s);
  if (/^\d+(\.\d+)?$/.test(s) && n > 20000 && n < 80000) return excelSerialToLocal(n);
  return { date: null, issue: 'unreadable_date' };
}

function validDate(date: string): boolean {
  const ms = Date.parse(date + 'T00:00:00Z');
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

/** "6:30", "06:30", "6:30 PM", "١٨:٣٠", Excel day fraction 0.75 -> "HH:MM". */
export function parseTimeText(input: unknown): string | null {
  if (input instanceof Date) return input.toISOString().slice(11, 16);
  if (typeof input === 'number') {
    if (input >= 0 && input < 1) {
      const mins = Math.round(input * 1440);
      return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }
    return null;
  }
  if (input === null || input === undefined) return null;
  const s = normalizeDigits(String(input)).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})[:.٫](\d{2})(?::\d{2})?\s*(am|pm|ص|م)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  if (m[3] === 'pm' || m[3] === 'م') { if (h < 12) h += 12; }
  if ((m[3] === 'am' || m[3] === 'ص') && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
