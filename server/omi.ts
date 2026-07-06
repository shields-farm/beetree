// server/omi.ts — Omi voice transcript → structured inspection parser
// Uses Ollama (glm-5.2:cloud) directly with the Buzz beekeeper system prompt.

const BUZZ_URL = 'http://localhost:11434/v1/chat/completions';
const BUZZ_MODEL = 'glm-5.2:cloud';
// No API key needed — Ollama runs locally

/** Fields Buzz may return (all optional — omit what can't be determined). */
export interface ParsedInspection {
  hiveName?: string;
  hiveId?: string; // matched on the server side
  queenPresent?: boolean;
  queenCells?: boolean;
  queenLayingPattern?: 'excellent' | 'good' | 'fair' | 'poor' | 'none';
  eggsPresent?: boolean;
  larvaePresent?: boolean;
  cappedBrood?: boolean;
  temperament?: 'very-calm' | 'calm' | 'normal' | 'agitated' | 'aggressive';
  honeyStores?: 'none' | 'low' | 'medium' | 'high';
  pollenStores?: 'none' | 'low' | 'medium' | 'high';
  populationSize?: 'none' | 'small' | 'average' | 'large';
  concerns?: { type: string; count?: number; note?: string }[];
  notes?: string;
}

export interface KnownHive {
  id: string;
  name: string;
}

/**
 * Send a raw Omi transcript to Buzz and get back a partial inspection object.
 * Matches the returned `hiveName` to a known hive ID when possible.
 */
export async function parseTranscriptToInspection(
  transcript: string,
  hives: KnownHive[],
): Promise<ParsedInspection> {
  const hiveNames = hives.map((h) => h.name).join(', ');

  const systemPrompt = `You are Buzz, a UGA Master Craftsman Beekeeper. The user just finished a hive inspection while wearing an Omi voice recorder. Parse their spoken observations into a structured inspection.

Return ONLY a JSON object with these fields (omit fields you can't determine from the transcript):
- hiveName: string (match to one of the known hives if possible)
- queenPresent: boolean
- queenCells: boolean
- queenLayingPattern: "excellent" | "good" | "fair" | "poor" | "none"
- eggsPresent: boolean
- larvaePresent: boolean
- cappedBrood: boolean
- temperament: "very-calm" | "calm" | "normal" | "agitated" | "aggressive"
- honeyStores: "none" | "low" | "medium" | "high"
- pollenStores: "none" | "low" | "medium" | "high"
- populationSize: "none" | "small" | "average" | "large"
- concerns: array of {type: string, count?: number, note?: string}
- notes: string (any other observations not captured above)

Known hives: ${hiveNames}

Transcript: "${transcript.replace(/"/g, '\\"')}"

Return ONLY the JSON, no markdown, no explanation.`;

  const body = {
    model: BUZZ_MODEL,
    messages: [
      { role: 'system', content: 'You are Buzz, a UGA Master Craftsman Beekeeper with decades of experience. You are helpful, concise, and practical. You know Georgia beekeeping, seasonal management, and Integrated Pest Management.' },
      { role: 'user', content: systemPrompt }
    ],
    stream: false,
    temperature: 0.2,
  };

  const resp = await fetch(BUZZ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('Buzz API ' + resp.status + ': ' + txt.slice(0, 200));
  }

  const data = await resp.json() as any;
  const content: string = data.choices?.[0]?.message?.content ?? '';

  // Buzz may wrap JSON in markdown fences despite instructions — strip them.
  const jsonStr = extractJson(content);
  let parsed: ParsedInspection;
  try {
    parsed = JSON.parse(jsonStr) as ParsedInspection;
  } catch (e) {
    throw new Error(`Buzz returned non-JSON: ${content.slice(0, 300)}`);
  }

  // Match hiveName → hiveId
  if (parsed.hiveName && hives.length > 0) {
    const match = matchHiveByName(parsed.hiveName, hives);
    if (match) parsed.hiveId = match.id;
  }

  return parsed;
}

/**
 * Send free-text inspection notes to Buzz and get back a partial inspection
 * object. Same as parseTranscriptToInspection but with a prompt tuned for typed
 * notes rather than spoken voice transcripts.
 */
