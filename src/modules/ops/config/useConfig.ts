import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { requireSupabase } from '@/core/supabase';
import { rpc } from '../api';
import type { Catalog, OpDef, OpError, SubjectKind } from './types';

const db = () => requireSupabase();

export function useCatalog() {
  return useQuery({ queryKey: ['ops', 'config-catalog'], staleTime: 5 * 60_000, queryFn: () => rpc<Catalog>('ph_config_catalog') });
}

export interface RoleOption { spec_code: string; is_custom: boolean; roles: { name_ar: string; name_en: string | null } | null }
export function useRoleOptions() {
  return useQuery({ queryKey: ['ops', 'ph-roles'], staleTime: 5 * 60_000, queryFn: async () => {
    const { data, error } = await db().from('ph_roles').select('spec_code, is_custom, evidence, roles(name_ar, name_en)').is('voided_at', null).order('sort_order');
    if (error) throw error;
    return (data ?? []) as unknown as RoleOption[];
  } });
}

export interface OpVersion { id: string; version_no: number; state: 'draft' | 'published' | 'superseded' | 'discarded'; effective_from: string | null;
  published_at: string | null; change_note: string | null; definition: OpDef }
export interface OpType { id: string; code: string; name_ar: string; name_en: string | null; subject_kind: SubjectKind; retired_at: string | null;
  retired_reason: string | null; nav_visible: boolean; ph_op_versions: OpVersion[] }

export function useOpTypes() {
  return useQuery({ queryKey: ['ops', 'op-types'], queryFn: async () => {
    const { data, error } = await db().from('ph_op_types')
      .select('id, code, name_ar, name_en, subject_kind, retired_at, retired_reason, nav_visible, ph_op_versions(id, version_no, state, effective_from, published_at, change_note, definition)')
      .is('voided_at', null).order('code');
    if (error) throw error;
    return ((data ?? []) as unknown as OpType[]).map((o) => ({ ...o, ph_op_versions: [...o.ph_op_versions].sort((a, b) => b.version_no - a.version_no) }));
  } });
}

/** The version in effect now (published or superseded with the latest effective date that has started). */
export function versionInEffect(o: OpType): OpVersion | undefined {
  const now = Date.now();
  return o.ph_op_versions.filter((v) => (v.state === 'published' || v.state === 'superseded') && v.effective_from && Date.parse(v.effective_from) <= now)
    .sort((a, b) => Date.parse(b.effective_from ?? '') - Date.parse(a.effective_from ?? '') || b.version_no - a.version_no)[0];
}

/** One validator problem as a sentence (the server lists them; the screen explains them). */
export function opErrorText(t: TFunction, e: OpError): string {
  return t(`ops.opErrors.${e.key}`, { step: e.step ?? '', field: e.field ?? '', role: e.role ?? '', unit: e.unit ?? '', target: e.target ?? '', hook: e.hook ?? '',
    defaultValue: e.key });
}
