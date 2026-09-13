import { test, expect, seedKey, gotoRoute, watchForErrors } from './fixtures';

/**
 * API contract.
 *
 * The frontend keys everything on stable `entity_id` values, but several server
 * modules selected the per-version row `id` and omitted `superseded_by IS NULL`.
 * Those pages were unreachable at the time, so the bugs were invisible until
 * they were wired into a hub. This suite asserts the contract directly so the
 * next regression fails loudly instead of rendering raw row ids.
 */

const HIVE_ID = /^hive-[\w-]+$/;

test.describe('entity ids are stable, not per-version rows', () => {
  test('hives expose clean entity ids', async ({ api }) => {
    const hives = await api.get<any[]>('/hives');
    expect(hives.length).toBeGreaterThan(0);
    for (const h of hives) {
      expect(h.id, `hive id "${h.id}" looks like a per-version row id`).toMatch(HIVE_ID);
      // Row ids are `hive-<12ish random chars>` with no hyphen-1 style suffix
      expect(h.id.length, `hive id "${h.id}" is suspiciously long`).toBeLessThan(24);
    }
  });

  test('modules that report per-hive results use the same hive ids as /api/hives', async ({ api }) => {
    const hives = await api.get<any[]>('/hives');
    const ids = new Set(hives.map((h) => h.id));

    // Each of these was broken by selecting the per-version id and/or omitting
    // the superseded filter. A mismatch means the frontend can't join the data.
    const endpoints: [string, string][] = [
      ['/swarm/risk', 'hiveId'],
      ['/queen/all', 'hiveId'],
      ['/trending', 'hiveId'],
      ['/schedule', 'hiveId'],
      ['/treatment', 'hiveId'],
    ];

    for (const [endpoint, key] of endpoints) {
      const rows = await api.get<any[]>(endpoint);
      const unknown = rows.map((r) => r[key]).filter((v) => v && !ids.has(v));
      expect(unknown, `${endpoint} returned hive ids not present in /api/hives`).toEqual([]);
    }
  });

  test('outlier reports use apiary entity ids', async ({ api }) => {
    const apiaries = await api.get<any[]>('/apiaries');
    const ids = new Set(apiaries.map((a) => a.id));
    const reports = await api.get<any[]>('/outlier');
    for (const r of reports) {
      expect(ids.has(r.apiaryId), `outlier report apiaryId "${r.apiaryId}" not in /api/apiaries`).toBeTruthy();
    }
  });

  test('swarm risk is actually computed per hive', async ({ api }) => {
    // With every lookup broken (per-version id), all hives reported the identical
    // baseline score — a single value was a reliable tell of the bug.
    const rows = await api.get<any[]>('/swarm/risk');
    expect(rows.length).toBeGreaterThan(1);
    const scores = new Set(rows.map((r) => r.riskScore));
    expect(scores.size, 'every hive scored identically — per-hive lookups are failing').toBeGreaterThan(1);
    for (const r of rows) {
      expect(r.riskScore).toBeGreaterThanOrEqual(0);
      expect(r.riskScore).toBeLessThanOrEqual(100);
      expect(['low', 'moderate', 'high', 'very-high']).toContain(r.riskLevel);
    }
  });
});

test.describe('no duplicate rows from superseded versions', () => {
  test('list endpoints return unique entity ids', async ({ api }) => {
    for (const endpoint of ['/hives', '/apiaries', '/sensors', '/inspections', '/tasks']) {
      const rows = await api.get<any[]>(endpoint);
      const ids = rows.map((r) => r.id);
      expect(new Set(ids).size, `${endpoint} returned duplicate ids (missing superseded_by filter)`).toBe(ids.length);
    }
  });

  test('editing an entity does not multiply it in list responses', async ({ api }) => {
    const created = await api.post<any>('/tasks', { title: `e2e-supersede-${Date.now()}`, completed: false });
    await api.put(`/tasks/${created.id}`, { title: 'e2e-supersede-renamed' });
    await api.put(`/tasks/${created.id}`, { completed: true });

    const rows = await api.get<any[]>('/tasks');
    const matches = rows.filter((t) => t.id === created.id);
    expect(matches.length, 'the superseded versions leaked into the list').toBe(1);
    expect(matches[0].title).toBe('e2e-supersede-renamed');
    expect(matches[0].completed).toBe(true);

    expect(await api.del(`/tasks/${created.id}`)).toBe(200);
  });
});