export async function parseFreeTextToInspection(
  text: string,
  hives: KnownHive[],
): Promise<ParsedInspection> {
  const hiveNames = hives.map((h) => h.name).join(', ');

  const systemPrompt = 'You are Buzz, a UGA Master Craftsman Beekeeper. The user typed brief notes about a hive inspection. Parse their typed observations into a structured inspection.\n\n' +
    'Return ONLY a JSON object with these fields (omit fields you can\'t determine from the notes):\n' +
    '- hiveName: string (match to one of the known hives if possible)\n' +
    '- queenPresent: boolean\n' +
    '- queenCells: boolean\n' +
    '- queenLayingPattern: "excellent" | "good" | "fair" | "poor" | "none"\n' +
    '- eggsPresent: boolean\n' +
    '- larvaePresent: boolean\n' +
    '- cappedBrood: boolean\n' +
    '- temperament: "very-calm" | "calm" | "normal" | "agitated" | "aggressive"\n' +
    '- honeyStores: "none" | "low" | "medium" | "high"\n' +
    '- pollenStores: "none" | "low" | "medium" | "high"\n' +
    '- populationSize: "none" | "small" | "average" | "large"\n' +
    '- concerns: array of {type: string, count?: number, note?: string}\n' +
    '- notes: string (any other observations not captured above)\n\n' +
    'Known hives: ' + hiveNames + '\n\n' +
    'Notes: "' + text.replace(/"/g, '\\"') + '"\n\n' +
    'Return ONLY the JSON, no markdown, no explanation.';

  const body = {
    model: BUZZ_MODEL,
    messages: [
      { role: 'system', content: 'You are Buzz, a UGA Master Craftsman Beekeeper with decades of experience. You are helpful, concise, and practical. You know Georgia beekeeping, seasonal management, and Integrated Pest Management.' },
      { role: 'user', content: systemPrompt }
    ],
    stream: false,
    temperature: 0.2,
  };

  const resp = await fetch(BUZZ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('Buzz API ' + resp.status + ': ' + txt.slice(0, 200));
  }

  const data = await resp.json() as any;
  const content: string = data.choices?.[0]?.message?.content ?? '';

  // Buzz may wrap JSON in markdown fences despite instructions — strip them.
  const jsonStr = extractJson(content);
  let parsed: ParsedInspection;
  try {
    parsed = JSON.parse(jsonStr) as ParsedInspection;
  } catch (e) {
    throw new Error('Buzz returned non-JSON: ' + content.slice(0, 300));
  }

  // Match hiveName → hiveId
  if (parsed.hiveName && hives.length > 0) {
    const match = matchHiveByName(parsed.hiveName, hives);
    if (match) parsed.hiveId = match.id;
  }

  return parsed;
}

/** Try to find the best hive match by name (case-insensitive, substring-aware). */
export function matchHiveByName(name: string, hives: KnownHive[]): KnownHive | undefined {
  const lower = name.toLowerCase().trim();
  // Exact
  let m = hives.find((h) => h.name.toLowerCase() === lower);
  if (m) return m;
  // Starts-with
  m = hives.find((h) => h.name.toLowerCase().startsWith(lower));
  if (m) return m;
  // Contains
  m = hives.find((h) => h.name.toLowerCase().includes(lower));
  if (m) return m;
  // Reverse contains (hive name inside spoken name)
  m = hives.find((h) => lower.includes(h.name.toLowerCase()));
  return m;
}

/** Extract the first JSON object from a possibly fence-wrapped string. */
function extractJson(content: string): string {
  const trimmed = content.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  // Find first { ... last }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Health calculation (reimplemented server-side — mirrors src/lib/health.ts)
// ---------------------------------------------------------------------------
type HealthStatus = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

const STORE_VAL: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };
const POP_VAL: Record<string, number> = { none: 0, small: 1, average: 2, large: 3 };
const TEMP_PENALTY: Record<string, number> = {
  'very-calm': 0, calm: 0, normal: 0, agitated: 1, aggressive: 2,
};
const RANK: Record<HealthStatus, number> = {
  critical: 0, poor: 1, fair: 2, good: 3, excellent: 4,
};

export function calculateHealth(i: {
  queenPresent?: boolean;
  queenCells?: boolean;
  queenLayingPattern?: string;
  eggsPresent?: boolean;
  larvaePresent?: boolean;
  cappedBrood?: boolean;
  temperament?: string;
  honeyStores?: string;
  pollenStores?: string;
  populationSize?: string;
  concerns?: any[];
  colonyDead?: boolean;
}): HealthStatus {
  if (i.colonyDead) return 'critical';

  let score = 3;
  const goodLaying = i.queenLayingPattern === 'excellent' || i.queenLayingPattern === 'good';

  if (i.queenPresent) score += 0.5;
  if (goodLaying) score += 0.5;
  if (i.eggsPresent) score += 0.5;
  if (i.larvaePresent) score += 0.5;
  if (i.cappedBrood) score += 0.5;
  if (STORE_VAL[i.honeyStores ?? 'none'] >= 2) score += 0.5;
  if (STORE_VAL[i.pollenStores ?? 'none'] >= 2) score += 0.5;
  if (POP_VAL[i.populationSize ?? 'none'] >= 2) score += 0.5;

  if (!i.queenPresent) score -= 1;
  if (i.queenLayingPattern === 'poor' || i.queenLayingPattern === 'none') score -= 0.5;
  if (!i.eggsPresent) score -= 0.5;
  if (!i.larvaePresent) score -= 0.5;
  if (!i.cappedBrood) score -= 0.5;
  if (STORE_VAL[i.honeyStores ?? 'none'] === 0) score -= 0.5;
  if (STORE_VAL[i.pollenStores ?? 'none'] === 0) score -= 0.5;
  if (POP_VAL[i.populationSize ?? 'none'] === 0) score -= 0.5;
  if (i.queenCells) score -= 0.5;
  score -= TEMP_PENALTY[i.temperament ?? 'normal'] ?? 0;

  const concernCount = i.concerns?.length ?? 0;
  if (concernCount > 0) score -= Math.min(concernCount * 0.25, 1.5);

  score = Math.max(0, Math.min(4, score));
  const rounded = Math.round(score);
  return (Object.keys(RANK).find((k) => RANK[k as HealthStatus] === rounded) ?? 'good') as HealthStatus;
}

// ---------------------------------------------------------------------------
// Transcript file reader — reads ~/.hermes/memories/omi-transcripts/*.md
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TRANSCRIPTS_DIR = join(homedir(), '.hermes', 'memories', 'omi-transcripts');

const BEE_KEYWORDS = ['hive', 'queen', 'brood', 'varroa', 'bees', 'honey', 'comb', 'frame', 'pollen', 'nectar', 'shb', 'beetle', 'moth', 'swarm', 'nuc', 'apiary'];

export interface TranscriptSummary {
  date: string; // YYYY-MM-DD (filename)
  preview: string;
  hasBeeContent: boolean;
}

/**
 * Read recent transcript markdown files and return summaries.
 * Only returns files that contain actual transcript text (filters out noise).
 */
export function listRecentTranscripts(limit = 30): TranscriptSummary[] {
  if (!existsSync(TRANSCRIPTS_DIR)) return [];

  let files: string[];
  try {
    files = readdirSync(TRANSCRIPTS_DIR).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  // Sort newest first by filename (YYYY-MM-DD.md sorts chronologically)
  files.sort((a, b) => b.localeCompare(a));

  const results: TranscriptSummary[] = [];
  for (const file of files.slice(0, limit)) {
    const date = file.replace(/\.md$/, '');
    let raw: string;
    try {
      raw = readFileSync(join(TRANSCRIPTS_DIR, file), 'utf-8');
    } catch {
      continue;
    }

    const extracted = extractTranscriptText(raw);
    if (!extracted.text) continue;

    const lower = extracted.text.toLowerCase();
    const hasBeeContent = BEE_KEYWORDS.some((kw) => lower.includes(kw));

    results.push({
      date,
      preview: extracted.text.slice(0, 160),
      hasBeeContent,
    });
  }

  return results;
}

/**
 * Read a single transcript file by date and return its full text content.
 */
export function readTranscriptByDate(date: string): string | null {
  const path = join(TRANSCRIPTS_DIR, `${date}.md`);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  return extractTranscriptText(raw).text;
}

/**
 * Parse the Omi markdown format and extract user-spoken text.
 *
 * The file is a series of `## conversation_event — <timestamp>` sections
 * separated by `---`. Each section body is either:
 *   - plain text (noise like "(dog barking)"), or
 *   - a JSON blob with `transcript_segments[].text` and `is_user`.
 *
 * We extract text from segments where `is_user` is true, falling back to
 * all segment text if no user-flagged segments exist.
 */
function extractTranscriptText(raw: string): { text: string } {
  const sections = raw.split(/^---$/m);
  const userTexts: string[] = [];
  const allTexts: string[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || !trimmed.startsWith('## conversation_event')) continue;

    // Body = everything after the header line
    const headerEnd = trimmed.indexOf('\n');
    if (headerEnd === -1) continue;
    const body = trimmed.slice(headerEnd + 1).trim();

    if (!body) continue;

    // Try to parse as JSON
    if (body.startsWith('{')) {
      try {
        const obj = JSON.parse(body);
        const segments: any[] = obj.transcript_segments ?? [];
        for (const seg of segments) {
          const text: string = (seg.text ?? '').trim();
          if (!text) continue;
          allTexts.push(text);
          if (seg.is_user === true) {
            userTexts.push(text);
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    } else {
      // Plain text section — usually noise like "(dog barking)"
      // Only include if it has real words (not just parenthetical noise)
      const cleaned = body
        .replace(/^\(.*?\)\s*$/gm, '')
        .replace(/\[BLANK_AUDIO\]/g, '')
        .trim();
      if (cleaned && cleaned.split(/\s+/).length >= 3) {
        allTexts.push(cleaned);
      }
    }
  }

  const text = (userTexts.length > 0 ? userTexts : allTexts).join(' ').trim();
  return { text };
}