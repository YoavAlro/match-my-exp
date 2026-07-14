import { installRuntimeCoordination } from '@/src/modules/runtime';

export default defineBackground(() => {
  installRuntimeCoordination(browser);

  void browser.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });

  void browser.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
});
