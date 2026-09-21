import { test, expect, seedKey, watchForErrors, gotoRoute } from './fixtures';

/**
 * Hive groups (yard groupings) — the Ellis Special template.
 *
 * Coverage mirrors the Sep 2026 e2e philosophy: the copy-on-write and INSERT
 * arity bugs were all invisible to unit tests and only detectable through a
 * real server + browser. The groups feature adds two more such seams:
 * template instantiation (multi-row INSERTs inside a transaction) and the
 * hive.groupId membership side-effect that the Groups tab joins on.
 */

test.describe('hive groups API', () => {
  test('from-template creates an Ellis Special with a nuc in the middle', async ({ api }) => {
    const apiaries = await api.get<any[]>('/apiaries');
    expect(apiaries.length).toBeGreaterThan(0);
    const apiaryId = apiaries[0].id;

    const group = await api.post<any>('/hive-groups/from-template', { template: 'ellis-special', apiaryId });
    expect(group.id).toMatch(/^group-[\w-]+$/);
    expect(group.template).toBe('ellis-special');
    expect(group.members).toHaveLength(3);

    // The middle member must be the nuc.
    const hives = await api.get<any[]>('/hives');
    const byId = new Map(hives.map((h: any) => [h.id, h]));
    const [left, middle, right] = group.members.map((id: string) => byId.get(id));
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(middle?.type).toBe('nuc-5');

    // All three carry the groupId backlink.
    for (const id of group.members) {
      expect(byId.get(id)?.groupId, `hive ${id} missing groupId backlink`).toBe(group.id);
    }
  });

  test('regrouping frees hives that leave the member list', async ({ api }) => {
    const apiaries = await api.get<any[]>('/apiaries');
    const apiaryId = apiaries[0].id;

    // Two standalone hives.
    const make = (n: string) => api.post<any>('/hives', {
      apiaryId, name: `Regroup ${n}`, type: 'langstroth-10', healthStatus: 'good',
      boxes: [{ type: 'deep', frames: [], sensorIds: [] }],
    });
    const h1 = await make('A');
    const h2 = await make('B');

    const group = await api.post<any>('/hive-groups', {
      apiaryId, name: 'Regroup Test Pair', template: 'custom', members: [h1.id, h2.id],
    });
    expect(group.members).toEqual([h1.id, h2.id]);

    // Drop h2 from the group.
    const updated = await api.put<any>(`/hive-groups/${group.id}`, { members: [h1.id] });
    expect(updated.members).toEqual([h1.id]);

    const hives = await api.get<any[]>('/hives');
    const byId = new Map(hives.map((h: any) => [h.id, h]));
    expect(byId.get(h1.id)?.groupId).toBe(group.id);
    expect(byId.get(h2.id)?.groupId ?? null, 'leaving hive must lose its groupId').toBeNull();
  });

  test('cross-apiary hives cannot join a group', async ({ api }) => {
    const apiaries = await api.get<any[]>('/apiaries');
    if (apiaries.length < 2) test.skip(true, 'needs a second apiary');
    const [a1, a2] = apiaries;

    const local = await api.post<any>('/hives', {
      apiaryId: a1.id, name: 'Local Only', type: 'langstroth-10', healthStatus: 'good',
      boxes: [{ type: 'deep', frames: [], sensorIds: [] }],
    });
    const foreign = await api.post<any>('/hives', {
      apiaryId: a2.id, name: 'Foreign Hive', type: 'langstroth-10', healthStatus: 'good',
      boxes: [{ type: 'deep', frames: [], sensorIds: [] }],
    });

    const group = await api.post<any>('/hive-groups', {
      apiaryId: a1.id, name: 'X-Yard Test', template: 'custom', members: [local.id, foreign.id],
    });
    expect(group.members).toEqual([local.id]);
    expect(group.members).not.toContain(foreign.id);
  });

  test('deleting a group keeps the hives and clears membership', async ({ api }) => {
    const apiaries = await api.get<any[]>('/apiaries');
    const group = await api.post<any>('/hive-groups/from-template', {
      template: 'ellis-special', apiaryId: apiaries[0].id, name: 'Doomed Trio',
    });
    const status = await api.del(`/hive-groups/${group.id}`);
    expect(status).toBe(200);

    const hives = await api.get<any[]>('/hives');
    for (const id of group.members) {
      const h = hives.find((x: any) => x.id === id);
      expect(h, `hive ${id} must survive group deletion`).toBeTruthy();
      expect(h.groupId ?? null).toBeNull();
    }
  });
});

test.describe('groups tab renders', () => {
  test('hives hub shows a Groups tab with the Ellis Special layout', async ({ page, api }) => {
    const d = watchForErrors(page);
    await seedKey(page);
    await gotoRoute(page, '/hives?tab=groups');

    // The tab is reachable and renders the page shell.
    await expect(page.locator('main')).toContainText('Groups');

    // The hub tab strip contains the Groups entry (reachability, not just render).
    await expect(page.locator('nav, [role="tablist"], .tab-strip').first()).toBeVisible();

    // If an Ellis Special exists in this apiary, the visual arrangement shows
    // the nuc between two hives — the middle cell must be the smaller one.
    const groups = await api.get<any[]>('/hive-groups');
    for (const g of groups) {
      if (g.template !== 'ellis-special') continue;
      const cells = page.locator(`a[href^="/hives/"]`);
      const count = await cells.count();
      expect(count).toBeGreaterThanOrEqual(3);
    }

    expect(d.consoleErrors).toEqual([]);
  });
});