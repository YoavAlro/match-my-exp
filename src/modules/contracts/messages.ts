import { z } from 'zod';
import { ProfileOperationSchema, ProposalOperationSchema } from './operations';
import { PageContextSchema } from './page-context';
import {
  CanonicalOriginSchema,
  ContractVersionSchema,
  EntityIdSchema,
  hasUniqueValues,
  PagePathSchema,
} from './shared';

const MessageBaseShape = {
  schemaVersion: ContractVersionSchema,
  requestId: EntityIdSchema,
};

const PageIdentityShape = {
  expectedOrigin: CanonicalOriginSchema,
  expectedPath: PagePathSchema,
};

const createOperationListSchema = <OperationSchema extends z.ZodType>(
  operationSchema: OperationSchema,
  maximum: number,
) =>
  z
    .array(operationSchema)
    .min(1)
    .max(maximum)
    .refine(
      (operations) =>
        hasUniqueValues(
          operations.map(
            (operation) => (operation as { operationId: string }).operationId,
          ),
        ),
      'Operation identifiers must be unique',
    );

const PreviewOperationListSchema = createOperationListSchema(
  ProposalOperationSchema,
  64,
);

const ProfileOperationListSchema = createOperationListSchema(
  ProfileOperationSchema,
  128,
);

export const RuntimeMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...MessageBaseShape,
    ...PageIdentityShape,
    type: z.literal('page.inspect.request'),
    tabId: z.number().int().safe().nonnegative(),
  }),
  z.strictObject({
    ...MessageBaseShape,
    type: z.literal('page.inspect.response'),
    context: PageContextSchema,
  }),
  z.strictObject({
    ...MessageBaseShape,
    ...PageIdentityShape,
    type: z.literal('proposal.preview'),
    previewId: EntityIdSchema,
    operations: PreviewOperationListSchema,
  }),
  z.strictObject({
    ...MessageBaseShape,
    ...PageIdentityShape,
    type: z.literal('preview.rollback'),
    previewId: EntityIdSchema,
  }),
  z.strictObject({
    ...MessageBaseShape,
    ...PageIdentityShape,
    type: z.literal('profile.apply'),
    profileId: EntityIdSchema,
    revision: z.number().int().safe().positive(),
    operations: ProfileOperationListSchema,
  }),
]);

export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>;
