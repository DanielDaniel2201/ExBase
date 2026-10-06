// With wails dev running: node frontend/src/settings/templates.check.cjs
const { chromium } = require('../../../.tools/ui-check/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.check = { saves: 0, fail: false };
      const initial = [{ name: 'PPT', body: 'Draw {{topic}}' }, { name: 'SRT · 叙述回放', body: 'SRT 文件：{{SRT 文件路径}}' }];
      const doc = { path: 'D:\\check\\Canvas.excalidraw', data: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }) };
      window.go = { main: { App: {
        Workspaces: async () => ({ current: 'D:\\check', folders: ['D:\\check'] }),
        ReadDirectory: async () => [{ path: doc.path, name: 'Canvas.excalidraw', isDir: false }], OpenDocument: async () => doc,
        LoadGeneralSettings: async () => ({ slidesEnabled: false, recordingEnabled: false }), Save: async () => {},
        LoadAISettings: async () => ({ hasAPIKey: true, apiKey: 'fixture' }),
        LoadPromptTemplates: async () => JSON.parse(localStorage.getItem('check-templates') || JSON.stringify(initial)),
        SavePromptTemplates: async templates => {
          if (window.check.fail) { window.check.fail = false; throw Error('Cannot save templates'); }
          const names = templates.map(t => t.name.trim().toLowerCase());
          if (new Set(names).size !== names.length) throw Error('template names must be unique');
          if (templates.some(t => !t.body.trim())) throw Error('template content must contain 1–16000 characters');
          window.check.saves++;
          localStorage.setItem('check-templates', JSON.stringify(templates));
        },
        SaveAISettings: async () => { throw Error('Unexpected API key save'); },
      } } };
      window.runtime = new Proxy({}, { get: () => () => {} });
    });
    const openSettings = async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'AI', exact: true }).click();
      await page.getByRole('button', { name: '+ Add', exact: true }).waitFor({ state: 'visible' });
    };
    const editor = () => page.getByRole('dialog', { name: /^(Edit|New) Template$/ });
    const openTemplate = name => page.locator('.template-list').getByRole('button', { name, exact: true }).click();
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('check-templates')));
    await page.goto(process.env.EXBASE_CHECK_URL || 'http://localhost:5173');
    await openSettings();
    await openTemplate('SRT · 叙述回放');
    await editor().getByLabel('Name', { exact: true }).fill('My replay');
    await editor().getByLabel('Content', { exact: true }).fill('Edited {{topic}}');
    await editor().getByRole('button', { name: 'Save changes', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    assert.deepEqual(await saved(), [{ name: 'PPT', body: 'Draw {{topic}}' }, { name: 'My replay', body: 'Edited {{topic}}' }]);
    assert.equal(await page.locator('.template-row').count(), 2);

    for (const action of ['Cancel', 'Close template editor', 'Escape', 'backdrop']) {
      await openTemplate('My replay');
      await editor().getByLabel('Name', { exact: true }).fill('Discarded');
      if (action === 'Escape') await page.keyboard.press('Escape');
      else if (action === 'backdrop') await page.mouse.click(10, 10);
      else await editor().getByRole('button', { name: action, exact: true }).click();
      await editor().waitFor({ state: 'hidden' });
      assert.equal((await saved())[1].name, 'My replay');
      assert.equal(await page.getByRole('dialog', { name: 'Settings', exact: true }).count(), 1);
    }
    await page.getByRole('button', { name: '+ Add', exact: true }).click();
    await editor().getByLabel('Name', { exact: true }).fill('Cancelled new');
    await editor().getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await saved()).length, 2);

    await openTemplate('My replay');
    await editor().getByLabel('Name', { exact: true }).fill('PPT');
    await editor().getByRole('button', { name: 'Save changes', exact: true }).click();
    await editor().getByRole('alert').filter({ hasText: 'unique' }).waitFor();
    assert.equal((await saved())[1].name, 'My replay');
    await editor().getByLabel('Name', { exact: true }).fill('My replay');
    await editor().getByLabel('Content', { exact: true }).fill('Retained draft');
    await page.evaluate(() => { window.check.fail = true; });
    await editor().getByRole('button', { name: 'Save changes', exact: true }).click();
    await editor().getByRole('alert').filter({ hasText: 'Cannot save' }).waitFor();
    assert.equal(await editor().getByLabel('Content', { exact: true }).inputValue(), 'Retained draft');
    assert.equal((await saved())[1].body, 'Edited {{topic}}');
    await editor().getByRole('button', { name: 'Save changes', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '+ Add', exact: true }).click();
    await editor().getByLabel('Name', { exact: true }).fill('Demo');
    await editor().getByLabel('Content', { exact: true }).fill('Demo content');
    await editor().getByRole('button', { name: 'Create template', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    await openTemplate('Demo');
    await editor().getByRole('button', { name: 'Delete template', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/templates-fixed-list.png') });
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Canvas.excalidraw', exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'Message DeepSeek' });
    await composer.fill('/');
    await page.getByRole('option', { name: 'My replay', exact: true }).waitFor();
    assert.equal(await page.getByRole('option').count(), 2);
    await composer.press('Escape');
    await openSettings();
    // A blank, unsaved API key must not prevent template deletion.
    await page.getByLabel('DeepSeek API Key', { exact: true }).fill('');
    await openTemplate('My replay');
    await editor().getByRole('button', { name: 'Delete template', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    assert.deepEqual(await saved(), [{ name: 'PPT', body: 'Draw {{topic}}' }]);
    await page.getByLabel('DeepSeek API Key', { exact: true }).fill('fixture');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await composer.fill('/');
    await page.getByRole('option', { name: 'PPT', exact: true }).waitFor();
    assert.equal(await page.getByRole('option').count(), 1);
    await composer.press('Escape');
    await openSettings();
    await openTemplate('PPT');
    await page.evaluate(() => { window.check.fail = true; });
    await editor().getByRole('button', { name: 'Delete template', exact: true }).click();
    await editor().getByRole('alert').filter({ hasText: 'Cannot save' }).waitFor();
    assert.equal((await saved()).length, 1);
    await editor().getByRole('button', { name: 'Delete template', exact: true }).click();
    await editor().waitFor({ state: 'hidden' });
    await page.reload();
    await openSettings();
    assert.equal(await page.locator('.template-row').count(), 0);
    assert.deepEqual(await saved(), []);
    assert.deepEqual(errors, []);
    console.log('PASS: rename/content update, create, delete, all cancel paths, save/delete failure recovery, API-key independence, chat refresh and reload without restored presets');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
