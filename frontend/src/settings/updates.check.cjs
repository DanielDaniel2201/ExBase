// With Vite running: EXBASE_CHECK_URL=http://localhost:5173 node frontend/src/settings/updates.check.cjs
const { chromium } = require('../../../.tools/ui-check/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const installed of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.addInitScript(({ installed }) => {
        window.check = { checks: 0, installs: 0, saves: 0, closes: 0, failCheck: false, failSave: false, available: true, listeners: new Map() };
        const doc = { path: 'D:\\check\\Notes.md', data: '# Fixture' };
        window.go = { main: { App: {
          GetUpdateInfo: async () => ({ version: installed ? '0.1.1' : 'dev', installed }),
          CheckForUpdates: async () => { window.check.checks++; if (window.check.failCheck) throw Error('Network unavailable'); return { available: window.check.available, version: '0.1.2' }; },
          InstallUpdate: async () => { window.check.installs++; await window.check.listeners.get('workspace:close-requested')(); },
          SetCloseGuard: async () => {}, ConfirmClose: async () => { window.check.closes++; },
          Workspaces: async () => ({ current: 'D:\\check', folders: ['D:\\check'] }),
          ReadDirectory: async () => [{ path: doc.path, name: 'Notes.md', isDir: false }], OpenDocument: async () => doc,
          Save: async () => { window.check.saves++; if (window.check.failSave) throw Error('Disk full'); },
          LoadGeneralSettings: async () => ({ slidesEnabled: false, recordingEnabled: false, aiEnabled: false }), LoadPromptTemplates: async () => [],
        } } };
        window.runtime = {
          EventsOnMultiple: (name, callback) => { window.check.listeners.set(name, callback); return () => window.check.listeners.delete(name); },
          WindowMinimise: () => {}, WindowToggleMaximise: () => {},
        };
      }, { installed });
      await page.goto(process.env.EXBASE_CHECK_URL || 'http://localhost:5173');
      await page.getByRole('button', { name: 'Notes.md', exact: true }).click();
      await page.locator('.tiptap').waitFor();
      await page.getByRole('button', { name: installed ? 'View update' : 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Updates', exact: true }).waitFor();
      if (!installed) {
        assert.equal(await page.evaluate(() => window.check.checks), 0);
        assert.equal(await page.getByRole('button', { name: 'Check for updates' }).count(), 0);
        await page.getByText('ExBase dev · Development / portable').waitFor();
      } else {
        await page.evaluate(() => { window.check.failCheck = true; });
        await page.getByRole('button', { name: 'Check for updates' }).click();
        await page.getByRole('alert').filter({ hasText: 'Network unavailable' }).waitFor();
        await page.evaluate(() => { window.check.failCheck = false; window.check.available = false; });
        await page.getByRole('button', { name: 'Check for updates' }).click();
        await page.getByText("You're up to date.").waitFor();
        await page.evaluate(() => { window.check.available = true; });
        await page.getByRole('button', { name: 'Check for updates' }).click();
        await page.getByRole('button', { name: 'Update and restart' }).waitFor();
        await page.getByRole('button', { name: 'Close settings', exact: true }).click();
        await page.locator('.tiptap').fill('Unsaved update fixture');
        await page.evaluate(() => { window.check.failSave = true; });
        await page.getByRole('button', { name: 'View update', exact: true }).click();
        await page.getByRole('button', { name: 'Update and restart' }).click();
        await page.waitForFunction(() => window.check.installs === 1 && window.check.saves > 0);
        assert.equal(await page.evaluate(() => window.check.closes), 0, 'failed save must prevent update launch');
        await page.evaluate(() => { window.check.failSave = false; });
        await page.getByRole('button', { name: 'Update and restart' }).click();
        await page.waitForFunction(() => window.check.closes === 1);
        await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/updates.png') });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: development isolation, startup notification, manual check/retry, update save failure and successful close');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
