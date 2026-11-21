import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { newRequestId, opsErrorMessage, rpc, useInvalidateOps, useLines, useMyPermissions } from './api';
import { btn, btnPrimary, Card, EmptyState, field, PageTitle, Pill, SaveStatus, useFmt, type SaveState, type Tone, Loaded } from './ui';
import { useRoleOptions } from './config/useConfig';

interface TaskRow {
  id: string; code: string; title: string; details: string | null; assignee_role: string | null; assignee_user_id: string | null; assignee_name: string | null;
  line_id: string | null; line_code: string | null; due_at: string | null; priority: 'low' | 'normal' | 'high'; source: string; op_instance_id: string | null;
  op_run_code: string | null; escalated_at: string | null; escalate_to_role: string | null; started_at: string | null; completed_at: string | null;
  completion_note: string | null; cancelled_at: string | null; cancel_reason: string | null; created_at: string; task_state: 'open' | 'in_progress' | 'overdue' | 'done' | 'cancelled';
  is_mine: boolean; comments: { body: string; at: string; by: string | null }[];
}
const STATE_TONE: Record<TaskRow['task_state'], Tone> = { open: 'info', in_progress: 'info', overdue: 'bad', done: 'good', cancelled: 'neutral' };

function useTasks() {
  return useQuery({ queryKey: ['ops', 'tasks'], refetchInterval: 60_000, queryFn: async () => {
    const { data, error } = await requireSupabase().from('ph_task_board').select('*').order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as TaskRow[];
  } });
}

type View = 'mine' | 'open' | 'done';

