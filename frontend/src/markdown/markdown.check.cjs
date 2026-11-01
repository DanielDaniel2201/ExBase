// With wails dev running: node frontend/src/markdown/markdown.check.cjs
const { chromium } = require('../../../.tools/ui-check/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const dismissDialog = dialog => dialog.dismiss();
    page.on('dialog', dismissDialog);
    await page.addInitScript(() => {
      const root = 'D:\\check';
      const files = new Map([
        [root + '\\Welcome.md', '# Welcome\n\nA **Markdown** note.'],
        [root + '\\Drawing.excalidraw', JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })],
      ]);
      const dirs = new Set([root, root + '\\Notes', root + '\\Inbox']);
      const listeners = new Map();
      window.check = { files, dirs, listeners, saves: [], moves: [], failSave: false, delay: 0, closed: 0, openedURLs: [] };
      const base = p => p.split('\\').pop();
      const parent = p => p.slice(0, p.lastIndexOf('\\'));
      const entry = (p, isDir = false) => ({ path: p, name: base(p), isDir });
      const create = (dir, ext) => {
        let p = dir + '\\Untitled' + ext;
        for (let i = 2; files.has(p); i++) p = dir + '\\Untitled ' + i + ext;
        files.set(p, ''); return { path: p, data: '', version: '' };
      };
      const relocate = (p, target) => {
        const isDir = dirs.has(p);
        if (p === target) return entry(target, isDir);
        if (files.has(target) || dirs.has(target)) throw Error('Name already exists');
        for (const old of [...files.keys()]) if (old === p || old.startsWith(p + '\\')) { files.set(target + old.slice(p.length), files.get(old)); files.delete(old); }
        for (const old of [...dirs]) if (old === p || old.startsWith(p + '\\')) { dirs.add(target + old.slice(p.length)); dirs.delete(old); }
        return entry(target, isDir);
      };
      window.go = { main: { App: {
        Workspaces: async () => ({ current: root, folders: [root] }),
        ReadDirectory: async dir => [...dirs].filter(p => p !== root && parent(p) === dir).map(p => entry(p, true)).concat([...files.keys()].filter(p => parent(p) === dir).map(p => entry(p))),
        OpenDocument: async p => { if (!files.has(p)) throw Error('File missing'); return { path: p, data: files.get(p), version: files.get(p) }; },
        CreateMarkdown: async dir => create(dir, '.md'),
        Rename: async (p, name) => {
          const isDir = dirs.has(p), ext = /\.[^.]+$/.exec(p)?.[0];
          if (!isDir && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
          return relocate(p, parent(p) + '\\' + name);
        },
        MoveEntry: async (p, dir) => {
          window.check.moves.push({ p, dir });
          if (dirs.has(p) && (p === dir || dir.startsWith(p + '\\'))) throw Error('Cannot move a folder into itself');
          return relocate(p, dir + '\\' + base(p));
        },
        DeleteEntry: async p => {
          for (const old of [...files.keys()]) if (old === p || old.startsWith(p + '\\')) files.delete(old);
          for (const old of [...dirs]) if (old === p || old.startsWith(p + '\\')) dirs.delete(old);
        },
        Save: async (p, data, version) => {
          window.check.saves.push({ p, data });
          if (window.check.delay) await new Promise(resolve => setTimeout(resolve, window.check.delay));
          if (window.check.failSave) throw Error('Disk is full');
          if (!files.has(p)) throw Error('Save tried to recreate a deleted file');
          if (files.get(p) !== version) throw Error('EXBASE_FILE_CHANGED');
          files.set(p, data);
          return data;
        },
        SetCloseGuard: async enabled => { window.check.guarded = enabled; },
        ConfirmClose: async () => { window.check.closed++; },
        LoadGeneralSettings: async () => ({ aiEnabled: false, slidesEnabled: false, recordingEnabled: false }),
      } } };
      window.runtime = {
        EventsOnMultiple: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name); },
        BrowserOpenURL: url => window.check.openedURLs.push(url),
        WindowMinimise: () => {}, WindowToggleMaximise: () => {},
      };
    });
    await page.goto(process.env.EXBASE_CHECK_URL || 'http://localhost:5173');
    const source = page.getByRole('textbox', { name: 'Markdown document' });
    const open = name => page.getByRole('button', { name, exact: true }).click();
    const menu = async (name, action) => { await page.getByRole('button', { name, exact: true }).click({ button: 'right' }); await page.getByRole('button', { name: action, exact: true }).click(); };
    const paste = async text => {
      await source.click(); await source.press('Control+a');
      await source.evaluate((element, text) => {
        const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      }, text);
    };
    // A new blank document is ready for typing across the right-hand page.
    await page.getByRole('navigation', { name: 'Workspace files' }).click({ button: 'right', position: { x: 100, y: 350 } });
    await page.getByRole('button', { name: 'New Markdown File', exact: true }).click();
    await source.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('.markdown-prose'));
    assert.equal(await source.textContent(), '');
    assert.equal(await page.locator('.tree-name-input').count(), 0, 'creation starts in the document, without a rename step');
    const emptyPage = await page.locator('.markdown-page').boundingBox();
    const emptyEditor = await source.boundingBox();
    assert.ok(emptyEditor.height >= emptyPage.height - 72, 'blank editor fills the page');
    await page.keyboard.insertText('First note');
    await page.waitForFunction(() => window.check.files.get('D:\\check\\Untitled.md') === 'First note');
    await open('Drawing.excalidraw'); await page.locator('.excalidraw').waitFor();
    await open('Untitled.md');
    assert.equal(await source.textContent(), 'First note');
    await source.fill('');
    await page.getByRole('button', { name: 'Untitled.md', exact: true }).focus();
    await source.click({ position: { x: 80, y: 400 } });
    await page.keyboard.insertText('Typed in blank space');
    assert.equal(await source.textContent(), 'Typed in blank space');
    await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/markdown-created.png') });
    await menu('Untitled.md', 'Delete');
    await page.getByRole('button', { name: 'Untitled.md', exact: true }).waitFor({ state: 'detached' });

    await open('Welcome.md');
    await page.getByRole('heading', { name: 'Welcome', exact: true }).waitFor();
    const outline = page.getByRole('navigation', { name: 'Markdown outline' });
    await outline.getByRole('link', { name: 'Welcome', exact: true }).waitFor();
    assert.equal(await source.getAttribute('contenteditable'), 'true');
    assert.equal(await page.locator('.canvas-chat, .markdown-save, .markdown-modes, .markdown-source, .markdown-preview').count(), 0);
    assert.equal(await page.getByRole('button', { name: /Save Markdown|Edit Markdown|Edit and preview|Read Markdown/ }).count(), 0);
    assert.equal(await page.evaluate(() => window.check.files.get('D:\\check\\Welcome.md')), '# Welcome\n\nA **Markdown** note.');
    // External edits survive a pristine reopen, while local edits stop on conflict.
    const pristineWrites = await page.evaluate(() => window.check.saves.length);
    await page.evaluate(() => window.check.files.set('D:\\check\\Welcome.md', '# External note'));
    await open('Welcome.md');
    await page.getByRole('heading', { name: 'External note', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.check.saves.length), pristineWrites);
    await source.fill('Local unsaved edit');
    await page.evaluate(() => window.check.files.set('D:\\check\\Welcome.md', '# External latest'));
    await source.press('Control+s');
    await page.locator('.file-conflict').waitFor();
    await open('Drawing.excalidraw');
    assert.equal(await source.textContent(), 'Local unsaved edit', 'a conflicting switch keeps local edits open');
    assert.equal(await page.evaluate(() => window.check.files.get('D:\\check\\Welcome.md')), '# External latest');
    await page.getByRole('button', { name: 'Reload from disk…' }).click();
    assert.equal(await source.textContent(), 'Local unsaved edit', 'canceling reload preserves local edits');
    page.removeListener('dialog', dismissDialog);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reload from disk…' }).click();
    page.on('dialog', dismissDialog);
    await page.getByRole('heading', { name: 'External latest', exact: true }).waitFor();
    assert.equal(await page.locator('.file-conflict').count(), 0);
    await page.evaluate(() => window.check.files.set('D:\\check\\Welcome.md', '# Welcome\n\nA **Markdown** note.'));
    await open('Welcome.md');
    await page.getByRole('heading', { name: 'Welcome', exact: true }).waitFor();
    const text = '# \u6211\u7684\u7b14\u8bb0\n\n## Markdown basics\n\n**Bold** and *italic* and ~~deleted~~.\n\n- Item\n- [x] Done\n\n1. Ordered\n\n> Quote\n\n```js\nconst a = 1;\n```\n\n| Name | Value |\n| --- | --- |\n| Test | 42 |\n\n[Example](https://example.com)\n\n---';
    await paste(text);
    await page.getByRole('heading', { name: '\u6211\u7684\u7b14\u8bb0', exact: true }).waitFor();
    for (const selector of ['strong', 'em', 's', 'ul', 'ol', 'blockquote', 'pre code', 'table', 'hr', 'input[type=checkbox]:checked']) assert.ok(await source.locator(selector).count(), selector);
    assert.equal(await source.locator('.markdown-task-item').evaluate(element => getComputedStyle(element).display), 'flex');
    // Editing the visible heading and table must update the actual Markdown file.
    await source.locator('h1').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' \u00b7 \u4fee\u6539');
    await outline.getByRole('link', { name: '\u6211\u7684\u7b14\u8bb0 \u00b7 \u4fee\u6539', exact: true }).waitFor();
    await source.locator('td').first().click(); await page.keyboard.press('End'); await page.keyboard.insertText(' \u4e2d\u6587');
    await source.locator('input[type=checkbox]').uncheck();
    await source.press('Control+s');
    await page.waitForFunction(() => window.check.files.get('D:\\check\\Welcome.md').includes('\u6211\u7684\u7b14\u8bb0 \u00b7 \u4fee\u6539'));
    const saved = await page.evaluate(() => window.check.files.get('D:\\check\\Welcome.md'));
    for (const fragment of ['# \u6211\u7684\u7b14\u8bb0 \u00b7 \u4fee\u6539', '**Bold**', '*italic*', '~~deleted~~', '- [ ] Done', '```js', 'Test \u4e2d\u6587', '[Example](https://example.com)']) assert.ok(saved.includes(fragment), fragment + '\n' + saved);
    await page.getByRole('link', { name: 'Example', exact: true }).click({ modifiers: ['Control'] });
    assert.deepEqual(await page.evaluate(() => window.check.openedURLs), ['https://example.com']);
    await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/markdown-wysiwyg.png') });
    const beforeCanvas = await page.evaluate(() => window.check.saves.length);
    await open('Drawing.excalidraw'); await page.locator('.excalidraw').waitFor();
    await page.waitForTimeout(800); // Let the initial 600 ms autosave debounce expire.
    assert.equal(await page.evaluate(() => window.check.saves.length), beforeCanvas, 'canvas initialization must not write');
    await open('Drawing.excalidraw');
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.check.saves.length), beforeCanvas, 'reopening an unchanged canvas must not write');
    await open('Welcome.md');
    await page.getByRole('heading', { name: '\u6211\u7684\u7b14\u8bb0 \u00b7 \u4fee\u6539', exact: true }).waitFor();
    assert.equal(await source.locator('table').count(), 1);
    assert.equal(await source.locator('input[type=checkbox]:checked').count(), 0);

    // The centered outline tracks H1-H3 edits; duplicate titles have distinct anchors.
    const filler = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: body text for scrolling.`).join('\n\n');
    await paste(`# Root\n\n${filler}\n\n## Same\n\n${filler}\n\n### Details\n\n${filler}\n\n#### Not in outline\n\nText\n\n## Same\n\n${filler}`);
    await source.press('Control+s');
    await page.waitForFunction(() => window.check.files.get('D:\\check\\Welcome.md').includes('# Root'));
    assert.equal(await outline.getByRole('link').count(), 4);
    assert.equal(await outline.getByRole('link', { name: 'Not in outline', exact: true }).count(), 0);
    assert.equal(await outline.locator('.level-1').count(), 1);
    assert.equal(await outline.locator('.level-2').count(), 2);
    assert.equal(await outline.locator('.level-3').count(), 1);
    const anchorIDs = await outline.getByRole('link').evaluateAll(links => links.map(link => link.hash.slice(1)));
    assert.equal(new Set(anchorIDs).size, 4);
    const beforeJump = await outline.boundingBox();
    const bodyBox = await page.locator('.markdown-body').boundingBox();
    assert.ok(Math.abs(beforeJump.y + beforeJump.height / 2 - bodyBox.y - bodyBox.height / 2) < 2, 'outline is vertically centered');
    const documentBeforeCollapse = await source.textContent();
    const pageBeforeCollapse = await page.locator('.markdown-page').boundingBox();
    assert.equal(await outline.locator('svg').count(), 0, 'contents control has no icon');
    await outline.getByRole('button', { name: 'Contents', exact: true }).click();
    assert.equal(await outline.getByRole('link').count(), 0, 'collapsed outline hides headings');
    assert.equal(await outline.getByRole('button', { name: 'Contents', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.ok((await page.locator('.markdown-page').boundingBox()).width > pageBeforeCollapse.width + 100, 'collapsing returns space to the document');
    assert.equal(await source.textContent(), documentBeforeCollapse, 'collapsing does not change the document');
    await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/markdown-outline-collapsed.png') });
    await outline.getByRole('button', { name: 'Contents', exact: true }).press('Enter');
    assert.equal(await outline.getByRole('link').count(), 4, 'keyboard expansion restores all headings');
    assert.equal(await outline.getByRole('button', { name: 'Contents', exact: true }).getAttribute('aria-expanded'), 'true');
    assert.ok(Math.abs((await page.locator('.markdown-page').boundingBox()).width - pageBeforeCollapse.width) < 1);
    const writes = await page.evaluate(() => window.check.saves.length);
    for (const index of [1, 2, 3, 0]) {
      await outline.getByRole('link').nth(index).click();
      await page.waitForFunction(id => {
        const heading = document.getElementById(id), scroller = document.querySelector('.markdown-page');
        const offset = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        return Math.abs(offset - 24) < 2 || (id === 'markdown-heading-0' && scroller.scrollTop === 0) || (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 && offset >= 0 && offset < scroller.clientHeight);
      }, anchorIDs[index]);
      await page.waitForFunction(id => document.querySelector(`.markdown-outline-link[href="#${id}"]`)?.getAttribute('aria-current') === 'location', anchorIDs[index]);
      assert.ok(Math.abs((await outline.boundingBox()).y - beforeJump.y) < 1, 'outline stays in place while the document scrolls');
    }
    assert.equal(await page.evaluate(() => window.check.saves.length), writes, 'anchor navigation must not edit or save the document');
    assert.equal(new URL(page.url()).hash, '', 'anchor clicks must not navigate the Wails app');
    await outline.getByRole('link', { name: 'Details', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.markdown-outline-link.level-3').getAttribute('aria-current') === 'location');
    await page.screenshot({ path: path.resolve(__dirname, '../../../.tools/ui-check/markdown-outline.png') });
    await source.locator('h3').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' updated');
    await outline.getByRole('link', { name: 'Details updated', exact: true }).waitFor();
    await paste('Only a paragraph');
    assert.equal(await outline.count(), 0, 'documents without H1-H3 headings do not reserve an outline');

    // Markdown shortcuts render as they are typed, with native undo and composition.
    await paste(''); await source.fill('');
    await source.pressSequentially('# '); await page.keyboard.insertText('Live heading');
    await source.locator('h1').waitFor();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+b'); await page.keyboard.insertText('Strong'); await page.keyboard.press('Control+b');
    assert.equal(await source.locator('strong').textContent(), 'Strong');
    await page.keyboard.insertText(' tail'); await page.keyboard.press('Control+z');
    assert.equal((await source.textContent()).includes(' tail'), false);
    await source.press('Control+End'); await source.press('Enter');
    await source.pressSequentially('- '); await page.keyboard.insertText('List item');
    await source.locator('ul li').waitFor();
    await source.press('Enter'); await source.press('Enter');
    await source.pressSequentially('> '); await page.keyboard.insertText('Quoted');
    await source.locator('blockquote').waitFor();
    await source.press('Control+End');
    await source.dispatchEvent('compositionstart', { data: '' });
    await page.keyboard.insertText('\u4e2d\u6587\u8f93\u5165');
    await source.dispatchEvent('compositionend', { data: '\u4e2d\u6587\u8f93\u5165' });
    assert.ok((await source.textContent()).includes('\u4e2d\u6587\u8f93\u5165'));
    await source.press('Enter');
    await source.pressSequentially('**Typed bold** ');
    assert.ok((await source.locator('strong').allTextContents()).includes('Typed bold'));

    await paste('<script>window.pwned = true</script>\n<img src=x onerror="window.pwned=true">\n<a href="javascript:alert(1)">Unsafe</a><iframe srcdoc="bad"></iframe>');
    assert.equal(await source.locator('script, iframe, [onerror], [href^="javascript:"]').count(), 0);
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    await source.evaluate(element => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/html', '<p>Safe paste<img src=x onerror="window.pwned=true"></p>');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    assert.equal(await source.locator('[onerror]').count(), 0);
    assert.equal(await page.evaluate(() => window.pwned), undefined);

    await source.fill('Latest before switching');
    await open('Drawing.excalidraw'); await page.locator('.excalidraw').waitFor();
    assert.equal(await page.evaluate(() => window.check.files.get('D:\\check\\Welcome.md')), 'Latest before switching');
    await open('Welcome.md');
    await source.fill('Before rename');
    await menu('Welcome.md', 'Rename');
    await page.locator('.tree-name-input').fill('Renamed'); await page.locator('.tree-name-input').press('Enter');
    await page.getByRole('button', { name: 'Renamed.md', exact: true }).waitFor();
    assert.equal(await source.textContent(), 'Before rename');

    await page.evaluate(() => { window.check.delay = 300; });
    await source.fill('Old write');
    await page.waitForFunction(() => window.check.saves.at(-1).data === 'Old write');
    await source.fill('Latest write'); await source.press('Control+s');
    await page.waitForFunction(() => window.check.files.get('D:\\check\\Renamed.md') === 'Latest write');
    await source.fill('Delete during save');
    await page.waitForFunction(() => window.check.saves.at(-1).data === 'Delete during save');
    await menu('Renamed.md', 'Delete');
    await page.getByRole('button', { name: 'Renamed.md', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.check.files.has('D:\\check\\Renamed.md')), false);
    assert.equal(await source.count(), 0);

    await page.evaluate(() => { window.check.delay = 0; });
    await menu('Notes', 'New Markdown File');
    await page.waitForFunction(() => document.activeElement?.matches('.markdown-prose'));
    assert.equal(await source.textContent(), '', 'nested creation opens a blank document');
    await menu('Untitled.md', 'Rename');
    await page.locator('.tree-name-input').fill('\u5b50\u7b14\u8bb0'); await page.locator('.tree-name-input').press('Enter');
    await source.click(); await source.pressSequentially('# '); await page.keyboard.insertText('Nested note');
    await menu('Notes', 'Rename');
    await page.locator('.tree-name-input').fill('Archive'); await page.locator('.tree-name-input').press('Enter');
    await page.getByRole('button', { name: 'Archive', exact: true }).waitFor();
    assert.equal(await source.locator('h1').textContent(), 'Nested note');
    await source.press('Control+s');
    await page.waitForFunction(() => window.check.files.get('D:\\check\\Archive\\\u5b50\u7b14\u8bb0.md').trim() === '# Nested note');

    await page.evaluate(() => { window.check.failSave = true; });
    await source.fill('Keep unsaved content'); await source.press('Control+s');
    await page.getByRole('alert').filter({ hasText: 'Disk is full' }).waitFor();
    await page.evaluate(() => window.check.listeners.get('workspace:close-requested')());
    assert.equal(await page.evaluate(() => window.check.closed), 0);
    assert.equal(await source.textContent(), 'Keep unsaved content');
    await page.evaluate(() => { window.check.failSave = false; });
    await page.evaluate(() => window.check.listeners.get('workspace:close-requested')());
    assert.equal(await page.evaluate(() => window.check.closed), 1);
    assert.equal((await page.evaluate(() => window.check.files.get('D:\\check\\Archive\\\u5b50\u7b14\u8bb0.md'))).trim(), '# Keep unsaved content');
    assert.equal(await page.getByRole('alert').count(), 0);

    // Dragging a file or its parent folder saves edits and retargets subsequent saves.
    const treeRow = p => page.getByRole('button').and(page.getByTitle(p, { exact: true }));
    const root = 'D:\\check';
    const noteName = '\u5b50\u7b14\u8bb0.md';
    await treeRow(root + '\\Archive').click();
    await source.fill('Before file move');
    await treeRow(root + '\\Archive\\' + noteName).dragTo(treeRow(root + '\\Inbox'));
    await page.waitForFunction(p => window.check.files.get(p)?.includes('Before file move'), root + '\\Inbox\\' + noteName);
    await treeRow(root + '\\Inbox\\' + noteName).waitFor();
    assert.equal(await page.evaluate(p => window.check.files.has(p), root + '\\Archive\\' + noteName), false);
    assert.equal(await source.textContent(), 'Before file move');
    await source.fill('Before folder move');
    await treeRow(root + '\\Inbox').dragTo(treeRow(root + '\\Archive'));
    const movedNote = root + '\\Archive\\Inbox\\' + noteName;
    await page.waitForFunction(p => window.check.files.get(p)?.includes('Before folder move'), movedNote);
    assert.equal(await page.evaluate(p => window.check.dirs.has(p), root + '\\Inbox'), false);
    await treeRow(root + '\\Archive\\Inbox').click();
    await treeRow(movedNote).waitFor();
    await source.fill('After folder move'); await source.press('Control+s');
    await page.waitForFunction(p => window.check.files.get(p)?.includes('After folder move'), movedNote);
    await source.press('Home'); await source.press('Delete');
    assert.equal(await page.evaluate(p => window.check.files.has(p), movedNote), true, 'Delete in the editor only edits text');

    // Save errors stop a drag before the filesystem move.
    await page.evaluate(() => { window.check.failSave = true; });
    await source.fill('Unsaved before rejected move');
    await treeRow(movedNote).dragTo(treeRow(root + '\\Archive'));
    await page.getByRole('alert').filter({ hasText: 'Disk is full' }).waitFor();
    assert.equal(await page.evaluate(() => window.check.moves.length), 2);
    assert.equal(await page.evaluate(p => window.check.files.has(p), movedNote), true);
    await page.evaluate(() => { window.check.failSave = false; });
    await source.press('Control+s');
    await page.getByRole('alert').waitFor({ state: 'detached' });

    // Invalid folder drops and name collisions preserve both sides.
    await treeRow(root + '\\Archive').dragTo(treeRow(root + '\\Archive\\Inbox'));
    await page.waitForFunction(() => window.check.moves.length === 3);
    assert.equal(await page.evaluate(p => window.check.files.has(p), movedNote), true);
    await page.evaluate(() => window.check.files.set('D:\\check\\Archive\\Drawing.excalidraw', 'existing drawing'));
    await treeRow(root + '\\Drawing.excalidraw').dragTo(treeRow(root + '\\Archive'));
    await page.waitForFunction(() => window.check.moves.length === 4);
    assert.equal(await page.evaluate(() => window.check.files.get('D:\\check\\Archive\\Drawing.excalidraw')), 'existing drawing');
    assert.equal(await page.evaluate(() => window.check.files.has('D:\\check\\Drawing.excalidraw')), true);

    // A file stays keyboard-selected after opening, including an empty Markdown document.
    await treeRow(movedNote).click();
    await page.waitForFunction(p => document.activeElement?.title === p, movedNote);
    await page.keyboard.press('Delete');
    await treeRow(movedNote).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(p => window.check.files.has(p), movedNote), false);
    assert.equal(await source.count(), 0);
    await menu('Archive', 'New Markdown File');
    await page.waitForFunction(() => document.activeElement?.matches('.markdown-prose'));
    await treeRow(root + '\\Archive\\Untitled.md').click();
    await page.waitForFunction(() => document.activeElement?.title === 'D:\\check\\Archive\\Untitled.md');
    await page.keyboard.press('Delete');
    await treeRow(root + '\\Archive\\Untitled.md').waitFor({ state: 'detached' });

    await treeRow(root + '\\Drawing.excalidraw').click({ button: 'right' });
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    const renameInput = page.locator('.tree-name-input');
    await renameInput.press('Home'); await renameInput.press('Delete');
    assert.equal(await page.evaluate(() => window.check.files.has('D:\\check\\Drawing.excalidraw')), true, 'Delete during rename only edits the name');
    await renameInput.press('Escape');
    await treeRow(root + '\\Drawing.excalidraw').click();
    await page.waitForFunction(() => document.activeElement?.title === 'D:\\check\\Drawing.excalidraw');
    await page.keyboard.press('Delete');
    await treeRow(root + '\\Drawing.excalidraw').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.excalidraw').count(), 0);

    await treeRow(root + '\\Archive').click();
    await page.keyboard.press('Delete'); // The default dialog handler cancels.
    assert.equal(await treeRow(root + '\\Archive').count(), 1);
    page.removeListener('dialog', dismissDialog);
    page.once('dialog', dialog => dialog.accept());
    await page.keyboard.press('Delete');
    await treeRow(root + '\\Archive').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => [...window.check.files.keys()].some(p => p.startsWith('D:\\check\\Archive\\'))), false);

    for (const width of [800, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    }
    assert.deepEqual(errors, []);
    console.log('Markdown and workspace checks passed: editing, CRUD, save safety, Delete keyboard selection, file/folder drag moves, collisions and failed saves.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
