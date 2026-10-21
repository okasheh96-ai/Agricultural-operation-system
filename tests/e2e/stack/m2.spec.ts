import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { login, one, rest, rpc } from './api';

// Packing house M2.2 / M2.3 against the real stack (PostgREST + Supabase Auth + Postgres 16, demo farm): PostgREST reaches the
// request-id versions of the create functions (a repeated request returns the first record), the API refuses direct writes to
// order lines and waste, the waste route runs on the demo farm's labelled OD-11 assumption, and the plan is readable only by
// packing-house people.

test('orders, Job Cards and waste through the real API, with duplicate requests answered once', async () => {
  const [sal, phm, pe, dec, qci, sup] = await Promise.all([
    'demo.ph.sal', 'demo.ph.phm', 'demo.ph.pe', 'demo.ph.dec', 'demo.ph.qci', 'demo.supervisor'].map((e) => login(`${e}@demo.local`)));
  const crop = await one<{ id: string }>(sal, 'ph_crops?code=eq.cherry_tomato&superseded_at=is.null&select=id');
  const due = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date(Date.now() + 5 * 864e5));
  const customer = `API test ${randomUUID().slice(0, 8)}`;
  const line = { customer_name: customer, crop_id: crop.id, grade: 'gr1', pack_spec: '250 g', quantity: 90, quantity_unit: 'kg',
    required_date: due, market_type: 'export' };

  // ST-00: one request id, two calls, one order line.
  const req = randomUUID();
  const ol = await rpc<{ id: string; code: string }>(sal, 'ph_create_order_line', { p: line, p_request_id: req });
  const again = await rpc<{ id: string; repeated: boolean }>(sal, 'ph_create_order_line', { p: line, p_request_id: req });
  expect(again.id).toBe(ol.id);
  expect(again.repeated).toBe(true);
  expect((await rest<unknown[]>(sal, `ph_order_lines?customer_name=eq.${encodeURIComponent(customer)}&select=id`)).length).toBe(1);
  const kg = await one<{ id: string }>(sal, 'units?code=eq.kg&select=id');
  const columns = { customer_name: line.customer_name, crop_id: crop.id, grade: 'gr1', pack_spec: '250 g', quantity: 90, quantity_unit_id: kg.id,
    required_date: due, market_type: 'export', code: 'X' };
  await expect(rest(sal, 'ph_order_lines', { method: 'POST', body: columns })).rejects.toThrow(/^(401|403)/);
  await expect(rest(phm, `ph_order_lines?id=eq.${ol.id}`, { method: 'PATCH', body: { status: 'accepted' } })).rejects.toThrow(/^(401|403)/);
  await expect(rpc(sal, 'ph_decide_order_line', { p_line: ol.id, p_decision: 'accept' })).rejects.toThrow(/P0403|403/);
  await rpc(phm, 'ph_decide_order_line', { p_line: ol.id, p_decision: 'accept' });

  // A Job Card for the line (and the plain Job Card wrapper): PostgREST resolves the request-id overload.
  const lineA = await one<{ id: string }>(pe, 'ph_lines?code=eq.A&select=id');
  const jreq = randomUUID();
  const jc = await rpc<{ id: string; code: string; order_line: string }>(pe, 'ph_create_job_card_for_order', { p_line: ol.id, p: { line_id: lineA.id }, p_request_id: jreq });
  expect(jc.order_line).toBe(ol.code);
  expect((await rpc<{ id: string }>(pe, 'ph_create_job_card_for_order', { p_line: ol.id, p: { line_id: lineA.id }, p_request_id: jreq })).id).toBe(jc.id);
  const plain = randomUUID();
  const jc2 = await rpc<{ id: string }>(pe, 'ph_create_job_card', { p: { line_id: lineA.id, crop_id: crop.id, grade_target: 'gr2' }, p_request_id: plain });
  expect((await rpc<{ id: string }>(pe, 'ph_create_job_card', { p: { line_id: lineA.id, crop_id: crop.id, grade_target: 'gr2' }, p_request_id: plain })).id).toBe(jc2.id);
  await expect(rpc(dec, 'ph_create_job_card', { p: {}, p_request_id: plain })).rejects.toThrow(/requestReused|P0409/);
  expect((await one<{ order_line_code: string }>(pe, `ph_jc_board?id=eq.${jc.id}&select=order_line_code`)).order_line_code).toBe(ol.code);

  // ST-11 waste on the running demo Job Card: label (QC), weigh (clerk), routed to the PHM with the OD-11 demo assumption.
  const running = await one<{ id: string }>(dec, 'ph_jc_board?status=eq.in_progress&select=id&order=code&limit=1');
  const wreq = randomUUID();
  const w = await rpc<{ id: string }>(dec, 'ph_create_waste_record', { p: { category: 'processed', source_type: 'job_card', source: running.id, reference_kg: 3 }, p_request_id: wreq });
  expect((await rpc<{ id: string }>(dec, 'ph_create_waste_record', { p: { category: 'processed', source_type: 'job_card', source: running.id }, p_request_id: wreq })).id).toBe(w.id);
  await expect(rest(dec, `ph_waste_records?id=eq.${w.id}`, { method: 'PATCH', body: { net_kg: 1 } })).rejects.toThrow(/^(401|403)/);
  const scale = await one<{ id: string }>(dec, 'ph_equipment?kind=eq.scale&verification_status=eq.verified&select=id&limit=1');
  await expect(rpc(dec, 'ph_waste_weigh', { p_waste: w.id, p_net_kg: 2.5, p_scale: scale.id })).rejects.toThrow(/v16/);
  await expect(rpc(dec, 'ph_waste_qc', { p_waste: w.id, p_decision: 'approve' })).rejects.toThrow(/P0403|403/);
  await rpc(qci, 'ph_waste_qc', { p_waste: w.id, p_decision: 'approve' });
  const weighed = await rpc<{ status: string }>(dec, 'ph_waste_weigh', { p_waste: w.id, p_net_kg: 2.5, p_scale: scale.id });
  expect(weighed.status).toBe('awaiting_sign_off');
  expect((await one<{ route: string; route_basis: string }>(phm, `ph_waste_board?id=eq.${w.id}&select=route,route_basis`)).route_basis).toMatch(/^demo:OD-11=A/);
  await rpc(phm, 'ph_waste_signoff', { p_waste: w.id });
  expect((await one<{ status: string }>(phm, `ph_waste_board?id=eq.${w.id}&select=status`)).status).toBe('signed_off');

  // FR-PL-03 plan for packing-house people; nothing for someone outside the packing house.
  const plan = await rpc<{ order_lines: { code: string }[] }>(phm, 'ph_daily_plan', { p_date: null });
  expect(plan.order_lines.map((o) => o.code)).toContain(ol.code);
  expect((await rpc<{ order_lines: unknown[] }>(sup, 'ph_daily_plan', { p_date: null })).order_lines).toHaveLength(0);
  expect(await rest<unknown[]>(sup, 'ph_order_lines?select=id')).toHaveLength(0);
});