/** Task board: my work first (assigned to me or to a role I hold on my line), deadlines, escalation, comments and evidence. */
export default function TasksPage() {
  const { t } = useTranslation();
  const tasks = useTasks();
  const perms = useMyPermissions();
  const [view, setView] = useState<View>('mine');
  const canCreate = !!perms.data?.has('task.create');
  return (
    <div>
      <PageTitle title={t('ops.tasks.title')} sub={t('ops.tasks.sub')} />
      <div role="tablist" aria-label={t('ops.tasks.title')} className="mb-4 flex flex-wrap gap-1 rounded-ops-sm bg-ops-grey p-1">
        {(['mine', 'open', 'done'] as View[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`min-h-[44px] rounded-ops-sm px-4 text-sm font-semibold ${view === k ? 'bg-ops-surface text-ops-accent shadow-ops' : 'text-ops-muted'}`}>{t(`ops.tasks.views.${k}`)}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Loaded query={tasks}>
          {(rows) => {
            const list = rows.filter((r) => view === 'mine' ? r.is_mine && !['done', 'cancelled'].includes(r.task_state)
              : view === 'open' ? !['done', 'cancelled'].includes(r.task_state) : ['done', 'cancelled'].includes(r.task_state));
            return list.length === 0 ? <EmptyState>{t(`ops.tasks.empty.${view}`)}</EmptyState> : (
              <ul className="grid content-start gap-2">{list.map((r) => <li key={r.id}><TaskCard task={r} canManage={canCreate} canCancel={!!perms.data?.has('task.cancel')} /></li>)}</ul>
            );
          }}
        </Loaded>
        {canCreate && <div className="grid content-start gap-4"><NewTask /><Recurring /></div>}
      </div>
    </div>
  );
}

function TaskCard({ task, canManage, canCancel }: { task: TaskRow; canManage: boolean; canCancel: boolean }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const invalidate = useInvalidateOps();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const step = async (s: string, p: Record<string, unknown> = {}) => {
    setState({ kind: 'pending' });
    try { await rpc('ph_task_step', { p_task: task.id, p_step: s, p }); setState({ kind: 'saved', at: new Date().toISOString() }); setComment(''); await invalidate(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const live = !['done', 'cancelled'].includes(task.task_state);
  return (
    <article className={`ops-card p-3 ${task.task_state === 'overdue' ? 'ops-highlight' : ''}`} aria-label={task.title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{task.title}</h3>
          <p className="text-xs text-ops-muted"><bdi>{task.code}</bdi>{task.line_code ? ` · ${t('ops.tasks.line')} ${task.line_code}` : ''} · {t(`ops.tasks.sources.${task.source}`)}</p>
        </div>
        <span className="flex flex-wrap gap-1">
          <Pill tone={STATE_TONE[task.task_state]}>{t(`ops.tasks.states.${task.task_state}`)}</Pill>
          {task.priority === 'high' && <Pill tone="warn">{t('ops.tasks.priorities.high')}</Pill>}
          {task.escalated_at && <Pill tone="bad">{t('ops.tasks.escalated', { role: task.escalate_to_role ?? '' })}</Pill>}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 text-sm sm:grid-cols-3">
        <div><dt className="text-ops-muted">{t('ops.tasks.assignee')}</dt><dd><bdi>{task.assignee_name ?? task.assignee_role ?? '—'}</bdi></dd></div>
        <div><dt className="text-ops-muted">{t('ops.tasks.due')}</dt><dd>{fmt.dateTime(task.due_at)}</dd></div>
        {task.completed_at && <div><dt className="text-ops-muted">{t('ops.tasks.doneAt')}</dt><dd>{fmt.dateTime(task.completed_at)}</dd></div>}
      </dl>
      {task.details && <p className="mt-2 text-sm">{task.details}</p>}
      {task.op_instance_id && (
        <p className="mt-2"><Link className={btnPrimary} to={`/ops/run/${task.op_instance_id}`}>{live ? t('ops.tasks.openOperation') : t('ops.tasks.viewOperation')} <bdi>{task.op_run_code}</bdi></Link></p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {live && task.is_mine && !task.op_instance_id && !task.started_at && <button type="button" className={btn} onClick={() => step('start')}>{t('ops.tasks.start')}</button>}
        <button type="button" className={btn} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('ops.tasks.less') : t('ops.tasks.more', { n: task.comments.length })}</button>
      </div>
      {open && (
        <div className="mt-3 grid gap-2 border-t border-ops-line pt-3">
          {task.comments.map((c, i) => <p key={i} className="text-sm"><span className="text-ops-muted">{fmt.dateTime(c.at)} · <bdi>{c.by ?? ''}</bdi>:</span> {c.body}</p>)}
          <label className="text-sm">{t('ops.tasks.comment')}<textarea className={`${field} min-h-[4rem] py-2`} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <button type="button" className={btn} disabled={!comment.trim()} onClick={() => step('comment', { body: comment })}>{t('ops.tasks.addComment')}</button>
          {live && task.is_mine && !task.op_instance_id && (
            <>
              <label className="text-sm">{t('ops.tasks.completionNote')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <button type="button" className={btnPrimary} onClick={() => step('complete', { note })}>{t('ops.tasks.complete')}</button>
            </>
          )}
          {live && canManage && <Reassign onSave={(p) => step('reassign', p)} />}
          {canCancel && !task.op_instance_id && (live
            ? <button type="button" className={btn} onClick={() => { const r = window.prompt(t('ops.tasks.cancelReason')); if (r?.trim()) void step('cancel', { reason: r }); }}>{t('ops.tasks.cancel')}</button>
            : <button type="button" className={btn} onClick={() => { const r = window.prompt(t('ops.tasks.reopenReason')); if (r?.trim()) void step('reopen', { reason: r }); }}>{t('ops.tasks.reopen')}</button>)}
          {task.cancel_reason && <p className="text-sm text-ops-muted">{t('ops.tasks.cancelledBecause', { reason: task.cancel_reason })}</p>}
        </div>
      )}
      <div className="mt-2"><SaveStatus state={state} /></div>
    </article>
  );
}

function Reassign({ onSave }: { onSave: (p: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const roles = useRoleOptions();
  const [role, setRole] = useState('');
  const [reason, setReason] = useState('');
  return (
    <fieldset className="grid gap-2 rounded-ops-sm border border-ops-line p-2">
      <legend className="px-1 text-sm font-medium">{t('ops.tasks.reassign')}</legend>
      <select aria-label={t('ops.tasks.assignRole')} className={field} value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="">{t('ops.run.choose')}</option>
        {(roles.data ?? []).map((r) => <option key={r.spec_code} value={r.spec_code}>{r.spec_code}</option>)}
      </select>
      <input aria-label={t('ops.people.reason')} placeholder={t('ops.people.reason')} className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className={btn} disabled={!role || !reason.trim()} onClick={() => onSave({ assignee_role: role, reason })}>{t('ops.tasks.reassign')}</button>
    </fieldset>
  );
}

function NewTask() {
  const { t } = useTranslation();
  const roles = useRoleOptions();
  const lines = useLines();
  const invalidate = useInvalidateOps();
  const [p, setP] = useState({ title: '', details: '', assignee_role: '', line_id: '', due_at: '', priority: 'normal', escalate_after_min: '', escalate_to_role: '' });
  const [rid, setRid] = useState(newRequestId);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const submit = async () => {
    setState({ kind: 'pending' });
    try {
      await rpc('ph_task_create', { p: { ...p, due_at: p.due_at ? new Date(p.due_at).toISOString() : null }, p_request_id: rid });
      setState({ kind: 'saved', at: new Date().toISOString() });
      setP({ ...p, title: '', details: '' }); setRid(newRequestId()); await invalidate();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.tasks.new')}>
      <div className="grid gap-2">
        <label className="text-sm">{t('ops.tasks.taskTitle')}<input className={field} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} /></label>
        <label className="text-sm">{t('ops.tasks.details')}<textarea className={`${field} min-h-[4rem] py-2`} value={p.details} onChange={(e) => setP({ ...p, details: e.target.value })} /></label>
        <label className="text-sm">{t('ops.tasks.assignRole')}
          <select className={field} value={p.assignee_role} onChange={(e) => setP({ ...p, assignee_role: e.target.value })}>
            <option value="">{t('ops.run.choose')}</option>
            {(roles.data ?? []).map((r) => <option key={r.spec_code} value={r.spec_code}>{r.spec_code}</option>)}
          </select>
        </label>
        <label className="text-sm">{t('ops.tasks.line')}
          <select className={field} value={p.line_id} onChange={(e) => setP({ ...p, line_id: e.target.value })}>
            <option value="">{t('ops.tasks.anyLine')}</option>
            {(lines.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
          </select>
        </label>
        <label className="text-sm">{t('ops.tasks.due')}<input type="datetime-local" dir="ltr" className={field} value={p.due_at} onChange={(e) => setP({ ...p, due_at: e.target.value })} /></label>
        <label className="text-sm">{t('ops.tasks.priority')}
          <select className={field} value={p.priority} onChange={(e) => setP({ ...p, priority: e.target.value })}>
            {['low', 'normal', 'high'].map((x) => <option key={x} value={x}>{t(`ops.tasks.priorities.${x}`)}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">{t('ops.tasks.escalateAfter')}<input className={field} dir="ltr" inputMode="numeric" value={p.escalate_after_min} onChange={(e) => setP({ ...p, escalate_after_min: e.target.value })} /></label>
          <label className="text-sm">{t('ops.tasks.escalateTo')}
            <select className={field} value={p.escalate_to_role} onChange={(e) => setP({ ...p, escalate_to_role: e.target.value })}>
              <option value="">—</option>
              {(roles.data ?? []).map((r) => <option key={r.spec_code} value={r.spec_code}>{r.spec_code}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className={btnPrimary} disabled={!p.title.trim() || !p.assignee_role} onClick={submit}>{t('ops.tasks.create')}</button>
        <SaveStatus state={state} onRetry={submit} />
      </div>
    </Card>
  );
}

function Recurring() {
  const { t } = useTranslation();
  const roles = useRoleOptions();
  const invalidate = useInvalidateOps();
  const tpl = useQuery({ queryKey: ['ops', 'task-templates'], queryFn: async () => {
    const { data, error } = await requireSupabase().from('ph_task_templates').select('id, title, assignee_role, every_days, at_time, weekdays, next_run_at, active').is('voided_at', null).order('title');
    if (error) throw error;
    return (data ?? []) as { id: string; title: string; assignee_role: string; every_days: number | null; at_time: string; weekdays: number[] | null; next_run_at: string; active: boolean }[];
  } });
  const fmt = useFmt();
  const [p, setP] = useState({ title: '', assignee_role: '', every_days: '1', at_time: '06:00', due_minutes: '120' });
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const days = useMemo(() => Number(p.every_days) || 1, [p.every_days]);
  const submit = async () => {
    setState({ kind: 'pending' });
    try { await rpc('ph_task_template_save', { p: { ...p, every_days: days } }); setState({ kind: 'saved', at: new Date().toISOString() }); setP({ ...p, title: '' }); await invalidate(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.tasks.recurring')}>
      <ul className="mb-3 grid gap-1 text-sm">
        {(tpl.data ?? []).map((x) => <li key={x.id}>{x.title} · <bdi>{x.assignee_role}</bdi> · {t('ops.tasks.everyDays', { n: x.every_days ?? 1 })} · {t('ops.tasks.next', { when: fmt.dateTime(x.next_run_at) })}</li>)}
        {(tpl.data ?? []).length === 0 && <li className="text-ops-muted">{t('ops.tasks.noRecurring')}</li>}
      </ul>
      <div className="grid gap-2">
        <label className="text-sm">{t('ops.tasks.taskTitle')}<input className={field} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} /></label>
        <label className="text-sm">{t('ops.tasks.assignRole')}
          <select className={field} value={p.assignee_role} onChange={(e) => setP({ ...p, assignee_role: e.target.value })}>
            <option value="">{t('ops.run.choose')}</option>
            {(roles.data ?? []).map((r) => <option key={r.spec_code} value={r.spec_code}>{r.spec_code}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm">{t('ops.tasks.every')}<input className={field} dir="ltr" inputMode="numeric" value={p.every_days} onChange={(e) => setP({ ...p, every_days: e.target.value })} /></label>
          <label className="text-sm">{t('ops.tasks.at')}<input type="time" className={field} dir="ltr" value={p.at_time} onChange={(e) => setP({ ...p, at_time: e.target.value })} /></label>
          <label className="text-sm">{t('ops.tasks.dueMin')}<input className={field} dir="ltr" inputMode="numeric" value={p.due_minutes} onChange={(e) => setP({ ...p, due_minutes: e.target.value })} /></label>
        </div>
        <button type="button" className={btn} disabled={!p.title.trim() || !p.assignee_role} onClick={submit}>{t('ops.tasks.addRecurring')}</button>
        <SaveStatus state={state} />
      </div>
    </Card>
  );
}
