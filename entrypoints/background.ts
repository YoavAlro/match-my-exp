export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });

  void browser.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
});
