import { z } from 'zod';
import { ProfileOperationSchema } from './operations';
import {
  CanonicalOriginSchema,
  ContractVersionSchema,
  DateTimeSchema,
  EntityIdSchema,
  hasUniqueValues,
  OperationIdSchema,
  PathPatternSchema,
} from './shared';

const RevisionNumberSchema = z.number().int().safe().positive();

export const ProfileDiagnosticSchema = z.strictObject({
  code: z.enum([
    'ambiguous-target',
    'missing-target',
    'operation-rejected',
    'unsupported-page',
  ]),
  operationId: OperationIdSchema.optional(),
  message: z.string().min(1).max(512),
});

export const ProfileHealthSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('healthy'),
  }),
  z.strictObject({
    state: z.literal('needs-repair'),
    diagnostics: z.array(ProfileDiagnosticSchema).min(1).max(32),
    detectedAt: DateTimeSchema,
  }),
]);

export const ProfileSchema = z
  .strictObject({
    schemaVersion: ContractVersionSchema,
    id: EntityIdSchema,
    name: z.string().min(1).max(80),
    enabled: z.boolean(),
    origin: CanonicalOriginSchema,
    pathPattern: PathPatternSchema,
    intentSummary: z.string().min(1).max(1_000),
    conversationId: EntityIdSchema,
    operations: z.array(ProfileOperationSchema).min(1).max(128),
    revision: RevisionNumberSchema,
    health: ProfileHealthSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .refine(
    ({ operations }) =>
      hasUniqueValues(operations.map(({ operationId }) => operationId)),
    'Operation identifiers must be unique',
  )
  .refine(
    ({ enabled, health }) => !enabled || health.state !== 'needs-repair',
    'Profiles needing repair must be disabled',
  )
  .refine(({ health, operations }) => {
    if (health.state === 'healthy') {
      return true;
    }
    const operationIds = new Set(
      operations.map(({ operationId }) => operationId),
    );
    return health.diagnostics.every(
      ({ operationId }) =>
        operationId === undefined || operationIds.has(operationId),
    );
  }, 'Profile diagnostics must reference an included operation')
  .refine(
    ({ createdAt, updatedAt }) =>
      new Date(updatedAt).getTime() >= new Date(createdAt).getTime(),
    'Profile update time cannot precede creation time',
  );

export const ProfileRevisionSchema = z
  .strictObject({
    schemaVersion: ContractVersionSchema,
    profileId: EntityIdSchema,
    revision: RevisionNumberSchema,
    snapshot: ProfileSchema,
    recordedAt: DateTimeSchema,
  })
  .refine(
    ({ profileId, snapshot }) => profileId === snapshot.id,
    'Revision profile identifier must match its snapshot',
  )
  .refine(
    ({ revision, snapshot }) => revision === snapshot.revision,
    'Revision number must match its snapshot',
  )
  .refine(
    ({ recordedAt, snapshot }) =>
      new Date(recordedAt).getTime() >= new Date(snapshot.updatedAt).getTime(),
    'Revision record time cannot precede its snapshot update time',
  );

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileDiagnostic = z.infer<typeof ProfileDiagnosticSchema>;
export type ProfileHealth = z.infer<typeof ProfileHealthSchema>;
export type ProfileRevision = z.infer<typeof ProfileRevisionSchema>;
