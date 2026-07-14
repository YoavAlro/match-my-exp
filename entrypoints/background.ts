import { installRuntimeCoordination } from '@/src/modules/runtime';
import { installProfileRegistrations } from '@/src/modules/permissions';

export default defineBackground(() => {
  installRuntimeCoordination(browser);
  installProfileRegistrations(browser);

  void browser.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });

  void browser.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
});
