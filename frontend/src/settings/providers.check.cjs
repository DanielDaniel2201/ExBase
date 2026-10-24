// With wails dev running: node frontend/src/settings/providers.check.cjs
const { chromium } = require('../../../.tools/ui-check/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const initial = { providers: [{ id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'fixture-official' }], activeProviderID: 'deepseek' };
      const current = () => JSON.parse(localStorage.getItem('check-providers') || JSON.stringify(initial));
      const settings = () => { const s = current(); const active = s.providers.find(p => p.id === s.activeProviderID); return { ...s, apiKey: active.apiKey, hasAPIKey: !!active.apiKey }; };
      const doc = { path: 'D:\\check\\Canvas.excalidraw', data: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }) };
      window.check = { fail: false, delay: false, calls: [], saves: 0 };
      window.go = { main: { App: {
        SetCloseGuard: async () => {}, ConfirmClose: async () => {}, Workspaces: async () => ({ current: 'D:\\check', folders: ['D:\\check'] }), ReadDirectory: async () => [{ path: doc.path, name: 'Canvas.excalidraw', isDir: false }], OpenDocument: async () => doc,
        LoadGeneralSettings: async () => ({ slidesEnabled: false, recordingEnabled: false }), Save: async () => {}, LoadPromptTemplates: async () => [],
        LoadAISettings: async () => settings(),
        SaveAIProviders: async (providers, activeProviderID) => {
          if (window.check.delay) await new Promise(resolve => { window.check.finishSave = resolve; });
          if (window.check.fail) { window.check.fail = false; throw Error('Cannot save providers'); }
          window.check.saves++;
          localStorage.setItem('check-providers', JSON.stringify({ providers: providers.map(p => ({ ...p, name: p.name.trim(), baseURL: p.baseURL.trim().replace(/\/+$/, ''), model: p.model.trim(), apiKey: p.apiKey.trim() })), activeProviderID }));
          return settings();
        },
        CreateAISession: async () => 'fixture-session', CancelAI: async () => {},
        AskAI: async (...args) => { window.check.calls.push({ provider: settings().activeProviderID, effort: args[8] }); return { reply: 'Done', checkpointId: 'fixture-checkpoint', elements: [] }; },
      } } };
      window.runtime = new Proxy({}, { get: () => () => {} });
    });
    const openSettings = async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'AI', exact: true }).click();
      await page.getByRole('combobox', { name: 'Active provider' }).waitFor();
    };
    const editor = () => page.getByRole('dialog', { name: /^(Edit|New) Provider$/ });
    const active = () => page.getByRole('combobox', { name: 'Active provider' });
    const activeName = () => active().locator('span').innerText();
    const selectProvider = async name => {
      await active().click();
      await page.getByRole('option', { name: name === 'DeepSeek' ? 'DeepSeek Official' : name, exact: true }).click();
    };
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('check-providers')));
    await page.goto(process.env.EXBASE_CHECK_URL || 'http://localhost:5173');
    await openSettings();
    assert.equal(await page.getByText('Only DeepSeek V4.1 Flash is supported.', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Edit provider', exact: true }).click();
    for (const field of ['Provider name', 'Base URL', 'Model ID']) assert.equal(await editor().getByLabel(field, { exact: true }).getAttribute('readonly'), '');
    assert.equal(await editor().getByRole('button', { name: 'Delete provider' }).count(), 0);
    assert.equal(await editor().getByText('Only DeepSeek V4.1 Flash is supported.', { exact: true }).count(), 0);
    assert.equal(await editor().getByLabel('API Key', { exact: true }).getAttribute('type'), 'password');
    await editor().getByRole('button', { name: 'Show API Key' }).click();
    assert.equal(await editor().getByLabel('API Key', { exact: true }).getAttribute('type'), 'text');
    await editor().getByLabel('API Key', { exact: true }).fill('official-replacement');
    await editor().getByRole('button', { name: 'Save changes', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    assert.equal((await saved()).providers[0].apiKey, 'official-replacement');

    for (const action of ['Cancel', 'Close provider editor', 'Escape', 'backdrop']) {
      await page.getByRole('button', { name: 'Edit provider', exact: true }).click();
      await editor().getByLabel('API Key', { exact: true }).fill('discarded');
      if (action === 'Escape') await page.keyboard.press('Escape');
      else if (action === 'backdrop') await page.mouse.click(10, 10);
      else await editor().getByRole('button', { name: action, exact: true }).click();
      await editor().waitFor({ state: 'hidden' });
      assert.equal((await saved()).providers[0].apiKey, 'official-replacement');
      assert.ok(await page.getByRole('dialog', { name: 'Settings', exact: true }).isVisible());
    }
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    assert.ok(await editor().getByText('Only DeepSeek V4.1 Flash is supported.', { exact: true }).isVisible());
    await editor().getByLabel('Provider name', { exact: true }).fill('Cancelled');
    await editor().getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await saved()).providers.length, 1);
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    await editor().getByLabel('Provider name', { exact: true }).fill('My provider');
    await editor().getByLabel('Base URL', { exact: true }).fill('https://provider.example/v1/');
    await editor().getByLabel('Model ID', { exact: true }).fill('provider/deepseek-v4.1-flash');
    await editor().getByLabel('API Key', { exact: true }).fill('fixture-custom');
    await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/provider-editor.png') });
    await page.evaluate(() => { window.check.fail = true; });
    await editor().getByRole('button', { name: 'Create provider', exact: true }).click();
    await editor().getByRole('alert').filter({ hasText: 'Cannot save' }).waitFor();
    assert.equal((await saved()).providers.length, 1);
    assert.equal(await editor().getByLabel('API Key', { exact: true }).inputValue(), 'fixture-custom');
    await page.evaluate(() => { window.check.delay = true; });
    await editor().getByRole('button', { name: 'Create provider', exact: true }).click();
    await page.waitForFunction(() => !!window.check.finishSave);
    assert.ok(await editor().getByRole('button', { name: 'Cancel', exact: true }).isDisabled());
    await page.keyboard.press('Escape');
    assert.ok(await editor().isVisible());
    await page.evaluate(() => { window.check.delay = false; window.check.finishSave(); });
    await editor().waitFor({ state: 'hidden' });
    const customID = (await saved()).activeProviderID;
    assert.notEqual(customID, 'deepseek');
    assert.equal((await saved()).providers[1].baseURL, 'https://provider.example/v1');
    assert.equal(await activeName(), 'My provider');
    await active().click();
    await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/providers-settings.png') });
    await active().press('Escape');
    assert.equal(await page.getByRole('listbox', { name: 'Providers' }).count(), 0);
    assert.ok(await page.getByRole('dialog', { name: 'Settings', exact: true }).isVisible());
    await active().press('ArrowDown');
    await active().press('Home');
    await active().press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('check-providers')).activeProviderID === 'deepseek');
    await active().press('ArrowUp');
    await active().press('End');
    await active().press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('check-providers')).activeProviderID !== 'deepseek');
    await active().click();
    await page.getByRole('heading', { name: 'Model Provider' }).click();
    assert.equal(await page.getByRole('listbox', { name: 'Providers' }).count(), 0);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.reload();
    await openSettings();
    assert.equal(await activeName(), 'My provider');
    await page.evaluate(() => { window.check.fail = true; });
    await selectProvider('DeepSeek');
    await page.getByRole('alert').filter({ hasText: 'Cannot save' }).waitFor();
    assert.equal((await saved()).activeProviderID, customID);
    assert.equal(await activeName(), 'My provider');
    await selectProvider('DeepSeek');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('check-providers')).activeProviderID === 'deepseek');
    await selectProvider('My provider');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('check-providers')).activeProviderID !== 'deepseek');
    await page.getByRole('button', { name: 'Edit provider', exact: true }).click();
    assert.equal(await editor().getByText('Only DeepSeek V4.1 Flash is supported.', { exact: true }).count(), 0);
    await editor().getByLabel('Provider name', { exact: true }).fill('Renamed');
    await editor().getByRole('button', { name: 'Save changes', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    assert.equal((await saved()).providers[1].name, 'Renamed');

    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Canvas.excalidraw', exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'Message DeepSeek' });
    await composer.fill('Fast check');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.waitForFunction(() => window.check.calls.length === 1);
    await composer.fill('Stable check');
    await page.getByRole('button', { name: 'AI mode: fast' }).click();
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.waitForFunction(() => window.check.calls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.check.calls), [{ provider: customID, effort: 'none' }, { provider: customID, effort: 'high' }]);

    await openSettings();
    await page.getByRole('button', { name: 'Edit provider', exact: true }).click();
    await page.evaluate(() => { window.check.fail = true; });
    await editor().getByRole('button', { name: 'Delete provider', exact: true }).click();
    await editor().getByRole('alert').filter({ hasText: 'Cannot save' }).waitFor();
    assert.equal((await saved()).providers.length, 2);
    await editor().getByRole('button', { name: 'Delete provider', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    assert.equal(await activeName(), 'DeepSeek');
    assert.equal((await saved()).providers.length, 1);
    assert.equal((await saved()).providers[0].apiKey, 'official-replacement');
    await page.reload();
    await openSettings();
    await active().click();
    assert.equal(await page.getByRole('option').count(), 1);
    assert.deepEqual(errors, []);
    console.log('PASS: provider CRUD, preset protection, credential isolation, cancellation, persistence, save/switch/delete failure recovery, saving lock, custom dropdown mouse/keyboard/outside/Escape interactions, add-only model hint, and unchanged Fast/Stable modes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
