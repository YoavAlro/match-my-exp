import { z } from 'zod';
import {
  CanonicalOriginSchema,
  ContractVersionSchema,
  hasUniqueValues,
  PagePathSchema,
} from './shared';

const ElementReferenceSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^element-[a-zA-Z0-9_-]+$/);

const PageAttributeSchema = z.strictObject({
  name: z.enum([
    'aria-describedby',
    'aria-label',
    'aria-labelledby',
    'class',
    'data-testid',
    'id',
    'name',
    'role',
    'type',
  ]),
  value: z.string().max(256),
});

const ComputedStyleSchema = z.strictObject({
  property: z.enum([
    'align-items',
    'background-color',
    'color',
    'display',
    'flex-direction',
    'font-family',
    'font-size',
    'font-weight',
    'gap',
    'height',
    'justify-content',
    'line-height',
    'opacity',
    'position',
    'visibility',
    'width',
  ]),
  value: z.string().max(256),
});

const ElementBoundsSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export const PageElementSchema = z
  .strictObject({
    elementId: ElementReferenceSchema,
    parentId: ElementReferenceSchema.optional(),
    shadowHostId: ElementReferenceSchema.optional(),
    tag: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z][a-z0-9-]*$/),
    role: z.string().min(1).max(64).optional(),
    accessibleName: z.string().max(256).optional(),
    text: z.string().max(512).optional(),
    attributes: z.array(PageAttributeSchema).max(12),
    computedStyles: z.array(ComputedStyleSchema).max(20),
    bounds: ElementBoundsSchema,
  })
  .refine(
    ({ attributes }) => hasUniqueValues(attributes.map(({ name }) => name)),
    'Page element attributes must be unique',
  )
  .refine(
    ({ computedStyles }) =>
      hasUniqueValues(computedStyles.map(({ property }) => property)),
    'Computed style properties must be unique',
  );

const containsReferenceCycle = (
  elements: readonly z.infer<typeof PageElementSchema>[],
) => {
  const elementsById = new Map(
    elements.map((element) => [element.elementId, element]),
  );
  const active = new Set<string>();
  const complete = new Set<string>();

  const visit = (elementId: string): boolean => {
    if (active.has(elementId)) {
      return true;
    }
    if (complete.has(elementId)) {
      return false;
    }

    active.add(elementId);
    const element = elementsById.get(elementId);
    const references = [element?.parentId, element?.shadowHostId];
    if (
      references.some(
        (reference) => reference !== undefined && visit(reference),
      )
    ) {
      return true;
    }
    active.delete(elementId);
    complete.add(elementId);
    return false;
  };

  return elements.some(({ elementId }) => visit(elementId));
};

export const PageContextSchema = z
  .strictObject({
    schemaVersion: ContractVersionSchema,
    origin: CanonicalOriginSchema,
    path: PagePathSchema,
    title: z.string().max(256),
    elements: z.array(PageElementSchema).max(1_000),
  })
  .refine(
    ({ elements }) =>
      hasUniqueValues(elements.map(({ elementId }) => elementId)),
    'Page element identifiers must be unique',
  )
  .refine(({ elements }) => {
    const identifiers = new Set(elements.map(({ elementId }) => elementId));
    return elements.every(
      ({ elementId, parentId, shadowHostId }) =>
        (parentId === undefined ||
          (parentId !== elementId && identifiers.has(parentId))) &&
        (shadowHostId === undefined ||
          (shadowHostId !== elementId && identifiers.has(shadowHostId))),
    );
  }, 'Page element references must identify another included element')
  .refine(
    ({ elements }) => !containsReferenceCycle(elements),
    'Page element references cannot contain cycles',
  );

export type PageElement = z.infer<typeof PageElementSchema>;
export type PageContext = z.infer<typeof PageContextSchema>;
