'use strict';

// End-to-end checks of the interface in a real (headless) browser,
// on a desktop and a phone-sized screen.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('./helpers');

describe('interface', () => {
  let s; let browser;
  before(async () => {
    s = await startServer({ seed: true });
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
    await s?.close();
  });

  async function open(viewport = { width: 1280, height: 900 }) {
    const page = await browser.newPage({ viewport, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));
    await page.goto(s.base);
    await page.waitForSelector('.entity');
    return { page, errors };
  }

  test('shows the full tree with Arabic and English', async () => {
    const { page, errors } = await open();
    assert.equal(await page.locator('.entity').count(), 4);
    await page.getByText('خالد الراشد').waitFor();
    await page.getByText('Layla Haddad').first().waitFor();
    assert.equal(await page.locator('.dup').count(), 2, 'duplicate-email badges');
    assert.equal(await page.locator('#test-banner').isVisible(), true);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('add entity, department and focal point, with duplicate email warning', async () => {
    const { page } = await open();
    await page.click('#add-entity');
    await page.fill('#f-name', 'UI Test Entity');
    await page.click('#form-submit');
    const entity = page.locator('.entity', { hasText: 'UI Test Entity' });
    await entity.waitFor();

    await entity.getByRole('button', { name: '+ Department' }).click();
    await page.fill('#f-name', 'UI Dept');
    await page.click('#form-submit');
    const dept = entity.locator('.department', { hasText: 'UI Dept' });
    await dept.waitFor();

    await dept.getByRole('button', { name: '+ Focal point' }).click();
    await page.fill('#f-name', 'UI Person');
    await page.fill('#f-title', 'Tester');
    await page.fill('#f-email', 'not-an-email');
    await page.click('#form-submit');
    await page.locator('#form-error', { hasText: 'Email format' }).waitFor();
    await page.fill('#f-email', 'omar.fadel@northwind.example.com');
    await page.locator('#form-warning', { hasText: 'already used' }).waitFor();
    await page.fill('#f-remarks', 'First line\nسطر ثاني');
    await page.click('#form-submit');
    await page.locator('.toast.warn', { hasText: 'also used by' }).waitFor();
    await dept.locator('.fp', { hasText: 'UI Person' }).waitFor();
    assert.equal(await dept.locator('.fp-remarks').innerText(), 'First line\nسطر ثاني');
    await page.close();
  });

  test('deleting a department with focal points warns and lists them; cancel keeps it', async () => {
    const { page } = await open();
    const dept = page.locator('.department', { hasText: 'Digital Services' });
    await dept.locator('.row-head').getByRole('button', { name: 'Delete' }).click();
    const dialog = page.locator('#confirm-dialog');
    await dialog.locator('.warning', { hasText: '2 focal points' }).waitFor();
    assert.match(await dialog.innerText(), /Omar Fadel/);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.locator('.department', { hasText: 'Digital Services' }).count(), 1);

    await dept.locator('.row-head').getByRole('button', { name: 'Delete' }).click();
    await page.click('#confirm-ok');
    await page.locator('.department', { hasText: 'Digital Services' }).waitFor({ state: 'detached' });
    await page.close();
  });

  test('deleting an entity warns with departments and focal points', async () => {
    const { page } = await open();
    const entity = page.locator('.entity', { hasText: 'Contoso Education Council' });
    await entity.locator('> .row-head').getByRole('button', { name: 'Delete' }).click();
    const text = await page.locator('#confirm-dialog .warning').innerText();
    assert.match(text, /2 departments and 4 focal points/);
    assert.match(text, /Priya Raman/);
    await page.click('#confirm-ok');
    await entity.waitFor({ state: 'detached' });
    await page.close();
  });

  test('search filters and highlights', async () => {
    const { page } = await open();
    await page.fill('#search', 'العمليات');
    await page.locator('#summary', { hasText: 'matching' }).waitFor();
    assert.equal(await page.locator('.entity').count(), 1);
    assert.equal(await page.locator('mark').first().innerText(), 'العمليات');
    await page.close();
  });

  test('export downloads an Excel file', async () => {
    const { page } = await open();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-all')]);
    assert.match(download.suggestedFilename(), /^users-directory-.*\.xlsx$/);
    await page.close();
  });

  test('works on a phone screen without horizontal scrolling', async () => {
    const { page } = await open({ width: 375, height: 740 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    await page.click('.menu summary');
    await page.locator('#export-all-menu').waitFor({ state: 'visible' });
    await page.close();
  });
});
