import {
  ProfileOperationSchema,
  ProposalOperationSchema,
  type ProfileOperation,
  type ProposalOperation,
} from '../contracts';

type StyleOperation =
  | Extract<ProposalOperation, { kind: 'style' }>
  | Extract<ProfileOperation, { kind: 'style' }>;
type StyleRoot = Document | ShadowRoot;

export interface ResolvedStyleOperation {
  operation: unknown;
  resolvedElementId?: string;
  target: Element;
}

export interface StylePreviewResult {
  previewId: string;
  operationCount: number;
}

export class StylePreviewError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'StylePreviewError';
    this.code = code;
  }
}

interface CompiledBinding {
  target: Element;
  token: string;
}

interface CompiledRoot {
  root: StyleRoot;
  cssText: string;
}

interface CompiledPreview {
  previewId: string;
  signature: string;
  bindings: CompiledBinding[];
  roots: CompiledRoot[];
  operationCount: number;
}

interface ActivePreview extends CompiledPreview {
  styleElements: HTMLStyleElement[];
}

export type CssSupport = (property: string, value: string) => boolean;

const fallbackCssSupport: CssSupport = (property, value) => {
  const probe = document.createElement('div');
  probe.style.setProperty(property, value);
  return probe.style.getPropertyValue(property) !== '';
};

const browserCssSupport: CssSupport = (property, value) => {
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports(property, value);
  }
  return fallbackCssSupport(property, value);
};

const rootFor = (target: Element): StyleRoot => {
  const root = target.getRootNode();
  if (root instanceof Document || root instanceof ShadowRoot) {
    return root;
  }
  throw new StylePreviewError('unsupported_target_root');
};

const addToken = (target: Element, token: string) => {
  const tokens = new Set(
    (target.getAttribute('data-match-my-exp-style') ?? '')
      .split(/\s+/)
      .filter(Boolean),
  );
  tokens.add(token);
  target.setAttribute('data-match-my-exp-style', [...tokens].join(' '));
};

const removeToken = (target: Element, token: string) => {
  const tokens = (target.getAttribute('data-match-my-exp-style') ?? '')
    .split(/\s+/)
    .filter((candidate) => candidate.length > 0 && candidate !== token);
  if (tokens.length === 0) {
    target.removeAttribute('data-match-my-exp-style');
  } else {
    target.setAttribute('data-match-my-exp-style', tokens.join(' '));
  }
};

const appendStyle = (root: StyleRoot, cssText: string) => {
  const style = document.createElement('style');
  style.setAttribute('data-match-my-exp-owned', 'style-preview');
  style.textContent = cssText;
  if (root instanceof Document) {
    (root.head ?? root.documentElement).append(style);
  } else {
    root.append(style);
  }
  return style;
};

export class StylePreviewRegistry {
  readonly #previews = new Map<string, ActivePreview>();
  readonly #supports: CssSupport;
  #nextToken = 1;

  constructor(supports: CssSupport = browserCssSupport) {
    this.#supports = supports;
  }

  get activeCount() {
    return this.#previews.size;
  }

  apply(
    previewId: string,
    inputs: readonly ResolvedStyleOperation[],
  ): StylePreviewResult {
    const compiled = this.#compile(previewId, inputs);
    const existing = this.#previews.get(previewId);
    if (existing !== undefined) {
      if (
        existing.signature === compiled.signature &&
        existing.bindings.every(
          ({ target }, index) => target === compiled.bindings[index]?.target,
        )
      ) {
        return {
          previewId,
          operationCount: existing.operationCount,
        };
      }
      throw new StylePreviewError('preview_id_conflict');
    }
    const active = this.#commit(compiled);
    this.#previews.set(previewId, active);
    return { previewId, operationCount: active.operationCount };
  }

  replace(
    previewId: string,
    inputs: readonly ResolvedStyleOperation[],
  ): StylePreviewResult {
    const compiled = this.#compile(previewId, inputs);
    this.rollback(previewId);
    const active = this.#commit(compiled);
    this.#previews.set(previewId, active);
    return { previewId, operationCount: active.operationCount };
  }

