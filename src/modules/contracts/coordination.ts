import { z } from 'zod';
import {
  CanonicalOriginSchema,
  ContractVersionSchema,
  EntityIdSchema,
  PagePathSchema,
} from './shared';

export const SiteReadinessSchema = z.enum([
  'ready',
  'unsupported',
  'unavailable',
]);

export const PanelReadinessRequestSchema = z.strictObject({
  schemaVersion: ContractVersionSchema,
  type: z.literal('panel.readiness.request'),
  requestId: EntityIdSchema,
});

export const PanelReadinessResponseSchema = z
  .strictObject({
    schemaVersion: ContractVersionSchema,
    type: z.literal('panel.readiness.response'),
    requestId: EntityIdSchema,
    readiness: SiteReadinessSchema,
    tabId: z.number().int().safe().nonnegative().nullable(),
    origin: CanonicalOriginSchema.nullable(),
    path: PagePathSchema.nullable(),
    epoch: z.number().int().safe().nonnegative(),
  })
  .refine(
    ({ readiness, tabId, origin, path }) =>
      readiness !== 'ready' ||
      (tabId !== null && origin !== null && path !== null),
    'Ready sites require a complete page identity',
  );

export type SiteReadiness = z.infer<typeof SiteReadinessSchema>;
export type PanelReadinessRequest = z.infer<typeof PanelReadinessRequestSchema>;
export type PanelReadinessResponse = z.infer<
  typeof PanelReadinessResponseSchema
>;
