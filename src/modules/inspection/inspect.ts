import { computeAccessibleName } from 'dom-accessibility-api';
import {
  PageContextSchema,
  type PageContext,
  type PageElement,
} from '../contracts';

export interface InspectionBudget {
  maxElements: number;
  maxSerializedBytes: number;
  maxTextCharacters: number;
  maxShadowDepth: number;
}

export interface InspectionLocation {
  origin: string;
  path: string;
  title: string;
}

export interface InspectionOptions {
  budget?: Partial<InspectionBudget>;
  createElementId?: () => string;
}

const DEFAULT_BUDGET: InspectionBudget = {
  maxElements: 250,
  maxSerializedBytes: 64 * 1024,
  maxTextCharacters: 256,
  maxShadowDepth: 8,
};

const excludedTags = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'svg',
  'path',
]);

const attributeNames = [
  'aria-describedby',
  'aria-label',
  'aria-labelledby',
  'class',
  'data-testid',
  'id',
  'name',
  'role',
  'type',
] as const;

const styleProperties = [
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
] as const;

const normalizedText = (value: string | null) =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const isFormValueElement = (element: Element) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLSelectElement ||
  element instanceof HTMLTextAreaElement;

const isVisible = (element: Element) => {
  let current: Element | null = element;
  while (current !== null) {
    if (
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.opacity === '0'
    ) {
      return false;
    }
    if (current.parentElement !== null) {
      current = current.parentElement;
    } else {
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
  }
  return true;
};

const directText = (element: Element, maximum: number) => {
  if (isFormValueElement(element)) {
    return undefined;
  }
  const text = normalizedText(
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' '),
  ).slice(0, maximum);
  return text.length === 0 ? undefined : text;
};

const accessibleName = (element: Element) => {
  try {
    const name = normalizedText(computeAccessibleName(element)).slice(0, 256);
    return name.length === 0 ? undefined : name;
  } catch {
    return undefined;
  }
};

const roleFor = (element: Element, name: string | undefined) => {
  const explicit = normalizedText(element.getAttribute('role'));
  if (explicit.length > 0) {
    return explicit;
  }
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    return 'heading';
  }
  if (element instanceof HTMLAnchorElement && element.hasAttribute('href')) {
    return 'link';
  }
  if (element instanceof HTMLInputElement) {
    return element.type === 'search' ? 'searchbox' : 'textbox';
  }
  if (tag === 'section' && name !== undefined) {
    return 'region';
  }
  return {
    article: 'article',
    aside: 'complementary',
    button: 'button',
    footer: 'contentinfo',
    header: 'banner',
    li: 'listitem',
    main: 'main',
    nav: 'navigation',
    ol: 'list',
    select: 'combobox',
    textarea: 'textbox',
    ul: 'list',
  }[tag];
};

const defaultElementId = () => `element-${crypto.randomUUID()}`;

export class PageInspection {
  readonly context: PageContext;
  readonly #elements: Map<string, Element>;

  constructor(context: PageContext, elements: Map<string, Element>) {
    this.context = context;
    this.#elements = elements;
  }

  resolve(elementId: string) {
    return this.#elements.get(elementId) ?? null;
  }
}

export const inspectDocument = (
  document: Document,
  location: InspectionLocation,
  options: InspectionOptions = {},
) => {
  const budget = { ...DEFAULT_BUDGET, ...options.budget };
  const createElementId = options.createElementId ?? defaultElementId;
  const elements: PageElement[] = [];
  const registry = new Map<string, Element>();

  const walk = (
    element: Element,
    parentId?: string,
    shadowHostId?: string,
    shadowDepth = 0,
  ) => {
    if (elements.length >= budget.maxElements) {
      return;
    }
    const tag = element.tagName.toLowerCase();
    if (excludedTags.has(tag) || !isVisible(element)) {
      return;
    }
    const elementId = createElementId();
    if (
      !/^element-[a-zA-Z0-9_-]+$/.test(elementId) ||
      registry.has(elementId)
    ) {
      throw new Error('Inspection element IDs must be unique and opaque');
    }
    registry.set(elementId, element);
    const name = accessibleName(element);
    const role = roleFor(element, name);
    const text = directText(element, budget.maxTextCharacters);
    const bounds = element.getBoundingClientRect();
    const style = document.defaultView?.getComputedStyle(element);
    const record: PageElement = {
      elementId,
      tag,
      attributes: attributeNames.flatMap((attribute) => {
        const value = element.getAttribute(attribute);
        return value === null
          ? []
          : [{ name: attribute, value: value.slice(0, 256) }];
      }),
      computedStyles: styleProperties.map((property) => ({
        property,
        value: (style?.getPropertyValue(property) ?? '').slice(0, 256),
      })),
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      ...(parentId === undefined ? {} : { parentId }),
      ...(shadowHostId === undefined ? {} : { shadowHostId }),
      ...(role === undefined ? {} : { role }),
      ...(name === undefined ? {} : { accessibleName: name }),
      ...(text === undefined ? {} : { text }),
    };
    elements.push(record);
    for (const child of element.children) {
      walk(child, elementId, shadowHostId, shadowDepth);
    }
    if (element.shadowRoot !== null && shadowDepth < budget.maxShadowDepth) {
      for (const child of element.shadowRoot.children) {
        walk(child, elementId, elementId, shadowDepth + 1);
      }
    }
  };

  walk(document.documentElement);
  let context = PageContextSchema.parse({
    schemaVersion: 1,
    origin: location.origin,
    path: location.path,
    title: location.title.slice(0, 256),
    elements,
  });
  while (
    new TextEncoder().encode(JSON.stringify(context)).length >
      budget.maxSerializedBytes &&
    context.elements.length > 0
  ) {
    const removed = context.elements.at(-1);
    if (removed !== undefined) {
      registry.delete(removed.elementId);
    }
    context = PageContextSchema.parse({
      ...context,
      elements: context.elements.slice(0, -1),
    });
  }
  if (
    new TextEncoder().encode(JSON.stringify(context)).length >
    budget.maxSerializedBytes
  ) {
    throw new Error('Inspection context cannot fit the byte budget');
  }
  return new PageInspection(context, registry);
};
