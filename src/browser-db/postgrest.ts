/**
 * In-browser demo only. Answers the Supabase client's PostgREST calls (/rest/v1) from the demo database in this browser,
 * the way PostgREST does on the server: every request runs in its own transaction as the `authenticated` (or `anon`)
 * role with the caller's JWT claims, so row-level security, grants, triggers and the transition engine decide exactly
 * as they do on the server. It translates the request; it never decides anything itself.
 * Supported: select with embedded relations (via foreign keys, `!inner`, hints), filters eq/neq/gt/gte/lt/lte/like/ilike/
 * is/in with `not.`, `or`/`and` groups, order, limit/offset/Range, exact counts, single-object responses, insert, update,
 * delete and RPC calls with named arguments. Anything else is refused with an error rather than guessed.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';

export class RestError extends Error {
  constructor(public status: number, public code: string, message: string, public details: string | null = null, public hint: string | null = null) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Parsing (pure)

export type SelectItem =
  | { kind: 'star' }
  | { kind: 'column'; name: string; alias: string; cast: string | null }
  | { kind: 'embed'; relation: string; alias: string; hint: string | null; inner: boolean; items: SelectItem[] };

export type Cond =
  | { kind: 'leaf'; column: string; op: string; negate: boolean; value: string }
  | { kind: 'group'; op: 'and' | 'or'; negate: boolean; items: Cond[] };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_ ]*(\[\])?$/;

export function ident(name: string): string {
  if (!IDENT.test(name)) throw new RestError(400, 'PGRST100', `"${name}" is not a valid name`);
  return `"${name}"`;
}

/** Splits on `sep` at nesting depth 0 and outside double quotes. */
export function splitTop(s: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '"' && s.charAt(i - 1) !== '\\') quoted = !quoted;
    else if (!quoted && ch === '(') depth++;
    else if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === sep) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

export function unquote(v: string): string {
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v;
}

export function parseSelect(select: string): SelectItem[] {
  const s = select.replace(/\s+/g, '');
  return s === '' ? [{ kind: 'star' }] : splitTop(s).map(parseSelectItem);
}

function parseSelectItem(raw: string): SelectItem {
  if (raw === '*') return { kind: 'star' };
  const paren = raw.indexOf('(');
  if (paren >= 0) {
    if (!raw.endsWith(')')) throw new RestError(400, 'PGRST100', `Cannot read the select item "${raw}"`);
    let head = raw.slice(0, paren);
    const inside = raw.slice(paren + 1, -1);
    let alias: string | null = null;
    const colon = head.indexOf(':');
    if (colon >= 0) {
      alias = head.slice(0, colon);
      head = head.slice(colon + 1);
    }
    const [relation = '', ...marks] = head.split('!');
    return {
      kind: 'embed', relation, alias: alias ?? relation, inner: marks.includes('inner'),
      hint: marks.find((m) => m !== 'inner' && m !== 'left') ?? null,
      items: inside === '' ? [{ kind: 'star' }] : splitTop(inside).map(parseSelectItem),
    };
  }
  let name = raw;
  let alias: string | null = null;
  let cast: string | null = null;
  const colon = name.indexOf(':');
  if (colon >= 0 && name.charAt(colon + 1) !== ':') {
    alias = name.slice(0, colon);
    name = name.slice(colon + 1);
  }
  const castAt = name.indexOf('::');
  if (castAt >= 0) {
    cast = name.slice(castAt + 2);
    name = name.slice(0, castAt);
  }
  return { kind: 'column', name, alias: alias ?? name, cast };
}

function parseOp(raw: string): { op: string; negate: boolean; value: string } {
  let rest = raw;
  let negate = false;
  if (rest.startsWith('not.')) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  if (dot < 0) throw new RestError(400, 'PGRST100', `Cannot read the filter "${raw}"`);
  return { op: rest.slice(0, dot), negate, value: rest.slice(dot + 1) };
}

/** A filter from the query string: `column=op.value`. */
export function parseParamFilter(column: string, raw: string): Cond {
  return { kind: 'leaf', column, ...parseOp(raw) };
}

/** A logic group: `or=(a.eq.1,and(b.gt.2,c.is.null))`. */
export function parseLogic(op: 'and' | 'or', raw: string, negate = false): Cond {
  if (!raw.startsWith('(') || !raw.endsWith(')')) throw new RestError(400, 'PGRST100', `Cannot read the ${op} filter "${raw}"`);
  return { kind: 'group', op, negate, items: splitTop(raw.slice(1, -1)).map(parseLogicItem) };
}

