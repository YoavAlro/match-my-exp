import { describe, expect, it } from 'vitest';
import {
  DurableTargetSchema,
  PageContextSchema,
  PageElementSchema,
  ProfileHealthSchema,
  ProfileOperationSchema,
  ProfileRevisionSchema,
  ProfileSchema,
  ProposalJsonSchema,
  ProposalOperationSchema,
  ProposalProviderJsonSchema,
  ProposalSchema,
  RuntimeMessageSchema,
  TargetAnchorSchema,
} from './index';

const profileId = '00000000-0000-4000-8000-000000000001';
const otherProfileId = '00000000-0000-4000-8000-000000000002';
const conversationId = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';
const previewId = '00000000-0000-4000-8000-000000000005';
const createdAt = '2026-07-13T08:00:00Z';
const updatedAt = '2026-07-13T08:30:00Z';
const recordedAt = '2026-07-13T09:00:00Z';

const ephemeralTarget = {
  kind: 'ephemeral' as const,
  elementId: 'element-main',
};

const durableTarget = {
  kind: 'durable' as const,
  shadowHosts: [],
  element: {
    attributes: [],
    selector: '#main',
  },
};

const destinationTarget = {
  kind: 'durable' as const,
  shadowHosts: [],
  element: {
    attributes: [],
    selector: '#sidebar',
  },
};

const proposalStyleOperation = {
  kind: 'style' as const,
  operationId: 'style-main',
  target: ephemeralTarget,
  declarations: [{ property: 'color', value: '#111111' }],
};

const profileStyleOperation = {
  kind: 'style' as const,
  operationId: 'style-main',
  target: durableTarget,
  declarations: [{ property: 'color', value: '#111111' }],
};

