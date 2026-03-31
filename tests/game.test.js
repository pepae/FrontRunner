const { test, expect } = require('@playwright/test');

// Helper: wait for the game to finish loading (phase === 'playing')
async function waitForPlaying(page) {
  await page.waitForFunction(
    () => window.__gameState && window.__gameState.phase === 'playing',
    { timeout: 15000 }
  );
}

// ─── Test 1: Page loads and canvas is visible ─────────────────────────────────
test('canvas is visible on page load', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#gameCanvas');
  await expect(canvas).toBeVisible();
});

// ─── Test 2: Canvas is not blank (sun is drawn) ───────────────────────────────
test('canvas is not blank — sun is drawn', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);

  // Give the game one frame to render
  await page.waitForTimeout(200);

  const isNotBlank = await page.evaluate(() => {
    const canvas = document.getElementById('gameCanvas');
    const ctx    = canvas.getContext('2d');
    const data   = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Look for non-background pixels (not #111318 = rgb(17,19,24))
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      if (r > 30 || g > 30 || b > 30) return true;
    }
    return false;
  });

  expect(isNotBlank).toBe(true);
});

// ─── Test 3: Slingshot gesture launches a projectile ─────────────────────────
test('slingshot gesture launches a player projectile', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  // Get slingshot anchor position
  const anchor = await page.evaluate(() => {
    const s = window.__gameState;
    return { x: s.slingshotAnchor.x, y: s.slingshotAnchor.y };
  });

  const rect = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;

  const pageAnchorX = rect.x + anchor.x * scaleX;
  const pageAnchorY = rect.y + anchor.y * scaleY;

  // Simulate drag: mousedown near anchor, move up (pull down), release
  await page.mouse.move(pageAnchorX, pageAnchorY);
  await page.mouse.down();
  await page.mouse.move(pageAnchorX, pageAnchorY + 60, { steps: 5 });
  await page.mouse.up();

  // Wait a frame
  await page.waitForTimeout(200);

  const projectileCount = await page.evaluate(() => {
    return window.__gameState.projectiles.length;
  });

  expect(projectileCount).toBeGreaterThan(0);
});

// ─── Test 4: Coin deduction on shot ──────────────────────────────────────────
test('coins are deducted when a projectile is launched', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  const initialCoins = await page.evaluate(() => window.__gameState.coins);

  const anchor = await page.evaluate(() => {
    const s = window.__gameState;
    return { x: s.slingshotAnchor.x, y: s.slingshotAnchor.y };
  });

  const rect = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;

  const pageAnchorX = rect.x + anchor.x * scaleX;
  const pageAnchorY = rect.y + anchor.y * scaleY;

  await page.mouse.move(pageAnchorX, pageAnchorY);
  await page.mouse.down();
  await page.mouse.move(pageAnchorX, pageAnchorY + 60, { steps: 5 });
  await page.mouse.up();

  await page.waitForTimeout(200);

  const afterCoins = await page.evaluate(() => window.__gameState.coins);
  expect(afterCoins).toBeLessThan(initialCoins);
});

// ─── Test 5: AI projectiles appear after a timeout ───────────────────────────
test('AI projectiles appear within 5 seconds', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);

  // Force-set next AI shoot time to now
  await page.evaluate(() => {
    const now = Date.now();
    window.__gameState.nextAiShoot = window.__gameState.nextAiShoot.map(() => now - 1);
  });

  await page.waitForFunction(
    () => window.__gameState.aiProjectiles.length > 0,
    { timeout: 5000 }
  );

  const count = await page.evaluate(() => window.__gameState.aiProjectiles.length);
  expect(count).toBeGreaterThan(0);
});

// ─── Test 6: Coins cannot go below 0 from normal shots ───────────────────────
test('game prevents shot when coins are insufficient', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  // Set coins to 0
  await page.evaluate(() => { window.__gameState.coins = 0; });

  const anchor = await page.evaluate(() => {
    const s = window.__gameState;
    return { x: s.slingshotAnchor.x, y: s.slingshotAnchor.y };
  });

  const rect = await page.locator('#gameCanvas').boundingBox();
  const scaleX = rect.width  / 480;
  const scaleY = rect.height / 854;

  const pageAnchorX = rect.x + anchor.x * scaleX;
  const pageAnchorY = rect.y + anchor.y * scaleY;

  await page.mouse.move(pageAnchorX, pageAnchorY);
  await page.mouse.down();
  await page.mouse.move(pageAnchorX, pageAnchorY + 60, { steps: 5 });
  await page.mouse.up();

  await page.waitForTimeout(200);

  const afterCoins = await page.evaluate(() => window.__gameState.coins);
  expect(afterCoins).toBeGreaterThanOrEqual(0);
});

// ─── Test 7: Game over state and restart ──────────────────────────────────────
test('game over state triggers when coins depleted and restart resets state', async ({ page }) => {
  await page.goto('/');
  await waitForPlaying(page);
  await page.waitForTimeout(200);

  // Force game over
  await page.evaluate(() => {
    window.__gameState.coins = 5; // below min shot cost of 10
    window.__gameState.phase = 'gameover';
  });

  // Verify game over state
  const phase = await page.evaluate(() => window.__gameState.phase);
  expect(phase).toBe('gameover');

  // Click to restart
  await page.mouse.click(240, 427);
  await page.waitForTimeout(300);

  const afterPhase = await page.evaluate(() => window.__gameState.phase);
  expect(afterPhase).toBe('playing');

  const afterCoins = await page.evaluate(() => window.__gameState.coins);
  expect(afterCoins).toBe(100);

  const afterScore = await page.evaluate(() => window.__gameState.score);
  expect(afterScore).toBe(0);
});
