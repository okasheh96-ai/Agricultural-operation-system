import { Params, RestError, condSql, filtersFrom, orderSql, parseLogic, parseSelect, splitTop } from './postgrest';

describe('in-browser PostgREST: reading requests', () => {
  it('reads select lists with aliases, casts and nested embeds', () => {
    expect(parseSelect('id, code, ph_hold_items(pallet_id, outcome, ph_incoming_pallets(code))')).toEqual([
      { kind: 'column', name: 'id', alias: 'id', cast: null },
      { kind: 'column', name: 'code', alias: 'code', cast: null },
      { kind: 'embed', relation: 'ph_hold_items', alias: 'ph_hold_items', hint: null, inner: false, items: [
        { kind: 'column', name: 'pallet_id', alias: 'pallet_id', cast: null },
        { kind: 'column', name: 'outcome', alias: 'outcome', cast: null },
        { kind: 'embed', relation: 'ph_incoming_pallets', alias: 'ph_incoming_pallets', hint: null, inner: false, items: [
          { kind: 'column', name: 'code', alias: 'code', cast: null },
        ] },
      ] },
    ]);
    expect(parseSelect('user_id, roles!inner(code), n:net_kg::text')).toEqual([
      { kind: 'column', name: 'user_id', alias: 'user_id', cast: null },
      { kind: 'embed', relation: 'roles', alias: 'roles', hint: null, inner: true, items: [{ kind: 'column', name: 'code', alias: 'code', cast: null }] },
      { kind: 'column', name: 'net_kg', alias: 'n', cast: 'text' },
    ]);
    expect(parseSelect('*')).toEqual([{ kind: 'star' }]);
  });

  it('splits only at the top level and outside quotes', () => {
    expect(splitTop('a,b(c,d),"e,f"')).toEqual(['a', 'b(c,d)', '"e,f"']);
  });

  it('turns filters into parameterised SQL, never into inline values', () => {
    const p = new Params();
    const sql = filtersFrom(new URLSearchParams('status=in.(assigned,in_progress)&voided_at=is.null&code=not.eq.X%27;drop'))
      .map((c) => condSql(c, 't0', p));
    expect(sql).toEqual(['t0."status" in ($1, $2)', 't0."voided_at" is null', 'not (t0."code" = $3)']);
    expect(p.values).toEqual(['assigned', 'in_progress', "X';drop"]);
  });

  it('reads nested or/and groups as the app sends them', () => {
    const p = new Params();
    const c = parseLogic('or', '(status.in.(assigned,blocked),and(planned_date.eq.2026-10-19,status.in.(completed,verified)),planned_date.is.null)');
    expect(condSql(c, 't0', p)).toBe('(t0."status" in ($1, $2)) or ((t0."planned_date" = $3) and (t0."status" in ($4, $5))) or (t0."planned_date" is null)');
    expect(p.values).toEqual(['assigned', 'blocked', '2026-10-19', 'completed', 'verified']);
  });

  it('orders by validated columns only', () => {
    expect(orderSql('sort_order.asc,code.desc.nullslast', 't0')).toBe('t0."sort_order" asc, t0."code" desc nulls last');
    expect(() => orderSql('code;drop table x.asc', 't0')).toThrow(RestError);
  });

  it('refuses what it does not support instead of guessing', () => {
    expect(() => filtersFrom(new URLSearchParams('roles.code=eq.x'))).toThrow(/not supported/);
    expect(() => condSql({ kind: 'leaf', column: 'tags', op: 'cs', negate: false, value: '{a}' }, 't0', new Params())).toThrow(/not supported/);
  });
});
