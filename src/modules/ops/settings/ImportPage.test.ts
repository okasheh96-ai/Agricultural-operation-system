import { describe, expect, it } from 'vitest';
import { parseCsv, toRows } from './ImportPage';
import { TABLES, type TableDef } from './masterTables';

const packFormats = TABLES.find((d) => d.table === 'ph_pack_formats') as TableDef;

describe('spreadsheet import', () => {
  it('reads quoted CSV with commas, doubled quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿code,name_en\r\n"A,1","say ""hi"""\r\n\r\nB,b\n')).toEqual([['code', 'name_en'], ['A,1', 'say "hi"'], ['B', 'b']]);
  });

  it('converts typed columns and reports doubtful values instead of guessing', () => {
    const grid = [
      ['code', 'name_ar', 'kind', 'nominal_net_kg', 'customer_code', 'extra'],
      ['F1', 'كرتون', 'carton', '5,5', 'TESCO', 'x'],
      ['F2', '', 'crate', 'five', 'NOPE', ''],
    ];
    const r = toRows(packFormats, grid, [{ id: 'c1', code: 'tesco' }]);
    expect(r.unknownCols).toEqual(['extra']);
    expect(r.rows[0]).toEqual({ code: 'F1', name_ar: 'كرتون', kind: 'carton', nominal_net_kg: '5.5', customer_id: 'c1' });
    expect(r.problems.map((p) => p.row)).toEqual([3, 3, 3, 3]);
  });
});