  rollback(previewId: string) {
    const active = this.#previews.get(previewId);
    if (active === undefined) {
      return false;
    }
    this.#previews.delete(previewId);
    for (const style of active.styleElements) {
      style.remove();
    }
    for (const { target, token } of active.bindings) {
      removeToken(target, token);
    }
    return true;
  }

  rollbackAll() {
    for (const previewId of [...this.#previews.keys()]) {
      this.rollback(previewId);
    }
  }

  #compile(
    previewId: string,
    inputs: readonly ResolvedStyleOperation[],
  ): CompiledPreview {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(previewId)) {
      throw new StylePreviewError('invalid_preview_id');
    }
    if (inputs.length === 0 || inputs.length > 64) {
      throw new StylePreviewError('invalid_operation_count');
    }

    const operationIds = new Set<string>();
    const targetProperties = new Map<Element, Set<string>>();
    const rulesByRoot = new Map<StyleRoot, string[]>();
    const bindings: CompiledBinding[] = [];
    const signatureParts: string[] = [];

    for (const input of inputs) {
      const proposal = ProposalOperationSchema.safeParse(input.operation);
      const profile = ProfileOperationSchema.safeParse(input.operation);
      const parsed = proposal.success
        ? proposal.data
        : profile.success
          ? profile.data
          : null;
      if (parsed === null || parsed.kind !== 'style') {
        throw new StylePreviewError('invalid_style_operation');
      }
      const operation: StyleOperation = parsed;
      if (
        operation.target.kind === 'ephemeral' &&
        operation.target.elementId !== input.resolvedElementId
      ) {
        throw new StylePreviewError('resolved_target_mismatch');
      }
      if (operationIds.has(operation.operationId)) {
        throw new StylePreviewError('duplicate_operation_id');
      }
      operationIds.add(operation.operationId);
      if (!input.target.isConnected) {
        throw new StylePreviewError('disconnected_target');
      }
      const root = rootFor(input.target);
      const properties =
        targetProperties.get(input.target) ?? new Set<string>();
      const declarations: string[] = [];
      for (const declaration of operation.declarations) {
        if (properties.has(declaration.property)) {
          throw new StylePreviewError('duplicate_target_property');
        }
        if (/!\s*important/i.test(declaration.value)) {
          throw new StylePreviewError('priority_not_allowed');
        }
        if (!this.#supports(declaration.property, declaration.value)) {
          throw new StylePreviewError('unsupported_css_value');
        }
        properties.add(declaration.property);
        declarations.push(
          `${declaration.property}: ${declaration.value} !important;`,
        );
      }
      targetProperties.set(input.target, properties);
      const token = `mme-${this.#nextToken}-${operation.operationId}`;
      this.#nextToken += 1;
      bindings.push({ target: input.target, token });
      const selector = `[data-match-my-exp-style~="${token}"]`;
      const rules = rulesByRoot.get(root) ?? [];
      rules.push(`${selector} { ${declarations.join(' ')} }`);
      rulesByRoot.set(root, rules);
      signatureParts.push(
        `${operation.operationId}:${operation.declarations
          .map(({ property, value }) => `${property}=${value}`)
          .join(',')}`,
      );
    }

    return {
      previewId,
      signature: signatureParts.join('|'),
      bindings,
      roots: [...rulesByRoot].map(([root, rules]) => ({
        root,
        cssText: rules.join('\n'),
      })),
      operationCount: inputs.length,
    };
  }

  #commit(compiled: CompiledPreview): ActivePreview {
    const styleElements: HTMLStyleElement[] = [];
    const appliedBindings: CompiledBinding[] = [];
    try {
      for (const binding of compiled.bindings) {
        addToken(binding.target, binding.token);
        appliedBindings.push(binding);
      }
      for (const { root, cssText } of compiled.roots) {
        styleElements.push(appendStyle(root, cssText));
      }
      return { ...compiled, styleElements };
    } catch {
      for (const style of styleElements) {
        style.remove();
      }
      for (const { target, token } of appliedBindings) {
        removeToken(target, token);
      }
      throw new StylePreviewError('style_commit_failed');
    }
  }
}
