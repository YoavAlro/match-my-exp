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
    expect(
      screen.getByText(/Local-first\. Preview before save\./),
    ).toBeInTheDocument();
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
        loadProviderStatus={async () => ({
          configuration: { provider: 'openai', model: 'gpt-5' },
          credential: { present: true, identifier: 'configured' },
        })}
        checkSiteAccess={async () => ({
          status: 'denied',
          pageOrigin: 'https://example.com',
        })}
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
      await screen.findByRole('button', { name: 'Configure provider' }),
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
    await user.click(
      await screen.findByRole('button', { name: 'Grant site access' }),
    );

    await user.type(
      await screen.findByLabelText('Describe the change'),
      'Increase contrast',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Preview ready')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard preview' }));
    expect(sendPanelCommand).toHaveBeenCalledTimes(2);
  });

  it('shows a redacted error when a request becomes stale', async () => {
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
        configureProvider={async () => undefined}
        sendPanelCommand={async () => ({
          schemaVersion: 1,
          type: 'panel.chat.response',
          requestId: '00000000-0000-4000-8000-000000000010',
          status: 'error',
          assistantMessage: 'The page changed before I could finish.',
          previewId: null,
          clarificationQuestion: null,
          clarificationChoices: [],
          errorCode: 'page_changed',
        })}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Configure provider' }),
    );
    await user.type(screen.getByLabelText('API key', { exact: true }), 'key');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    await user.click(
      await screen.findByRole('button', { name: 'Grant site access' }),
    );
    await user.type(
      screen.getByLabelText('Describe the change'),
      'Increase contrast',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The page changed before I could finish. (page_changed)',
    );
    expect(
      screen.queryByText('private provider response'),
    ).not.toBeInTheDocument();
  });

  it('restores a returning compatible-provider conversation', async () => {
    const checkSiteAccess = vi.fn().mockResolvedValue({
      status: 'ready',
      pageOrigin: 'https://example.com',
    });
    const sendPanelCommand = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      type: 'panel.chat.response',
      requestId: '00000000-0000-4000-8000-000000000010',
      status: 'clarification',
      assistantMessage: 'Which text?',
      previewId: null,
      clarificationQuestion: 'Which text should be larger?',
      clarificationChoices: ['Headlines', 'Article text'],
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
        loadProviderStatus={async () => ({
          configuration: {
            provider: 'compatible',
            config: {
              endpoint: 'https://models.example/v1/responses',
              model: 'model',
              authentication: 'api-key',
              structuredOutput: 'openai-responses-json-schema',
              storeFalse: true,
            },
          },
          credential: { present: true, identifier: 'configured' },
        })}
        checkSiteAccess={checkSiteAccess}
        sendPanelCommand={sendPanelCommand}
      />,
    );
    const user = userEvent.setup();

    expect(await screen.findByText('Site access granted')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make text larger' }));
    const composer = screen.getByLabelText('Describe the change');
    expect(composer).toHaveValue('Make the text larger');
    await user.type(composer, '{enter}');
    expect(
      await screen.findByText('Which text should be larger?'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Headlines' }));
    expect(composer).toHaveValue('Headlines');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByLabelText('Responses endpoint')).toHaveValue(
      'https://models.example/v1/responses',
    );
    expect(screen.getByLabelText('Authentication')).toHaveValue('api-key');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(checkSiteAccess).toHaveBeenCalled();
    expect(sendPanelCommand).toHaveBeenCalledOnce();
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
