import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { useAuth } from '@/core/auth/AuthProvider';
import { can } from '@/core/rbac/access';
import { errorKey } from '@/core/errors';
import { matchesSearch } from '@/core/i18n/normalizeArabic';
import { QueryState } from '@/core/components/QueryState';
import { VerificationBadge, type VerificationStatus } from '@/core/components/VerificationBadge';
import { LOCATION_TYPES, newLocationSchema } from './locationSchema';

interface LocationRow {
  id: string;
  parent_id: string | null;
  code: string;
  name_ar: string;
  name_en: string | null;
  type: (typeof LOCATION_TYPES)[number];
  area_value: string | number | null;
  area_basis: string;
  path: string[];
  verification_status: VerificationStatus;
  units: { code: string } | null;
}

export default function LocationsPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name_ar: '', name_en: '', type: 'block', parent_id: '' });

  const q = useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('locations')
        .select('id, parent_id, code, name_ar, name_en, type, area_value, area_basis, path, verification_status, units(code)')
        .is('voided_at', null)
        .order('code')
        .returns<LocationRow[]>();
      if (error) throw error;
      return data;
    },
  });

  const byId = new Map(q.data?.map((l) => [l.id, l]));
  const label = (l: LocationRow) => (i18n.language === 'en' && l.name_en ? l.name_en : l.name_ar);
  const rows = (q.data ?? [])
    .filter((l) => matchesSearch(`${l.code} ${l.name_ar} ${l.name_en ?? ''}`, search))
    .sort((a, b) => a.path.map((id) => byId.get(id)?.code ?? '').join('/').localeCompare(b.path.map((id) => byId.get(id)?.code ?? '').join('/')));

  // Farm-wide create right; department-scoped managers create inside their department in Phase 1b forms.
  const mayCreate = can(access, 'location', 'create', { departmentId: null });

  const create = useMutation({
    mutationFn: async () => {
      const parsed = newLocationSchema.safeParse({ ...form, parent_id: form.parent_id || null });
      if (!parsed.success) throw { code: 'validation', key: parsed.error.issues[0]?.message ?? 'errors.unknown' };
      const { error } = await requireSupabase().from('locations').insert({ ...parsed.data, farm_id: access?.farmId });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ code: '', name_ar: '', name_en: '', type: 'block', parent_id: '' });
      setFormError(null);
      void qc.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (e: unknown) =>
      setFormError(typeof e === 'object' && e && 'key' in e ? String((e as { key: string }).key) : errorKey(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  const input = 'min-h-touch rounded border border-stone-300 px-3';
  return (
    <section>
      <h1 className="mb-4 text-xl font-bold">{t('admin.locationsTitle')}</h1>

      {mayCreate && (
        <form onSubmit={onSubmit} className="mb-6 grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
          <h2 className="font-semibold sm:col-span-2 lg:col-span-3">{t('admin.addLocation')}</h2>
          <label className="flex flex-col gap-1"><span>{t('common.code')}</span>
            <input dir="ltr" className={input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label className="flex flex-col gap-1"><span>{t('common.nameAr')}</span>
            <input dir="rtl" className={input} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></label>
          <label className="flex flex-col gap-1"><span>{t('common.nameEn')}</span>
            <input dir="ltr" className={input} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></label>
          <label className="flex flex-col gap-1"><span>{t('common.type')}</span>
            <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {LOCATION_TYPES.map((lt) => <option key={lt} value={lt}>{t(`admin.locationTypes.${lt}`)}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span>{t('common.parent')}</span>
            <select className={input} value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
              <option value="">{t('common.none')}</option>
              {(q.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} · {label(l)}</option>)}
            </select></label>
          <div className="flex items-end gap-3">
            <button type="submit" disabled={create.isPending} className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">
              {t('common.save')}
            </button>
            {formError && <p role="alert" className="text-red-700">{t(formError)}</p>}
          </div>
        </form>
      )}

      <label className="mb-3 flex max-w-sm flex-col gap-1"><span>{t('common.search')}</span>
        <input type="search" className={input} value={search} onChange={(e) => setSearch(e.target.value)} /></label>

      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={rows.length === 0} onRetry={() => void q.refetch()}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse bg-white text-start">
            <thead><tr className="border-b bg-stone-100">
              <th className="p-2 text-start">{t('common.code')}</th>
              <th className="p-2 text-start">{t('common.nameAr')}</th>
              <th className="p-2 text-start">{t('common.type')}</th>
              <th className="p-2 text-end">{t('admin.area')}</th>
              <th className="p-2 text-start">{t('common.status')}</th>
            </tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="p-2"><span style={{ paddingInlineStart: `${(l.path.length - 1) * 1}rem` }}><bdi>{l.code}</bdi></span></td>
                  <td className="p-2">{label(l)}</td>
                  <td className="p-2">{t(`admin.locationTypes.${l.type}`)}</td>
                  <td className="p-2 text-end">
                    {l.area_value ? <bdi>{l.area_value} {l.units?.code}</bdi> : t('common.none')}
                    {l.area_value && <span className="ms-1 text-xs text-stone-500">({t(`admin.areaBasis.${l.area_basis}`)})</span>}
                  </td>
                  <td className="p-2"><VerificationBadge status={l.verification_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </section>
  );
}
