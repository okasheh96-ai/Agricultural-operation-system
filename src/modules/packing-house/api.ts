import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from '@/core/supabase';

/** Spec evidence labels (PH-OAS-SPEC-001): C Confirmed · P Proposed · NYV Not Yet Verified. */
export type Evidence = 'C' | 'P' | 'NYV';

export interface PalletRow {
  id: string;
  code: string;
  status: string;
  workflow_version_id: string;
  version: number;
  stage: string;
  stage_since: string;
  arrival_id: string;
  arrival_code: string;
  arrived_at: string;
  vehicle_plate: string;
  driver_name: string;
  gate_no: string | null;
  late_flag: boolean;
  harvest_supervisor: string | null;
  source_id: string;
  source_code: string;
  source_kind: 'own_farm' | 'supplier';
  source_name_ar: string;
  source_name_en: string | null;
  block_code: string | null;
  section_code: string | null;
  supplier_name: string | null;
  crop_id: string;
  crop_code: string;
  crop_name_ar: string;
  crop_name_en: string | null;
  crop_version: number;
  nominal_kg_per_pallet: string | null;
  variety_name_ar: string | null;
  variety_name_en: string | null;
  harvest_at: string | null;
  box_count: number;
  net_kg: string;
  pre_regrade_net_kg: string | null;
  received_at: string;
  calibration_flag: boolean;
  plausibility_note: string | null;
  scale_code: string | null;
  registered_by: string;
  registered_by_name: string | null;
  lot_code: string | null;
  lot_id: string | null;
  location_code: string | null;
  location_name_ar: string | null;
  location_name_en: string | null;
  arrival_check_result: 'pass' | 'reject' | null;
  arrival_check_code: string | null;
  arrival_check_at: string | null;
  arrival_checked_by_name: string | null;
  reject_destination: 'farm_or_supplier' | 'waste_area' | null;
  precool_in_at: string | null;
  precool_out_at: string | null;
  dwell_minutes: string | null;
  dwell_exceeded: boolean;
  rma_code: string | null;
  rma_at: string | null;
  rma_result: string | null;
  rma_status: string | null;
  qam_review_flag: boolean | null;
  qa_decided_by_name: string | null;
  qa_reject_reason: string | null;
  regraded_by_name: string | null;
  regrade_done_at: string | null;
  reweighed_by_name: string | null;
  recheck_code: string | null;
  recheck_result: string | null;
  rechecked_by_name: string | null;
  qc1_code: string | null;
  qc1_at: string | null;
  released_by_name: string | null;
  hold_code: string | null;
  hold_type: string | null;
  hold_status: string | null;
  held_from_status: string | null;
  hold_id: string | null;
  void_requested_by: string | null;
  void_request_reason: string | null;
  label_print_count: number;
  waste_record_id: string | null;
  waste_code: string | null;
  age_hours: string;
  grading_overdue: boolean;
  decision_basis: Record<string, string>;
  attachment_count: number;
  available_kg: string | null;
  issued_open_kg: string;
  consumed_kg: string;
  job_card_codes: string | null;
}

/** One Job Card (ST-08) from ph_jc_board: line, crop, the person at each step, inputs, G5 and the latest QC-2. */
export interface JobCardRow {
  id: string;
  code: string;
  status: string;
  version: number;
  planned_date: string;
  grade_target: 'premium' | 'gr1' | 'gr2';
  customer_spec_ref: string | null;
  attribution_method: 'exact' | 'time_window' | 'proportional';
  notes: string | null;
  line_start_inspection_id: string | null;
  completed_at: string | null;
  created_at: string;
  stage_since: string;
  line_id: string;
  line_code: string;
  line_name_ar: string;
  line_name_en: string | null;
  crop_id: string;
  crop_code: string;
  crop_name_ar: string;
  crop_name_en: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  ready_by_name: string | null;
  started_by_name: string | null;
  completed_by_name: string | null;
  inputs_count: number;
  open_inputs: number;
  issued_kg: string;
  consumed_kg: string;
  returned_kg: string;
  packaging_count: number;
  line_start_code: string | null;
  line_start_result: 'pass' | 'fail' | null;
  line_start_by_name: string | null;
  line_start_at: string | null;
  last_line_start_result: 'pass' | 'fail' | null;
  qc2_code: string | null;
  qc2_stage: 'online' | 'final' | null;
  qc2_result: 'pass' | 'fail' | null;
  qc2_at: string | null;
  qc2_by_name: string | null;
  qc2_tolerance_basis: string | null;
  fg_count: number;
  fg_kg: string;
  decision_basis: Record<string, string>;
}

