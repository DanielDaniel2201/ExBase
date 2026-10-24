// Run with wails dev active: node frontend/src/settings/ai-enabled.check.cjs
const { chromium } = require('../../../.tools/ui-check/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const general = () => JSON.parse(localStorage.getItem('check-general') || '{"aiEnabled":true,"recordingEnabled":true}');
      const doc = { path: 'D:\\check\\Canvas.excalidraw', data: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }) };
      window.check = { cancels: 0, calls: 0, fail: false };
      window.go = { main: { App: {
        SetCloseGuard: async () => {}, ConfirmClose: async () => {}, Workspaces: async () => ({ current: 'D:\\check', folders: ['D:\\check'] }),
        ReadDirectory: async () => [{ path: doc.path, name: 'Canvas.excalidraw', isDir: false }], OpenDocument: async () => doc, Save: async () => {},
        LoadGeneralSettings: async () => general(),
        SaveGeneralSettings: async value => { if (window.check.fail) { window.check.fail = false; throw Error('Cannot save settings'); } localStorage.setItem('check-general', JSON.stringify(value)); },
        LoadPromptTemplates: async () => [],
        LoadAISettings: async () => ({ providers: [{ id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'fixture' }], activeProviderID: 'deepseek', hasAPIKey: true }),
        CreateAISession: async () => 'fixture-session',
        AskAI: async () => { window.check.calls++; return new Promise((resolve, reject) => { window.check.reject = reject; }); },
        CancelAI: async () => { window.check.cancels++; window.check.reject?.(Error('Request cancelled')); },
      } } };
      window.runtime = new Proxy({}, { get: () => () => {} });
    });
    const open = async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'AI', exact: true }).click();
    };
    const toggle = () => page.getByRole('switch', { name: 'Enable AI features' });
    const close = () => page.getByRole('button', { name: 'Close settings' }).click();
    const input = () => page.getByRole('textbox', { name: 'Message DeepSeek' });
    await page.goto(process.env.EXBASE_CHECK_URL || 'http://localhost:5173');
    await page.getByRole('button', { name: 'Canvas.excalidraw' }).click();
    await input().waitFor();
    await open();
    assert.ok(await toggle().isChecked());
    await page.evaluate(() => { window.check.fail = true; });
    await toggle().click();
    await page.getByRole('alert').filter({ hasText: 'Cannot save settings' }).waitFor();
    assert.ok(await toggle().isChecked(), 'failed save keeps AI enabled');
    await toggle().uncheck();
    await page.getByRole('combobox', { name: 'Active provider' }).waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/ai-disabled-settings.png') });
    await close();
    assert.equal(await input().count(), 0);
    assert.equal(await page.getByRole('button', { name: 'New chat' }).count(), 0);
    await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Narrated replay' }).count(), 0);
    assert.ok(await page.getByRole('menuitem', { name: 'Screen recording', exact: true }).isVisible());
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Canvas.excalidraw' }).click();
    await page.getByRole('button', { name: 'Add-ons', exact: true }).waitFor();
    assert.equal(await input().count(), 0, 'disabled state survives reload');
    await open();
    assert.equal(await toggle().isChecked(), false);
    await toggle().check();
    await page.getByRole('combobox', { name: 'Active provider' }).waitFor();
    await close();
    await input().fill('Draw a box');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.waitForFunction(() => window.check.calls === 1);
    await open();
    await toggle().uncheck();
    await page.waitForFunction(() => window.check.cancels === 1);
    await close();
    assert.equal(await input().count(), 0);
    await open();
    await toggle().check();
    await close();
    assert.ok(await input().isEnabled(), 'AI usable again after cancellation');
    assert.deepEqual(errors, []);
    console.log('AI toggle: save failure, persistence, hidden entries, recording access, cancellation and re-enable passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
