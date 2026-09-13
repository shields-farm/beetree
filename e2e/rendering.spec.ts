import { test, expect, seedKey, gotoRoute, watchForErrors } from './fixtures';

/**
 * Third-party render integrations.
 *
 * Routing tests only assert a page produced *some* content, so a diagram
 * library that fails to render is invisible to them. The Mermaid component
 * swallows render errors and substitutes a "Diagram unavailable" fallback, so a
 * broken upgrade looks like a working page with an apologetic paragraph.
 *
 * These tests pin the integration points that a dependency bump can silently
 * break. Added after `npm audit fix` moved mermaid 11.16 -> 11.17.
 */

test.describe('mermaid diagrams render', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  test('hardware page renders real SVG, not the fallback', async ({ page }) => {
    const diag = watchForErrors(page);
    await gotoRoute(page, '/hardware');

    // The component renders into `.mermaid-container`.
    const container = page.locator('.mermaid-container').first();
    await expect(container).toBeVisible({ timeout: 15_000 });

    // Wait for the async render to land.
    await expect
      .poll(
        async () => container.locator('svg').count(),
        { message: 'mermaid produced no <svg>', timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    // The fallback paragraph means mermaid.render() rejected.
    expect(
      await container.innerText(),
      'mermaid fell back to "Diagram unavailable"',
    ).not.toContain('Diagram unavailable');

    expect(diag.consoleErrors, 'console errors while rendering mermaid').toEqual([]);
  });

  test('every hardware tab that shows a diagram renders one', async ({ page }) => {
    for (const tab of ['overview', 'hardware', 'lora', 'ai', 'data']) {
      await gotoRoute(page, `/hardware?tab=${tab}`);
      await page.waitForTimeout(1200);

      const containers = page.locator('.mermaid-container');
      const n = await containers.count();
      if (n === 0) continue; // this tab has no diagram, which is fine

      for (let i = 0; i < n; i++) {
        const c = containers.nth(i);
        await expect
          .poll(async () => c.locator('svg').count(), { timeout: 15_000 })
          .toBeGreaterThan(0);
        expect(await c.innerText(), `tab ${tab} diagram ${i} hit the fallback`)
          .not.toContain('Diagram unavailable');
      }
    }
  });
});
