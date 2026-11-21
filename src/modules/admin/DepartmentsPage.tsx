import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { can } from '@/core/rbac/access';
import { requireSupabase } from '@/core/supabase';
import { errorKey } from '@/core/errors';
import { VerificationBadge, type VerificationStatus } from '@/core/components/VerificationBadge';
import { localName, rpc, useMyPermissions } from '@/modules/ops/api';
import { btn, btnPrimary, Card, DataTable, field, Loaded, Modal, PageTitle, Pill } from '@/modules/ops/ui';

interface Department {
  id: string;
  code: string;
  version: number;
  name_ar: string;
  name_en: string | null;
  kind: string;
  is_independent: boolean;
  verification_status: VerificationStatus;
}

const kinds = ['production', 'production_support', 'service', 'quality', 'coordination'];

export default function DepartmentsPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const permissions = useMyPermissions();
  const farmId = access?.farmId;
  const admin = permissions.data?.has('settings.authority');
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [saved, setSaved] = useState(false);
  const q = useQuery({
    queryKey: ['departments', farmId],
    enabled: !!farmId,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('departments')
        .select('id, code, version, name_ar, name_en, kind, is_independent, verification_status')
        .eq('farm_id', farmId ?? '').is('voided_at', null).order('sort_order').order('code').returns<Department[]>();
      if (error) throw error;
      return data;
    },
  });
  function edit(row: Department | 'new') { setSaved(false); setEditing(row); }
  return (
    <section>
      <PageTitle title={t('admin.departmentsTitle')} actions={(admin || can(access, 'department', 'create')) &&
        <button className={btnPrimary} onClick={() => edit('new')}>{t('org.new')}</button>} />
      {saved && <p className="mb-3 text-sm text-ops-green" role="status">{t('common.saved')}</p>}
      <Card>
        <Loaded query={q}>{(rows) => (
          <DataTable label={t('admin.departmentsTitle')} rows={rows} searchable columns={[
            { key: 'code', header: t('common.code'), sort: r => r.code, render: r => <bdi className="font-semibold">{r.code}</bdi> },
            { key: 'name', header: t('md.department'), sort: r => localName(i18n.language, r.name_ar, r.name_en),
              search: r => [r.name_ar, r.name_en].join(' '), render: r => <>{localName(i18n.language, r.name_ar, r.name_en)}
                {r.is_independent && <span className="ms-2"><Pill tone="info">{t('admin.independent')}</Pill></span>}</> },
            { key: 'kind', header: t('common.type'), sort: r => t('org.kind.' + r.kind), render: r => t('org.kind.' + r.kind) },
            { key: 'state', header: t('common.status'), render: r => <VerificationBadge status={r.verification_status} /> },
            { key: 'actions', header: t('common.actions'), render: r => (admin || can(access, 'department', 'configure', {departmentId:r.id})) &&
              <button className={btn} onClick={() => edit(r)}>{t('ops.md.edit')}</button> },
          ]} />
        )}</Loaded>
      </Card>
      {editing && farmId && <DepartmentEditor row={editing === 'new' ? null : editing} farmId={farmId}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved(true); }} />}
    </section>
  );
}

function DepartmentEditor({row, farmId, onClose, onSaved}: {
  row: Department | null; farmId: string; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(''); setBusy(true);
    try {
      await rpc('ph_save_department', {p_farm: farmId, p_id: row?.id ?? null, p_version: row?.version ?? null,
        p_code: row?.code ?? data.get('code'), p_name_ar: data.get('ar'), p_name_en: data.get('en'),
        p_kind: row?.is_independent ? row.kind : data.get('kind')});
      await Promise.all([qc.invalidateQueries({queryKey:['departments']}), qc.invalidateQueries({queryKey:['lookup', 'departments']})]);
      onSaved();
    } catch (e) { setError(errorKey(e)); } finally { setBusy(false); }
  }
  return <Modal open onClose={() => { if (!busy) onClose(); }} title={row ? t('ops.md.editing', {code:row.code}) : t('org.new')}>
    <form className="grid gap-4" onSubmit={save}>
      <label>{t('common.code')}<input className={field} name="code" dir="ltr" required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" defaultValue={row?.code} readOnly={!!row} /></label>
      <label>{t('common.nameAr')}<input className={field} name="ar" required maxLength={200} defaultValue={row?.name_ar} /></label>
      <label>{t('common.nameEn')}<input className={field} name="en" maxLength={200} defaultValue={row?.name_en ?? ''} /></label>
      <label>{t('common.type')}<select className={field} name="kind" required disabled={row?.is_independent} defaultValue={row?.kind ?? ''}>
        <option value="">—</option>{kinds.map(k => <option key={k} value={k}>{t('org.kind.' + k)}</option>)}
      </select></label>
      {error && <p role="alert" className="text-sm text-ops-red">{t(error)}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={btn} onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className={btnPrimary} disabled={busy}>{t(busy ? 'ops.save.pending' : 'common.save')}</button></div>
    </form>
  </Modal>;
}
