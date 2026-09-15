import { test, expect, seedKey, watchForErrors, gotoRoute, mainText } from './fixtures';

/**
 * Routing / navigation integrity.
 *
 * Regression cover for the Sep 2026 finding that three dashboard links
 * (/swarm, /treatments, /queen) pointed at routes that were never registered:
 * React Router rendered the header plus an empty <main>, so the app looked
 * broken without throwing anything a unit test could catch.
 */

// Every hash route the app registers, plus every legacy redirect target.
const ROUTES: { path: string; expectText?: RegExp }[] = [
  { path: '/', expectText: /Dashboard/ },
  { path: '/chat', expectText: /Buzz|New Chat/ },
  { path: '/inspections', expectText: /Inspections/ },
  { path: '/inspections/new' },
  { path: '/hives', expectText: /Hives/ },
  { path: '/sensors', expectText: /Sensors/ },
  { path: '/tasks', expectText: /Tasks/ },
  { path: '/forage' },
  { path: '/equipment', expectText: /Equipment/ },
  { path: '/hardware', expectText: /Hardware/ },
  { path: '/settings', expectText: /Settings/ },
  { path: '/activity' },
  { path: '/world' },
];

// Legacy paths that must resolve to a real tab rather than a blank shell.
const LEGACY: { from: string; toTab: RegExp }[] = [
  { from: '/swarm', toTab: /hives\?tab=swarm/ },
  { from: '/queen', toTab: /hives\?tab=queen/ },
  { from: '/treatments', toTab: /hives\?tab=treatments/ },
  { from: '/pests', toTab: /hives\?tab=pests/ },
  { from: '/trends', toTab: /hives\?tab=trends/ },
  { from: '/apiaries', toTab: /hives\?tab=apiaries/ },
  { from: '/colony-map', toTab: /hives\?tab=map/ },
  { from: '/outliers', toTab: /sensors\?tab=anomalies/ },
  { from: '/acoustics', toTab: /sensors\?tab=acoustics/ },
  { from: '/schedule', toTab: /inspections\?tab=schedule/ },
  { from: '/buzz', toTab: /chat/ },
];

test.describe('routing', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  for (const { path, expectText } of ROUTES) {
    test(`renders content at ${path}`, async ({ page }) => {
      const diag = watchForErrors(page);
      await gotoRoute(page, path);

      // The core assertion: <main> must contain something. An unregistered
      // route renders an empty shell and silently passes a naive "page loaded".
      await expect
        .poll(async () => (await mainText(page)).length, {
          message: `${path} rendered an empty <main>`,
          timeout: 10_000,
        })
        .toBeGreaterThan(0);

      if (expectText) {
        await expect(page.locator('main')).toContainText(expectText);
      }

      // No React crash, no failed API call.
      expect(diag.consoleErrors, `console errors at ${path}`).toEqual([]);
      expect(
        diag.failedRequests.filter((r) => !r.startsWith('404')),
        `failed requests at ${path}`,
      ).toEqual([]);
    });
  }

  for (const { from, toTab } of LEGACY) {
    test(`legacy ${from} redirects to ${toTab.source}`, async ({ page }) => {
      await gotoRoute(page, from);
      await expect.poll(async () => page.url(), { timeout: 10_000 }).toMatch(toTab);
      // And the destination actually rendered. Poll, because the target is a
      // lazy-loaded route chunk — asserting immediately reads <main> before
      // React has mounted it and gives a false failure.
      await expect
        .poll(async () => (await mainText(page)).length, {
          message: `${from} redirected but ${toTab.source} rendered nothing`,
          timeout: 10_000,
        })
        .toBeGreaterThan(0);
    });
  }

  test('unknown path lands on the dashboard, not a blank shell', async ({ page }) => {
    await gotoRoute(page, '/definitely-not-a-route');
    await expect.poll(async () => page.url(), { timeout: 10_000 }).toMatch(/#\/$/);
    await expect
      .poll(async () => (await mainText(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test('every hub tab renders when deep-linked', async ({ page }) => {
    const hubTabs = [
      ['/hives', ['hives', 'swarm', 'queen', 'treatments', 'pests', 'trends', 'apiaries', 'map']],
      ['/sensors', ['anomalies', 'readings', 'acoustics']],
      ['/inspections', ['history', 'quick', 'voice', 'ai', 'schedule']],
    ] as const;

    for (const [hub, tabs] of hubTabs) {
      for (const tab of tabs) {
        await gotoRoute(page, `${hub}?tab=${tab}`);
        await expect
          .poll(async () => (await mainText(page)).length, {
            message: `${hub}?tab=${tab} rendered nothing`,
            timeout: 10_000,
          })
          .toBeGreaterThan(0);
      }
    }
  });
});

test.describe('navigation chrome', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  test('main nav exposes the primary destinations', async ({ page }) => {
    await gotoRoute(page, '/');
    const nav = page.locator('nav').last();
    for (const label of ['Home', 'Buzz', 'Inspect', 'Hives', 'Tasks', 'More']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('the active nav item tracks the current route', async ({ page }) => {
    // /tasks was absent from both navs, so the highlight dropped to zero here
    // even though two dashboard alerts route to it.
    for (const [path, label] of [['/tasks', 'Tasks'], ['/hives', 'Hives'], ['/', 'Home']] as const) {
      await gotoRoute(page, path);
      const active = page.locator('nav a[class*="honey"]').last();
      await expect(active).toContainText(label);
    }
  });

  test('every page is reachable from the nav, not just by URL', async ({ page }) => {
    // /world was registered as a route but absent from both navs, so the only way
    // in was typing the hash. A page you cannot reach is a page that does not
    // exist as far as a beekeeper is concerned — and nothing caught it, because
    // the routing test only checks that each route RENDERS.
    //
    // The two navs are viewport-exclusive (the sidebar is `hidden lg:flex`), so
    // each is asserted at the width where it actually renders. Desktop first and
    // the mobile sheet last, so the sheet never has to be dismissed — the PWA
    // install banner sits over the bottom bar and intercepts that click.
    await gotoRoute(page, '/');

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('aside nav a[href="#/world"]')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    // The PWA install banner sits directly over the bottom bar and swallows the
    // click. A real user dismisses it; so does the test.
    const dismiss = page.getByRole('button', { name: /dismiss|not now|later/i });
    if (await dismiss.count() > 0) {
      await dismiss.first().click();
    } else {
      await page.evaluate(() => {
        try { window.localStorage.setItem('beetree-install-dismissed', String(Date.now())); } catch { /* ignore */ }
      });
      await page.reload();
      await gotoRoute(page, '/');
      await page.setViewportSize({ width: 390, height: 844 });
    }
    // `exact` matters — the dashboard also renders a "More tabs" button.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByText('More Pages')).toBeVisible();
    await expect(page.locator('a[href="#/world"]').last()).toBeVisible();
  });

  test('the More sheet highlights when the current route lives in it', async ({ page }) => {
    await gotoRoute(page, '/world');
    const more = page.getByRole('button', { name: 'More' });
    await expect(more).toHaveClass(/honey/);
  });

  test('tab rows that overflow offer a scroll affordance', async ({ page }) => {
    // The old tab rows were clipped by the viewport with no cue that more
    // existed, which reads as a layout bug rather than a scroll.
    await gotoRoute(page, '/hives');
    const scroller = page.locator('main div.overflow-x-auto').first();
    const overflows = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 4);
    if (overflows) {
      await expect(page.locator('button[aria-label="More tabs"]')).toBeVisible();
    }
  });
});
