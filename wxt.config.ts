import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Match My Exp',
    description: 'Adapt website experiences to match your personal needs.',
    minimum_chrome_version: '133',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'storage'],
    optional_host_permissions: ['https://*/*'],
    action: {
      default_title: 'Open Match My Exp',
    },
  },
});
