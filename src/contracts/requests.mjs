// Runtime write schemas shared by the HTTP boundary and contract tests.
import { z } from 'zod';
import { CATEGORY_CODES, IDEA_STATUSES, RESOLUTION_TYPES } from './enums.mjs';

const text = (min, max) => z.string().transform((v) => v.normalize('NFC').trim())
  .refine((v) => [...v].length >= min && [...v].length <= max,
    { message: `Текст: ${min}–${max} символов` });
export const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Требуется UUID');
export const versionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const draftFields = {
  title: text(0, 120).optional(), problem: text(0, 3000).optional(),
  solution: text(0, 3000).optional(), expectedBenefit: text(0, 1000).optional(),
  locationText: text(0, 300).optional(), locationGeometry: z.unknown().optional(),
  requestedCategoryCode: z.enum(CATEGORY_CODES).nullable().optional(),
  territoryId: uuidSchema.nullable().optional(), consentAccepted: z.boolean().optional(),
};
export const writeSchemas = {
  draft: z.object(draftFields).strict(),
  patch: z.object({ ...draftFields, expectedVersion: versionSchema }).strict(),
  submit: z.object({ expectedVersion: versionSchema, consentAccepted: z.literal(true) }).strict(),
  assignment: z.object({ expectedVersion: versionSchema, assigneeId: uuidSchema.nullable() }).strict(),
  status: z.object({ expectedVersion: versionSchema, toStatus: z.enum(IDEA_STATUSES),
    publicComment: text(20, 2000).optional(), resolutionType: z.enum(RESOLUTION_TYPES).optional(),
    takeOwnership: z.boolean().optional() }).strict(),
  comment: z.object({ expectedVersion: versionSchema, visibility: z.enum(['PUBLIC', 'INTERNAL']),
    body: text(1, 2000) }).strict(),
  clarification: z.object({ expectedVersion: versionSchema, body: text(10, 3000) }).strict(),
  reroute: z.object({ expectedVersion: versionSchema, organizationId: uuidSchema,
    effectiveCategoryCode: z.enum(CATEGORY_CODES).optional(), reason: text(10, 1000) }).strict(),
  deleteAttachment: z.object({ expectedVersion: versionSchema }).strict(),
  empty: z.object({}).strict(),
  register: z.object({ displayName: text(1, 200), email: z.string().max(320),
    password: z.string().refine((v) => [...v].length >= 12 && [...v].length <= 128),
    consentAccepted: z.boolean().optional() }).strict(),
  login: z.object({ email: z.string().max(320),
    password: z.string().refine((v) => [...v].length >= 1 && [...v].length <= 128) }).strict(),
  demoLogin: z.object({role:z.enum(['CITIZEN','STAFF'])}).strict(),
  preview: z.object({ title: text(10, 120), problem: text(30, 3000), solution: text(30, 3000),
    requestedCategoryCode: z.enum(CATEGORY_CODES).nullable(), territoryId: uuidSchema }).strict(),
};

export function parseWrite(name, value) {
  const parsed = writeSchemas[name].safeParse(value === undefined ? {} : value);
  if (parsed.success) return parsed.data;
  const fields = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[key] = 'Неизвестное поле';
    } else fields[String(issue.path[0] ?? 'request')] = issue.message;
  }
  const error = new Error('Проверьте параметры запроса');
  error.code = 'VALIDATION_ERROR'; error.fields = fields;
  throw error;
}
