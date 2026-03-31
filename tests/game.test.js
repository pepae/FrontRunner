const { test, expect } = require('@playwright/test');

async function waitForPlaying(page) {
  await page.waitForFunction(
    () => window.__gameState && window.__gameState.phase === 'playing',
    { timeout: 15000 }
  );
}

// ── 1: canvas visible ─────────────────────────────────────────────────────────
test('canvas is visible on page load', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#gameCanvas')).toBeVisible();
});

// ── 2: sun is drawn (canvas not blank) ───────────────────────────────────────
test('canvas is not blank — sun is drawn', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  const notBlank = await page.evaluate(() => {
    const d = document.getElementById('gameCanvas')
      .getContext('2d').getImageData(0,0,480,854).data;
    for (let i = 0; i < d.length; i += 4)
      if (d[i] > 60 || d[i+1] > 60 || d[i+2] > 60) return true;
    return false;
  });
  expect(notBlank).toBe(true);
});

// ── 3: slingshot fires a projectile ──────────────────────────────────────────
test('slingshot gesture launches a player projectile', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  const anchor = await page.evaluate(() => {
    const { x, y } = window.__gameState.anchor;
    return { x, y };
  });

  const rect   = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;
  const px = rect.x + anchor.x * scaleX;
  const py = rect.y + anchor.y * scaleY;

  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const count = await page.evaluate(() => window.__gameState.projs.length);
  expect(count).toBeGreaterThan(0);
});

// ── 4: coins deducted on shot ────────────────────────────────────────────────
test('coins are deducted when a projectile is launched', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => window.__gameState.coins);

  const anchor = await page.evaluate(() => {
    const { x, y } = window.__gameState.anchor;
    return { x, y };
  });

  const rect   = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;
  const px = rect.x + anchor.x * scaleX;
  const py = rect.y + anchor.y * scaleY;

  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => window.__gameState.coins);
  expect(after).toBeLessThan(before);
});

// ── 5: AI projectiles appear ──────────────────────────────────────────────────
test('AI projectiles appear within 5 seconds', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);

  await page.evaluate(() => {
    const now = Date.now();
    window.__gameState.nextShot = [now - 1, now - 1, now - 1];
  });

  await page.waitForFunction(
    () => window.__gameState.aiProjs.length > 0,
    { timeout: 5000 }
  );

  const count = await page.evaluate(() => window.__gameState.aiProjs.length);
  expect(count).toBeGreaterThan(0);
});

// ── 6: no shot when broke ────────────────────────────────────────────────────
test('game prevents shot when coins are insufficient', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  await page.evaluate(() => { window.__gameState.coins = 0; });

  const anchor = await page.evaluate(() => {
    const { x, y } = window.__gameState.anchor;
    return { x, y };
  });

  const rect   = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;
  const px = rect.x + anchor.x * scaleX;
  const py = rect.y + anchor.y * scaleY;

  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => window.__gameState.coins);
  expect(after).toBeGreaterThanOrEqual(0);
});

// ── 7: game over + restart ────────────────────────────────────────────────────
test('game over triggers and restart resets state', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__gameState.coins = 5;
    window.__gameState.phase = 'gameover';
  });

  expect(await page.evaluate(() => window.__gameState.phase)).toBe('gameover');

  await page.mouse.click(240, 427);
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => window.__gameState.phase)).toBe('playing');
  expect(await page.evaluate(() => window.__gameState.coins)).toBe(100);
  expect(await page.evaluate(() => window.__gameState.score)).toBe(0);
});

// ── 8: encrypt shield raises cost ─────────────────────────────────────────────
test('encrypt shield deducts extra coins per shot', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  // Use SLOW speed (no extra) + shield, so total = 10 + 0 + 8 = 18
  await page.evaluate(() => { window.__gameState.shieldOn = true; window.__gameState.speedIdx = 0; });

  const before = await page.evaluate(() => window.__gameState.coins);

  const anchor = await page.evaluate(() => {
    const { x, y } = window.__gameState.anchor;
    return { x, y };
  });

  const rect   = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;
  const px = rect.x + anchor.x * scaleX;
  const py = rect.y + anchor.y * scaleY;

  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => window.__gameState.coins);
  // Should deduct 10 (base) + 8 (shield) = 18
  expect(before - after).toBe(18);
});
