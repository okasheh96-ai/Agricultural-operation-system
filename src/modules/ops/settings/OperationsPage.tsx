import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { phReason } from '@/modules/packing-house/phErrors';
import { localName, opsErrorMessage, rpc, useInvalidateOps, useMyPermissions } from '../api';
import { btn, btnPrimary, Card, EmptyState, field, PageTitle, Pill, SaveStatus, useFmt, type SaveState, Loaded } from '../ui';
import { FormRenderer } from '../config/FormRenderer';
import { condsHold, emptyDef, nextKey, type Catalog, type Cond, type CondOp, type FieldType, type OpDef, type OpError, type OpField, type OpStep, type SubjectKind, type Values } from '../config/types';
import { opErrorText, useCatalog, useOpTypes, useRoleOptions, versionInEffect, type OpType, type RoleOption } from '../config/useConfig';

/** Settings → Operations. The Owner builds an operation as data: steps, fields, conditions, roles, approvals and what a failure
 *  does; the server validates, publishes effective-dated versions, and pins every record to the version it started on. */
export default function OperationsPage() {
  const { t, i18n } = useTranslation();
  const types = useOpTypes();
  const catalog = useCatalog();
  const roles = useRoleOptions();
  const perms = useMyPermissions();
  const [selected, setSelected] = useState<string | null>(null);
  const canEdit = !!perms.data?.has('settings.edit');
  const current = types.data?.find((o) => o.code === selected) ?? null;
  return (
    <div>
      <PageTitle title={t('ops.opset.title')} sub={t('ops.opset.sub')} />
      <Loaded query={types}>
        {(list) => (
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="grid content-start gap-3">
              <Card title={t('ops.opset.list')}>
                {list.length === 0 ? <EmptyState>{t('ops.opset.none')}</EmptyState> : (
                  <ul className="grid gap-1">
                    {list.map((o) => {
                      const v = versionInEffect(o);
                      const draft = o.ph_op_versions.find((x) => x.state === 'draft');
                      return (
                        <li key={o.id}>
                          <button type="button" aria-current={selected === o.code} onClick={() => setSelected(o.code)}
                            className={`w-full rounded-ops-sm border p-2 text-start ${selected === o.code ? 'border-ops-accent bg-ops-soft' : 'border-ops-line'}`}>
                            <span className="block font-semibold"><bdi>{o.code}</bdi> · {localName(i18n.language, o.name_ar, o.name_en)}</span>
                            <span className="mt-1 flex flex-wrap gap-1">
                              {o.retired_at ? <Pill tone="neutral">{t('ops.opset.retired')}</Pill>
                                : v ? <Pill tone="good">{t('ops.opset.inEffect', { v: v.version_no })}</Pill> : <Pill tone="warn">{t('ops.opset.notPublished')}</Pill>}
                              {draft && <Pill tone="info">{t('ops.opset.draft', { v: draft.version_no })}</Pill>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              {canEdit && <NewOperation onCreated={setSelected} />}
            </div>
            <div className="min-w-0">
              {current && catalog.data && roles.data
                ? <Editor key={current.id} op={current} catalog={catalog.data} roles={roles.data} canEdit={canEdit} canPublish={!!perms.data?.has('settings.publish')} />
                : <EmptyState>{t('ops.opset.pick')}</EmptyState>}
            </div>
          </div>
        )}
      </Loaded>
    </div>
  );
}

function NewOperation({ onCreated }: { onCreated: (code: string) => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateOps();
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [kind, setKind] = useState<SubjectKind>('standalone');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const submit = async () => {
    setState({ kind: 'pending' });
    try {
      const hook = kind === 'load' ? 'dispatch.before_depart' : 'manual';
      const r = await rpc<{ code: string }>('ph_op_save_draft', { p_code: code, p: { name_ar: nameAr, name_en: nameEn, subject_kind: kind, definition: emptyDef(hook) } });
      setState({ kind: 'saved', at: new Date().toISOString() });
      await invalidate();
      onCreated(r.code);
      setCode(''); setNameAr(''); setNameEn('');
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.opset.new')}>
      <div className="grid gap-2">
        <label className="text-sm">{t('ops.opset.code')}<input className={field} dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} /></label>
        <label className="text-sm">{t('ops.opset.nameAr')}<input className={field} value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></label>
        <label className="text-sm">{t('ops.opset.nameEn')}<input className={field} dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></label>
        <label className="text-sm">{t('ops.opset.subject')}
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value as SubjectKind)}>
            {(['standalone', 'load'] as SubjectKind[]).map((k) => <option key={k} value={k}>{t(`ops.opset.subjects.${k}`)}</option>)}
          </select>
        </label>
        <button type="button" className={btnPrimary} disabled={!code || !nameAr} onClick={submit}>{t('ops.opset.create')}</button>
        <SaveStatus state={state} />
      </div>
    </Card>
  );
}

function roleName(lang: string, roles: RoleOption[], code: string) {
  const r = roles.find((x) => x.spec_code === code);
  return r ? `${code} · ${localName(lang, r.roles?.name_ar, r.roles?.name_en)}` : code;
}

function Editor({ op, catalog, roles, canEdit, canPublish }: { op: OpType; catalog: Catalog; roles: RoleOption[]; canEdit: boolean; canPublish: boolean }) {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const invalidate = useInvalidateOps();
  const draft = op.ph_op_versions.find((v) => v.state === 'draft');
  const live = versionInEffect(op);
  const [def, setDef] = useState<OpDef>(() => structuredClone(draft?.definition ?? live?.definition ?? emptyDef()));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<OpError[] | null>(null);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [note, setNote] = useState('');
  const [from, setFrom] = useState('');
  const [retireReason, setRetireReason] = useState('');
  const [previewStep, setPreviewStep] = useState(0);
  const update = (d: OpDef) => { setDef(d); setDirty(true); setErrors(null); };
  const hooks = catalog.hooks.filter((h) => h.subject_kind === op.subject_kind || (op.subject_kind === 'standalone' && h.hook === 'manual'));
  const subjectFields = catalog.subject_fields[op.subject_kind] ?? [];
  const lang = i18n.language;
  const readOnly = !canEdit || !!op.retired_at;

  const save = async () => {
    setState({ kind: 'pending' });
    try {
      const r = await rpc<{ errors: OpError[] }>('ph_op_save_draft', { p_code: op.code, p: { definition: def, change_note: note || null } });
      setErrors(r.errors); setDirty(false);
      setState({ kind: 'saved', at: new Date().toISOString(), text: r.errors.length ? t('ops.opset.problems', { n: r.errors.length }) : t('ops.opset.valid') });
      await invalidate();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const publish = async () => {
    setState({ kind: 'pending' });
    try {
      if (dirty) await rpc('ph_op_save_draft', { p_code: op.code, p: { definition: def, change_note: note || null } });
      const r = await rpc<{ version: number }>('ph_op_publish', { p_code: op.code, p_effective_from: from ? new Date(from).toISOString() : null, p_note: note || null });
      setDirty(false); setErrors([]);
      setState({ kind: 'saved', at: new Date().toISOString(), text: t('ops.opset.published', { v: r.version }) });
      await invalidate();
    } catch (e) {
      const reason = phReason(e);
      if (reason?.key === 'po.op.invalid' && Array.isArray(reason.errors)) setErrors(reason.errors as OpError[]);
      setState({ kind: 'failed', message: opsErrorMessage(t, e) });
    }
  };
  const retire = async () => {
    setState({ kind: 'pending' });
    try {
      const r = await rpc<{ open_runs_cancelled: number }>('ph_op_retire', { p_code: op.code, p_reason: retireReason });
      setState({ kind: 'saved', at: new Date().toISOString(), text: t('ops.opset.retiredDone', { n: r.open_runs_cancelled }) });
      await invalidate();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const rollback = async (v: number) => {
    const reason = window.prompt(t('ops.opset.rollbackReason')) ?? '';
    if (!reason.trim()) return;
    setState({ kind: 'pending' });
    try {
      const r = await rpc<{ version: number }>('ph_op_rollback', { p_code: op.code, p_version: v, p_reason: reason });
      setState({ kind: 'saved', at: new Date().toISOString(), text: t('ops.opset.published', { v: r.version }) });
      await invalidate();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };

  const setStep = (i: number, s: OpStep) => update({ ...def, steps: def.steps.map((x, j) => (j === i ? s : x)) });
  const moveStep = (i: number, d: -1 | 1) => {
    const s = [...def.steps]; const j = i + d;
    if (j < 0 || j >= s.length) return;
    const a = s[i]; const b = s[j];
    if (!a || !b) return;
    s[i] = b; s[j] = a; update({ ...def, steps: s });
  };
  const addStep = (kind: 'form' | 'approval') => {
    const key = nextKey('step', def.steps.map((s) => s.key));
    update({ ...def, steps: [...def.steps, { key, kind, role: kind === 'approval' ? (catalog.approver_roles[0] ?? '') : (roles[0]?.spec_code ?? ''), name_ar: '', fields: [] }] });
    setPreviewStep(def.steps.length);
  };

  return (
    <div className="grid gap-4">
      <Card title={<span><bdi>{op.code}</bdi> · {localName(lang, op.name_ar, op.name_en)}</span>}
        action={<span className="flex flex-wrap gap-1">
          <Pill tone="info">{t(`ops.opset.subjects.${op.subject_kind}`)}</Pill>
          {live && <Pill tone="good">{t('ops.opset.inEffect', { v: live.version_no })}</Pill>}
          {draft && <Pill tone="warn">{t('ops.opset.draft', { v: draft.version_no })}</Pill>}
          {op.retired_at && <Pill tone="neutral">{t('ops.opset.retired')}</Pill>}
        </span>}>
        {op.retired_at && <p className="mb-3 rounded-ops-sm bg-ops-grey p-2 text-sm">{t('ops.opset.retiredNote', { when: fmt.dateTime(op.retired_at), reason: op.retired_reason ?? '' })}</p>}
        <fieldset disabled={readOnly} className="grid gap-4">
          {/* Trigger */}
          <section aria-labelledby="op-trigger" className="grid gap-2">
            <h3 id="op-trigger" className="font-semibold">{t('ops.opset.trigger')}</h3>
            <label className="text-sm">{t('ops.opset.hook')}
              <select className={field} value={def.trigger.hook} onChange={(e) => update({ ...def, trigger: { ...def.trigger, hook: e.target.value } })}>
                {hooks.map((h) => <option key={h.hook} value={h.hook}>{localName(lang, h.label_ar, h.label_en)}</option>)}
              </select>
            </label>
            {subjectFields.length > 0 && (
              <Conditions title={t('ops.opset.onlyWhen')} conds={def.trigger.conditions ?? []} fields={subjectFields.map((f) => ({ value: f, label: t(`ops.opset.facts.${f}`, { defaultValue: f }) }))}
                ops={catalog.condition_ops} onChange={(c) => update({ ...def, trigger: { ...def.trigger, conditions: c } })} />
            )}
          </section>
          {/* Task */}
          <section aria-labelledby="op-task" className="grid gap-2">
            <h3 id="op-task" className="font-semibold">{t('ops.opset.task')}</h3>
            <p className="text-sm text-ops-muted">{t('ops.opset.taskHelp')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm">{t('ops.opset.taskRole')}
                <select className={field} value={def.task?.role ?? ''} onChange={(e) => update({ ...def, task: { ...def.task, role: e.target.value || undefined } })}>
                  <option value="">{t('ops.opset.firstStepRole')}</option>
                  {roles.map((r) => <option key={r.spec_code} value={r.spec_code}>{roleName(lang, roles, r.spec_code)}</option>)}
                </select>
              </label>
              <label className="text-sm">{t('ops.opset.dueMinutes')}
                <input className={field} inputMode="numeric" dir="ltr" value={def.task?.due_minutes ?? ''}
                  onChange={(e) => update({ ...def, task: { ...def.task, due_minutes: e.target.value ? Number(e.target.value) : undefined } })} />
              </label>
              <label className="text-sm">{t('ops.tasks.priority')}
                <select className={field} value={def.task?.priority ?? 'normal'} onChange={(e) => update({ ...def, task: { ...def.task, priority: e.target.value as 'low' | 'normal' | 'high' } })}>
                  {(['low', 'normal', 'high'] as const).map((p) => <option key={p} value={p}>{t(`ops.tasks.priorities.${p}`)}</option>)}
                </select>
              </label>
              <label className="text-sm">{t('ops.tasks.escalateAfter')}
                <input className={field} inputMode="numeric" dir="ltr" value={def.task?.escalate_after_min ?? ''}
                  onChange={(e) => update({ ...def, task: { ...def.task, escalate_after_min: e.target.value ? Number(e.target.value) : undefined } })} />
              </label>
              <label className="text-sm">{t('ops.tasks.escalateTo')}
                <select className={field} value={def.task?.escalate_to_role ?? ''} onChange={(e) => update({ ...def, task: { ...def.task, escalate_to_role: e.target.value || undefined } })}>
                  <option value="">—</option>
                  {roles.map((r) => <option key={r.spec_code} value={r.spec_code}>{roleName(lang, roles, r.spec_code)}</option>)}
                </select>
              </label>
            </div>
          </section>
        </fieldset>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-3">
          <h3 className="font-semibold">{t('ops.opset.steps')}</h3>
          {def.steps.length === 0 && <EmptyState>{t('ops.opset.noSteps')}</EmptyState>}
          {def.steps.map((s, i) => (
            <StepEditor key={i} index={i} step={s} steps={def.steps} catalog={catalog} roles={roles} subjectKind={op.subject_kind} readOnly={readOnly}
              onChange={(x) => setStep(i, x)} onMove={(d) => moveStep(i, d)} onRemove={() => update({ ...def, steps: def.steps.filter((_, j) => j !== i) })}
              onPreview={() => setPreviewStep(i)} previewing={previewStep === i} />
          ))}
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} onClick={() => addStep('form')}>＋ {t('ops.opset.addForm')}</button>
              <button type="button" className={btn} onClick={() => addStep('approval')}>＋ {t('ops.opset.addApproval')}</button>
            </div>
          )}
        </div>
        <Preview def={def} index={previewStep} onIndex={setPreviewStep} roles={roles} />
      </div>

      {errors && errors.length > 0 && (
        <Card title={t('ops.opset.problemsTitle', { n: errors.length })} highlight>
          <ul className="list-disc ps-5 text-sm text-ops-red" role="alert">{errors.map((e, i) => <li key={i}>{opErrorText(t, e)}</li>)}</ul>
        </Card>
      )}
      {errors && errors.length === 0 && !dirty && <p role="status" className="text-sm font-semibold text-ops-green">✓ {t('ops.opset.valid')}</p>}

      {!op.retired_at && canEdit && (
        <Card title={t('ops.opset.saveTitle')}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">{t('ops.opset.changeNote')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            {canPublish && (
              <label className="text-sm">{t('ops.opset.effectiveFrom')}
                <input type="datetime-local" className={field} dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
                <span className="text-xs text-ops-muted">{t('ops.opset.effectiveHelp')}</span>
              </label>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={save}>{t('ops.opset.saveDraft')}</button>
            {canPublish && <button type="button" className={btnPrimary} onClick={publish}>{t('ops.opset.publish')}</button>}
          </div>
          <div className="mt-2"><SaveStatus state={state} onRetry={save} /></div>
        </Card>
      )}
      {op.retired_at && <SaveStatus state={state} />}

      <Card title={t('ops.opset.versions')}>
        <table className="w-full text-sm">
          <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.opset.version')}</th><th className="py-1 text-start font-medium">{t('ops.opset.state')}</th>
            <th className="py-1 text-start font-medium">{t('ops.opset.effectiveFrom')}</th><th className="py-1 text-start font-medium">{t('ops.opset.changeNote')}</th><th /></tr></thead>
          <tbody>
            {op.ph_op_versions.map((v) => (
              <tr key={v.id} className="border-t border-ops-line">
                <td className="py-1"><bdi className="ops-num">v{v.version_no}</bdi></td>
                <td className="py-1">{t(`ops.opset.states.${v.state}`)}{live?.id === v.id ? ` · ${t('ops.opset.current')}` : ''}</td>
                <td className="py-1">{fmt.dateTime(v.effective_from)}</td>
                <td className="py-1">{v.change_note ?? '—'}</td>
                <td className="py-1 text-end">
                  {canPublish && !op.retired_at && (v.state === 'superseded' || v.state === 'published') && live?.id !== v.id && (
                    <button type="button" className={btn} onClick={() => rollback(v.version_no)}>{t('ops.opset.rollback')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ops-muted">{t('ops.opset.pinned')}</p>
      </Card>

      {canPublish && !op.retired_at && live && (
        <Card title={t('ops.opset.retireTitle')}>
          <p className="mb-2 text-sm text-ops-muted">{t('ops.opset.retireHelp')}</p>
          <label className="text-sm">{t('ops.people.reason')}<input className={field} value={retireReason} onChange={(e) => setRetireReason(e.target.value)} /></label>
          <button type="button" className={`${btn} mt-2`} disabled={!retireReason.trim()} onClick={retire}>{t('ops.opset.retire')}</button>
        </Card>
      )}
    </div>
  );
}

function Conditions({ title, conds, fields, ops, onChange }: { title: string; conds: Cond[]; fields: { value: string; label: string }[]; ops: CondOp[]; onChange: (c: Cond[]) => void }) {
  const { t } = useTranslation();
  const set = (i: number, c: Cond) => onChange(conds.map((x, j) => (j === i ? c : x)));
  return (
    <fieldset className="grid gap-2 rounded-ops-sm border border-ops-line p-2">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {conds.length === 0 && <p className="text-xs text-ops-muted">{t('ops.opset.always')}</p>}
      {conds.map((c, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]">
          <select aria-label={t('ops.opset.condField')} className={field} value={c.field} onChange={(e) => set(i, { ...c, field: e.target.value })}>
            {!fields.some((f) => f.value === c.field) && <option value={c.field}>{c.field}</option>}
            {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select aria-label={t('ops.opset.condOp')} className={field} value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as CondOp })}>
            {ops.filter((o) => o !== 'in').map((o) => <option key={o} value={o}>{t(`ops.opset.ops.${o}`)}</option>)}
          </select>
          {c.op === 'empty' ? <span /> : (
            <input aria-label={t('ops.opset.condValue')} className={field} value={typeof c.value === 'string' ? c.value : ''} onChange={(e) => set(i, { ...c, value: e.target.value })} />
          )}
          <button type="button" className={btn} onClick={() => onChange(conds.filter((_, j) => j !== i))}>{t('ops.run.removeRow')}</button>
        </div>
      ))}
      <button type="button" className={btn} disabled={fields.length === 0} onClick={() => onChange([...conds, { field: fields[0]?.value ?? '', op: 'eq', value: '' }])}>＋ {t('ops.opset.addCondition')}</button>
    </fieldset>
  );
}

const FIELD_TYPES: FieldType[] = ['text', 'number', 'select', 'check', 'date', 'datetime', 'photo', 'rows'];

function StepEditor({ index, step, steps, catalog, roles, subjectKind, readOnly, onChange, onMove, onRemove, onPreview, previewing }: {
  index: number; step: OpStep; steps: OpStep[]; catalog: Catalog; roles: RoleOption[]; subjectKind: SubjectKind; readOnly: boolean;
  onChange: (s: OpStep) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onPreview: () => void; previewing: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fields = step.fields ?? [];
  const setField = (i: number, f: OpField) => onChange({ ...step, fields: fields.map((x, j) => (j === i ? f : x)) });
  const roleChoices = step.kind === 'approval' ? roles.filter((r) => catalog.approver_roles.includes(r.spec_code)) : roles;
  const earlier = useMemo(() => [
    ...(catalog.subject_fields[subjectKind] ?? []).map((f) => ({ value: f, label: t(`ops.opset.facts.${f}`, { defaultValue: f }) })),
    ...steps.slice(0, index).flatMap((s) => (s.fields ?? []).map((f) => ({ value: `${s.key}.${f.key}`, label: `${localName(lang, s.name_ar, s.name_en) || s.key} › ${localName(lang, f.label_ar, f.label_en) || f.key}` }))),
  ], [catalog, subjectKind, steps, index, lang, t]);
  return (
    <section className={`ops-card p-3 ${step.disabled ? 'opacity-70' : ''} ${previewing ? 'ops-highlight' : ''}`} aria-label={t('ops.opset.stepN', { n: index + 1 })}>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{t('ops.opset.stepN', { n: index + 1 })} · {step.kind === 'approval' ? t('ops.opset.approval') : t('ops.opset.form')}
          {step.disabled && <span className="ms-2"><Pill tone="neutral">{t('ops.opset.stepRetired')}</Pill></span>}</h4>
        <span className="flex flex-wrap gap-1">
          <button type="button" className={btn} aria-pressed={previewing} onClick={onPreview}>{t('ops.opset.preview')}</button>
          {!readOnly && <>
            <button type="button" className={btn} aria-label={t('ops.opset.moveUp')} onClick={() => onMove(-1)}>↑</button>
            <button type="button" className={btn} aria-label={t('ops.opset.moveDown')} onClick={() => onMove(1)}>↓</button>
            <button type="button" className={btn} onClick={onRemove}>{t('ops.run.removeRow')}</button>
          </>}
        </span>
      </header>
      <fieldset disabled={readOnly} className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">{t('ops.opset.stepNameAr')}<input className={field} value={step.name_ar} onChange={(e) => onChange({ ...step, name_ar: e.target.value })} /></label>
          <label className="text-sm">{t('ops.opset.stepNameEn')}<input className={field} dir="ltr" value={step.name_en ?? ''} onChange={(e) => onChange({ ...step, name_en: e.target.value })} /></label>
          <label className="text-sm">{t('ops.opset.stepRole')}
            <select className={field} value={step.role} onChange={(e) => onChange({ ...step, role: e.target.value })}>
              {!roleChoices.some((r) => r.spec_code === step.role) && <option value={step.role}>{step.role || '—'}</option>}
              {roleChoices.map((r) => <option key={r.spec_code} value={r.spec_code}>{roleName(lang, roles, r.spec_code)}</option>)}
            </select>
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={!!step.disabled} onChange={(e) => onChange({ ...step, disabled: e.target.checked || undefined })} />
            {t('ops.opset.retireStep')}
          </label>
        </div>
        {step.kind === 'approval' && <p className="text-sm text-ops-muted">{t('ops.opset.approvalHelp')}</p>}

        {step.kind === 'form' && (
          <div className="grid gap-2">
            <h5 className="text-sm font-semibold">{t('ops.opset.fields')}</h5>
            {fields.map((f, i) => (
              <FieldEditor key={i} index={i} f={f} catalog={catalog} onChange={(x) => setField(i, x)} onRemove={() => onChange({ ...step, fields: fields.filter((_, j) => j !== i) })} />
            ))}
            {!readOnly && (
              <button type="button" className={btn} onClick={() => onChange({ ...step, fields: [...fields, { key: nextKey('field', fields.map((f) => f.key)), type: 'text', label_ar: '' }] })}>
                ＋ {t('ops.opset.addField')}
              </button>
            )}
            <Conditions title={t('ops.opset.passIf')} conds={step.pass_if ?? []}
              fields={fields.map((f) => ({ value: f.key, label: localName(lang, f.label_ar, f.label_en) || f.key }))}
              ops={catalog.condition_ops} onChange={(c) => onChange({ ...step, pass_if: c })} />
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">{t('ops.opset.onFail')}
            <select className={field} value={step.on_fail?.action ?? 'block'} onChange={(e) => onChange({ ...step, on_fail: { ...step.on_fail, action: e.target.value as 'block' | 'hold' } })}>
              <option value="block">{t('ops.opset.failBlock')}</option>
              {subjectKind === 'load' && <option value="hold">{t('ops.opset.failHold')}</option>}
            </select>
          </label>
          <label className="text-sm">{t('ops.opset.goto')}
            <select className={field} value={step.on_fail?.goto ?? ''} onChange={(e) => onChange({ ...step, on_fail: { ...step.on_fail, goto: e.target.value || undefined } })}>
              <option value="">{t('ops.opset.stay')}</option>
              {steps.map((s, j) => <option key={s.key} value={s.key}>{t('ops.opset.stepN', { n: j + 1 })} · {localName(lang, s.name_ar, s.name_en) || s.key}</option>)}
            </select>
          </label>
        </div>
        <Conditions title={t('ops.opset.showIf')} conds={step.show_if ?? []} fields={earlier} ops={catalog.condition_ops} onChange={(c) => onChange({ ...step, show_if: c })} />
      </fieldset>
    </section>
  );
}

function FieldEditor({ index, f, catalog, onChange, onRemove }: { index: number; f: OpField; catalog: Catalog; onChange: (f: OpField) => void; onRemove: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <div role="group" aria-label={t('ops.opset.fieldN', { n: index + 1 })} className="grid gap-2 rounded-ops-sm border border-ops-line p-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem]">
        <label className="text-xs">{t('ops.opset.labelAr')}<input className={field} value={f.label_ar} onChange={(e) => onChange({ ...f, label_ar: e.target.value })} /></label>
        <label className="text-xs">{t('ops.opset.labelEn')}<input className={field} dir="ltr" value={f.label_en ?? ''} onChange={(e) => onChange({ ...f, label_en: e.target.value })} /></label>
        <label className="text-xs">{t('ops.opset.fieldType')}
          <select className={field} value={f.type} onChange={(e) => onChange({ ...f, type: e.target.value as FieldType })}>
            {FIELD_TYPES.map((ty) => <option key={ty} value={ty}>{t(`ops.opset.types.${ty}`)}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">{t('ops.opset.fieldKey')}<input className={`${field} w-40`} dir="ltr" value={f.key} onChange={(e) => onChange({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={!!f.required} onChange={(e) => onChange({ ...f, required: e.target.checked || undefined })} />{t('ops.run.required')}</label>
        {f.type === 'number' && <>
          <label className="text-xs">{t('ops.opset.unit')}
            <select className={field} value={f.unit ?? ''} onChange={(e) => onChange({ ...f, unit: e.target.value || undefined })}>
              <option value="">—</option>
              {catalog.units.map((u) => <option key={u.code} value={u.code}>{localName(i18n.language, u.name_ar, u.name_en)} ({u.code})</option>)}
            </select>
          </label>
          <label className="text-xs">{t('ops.opset.min')}<input className={`${field} w-24`} dir="ltr" inputMode="decimal" value={f.min ?? ''} onChange={(e) => onChange({ ...f, min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <label className="text-xs">{t('ops.opset.max')}<input className={`${field} w-24`} dir="ltr" inputMode="decimal" value={f.max ?? ''} onChange={(e) => onChange({ ...f, max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        </>}
        <button type="button" className={btn} onClick={onRemove}>{t('ops.run.removeRow')}</button>
      </div>
      {f.type === 'select' && (
        <div className="grid gap-1">
          <span className="text-xs font-medium">{t('ops.opset.options')}</span>
          {(f.options ?? []).map((o, i) => (
            <div key={i} className="grid gap-1 sm:grid-cols-[8rem_1fr_1fr_auto]">
              <input aria-label={t('ops.opset.optionValue')} className={field} dir="ltr" value={o.value} onChange={(e) => onChange({ ...f, options: (f.options ?? []).map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <input aria-label={t('ops.opset.labelAr')} className={field} value={o.label_ar} onChange={(e) => onChange({ ...f, options: (f.options ?? []).map((x, j) => (j === i ? { ...x, label_ar: e.target.value } : x)) })} />
              <input aria-label={t('ops.opset.labelEn')} className={field} dir="ltr" value={o.label_en ?? ''} onChange={(e) => onChange({ ...f, options: (f.options ?? []).map((x, j) => (j === i ? { ...x, label_en: e.target.value } : x)) })} />
              <button type="button" className={btn} onClick={() => onChange({ ...f, options: (f.options ?? []).filter((_, j) => j !== i) })}>{t('ops.run.removeRow')}</button>
            </div>
          ))}
          <button type="button" className={btn} onClick={() => onChange({ ...f, options: [...(f.options ?? []), { value: '', label_ar: '' }] })}>＋ {t('ops.opset.addOption')}</button>
        </div>
      )}
      {f.type === 'rows' && (
        <div className="grid gap-1">
          <span className="text-xs font-medium">{t('ops.opset.columns')}</span>
          {(f.columns ?? []).map((c, i) => (
            <div key={i} className="grid gap-1 sm:grid-cols-[8rem_1fr_7rem_auto]">
              <input aria-label={t('ops.opset.fieldKey')} className={field} dir="ltr" value={c.key} onChange={(e) => onChange({ ...f, columns: (f.columns ?? []).map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') } : x)) })} />
              <input aria-label={t('ops.opset.labelAr')} className={field} value={c.label_ar} onChange={(e) => onChange({ ...f, columns: (f.columns ?? []).map((x, j) => (j === i ? { ...x, label_ar: e.target.value } : x)) })} />
              <select aria-label={t('ops.opset.fieldType')} className={field} value={c.type} onChange={(e) => onChange({ ...f, columns: (f.columns ?? []).map((x, j) => (j === i ? { ...x, type: e.target.value as 'text' | 'number' } : x)) })}>
                <option value="text">{t('ops.opset.types.text')}</option><option value="number">{t('ops.opset.types.number')}</option>
              </select>
              <button type="button" className={btn} onClick={() => onChange({ ...f, columns: (f.columns ?? []).filter((_, j) => j !== i) })}>{t('ops.run.removeRow')}</button>
            </div>
          ))}
          <button type="button" className={btn} onClick={() => onChange({ ...f, columns: [...(f.columns ?? []), { key: nextKey('col', (f.columns ?? []).map((c) => c.key)), label_ar: '', type: 'text' }] })}>＋ {t('ops.opset.addColumn')}</button>
        </div>
      )}
    </div>
  );
}

/** Live preview: the step as the assigned person will see it, with sample values, show-if and the pass rule evaluated. */
function Preview({ def, index, onIndex, roles }: { def: OpDef; index: number; onIndex: (i: number) => void; roles: RoleOption[] }) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<Record<string, Values>>({});
  useEffect(() => { if (index >= def.steps.length && def.steps.length > 0) onIndex(def.steps.length - 1); }, [def.steps.length, index, onIndex]);
  const step = def.steps[index];
  const facts: Values = {};
  for (const [sk, vals] of Object.entries(values)) for (const [fk, v] of Object.entries(vals)) facts[`${sk}.${fk}`] = v;
  const shown = step ? condsHold(facts, step.show_if) : false;
  const passes = step?.kind === 'form' ? condsHold(values[step.key] ?? {}, step.pass_if) : null;
  return (
    <aside className="ops-card ops-glass sticky top-4 grid content-start gap-3 self-start p-3" aria-label={t('ops.opset.previewTitle')}>
      <h3 className="font-semibold">{t('ops.opset.previewTitle')}</h3>
      {def.steps.length === 0 ? <p className="text-sm text-ops-muted">{t('ops.opset.noSteps')}</p> : (
        <>
          <select aria-label={t('ops.opset.previewStep')} className={field} value={index} onChange={(e) => onIndex(Number(e.target.value))}>
            {def.steps.map((s, i) => <option key={i} value={i}>{t('ops.opset.stepN', { n: i + 1 })} · {localName(i18n.language, s.name_ar, s.name_en) || s.key}</option>)}
          </select>
          {step && (
            <div className="mx-auto w-full max-w-[390px] rounded-[1.25rem] border border-ops-line bg-ops-surface p-3 shadow-ops">
              <p className="text-xs text-ops-muted">{t('ops.opset.previewFor', { role: roleName(i18n.language, roles, step.role) })}</p>
              <h4 className="mb-2 text-lg font-bold">{localName(i18n.language, step.name_ar, step.name_en) || t('ops.opset.untitled')}</h4>
              {step.disabled && <p className="mb-2 text-sm text-ops-muted">{t('ops.opset.stepRetiredPreview')}</p>}
              {!step.disabled && !shown && <p className="mb-2 text-sm text-ops-amber">{t('ops.opset.skippedPreview')}</p>}
              {step.kind === 'approval' ? (
                <div className="grid gap-2">
                  <p className="text-sm">{t('ops.opset.approvalHelp')}</p>
                  <div className="flex gap-2"><button type="button" className={btnPrimary} disabled>{t('ops.run.approve')}</button><button type="button" className={btn} disabled>{t('ops.run.reject')}</button></div>
                </div>
              ) : (
                <>
                  <FormRenderer preview fields={step.fields ?? []} values={values[step.key] ?? {}} onChange={(v) => setValues({ ...values, [step.key]: v })} />
                  {(step.pass_if ?? []).length > 0 && (
                    <p className="mt-2 text-sm" role="status">{passes ? <Pill tone="good">{t('ops.run.wouldPass')}</Pill> : <Pill tone="bad">{t('ops.run.wouldFail')}</Pill>}</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
