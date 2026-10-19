import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { useLookup, type Evidence } from './api';
import { EvidenceBadge, When } from './ui';

interface Param { id: string; code: string; version_no: number; area: string; value_numeric: string | null; value_text: string | null; unit_code: string | null;
  evidence: Evidence; basis_label: string; source: string; decision_code: string | null; label_en: string; label_ar: string; state: string; effective_from: string }
interface Template { id: string; inspection_type: string; version_no: number; items: { code: string; en: string; ar: string }[]; evidence: Evidence; source: string;
  note: string | null; state: string }

/** Rule parameters (FR-MD-07) and inspection templates (FR-QG-07): the values rules use, with their source and label. */
export default function ConfigPage() {
  const { t, i18n } = useTranslation();
  const params = useLookup<Param>('params', 'ph_rule_parameters', '*');
  const templates = useLookup<Template>('templates', 'ph_inspection_templates', '*');
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t('ph.config.title')}</h1>
        <p className="text-sm text-stone-700">{t('ph.config.intro')}</p>
      </div>
      <QueryState isLoading={params.isLoading} error={params.error} isEmpty={(params.data ?? []).length === 0} onRetry={() => void params.refetch()}>
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead><tr className="border-b bg-stone-100">
              <th className="p-2 text-start">{t('ph.config.rule')}</th><th className="p-2 text-start">{t('ph.config.value')}</th>
              <th className="p-2 text-start">{t('ph.config.basis')}</th><th className="p-2 text-start">{t('ph.config.source')}</th>
              <th className="p-2 text-start">{t('ph.config.effective')}</th></tr></thead>
            <tbody>
              {(params.data ?? []).sort((a, b) => a.code.localeCompare(b.code)).map((p) => (
                <tr key={p.id} className="border-b align-top">
                  <td className="p-2">{i18n.language === 'en' ? p.label_en : p.label_ar}<div className="font-mono text-xs text-stone-400"><bdi>{p.code} · v{p.version_no}</bdi></div></td>
                  <td className="p-2 font-semibold">{p.state === 'pending_decision'
                    ? <span className="text-amber-800">{t('verification.not_yet_verified')}{p.decision_code ? ` (${p.decision_code})` : ''}</span>
                    : <bdi>{p.value_numeric ?? p.value_text} {p.unit_code !== 'time' ? p.unit_code : ''}</bdi>}</td>
                  <td className="p-2"><EvidenceBadge evidence={p.evidence} compact /> {p.basis_label}</td>
                  <td className="p-2 text-stone-600">{p.source}</td>
                  <td className="p-2"><When iso={p.effective_from} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
      <h2 className="text-lg font-semibold">{t('ph.config.templates')}</h2>
      <QueryState isLoading={templates.isLoading} error={templates.error} isEmpty={(templates.data ?? []).length === 0}>
        <div className="grid gap-3 md:grid-cols-2">
          {(templates.data ?? []).map((tpl) => (
            <section key={tpl.id} className="rounded-lg border bg-white p-3">
              <h3 className="flex flex-wrap items-center gap-2 font-semibold">{t(`ph.inspectionType.${tpl.inspection_type}`)} <span className="text-xs text-stone-500">v{tpl.version_no}</span>
                <EvidenceBadge evidence={tpl.evidence} compact /><span className="text-xs font-normal text-stone-500">{tpl.source}</span></h3>
              {tpl.note && <p className="text-xs text-stone-600">{tpl.note}</p>}
              <ol className="mt-1 list-inside list-decimal text-sm">{tpl.items.map((it) => <li key={it.code}>{i18n.language === 'en' ? it.en : it.ar}</li>)}</ol>
            </section>
          ))}
        </div>
      </QueryState>
    </section>
  );
}
