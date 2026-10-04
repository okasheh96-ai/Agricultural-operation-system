import { z } from 'zod';

export const LOCATION_TYPES = [
  'farm', 'production_system', 'zone', 'block', 'house', 'field', 'sub_unit', 'packhouse_area', 'warehouse', 'other',
] as const;

/** Mirrors the locations table constraints; the database remains the final authority. */
export const newLocationSchema = z
  .object({
    code: z.string().trim().min(1, 'errors.required').max(40, 'errors.tooLong'),
    name_ar: z.string().trim().min(1, 'errors.required').max(200, 'errors.tooLong'),
    name_en: z.string().trim().max(200, 'errors.tooLong').optional().transform((v) => (v ? v : null)),
    type: z.enum(LOCATION_TYPES),
    parent_id: z.string().uuid().nullable(),
  });

export type NewLocation = z.infer<typeof newLocationSchema>;
