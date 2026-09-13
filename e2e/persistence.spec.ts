import { test, expect, seedKey, gotoRoute, type Api } from './fixtures';

/**
 * Persistence.
 *
 * The highest-value tests in this suite. `syncFromServer()` REPLACES client
 * state with server data, so any store mutator without an `apiFetch` call looks
 * like it saved and is destroyed on the next reload. Every check here writes
 * through the UI, then re-reads from the API — proving the data reached the
 * database rather than just React state.
 */

/** Reload and confirm the row still exists server-side. */
async function reloadAndRecheck(page: import('@playwright/test').Page, api: Api, path: string) {
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  return api.get<any[]>(path);
}

test.describe('tasks persist through the API', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  test('creating a task via the UI reaches the database', async ({ page, api }) => {
    const before = await api.get<any[]>('/tasks');
    const title = `e2e-task-${Date.now()}`;

    await gotoRoute(page, '/tasks');
    await page.getByTitle('Add task').click();
    await page.getByPlaceholder('Task title').fill(title);
    await page.getByRole('button', { name: 'Add Task', exact: true }).click();

    // Visible immediately…
    await expect(page.getByText(title)).toBeVisible();

    // …and present after a reload, which is what the missing apiFetch broke.
    const after = await reloadAndRecheck(page, api, '/tasks');
    expect(after.some((t) => t.title === title), `"${title}" not persisted`).toBeTruthy();

    // Cleanup
    const created = after.find((t) => t.title === title);
    if (created) expect(await api.del(`/tasks/${created.id}`)).toBe(200);
    expect((await api.get<any[]>('/tasks')).length).toBe(before.length);
  });

  test('completing a task persists and does not blank its other fields', async ({ page, api }) => {
    // Two bugs in one flow: toggleTask had no apiFetch, and PUT /api/tasks/:id
    // used `b.title ?? ''`, so the partial { completed: true } body wiped the
    // title, description, due date, priority and hive.
    const title = `e2e-toggle-${Date.now()}`;
    const created = await api.post<any>('/tasks', {
      title, description: 'keep me', priority: 'high', completed: false,
    });

    await gotoRoute(page, '/tasks');
    // The card is the nearest ancestor div that contains both the title and a
    // checkbox button; scope to it so we don't hit the page-level "+" button.
    const card = page
      .locator('div.rounded-xl, div.rounded-2xl')
      .filter({ hasText: title })
      .filter({ has: page.locator('button') })
      .last();
    await expect(card).toBeVisible();
    await card.locator('button').first().click();

    const reread = await api.get<any>(`/tasks/${created.id}`);
    expect(reread.completed, 'toggle did not persist').toBe(true);
    expect(reread.title, 'title was blanked by a partial PUT').toBe(title);
    expect(reread.description, 'description was blanked').toBe('keep me');
    expect(reread.priority, 'priority was blanked').toBe('high');

    expect(await api.del(`/tasks/${created.id}`)).toBe(200);
  });

  test('deleting a task persists', async ({ page, api }) => {
    const created = await api.post<any>('/tasks', { title: `e2e-del-${Date.now()}`, completed: false });

    await gotoRoute(page, '/tasks');
    page.once('dialog', (d) => d.accept());
    const card = page
      .locator('div.rounded-xl, div.rounded-2xl')
      .filter({ hasText: created.title })
      .filter({ has: page.locator('button') })
      .last();
    await card.locator('button').last().click();

    await expect
      .poll(async () => (await api.get<any[]>('/tasks')).some((t) => t.id === created.id))
      .toBe(false);
  });
});