/** One finished-goods pallet (ST-10) from ph_fg_board. */
export interface FgPalletRow {
  id: string;
  code: string;
  status: string;
  version: number;
  grade: 'premium' | 'gr1' | 'gr2';
  box_count: number;
  net_kg: string;
  calibration_flag: boolean;
  plausibility_note: string | null;
  label_print_count: number;
  created_at: string;
  earliest_harvest_at: string | null;
  qc_approved_at: string | null;
  qc_valid_until: string | null;
  stage_since: string;
  age_hours: string | null;
  job_card_id: string;
  job_card_code: string;
  line_code: string;
  crop_id: string;
  crop_code: string;
  crop_name_ar: string;
  crop_name_en: string | null;
  scale_code: string | null;
  qc2_code: string | null;
  qc2_at: string | null;
  qc2_by_name: string | null;
  qc_approved_by_name: string | null;
  created_by_name: string | null;
  location_id: string | null;
  location_code: string | null;
  location_name_ar: string | null;
  location_name_en: string | null;
  lot_codes: string;
  composition: { pallet: string; pallet_id: string; lot: string | null; kg: number; share: number; method: string; source: string }[];
  decision_basis: Record<string, string>;
}

export interface JcInputRow { id: string; job_card_id: string; pallet_id: string; pallet_code: string; pallet_status: string; lot_code: string | null;
  source_code: string; harvest_at: string | null; issued_kg: string; consumed_kg: string | null; returned_kg: string | null; closed_at: string | null;
  created_at: string; issued_by_name: string | null }
export interface JcPackagingRow { id: string; job_card_id: string; description: string; quantity: string; unit_code: string; created_at: string; issued_by_name: string | null }
export interface JcInspectionRow { id: string; job_card_id: string; code: string; inspection_type: 'line_start' | 'qc2'; qc2_stage: 'online' | 'final' | null;
  result: 'pass' | 'fail'; reason: string | null; sample_note: string | null; remarks: string | null; checklist: Record<string, string>;
  tolerance_basis: string | null; event_at: string; by_name: string | null; template_source: string | null; template_evidence: string | null; template_crop: string | null }

export interface ArrivalRow {
  id: string;
  code: string;
  status: string;
  workflow_version_id: string;
  version: number;
  arrived_at: string;
  gate_no: string | null;
  source_id: string;
  source_code: string;
  source_kind: 'own_farm' | 'supplier';
  source_name_ar: string;
  source_name_en: string | null;
  block_code: string | null;
  section_code: string | null;
  supplier_name: string | null;
  variety_id: string | null;
  crop_code: string | null;
  variety_name_ar: string | null;
  variety_name_en: string | null;
  harvest_date: string | null;
  harvest_time: string | null;
  harvest_supervisor: string | null;
  supplier_ref: string | null;
  vehicle_plate: string;
  driver_name: string;
  dispatch_note_no: string | null;
  dispatched_pallets: number | null;
  dispatched_boxes: number | null;
  late_flag: boolean;
  late_reason: string | null;
  remarks: string | null;
  vehicle_result: 'pass' | 'fail' | null;
  vehicle_inspection_code: string | null;
  vehicle_inspected_by_name: string | null;
  vehicle_fail_reason: string | null;
  exception_state: 'none' | 'partial' | 'approved' | 'refused';
  exception_signatures: { role: string; decision: string; by: string | null; at: string }[];
  created_by_name: string | null;
  created_at: string;
  pallets_registered: number;
  registered_kg: string;
  pallets_awaiting_check: number;
  decision_basis: Record<string, string>;
}

