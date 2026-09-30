import { z } from 'zod';
import { IDEA_STATUSES } from '../../contracts/enums.mjs';
import { ERROR_CODES } from '../../contracts/errors.mjs';
import { ASSISTANT_PAGES, ASSISTANT_TARGETS } from '../../features/assistant/catalog.mjs';

const messageText = z.string().max(1500).transform((value) => value.normalize('NFC').trim())
  .refine((value) => value.length > 0, 'Введите вопрос');
const historyText = z.string().max(2400).transform((value) => value.normalize('NFC').trim())
  .refine((value) => value.length > 0, 'Пустое сообщение в истории');

export const assistantRequestSchema = z.object({
  message: messageText,
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: historyText }).strict()).max(10),
  language: z.enum(['ru', 'kk', 'en']),
  context: z.object({
    page: z.enum(ASSISTANT_PAGES),
    step: z.number().int().min(1).max(3).optional(),
    status: z.enum(IDEA_STATUSES).optional(),
    mapEditing: z.boolean().optional(),
    mapAvailable: z.boolean().optional(),
    navigationBlocked: z.boolean().optional(),
    saving: z.boolean().optional(),
    errorCode: z.enum([...Object.keys(ERROR_CODES), 'NETWORK_ERROR', 'UNKNOWN_ERROR']).optional(),
    targets: z.array(z.enum(ASSISTANT_TARGETS)).max(24),
  }).strict(),
}).strict().refine((value) => value.message.length
  + value.history.reduce((total, item) => total + item.content.length, 0) <= 12000,
{ message: 'Слишком длинная история разговора', path: ['history'] });

export function parseAssistantRequest(body) {
  const parsed = assistantRequestSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const error = new Error('Проверьте вопрос и параметры помощника');
  error.code = 'VALIDATION_ERROR';
  error.fields = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) error.fields[key] = 'Неизвестное поле';
    } else error.fields[String(issue.path[0] ?? 'request')] = issue.message;
  }
  throw error;
}

export function parseAssistantOutput(output, actions) {
  const ids = actions.map((action) => action.id);
  const schema = z.object({
    answer: z.string().trim().min(1).max(2400),
    actionIds: z.array(z.string().refine((id) => ids.includes(id))).max(3),
    followups: z.array(z.string().trim().min(1).max(160)).max(3),
  }).strict();
  const parsed = schema.safeParse(output);
  if (!parsed.success) throw new Error('Invalid assistant provider output');
  return parsed.data;
}
