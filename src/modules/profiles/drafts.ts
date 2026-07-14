import type {
  Profile,
  ProfileOperation,
  ProposalOperation,
} from '../contracts';
import { ProfileSchema } from '../contracts';
import type { PageInspection } from '../inspection';
import { compileDurableTarget } from '../targeting';
import { equalSpecificityConflicts } from './matching';
import { ProfileRepository, ProfileRepositoryError } from './repository';

export interface ProfileDraftInput {
  name: string;
  origin: string;
  pathPattern: string;
  intentSummary: string;
  conversationId: string;
  operations: ProposalOperation[];
  inspection: PageInspection;
}

export interface ProfileDraftReview {
  profile: Profile;
  advanced: {
    operationCount: number;
    operations: ProfileOperation[];
  };
  conflictingProfileIds: string[];
}

export class ProfileDraftError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProfileDraftError';
    this.code = code;
  }
}

const compileOperation = (
  operation: ProposalOperation,
  inspection: PageInspection,
): ProfileOperation => {
  const target = compileDurableTarget(inspection, operation.target);
  if (operation.kind === 'move') {
    return {
      ...operation,
      target,
      destination: compileDurableTarget(inspection, operation.destination),
    };
  }
  return { ...operation, target };
};

export class ProfileDraftService {
  readonly #repository: ProfileRepository;
  readonly #createId: () => string;
  readonly #now: () => string;

  constructor(
    repository: ProfileRepository,
    createId: () => string = () => crypto.randomUUID(),
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#createId = createId;
    this.#now = now;
  }

  async prepare(input: ProfileDraftInput): Promise<ProfileDraftReview> {
    if (input.operations.length === 0) {
      throw new ProfileDraftError('draft_has_no_operations');
    }
    const operations = input.operations.map((operation) =>
      compileOperation(operation, input.inspection),
    );
    const createdAt = this.#now();
    const profile: Profile = ProfileSchema.parse({
      schemaVersion: 1,
      id: this.#createId(),
      name: input.name,
      enabled: true,
      origin: input.origin,
      pathPattern: input.pathPattern,
      intentSummary: input.intentSummary,
      conversationId: input.conversationId,
      operations,
      revision: 1,
      health: { state: 'healthy' },
      createdAt,
      updatedAt: createdAt,
    });
    const existing = await this.#repository.listByOrigin(profile.origin);
    return {
      profile,
      advanced: {
        operationCount: operations.length,
        operations: structuredClone(operations),
      },
      conflictingProfileIds: equalSpecificityConflicts(profile, existing),
    };
  }

  async save(review: ProfileDraftReview, replaceProfileId?: string) {
    const conflicts = review.conflictingProfileIds;
    if (conflicts.length > 0 && replaceProfileId === undefined) {
      throw new ProfileDraftError('profile_overlap_requires_resolution');
    }
    if (
      replaceProfileId !== undefined &&
      !conflicts.includes(replaceProfileId)
    ) {
      throw new ProfileDraftError('replacement_does_not_resolve_conflict');
    }
    if (replaceProfileId === undefined) {
      return this.#repository.create(review.profile);
    }
    const current = await this.#repository.get(replaceProfileId);
    if (current === null) {
      throw new ProfileRepositoryError('profile_not_found');
    }
    return this.#repository.update({
      ...review.profile,
      id: current.id,
      conversationId: current.conversationId,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: this.#now(),
    });
  }
}
