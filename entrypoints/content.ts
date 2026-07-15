import { RuntimeMessageSchema } from '@/src/modules/contracts';
import { inspectDocument, type PageInspection } from '@/src/modules/inspection';
import {
  StylePreviewRegistry,
  type ResolvedStyleOperation,
} from '@/src/modules/transforms';

export default defineContentScript({
  matches: ['https://*/*'],
  registration: 'runtime',
  main() {
    const state = globalThis as typeof globalThis & Record<string, unknown>;
    if (state.__matchMyExpContentStarted === true) {
      return;
    }
    state.__matchMyExpContentStarted = true;
    let inspection: PageInspection | null = null;
    const styles = new StylePreviewRegistry();

    browser.runtime.onMessage.addListener(async (raw, sender) => {
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
        styles.apply(message.previewId, operations);
        return { status: 'previewed' };
      }
      if (message.type === 'preview.rollback') {
        styles.rollback(message.previewId);
        return { status: 'rolled-back' };
      }
      return undefined;
    });

    globalThis.addEventListener('pagehide', () => {
      styles.rollbackAll();
      inspection = null;
    });
    document.dispatchEvent(new CustomEvent('match-my-exp:content-ready'));
  },
});