test.describe('inspections persist through the API', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  test('POST /api/inspections accepts a full payload', async ({ api }) => {
    // This endpoint shipped with 23 columns / 24 placeholders / 19 bound values,
    // so creating an inspection had never worked: "24 values for 23 columns".
    const hives = await api.get<any[]>('/hives');
    expect(hives.length).toBeGreaterThan(0);

    const created = await api.post<any>('/inspections', {
      hiveId: hives[0].id,
      date: new Date().toISOString(),
      queenPresent: true, queenCells: false, queenLayingPattern: 'good',
      eggsPresent: true, larvaePresent: true, cappedBrood: true,
      temperament: 'calm', honeyStores: 'medium', pollenStores: 'medium',
      populationSize: 'large', healthStatus: 'good',
      healthAutoCalculated: true, colonyDead: false,
      notes: 'e2e inspection', photoUrls: [], hiveWeight: 95,
    });

    expect(created.id).toBeTruthy();
    const reread = await api.get<any[]>(`/hives/${hives[0].id}/inspections`);
    expect(reread.some((i) => i.id === created.id)).toBeTruthy();

    expect(await api.del(`/inspections/${created.id}`)).toBe(200);
  });

  test('a partial inspection PUT preserves untouched fields', async ({ api }) => {
    const hives = await api.get<any[]>('/hives');
    const created = await api.post<any>('/inspections', {
      hiveId: hives[0].id, date: new Date().toISOString(),
      queenPresent: true, notes: 'keep this note', populationSize: 'large',
      honeyStores: 'high', photoUrls: [],
    });

    await api.put(`/inspections/${created.id}`, { notes: 'updated note' });

    const reread = await api.get<any>(`/inspections/${created.id}`);
    expect(reread.notes).toBe('updated note');
    expect(reread.queenPresent, 'queenPresent blanked by partial PUT').toBe(true);
    expect(reread.populationSize, 'populationSize blanked').toBe('large');
    expect(reread.honeyStores, 'honeyStores blanked').toBe('high');

    expect(await api.del(`/inspections/${created.id}`)).toBe(200);
  });

  test('inspection history survives a page reload', async ({ page, api }) => {
    const hives = await api.get<any[]>('/hives');
    const before = await api.get<any[]>('/inspections');

    await gotoRoute(page, '/inspections');
    // Poll: the hub is a lazy route chunk, and asserting straight after
    // navigation reads <main> before React has mounted it.
    await expect
      .poll(async () => (await page.locator('main').innerText()).trim().length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator('main')).toBeVisible();
    const after = await api.get<any[]>('/inspections');
    expect(after.length).toBe(before.length);
    expect(hives.length).toBeGreaterThan(0);
  });
});

test.describe('hive box edits persist', () => {
  test.beforeEach(async ({ page }) => { await seedKey(page); });

  test('setting box content survives a PUT round-trip', async ({ api }) => {
    // Box/frame edits had no server call at all; they were rebuilt from server
    // data on the next sync, silently discarding every change.
    const hives = await api.get<any[]>('/hives');
    const hive = hives.find((h) => h.boxes?.length);
    test.skip(!hive, 'no hive with boxes');

    const original = structuredClone(hive.boxes);
    const mutated = structuredClone(hive.boxes);
    mutated[0].content = mutated[0].content === 'brood' ? 'honey' : 'brood';

    const updated = await api.put<any>(`/hives/${hive.id}`, { boxes: mutated });
    expect(updated.boxes[0].content).toBe(mutated[0].content);

    const reread = await api.get<any>(`/hives/${hive.id}`);
    expect(reread.boxes[0].content, 'box content did not persist').toBe(mutated[0].content);

    // Restore
    await api.put(`/hives/${hive.id}`, { boxes: original });
    const restored = await api.get<any>(`/hives/${hive.id}`);
    expect(restored.boxes[0].content).toBe(original[0].content);
  });

  test('adding a box through the UI reaches the server', async ({ page, api }) => {
    const hives = await api.get<any[]>('/hives');
    // Only multi-box hive types render "Add Box / Super" — the others are
    // singleBox (long hive, nuc, apimaye, queen castle) and hide it by design.
    const hive = hives.find((h) => h.type === 'langstroth-10' || h.type === 'langstroth-8');
    test.skip(!hive, 'no multi-box hive available');

    const before = await api.get<any>(`/hives/${hive.id}`);
    const beforeCount = before.boxes.length;
    const originalBoxes = before.boxes;

    await gotoRoute(page, `/hives/${hive.id}?tab=configure`);
    // The Configure tab is hash-driven; wait for its content rather than
    // clicking a tab we're already on.
    const editFrames = page.getByText('Edit frames');
    await expect(editFrames).toBeVisible({ timeout: 15_000 });
    await editFrames.click();
    await page.getByText('Add Box / Super').click();

    await expect
      .poll(async () => (await api.get<any>(`/hives/${hive.id}`)).boxes.length)
      .toBeGreaterThan(beforeCount);

    // Restore original box set
    await api.put(`/hives/${hive.id}`, { boxes: originalBoxes });
  });
});

test.describe('sensors are not wiped by partial updates', () => {
  test('PUT /api/sensors/:id preserves identity fields', async ({ api }) => {
    // The documented version of this bug: assigning a sensor sent only
    // {hiveId, boxId, position} and the COW callback used `?? ''`, blanking
    // deviceId / name / model.
    const sensors = await api.get<any[]>('/sensors');
    test.skip(sensors.length === 0, 'no sensors');
    const s = sensors[0];

    await api.put(`/sensors/${s.id}`, { position: s.position ?? 'top' });

    const reread = await api.get<any>(`/sensors/${s.id}`);
    expect(reread.deviceId, 'deviceId blanked').toBe(s.deviceId);
    expect(reread.name, 'name blanked').toBe(s.name);
    expect(reread.model, 'model blanked').toBe(s.model);
  });
});