export interface StageCount { stage: string; total: number; attention: number }

export interface Decision {
  id: string;
  code: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  needed_by: string;
  title_en: string;
  title_ar: string;
  why_en: string;
  options: { code: string; en: string }[];
  recommendation_en: string | null;
  owner_text: string;
  owner_roles: string[];
  source: string;
  dependents: string[];
  blocks_en: string;
  blocks_ar: string;
  decision_state: 'open' | 'proposed' | 'decided' | 'demo_assumption';
  selected_option: string | null;
  activate_roles: string[];
  rationale: string | null;
  decided_at: string | null;
  effective_from: string | null;
  config_version: number | null;
}

export interface PermissionCell {
  id: string;
  action_key: string;
  spec_code: string;
  evidence: Evidence;
  state: 'active' | 'proposed' | 'pending_decision' | 'disabled';
  basis: string;
  decision_code: string | null;
  note: string | null;
}

export interface PhAction {
  action_key: string;
  object_code: string;
  label_en: string;
  label_ar: string;
  owner_roles: string[];
  milestone: string;
  source: string;
  sort_order: number;
}

export interface ActionAvailability {
  action: string;
  ph_action: string;
  allowed: boolean;
  reason: { key: string; [k: string]: unknown } | null;
  basis: string | null;
}

export const db = () => requireSupabase();

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export function usePallets() {
  return useQuery({
    queryKey: ['ph', 'pallets'],
    queryFn: () => rows<PalletRow>(db().from('ph_ip_board').select('*').order('received_at', { ascending: false })),
    refetchInterval: 30_000,
  });
}

export function usePallet(id: string | undefined) {
  return useQuery({
    queryKey: ['ph', 'pallet', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db().from('ph_ip_board').select('*').eq('id', id as string).maybeSingle<PalletRow>();
      if (error) throw error;
      return data;
    },
  });
}

export function useJobCards() {
  return useQuery({
    queryKey: ['ph', 'job_cards'],
    queryFn: () => rows<JobCardRow>(db().from('ph_jc_board').select('*').order('created_at', { ascending: false })),
    refetchInterval: 30_000,
  });
}

export function useJobCard(id: string | undefined) {
  return useQuery({
    queryKey: ['ph', 'job_card', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db().from('ph_jc_board').select('*').eq('id', id as string).maybeSingle<JobCardRow>();
      if (error) throw error;
      return data;
    },
  });
}

/** Inputs, packaging and inspections of one Job Card (read models, one query each). */
export function useJobCardParts(id: string | undefined, version: number | undefined) {
  return useQuery({
    queryKey: ['ph', 'job_card_parts', id, version],
    enabled: !!id,
    queryFn: async () => {
      const [inputs, packaging, inspections] = await Promise.all([
        rows<JcInputRow>(db().from('ph_jc_input_list').select('*').eq('job_card_id', id as string).order('created_at')),
        rows<JcPackagingRow>(db().from('ph_jc_packaging_list').select('*').eq('job_card_id', id as string).order('created_at')),
        rows<JcInspectionRow>(db().from('ph_jc_inspection_list').select('*').eq('job_card_id', id as string).order('event_at')),
      ]);
      return { inputs, packaging, inspections };
    },
  });
}

export function useFgPallets() {
  return useQuery({
    queryKey: ['ph', 'fg_pallets'],
    queryFn: () => rows<FgPalletRow>(db().from('ph_fg_board').select('*').order('created_at', { ascending: false })),
    refetchInterval: 30_000,
  });
}

