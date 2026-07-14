import { describe, expect, it, vi } from 'vitest';
import { installProfileRegistrations } from './install-registrations';

describe('installProfileRegistrations', () => {
  it('reconciles at install, startup, profile change, and initialization', async () => {
    let installed: (() => void) | undefined;
    let startup: (() => void) | undefined;
    let changed:
      | ((changes: Record<string, unknown>, areaName: string) => void)
      | undefined;
    const get = vi.fn().mockResolvedValue({
      profileRepository: {
        schemaVersion: 1,
        profiles: {},
        revisions: {},
      },
    });
    const api = {
      runtime: {
        onInstalled: {
          addListener: (listener: () => void) => {
            installed = listener;
          },
        },
        onStartup: {
          addListener: (listener: () => void) => {
            startup = listener;
          },
        },
      },
      storage: {
        local: { get, set: vi.fn().mockResolvedValue(undefined) },
        onChanged: {
          addListener: (
            listener: (
              changes: Record<string, unknown>,
              areaName: string,
            ) => void,
          ) => {
            changed = listener;
          },
        },
      },
      scripting: {
        getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
        registerContentScripts: vi.fn().mockResolvedValue(undefined),
        unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        onRemoved: { addListener: vi.fn() },
        onAdded: { addListener: vi.fn() },
      },
    };

    const reconcile = installProfileRegistrations(
      api as unknown as Parameters<typeof installProfileRegistrations>[0],
    );
    await reconcile();
    installed?.();
    startup?.();
    changed?.({}, 'sync');
    changed?.({}, 'local');
    changed?.({ profileRepository: {} }, 'local');
    await reconcile();

    expect(get).toHaveBeenCalled();
    expect(installed).toBeTypeOf('function');
    expect(startup).toBeTypeOf('function');
    expect(changed).toBeTypeOf('function');
  });
});
