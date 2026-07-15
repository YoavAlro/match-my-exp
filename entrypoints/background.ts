import {
  ActiveTabCoordinator,
  installPanelChatBridge,
  installProfileBridge,
  installRuntimeCoordination,
} from '@/src/modules/runtime';
import { installProfileRegistrations } from '@/src/modules/permissions';

export default defineBackground(() => {
  const coordinator = new ActiveTabCoordinator(
    browser.runtime.id,
    browser.runtime.getURL('/'),
  );
  installPanelChatBridge(browser, coordinator);
  installProfileBridge(browser);
  installRuntimeCoordination(browser, coordinator);
  installProfileRegistrations(browser);

  void browser.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });

  void browser.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
});
