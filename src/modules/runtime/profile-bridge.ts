import { RuntimeMessageSchema } from '../contracts';
import {
  ChromeProfileStorage,
  ProfileRepository,
  resolveProfile,
} from '../profiles';

type BrowserProfileApi = Pick<
  typeof browser,
  'permissions' | 'runtime' | 'storage' | 'tabs'
>;

const matchesSender = (
  api: BrowserProfileApi,
  sender: Parameters<
    Parameters<BrowserProfileApi['runtime']['onMessage']['addListener']>[0]
  >[1],
  origin: string,
  path: string,
) => {
  if (
    sender.id !== api.runtime.id ||
    sender.tab?.id === undefined ||
    sender.frameId !== 0 ||
    sender.url === undefined
  ) {
    return false;
  }
  try {
    const url = new URL(sender.url);
    return url.origin === origin && url.pathname === path;
  } catch {
    return false;
  }
};

export const installProfileBridge = (api: BrowserProfileApi) => {
  const repository = new ProfileRepository(
    new ChromeProfileStorage(api.storage.local),
  );

  api.runtime.onMessage.addListener((raw, sender) => {
    const parsed = RuntimeMessageSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.type !== 'profile.resolve.request' ||
      !matchesSender(
        api,
        sender,
        parsed.data.expectedOrigin,
        parsed.data.expectedPath,
      )
    ) {
      return undefined;
    }
    return resolveForPage(parsed.data);
  });

  const resolveForPage = async (request: {
    requestId: string;
    expectedOrigin: string;
    expectedPath: string;
  }) => {
    const permitted = await api.permissions.contains({
      origins: [`${request.expectedOrigin}/*`],
    });
    let profile = null;
    if (permitted) {
      const resolution = resolveProfile(
        await repository.listByOrigin(request.expectedOrigin),
        `${request.expectedOrigin}${request.expectedPath}`,
      );
      if (resolution.status === 'match') {
        profile = resolution.profile;
      }
    }
    return RuntimeMessageSchema.parse({
      schemaVersion: 1,
      type: 'profile.resolve.response',
      requestId: request.requestId,
      profile,
    });
  };

  api.permissions.onRemoved.addListener(({ origins }) => {
    for (const pattern of origins ?? []) {
      void clearOrigin(pattern);
    }
  });

  const clearOrigin = async (pattern: string) => {
    const origin = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
    const tabs = await api.tabs.query({});
    await Promise.all(
      tabs.flatMap((tab) => {
        if (tab.id === undefined) {
          return [];
        }
        return [
          api.tabs
            .sendMessage(tab.id, {
              schemaVersion: 1,
              type: 'profile.clear',
              requestId: crypto.randomUUID(),
              expectedOrigin: new URL(origin).origin,
            })
            .catch(() => undefined),
        ];
      }),
    );
  };

  return { repository };
};
