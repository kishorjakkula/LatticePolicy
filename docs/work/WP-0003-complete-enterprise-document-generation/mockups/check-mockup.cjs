const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, expect } = require('@playwright/test');

// Exercise local prototype states, not production authorization or rendering.
async function main() {
  const browser = await chromium.launch({
    channel: process.env.MOCKUP_BROWSER_CHANNEL || 'chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('pageerror', error => console.error('Prototype runtime error:', error.message));
    await page.goto(pathToFileURL(join(__dirname, 'document-generation.html')).href);
    const frame = page;
    const screen = name => frame.getByRole('tab', { name, exact: true });
    const button = name => frame.getByRole('button', { name, exact: true });
    const dialogButton = name => frame.getByRole('dialog').getByRole('button', { name, exact: true });

    await expect(frame.getByRole('heading', { name: 'Forms catalog', exact: true })).toBeVisible();
    await button('Policies').click();
    await button('TX-0001842-04').click();
    await expect(frame.getByRole('heading', { name: 'Issue · TX-0001842-04', exact: true })).toBeVisible();
    await expect(frame.getByRole('heading', { name: 'Forms & Documents', exact: true })).toBeVisible();
    await expect(screen('Documents')).toHaveAttribute('aria-selected', 'true');
    await expect(button('Homeowners policy packet')).toBeVisible();
    await expect(button('Coverage endorsement')).toHaveCount(0);
    await expect(button('Generate documents')).toBeDisabled();
    await screen('Forms').click();
    await expect(frame.locator('#lp-wizard-content')).toContainText('HO-DEC');
    await screen('Documents').click();
    await button('Back to policy').click();
    await expect(frame.getByRole('tab', { name: 'Documents', exact: true })).toHaveCount(0);
    await button('TX-0001842-05').click();
    await expect(frame.getByRole('heading', { name: 'Endorsement · TX-0001842-05', exact: true })).toBeVisible();
    await expect(button('Homeowners policy packet')).toHaveCount(0);
    await expect(button('Coverage endorsement')).toBeVisible();
    await button('Generate documents').click();
    await expect(frame.getByRole('dialog')).toContainText('Policy version 5');
    await expect(frame.getByRole('dialog')).toContainText('Nov 01, 2026');
    await dialogButton('Cancel').click();
    await button('Generate documents').click();
    await dialogButton('Generate documents').click();
    await expect(frame.getByRole('status')).toContainText('Generation requested');
    await expect(button('Preview PDF')).toBeDisabled();
    await button('Back to policy').click();
    await button('TX-0001842-04').click();
    await expect(button('Endorsement package')).toHaveCount(0);
    await expect(button('Homeowners policy packet')).toBeVisible();
    await button('Back to policy').click();
    await button('TX-0001842-03').click();
    await expect(button('Prior policy packet')).toBeVisible();
    await expect(button('Homeowners policy packet')).toHaveCount(0);
    await expect(button('Generate documents')).toBeDisabled();

    await button('Administration').click();
    await expect(frame.getByRole('heading', { name: 'Forms catalog', exact: true })).toBeVisible();
    await expect(button('Generate documents')).toHaveCount(0);
    await frame.locator('[data-admin-filter=state]').selectOption('TX');
    await expect(button('HO-DEC · Homeowners declarations')).toHaveCount(0);
    await expect(button('HO-PRIV · Privacy notice')).toBeVisible();
    await frame.locator('[data-admin-filter=state]').selectOption('All states');
    await button('HO-DEC · Homeowners declarations').click();
    await screen('Template').click();
    await frame.locator('#lp-master-file').setInputFiles({ name: 'unsafe.docm', mimeType: 'application/octet-stream', buffer: Buffer.from('synthetic') });
    await expect(frame.getByRole('alert')).toContainText('Choose a .docx file');
    await frame.locator('#lp-master-file').setInputFiles({ name: 'synthetic-declarations.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('synthetic UI fixture; not a real document') });
    await frame.getByRole('combobox', { name: 'Policy number mapping' }).selectOption('');
    await button('Check template').click();
    await expect(frame.getByRole('alert')).toContainText('Map every required');
    await frame.getByRole('combobox', { name: 'Policy number mapping' }).selectOption('policy.number');
    await button('Check template').click();
    await screen('Attachment').click();
    await expect(frame.locator('#lp-admin-content')).toContainText('Required before packet is ready');
    await screen('Test & publish').click();
    await frame.locator('[data-scenario=state]').selectOption('TX');
    await button('Test attachment').click();
    await expect(frame.getByRole('heading', { name: 'Would not attach' })).toBeVisible();
    await expect(button('Submit for review')).toBeDisabled();
    await frame.locator('[data-scenario=state]').selectOption('CA');
    await button('Test attachment').click();
    await expect(frame.getByRole('heading', { name: 'Would attach', exact: true })).toBeVisible();
    await button('Preview document').click();
    await expect(frame.getByRole('dialog')).toContainText('HO-TEST-001');
    await page.keyboard.press('Escape');
    await button('Submit for review').click();
    await frame.locator('#lp-doc-role').selectOption('Template author');
    await expect(button('Approve content')).toBeDisabled();
    await frame.locator('#lp-doc-role').selectOption('Content reviewer');
    await button('Approve content').scrollIntoViewIfNeeded();
    await button('Approve content').click();
    await dialogButton('Approve content').click();
    await expect(frame.getByRole('status')).toContainText('Content approved');
    await expect(button('Activate version')).toBeDisabled();
    await frame.locator('#lp-doc-role').selectOption('Technical publisher');
    await button('Activate version').click();
    await dialogButton('Activate in validation').click();
    await expect(frame.getByRole('status')).toContainText('validation environment only');

    await button('Administration').click();
    await button('HO-PRIV · Privacy notice').click();
    await screen('Template').click();
    await expect(frame.getByRole('combobox', { name: 'Policy number mapping' })).toHaveCount(0);
    await expect(frame.locator('#lp-admin-content')).toContainText('Static PDF');
    await button('Administration').click();
    await button('HO-WB · Water backup endorsement').click();
    await screen('Test & publish').click();
    await frame.locator('[data-scenario=water]').uncheck();
    await button('Test attachment').click();
    await expect(frame.getByRole('heading', { name: 'Would not attach' })).toBeVisible();
    await frame.locator('[data-scenario=water]').check();
    await button('Test attachment').click();
    await expect(frame.getByRole('heading', { name: 'Would attach', exact: true })).toBeVisible();
    await frame.locator('[data-scenario=date]').fill('2026-10-01');
    await frame.locator('[data-scenario=date]').press('Tab');
    await button('Test attachment').click();
    await expect(frame.getByRole('region', { name: 'Attachment test result' })).toContainText('not effective');

    await button('Administration').click();
    await button('PA-SCHED · Vehicle schedule').click();
    await expect(frame.locator('[data-master=key]')).toBeDisabled();
    await screen('Template').click();
    await expect(frame.locator('#lp-master-file')).toBeDisabled();
    await expect(frame.locator('[data-master=format]')).toHaveValue('Excel');
    await button('Create new edition').click();
    await dialogButton('Create draft').click();
    await expect(frame.locator('[data-master=key]')).toBeEnabled();
    await expect(frame.locator('[data-master=edition]')).toHaveValue('2026-03');
    await button('Administration').click();
    await expect(frame.getByRole('row').filter({ hasText: 'PA-SCHED' }).filter({ hasText: 'Active' })).toHaveCount(1);

    await button('Add form').click();
    await frame.locator('#lp-new-key').fill('HO-TEST');
    await frame.locator('#lp-new-name').fill('Synthetic test form');
    await dialogButton('Create draft').click();
    await button('Save & continue').click();
    await expect(frame.getByRole('alert')).toContainText('at least one state');
    await frame.locator('[data-master-check=states][value=CA]').check();
    await frame.locator('[data-master=start]').fill('2026-11-01');
    await frame.locator('[data-master=start]').press('Tab');
    await button('Save & continue').click();
    await expect(screen('Template')).toHaveAttribute('aria-selected', 'true');
    await button('Save & continue').click();
    await expect(frame.getByRole('alert')).toContainText('Choose and check');

    await screen('Document operations').click();
    await button('Retry failed request').click();
    await dialogButton('Retry failed request').click();
    await expect(frame.getByRole('heading', { name: 'DOC-004850 · Request detail' })).toBeVisible();
    await expect(button('DOC-004821')).toBeVisible();
    await button('Cancel request').click();
    await dialogButton('Cancel request').click();
    await expect(frame.getByRole('status')).toContainText('Existing issued copies were not deleted');
    await button('DOC-004720').click();
    await button('Request archive restore').click();
    await dialogButton('Request archive restore').click();
    await expect(frame.getByRole('status')).toContainText('requested for review');

    await button('Reporting').click();
    await button('Export').click();
    await expect(frame.getByRole('button', { name: 'Preview XLSX' })).toHaveCount(2);
    await frame.getByRole('button', { name: 'Preview XLSX' }).first().click();
    await expect(frame.getByRole('dialog')).toContainText('00123');
    await page.keyboard.press('Escape');

    await button('Customer portal').click();
    await expect(frame.getByRole('tabpanel')).not.toContainText('DOC-004821');
    await expect(button('Generate documents')).toHaveCount(0);
    await button('Administration').click();
    await screen('Forms').click();
    await page.keyboard.press('ArrowRight');
    await expect(screen('Document operations')).toBeFocused();

    const inner = page.mainFrame();
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const name of ['Policies', 'Administration', 'Reporting', 'Customer portal']) {
        await button(name).click();
        if (name === 'Policies') await button('TX-0001842-04').click();
        if (name === 'Administration') await button('HO-DEC · Homeowners declarations').click();
        const dimensions = await inner.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        }));
        expect(dimensions.content, `${name} page overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
        if (name === 'Administration') {
          for (const tab of ['Template', 'Attachment', 'Test & publish']) {
            await screen(tab).click();
            const fits = await inner.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
            expect(fits, `${tab} page overflow at ${width}px`).toBe(true);
          }
        }
      }
      await button('Administration').click();
      await screen('Document operations').click();
      const operationsFits = await inner.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(operationsFits, `Operations page overflow at ${width}px`).toBe(true);
    }
    expect(errors).toEqual([]);
    console.log('PASS: prototype workflows, permissions display, keyboard navigation and responsive layout.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
