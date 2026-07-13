import { z } from 'zod';
import { ProposalOperationSchema } from './operations';
import { ContractVersionSchema, hasUniqueValues } from './shared';

const ClarificationSchema = z.strictObject({
  question: z.string().min(1).max(512),
  choices: z.array(z.string().min(1).max(160)).max(6),
});

export const ProposalSchema = z
  .strictObject({
    schemaVersion: ContractVersionSchema,
    assistantMessage: z.string().min(1).max(4_000),
    clarification: ClarificationSchema.nullable(),
    operations: z.array(ProposalOperationSchema).max(64),
  })
  .refine(
    ({ clarification, operations }) =>
      clarification === null ? operations.length > 0 : operations.length === 0,
    'A proposal must contain operations or one clarification, but not both',
  )
  .refine(
    ({ operations }) =>
      hasUniqueValues(operations.map(({ operationId }) => operationId)),
    'Operation identifiers must be unique',
  );

export const ProposalJsonSchema = z.toJSONSchema(ProposalSchema, {
  io: 'input',
  target: 'draft-2020-12',
});

const unsupportedProviderKeywords = new Set([
  '$schema',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'pattern',
  'uniqueItems',
]);

const createPortableJsonSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(createPortableJsonSchema);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const schema: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (unsupportedProviderKeywords.has(key)) {
      continue;
    }
    if (key === 'oneOf') {
      schema.anyOf = createPortableJsonSchema(child);
      continue;
    }
    if (key === 'const') {
      schema.enum = [createPortableJsonSchema(child)];
      continue;
    }
    schema[key] = createPortableJsonSchema(child);
  }
  return schema;
};

export const ProposalProviderJsonSchema = createPortableJsonSchema(
  ProposalJsonSchema,
) as Record<string, unknown>;

export type Proposal = z.infer<typeof ProposalSchema>;