test.describe('dashboard surfaces real data', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  test('the alert queue renders ranked items with actions', async ({ page }) => {
    const diag = watchForErrors(page);
    await gotoRoute(page, '/');

    await expect(page.locator('main')).toContainText(/Do this next|Worth a look|All caught up/);

    // Every queue row is a link or carries an inline CTA — the old dashboard
    // buried urgent items behind a "+N more" link to /tasks.
    const rows = page.locator('main a[href*="#/"]');
    expect(await rows.count()).toBeGreaterThan(0);

    expect(diag.consoleErrors).toEqual([]);
  });

  test('tab badges reflect real counts rather than hardcoded zero', async ({ page }) => {
    await gotoRoute(page, '/');
    const alertsTab = page.getByRole('button', { name: /Alerts/ });
    await expect(alertsTab).toBeVisible();

    // With 8+ urgent alerts in the seeded data the badge must be non-zero; the
    // original dashboard hardcoded `hiveBadge = 0` and never badged Alerts.
    const text = await alertsTab.innerText();
    const n = Number((text.match(/(\d+)/) ?? [])[1] ?? '0');
    const alerts = await page.evaluate(async () => {
      const key = localStorage.getItem('beetree-api-key') ?? '';
      const r = await fetch('/api/ontology/insights', { headers: { Authorization: 'Bearer ' + key } });
      return r.ok ? (await r.json()).insights?.length ?? 0 : 0;
    });
    if (alerts > 0) {
      expect(n, 'Alerts tab badge is not reflecting real alert counts').toBeGreaterThan(0);
    }
  });

  test('the dashboard reports data freshness', async ({ page }) => {
    // Previously no surface anywhere distinguished "your bees are fine" from
    // "I haven't heard from your bees in seven weeks".
    await gotoRoute(page, '/');
    await expect(page.locator('main')).toContainText(/Data\s|Syncing|No data/);
  });
});

test.describe('stale readings are labelled, not called live', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  test('sensor cards mark stale readings', async ({ page, api }) => {
    const sensors = await api.get<any[]>('/sensors');
    const stale = sensors.filter((s) => {
      const t = s.latestReading?.timestamp;
      return t && Date.now() - new Date(t).getTime() > 6 * 3600_000;
    });
    test.skip(stale.length === 0, 'no stale sensors in this dataset');

    await gotoRoute(page, '/sensors?tab=readings');
    await expect(page.locator('main')).toContainText(/Stale/);

    // And nothing calls that data "live".
    const text = await page.locator('main').innerText();
    expect(text, 'a stale-reading section is still captioned "Live"').not.toMatch(/Live\s*Sensors/i);
  });
});

test.describe('user-facing copy contains no developer artefacts', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  const FORBIDDEN: [string, RegExp][] = [
    ['/equipment', /src\/pages\//],
    ['/settings', /\bsrc\//],
    ['/', /\bsrc\//],
  ];

  for (const [route, pattern] of FORBIDDEN) {
    test(`${route} does not leak source paths`, async ({ page }) => {
      await gotoRoute(page, route);
      const text = await page.locator('main').innerText();
      expect(text, `source path leaked into ${route}`).not.toMatch(pattern);
    });
  }

  test('no decorative emoji in the main chrome', async ({ page }) => {
    // Emoji were used as section icons and rendered differently per platform,
    // next to an otherwise clean Lucide line-icon set.
    await gotoRoute(page, '/');
    const text = await page.locator('main').innerText();
    const emoji = text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? [];
    expect(emoji, `emoji found in the dashboard chrome: ${emoji.join(' ')}`).toEqual([]);
  });
});

test.describe('dark mode does not break surfaces', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  test('sensor metric tiles are themed in dark mode', async ({ page }) => {
    // Temperature/humidity tiles were built with light-only tints (bg-sky-50)
    // and rendered as glaring white rectangles inside dark cards.
    await page.addInitScript(() => {
      try { window.localStorage.setItem('beetree-theme', 'dark'); } catch { /* ignore */ }
    });
    await gotoRoute(page, '/sensors?tab=readings');
    await expect(page.locator('html')).toHaveClass(/dark/);

    const bright = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('main div').forEach((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
        if (!m) return;
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        // Near-white surface on the dark theme
        if (r > 245 && g > 245 && b > 245) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 40 && rect.height > 24) out.push(bg);
        }
      });
      return out;
    });
    expect(bright, `unthemed light surfaces in dark mode: ${bright.join(', ')}`).toEqual([]);
  });
});
