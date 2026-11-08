// server/okf.ts — read an Open Knowledge Format (OKF) v0.2 bundle.
//
// OKF replaced the legacy `server/ontology/beetree-vocab.yaml`. A bundle is a
// directory of markdown files; each file is one *concept* whose identity is its
// path, with a YAML frontmatter block of queryable fields and a markdown body of
// prose. Relationships are ordinary markdown links.
//
// This module is the reader: it walks the bundle, parses each concept, and
// rebuilds the object shapes the ontology consumers already expect (classes,
// relations, season windows, the five inference blocks, the threat catalog).
// It is deliberately schema-light — OKF requires only `type`, and a consumer must
// tolerate unknown fields, so nothing here throws on an unrecognised key.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
// @ts-ignore — js-yaml ships its own types
import * as yaml from 'js-yaml';

/** A parsed OKF concept document. */
export interface OkfConcept {
  /** Bundle-relative concept id — the file path with the `.md` suffix removed. */
  id: string;
  /** Parsed YAML frontmatter. */
  frontmatter: Record<string, any>;
  /** Everything after the frontmatter block. */
  body: string;
  /** Bundle-relative source path, including `.md`. */
  path: string;
}

/** Reserved filenames carry structure, not knowledge (OKF §3.1). */
const RESERVED = new Set(['index.md', 'log.md']);

/**
 * Split a document into frontmatter and body.
 * Returns frontmatter `null` when the block is missing or unterminated.
 */
export function parseConcept(text: string): { frontmatter: Record<string, any> | null; body: string } {
  if (!text.startsWith('---')) return { frontmatter: null, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: null, body: text };
  const raw = text.slice(3, end);
  let frontmatter: Record<string, any> | null = null;
  try {
    // js-yaml `load` uses DEFAULT_SCHEMA, which constructs only the standard
    // YAML scalar types (str/seq/map, int, float, bool, null, timestamp). It
    // cannot instantiate arbitrary JS objects or call functions — the unsafe
    // surface was js-yaml 3's full schema, which is not what this resolves to.
    frontmatter = (yaml.load(raw) as Record<string, any>) ?? {};
  } catch {
    frontmatter = null;
  }
  // Body starts after the closing delimiter line.
  const after = text.slice(end + 4);
  return { frontmatter, body: after.replace(/^\r?\n/, '') };
}

/** Recursively read every non-reserved `.md` file in a bundle. */
export function readBundle(root: string): OkfConcept[] {
  const out: OkfConcept[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.name.endsWith('.md') && !RESERVED.has(ent.name)) {
        const { frontmatter, body } = parseConcept(readFileSync(full, 'utf8'));
        if (!frontmatter || !frontmatter.type) continue; // not a conformant concept
        const id = relative(root, full).split(sep).join('/').replace(/\.md$/, '');
        out.push({ id, frontmatter, body, path: relative(root, full).split(sep).join('/') });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Split a markdown body into `# Heading` → text. */
export function sections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current !== null) out[current] = buf.join('\n').trim();
    buf.length = 0;
  };
  for (const line of body.split('\n')) {
    const m = /^#\s+(.*)$/.exec(line);
    if (m) {
      flush();
      current = m[1].trim();
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Concepts carrying a given `type`. */
export function ofType(concepts: OkfConcept[], type: string): OkfConcept[] {
  return concepts.filter((c) => c.frontmatter.type === type);
}

/**
 * Expand a bundle-relative markdown link into a concept id.
 * `/classes/hive.md` → `classes/hive`; `./x.md` → resolved against `from`.
 * Returns null for external URLs, anchors and directory links.
 */
export function linkTarget(href: string, from = ''): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null;
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || clean.endsWith('/')) return null;
  let p = clean.startsWith('/') ? clean.slice(1) : join(from, clean);
  p = p.replace(/\.md$/, '');
  return p.split(sep).join('/');
}

/** Every internal link in a body, as concept ids. */
export function outgoing(concept: OkfConcept): string[] {
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  const out: string[] = [];
  for (const m of concept.body.matchAll(re)) {
    const t = linkTarget(m[1], concept.id.split('/').slice(0, -1).join('/'));
    if (t) out.push(t);
  }
  return out;
}
