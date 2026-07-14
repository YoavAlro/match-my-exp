import { resolveProfile } from './matching';
import {
  ProfileApplicationError,
  ProfileApplicationService,
} from './application';
import { ProfileRepository } from './repository';

export type SettledApplicationResult =
  | { status: 'applied' | 'none' }
  | { status: 'interrupted' }
  | { status: 'needs-repair'; profileId: string };

export interface SettledApplicationOptions {
  attempts?: number;
  wait?: () => Promise<void>;
  currentUrl?: () => string;
  now?: () => string;
}

export class ProfileHealthService {
  readonly #repository: ProfileRepository;
  readonly #application: ProfileApplicationService;

  constructor(
    repository: ProfileRepository,
    application: ProfileApplicationService,
  ) {
    this.#repository = repository;
    this.#application = application;
  }

  async applySettled(
    document: Document,
    pageUrl: string,
    options: SettledApplicationOptions = {},
  ): Promise<SettledApplicationResult> {
    const attempts = Math.max(1, Math.min(options.attempts ?? 3, 5));
    const wait = options.wait ?? (() => Promise.resolve());
    const currentUrl = options.currentUrl ?? (() => pageUrl);
    const now = options.now ?? (() => new Date().toISOString());
    const url = new URL(pageUrl);
    const profiles = await this.#repository.listByOrigin(url.origin);
    const resolved = resolveProfile(profiles, pageUrl);
    if (resolved.status === 'none') {
      this.#application.clear();
      return { status: 'none' };
    }
    if (resolved.status === 'conflict') {
      throw new ProfileApplicationError('profile_resolution_conflict');
    }

    let failure: ProfileApplicationError | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (currentUrl() !== pageUrl) {
        return { status: 'interrupted' };
      }
      try {
        await this.#application.apply(document, pageUrl);
        return { status: 'applied' };
      } catch (error) {
        if (!(error instanceof ProfileApplicationError)) {
          throw error;
        }
        failure = error;
        if (
          error.code !== 'profile_target_missing' ||
          attempt === attempts - 1
        ) {
          break;
        }
        await wait();
      }
    }
    if (currentUrl() !== pageUrl) {
      return { status: 'interrupted' };
    }
    const current = await this.#repository.get(resolved.profile.id);
    if (current === null || failure === null) {
      return { status: 'interrupted' };
    }
    await this.#repository.update({
      ...current,
      enabled: false,
      revision: current.revision + 1,
      health: {
        state: 'needs-repair',
        diagnostics: [
          {
            code:
              failure.code === 'profile_target_ambiguous'
                ? 'ambiguous-target'
                : failure.code === 'profile_target_missing'
                  ? 'missing-target'
                  : 'operation-rejected',
            message: diagnosticMessage(failure.code),
          },
        ],
        detectedAt: now(),
      },
      updatedAt: now(),
    });
    return { status: 'needs-repair', profileId: current.id };
  }
}

const diagnosticMessage = (code: string) => {
  if (code === 'profile_target_missing') {
    return 'A required page target did not appear within the settling window.';
  }
  if (code === 'profile_target_ambiguous') {
    return 'A required page target matched more than one element.';
  }
  return 'A profile operation was rejected during complete preflight.';
};
