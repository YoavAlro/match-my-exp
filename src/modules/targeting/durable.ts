import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import {
  DurableTargetSchema,
  EphemeralTargetSchema,
  type DurableTarget,
  type EphemeralTarget,
  type TargetAnchor,
} from '../contracts';
import type { PageInspection } from '../inspection';

export type DurableResolution =
  | { status: 'resolved'; element: Element }
  | { status: 'missing' }
  | { status: 'ambiguous' };

export class DurableTargetError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'DurableTargetError';
    this.code = code;
  }
}

type TargetRoot = Document | ShadowRoot;

const stableAttributeNames = ['id', 'data-testid', 'name', 'type'] as const;

const normalizedText = (value: string | null) =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const rootElements = (root: TargetRoot) => [
  ...(root instanceof Document && root.documentElement !== null
    ? [root.documentElement]
    : []),
  ...root.querySelectorAll('*'),
];

const semanticMatch = (element: Element, anchor: TargetAnchor) => {
  if (
    anchor.tag !== undefined &&
    element.tagName.toLowerCase() !== anchor.tag
  ) {
    return false;
  }
  if (anchor.role !== undefined && getRole(element) !== anchor.role) {
    return false;
  }
  if (
    anchor.accessibleName !== undefined &&
    normalizedText(computeAccessibleName(element)) !== anchor.accessibleName
  ) {
    return false;
  }
  return anchor.attributes.every(
    ({ name, value }) => element.getAttribute(name) === value,
  );
};

const exact = (elements: readonly Element[]) => {
  const unique = [...new Set(elements)];
  if (unique.length === 0) {
    return { status: 'missing' as const };
  }
  if (unique.length > 1) {
    return { status: 'ambiguous' as const };
  }
  return { status: 'resolved' as const, element: unique[0] as Element };
};

const elementAtPath = (root: TargetRoot, childPath: readonly number[]) => {
  let children: Element[] =
    root instanceof Document
      ? root.documentElement === null
        ? []
        : [root.documentElement]
      : [...root.children];
  let current: Element | null = null;
  for (const index of childPath) {
    current = children[index] ?? null;
    if (current === null) {
      return null;
    }
    children = [...current.children];
  }
  return current;
};

const resolveAnchor = (root: TargetRoot, anchor: TargetAnchor) => {
  if (anchor.selector !== undefined) {
    try {
      const selected = [...root.querySelectorAll(anchor.selector)].filter(
        (element) => semanticMatch(element, anchor),
      );
      if (selected.length > 0) {
        return exact(selected);
      }
    } catch {
      return { status: 'missing' as const };
    }
  }

  if (
    anchor.attributes.length > 0 ||
    anchor.role !== undefined ||
    anchor.accessibleName !== undefined
  ) {
    const semantic = rootElements(root).filter((element) =>
      semanticMatch(element, anchor),
    );
    if (semantic.length > 0) {
      return exact(semantic);
    }
  }

  if (anchor.childPath !== undefined) {
    const structural = elementAtPath(root, anchor.childPath);
    return structural !== null && semanticMatch(structural, anchor)
      ? exact([structural])
      : exact([]);
  }

  return exact(
    rootElements(root).filter((element) => semanticMatch(element, anchor)),
  );
};

const childPath = (element: Element, root: TargetRoot) => {
  const path: number[] = [];
  let current: Element | null = element;
  while (current !== null) {
    const parent: Element | null = current.parentElement;
    if (parent !== null) {
      path.unshift(Array.from(parent.children).indexOf(current));
      current = parent;
      continue;
    }
    if (root instanceof ShadowRoot) {
      path.unshift(Array.from(root.children).indexOf(current));
    } else if (root.documentElement === current) {
      path.unshift(0);
    }
    break;
  }
  return path;
};

const selectorFor = (element: Element) => {
  const id = element.getAttribute('id');
  return id !== null && /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(id)
    ? `#${id}`
    : undefined;
};

const compileAnchor = (element: Element, root: TargetRoot): TargetAnchor => {
  const name = normalizedText(computeAccessibleName(element));
  const role = getRole(element);
  const attributes = stableAttributeNames.flatMap((attribute) => {
    const value = element.getAttribute(attribute);
    return value === null || value.length === 0
      ? []
      : [{ name: attribute, value: value.slice(0, 256) }];
  });
  return {
    tag: element.tagName.toLowerCase(),
    ...(role === null ? {} : { role }),
    ...(name.length === 0 ? {} : { accessibleName: name.slice(0, 256) }),
    attributes,
    childPath: childPath(element, root),
    ...(selectorFor(element) === undefined
      ? {}
      : { selector: selectorFor(element) }),
  };
};

export const compileDurableTarget = (
  inspection: PageInspection,
  ephemeralInput: unknown,
): DurableTarget => {
  const ephemeral: EphemeralTarget =
    EphemeralTargetSchema.parse(ephemeralInput);
  const element = inspection.resolve(ephemeral.elementId);
  if (element === null || !element.isConnected) {
    throw new DurableTargetError('ephemeral_target_missing');
  }

  const hosts: Element[] = [];
  let root = element.getRootNode();
  while (root instanceof ShadowRoot) {
    if (root.mode !== 'open') {
      throw new DurableTargetError('closed_shadow_root');
    }
    hosts.unshift(root.host);
    root = root.host.getRootNode();
  }
  if (!(root instanceof Document)) {
    throw new DurableTargetError('unsupported_target_root');
  }

  let currentRoot: TargetRoot = root;
  const shadowHosts = hosts.map((host) => {
    const anchor = compileAnchor(host, currentRoot);
    const nextRoot = host.shadowRoot;
    if (nextRoot === null) {
      throw new DurableTargetError('closed_shadow_root');
    }
    currentRoot = nextRoot;
    return anchor;
  });
  return DurableTargetSchema.parse({
    kind: 'durable',
    shadowHosts,
    element: compileAnchor(element, currentRoot),
  });
};

export const resolveDurableTarget = (
  document: Document,
  input: unknown,
): DurableResolution => {
  const target = DurableTargetSchema.parse(input);
  let root: TargetRoot = document;
  for (const hostAnchor of target.shadowHosts) {
    const host = resolveAnchor(root, hostAnchor);
    if (host.status !== 'resolved') {
      return host;
    }
    if (host.element.shadowRoot === null) {
      return { status: 'missing' };
    }
    root = host.element.shadowRoot;
  }
  return resolveAnchor(root, target.element);
};