const pageElement = {
  elementId: 'element-main',
  tag: 'main',
  role: 'main',
  accessibleName: 'Primary content',
  text: 'Welcome',
  attributes: [{ name: 'id' as const, value: 'main' }],
  computedStyles: [{ property: 'display' as const, value: 'block' }],
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

const pageContext = {
  schemaVersion: 1 as const,
  origin: 'https://example.com',
  path: '/account/current',
  title: 'Account',
  elements: [pageElement],
};

const proposal = {
  schemaVersion: 1 as const,
  assistantMessage: 'I can increase the contrast.',
  clarification: null,
  operations: [proposalStyleOperation],
};

const profile = {
  schemaVersion: 1 as const,
  id: profileId,
  name: 'Readable account',
  enabled: true,
  origin: 'https://example.com',
  pathPattern: '/account/*',
  intentSummary: 'Increase contrast on account pages.',
  conversationId,
  operations: [profileStyleOperation],
  revision: 1,
  health: { state: 'healthy' as const },
  createdAt,
  updatedAt,
};

describe('proposal contracts', () => {
  it('accepts each bounded declarative operation kind', () => {
    const operations = [
      proposalStyleOperation,
      {
        kind: 'move',
        operationId: 'move-main',
        target: ephemeralTarget,
        destination: { kind: 'ephemeral', elementId: 'element-sidebar' },
        placement: 'inside-start',
      },
      {
        kind: 'aria',
        operationId: 'label-main',
        target: ephemeralTarget,
        attribute: 'aria-label',
        value: 'Primary content',
      },
      {
        kind: 'keyboard',
        operationId: 'focus-main',
        target: ephemeralTarget,
        shortcut: {
          code: 'KeyM',
          alt: true,
          control: false,
          meta: false,
          shift: false,
        },
        action: 'focus',
      },
    ];

    for (const operation of operations) {
      expect(ProposalOperationSchema.safeParse(operation).success).toBe(true);
    }
  });

  it('accepts an operation proposal or a clarification', () => {
    expect(ProposalSchema.safeParse(proposal).success).toBe(true);
    expect(
      ProposalSchema.safeParse({
        ...proposal,
        clarification: {
          question: 'Which navigation should move?',
          choices: ['Primary', 'Secondary'],
        },
        operations: [],
      }).success,
    ).toBe(true);
  });

  it('rejects ambiguous and duplicate proposal states', () => {
    expect(
      ProposalSchema.safeParse({ ...proposal, operations: [] }).success,
    ).toBe(false);
    expect(
      ProposalSchema.safeParse({
        ...proposal,
        clarification: { question: 'Which one?', choices: [] },
      }).success,
    ).toBe(false);
    expect(
      ProposalSchema.safeParse({
        ...proposal,
        operations: [proposalStyleOperation, proposalStyleOperation],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown, executable, malformed, and excessive fields', () => {
    const invalidOperations = [
      { ...proposalStyleOperation, javascript: 'alert(1)' },
      {
        kind: 'script',
        operationId: 'execute-main',
        target: ephemeralTarget,
        source: 'alert(1)',
      },
      {
        ...proposalStyleOperation,
        target: { ...ephemeralTarget, html: '<script></script>' },
      },
    ];

    for (const operation of invalidOperations) {
      expect(ProposalOperationSchema.safeParse(operation).success).toBe(false);
    }

    expect(
      ProposalSchema.safeParse({ ...proposal, schemaVersion: 2 }).success,
    ).toBe(false);
    expect(
      ProposalSchema.safeParse({ ...proposal, credential: 'secret' }).success,
    ).toBe(false);
    expect(
      ProposalSchema.safeParse({
        ...proposal,
        assistantMessage: 'x'.repeat(4_001),
      }).success,
    ).toBe(false);
    expect(
      ProposalSchema.safeParse({
        ...proposal,
        operations: Array.from({ length: 65 }, (_, index) => ({
          ...proposalStyleOperation,
          operationId: `style-${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it('rejects resource-bearing and executable CSS syntax', () => {
    const unsafeValues = [
      'url(https://attacker.example/pixel)',
      'expression(alert(1))',
      'javascript:alert(1)',
      '@import "https://attacker.example/style.css"',
      '-moz-binding: url(binding.xml)',
      '\\75\\72\\6c(https://attacker.example/pixel)',
      'red; background-image: url(https://attacker.example/pixel)',
      'red/* hidden payload */',
      'red\u0000',
    ];

    for (const value of unsafeValues) {
      expect(
        ProposalOperationSchema.safeParse({
          ...proposalStyleOperation,
          declarations: [{ property: 'color', value }],
        }).success,
      ).toBe(false);
    }

    expect(
      ProposalOperationSchema.safeParse({
        ...proposalStyleOperation,
        declarations: [
          { property: 'color', value: 'red' },
          { property: 'color', value: 'blue' },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProposalOperationSchema.safeParse({
        ...proposalStyleOperation,
        declarations: [
          {
            property: 'background-image',
            value: 'linear-gradient(red, blue)',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('produces full and portable provider JSON Schemas', () => {
    expect(ProposalJsonSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'assistantMessage',
        'clarification',
        'operations',
      ],
      properties: {
        operations: { maxItems: 64 },
      },
    });
    expect(ProposalProviderJsonSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'assistantMessage',
        'clarification',
        'operations',
      ],
    });

    const providerSchema = JSON.stringify(ProposalProviderJsonSchema);
    expect(providerSchema).toContain('"anyOf"');
    expect(providerSchema).not.toContain('"$schema"');
    expect(providerSchema).not.toContain('"oneOf"');
    expect(providerSchema).not.toContain('"const"');
    expect(providerSchema).not.toContain('"maxItems"');
    expect(providerSchema).not.toContain('"maxLength"');
    expect(providerSchema).not.toContain('"pattern"');
  });
});

describe('target and page context contracts', () => {
  it('accepts every durable locating strategy and open shadow chains', () => {
    const anchors = [
      { attributes: [], tag: 'main' },
      { attributes: [], role: 'navigation' },
      { attributes: [], accessibleName: 'Primary' },
      { attributes: [{ name: 'data-testid', value: 'primary' }] },
      { attributes: [], childPath: [0, 2] },
      { attributes: [], selector: '#main' },
      {
        attributes: [],
        selector:
          'main#main.content[data-testid="primary"] > section:nth-child(2)',
      },
    ];

    for (const anchor of anchors) {
      expect(TargetAnchorSchema.safeParse(anchor).success).toBe(true);
    }

    expect(
      DurableTargetSchema.safeParse({
        ...durableTarget,
        shadowHosts: [
          { attributes: [], tag: 'app-shell', selector: 'app-shell' },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects empty, duplicate, malformed, and unknown target data', () => {
    const invalidAnchors = [
      { attributes: [] },
      { attributes: [], childPath: [] },
      {
        attributes: [
          { name: 'id', value: 'main' },
          { name: 'id', value: 'other' },
        ],
      },
      { attributes: [], selector: '#main', script: 'alert(1)' },
      { attributes: [], selector: '[' },
      { attributes: [], selector: 'main, script' },
    ];

    for (const anchor of invalidAnchors) {
      expect(TargetAnchorSchema.safeParse(anchor).success).toBe(false);
    }
  });

  it('accepts bounded semantic page context', () => {
    expect(PageElementSchema.safeParse(pageElement).success).toBe(true);
    expect(PageContextSchema.safeParse(pageContext).success).toBe(true);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        elements: [
          pageElement,
          {
            ...pageElement,
            elementId: 'element-child',
            parentId: pageElement.elementId,
            shadowHostId: pageElement.elementId,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects unsafe origins and non-path input without throwing', () => {
    const invalidOrigins = [
      'not a URL',
      'http://example.com',
      'https://example.com/path',
      'https://example.com/',
    ];

    for (const origin of invalidOrigins) {
      expect(() =>
        PageContextSchema.safeParse({ ...pageContext, origin }),
      ).not.toThrow();
      expect(
        PageContextSchema.safeParse({ ...pageContext, origin }).success,
      ).toBe(false);
    }

    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        path: '/account?token=secret',
      }).success,
    ).toBe(false);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        path: '/account#private',
      }).success,
    ).toBe(false);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        path: '/account/*',
      }).success,
    ).toBe(true);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        path: '/account/private data',
      }).success,
    ).toBe(false);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        path: '/account/\u007f',
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate identifiers, attributes, and style samples', () => {
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        elements: [pageElement, pageElement],
      }).success,
    ).toBe(false);
    expect(
      PageElementSchema.safeParse({
        ...pageElement,
        attributes: [
          { name: 'id', value: 'main' },
          { name: 'id', value: 'other' },
        ],
      }).success,
    ).toBe(false);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        elements: [
          {
            ...pageElement,
            elementId: 'element-child',
            parentId: 'element-missing',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        elements: [{ ...pageElement, parentId: pageElement.elementId }],
      }).success,
    ).toBe(false);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        elements: [
          {
            ...pageElement,
            elementId: 'element-first',
            parentId: 'element-second',
          },
          {
            ...pageElement,
            elementId: 'element-second',
            parentId: 'element-first',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      PageElementSchema.safeParse({
        ...pageElement,
        computedStyles: [
          { property: 'display', value: 'block' },
          { property: 'display', value: 'grid' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects raw page data, malformed references, and excessive elements', () => {
    expect(
      PageElementSchema.safeParse({
        ...pageElement,
        html: '<main>private</main>',
      }).success,
    ).toBe(false);
    expect(
      PageElementSchema.safeParse({
        ...pageElement,
        parentId: 'unscoped-parent',
      }).success,
    ).toBe(false);
    expect(
      PageContextSchema.safeParse({
        ...pageContext,
        elements: Array.from({ length: 1_001 }, (_, index) => ({
          ...pageElement,
          elementId: `element-${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});

describe('profile contracts', () => {
  it('accepts every durable operation kind', () => {
    const operations = [
      profileStyleOperation,
      {
        kind: 'move',
        operationId: 'move-main',
        target: durableTarget,
        destination: destinationTarget,
        placement: 'after',
      },
      {
        kind: 'aria',
        operationId: 'describe-main',
        target: durableTarget,
        attribute: 'aria-description',
        value: null,
      },
      {
        kind: 'keyboard',
        operationId: 'scroll-main',
        target: durableTarget,
        shortcut: {
          code: 'Home',
          alt: false,
          control: true,
          meta: false,
          shift: true,
        },
        action: 'scroll-start',
      },
    ];

    for (const operation of operations) {
      expect(ProfileOperationSchema.safeParse(operation).success).toBe(true);
    }
  });

  it('accepts healthy, disabled, and needs-repair profiles', () => {
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      ProfileSchema.safeParse({ ...profile, enabled: false }).success,
    ).toBe(true);
    expect(
      ProfileSchema.safeParse({
        ...profile,
        enabled: false,
        health: {
          state: 'needs-repair',
          diagnostics: [
            {
              code: 'missing-target',
              operationId: 'style-main',
              message: 'The main target was not found.',
            },
          ],
          detectedAt: recordedAt,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects inconsistent health, timestamps, revisions, and operations', () => {
    const needsRepair = {
      state: 'needs-repair' as const,
      diagnostics: [
        { code: 'missing-target' as const, message: 'Target missing.' },
      ],
      detectedAt: recordedAt,
    };

    expect(
      ProfileSchema.safeParse({ ...profile, health: needsRepair }).success,
    ).toBe(false);
    expect(
      ProfileHealthSchema.safeParse({
        ...needsRepair,
        diagnostics: [{ ...needsRepair.diagnostics[0], operationId: 'bad id' }],
      }).success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({
        ...profile,
        enabled: false,
        health: {
          ...needsRepair,
          diagnostics: [
            {
              ...needsRepair.diagnostics[0],
              operationId: 'missing-operation',
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({
        ...profile,
        createdAt: updatedAt,
        updatedAt: createdAt,
      }).success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({
        ...profile,
        revision: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({
        ...profile,
        operations: [profileStyleOperation, profileStyleOperation],
      }).success,
    ).toBe(false);
  });

  it('validates immutable revision snapshot envelopes', () => {
    const revision = {
      schemaVersion: 1,
      profileId,
      revision: 1,
      snapshot: profile,
      recordedAt,
    };

    expect(ProfileRevisionSchema.safeParse(revision).success).toBe(true);
    expect(
      ProfileRevisionSchema.safeParse({
        ...revision,
        profileId: otherProfileId,
      }).success,
    ).toBe(false);
    expect(
      ProfileRevisionSchema.safeParse({ ...revision, revision: 2 }).success,
    ).toBe(false);
    expect(
      ProfileRevisionSchema.safeParse({
        ...revision,
        recordedAt: createdAt,
      }).success,
    ).toBe(false);
    expect(
      ProfileRevisionSchema.safeParse({ ...revision, apiKey: 'secret' })
        .success,
    ).toBe(false);
  });
});

describe('runtime message contracts', () => {
  it('accepts each versioned runtime message', () => {
    const messages = [
      {
        schemaVersion: 1,
        requestId,
        type: 'page.inspect.request',
        tabId: 12,
        expectedOrigin: 'https://example.com',
        expectedPath: '/account/current',
      },
      {
        schemaVersion: 1,
        requestId,
        type: 'page.inspect.response',
        context: pageContext,
      },
      {
        schemaVersion: 1,
        requestId,
        type: 'proposal.preview',
        expectedOrigin: pageContext.origin,
        expectedPath: pageContext.path,
        previewId,
        operations: proposal.operations,
      },
      {
        schemaVersion: 1,
        requestId,
        type: 'preview.rollback',
        expectedOrigin: pageContext.origin,
        expectedPath: pageContext.path,
        previewId,
      },
      {
        schemaVersion: 1,
        requestId,
        type: 'profile.apply',
        expectedOrigin: pageContext.origin,
        expectedPath: pageContext.path,
        profileId,
        revision: profile.revision,
        operations: profile.operations,
      },
    ];

    for (const message of messages) {
      expect(RuntimeMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it('rejects credentials, stale versions, malformed paths, and unknown types', () => {
    const inspectionRequest = {
      schemaVersion: 1,
      requestId,
      type: 'page.inspect.request',
      tabId: 12,
      expectedOrigin: 'https://example.com',
      expectedPath: '/account',
    };

    expect(
      RuntimeMessageSchema.safeParse({
        ...inspectionRequest,
        apiKey: 'secret',
      }).success,
    ).toBe(false);
    expect(
      RuntimeMessageSchema.safeParse({
        schemaVersion: 1,
        requestId,
        type: 'proposal.preview',
        expectedOrigin: pageContext.origin,
        expectedPath: pageContext.path,
        previewId,
        operations: [],
      }).success,
    ).toBe(false);
    expect(
      RuntimeMessageSchema.safeParse({
        schemaVersion: 1,
        requestId,
        type: 'profile.apply',
        expectedOrigin: pageContext.origin,
        expectedPath: pageContext.path,
        profileId,
        revision: 1,
        operations: [profileStyleOperation, profileStyleOperation],
      }).success,
    ).toBe(false);
    expect(
      RuntimeMessageSchema.safeParse({
        schemaVersion: 1,
        requestId,
        type: 'profile.apply',
        expectedOrigin: pageContext.origin,
        expectedPath: pageContext.path,
        profileId,
        revision: 1,
        operations: profile.operations,
        conversationId,
      }).success,
    ).toBe(false);
    expect(
      RuntimeMessageSchema.safeParse({
        ...inspectionRequest,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      RuntimeMessageSchema.safeParse({
        ...inspectionRequest,
        expectedPath: '/account?token=secret',
      }).success,
    ).toBe(false);
    expect(
      RuntimeMessageSchema.safeParse({
        ...inspectionRequest,
        tabId: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      RuntimeMessageSchema.safeParse({
        schemaVersion: 1,
        requestId,
        type: 'provider.execute',
        apiKey: 'secret',
      }).success,
    ).toBe(false);
  });
});
