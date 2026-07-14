import type { Profile } from '../contracts';
import { resolveDurableTarget } from '../targeting';
import {
  StylePreviewRegistry,
  type ResolvedStyleOperation,
} from '../transforms';
import { resolveProfile } from './matching';
import { ProfileRepository } from './repository';

export type ProfileApplicationResult =
  | { status: 'none' }
  | { status: 'applied'; profileId: string; revision: number };

export class ProfileApplicationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProfileApplicationError';
    this.code = code;
  }
}

export class ProfileApplicationService {
  readonly #repository: ProfileRepository;
  readonly #styles: StylePreviewRegistry;
  #activePreviewId: string | null = null;

  constructor(repository: ProfileRepository, styles: StylePreviewRegistry) {
    this.#repository = repository;
    this.#styles = styles;
  }

  async apply(
    document: Document,
    pageUrl: string,
  ): Promise<ProfileApplicationResult> {
    const url = new URL(pageUrl);
    const profiles = await this.#repository.listByOrigin(url.origin);
    const resolution = resolveProfile(profiles, pageUrl);
    if (resolution.status === 'none') {
      this.clear();
      return { status: 'none' };
    }
    if (resolution.status === 'conflict') {
      throw new ProfileApplicationError('profile_resolution_conflict');
    }
    const bindings = this.#preflight(document, resolution.profile);
    const previewId = previewIdFor(resolution.profile);
    this.#styles.apply(previewId, bindings);
    if (this.#activePreviewId !== null && this.#activePreviewId !== previewId) {
      this.#styles.rollback(this.#activePreviewId);
    }
    this.#activePreviewId = previewId;
    return {
      status: 'applied',
      profileId: resolution.profile.id,
      revision: resolution.profile.revision,
    };
  }

  clear() {
    if (this.#activePreviewId === null) {
      return false;
    }
    const previewId = this.#activePreviewId;
    this.#activePreviewId = null;
    return this.#styles.rollback(previewId);
  }

  #preflight(document: Document, profile: Profile): ResolvedStyleOperation[] {
    return profile.operations.map((operation) => {
      if (operation.kind !== 'style') {
        throw new ProfileApplicationError('unsupported_profile_operation');
      }
      const resolution = resolveDurableTarget(document, operation.target);
      if (resolution.status !== 'resolved') {
        throw new ProfileApplicationError(
          resolution.status === 'ambiguous'
            ? 'profile_target_ambiguous'
            : 'profile_target_missing',
        );
      }
      return { operation, target: resolution.element };
    });
  }
}

const previewIdFor = (profile: Profile) =>
  `profile-${profile.id}-r${profile.revision}`;
