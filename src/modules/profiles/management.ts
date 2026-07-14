import type { SiteAccessService } from '../permissions';
import type { ProfileApplicationService } from './application';
import type { ProfileRepository } from './repository';

export class ProfileManagementService {
  readonly #repository: ProfileRepository;
  readonly #application: ProfileApplicationService;
  readonly #access: SiteAccessService;
  readonly #now: () => string;

  constructor(
    repository: ProfileRepository,
    application: ProfileApplicationService,
    access: SiteAccessService,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#application = application;
    this.#access = access;
    this.#now = now;
  }

  async list(origin: string) {
    return (await this.#repository.listByOrigin(origin)).map((profile) => ({
      id: profile.id,
      name: profile.name,
      origin: profile.origin,
      pathPattern: profile.pathPattern,
      enabled: profile.enabled,
      revision: profile.revision,
      health: profile.health.state,
      operationCount: profile.operations.length,
    }));
  }

  async disable(profileId: string) {
    this.#application.clear();
    return this.#repository.disable(profileId, this.#now());
  }

  async delete(profileId: string) {
    this.#application.clear();
    return this.#repository.delete(profileId);
  }

  async revoke(origin: string) {
    this.#application.clear();
    const profiles = await this.#repository.listByOrigin(origin);
    for (const profile of profiles) {
      if (profile.enabled) {
        await this.#repository.disable(profile.id, this.#now());
      }
    }
    return this.#access.revoke(origin);
  }
}