function parseLogicItem(item: string): Cond {
  const group = /^(not\.)?(and|or)\(/.exec(item);
  if (group) return parseLogic(group[2] as 'and' | 'or', item.slice(group[0].length - 1), !!group[1]);
  const dot = item.indexOf('.');
  if (dot < 0) throw new RestError(400, 'PGRST100', `Cannot read the filter "${item}"`);
  return { kind: 'leaf', column: item.slice(0, dot), ...parseOp(item.slice(dot + 1)) };
}

export function parseList(value: string): string[] {
  if (!value.startsWith('(') || !value.endsWith(')')) throw new RestError(400, 'PGRST100', `Cannot read the list "${value}"`);
  const inside = value.slice(1, -1);
  return inside === '' ? [] : splitTop(inside).map(unquote);
}

// ---------------------------------------------------------------------------------------------
// SQL building

export class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

const COMPARE: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

export function condSql(c: Cond, alias: string, p: Params): string {
  if (c.kind === 'group') {
    const parts = c.items.map((i) => `(${condSql(i, alias, p)})`);
    const body = parts.length > 0 ? parts.join(c.op === 'and' ? ' and ' : ' or ') : c.op === 'and' ? 'true' : 'false';
    return c.negate ? `not (${body})` : body;
  }
  const col = `${alias}.${ident(c.column)}`;
  const v = unquote(c.value);
  let sql: string;
  const cmp = COMPARE[c.op];
  if (cmp) sql = `${col} ${cmp} ${p.add(v)}`;
  else if (c.op === 'like' || c.op === 'ilike') sql = `${col}::text ${c.op} ${p.add(v.replace(/\*/g, '%'))}`;
  else if (c.op === 'is') {
    const k = v.toLowerCase();
    if (!['null', 'true', 'false', 'unknown'].includes(k)) throw new RestError(400, 'PGRST100', `"is" takes null, true, false or unknown, not "${v}"`);
    sql = `${col} is ${k}`;
  } else if (c.op === 'in') {
    const items = parseList(c.value);
    sql = items.length > 0 ? `${col} in (${items.map((i) => p.add(i)).join(', ')})` : 'false';
  } else {
    throw new RestError(400, 'PGRST100', `The filter operator "${c.op}" is not supported by the in-browser demo`);
  }
  return c.negate ? `not (${sql})` : sql;
}

export function orderSql(raw: string, alias: string): string {
  return splitTop(raw).map((term) => {
    const [col = '', ...mods] = term.split('.');
    let s = `${alias}.${ident(col)} ${mods.includes('desc') ? 'desc' : 'asc'}`;
    if (mods.includes('nullsfirst')) s += ' nulls first';
    if (mods.includes('nullslast')) s += ' nulls last';
    return s;
  }).join(', ');
}

/** Filters from the query string (everything except the reserved parameters). */
export function filtersFrom(search: URLSearchParams): Cond[] {
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);
  const out: Cond[] = [];
  for (const [key, value] of search) {
    if (reserved.has(key)) continue;
    if (key === 'or' || key === 'and') out.push(parseLogic(key, value));
    else if (key === 'not.or' || key === 'not.and') out.push(parseLogic(key.slice(4) as 'and' | 'or', value, true));
    else if (key.includes('.')) throw new RestError(400, 'PGRST100', `Filters on embedded resources ("${key}") are not supported by the in-browser demo`);
    else out.push(parseParamFilter(key, value));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Schema metadata (read once; the demo's schema does not change while it runs)

interface ForeignKey { name: string; table: string; ftable: string; cols: string[]; fcols: string[] }
interface FnArg { name: string; type: string; hasDefault: boolean }
interface FnDef { args: FnArg[]; returnsSet: boolean; returnType: string; composite: boolean }
export interface SchemaMeta { relations: Set<string>; fks: ForeignKey[]; functions: Map<string, FnDef[]> }

type Queryable = Pick<PGlite, 'query'> | Pick<Transaction, 'query'>;

export async function loadMeta(db: Queryable): Promise<SchemaMeta> {
  const rels = await db.query<{ relname: string }>(
    `select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')`);
  const fks = await db.query<ForeignKey>(`
    select c.conname as name, t.relname as "table", ft.relname as ftable,
           array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as cols,
           array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as fcols
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_class ft on ft.oid = c.confrelid
     where c.contype = 'f' and t.relnamespace = 'public'::regnamespace and ft.relnamespace = 'public'::regnamespace`);
  const fns = await db.query<{ proname: string; argnames: string[] | null; argmodes: string[] | null; argtypes: string[];
    nargs: number; ndefaults: number; retset: boolean; rettype: string; composite: boolean }>(`
    select p.proname, p.proargnames as argnames, p.proargmodes::text[] as argmodes,
           array(select format_type(t, null) from unnest(p.proargtypes) with ordinality u(t, i) order by u.i) as argtypes,
           p.pronargs as nargs, p.pronargdefaults as ndefaults, p.proretset as retset,
           format_type(p.prorettype, null) as rettype, (select typtype = 'c' from pg_type where oid = p.prorettype) as composite
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`);
  const functions = new Map<string, FnDef[]>();
  for (const f of fns.rows) {
    const names = f.argnames ?? [];
    const modes = f.argmodes ?? names.map(() => 'i');
    const inNames = names.filter((_, i) => ['i', 'b', 'v'].includes(modes[i] ?? 'i'));
    const args = f.argtypes.map((type, i) => ({ name: inNames[i] ?? '', type, hasDefault: i >= f.nargs - f.ndefaults }));
    const list = functions.get(f.proname) ?? [];
    list.push({ args, returnsSet: f.retset, returnType: f.rettype, composite: !!f.composite });
    functions.set(f.proname, list);
  }
  return { relations: new Set(rels.rows.map((r) => r.relname)), fks: fks.rows, functions };
}

function relation(meta: SchemaMeta, name: string): string {
  if (!meta.relations.has(name)) throw new RestError(404, 'PGRST205', `Could not find the table 'public.${name}' in the schema cache`);
  return `public.${ident(name)}`;
}

function resolveEmbed(meta: SchemaMeta, parent: string, e: Extract<SelectItem, { kind: 'embed' }>) {
  relation(meta, e.relation);
  const matches = (f: ForeignKey) => !e.hint || f.name === e.hint || f.cols[0] === e.hint;
  const toOne = meta.fks.filter((f) => f.table === parent && f.ftable === e.relation && matches(f));
  const toMany = meta.fks.filter((f) => f.table === e.relation && f.ftable === parent && matches(f));
  const one = toOne.length > 1 ? toOne.find((f) => f.cols.length === 1) : toOne[0];
  if (one) return { many: false, on: (outer: string, inner: string) => one.cols.map((c, i) => `${outer}.${ident(c)} = ${inner}.${ident(one.fcols[i] ?? '')}`).join(' and ') };
  const many = toMany.length > 1 ? toMany.find((f) => f.cols.length === 1) : toMany[0];
  if (many) return { many: true, on: (outer: string, inner: string) => many.cols.map((c, i) => `${inner}.${ident(c)} = ${outer}.${ident(many.fcols[i] ?? '')}`).join(' and ') };
  throw new RestError(400, 'PGRST200', `Could not find a relationship between '${parent}' and '${e.relation}' in the schema cache`);
}

/** jsonb expression for one row of `rel` (aliased `alias`), plus the `!inner` conditions it adds to that row's WHERE. */
export function objectSql(meta: SchemaMeta, rel: string, alias: string, items: SelectItem[], counter = { n: 0 }): { sql: string; inner: string[] } {
  const pairs: string[] = [];
  const inner: string[] = [];
  let star = false;
  for (const it of items) {
    if (it.kind === 'star') {
      star = true;
    } else if (it.kind === 'column') {
      ident(it.alias);
      const ref = `${alias}.${ident(it.name)}`;
      if (it.cast && !TYPE_NAME.test(it.cast)) throw new RestError(400, 'PGRST100', `Cannot cast to "${it.cast}"`);
      pairs.push(`'${it.alias}', ${it.cast ? `${ref}::${it.cast}` : ref}`);
    } else {
      ident(it.alias);
      const sub = `e${++counter.n}`;
      const r = resolveEmbed(meta, rel, it);
      const child = objectSql(meta, it.relation, sub, it.items, counter);
      const where = [r.on(alias, sub), ...child.inner].join(' and ');
      const from = `${relation(meta, it.relation)} ${sub}`;
      pairs.push(`'${it.alias}', ${r.many
        ? `(select coalesce(jsonb_agg(${child.sql}), '[]'::jsonb) from ${from} where ${where})`
        : `(select ${child.sql} from ${from} where ${where} limit 1)`}`);
      if (it.inner) inner.push(`exists (select 1 from ${from} where ${where})`);
    }
  }
  const chunks: string[] = [];
  for (let i = 0; i < pairs.length; i += 40) chunks.push(`jsonb_build_object(${pairs.slice(i, i + 40).join(', ')})`);
  if (star) chunks.unshift(`to_jsonb(${alias})`);
  return { sql: chunks.length > 0 ? chunks.join(' || ') : `'{}'::jsonb`, inner };
}

// ---------------------------------------------------------------------------------------------
// Requests

export interface RestRequest {
  method: string;
  path: string;
  search: URLSearchParams;
  headers: Headers;
  body: unknown;
  role: 'anon' | 'authenticated';
  claims: Record<string, unknown>;
}

export interface RestResult { status: number; body?: unknown; headers?: Record<string, string> }

function prefers(headers: Headers, token: string): boolean {
  return (headers.get('prefer') ?? '').split(',').some((p) => p.trim() === token);
}

function wantsObject(headers: Headers): boolean {
  return (headers.get('accept') ?? '').includes('application/vnd.pgrst.object+json');
}

function shape(rows: unknown[], headers: Headers, status: number, extra: Record<string, string> = {}): RestResult {
  if (wantsObject(headers)) {
    if (rows.length !== 1) {
      throw new RestError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${rows.length} rows`);
    }
    return { status, body: rows[0], headers: extra };
  }
  return { status, body: rows, headers: extra };
}

function pageOf(req: RestRequest): { limit: number | null; offset: number } {
  const int = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : null);
  let limit = int(req.search.get('limit'));
  let offset = int(req.search.get('offset')) ?? 0;
  const range = /^(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range) {
    offset = Number(range[1]);
    if (range[2]) limit = Number(range[2]) - offset + 1;
  }
  return { limit, offset };
}

async function read(tx: Transaction, meta: SchemaMeta, rel: string, req: RestRequest): Promise<RestResult> {
  const p = new Params();
  const obj = objectSql(meta, rel, 't0', parseSelect(req.search.get('select') ?? '*'));
  const where = [...filtersFrom(req.search).map((c) => condSql(c, 't0', p)), ...obj.inner];
  const from = `${relation(meta, rel)} t0${where.length > 0 ? ` where ${where.map((w) => `(${w})`).join(' and ')}` : ''}`;
  const order = req.search.get('order');
  const { limit, offset } = pageOf(req);
  const sql = `select ${obj.sql} as obj from ${from}${order ? ` order by ${orderSql(order, 't0')}` : ''}${limit !== null ? ` limit ${limit}` : ''}${offset ? ` offset ${offset}` : ''}`;
  const rows = req.method === 'HEAD' ? [] : (await tx.query<{ obj: unknown }>(sql, p.values)).rows.map((r) => r.obj);
  let total = '*';
  if (/count=(exact|planned|estimated)/.test(req.headers.get('prefer') ?? '')) {
    total = String((await tx.query<{ n: number }>(`select count(*)::int as n from ${from}`, p.values)).rows[0]?.n ?? 0);
  }
  const range = rows.length > 0 ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`;
  if (req.method === 'HEAD') return { status: 200, headers: { 'content-range': range } };
  return shape(rows, req.headers, 200, { 'content-range': range });
}

function columnsOf(req: RestRequest, rows: Record<string, unknown>[]): string[] {
  const listed = req.search.get('columns');
  const cols = listed ? listed.split(',').map(unquote) : [...new Set(rows.flatMap((r) => Object.keys(r)))];
  cols.forEach(ident);
  return cols;
}

async function write(tx: Transaction, meta: SchemaMeta, rel: string, req: RestRequest): Promise<RestResult> {
  const table = relation(meta, rel);
  const p = new Params();
  const returning = prefers(req.headers, 'return=representation');
  const obj = objectSql(meta, rel, 't0', parseSelect(req.search.get('select') ?? '*'));
  let cte: string;
  if (req.method === 'POST') {
    if (req.search.has('on_conflict') || /resolution=/.test(req.headers.get('prefer') ?? '')) {
      throw new RestError(400, 'PGRST100', 'Upserts are not supported by the in-browser demo');
    }
    const rows = (Array.isArray(req.body) ? req.body : [req.body]) as Record<string, unknown>[];
    const cols = columnsOf(req, rows).map(ident).join(', ');
    cte = `insert into ${table} (${cols}) select ${cols} from jsonb_populate_recordset(null::${table}, ${p.add(JSON.stringify(rows))}::jsonb) returning *`;
  } else {
    const where = filtersFrom(req.search).map((c) => `(${condSql(c, 't0', p)})`);
    const cond = where.length > 0 ? ` where ${where.join(' and ')}` : '';
    if (req.method === 'PATCH') {
      const values = (req.body ?? {}) as Record<string, unknown>;
      const cols = columnsOf(req, [values]).map(ident).join(', ');
      cte = `update ${table} t0 set (${cols}) = (select ${cols} from jsonb_populate_record(null::${table}, ${p.add(JSON.stringify(values))}::jsonb))${cond} returning t0.*`;
    } else {
      cte = `delete from ${table} t0${cond} returning t0.*`;
    }
  }
  const rows = (await tx.query<{ obj: unknown }>(`with w as (${cte}) select ${obj.sql} as obj from w t0`, p.values)).rows.map((r) => r.obj);
  const created = req.method === 'POST' ? 201 : 200;
  if (!returning) return { status: req.method === 'POST' ? 201 : 204 };
  return shape(rows, req.headers, created);
}

async function rpc(tx: Transaction, meta: SchemaMeta, name: string, req: RestRequest): Promise<RestResult> {
  const args = (req.method === 'GET' ? Object.fromEntries(req.search) : req.body ?? {}) as Record<string, unknown>;
  const keys = Object.keys(args);
  const fn = (meta.functions.get(name) ?? []).find((f) =>
    keys.every((k) => f.args.some((a) => a.name === k)) && f.args.every((a) => a.hasDefault || keys.includes(a.name)));
  if (!fn) throw new RestError(404, 'PGRST202', `Could not find the function public.${name}(${keys.join(', ')}) in the schema cache`);
  const p = new Params();
  const call = `public.${ident(name)}(${keys.map((k) => `${ident(k)} := r.${ident(k)}`).join(', ')})`;
  const record = keys.length > 0
    ? `jsonb_to_record(${p.add(JSON.stringify(args))}::jsonb) as r(${keys.map((k) => `${ident(k)} ${fn.args.find((a) => a.name === k)?.type ?? 'text'}`).join(', ')})`
    : null;
  const from = (lateral: string) => (record ? ` from ${record}, lateral ${lateral}` : ` from ${lateral}`);
  if (fn.returnsSet) {
    const res = await tx.query<{ v: unknown }>(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as v${from(`${call} x`)}`, p.values);
    return { status: 200, body: res.rows[0]?.v ?? [] };
  }
  if (fn.returnType === 'void') {
    await tx.query(`select ${call}${record ? ` from ${record}` : ''}`, p.values);
    return { status: 204 };
  }
  const sql = fn.composite ? `select to_jsonb(x) as v${from(`${call} x`)}` : `select to_jsonb(${call}) as v${record ? ` from ${record}` : ''}`;
  const res = await tx.query<{ v: unknown }>(sql, p.values);
  return { status: 200, body: res.rows[0]?.v ?? null };
}

function asRestError(e: unknown, role: string): RestError {
  if (e instanceof RestError) return e;
  const pg = e as { code?: string; message?: string; detail?: string; hint?: string };
  const code = pg.code ?? 'XX000';
  const status = code === '42501' ? (role === 'anon' ? 401 : 403) : code.startsWith('23') ? 409 : code.startsWith('P0') || code.startsWith('22') || code.startsWith('42') ? 400 : 500;
  return new RestError(status, code, pg.message ?? String(e), pg.detail ?? null, pg.hint ?? null);
}

/** One PostgREST request, in one transaction, as the caller's role. */
export async function handleRest(db: PGlite, meta: SchemaMeta, req: RestRequest): Promise<RestResult> {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('request.method', $3, true)`,
        [req.role, JSON.stringify(req.claims), req.method]);
      if (req.path.startsWith('rpc/')) return rpc(tx, meta, req.path.slice(4), req);
      if (req.method === 'GET' || req.method === 'HEAD') return read(tx, meta, req.path, req);
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) return write(tx, meta, req.path, req);
      throw new RestError(405, 'PGRST117', `Method ${req.method} is not supported`);
    });
  } catch (e) {
    const err = asRestError(e, req.role);
    return { status: err.status, body: { code: err.code, message: err.message, details: err.details, hint: err.hint } };
  }
}
