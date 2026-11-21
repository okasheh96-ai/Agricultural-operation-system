import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadPhoto } from '@/modules/packing-house/api';
import { localName, opsErrorMessage } from '../api';
import { btn, field as fieldCls } from '../ui';
import type { OpField, Values } from './types';

/** Renders the fields of one step. The same component draws the Settings preview and the live form, so what the Owner sees
 *  while editing is what the person on the floor gets. The server re-checks required fields, ranges and choices. */
export function FormRenderer({ fields, values, onChange, disabled = false, preview = false }: {
  fields: OpField[]; values: Values; onChange: (v: Values) => void; disabled?: boolean; preview?: boolean;
}) {
  const { t } = useTranslation();
  if (fields.length === 0) return <p className="text-sm text-ops-muted">{t('ops.run.noFields')}</p>;
  return (
    <div className="grid gap-3">
      {fields.map((f) => (
        <FieldInput key={f.key} f={f} value={values[f.key]} disabled={disabled} preview={preview}
          onChange={(v) => onChange({ ...values, [f.key]: v })} />
      ))}
    </div>
  );
}

function FieldInput({ f, value, onChange, disabled, preview }: { f: OpField; value: unknown; onChange: (v: unknown) => void; disabled: boolean; preview: boolean }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const label = localName(i18n.language, f.label_ar, f.label_en) || f.key;
  const help = localName(i18n.language, f.help_ar, f.help_en);
  const unit = f.unit ? t(`ops.units.${f.unit}`, { defaultValue: f.unit }) : '';
  const head = (
    <label htmlFor={id} className="mb-1 block text-sm font-medium">
      {label}{unit ? <span className="ms-1 text-ops-muted">({unit})</span> : null}
      {f.required ? <span className="ms-1 text-ops-red" aria-hidden="true">*</span> : null}
      {f.required ? <span className="sr-only">{t('ops.run.required')}</span> : null}
    </label>
  );
  const str = value === undefined || value === null ? '' : String(value);
  let input;
  switch (f.type) {
    case 'number':
      input = (
        <input id={id} className={fieldCls} inputMode="decimal" dir="ltr" value={str} disabled={disabled} required={f.required}
          aria-describedby={help ? `${id}-h` : undefined} onChange={(e) => onChange(e.target.value.replace(',', '.'))} />
      );
      break;
    case 'select':
      input = (
        <select id={id} className={fieldCls} value={str} disabled={disabled} required={f.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('ops.run.choose')}</option>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{localName(i18n.language, o.label_ar, o.label_en) || o.value}</option>)}
        </select>
      );
      break;
    case 'date':
      input = <input id={id} type="date" className={fieldCls} dir="ltr" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'datetime':
      input = <input id={id} type="datetime-local" className={fieldCls} dir="ltr" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'check':
      return (
        <fieldset disabled={disabled}>
          <legend className="mb-1 text-sm font-medium">{label}{f.required ? <span className="ms-1 text-ops-red" aria-hidden="true">*</span> : null}</legend>
          <div className="flex gap-2">
            {[true, false].map((b) => (
              <label key={String(b)} className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-ops-sm border px-3 text-sm font-semibold ${value === b ? 'border-ops-accent bg-ops-soft text-ops-accent' : 'border-ops-line'}`}>
                <input type="radio" className="sr-only" name={id} checked={value === b} onChange={() => onChange(b)} />
                {b ? t('ops.yes') : t('ops.no')}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case 'photo':
      return <PhotoInput id={id} head={head} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} disabled={disabled || preview} />;
    case 'rows':
      return <RowsInput f={f} label={label} value={Array.isArray(value) ? (value as Values[]) : []} onChange={onChange} disabled={disabled} />;
    default:
      input = <input id={id} className={fieldCls} value={str} disabled={disabled} required={f.required} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="min-w-0">
      {head}
      {input}
      {help && <p id={`${id}-h`} className="mt-1 text-xs text-ops-muted">{help}</p>}
      {f.type === 'number' && (f.min !== undefined || f.max !== undefined) && (
        <p className="mt-1 text-xs text-ops-muted">{t('ops.run.range', { min: f.min ?? '—', max: f.max ?? '—' })}</p>
      )}
    </div>
  );
}

function PhotoInput({ id, head, value, onChange, disabled }: { id: string; head: React.ReactNode; value: string[]; onChange: (v: unknown) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="min-w-0">
      {head}
      <input id={id} type="file" accept="image/*" capture="environment" disabled={disabled || busy} className="block w-full text-sm"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true); setErr('');
          try { onChange([...value, (await uploadPhoto(file, '')).id]); } catch (x) { setErr(opsErrorMessage(t, x)); } finally { setBusy(false); e.target.value = ''; }
        }} />
      <p className="mt-1 text-xs text-ops-muted" role="status">{busy ? t('ops.save.pending') : t('ops.run.photos', { n: value.length })}</p>
      {err && <p role="alert" className="text-sm text-ops-red">{err}</p>}
    </div>
  );
}

function RowsInput({ f, label, value, onChange, disabled }: { f: OpField; label: string; value: Values[]; onChange: (v: unknown) => void; disabled: boolean }) {
  const { t, i18n } = useTranslation();
  const cols = f.columns && f.columns.length > 0 ? f.columns : [{ key: 'value', label_ar: label, type: 'text' as const }];
  const set = (i: number, k: string, v: string) => onChange(value.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 text-sm font-medium">{label}{f.required ? <span className="ms-1 text-ops-red" aria-hidden="true">*</span> : null}</legend>
      <div className="grid gap-2">
        {value.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-ops-sm border border-ops-line p-2">
            {cols.map((c) => (
              <label key={c.key} className="min-w-[8rem] flex-1 text-xs">
                <span className="mb-1 block text-ops-muted">{localName(i18n.language, c.label_ar, c.label_en)}</span>
                <input className={fieldCls} inputMode={c.type === 'number' ? 'decimal' : undefined} dir={c.type === 'number' ? 'ltr' : undefined}
                  value={String(r[c.key] ?? '')} onChange={(e) => set(i, c.key, e.target.value)} />
              </label>
            ))}
            <button type="button" className={btn} onClick={() => onChange(value.filter((_, j) => j !== i))}>{t('ops.run.removeRow')}</button>
          </div>
        ))}
        <button type="button" className={btn} onClick={() => onChange([...value, {}])}>{t('ops.run.addRow')}</button>
      </div>
    </fieldset>
  );
}
