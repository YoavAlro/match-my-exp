import { beforeEach, describe, expect, it } from 'vitest';
import { inspectDocument, type PageInspection } from '../inspection';
import type { ProviderProposalResult } from '../providers';
import { StylePreviewRegistry } from '../transforms';
import { ConversationRepository } from './repository';
import { MemoryConversationStorage } from './storage';
import { ProposalWorkflow, ProposalWorkflowError } from './workflow';

const conversationId = '00000000-0000-4000-8000-000000000001';

const styleProposal = (elementId: string): ProviderProposalResult => ({
  model: 'gpt-test',
  usage: { inputTokens: 1, outputTokens: 1 },
  proposal: {
    schemaVersion: 1,
    assistantMessage: 'I can increase the contrast.',
    clarification: null,
    operations: [
      {
        kind: 'style',
        operationId: 'style-main',
        target: { kind: 'ephemeral', elementId },
        declarations: [{ property: 'color', value: 'red' }],
      },
    ],
  },
});

const clarification: ProviderProposalResult = {
  model: 'gpt-test',
  usage: { inputTokens: 1, outputTokens: 1 },
  proposal: {
    schemaVersion: 1,
    assistantMessage: 'Which control do you mean?',
    clarification: {
      question: 'Which control do you mean?',
      choices: ['Primary', 'Secondary'],
    },
    operations: [],
  },
};

const createIds = () => {
  let next = 2;
  return () =>
    `00000000-0000-4000-8000-${(next++).toString().padStart(12, '0')}`;
};

const createInspection = () => {
  document.body.innerHTML =
    '<main><button aria-label="Save">Save</button></main>';
  let next = 0;
  return inspectDocument(
    document,
    { origin: 'https://example.com', path: '/account', title: 'Account' },
    { createElementId: () => `element-workflow-${next++}` },
  );
};

const targetId = (inspection: PageInspection) => {
  const element = inspection.context.elements.find(
    ({ accessibleName }) => accessibleName === 'Save',
  );
  if (element === undefined) {
    throw new Error('Inspected target is missing');
  }
  return element.elementId;
};

