// server/varroa.ts — Varroa sticky board image analysis via Ollama vision API
// Uses kimi-k2.7-code:cloud on local Ollama for vision-capable inference.

const VISION_URL = 'http://localhost:11434/v1/chat/completions';
const VISION_MODEL = 'kimi-k2.7-code:cloud';

export interface VarroaCount {
  miteCount: number;
  confidence: 'high' | 'medium' | 'low';
  boardArea: string; // description of visible board area
  otherDebris: string; // description of other things visible (bees, pollen, wax scales)
  infestationLevel: 'low' | 'moderate' | 'high' | 'severe';
  recommendation: string;
  naturalDropPerDay: number; // estimated
}

/** Classify infestation level from a raw mite count. */
export function classifyInfestation(miteCount: number): VarroaCount['infestationLevel'] {
  if (miteCount < 3) return 'low';
  if (miteCount <= 10) return 'moderate';
  if (miteCount <= 30) return 'high';
  return 'severe';
}

/** Build a recommendation string based on infestation level + drop rate. */
function buildRecommendation(level: VarroaCount['infestationLevel'], dropPerDay: number): string {
  switch (level) {
    case 'low':
      return dropPerDay < 1
        ? 'Mite levels are low. Continue routine monitoring monthly. No treatment needed at this time.'
        : 'Mite levels are low but detectable. Re-check in 2-3 weeks to confirm the trend is stable.';
    case 'moderate':
      return 'Moderate mite drop detected. Consider a mite wash (alcohol or sugar shake) to get a precise percentage. Plan a treatment if levels rise above 10 per day.';
    case 'high':
      return 'High mite pressure. Perform an alcohol wash to confirm infestation rate. A treatment (e.g., formic acid, oxalic acid, or thymol) is recommended this season.';
    case 'severe':
      return 'Severe infestation. Treat immediately — the colony is at risk of collapse from virus complex (DWV). Use an approved miticide and re-test 2 weeks after treatment completion.';
  }
}

/**
 * Send a base64 sticky-board image to the Synthetic.new vision model and
 * parse the returned JSON into a VarroaCount.
 */
export async function analyzeStickyBoard(imageBase64: string): Promise<VarroaCount> {
  // Ensure the image is a data URL the vision API accepts.
  const dataUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : 'data:image/jpeg;base64,' + imageBase64.replace(/^,+/, '');

  const systemPrompt = [
    'You are an expert beekeeper and entomologist specializing in Varroa destructor detection.',
    'The user has uploaded a photo of a varroa sticky board (the removable bottom tray of a Langstroth hive,',
    'left under a screened bottom board for 24-72 hours to catch falling mites).',
    '',
    'Your job: count the number of varroa mites visible on the board.',
    '',
    'Varroa mites on a sticky board appear as small (1-1.5mm) reddish-brown or dark-brown oval/elliptical',
    'specks, often slightly glossy. They are distinctly different from:',
    '  - pollen grains (yellow/orange, round, often in clusters)',
    '  - wax scales (white/translucent flakes)',
    '  - bee parts (larger, fuzzy, striped)',
    '  - hive debris (wood shavings, propolis spots)',
    '',
    'Be careful and conservative. Only count objects you are confident are mites.',
    '',
    'Return ONLY a JSON object (no markdown, no explanation) with these fields:',
    '  miteCount: integer (your best count of varroa mites visible)',
    '  confidence: "high" | "medium" | "low" (how confident you are in the count)',
    '  boardArea: string (one-line description of how much of the board is visible and its condition)',
    '  otherDebris: string (one-line description of other visible material — bees, pollen, wax, etc.)',
    '  naturalDropPerDay: number (your estimate of the 24-hour natural mite drop,',
    '    accounting for how long the board appears to have been in place)',
  ].join('\n');

  const body = {
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: systemPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    stream: false,
    temperature: 0.1,
  };

  const resp = await fetch(VISION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('Vision API ' + resp.status + ': ' + txt.slice(0, 300));
  }

  const data = (await resp.json()) as any;
  const content: string = data.choices?.[0]?.message?.content ?? '';

  const jsonStr = extractJson(content);
  let parsed: Partial<VarroaCount>;
  try {
    parsed = JSON.parse(jsonStr) as Partial<VarroaCount>;
  } catch {
    throw new Error('Vision API returned non-JSON: ' + content.slice(0, 300));
  }

  const miteCount = clampInt(parsed.miteCount, 0, 100000);
  const dropPerDay =
    typeof parsed.naturalDropPerDay === 'number' && parsed.naturalDropPerDay >= 0
      ? Math.round(parsed.naturalDropPerDay * 10) / 10
      : miteCount; // fallback: assume the count itself is ~1 day of drop

  const infestationLevel = classifyInfestation(miteCount);
  const confidence = normalizeConfidence(parsed.confidence);

  return {
    miteCount,
    confidence,
    boardArea: typeof parsed.boardArea === 'string' ? parsed.boardArea : 'Not described',
    otherDebris: typeof parsed.otherDebris === 'string' ? parsed.otherDebris : 'Not described',
    infestationLevel,
    recommendation: buildRecommendation(infestationLevel, dropPerDay),
    naturalDropPerDay: dropPerDay,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeConfidence(v: unknown): VarroaCount['confidence'] {
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return 'medium';
}