import { ChromeProfileStorage, ProfileRepository } from '../profiles';
import {
  ChromeContentScriptRegistrationAdapter,
  ContentScriptRegistrationService,
} from './registrations';

type BrowserRegistrationApi = Pick<
  typeof browser,
  'permissions' | 'runtime' | 'scripting' | 'storage'
>;

export const installProfileRegistrations = (api: BrowserRegistrationApi) => {
  const profiles = new ProfileRepository(
    new ChromeProfileStorage(api.storage.local),
  );
  const registrations = new ContentScriptRegistrationService(
    new ChromeContentScriptRegistrationAdapter(api.scripting, api.permissions),
  );
  let queue = Promise.resolve();
  const reconcile = () => {
    queue = queue
      .then(
        async () => registrations.reconcile(await profiles.enabledOrigins()),
        async () => registrations.reconcile(await profiles.enabledOrigins()),
      )
      .then(() => undefined);
    return queue;
  };

  api.runtime.onInstalled.addListener(() => void reconcile());
  api.runtime.onStartup.addListener(() => void reconcile());
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.profileRepository !== undefined) {
      void reconcile();
    }
  });
  api.permissions.onRemoved.addListener(() => void reconcile());
  api.permissions.onAdded.addListener(() => void reconcile());
  void reconcile();
  return reconcile;
};
