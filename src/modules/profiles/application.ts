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

export class DocumentProfileApplication {
  readonly #styles: StylePreviewRegistry;
  #activePreviewId: string | null = null;

  constructor(styles: StylePreviewRegistry) {
    this.#styles = styles;
  }

  apply(document: Document, profile: Profile): ProfileApplicationResult {
    const bindings = this.#preflight(document, profile);
    const previewId = previewIdFor(profile);
    if (this.#activePreviewId === previewId) {
      this.#styles.replace(previewId, bindings);
    } else {
      this.#styles.apply(previewId, bindings);
      if (this.#activePreviewId !== null) {
        this.#styles.rollback(this.#activePreviewId);
      }
    }
    this.#activePreviewId = previewId;
    return {
      status: 'applied',
      profileId: profile.id,
      revision: profile.revision,
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

export class ProfileApplicationService {
  readonly #repository: ProfileRepository;
  readonly #documentApplication: DocumentProfileApplication;

  constructor(repository: ProfileRepository, styles: StylePreviewRegistry) {
    this.#repository = repository;
    this.#documentApplication = new DocumentProfileApplication(styles);
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
    return this.#documentApplication.apply(document, resolution.profile);
  }

  clear() {
    return this.#documentApplication.clear();
  }
}

const previewIdFor = (profile: Profile) =>
  `profile-${profile.id}-r${profile.revision}`;
