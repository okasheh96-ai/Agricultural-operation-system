import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { localName, newRequestId, opsErrorMessage, rpc, useInvalidateOps, useLines, useMyPermissions } from '../api';
import { btn, btnPrimary, Card, EmptyState, field, PageTitle, Pill, SaveStatus, useFmt, type SaveState, type Tone, Tabs } from '../ui';

interface Account { user_id: string; username: string; full_name: string; email: string | null; status: 'active' | 'suspended' | 'archived';
  must_change_password: boolean; last_sign_in_at: string | null; roles: { code: string; line_id: string | null; line_code: string | null }[];
  active_sessions: number; locked: boolean; manageable: boolean }
interface RoleRow { spec_code: string; is_custom: boolean; evidence: string; roles: { name_ar: string; name_en: string | null } | null }
interface ActionRow { action_key: string; label_en: string; label_ar: string; category: string | null; scope_kind: string; owner_roles: string[] }
interface CellRow { id: string; action_key: string; spec_code: string; evidence: string; state: string; decision_code: string | null; note: string | null }
interface Access { action_key: string; label_en: string; label_ar: string; category: string | null; scope_kind: string; allowed: boolean; all_lines: boolean;
  line_ids: string[]; sources: { source: string; role?: string; line_id?: string | null; effect?: string }[] }
type RoleGrant = { code: string; line_id: string | null };
const STATUS_TONE: Record<string, Tone> = { active: 'good', suspended: 'warn', archived: 'neutral' };

const db = () => requireSupabase();
function useRoles() {
  return useQuery({ queryKey: ['ops', 'ph-roles'], queryFn: async () => {
    const { data, error } = await db().from('ph_roles').select('spec_code, is_custom, evidence, roles(name_ar, name_en)').is('voided_at', null).order('sort_order');
    if (error) throw error;
    return (data ?? []) as unknown as RoleRow[];
  } });
}
function useActions() {
  return useQuery({ queryKey: ['ops', 'ph-actions'], queryFn: async () => {
    const { data, error } = await db().from('ph_actions').select('action_key, label_en, label_ar, category, scope_kind, owner_roles').is('voided_at', null).order('sort_order');
    if (error) throw error;
    return (data ?? []) as ActionRow[];
  } });
}

type Tab = 'accounts' | 'roles' | 'delegation' | 'authority' | 'audit';

/** Settings → People and access. Every action here is checked again by the server (delegation limits, no self-escalation,
 *  last Owner, quality independence); the screen only offers what the server would accept. */
