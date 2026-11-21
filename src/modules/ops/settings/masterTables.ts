/** The masters the packhouse operations use. Columns match app.ph_master_tables (the server refuses anything else). */
export type Kind = 'text' | 'number' | 'bool' | 'time' | 'select' | 'customer';
export interface Col { key: string; kind: Kind; required?: boolean; options?: string[]; ltr?: boolean }
export interface TableDef { table: string; area: 'md_customer' | 'md_operational'; cols: Col[] }

/** The masters the packhouse operations use. Columns match app.ph_master_tables (the server refuses anything else). */
export const TABLES: TableDef[] = [
  { table: 'ph_customers', area: 'md_customer', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_en', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text' },
    { key: 'market_type', kind: 'select', options: ['export', 'local', 'retail', 'lss'] }, { key: 'long_distance', kind: 'bool' }, { key: 'notes', kind: 'text' }] },
  { table: 'ph_pack_formats', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'kind', kind: 'select', required: true, options: ['carton', 'punnet_carton', 'black_box', 'loose', 'bag', 'other'] },
    { key: 'nominal_net_kg', kind: 'number', required: true }, { key: 'units_per_pack', kind: 'number' }, { key: 'crop_code', kind: 'text', ltr: true },
    { key: 'customer_id', kind: 'customer' }] },
  { table: 'ph_shift_templates', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'starts_at', kind: 'time', required: true }, { key: 'ends_at', kind: 'time', required: true }, { key: 'sort_order', kind: 'number' }] },
  { table: 'ph_task_kinds', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'counts_as_packing', kind: 'bool', required: true }, { key: 'is_shared', kind: 'bool' }, { key: 'sort_order', kind: 'number' }] },
  { table: 'ph_downtime_causes', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'category', kind: 'text' }] },
  { table: 'ph_packaging_items', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'kind', kind: 'select', required: true, options: ['carton', 'punnet', 'field_crate', 'black_box', 'pallet', 'label', 'lid', 'other'] }] },
];
