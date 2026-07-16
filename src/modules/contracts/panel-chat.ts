import { z } from 'zod';
import { ContractVersionSchema, EntityIdSchema } from './shared';

export const PanelChatCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    schemaVersion: ContractVersionSchema,
    type: z.literal('panel.chat.submit'),
    requestId: EntityIdSchema,
    message: z.string().min(1).max(4_000),
  }),
  z.strictObject({
    schemaVersion: ContractVersionSchema,
    type: z.literal('panel.preview.keep'),
    requestId: EntityIdSchema,
    previewId: EntityIdSchema,
    intent: z.string().min(1).max(1_000),
  }),
  z.strictObject({
    schemaVersion: ContractVersionSchema,
    type: z.literal('panel.preview.discard'),
    requestId: EntityIdSchema,
    previewId: EntityIdSchema,
  }),
]);

export const PanelChatResponseSchema = z.strictObject({
  schemaVersion: ContractVersionSchema,
  type: z.literal('panel.chat.response'),
  requestId: EntityIdSchema,
  status: z.enum(['clarification', 'preview', 'kept', 'discarded', 'error']),
  assistantMessage: z.string().max(4_000),
  previewId: EntityIdSchema.nullable(),
  clarificationQuestion: z.string().max(512).nullable(),
  clarificationChoices: z.array(z.string().max(160)).max(6),
  errorCode: z.string().min(1).max(80).optional(),
});

export type PanelChatCommand = z.infer<typeof PanelChatCommandSchema>;
export type PanelChatResponse = z.infer<typeof PanelChatResponseSchema>;
