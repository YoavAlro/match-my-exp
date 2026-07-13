import { z } from 'zod';
import { hasUniqueValues } from './shared';

const SelectorSegmentPattern =
  /^(?:[a-z][a-z0-9-]*)?(?:(?:#[a-zA-Z_][a-zA-Z0-9_-]*)|(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)|(?:\[[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:="[a-zA-Z0-9 _.:/@-]{1,128}")?\])|(?::nth-child\([1-9][0-9]*\)))+$/;

const SelectorSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (selector) =>
      selector
        .split(' > ')
        .every(
          (segment) =>
            /^[a-z][a-z0-9-]*$/.test(segment) ||
            SelectorSegmentPattern.test(segment),
        ),
    'Selector fallbacks must use bounded simple selector syntax',
  );

const TargetAttributeSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/),
  value: z.string().min(1).max(256),
});

export const EphemeralTargetSchema = z.strictObject({
  kind: z.literal('ephemeral'),
  elementId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^element-[a-zA-Z0-9_-]+$/),
});

export const TargetAnchorSchema = z
  .strictObject({
    tag: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional(),
    role: z.string().min(1).max(64).optional(),
    accessibleName: z.string().min(1).max(256).optional(),
    attributes: z.array(TargetAttributeSchema).max(8),
    childPath: z
      .array(z.number().int().safe().nonnegative())
      .min(1)
      .max(32)
      .optional(),
    selector: SelectorSchema.optional(),
  })
  .refine(
    (anchor) =>
      anchor.tag !== undefined ||
      anchor.role !== undefined ||
      anchor.accessibleName !== undefined ||
      anchor.attributes.length > 0 ||
      anchor.childPath !== undefined ||
      anchor.selector !== undefined,
    'A target anchor must contain at least one locating strategy',
  )
  .refine(
    ({ attributes }) => hasUniqueValues(attributes.map(({ name }) => name)),
    'Target anchor attributes must be unique',
  );

export const DurableTargetSchema = z.strictObject({
  kind: z.literal('durable'),
  shadowHosts: z.array(TargetAnchorSchema).max(8),
  element: TargetAnchorSchema,
});

export type EphemeralTarget = z.infer<typeof EphemeralTargetSchema>;
export type TargetAnchor = z.infer<typeof TargetAnchorSchema>;
export type DurableTarget = z.infer<typeof DurableTargetSchema>;
