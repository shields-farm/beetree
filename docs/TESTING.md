# BeeTree Test Suite

Tests run via [Vitest](https://vitest.dev). Run with:

```bash
npm test          # run once
npm run test:watch # watch mode
npm run test:coverage  # with coverage
```

## Test Structure

```
src/lib/__tests__/       — frontend unit tests (pure functions, hooks)
server/__tests__/        — server unit tests (db, migrations, COW versioning)
```

## Writing Tests

Server tests that touch the DB should use an in-memory SQLite instance:

```typescript
import Database from 'better-sqlite3';
const db = new Database(':memory:');
```

Frontend tests for hooks/components should use `@testing-library/react` with the Vitest jsdom environment.