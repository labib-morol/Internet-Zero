import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function startTutorial(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the case', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save your recovery code' })).toBeVisible();
  await page.getByRole('button', { name: "I've saved it — open the desktop" }).click();
  await expect(page.getByRole('heading', { name: 'office-scripts', exact: true })).toBeVisible();
}

async function navigate(page: Page, address: string) {
  const input = page.getByRole('textbox', { name: 'In-game address' });
  await input.fill(address);
  await input.press('Enter');
}

async function checkAccessibility(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, description: v.description, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
}

test('guest can open the real tutorial desktop accessibly', async ({ page }) => {
  await startTutorial(page);
  await checkAccessibility(page);
});

test('player completes tutorial through visible browser controls and terminal', async ({ page }) => {
  await startTutorial(page);
  // Derive the two passphrase components from visible, authored evidence.
  const document = page.getByRole('blockquote');
  const caption = await document.innerText();
  const catName = /^([A-Za-z]+),/.exec(caption)?.[1];
  expect(catName).toBeTruthy();
  await page.getByRole('link', { name: 'files', exact: true }).click();
  await expect(page.getByRole('link', { name: 'LICENSE', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'LICENSE', exact: true }).click();
  const file = page.getByText(/Copyright \(c\)/);
  const year = /\b(19|20)\d{2}\b/.exec(await file.innerText())?.[0];
  expect(year).toBeTruthy();

  await navigate(page, 'forge.pinecone.pcp/pinecone/office-scripts/commits');
  await page.getByRole('link', { name: /Commit .*rotate printer admin pass/ }).click();
  await page.getByRole('button', { name: /^Collect evidence:/ }).click();
  await page.getByRole('button', { name: 'Case file', exact: true }).click();
  const caseFile = page.getByRole('complementary', { name: 'Case file' });
  await expect(caseFile.getByText('g.first-commit', { exact: true })).toBeVisible();

  await navigate(page, 'mail.pinecone.pcp/mb.odile');
  await expect(page.getByRole('heading', { name: /Mailbox/ })).toBeVisible();
  await page.getByRole('link', { name: /Thread:.*printer/i }).first().click();
  await expect(page.getByText(/name of the shop cat/)).toBeVisible();
  await page.getByRole('button', { name: /^Collect evidence:/ }).click();
  await caseFile.getByRole('textbox', { name: 'Who holds the hint?', exact: true }).fill('Odile Brandt');
  await caseFile.getByLabel('What kind of clue is it?').selectOption({ label: 'two facts combined' });
  await caseFile.getByRole('button', { name: 'Submit group A', exact: true }).click();
  await expect(caseFile.getByText('g.mailbox', { exact: true })).toBeVisible();
  await checkAccessibility(page);
  await caseFile.getByRole('button', { name: 'Close case file panel' }).click();

  await navigate(page, 'printer.pinecone.pcp/');
  await page.getByRole('button', { name: 'Screen reader', exact: true }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill(`${catName}${year}`);
  await page.getByLabel('Passphrase', { exact: true }).press('Enter');
  await expect(page.getByLabel('Command for printer.pinecone.pcp')).toBeEnabled();
  await page.getByLabel('Command for printer.pinecone.pcp').fill('cat /etc/motd');
  await page.getByLabel('Command for printer.pinecone.pcp').press('Enter');
  await expect(page.getByRole('list', { name: 'Terminal transcript' })).toContainText(/Rowan/);
  await checkAccessibility(page);
});

test('compact desktop can open all apps without dragging', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startTutorial(page);
  await expect(page.getByRole('navigation', { name: 'Open windows' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notebook', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Notebook', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Private notes' })).toBeVisible();
  await checkAccessibility(page);
  await page.getByRole('tab', { name: 'Private notes' }).click();
  await page.getByLabel('Private note', { exact: true }).fill('An observation visible only to me.');
  await page.getByRole('button', { name: 'Save private note', exact: true }).click();
  await expect(page.getByText('Private note saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await page.getByRole('button', { name: 'Notebook', exact: true }).click();
  await page.getByRole('tab', { name: 'Private notes' }).click();
  await expect(page.getByRole('button', { name: 'An observation visible only to me.' })).toBeVisible();
});
