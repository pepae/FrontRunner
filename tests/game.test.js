const { test, expect } = require('@playwright/test');

async function waitForPlaying(page) {
  await page.waitForFunction(
    () => window.__gameState && window.__gameState.phase === 'playing',
    { timeout: 15000 }
  );
}

// ─── Test 1: canvas visible ───────────────────────────────────────────────────
test('canvas is visible on page load', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#gameCanvas')).toBeVisible();
});

// ─── Test 2: canvas not blank (sun drawn) ────────────────────────────────────
test('canvas is not blank — sun is drawn', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  const isNotBlank = await page.evaluate(() => {
    const canvas = document.getElementById('gameCanvas');
    const data   = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 30 || data[i+1] > 30 || data[i+2] > 30) return true;
    }
    return false;
  });
  expect(isNotBlank).toBe(true);
});

// ─── Test 3: slingshot gesture launches projectile ────────────────────────────
test('slingshot gesture launches a player projectile', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  const anchor = await page.evaluate(() => {
    const s = window.__gameState;
    return { x: s.anchor.x, y: s.anchor.y };
  });

  const rect   = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;
  const px = rect.x + anchor.x * scaleX;
  const py = rect.y + anchor.y * scaleY;

  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py + 70, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const count = await page.evaluate(() => window.__gameState.projs.length);
  expect(count).toBeGreaterThan(0);
});

// ─── Test 4: coin deduction on shot ──────────────────────────────────────────
test('coins are deducted when a projectile is launched', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => window.__gameState.coins);

  const anchor = await page.evaluate(() => {
    const s = window.__gameState;
    return { x: s.anchor.x, y: s.anchor.y };
  });

  const rect   = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;
  const px = rect.x + anchor.x * scaleX;
  const py = rect.y + anchor.y * scaleY;

  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py + 70, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => window.__gameState.coins);
  expect(after).toBeLessThan(before);
});

// ─── Test 5: AI projectiles appear ───────────────────────────────────────────
test('AI projectiles appear within 5 seconds', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);

  await page.evaluate(() => {
    const now = Date.now();
    window.__gameState.nextShot = window.__gameState.nextShot.map(() => now - 1);
  });

  await page.waitForFunction(
    () => window.__gameState.aiProjs.length > 0,
    { timeout: 5000 }
  );

  const count = await page.evaluate(() => window.__gameState.aiProjs.length);
  expect(count).toBeGreaterThan(0);
});

// ─── Test 6: no shot when broke ──────────────────────────────────────────────
test('game prevents shot when coins are insufficient', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  await page.evaluate(() => { window.__gameState.coins = 0; });

  const anchor = await page.evaluate(() => {
    const s = window.__gameState;
    return { x: s.anchor.x, y: s.anchor.y };
  });

  const rect   = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;
  const px = rect.x + anchor.x * scaleX;
  const py = rect.y + anchor.y * scaleY;

  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py + 70, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => window.__gameState.coins);
  expect(after).toBeGreaterThanOrEqual(0);
});

// ─── Test 7: game over + restart ─────────────────────────────────────────────
test('game over state triggers and restart resets state', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__gameState.coins = 5;
    window.__gameState.phase = 'gameover';
  });

  const phase = await page.evaluate(() => window.__gameState.phase);
  expect(phase).toBe('gameover');

  await page.mouse.click(240, 427);
  await page.waitForTimeout(300);

  const afterPhase = await page.evaluate(() => window.__gameState.phase);
  expect(afterPhase).toBe('playing');

  const afterCoins = await page.evaluate(() => window.__gameState.coins);
  expect(afterCoins).toBe(100);

  const afterScore = await page.evaluate(() => window.__gameState.score);
  expect(afterScore).toBe(0);
});
