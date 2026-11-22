// Exact fixed-point quantities. Every stored quantity or amount is an integer number of thousandths
// ("milli"): 4,100 kg -> 4100000, JOD 650.250 -> 650250. Floats are never stored or summed.

export type ParseIssue = 'empty' | 'unreadable' | 'ambiguous_separator' | 'too_many_decimals';
export interface ParsedNumber { milli: number | null; issue?: ParseIssue; normalized?: string }

const DIGIT_MAP: Record<string, string> = {};
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (DIGIT_MAP[d] = String(i)));
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => (DIGIT_MAP[d] = String(i)));

export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
}

/** Parse a human/Excel number into milli units without float error. */
export function parseQuantity(input: unknown): ParsedNumber {
  if (input === null || input === undefined) return { milli: null, issue: 'empty' };
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { milli: null, issue: 'unreadable' };
    // Excel stores binary doubles; round to thousandths via string to avoid 0.1+0.2 artefacts.
    return fromDecimalString(input.toFixed(6));
  }
  let s = normalizeDigits(String(input)).trim();
  if (s === '' || s === '-' ) return { milli: null, issue: 'empty' };
  s = s.replace(/[\s  ]/g, '').replace(/[٬’']/g, ',').replace(/٫/g, '.');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-') || s.startsWith('−')) { neg = true; s = s.slice(1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/^\+/, '');
  let issue: ParseIssue | undefined;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > lastComma) s = s.replace(/,/g, '');
    else s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d+,\d{1,2}$/.test(s)) { s = s.replace(',', '.'); issue = 'ambiguous_separator'; }
    else if (/^\d+,\d+$/.test(s)) { s = s.replace(',', '.'); issue = 'ambiguous_separator'; }
    else return { milli: null, issue: 'unreadable' };
  } else if (hasDot && /^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return { milli: null, issue: 'unreadable' };
  const r = fromDecimalString((neg ? '-' : '') + s);
  if (issue) r.issue = issue;
  return r;
}

function fromDecimalString(s: string): ParsedNumber {
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const [ip, fpRaw = ''] = s.split('.');
  const intPart = ip === '' ? '0' : ip;
  let fp = fpRaw.replace(/0+$/, '');
  let issue: ParseIssue | undefined;
  let carry = 0;
  if (fp.length > 3) {
    issue = 'too_many_decimals';
    carry = Number(fp[3]) >= 5 ? 1 : 0;
    fp = fp.slice(0, 3);
  }
  const milli = Number(intPart) * 1000 + Number((fp + '000').slice(0, 3)) + carry;
  if (!Number.isSafeInteger(milli)) return { milli: null, issue: 'unreadable' };
  const v = neg ? -milli : milli;
  // A float input like 4100.0000001 is not a real "too many decimals" problem; only flag text input.
  return { milli: v === 0 ? 0 : v, issue: issue && fpRaw.length < 6 ? issue : undefined, normalized: formatMilli(v) };
}

export function toMilli(n: number): number {
  const r = parseQuantity(n);
  if (r.milli === null) throw new Error('not a number');
  return r.milli;
}

/** Plain decimal string with up to 3 decimals, no grouping: 4100000 -> "4100". */
export function formatMilli(milli: number): string {
  const neg = milli < 0;
  const a = Math.abs(milli);
  const ip = Math.floor(a / 1000);
  const fp = String(a % 1000).padStart(3, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + ip + (fp ? '.' + fp : '');
}

/** Integer division rounded half away from zero. */
export function divRound(a: number, b: number): number {
  if (b === 0) throw new Error('division by zero');
  const q = a / b;
  return q < 0 ? -Math.round(-q) : Math.round(q);
}

/** a * b / c with integer result, rounding half away from zero. Inputs are integers. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new Error('division by zero');
  const p = BigInt(a) * BigInt(b);
  const C = BigInt(c);
  const neg = (p < 0n) !== (C < 0n);
  const ap = p < 0n ? -p : p;
  const ac = C < 0n ? -C : C;
  let q = ap / ac;
  if ((ap % ac) * 2n >= ac) q += 1n;
  return Number(neg ? -q : q);
}

/** Ratio as a display number (never stored). Returns null for a zero/missing denominator. */
export function ratio(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den === 0) return null;
  return num / den;
}