export default function PeoplePage() {
  const { t } = useTranslation();
  const perms = useMyPermissions();
  const owner = !!perms.data?.has('users.manage_roles');
  const tabs: Tab[] = owner ? ['accounts', 'roles', 'delegation', 'authority', 'audit'] : ['accounts'];
  const [tab, setTab] = useState<Tab>('accounts');
  return (
    <div>
      <PageTitle title={t('ops.people.title')} sub={t('ops.people.sub')} />
      <Tabs label={t('ops.people.title')} value={tab} onChange={setTab} tabs={tabs.map((k) => ({ key: k, label: t(`ops.people.tab.${k}`) }))} />
      {tab === 'accounts' && <Accounts owner={owner} />}
      {tab === 'roles' && <Roles />}
      {tab === 'delegation' && <Delegation />}
      {tab === 'authority' && <Authority />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function RoleBuilder({ value, onChange }: { value: RoleGrant[]; onChange: (v: RoleGrant[]) => void }) {
  const { t, i18n } = useTranslation();
  const roles = useRoles();
  const lines = useLines();
  const [code, setCode] = useState('');
  const [line, setLine] = useState('');
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-2">
        {value.map((r, i) => (
          <li key={`${r.code}-${r.line_id}`} className="flex items-center gap-1 rounded-full border border-ops-line bg-ops-soft px-3 py-1 text-sm">
            <bdi>{r.code}</bdi>{r.line_id ? ` · ${lines.data?.find((l) => l.id === r.line_id)?.code ?? ''}` : ` · ${t('ops.people.allLines')}`}
            <button type="button" aria-label={t('ops.people.removeRole')} className="ms-1 min-h-[32px] min-w-[32px]" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
        {value.length === 0 && <li className="text-sm text-ops-muted">{t('ops.people.noRoles')}</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select className={`${field} w-auto`} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('ops.people.role')}>
          <option value="">{t('ops.people.role')}</option>
          {roles.data?.map((r) => <option key={r.spec_code} value={r.spec_code}>{r.spec_code} · {localName(i18n.language, r.roles?.name_ar, r.roles?.name_en)}{r.is_custom ? ' ★' : ''}</option>)}
        </select>
        <select className={`${field} w-auto`} value={line} onChange={(e) => setLine(e.target.value)} aria-label={t('ops.people.lineScope')}>
          <option value="">{t('ops.people.allLines')}</option>
          {lines.data?.map((l) => <option key={l.id} value={l.id}>{localName(i18n.language, l.name_ar, l.name_en)}</option>)}
        </select>
        <button type="button" className={btn} disabled={!code} onClick={() => { onChange([...value, { code, line_id: line || null }]); setCode(''); setLine(''); }}>{t('ops.people.addRole')}</button>
      </div>
    </div>
  );
}

/** Effective access with its source, for a proposed set of roles (before saving). */
function AccessPreview({ userId, roles }: { userId: string; roles: RoleGrant[] }) {
  const { t, i18n } = useTranslation();
  const lines = useLines();
  const [q, setQ] = useState('');
  const prev = useQuery({ queryKey: ['ops', 'access-preview', userId, roles], queryFn: () => rpc<Access[]>('ph_effective_access', { p_user: userId, p_preview: { roles, overrides: [] } }) });
  const rows = (prev.data ?? []).filter((a) => a.allowed && (!q || `${a.action_key} ${a.label_en} ${a.label_ar}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <details className="mt-3 rounded-ops-sm border border-ops-line p-2" open>
      <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold">{t('ops.people.preview', { n: rows.length })}</summary>
      <input className={`${field} mb-2`} placeholder={t('ops.people.search')} aria-label={t('ops.people.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-64 overflow-y-auto text-sm">{rows.map((a) => (
        <li key={a.action_key} className="flex flex-wrap justify-between gap-2 border-b border-ops-line py-1">
          <span>{localName(i18n.language, a.label_ar, a.label_en)} <bdi className="text-xs text-ops-muted">{a.action_key}</bdi></span>
          <span className="text-xs text-ops-muted">{a.sources.filter((s) => s.source === 'role').map((s) => s.role).join('، ')}
            {a.scope_kind === 'line' && !a.all_lines && ` · ${a.line_ids.map((id) => lines.data?.find((l) => l.id === id)?.code).join('، ')}`}</span>
        </li>
      ))}</ul>
    </details>
  );
}

function SecretBox({ secret, kind }: { secret: string; kind: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="mt-3 rounded-ops-sm border-2 border-ops-accent bg-ops-soft p-3">
      <p className="text-sm font-semibold">{t(kind === 'temp_password' ? 'ops.people.secretPassword' : 'ops.people.secretCode')}</p>
      <p className="my-2 select-all text-2xl font-bold tracking-widest"><bdi>{secret}</bdi></p>
      <p className="text-xs text-ops-muted">{t('ops.people.secretOnce')}</p>
    </div>
  );
}

function Accounts({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const { access } = useAuth();
  const inv = useInvalidateOps();
  const list = useQuery({ queryKey: ['ops', 'accounts'], queryFn: () => rpc<Account[]>('ph_admin_accounts') });
  const [f, setF] = useState({ username: '', full_name: '', email: '', method: 'activation_code' });
  const [roles, setRoles] = useState<RoleGrant[]>([]);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [secret, setSecret] = useState<{ secret: string; kind: string } | null>(null);
  const [req, setReq] = useState(newRequestId);
  const [editing, setEditing] = useState<string | null>(null);
  const create = async () => {
    setState({ kind: 'pending' }); setSecret(null);
    try {
      const r = await rpc<{ secret: string; method: string; username: string }>('ph_admin_create_account', { p: { ...f, roles }, p_request_id: req });
      setSecret({ secret: r.secret, kind: r.method }); setState({ kind: 'saved', at: new Date().toISOString(), text: r.username });
      setF({ username: '', full_name: '', email: '', method: 'activation_code' }); setRoles([]); setReq(newRequestId()); void inv();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <div className="space-y-4">
      <Card title={t('ops.people.newAccount')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-sm">{t('ops.people.username')}<input className={field} dir="ltr" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></label>
          <label className="text-sm">{t('ops.people.fullName')}<input className={field} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
          <label className="text-sm">{t('ops.people.email')}<input className={field} dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="text-sm">{t('ops.people.method')}
            <select className={field} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option value="activation_code">{t('ops.people.methodCode')}</option><option value="temp_password">{t('ops.people.methodPassword')}</option>
            </select></label>
        </div>
        <h3 className="mb-1 mt-3 text-sm font-semibold">{t('ops.people.roles')}</h3>
        <RoleBuilder value={roles} onChange={setRoles} />
        {access && <AccessPreview userId={access.userId} roles={roles} />}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={btnPrimary} disabled={!f.username || !f.full_name || state.kind === 'pending'} onClick={() => void create()}>{t('ops.people.create')}</button>
          <SaveStatus state={state} />
        </div>
        {secret && <SecretBox secret={secret.secret} kind={secret.kind} />}
      </Card>
      <Card title={t('ops.people.accounts')}>
        <QueryState isLoading={list.isLoading} error={list.error} isEmpty={(list.data?.length ?? 0) === 0}>
          <ul className="divide-y divide-ops-line">
            {list.data?.map((a) => (
              <li key={a.user_id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold"><bdi>{a.username}</bdi> · {a.full_name}</div>
                    <div className="text-xs text-ops-muted">{a.roles.map((r) => `${r.code}${r.line_code ? `@${r.line_code}` : ''}`).join('، ') || t('ops.people.noRoles')}
                      {' · '}{t('ops.people.lastSignIn')}: {a.last_sign_in_at ? fmt.dateTime(a.last_sign_in_at) : '—'} · {t('ops.people.sessions', { n: a.active_sessions })}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Pill tone={STATUS_TONE[a.status] ?? 'neutral'}>{t(`ops.people.status.${a.status}`)}</Pill>
                    {a.must_change_password && <Pill tone="info">{t('ops.people.mustChange')}</Pill>}
                    {a.locked && <Pill tone="warn">{t('ops.people.locked')}</Pill>}
                    {a.manageable && a.status !== 'archived' && <button type="button" className={btn} onClick={() => setEditing(editing === a.user_id ? null : a.user_id)}>{t('ops.people.manage')}</button>}
                  </div>
                </div>
                {editing === a.user_id && <ManageAccount account={a} owner={owner} onDone={() => { setEditing(null); void inv(); }} />}
              </li>
            ))}
          </ul>
        </QueryState>
      </Card>
    </div>
  );
}

function ManageAccount({ account, owner, onDone }: { account: Account; owner: boolean; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const actions = useActions();
  const lines = useLines();
  const [roles, setRoles] = useState<RoleGrant[]>(account.roles.map((r) => ({ code: r.code, line_id: r.line_id })));
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [secret, setSecret] = useState<string | null>(null);
  const [ov, setOv] = useState({ action: '', effect: 'grant', line: '' });
  const run = async (fn: () => Promise<{ secret?: string } | unknown>) => {
    setState({ kind: 'pending' });
    try { const r = (await fn()) as { secret?: string }; if (r?.secret) setSecret(r.secret); setState({ kind: 'saved', at: new Date().toISOString() }); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const step = (s: string) => run(() => rpc('ph_admin_account_step', { p_user: account.user_id, p_step: s, p_reason: reason }));
  return (
    <div className="mt-3 space-y-3 rounded-ops-sm border border-ops-line bg-ops-bg p-3">
      <label className="block text-sm font-medium">{t('ops.people.reason')}<input className={field} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div>
        <h4 className="mb-1 text-sm font-semibold">{t('ops.people.roles')}</h4>
        <RoleBuilder value={roles} onChange={setRoles} />
        <AccessPreview userId={account.user_id} roles={roles} />
        <button type="button" className={`${btnPrimary} mt-2`} disabled={!reason.trim()} onClick={() => void run(() => rpc('ph_admin_set_roles', { p_user: account.user_id, p_roles: roles, p_reason: reason }))}>{t('ops.people.saveRoles')}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={!reason.trim()} onClick={() => void step('reset')}>{t('ops.people.reset')}</button>
        <button type="button" className={btn} disabled={!reason.trim()} onClick={() => void step('revoke_sessions')}>{t('ops.people.revoke')}</button>
        {account.status === 'active' ? <button type="button" className={btn} disabled={!reason.trim()} onClick={() => void step('suspend')}>{t('ops.people.suspend')}</button>
          : <button type="button" className={btn} disabled={!reason.trim()} onClick={() => void step('reactivate')}>{t('ops.people.reactivate')}</button>}
        <button type="button" className={`${btn} text-ops-red`} disabled={!reason.trim()} onClick={() => { if (window.confirm(t('ops.people.archiveConfirm'))) void step('archive'); }}>{t('ops.people.archive')}</button>
      </div>
      {owner && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t('ops.people.override')}</h4>
          <div className="flex flex-wrap gap-2">
            <select className={`${field} w-auto max-w-full`} value={ov.action} onChange={(e) => setOv({ ...ov, action: e.target.value })} aria-label={t('ops.people.action')}>
              <option value="">{t('ops.people.action')}</option>
              {actions.data?.map((a) => <option key={a.action_key} value={a.action_key}>{localName(i18n.language, a.label_ar, a.label_en)} ({a.action_key})</option>)}
            </select>
            <select className={`${field} w-auto`} value={ov.effect} onChange={(e) => setOv({ ...ov, effect: e.target.value })} aria-label={t('ops.people.effect')}>
              <option value="grant">{t('ops.people.grant')}</option><option value="deny">{t('ops.people.deny')}</option>
            </select>
            <select className={`${field} w-auto`} value={ov.line} onChange={(e) => setOv({ ...ov, line: e.target.value })} aria-label={t('ops.people.lineScope')}>
              <option value="">{t('ops.people.allLines')}</option>
              {lines.data?.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
            </select>
            <button type="button" className={btn} disabled={!ov.action || !reason.trim()} onClick={() => void run(() => rpc('ph_admin_set_override', { p_user: account.user_id, p_action: ov.action, p_effect: ov.effect, p_line: ov.line || null, p_reason: reason }))}>{t('ops.people.saveOverride')}</button>
          </div>
        </div>
      )}
      <SaveStatus state={state} />
      {secret && <SecretBox secret={secret} kind="activation_code" />}
      <button type="button" className={btn} onClick={onDone}>{t('ops.people.close')}</button>
    </div>
  );
}

function Roles() {
  const { t, i18n } = useTranslation();
  const roles = useRoles();
  const actions = useActions();
  const inv = useInvalidateOps();
  const [sel, setSel] = useState('');
  const [f, setF] = useState({ code: '', name_ar: '', name_en: '', clone_from: '' });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const cells = useQuery({ queryKey: ['ops', 'role-cells', sel], enabled: !!sel, queryFn: async () => {
    const { data, error } = await db().from('ph_permission_cells').select('action_key, state').eq('spec_code', sel).is('voided_at', null);
    if (error) throw error;
    return new Set((data ?? []).filter((c: { state: string }) => c.state === 'active').map((c: { action_key: string }) => c.action_key));
  } });
  useEffect(() => { if (cells.data) setChecked(new Set(cells.data)); }, [cells.data]);
  const custom = roles.data?.find((r) => r.spec_code === sel)?.is_custom;
  const shown = (actions.data ?? []).filter((a) => (!cat || a.category === cat) && (!q || `${a.action_key} ${a.label_en} ${a.label_ar}`.toLowerCase().includes(q.toLowerCase())));
  const save = async (create: boolean) => {
    setState({ kind: 'pending' });
    try {
      await rpc('ph_admin_save_role', { p: create ? { ...f, code: f.code.toUpperCase(), clone_from: f.clone_from || null } : { code: sel, actions: [...checked] }, p_reason: reason });
      setState({ kind: 'saved', at: new Date().toISOString() }); void inv(); if (create) { setSel(f.code.toUpperCase()); setF({ code: '', name_ar: '', name_en: '', clone_from: '' }); }
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-4" title={t('ops.people.roleList')}>
        <ul className="space-y-1">{roles.data?.map((r) => (
          <li key={r.spec_code}><button type="button" onClick={() => setSel(r.spec_code)}
            className={`flex min-h-[44px] w-full items-center justify-between rounded-ops-sm px-2 text-start text-sm ${sel === r.spec_code ? 'bg-ops-soft text-ops-accent' : 'hover:bg-ops-grey'}`}>
            <span><bdi className="font-semibold">{r.spec_code}</bdi> · {localName(i18n.language, r.roles?.name_ar, r.roles?.name_en)}</span>
            {r.is_custom ? <Pill tone="info">{t('ops.people.custom')}</Pill> : <Pill tone="neutral">{r.evidence}</Pill>}
          </button></li>
        ))}</ul>
        <h3 className="mb-1 mt-4 text-sm font-semibold">{t('ops.people.newRole')}</h3>
        <div className="space-y-2">
          <input className={field} dir="ltr" placeholder="PACK_LEAD" aria-label={t('ops.people.roleCode')} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          <input className={field} placeholder={t('ops.people.nameAr')} aria-label={t('ops.people.nameAr')} value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} />
          <input className={field} placeholder={t('ops.people.nameEn')} aria-label={t('ops.people.nameEn')} value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} />
          <select className={field} value={f.clone_from} onChange={(e) => setF({ ...f, clone_from: e.target.value })} aria-label={t('ops.people.cloneFrom')}>
            <option value="">{t('ops.people.emptyRole')}</option>
            {roles.data?.map((r) => <option key={r.spec_code} value={r.spec_code}>{t('ops.people.cloneOf', { code: r.spec_code })}</option>)}
          </select>
          <input className={field} placeholder={t('ops.people.reason')} aria-label={t('ops.people.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className={btnPrimary} disabled={!f.code || !f.name_ar || !reason.trim()} onClick={() => void save(true)}>{t('ops.people.createRole')}</button>
        </div>
      </Card>
      <Card className="lg:col-span-8" title={sel ? t('ops.people.cellsOf', { code: sel }) : t('ops.people.pickRole')}>
        {!sel ? <EmptyState>{t('ops.people.pickRole')}</EmptyState> : (
          <>
            {!custom && <p className="mb-2 rounded-ops-sm bg-ops-amberbg p-2 text-sm text-ops-amber">! {t('ops.people.specRoleReadOnly')}</p>}
            <div className="mb-2 flex flex-wrap gap-2">
              <input className={`${field} flex-1`} placeholder={t('ops.people.search')} aria-label={t('ops.people.search')} value={q} onChange={(e) => setQ(e.target.value)} />
              <select className={`${field} w-auto`} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('ops.people.category')}>
                <option value="">{t('ops.filters.all')}</option>
                {['view', 'create', 'edit', 'assign', 'approve', 'quality', 'publish', 'export', 'administer'].map((c) => <option key={c} value={c}>{t(`ops.people.cat.${c}`)}</option>)}
              </select>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>{shown.map((a) => (
                  <tr key={a.action_key} className="border-t border-ops-line">
                    <td className="py-1.5"><label className="flex min-h-[40px] items-center gap-2">
                      <input type="checkbox" className="h-5 w-5" disabled={!custom} checked={checked.has(a.action_key)}
                        onChange={(e) => { const n = new Set(checked); if (e.target.checked) n.add(a.action_key); else n.delete(a.action_key); setChecked(n); }} />
                      {localName(i18n.language, a.label_ar, a.label_en)}</label></td>
                    <td className="text-xs text-ops-muted"><bdi>{a.action_key}</bdi></td>
                    <td className="text-xs">{a.category ? t(`ops.people.cat.${a.category}`) : ''}{a.scope_kind === 'line' ? ` · ${t('ops.people.lineScoped')}` : ''}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {custom && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input className={`${field} flex-1`} placeholder={t('ops.people.reason')} aria-label={t('ops.people.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className={btnPrimary} disabled={!reason.trim()} onClick={() => void save(false)}>{t('ops.people.saveCells', { n: checked.size })}</button>
              </div>
            )}
          </>
        )}
        <div className="mt-2"><SaveStatus state={state} /></div>
      </Card>
    </div>
  );
}

function Delegation() {
  const { t, i18n } = useTranslation();
  const list = useQuery({ queryKey: ['ops', 'accounts'], queryFn: () => rpc<Account[]>('ph_admin_accounts') });
  const roles = useRoles();
  const lines = useLines();
  const dels = useQuery({ queryKey: ['ops', 'delegations'], queryFn: async () => {
    const { data, error } = await db().from('ph_admin_delegations').select('*').is('voided_at', null);
    if (error) throw error;
    return (data ?? []) as { manager_user_id: string; grantable_roles: string[]; line_ids: string[] | null; can_create: boolean; can_reset: boolean; can_suspend: boolean; reason: string }[];
  } });
  const inv = useInvalidateOps();
  const [f, setF] = useState({ manager: '', roles: [] as string[], lines: [] as string[], can_create: true, can_reset: false, can_suspend: false, reason: '' });
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const save = async (revoke = false) => {
    setState({ kind: 'pending' });
    try {
      await rpc('ph_admin_set_delegation', { p_manager: f.manager, p: revoke ? { revoke: true } : { roles: f.roles, line_ids: f.lines.length ? f.lines : null,
        can_create: f.can_create, can_reset: f.can_reset, can_suspend: f.can_suspend }, p_reason: f.reason });
      setState({ kind: 'saved', at: new Date().toISOString() }); void inv();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t('ops.people.delegate')}>
        <p className="mb-2 text-sm text-ops-muted">{t('ops.people.delegateHelp')}</p>
        <select className={field} value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })} aria-label={t('ops.people.manager')}>
          <option value="">{t('ops.people.manager')}</option>
          {list.data?.filter((a) => a.status === 'active').map((a) => <option key={a.user_id} value={a.user_id}>{a.username} · {a.full_name}</option>)}
        </select>
        <fieldset className="mt-2"><legend className="text-sm font-medium">{t('ops.people.grantableRoles')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">{roles.data?.filter((r) => r.spec_code !== 'OWN').map((r) => (
            <label key={r.spec_code} className="flex min-h-[44px] items-center gap-1 rounded-ops-sm border border-ops-line px-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={f.roles.includes(r.spec_code)} onChange={() => setF({ ...f, roles: toggle(f.roles, r.spec_code) })} /><bdi>{r.spec_code}</bdi></label>
          ))}</div></fieldset>
        <fieldset className="mt-2"><legend className="text-sm font-medium">{t('ops.people.delegatedLines')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">{lines.data?.map((l) => (
            <label key={l.id} className="flex min-h-[44px] items-center gap-1 rounded-ops-sm border border-ops-line px-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={f.lines.includes(l.id)} onChange={() => setF({ ...f, lines: toggle(f.lines, l.id) })} />{localName(i18n.language, l.name_ar, l.name_en)}</label>
          ))}</div><p className="text-xs text-ops-muted">{t('ops.people.noLinesAll')}</p></fieldset>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {(['can_create', 'can_reset', 'can_suspend'] as const).map((k) => (
            <label key={k} className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{t(`ops.people.${k}`)}</label>
          ))}
        </div>
        <input className={`${field} mt-2`} placeholder={t('ops.people.reason')} aria-label={t('ops.people.reason')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={!f.manager || f.roles.length === 0 || !f.reason.trim()} onClick={() => void save()}>{t('ops.people.saveDelegation')}</button>
          <button type="button" className={btn} disabled={!f.manager || !f.reason.trim()} onClick={() => void save(true)}>{t('ops.people.revokeDelegation')}</button>
        </div>
        <div className="mt-2"><SaveStatus state={state} /></div>
      </Card>
      <Card title={t('ops.people.currentDelegations')}>
        {(dels.data?.length ?? 0) === 0 ? <EmptyState>{t('ops.people.noDelegations')}</EmptyState> : (
          <ul className="space-y-2 text-sm">{dels.data?.map((d) => (
            <li key={d.manager_user_id} className="rounded-ops-sm border border-ops-line p-2">
              <div className="font-semibold">{list.data?.find((a) => a.user_id === d.manager_user_id)?.username ?? d.manager_user_id}</div>
              <div>{t('ops.people.grantableRoles')}: {d.grantable_roles.join('، ')} · {d.line_ids ? d.line_ids.map((id) => lines.data?.find((l) => l.id === id)?.code).join('، ') : t('ops.people.allLines')}</div>
              <div className="text-ops-muted">{[d.can_create && t('ops.people.can_create'), d.can_reset && t('ops.people.can_reset'), d.can_suspend && t('ops.people.can_suspend')].filter(Boolean).join(' · ')}</div>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function Authority() {
  const { t, i18n } = useTranslation();
  const actions = useActions();
  const inv = useInvalidateOps();
  const cells = useQuery({ queryKey: ['ops', 'open-cells'], queryFn: async () => {
    const { data, error } = await db().from('ph_permission_cells').select('id, action_key, spec_code, evidence, state, decision_code, note').is('voided_at', null)
      .in('state', ['pending_decision', 'proposed']).order('action_key');
    if (error) throw error;
    return (data ?? []) as CellRow[];
  } });
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const label = useMemo(() => new Map((actions.data ?? []).map((a) => [a.action_key, localName(i18n.language, a.label_ar, a.label_en)])), [actions.data, i18n.language]);
  const rows = (cells.data ?? []).filter((c) => !q || `${c.action_key} ${c.spec_code} ${c.decision_code ?? ''} ${label.get(c.action_key) ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const decide = async (id: string, s: 'active' | 'disabled') => {
    setState({ kind: 'pending' });
    try { await rpc('ph_owner_cell_decision', { p_cell: id, p_state: s, p_reason: reason }); setState({ kind: 'saved', at: new Date().toISOString() }); void inv(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.people.authority')}>
      <p className="mb-2 text-sm text-ops-muted">{t('ops.people.authorityHelp')}</p>
      <div className="mb-2 flex flex-wrap gap-2">
        <input className={`${field} flex-1`} placeholder={t('ops.people.search')} aria-label={t('ops.people.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <input className={`${field} flex-1`} placeholder={t('ops.people.decisionReason')} aria-label={t('ops.people.decisionReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <SaveStatus state={state} />
      <div className="max-h-[560px] overflow-y-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.people.action')}</th><th className="text-start font-medium">{t('ops.people.role')}</th>
            <th className="text-start font-medium">{t('ops.people.label')}</th><th /></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id} className="border-t border-ops-line align-top">
              <td className="py-1.5">{label.get(c.action_key)} <bdi className="block text-xs text-ops-muted">{c.action_key}</bdi></td>
              <td><bdi>{c.spec_code}</bdi></td>
              <td><Pill tone={c.state === 'proposed' ? 'info' : 'warn'}>{c.evidence}{c.decision_code ? ` · ${c.decision_code}` : ''}</Pill></td>
              <td className="whitespace-nowrap text-end">
                <button type="button" className={btn} disabled={!reason.trim()} onClick={() => void decide(c.id, 'active')}>{t('ops.people.activate')}</button>{' '}
                <button type="button" className={btn} disabled={!reason.trim()} onClick={() => void decide(c.id, 'disabled')}>{t('ops.people.disable')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Audit() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const log = useQuery({ queryKey: ['ops', 'access-log'], queryFn: async () => {
    const { data, error } = await db().from('ph_access_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return (data ?? []) as { id: string; created_at: string; event: string; target_username: string | null; target_name: string | null; actor_name: string | null;
      before: unknown; after: unknown; reason: string | null }[];
  } });
  return (
    <Card title={t('ops.people.audit')}>
      <QueryState isLoading={log.isLoading} error={log.error} isEmpty={(log.data?.length ?? 0) === 0}>
        <ul className="divide-y divide-ops-line text-sm">{log.data?.map((e) => (
          <li key={e.id} className="py-2">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{t(`ops.people.event.${e.event}`, { defaultValue: e.event })}</span>
              <span className="text-xs text-ops-muted">{fmt.dateTime(e.created_at)} · {e.actor_name ?? '—'}</span></div>
            <div>{e.target_username && <bdi>{e.target_username}</bdi>}{e.reason && <span className="text-ops-muted"> — {e.reason}</span>}</div>
            {(e.before || e.after) ? (
              <details><summary className="min-h-[32px] cursor-pointer text-xs text-ops-accent">{t('ops.people.beforeAfter')}</summary>
                <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify({ before: e.before, after: e.after }, null, 1)}</pre></details>
            ) : null}
          </li>
        ))}</ul>
      </QueryState>
    </Card>
  );
}