export function useFgPallet(id: string | undefined) {
  return useQuery({
    queryKey: ['ph', 'fg_pallet', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db().from('ph_fg_board').select('*').eq('id', id as string).maybeSingle<FgPalletRow>();
      if (error) throw error;
      return data;
    },
  });
}

export function useArrivals() {
  return useQuery({
    queryKey: ['ph', 'arrivals'],
    queryFn: () => rows<ArrivalRow>(db().from('ph_arrival_board').select('*').order('arrived_at', { ascending: false })),
    refetchInterval: 30_000,
  });
}

export function useStageCounts() {
  return useQuery({
    queryKey: ['ph', 'stage_counts'],
    queryFn: async () => {
      const { data, error } = await db().rpc('ph_stage_counts');
      if (error) throw error;
      return ((data ?? []) as { stage: string; total: number | string; attention: number | string }[])
        .map((r) => ({ stage: r.stage, total: Number(r.total), attention: Number(r.attention) })) as StageCount[];
    },
    refetchInterval: 30_000,
  });
}

/** Effective packing-house permissions of the signed-in user (UI hints only; the database checks every action). */
export function useMyPhPermissions() {
  return useQuery({
    queryKey: ['ph', 'my_permissions'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db().rpc('ph_my_permissions');
      if (error) throw error;
      return new Map(((data ?? []) as { action_key: string; basis: string }[]).map((r) => [r.action_key, r.basis]));
    },
  });
}

export function useDecisions() {
  return useQuery({
    queryKey: ['ph', 'decisions'],
    queryFn: () => rows<Decision>(db().from('ph_open_decisions').select('*').is('voided_at', null).order('code')),
  });
}

export function useMatrix() {
  return useQuery({
    queryKey: ['ph', 'matrix'],
    queryFn: async () => {
      const [cells, actions] = await Promise.all([
        rows<PermissionCell>(db().from('ph_permission_cells').select('id, action_key, spec_code, evidence, state, basis, decision_code, note').is('voided_at', null)),
        rows<PhAction>(db().from('ph_actions').select('action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order').is('voided_at', null).order('sort_order')),
      ]);
      return { cells, actions };
    },
  });
}

/** A filter step applied to a lookup query (only equality filters are needed). */
export interface LookupFilter { eq: (column: string, value: string) => unknown }

/** Reads a table (soft-voided rows left out) or, with voidable false, a read-model view that has no voided_at. */
export function useLookup<T>(key: string, table: string, select = '*', filter?: (q: LookupFilter) => unknown, voidable = true) {
  return useQuery({
    queryKey: ['ph', 'lookup', key],
    staleTime: 60_000,
    queryFn: async () => {
      let q = voidable ? db().from(table).select(select).is('voided_at', null) : db().from(table).select(select);
      if (filter) q = filter(q as unknown as LookupFilter) as typeof q;
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

/** Wraps an RPC: returns the data, or throws the PostgREST error (code, message, details) for ph error mapping. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function useInvalidatePh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['ph'] });
}

/** Reads a file into base64 (no data: prefix) for ph_upload_attachment. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * Photos are compressed on the device before upload (NFR-10): longest side 1600 px, JPEG quality 0.8. Other files are
 * sent as they are (the server caps size at 5 MB).
 */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.8));
  } catch {
    return file;
  }
}

export async function uploadPhoto(file: File, caption: string, entity?: { type: string; id: string }): Promise<{ id: string; sha256: string }> {
  const blob = await compressImage(file);
  const mime = blob.type || file.type;
  const kind = mime.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'document' : 'photo';
  return rpc('ph_upload_attachment', {
    p_kind: kind, p_mime: mime, p_base64: await fileToBase64(blob), p_caption: caption || null,
    p_entity_type: entity?.type ?? null, p_entity: entity?.id ?? null,
  });
}

export function localizedName(locale: string, ar: string | null | undefined, en: string | null | undefined): string {
  return (locale === 'en' ? en || ar : ar || en) ?? '';
}
