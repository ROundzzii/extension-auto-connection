const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1, // une seule instance de navigateur avec l'extension à la fois
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: require.resolve('./scripts/e2e-setup.js'),
});
