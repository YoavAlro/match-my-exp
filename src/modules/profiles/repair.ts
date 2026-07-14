import type { ProposalOperation } from '../contracts';
import type { PageInspection } from '../inspection';
import type { ProviderDestination } from '../permissions';
import { ProfileDraftService, type ProfileDraftReview } from './drafts';
import { ProfileRepository } from './repository';

export interface RepairProposalRequest {
  profileId: string;
  diagnostics: readonly {
    code: string;
    operationId?: string | undefined;
    message: string;
  }[];
  provider: ProviderDestination;
}

export class ProfileRepairError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProfileRepairError';
    this.code = code;
  }
}

export class ProfileRepairService {
  readonly #repository: ProfileRepository;
  readonly #drafts: ProfileDraftService;
  readonly #now: () => string;

  constructor(
    repository: ProfileRepository,
    drafts: ProfileDraftService,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#drafts = drafts;
    this.#now = now;
  }

  async beginUserRepair(
    profileId: string,
    provider: ProviderDestination,
    inspection: PageInspection,
    propose: (request: RepairProposalRequest) => Promise<ProposalOperation[]>,
  ) {
    const profile = await this.#repository.get(profileId);
    if (
      profile === null ||
      profile.enabled ||
      profile.health.state !== 'needs-repair'
    ) {
      throw new ProfileRepairError('profile_not_repairable');
    }
    const operations = await propose({
      profileId,
      diagnostics: structuredClone(profile.health.diagnostics),
      provider,
    });
    return this.#drafts.prepare({
      name: profile.name,
      origin: profile.origin,
      pathPattern: profile.pathPattern,
      intentSummary: profile.intentSummary,
      conversationId: profile.conversationId,
      operations,
      inspection,
    });
  }

  async accept(profileId: string, review: ProfileDraftReview) {
    const current = await this.#repository.get(profileId);
    if (
      current === null ||
      current.enabled ||
      current.health.state !== 'needs-repair'
    ) {
      throw new ProfileRepairError('profile_not_repairable');
    }
    const updatedAt = this.#now();
    return this.#repository.update({
      ...review.profile,
      id: current.id,
      conversationId: current.conversationId,
      revision: current.revision + 1,
      enabled: true,
      health: { state: 'healthy' },
      createdAt: current.createdAt,
      updatedAt,
    });
  }

  reject() {
    return { status: 'rejected' as const };
  }
}
