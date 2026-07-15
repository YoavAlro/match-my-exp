import {
  ProfileSchema,
  RuntimeMessageSchema,
  type ProposalOperation,
} from '@/src/modules/contracts';
import {
  DynamicPageCoordinator,
  inspectDocument,
  type PageInspection,
} from '@/src/modules/inspection';
import {
  compileProfileOperations,
  DocumentProfileApplication,
} from '@/src/modules/profiles';
import {
  StylePreviewRegistry,
  type ResolvedStyleOperation,
} from '@/src/modules/transforms';

export default defineContentScript({
  matches: ['https://*/*'],
  registration: 'runtime',
  main(ctx) {
    let inspection: PageInspection | null = null;
    let refreshGeneration = 0;
    const previewStyles = new StylePreviewRegistry();
    const profileApplication = new DocumentProfileApplication(
      new StylePreviewRegistry(),
    );
    const previewOperations = new Map<string, ProposalOperation[]>();

    const clear = () => {
      refreshGeneration += 1;
      inspection = null;
      previewOperations.clear();
      previewStyles.rollbackAll();
      profileApplication.clear();
    };

    const refreshProfile = async () => {
      const generation = ++refreshGeneration;
      const origin = location.origin;
      const path = location.pathname;
      const response = RuntimeMessageSchema.parse(
        await browser.runtime.sendMessage({
          schemaVersion: 1,
          type: 'profile.resolve.request',
          requestId: crypto.randomUUID(),
          expectedOrigin: origin,
          expectedPath: path,
        }),
      );
      if (
        response.type !== 'profile.resolve.response' ||
        generation !== refreshGeneration ||
        location.origin !== origin ||
        location.pathname !== path
      ) {
        return;
      }
      if (response.profile === null) {
        profileApplication.clear();
      } else {
        profileApplication.apply(document, response.profile);
      }
    };

    const onMessage = async (
      raw: unknown,
      sender: Browser.runtime.MessageSender,
    ) => {
      if (sender.id !== browser.runtime.id) {
        return undefined;
      }
      const parsed = RuntimeMessageSchema.safeParse(raw);
      if (!parsed.success) {
        return undefined;
      }
      const message = parsed.data;
      if (message.type === 'page.inspect.request') {
        if (
          message.expectedOrigin !== location.origin ||
          message.expectedPath !== location.pathname
        ) {
          return undefined;
        }
        inspection = inspectDocument(document, {
          origin: location.origin,
          path: location.pathname,
          title: document.title,
        });
        return {
          schemaVersion: 1,
          type: 'page.inspect.response',
          requestId: message.requestId,
          context: inspection.context,
        };
      }
      if (message.type === 'proposal.preview') {
        if (
          inspection === null ||
          message.expectedOrigin !== location.origin ||
          message.expectedPath !== location.pathname
        ) {
          return undefined;
        }
        const operations: ResolvedStyleOperation[] = message.operations.map(
          (operation) => {
            if (operation.kind !== 'style') {
              throw new Error(
                'M1 content bridge accepts style operations only',
              );
            }
            const target = inspection?.resolve(operation.target.elementId);
            if (target === null || target === undefined) {
              throw new Error('Preview target is stale');
            }
            return {
              operation,
              resolvedElementId: operation.target.elementId,
              target,
            };
          },
        );
        previewOperations.clear();
        previewStyles.rollbackAll();
        previewStyles.apply(message.previewId, operations);
        previewOperations.set(message.previewId, message.operations);
        return { status: 'previewed' };
      }
      if (message.type === 'preview.rollback') {
        previewOperations.delete(message.previewId);
        previewStyles.rollback(message.previewId);
        return { status: 'rolled-back' };
      }
      if (message.type === 'profile.compile.request') {
        if (
          inspection === null ||
          message.expectedOrigin !== location.origin ||
          message.expectedPath !== location.pathname
        ) {
          return undefined;
        }
        const operations = previewOperations.get(message.previewId);
        if (operations === undefined) {
          return undefined;
        }
        return RuntimeMessageSchema.parse({
          schemaVersion: 1,
          type: 'profile.compile.response',
          requestId: message.requestId,
          previewId: message.previewId,
          operations: compileProfileOperations(operations, inspection),
        });
      }
      if (message.type === 'profile.apply') {
        if (
          message.expectedOrigin !== location.origin ||
          message.expectedPath !== location.pathname
        ) {
          return undefined;
        }
        profileApplication.apply(
          document,
          ProfileSchema.parse({
            schemaVersion: 1,
            id: message.profileId,
            name: 'Applied profile',
            enabled: true,
            origin: message.expectedOrigin,
            pathPattern: message.expectedPath,
            intentSummary: 'Applied saved website adaptation.',
            conversationId: message.profileId,
            operations: message.operations,
            revision: message.revision,
            health: { state: 'healthy' },
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: '1970-01-01T00:00:00.000Z',
          }),
        );
        previewOperations.clear();
        previewStyles.rollbackAll();
        return RuntimeMessageSchema.parse({
          schemaVersion: 1,
          type: 'profile.apply.response',
          requestId: message.requestId,
          profileId: message.profileId,
          revision: message.revision,
        });
      }
      if (message.type === 'profile.clear') {
        if (message.expectedOrigin === location.origin) {
          clear();
        }
        return { status: 'cleared' };
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);

    const dynamic = new DynamicPageCoordinator({
      document,
      onSettled: () => refreshProfile(),
    });
    dynamic.start();

    ctx.addEventListener(window, 'wxt:locationchange', (event) => {
      clear();
      dynamic.navigate(event.newUrl.pathname);
      void refreshProfile();
    });
    ctx.addEventListener(globalThis, 'pagehide', clear);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage);
      dynamic.stop();
      clear();
    });

    document.dispatchEvent(new CustomEvent('match-my-exp:content-ready'));
    void refreshProfile();
  },
});
