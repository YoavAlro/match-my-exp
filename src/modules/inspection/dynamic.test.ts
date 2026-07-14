import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamicPageCoordinator } from './dynamic';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

describe('DynamicPageCoordinator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('batches added subtrees and ignores extension-owned nodes', async () => {
    const onSettled = vi.fn();
    const coordinator = new DynamicPageCoordinator({ document, onSettled });
    coordinator.start();
    coordinator.start();

    document.body.append(document.createElement('section'));
    document.body.append(document.createElement('article'));
    const owned = document.createElement('style');
    owned.setAttribute('data-match-my-exp-owned', 'style-preview');
    document.body.append(owned);
    await settle();

    expect(onSettled).toHaveBeenCalledOnce();
    expect([...(onSettled.mock.calls[0]?.[0] ?? [])]).toContain('subtree');
    coordinator.stop();
  });

  it('observes newly added open shadow roots without document rescans', async () => {
    const reasons: string[][] = [];
    const coordinator = new DynamicPageCoordinator({
      document,
      onSettled: (batch) => {
        reasons.push([...batch]);
      },
    });
    coordinator.start();
    const host = document.createElement('account-shell');
    const root = host.attachShadow({ mode: 'open' });
    document.body.append(host);
    await settle();

    expect(reasons[0]).toEqual(
      expect.arrayContaining(['subtree', 'shadow-root']),
    );
    root.append(document.createElement('button'));
    await settle();
    expect(reasons).toHaveLength(2);
    expect(reasons[1]).toContain('subtree');
    coordinator.stop();
  });

  it('deduplicates route changes and supports explicit late shadow roots', async () => {
    const onSettled = vi.fn();
    const coordinator = new DynamicPageCoordinator({ document, onSettled });
    coordinator.start();
    coordinator.navigate('/account');
    coordinator.navigate('/account');
    coordinator.navigate('/settings');
    await settle();

    expect(onSettled).toHaveBeenCalledOnce();
    expect([...(onSettled.mock.calls[0]?.[0] ?? [])]).toContain('navigation');

    const host = document.body.appendChild(
      document.createElement('late-panel'),
    );
    await settle();
    onSettled.mockClear();
    const root = host.attachShadow({ mode: 'open' });
    coordinator.registerShadowRoot(root);
    coordinator.registerShadowRoot(root);
    await settle();
    expect([...(onSettled.mock.calls[0]?.[0] ?? [])]).toContain('shadow-root');
    coordinator.stop();
  });

  it('stops all document and shadow observers', async () => {
    const onSettled = vi.fn();
    const host = document.body.appendChild(
      document.createElement('settings-panel'),
    );
    const root = host.attachShadow({ mode: 'open' });
    const coordinator = new DynamicPageCoordinator({ document, onSettled });
    coordinator.start();
    coordinator.stop();

    document.body.append(document.createElement('main'));
    root.append(document.createElement('button'));
    coordinator.navigate('/after-stop');
    await settle();

    expect(onSettled).toHaveBeenCalledOnce();
  });
});
