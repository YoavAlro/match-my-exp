import axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SidePanel } from './SidePanel';

describe('SidePanel', () => {
  it('introduces the product and its local-first status', () => {
    render(<SidePanel />);

    expect(
      screen.getByRole('heading', { name: 'Match My Exp' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Make the web fit you.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Local-first by design')).toBeInTheDocument();
  });

  it('shows current-site readiness without page content', async () => {
    render(
      <SidePanel
        loadReadiness={async () => ({
          schemaVersion: 1,
          type: 'panel.readiness.response',
          requestId: '00000000-0000-4000-8000-000000000001',
          readiness: 'ready',
          tabId: 7,
          origin: 'https://example.com',
          path: '/account',
          epoch: 1,
        })}
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ready for https://example.com/account',
    );
  });

  it('fails closed when readiness cannot be loaded', async () => {
    render(
      <SidePanel
        loadReadiness={async () => {
          throw new Error('private failure');
        }}
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'No active page available',
    );
    expect(screen.queryByText('private failure')).not.toBeInTheDocument();
  });

  it('grants access only after an explicit ready-site action', async () => {
    const requestSiteAccess = vi.fn().mockResolvedValue({
      status: 'ready',
      pageOrigin: 'https://example.com',
    });
    render(
      <SidePanel
        loadReadiness={async () => ({
          schemaVersion: 1,
          type: 'panel.readiness.response',
          requestId: '00000000-0000-4000-8000-000000000001',
          readiness: 'ready',
          tabId: 7,
          origin: 'https://example.com',
          path: '/account',
          epoch: 1,
        })}
        requestSiteAccess={requestSiteAccess}
      />,
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Grant site access' }),
    );

    expect(requestSiteAccess).toHaveBeenCalledWith(
      'https://example.com/account',
      { id: 'openai', origin: 'https://api.openai.com' },
    );
    expect(await screen.findByText('Site access granted')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Grant site access' }),
    ).not.toBeInTheDocument();
  });

  it('configures a provider and drives preview controls', async () => {
    const configureProvider = vi.fn().mockResolvedValue(undefined);
    const sendPanelCommand = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        type: 'panel.chat.response',
        requestId: '00000000-0000-4000-8000-000000000010',
        status: 'preview',
        assistantMessage: 'Preview ready',
        previewId: '00000000-0000-4000-8000-000000000011',
        clarificationQuestion: null,
        clarificationChoices: [],
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        type: 'panel.chat.response',
        requestId: '00000000-0000-4000-8000-000000000012',
        status: 'discarded',
        assistantMessage: '',
        previewId: '00000000-0000-4000-8000-000000000011',
        clarificationQuestion: null,
        clarificationChoices: [],
      });
    render(
      <SidePanel
        loadReadiness={async () => ({
          schemaVersion: 1,
          type: 'panel.readiness.response',
          requestId: '00000000-0000-4000-8000-000000000001',
          readiness: 'ready',
          tabId: 7,
          origin: 'https://example.com',
          path: '/account',
          epoch: 1,
        })}
        requestSiteAccess={async () => ({
          status: 'ready',
          pageOrigin: 'https://example.com',
        })}
        configureProvider={configureProvider}
        sendPanelCommand={sendPanelCommand}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Grant site access' }),
    );
    await user.type(
      screen.getByLabelText('API key', { exact: true }),
      'sk-test',
    );
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    expect(configureProvider).toHaveBeenCalledWith({
      configuration: { provider: 'openai', model: 'gpt-5' },
      credential: 'sk-test',
    });

    await user.type(
      await screen.findByLabelText('Describe the change'),
      'Increase contrast',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Preview ready')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard preview' }));
    expect(sendPanelCommand).toHaveBeenCalledTimes(2);
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<SidePanel />);
    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
