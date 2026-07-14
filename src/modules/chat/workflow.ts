import {
  ProposalSchema,
  type Proposal,
  type ProposalOperation,
} from '../contracts';
import type { PageInspection } from '../inspection';
import type { ProviderProposalResult } from '../providers';
import {
  StylePreviewRegistry,
  type ResolvedStyleOperation,
} from '../transforms';
import type { ConversationRepository } from './repository';

export type WorkflowState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | {
      status: 'clarification';
      question: string;
      choices: string[];
      originalRequest: string;
    }
  | { status: 'preview'; previewId: string; assistantMessage: string }
  | { status: 'draft'; acceptedTurns: number };

interface ProposalProvider {
  propose(request: {
    model: string;
    userMessage: string;
    pageContext: PageInspection['context'];
    signal?: AbortSignal;
  }): Promise<ProviderProposalResult>;
}

export interface ProposalWorkflowOptions {
  conversationId: string;
  model: string;
  conversations: ConversationRepository;
  provider: ProposalProvider;
  inspect: () => Promise<PageInspection>;
  styles: StylePreviewRegistry;
  isCurrent: () => boolean;
  createId?: () => string;
  now?: () => string;
}

interface AcceptedTurn {
  previewId: string;
  operations: ProposalOperation[];
}

export class ProposalWorkflowError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProposalWorkflowError';
    this.code = code;
  }
}

export class ProposalWorkflow {
  readonly #conversationId: string;
  readonly #model: string;
  readonly #conversations: ConversationRepository;
  readonly #provider: ProposalProvider;
  readonly #inspect: () => Promise<PageInspection>;
  readonly #styles: StylePreviewRegistry;
  readonly #isCurrent: () => boolean;
  readonly #createId: () => string;
  readonly #now: () => string;
  #state: WorkflowState = { status: 'idle' };
  #generation = 0;
  #currentPreview: AcceptedTurn | null = null;
  #accepted: AcceptedTurn[] = [];

  constructor(options: ProposalWorkflowOptions) {
    this.#conversationId = options.conversationId;
    this.#model = options.model;
    this.#conversations = options.conversations;
    this.#provider = options.provider;
    this.#inspect = options.inspect;
    this.#styles = options.styles;
    this.#isCurrent = options.isCurrent;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  get state() {
    return structuredClone(this.#state);
  }

  get draftOperations() {
    return structuredClone(
      this.#accepted.flatMap(({ operations }) => operations),
    );
  }

  async submit(userMessage: string) {
    const generation = ++this.#generation;
    this.discard();
    this.#state = { status: 'requesting' };
    await this.#appendVisible('user', userMessage);
    try {
      const inspection = await this.#inspect();
      const result = await this.#provider.propose({
        model: this.#model,
        userMessage,
        pageContext: inspection.context,
      });
      if (generation !== this.#generation || !this.#isCurrent()) {
        throw new ProposalWorkflowError('stale_provider_response');
      }
      const proposal = ProposalSchema.parse(result.proposal);
      await this.#appendVisible('assistant', proposal.assistantMessage);
      if (proposal.clarification !== null) {
        this.#state = {
          status: 'clarification',
          question: proposal.clarification.question,
          choices: proposal.clarification.choices,
          originalRequest: userMessage,
        };
        return this.state;
      }
      const resolved = this.#resolveStyles(proposal, inspection);
      const previewId = this.#createId();
      this.#styles.apply(previewId, resolved);
      this.#currentPreview = {
        previewId,
        operations: structuredClone(proposal.operations),
      };
      this.#state = {
        status: 'preview',
        previewId,
        assistantMessage: proposal.assistantMessage,
      };
      return this.state;
    } catch (error) {
      if (generation === this.#generation) {
        this.#state = { status: 'idle' };
      }
      throw error;
    }
  }

  async answerClarification(answer: string) {
    if (this.#state.status !== 'clarification') {
      throw new ProposalWorkflowError('clarification_not_active');
    }
    const request = `${this.#state.originalRequest}\nClarification answer: ${answer}`;
    return this.submit(request);
  }

  keep() {
    if (this.#currentPreview === null) {
      throw new ProposalWorkflowError('preview_not_active');
    }
    this.#accepted.push(this.#currentPreview);
    this.#currentPreview = null;
    this.#state = { status: 'draft', acceptedTurns: this.#accepted.length };
    return this.state;
  }

  discard() {
    if (this.#currentPreview !== null) {
      this.#styles.rollback(this.#currentPreview.previewId);
      this.#currentPreview = null;
      this.#state =
        this.#accepted.length === 0
          ? { status: 'idle' }
          : { status: 'draft', acceptedTurns: this.#accepted.length };
      return true;
    }
    return false;
  }

  undo() {
    this.discard();
    const accepted = this.#accepted.pop();
    if (accepted === undefined) {
      return false;
    }
    this.#styles.rollback(accepted.previewId);
    this.#state =
      this.#accepted.length === 0
        ? { status: 'idle' }
        : { status: 'draft', acceptedTurns: this.#accepted.length };
    return true;
  }

  invalidate() {
    this.#generation += 1;
    this.#styles.rollbackAll();
    this.#currentPreview = null;
    this.#accepted = [];
    this.#state = { status: 'idle' };
  }

  #resolveStyles(
    proposal: Proposal,
    inspection: PageInspection,
  ): ResolvedStyleOperation[] {
    return proposal.operations.map((operation) => {
      if (operation.kind !== 'style') {
        throw new ProposalWorkflowError('unsupported_m1_operation');
      }
      const target = inspection.resolve(operation.target.elementId);
      if (target === null) {
        throw new ProposalWorkflowError('proposal_target_missing');
      }
      return {
        operation,
        resolvedElementId: operation.target.elementId,
        target,
      };
    });
  }

  async #appendVisible(role: 'user' | 'assistant', text: string) {
    await this.#conversations.append(this.#conversationId, {
      schemaVersion: 1,
      id: this.#createId(),
      conversationId: this.#conversationId,
      role,
      text,
      createdAt: this.#now(),
    });
  }
}
