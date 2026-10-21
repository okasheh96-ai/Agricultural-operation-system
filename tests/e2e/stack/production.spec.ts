import { expect, test } from '@playwright/test';
import { login, one, rest, rpc } from './api';

// Packing house M2.1 against the real stack (PostgREST + Supabase Auth + Postgres 16, demo farm): the API refuses direct
// writes to production records, and the server functions carry a Job Card from plan to a finished pallet in storage,
// each call by the role that owns it, with the server refusing out-of-order and wrong-role calls.

test('production through the real API: plan, partial issue, two-person line start, QC-2 gate, finished pallet into storage', async () => {
  const [pe, phm, ll, stk, qci, pho] = await Promise.all(['pe', 'phm', 'll', 'stk', 'qci', 'pho'].map((r) => login(`demo.ph.${r}@demo.local`)));
  const line = await one<{ id: string }>(pe, 'ph_lines?code=eq.B&select=id');
  const crop = await one<{ id: string }>(pe, 'ph_crops?code=eq.regular_tomato&superseded_at=is.null&select=id');

  // No direct writes: production records change only through the server functions.
  await expect(rest(pe, 'ph_job_cards', { method: 'POST', body: { code: 'X', line_id: line.id, crop_id: crop.id, planned_date: '2026-10-21' } }))
    .rejects.toThrow(/^(401|403)/);

  const jc = await rpc<{ id: string; code: string }>(pe, 'ph_create_job_card', { p: { line_id: line.id, crop_id: crop.id, grade_target: 'gr2' } });
  expect(jc.code).toMatch(/^JC-\d{6}-B-\d{2}$/);
  await expect(rest(pe, 'ph_job_cards?id=eq.' + jc.id, { method: 'PATCH', body: { status: 'planned' } })).rejects.toThrow(/^(401|403)/);
  await expect(rpc(pe, 'ph_approve_job_card', { p_jc: jc.id })).rejects.toThrow(/P0403|403/);
  await rpc(phm, 'ph_approve_job_card', { p_jc: jc.id });

  // A released regular-tomato pallet with kg left (the demo releases one); half of what remains is issued.
  const ip = await one<{ id: string; code: string; available_kg: string }>(ll,
    'ph_ip_board?crop_code=eq.regular_tomato&status=in.(released,issued)&available_kg=gt.0&select=id,code,available_kg&order=code&limit=1');
  const half = Math.floor(Number(ip.available_kg) / 2);
  const issued = await rpc<{ available_after: number }>(ll, 'ph_issue_to_job_card', { p_jc: jc.id, p_pallet: ip.code, p_kg: half });
  expect(Number(issued.available_after)).toBeCloseTo(Number(ip.available_kg) - half, 2);
  await expect(rpc(ll, 'ph_mark_job_card_ready', { p_jc: jc.id })).rejects.toThrow(/jc.needPackaging/);
  await rpc(stk, 'ph_issue_packaging', { p_jc: jc.id, p_description: 'كرتون اختبار آلي', p_quantity: 20 });
  await rpc(ll, 'ph_mark_job_card_ready', { p_jc: jc.id });

  // G5: QC records, the same person cannot confirm, the line leader does.
  await rpc(qci, 'ph_line_start_check', { p_jc: jc.id, p_result: 'pass', p_checklist: { sorter_calibration: 'ok', line_clean: 'ok', color_sorting: 'ok' } });
  await expect(rpc(qci, 'ph_confirm_line_start', { p_jc: jc.id })).rejects.toThrow(/ph.sod/);
  await rpc(ll, 'ph_confirm_line_start', { p_jc: jc.id });

  // G6: no finished pallet before a final pass.
  const scale = await one<{ id: string }>(pho, 'ph_equipment?kind=eq.scale&verification_status=eq.verified&select=id&limit=1');
  await expect(rpc(pho, 'ph_create_fg_pallet', { p_jc: jc.id, p: { box_count: 20, net_kg: 200, scale_id: scale.id } })).rejects.toThrow(/g6.notPassed/);
  const q = await rpc<{ tolerance_basis: string }>(qci, 'ph_qc2_record', { p_jc: jc.id, p_stage: 'final', p_result: 'pass', p_checklist: {} });
  expect(q.tolerance_basis).toBe('no_tolerance_set');
  const fg = await rpc<{ id: string; code: string }>(pho, 'ph_create_fg_pallet', { p_jc: jc.id, p: { box_count: 20, net_kg: 200, scale_id: scale.id } });
  expect(fg.code).toMatch(/^FGP-\d{6}-\d{5}$/);
  await rpc(qci, 'ph_fg_qc_approve', { p_fg: fg.id });
  const f1 = await one<{ id: string }>(pho, 'ph_locations?code=eq.F1&select=id');
  await rpc(pho, 'ph_move_fg_pallet', { p_fg: fg.code, p_to_location: f1.id });
  const board = await one<{ status: string; location_code: string; composition: { pallet: string; method: string }[] }>(pho,
    `ph_fg_board?id=eq.${fg.id}&select=status,location_code,composition`);
  expect(board).toMatchObject({ status: 'in_storage', location_code: 'F1' });
  expect(board.composition[0]).toMatchObject({ pallet: ip.code, method: 'proportional' });

  // Completion closes the input (consumed + returned = issued); the trace links the finished pallet to the incoming pallet.
  const input = await one<{ id: string }>(ll, `ph_jc_input_list?job_card_id=eq.${jc.id}&select=id`);
  await expect(rpc(ll, 'ph_complete_job_card', { p_jc: jc.id, p_closures: [{ input_id: input.id, consumed_kg: half, returned_kg: 1 }] }))
    .rejects.toThrow(/jc.closeBalance/);
  await rpc(ll, 'ph_complete_job_card', { p_jc: jc.id, p_closures: [{ input_id: input.id, consumed_kg: half - 5, returned_kg: 5 }] });
  const trace = await rpc<{ pallets: { code: string }[]; job_cards: { code: string }[] }>(phm, 'ph_backward_trace', { p_ref: fg.code });
  expect(trace.pallets.map((p) => p.code)).toEqual([ip.code]);
  expect(trace.job_cards.map((j) => j.code)).toEqual([jc.code]);
});
