import { test, expect, type Page } from '@playwright/test';
const password = 'a long test passphrase 2026';
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Fresh from the soil. Closer to you.' }),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
test('marketplace search, category filters and responsive navigation', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things are growing.' })).toBeVisible();
  await page.getByLabel('Search produce').fill('maize');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fresh Maize', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ripe Bananas', exact: true })).toHaveCount(0);
  await page.getByLabel('Search produce').fill('');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Vegetables', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sukuma Wiki', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All produce', exact: true }).click();
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/${info.project.name}-marketplace.png`,
    fullPage: true,
  });
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await noOverflow(page);
  }
  expect(errors).toEqual([]);
});
test('buyer checkout, separate farmer deliveries and tracking recovery', async ({
  browser,
}, info) => {
  const buyer = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  const page = await buyer.newPage();
  await login(page, 'buyer@example.test');
  for (const product of [1, 4]) {
    await page.goto(`/products/${product}`);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to your cart.', { exact: true })).toBeVisible();
  }
  await page.goto('/cart');
  await page.getByLabel('Delivery address').fill('Nakuru, Section 58, near the school');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  const orderId = page.url().split('/').pop();
  await expect(page.getByRole('heading', { name: 'Green Valley Farm', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Harvest Hill Farm', exact: true })).toBeVisible();
  await noOverflow(page);
  const farm = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  const farmer = await farm.newPage();
  await login(farmer, 'farmer@example.test');
  await farmer.goto(`/orders/${orderId}`);
  await expect(farmer.getByText('Sukuma Wiki', { exact: true })).toHaveCount(0);
  await farmer.getByRole('button', { name: 'Confirm delivery', exact: true }).click();
  await farmer.getByLabel('Estimated delivery date').fill('2099-01-15');
  await farmer
    .getByRole('combobox', { name: 'Delivery window', exact: true })
    .selectOption('Afternoon');
  await farmer
    .getByLabel('Delivery note (optional)')
    .fill('Packed fresh. Your delivery is confirmed.');
  await farmer.getByRole('button', { name: 'Save update' }).click();
  await expect(
    farmer.getByText('Packed fresh. Your delivery is confirmed.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByText('Packed fresh. Your delivery is confirmed.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('15 January 2099', { exact: false })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-tracking.png`, fullPage: true });
  await page.route(`**/api/orders/${orderId}`, (route) => route.abort());
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByText('Packed fresh. Your delivery is confirmed.', { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await buyer.close();
  await farm.close();
});
test('farmer listing editor, requests, conversations and administrator view', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  const page = await context.newPage();
  await login(page, 'farmer@example.test');
  await page.goto('/farm');
  await page.getByRole('button', { name: 'New listing' }).click();
  await page
    .getByLabel('Product name', { exact: true })
    .fill(`Garden Tomatoes ${info.project.name}`);
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('Vegetables');
  await page.getByLabel('Price (KES)', { exact: true }).fill('90.50');
  await page.getByLabel('Quantity available', { exact: true }).fill('25');
  await page.getByLabel('Description', { exact: true }).fill('Fresh tomatoes from our garden.');
  await page.getByRole('button', { name: 'Save listing' }).click();
  await expect(
    page.getByText(`Garden Tomatoes ${info.project.name}`, { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.goto('/requests');
  await expect(page.getByRole('heading', { name: 'Your next buyer could be here.' })).toBeVisible();
  await noOverflow(page);
  await page.goto('/messages?peer=1');
  const content = `Hello buyer ${info.project.name}. <img src=x onerror=alert(1)>`;
  await page.getByLabel('Your message', { exact: true }).fill(content);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.message-stream').getByText(content, { exact: true })).toBeVisible();
  await expect(page.locator('.message-stream img')).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/${info.project.name}-messages.png`, fullPage: true });
  await context.close();
  const admin = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  const adminPage = await admin.newPage();
  await login(adminPage, 'admin@example.test');
  await adminPage.goto('/admin');
  await expect(adminPage.getByRole('heading', { name: 'A healthy marketplace.' })).toBeVisible();
  await expect(
    adminPage.getByRole('cell', { name: 'buyer@example.test', exact: true }),
  ).toBeVisible();
  await noOverflow(adminPage);
  await adminPage.screenshot({
    path: `test-results/${info.project.name}-admin.png`,
    fullPage: true,
  });
  await admin.close();
});