describe('ProposalWorkflow', () => {
  let conversations: ConversationRepository;
  let inspection: PageInspection;

  beforeEach(async () => {
    conversations = new ConversationRepository(new MemoryConversationStorage());
    await conversations.create({
      schemaVersion: 1,
      id: conversationId,
      title: 'Account',
      createdAt: '2026-07-15T11:00:00Z',
      updatedAt: '2026-07-15T11:00:00Z',
      messages: [],
    });
    inspection = createInspection();
  });

  it('previews, keeps, and undoes a validated style turn', async () => {
    const styles = new StylePreviewRegistry(() => true);
    const provider = {
      propose: async () => styleProposal(targetId(inspection)),
    };
    const workflow = new ProposalWorkflow({
      conversationId,
      model: 'gpt-test',
      conversations,
      provider,
      inspect: async () => inspection,
      styles,
      isCurrent: () => true,
      createId: createIds(),
      now: () => '2026-07-15T11:01:00Z',
    });

    expect(await workflow.submit('Increase contrast')).toMatchObject({
      status: 'preview',
    });
    expect(styles.activeCount).toBe(1);
    expect(
      document.querySelector('button')?.hasAttribute('data-match-my-exp-style'),
    ).toBe(true);
    expect(workflow.keep()).toEqual({ status: 'draft', acceptedTurns: 1 });
    expect(workflow.draftOperations).toHaveLength(1);
    expect(await workflow.submit('Increase contrast again')).toMatchObject({
      status: 'preview',
    });
    expect(workflow.discard()).toBe(true);
    expect(workflow.state).toEqual({ status: 'draft', acceptedTurns: 1 });
    expect(workflow.undo()).toBe(true);
    expect(workflow.undo()).toBe(false);
    expect(() => workflow.keep()).toThrowError(ProposalWorkflowError);
    await expect(
      workflow.answerClarification('Primary'),
    ).rejects.toBeInstanceOf(ProposalWorkflowError);
    expect(styles.activeCount).toBe(0);
    expect(workflow.state).toEqual({ status: 'idle' });

    const stored = await conversations.get(conversationId);
    expect(stored?.messages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(JSON.stringify(stored)).not.toContain('pageContext');
    expect(JSON.stringify(stored)).not.toContain('element-workflow');
  });

  it('asks one clarification without executing and previews the answer', async () => {
    const styles = new StylePreviewRegistry(() => true);
    const responses = [clarification, styleProposal(targetId(inspection))];
    const workflow = new ProposalWorkflow({
      conversationId,
      model: 'gpt-test',
      conversations,
      provider: {
        propose: async () => responses.shift() as ProviderProposalResult,
      },
      inspect: async () => inspection,
      styles,
      isCurrent: () => true,
      createId: createIds(),
      now: () => '2026-07-15T11:01:00Z',
    });

    expect(await workflow.submit('Make the control larger')).toMatchObject({
      status: 'clarification',
      choices: ['Primary', 'Secondary'],
    });
    expect(styles.activeCount).toBe(0);
    expect(await workflow.answerClarification('Primary')).toMatchObject({
      status: 'preview',
    });
    expect(workflow.discard()).toBe(true);
    expect(styles.activeCount).toBe(0);
  });

  it('rejects rich or missing targets before execution and recovers state', async () => {
    const styles = new StylePreviewRegistry(() => true);
    const moveResult: ProviderProposalResult = {
      model: 'gpt-test',
      usage: { inputTokens: 1, outputTokens: 1 },
      proposal: {
        schemaVersion: 1,
        assistantMessage: 'I can move it.',
        clarification: null,
        operations: [
          {
            kind: 'move',
            operationId: 'move-main',
            target: { kind: 'ephemeral', elementId: targetId(inspection) },
            destination: {
              kind: 'ephemeral',
              elementId: targetId(inspection),
            },
            placement: 'after',
          },
        ],
      },
    };
    const responses = [moveResult, styleProposal('element-missing')];
    const workflow = new ProposalWorkflow({
      conversationId,
      model: 'gpt-test',
      conversations,
      provider: {
        propose: async () => responses.shift() as ProviderProposalResult,
      },
      inspect: async () => inspection,
      styles,
      isCurrent: () => true,
      createId: createIds(),
      now: () => '2026-07-15T11:01:00Z',
    });

    await expect(workflow.submit('Move it')).rejects.toMatchObject({
      code: 'unsupported_m1_operation',
    });
    expect(workflow.state).toEqual({ status: 'idle' });
    expect(styles.activeCount).toBe(0);
    await expect(workflow.submit('Style missing target')).rejects.toMatchObject(
      {
        code: 'proposal_target_missing',
      },
    );
    expect(workflow.state).toEqual({ status: 'idle' });
  });

  it('invalidates in-flight responses without applying stale output', async () => {
    const styles = new StylePreviewRegistry(() => true);
    let resolveProvider: ((value: ProviderProposalResult) => void) | undefined;
    const pending = new Promise<ProviderProposalResult>((resolve) => {
      resolveProvider = resolve;
    });
    const workflow = new ProposalWorkflow({
      conversationId,
      model: 'gpt-test',
      conversations,
      provider: { propose: async () => pending },
      inspect: async () => inspection,
      styles,
      isCurrent: () => false,
      createId: createIds(),
      now: () => '2026-07-15T11:01:00Z',
    });
    const submission = workflow.submit('Increase contrast');
    await Promise.resolve();
    workflow.invalidate();
    resolveProvider?.(styleProposal(targetId(inspection)));

    await expect(submission).rejects.toBeInstanceOf(ProposalWorkflowError);
    expect(workflow.state).toEqual({ status: 'idle' });
    expect(styles.activeCount).toBe(0);
  });
});
