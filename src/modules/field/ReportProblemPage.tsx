import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { withDeviceCache } from '@/core/data/cache';
import { loadTask, localized } from '@/core/data/tasks';
import { queueInsert, queueTransition } from '@/core/offline/sync';
import { can } from '@/core/rbac/access';

interface Category { id: string; code: string; name_ar: string; name_en: string | null }

/** Block reason implied by the seeded categories; any other (farm-configured) category blocks as "other". */
const BLOCK_REASON_BY_CATEGORY: Record<string, string> = {
  equipment_breakdown: 'equipment',
  irrigation_water: 'water',
  material_shortage: 'material',
};
interface Named { id: string; code: string; name_ar: string; name_en: string | null }

/** Anyone can report a problem in ≤ 3 taps: type → (urgency, words) → send. Works offline. */
export default function ReportProblemPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const taskId = params.get('task');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState(3);
  const [description, setDescription] = useState('');
  const [asset, setAsset] = useState('');
  const [block, setBlock] = useState(true);
  const [saved, setSaved] = useState(false);

  const categories = useQuery({ queryKey: ['problem_categories'], networkMode: 'always', queryFn: () => withDeviceCache('problem_categories', async () => {
    const { data, error } = await requireSupabase().from('problem_categories').select('id, code, name_ar, name_en').is('voided_at', null).order('sort_order');
    if (error) throw error;
    return data as Category[];
  }) });
  const assets = useQuery({ queryKey: ['assets'], networkMode: 'always', queryFn: () => withDeviceCache('assets', async () => {
    const { data, error } = await requireSupabase().from('assets').select('id, code, name_ar, name_en').is('voided_at', null).order('code');
    if (error) throw error;
    return data as Named[];
  }) });
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => loadTask(taskId as string), enabled: !!taskId, networkMode: 'always' });
  const tk = task.data;
  const mayBlock = !!tk && ['assigned', 'in_progress'].includes(tk.status)
    && can(access, 'task', 'execute', { departmentId: tk.department_id, locationPath: tk.location_path ?? [] });

  async function submit() {
    if (!access || !category || !description.trim()) return;
    const id = crypto.randomUUID();
    await queueInsert(qc, {
      table: 'problem_reports',
      entityId: tk?.id ?? id,
      row: {
        id, farm_id: access.farmId, category_id: category, priority, description: description.trim(),
        asset_id: asset || tk?.asset_id || null, location_id: tk?.location_id ?? null, task_id: tk?.id ?? null,
      },
    });
    if (tk && mayBlock && block) {
      const code = categories.data?.find((c) => c.id === category)?.code ?? '';
      const reason = BLOCK_REASON_BY_CATEGORY[code] ?? 'other';
      await queueTransition(qc, { entityType: 'tasks', entityId: tk.id, dependsOn: [],
        payload: { toStatus: 'blocked', fields: { blocked_reason: reason, blocked_note: description.trim(), blocked_problem_report_id: id } } });
    }
    setSaved(true);
    if (tk) navigate(`/field/tasks/${tk.id}`);
  }

  const input = 'min-h-touch rounded border border-stone-300 px-3';
  if (saved && !tk) {
    return <p role="status" className="rounded bg-green-50 p-4 text-lg text-green-900">✓ {t('problems.submitted')}</p>;
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h1 className="text-xl font-bold">{t('problems.reportTitle')}</h1>
      {tk && <p className="rounded bg-stone-100 p-2"><bdi>{tk.code}</bdi> — {tk.title}</p>}
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1 font-semibold">{t('problems.category')}</legend>
        {categories.data?.map((c) => (
          <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}
            className={`min-h-[56px] rounded-lg border-2 px-2 ${category === c.id ? 'border-brand bg-brand-light font-semibold' : 'border-stone-300 bg-white'}`}>
            {localized(i18n.language, c.name_ar, c.name_en)}
          </button>
        ))}
      </fieldset>
      <fieldset className="flex gap-2">
        <legend className="mb-1 font-semibold">{t('problems.priority')}</legend>
        {[1, 2, 3, 4].map((p) => (
          <button key={p} type="button" aria-pressed={priority === p} onClick={() => setPriority(p)}
            className={`min-h-touch flex-1 rounded border-2 ${priority === p ? 'border-brand bg-brand-light font-semibold' : 'border-stone-300 bg-white'}`}>
            {t(`work.priorities.${p}`)}
          </button>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1"><span className="font-semibold">{t('problems.description')}</span>
        <textarea required rows={3} className="rounded border border-stone-300 p-2" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      {!tk?.asset_id && (
        <label className="flex flex-col gap-1"><span>{t('problems.asset')}</span>
          <select className={input} value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="">—</option>
            {assets.data?.map((a) => <option key={a.id} value={a.id}>{a.code} · {localized(i18n.language, a.name_ar, a.name_en)}</option>)}
          </select></label>
      )}
      {mayBlock && (
        <label className="flex min-h-touch items-center gap-2">
          <input type="checkbox" className="h-6 w-6" checked={block} onChange={(e) => setBlock(e.target.checked)} />
          {t('problems.alsoBlock')}
        </label>
      )}
      <button type="submit" disabled={!category || !description.trim()}
        className="min-h-[56px] rounded-lg bg-amber-600 px-4 text-lg font-semibold text-white disabled:opacity-60">
        {t('problems.submit')}
      </button>
    </form>
  );
}
