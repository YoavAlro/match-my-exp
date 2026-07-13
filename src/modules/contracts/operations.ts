import { z } from 'zod';
import {
  hasControlCharacters,
  hasUniqueValues,
  OperationIdSchema,
} from './shared';
import { DurableTargetSchema, EphemeralTargetSchema } from './targets';

const CssPropertySchema = z.enum([
  'align-content',
  'align-items',
  'align-self',
  'aspect-ratio',
  'background-color',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-color',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'bottom',
  'box-shadow',
  'box-sizing',
  'color',
  'column-gap',
  'display',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'gap',
  'grid-auto-columns',
  'grid-auto-flow',
  'grid-auto-rows',
  'grid-column',
  'grid-row',
  'grid-template-columns',
  'grid-template-rows',
  'height',
  'inset',
  'justify-content',
  'justify-items',
  'justify-self',
  'left',
  'letter-spacing',
  'line-height',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'opacity',
  'order',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'row-gap',
  'text-align',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-indent',
  'text-transform',
  'top',
  'transform',
  'transform-origin',
  'vertical-align',
  'visibility',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
  'z-index',
]);

const CssDeclarationSchema = z.strictObject({
  property: CssPropertySchema,
  value: z
    .string()
    .min(1)
    .max(512)
    .refine(
      (value) =>
        !hasControlCharacters(value) &&
        !/[\\;{}]|\/\*|@import|expression\s*\(|javascript:|-moz-binding|url\s*\(/i.test(
          value,
        ),
      'CSS values cannot load resources or contain executable syntax',
    ),
});

const CssDeclarationsSchema = z
  .array(CssDeclarationSchema)
  .min(1)
  .max(32)
  .refine(
    (declarations) =>
      hasUniqueValues(declarations.map(({ property }) => property)),
    'CSS declarations cannot repeat a property',
  );

const AriaAttributeSchema = z.enum([
  'aria-description',
  'aria-describedby',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'role',
]);

const ShortcutSchema = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9]+$/),
  alt: z.boolean(),
  control: z.boolean(),
  meta: z.boolean(),
  shift: z.boolean(),
});

const createOperationSchema = <TargetSchema extends z.ZodType>(
  targetSchema: TargetSchema,
) =>
  z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('style'),
      operationId: OperationIdSchema,
      target: targetSchema,
      declarations: CssDeclarationsSchema,
    }),
    z.strictObject({
      kind: z.literal('move'),
      operationId: OperationIdSchema,
      target: targetSchema,
      destination: targetSchema,
      placement: z.enum(['before', 'after', 'inside-start', 'inside-end']),
    }),
    z.strictObject({
      kind: z.literal('aria'),
      operationId: OperationIdSchema,
      target: targetSchema,
      attribute: AriaAttributeSchema,
      value: z.string().max(256).nullable(),
    }),
    z.strictObject({
      kind: z.literal('keyboard'),
      operationId: OperationIdSchema,
      target: targetSchema,
      shortcut: ShortcutSchema,
      action: z.enum(['focus', 'scroll-start', 'scroll-center']),
    }),
  ]);

export const ProposalOperationSchema = createOperationSchema(
  EphemeralTargetSchema,
);

export const ProfileOperationSchema =
  createOperationSchema(DurableTargetSchema);

export type ProposalOperation = z.infer<typeof ProposalOperationSchema>;
export type ProfileOperation = z.infer<typeof ProfileOperationSchema>;
