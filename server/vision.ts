// server/vision.ts — Frame photo → structured analysis via synthetic.new vision API
// Uses an OpenAI-compatible vision endpoint to analyze hive frame photos.

const VISION_URL = 'https://api.synthetic.new/openai/v1/chat/completions';
const VISION_MODEL = 'syn:large:vision';

/** Structured result of analyzing a frame photo. */
export interface FrameAnalysisDisease {
  type: string;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

export interface FrameAnalysisPest {
  type: string;
  count?: number;
  note: string;
}

export interface FrameAnalysisConcern {
  type: string;
  note: string;
}

export interface FrameAnalysis {
  broodPattern: 'solid' | 'spotty' | 'patchy' | 'none' | 'unknown';
  queenSpotted: boolean;
  queenLocation: string;
  broodRatio: number; // 0-1
  honeyRatio: number; // 0-1
  pollenRatio: number; // 0-1
  cappedBroodPresent: boolean;
  eggsVisible: boolean;
  larvaeVisible: boolean;
  diseases: FrameAnalysisDisease[];
  pests: FrameAnalysisPest[];
  overallAssessment: string;
  recommendations: string[];
  concerns: FrameAnalysisConcern[];
}

const SYSTEM_PROMPT = [
  'You are a UGA Master Craftsman Beekeeper with decades of experience inspecting honey bee colonies.',
  'You are analyzing a photograph of a single hive frame pulled from a Langstroth (or similar) hive.',
  'Examine the photo carefully and identify brood patterns, queen presence, diseases, pests, and the ratio of brood/honey/pollen coverage.',
  '',
  'Return ONLY a JSON object (no markdown fences, no explanation) with exactly these fields:',
  '{',
  '  "broodPattern": "solid" | "spotty" | "patchy" | "none" | "unknown",',
  '  "queenSpotted": boolean,',
  '  "queenLocation": string (e.g. "lower left quadrant" or "not visible"),',
  '  "broodRatio": number (0-1, fraction of frame area covered by brood),',
  '  "honeyRatio": number (0-1),',
  '  "pollenRatio": number (0-1),',
  '  "cappedBroodPresent": boolean,',
  '  "eggsVisible": boolean,',
  '  "larvaeVisible": boolean,',
  '  "diseases": [{ "type": string, "confidence": "high"|"medium"|"low", "note": string }],',
  '  "pests": [{ "type": string, "count"?: number, "note": string }],',
  '  "overallAssessment": string (1-2 sentence summary),',
  '  "recommendations": string[] (actionable next steps),',
  '  "concerns": [{ "type": string, "note": string }]',
  '}',
  '',
  'Guidelines:',
  '- A "solid" brood pattern means compact, contiguous capped brood with few gaps — a healthy laying queen.',
  '- "spotty" means many skipped cells interspersed — may indicate queen problems, brood disease, or chilled brood.',
  '- "patchy" is between solid and spotty — uneven but not alarming.',
  '- "none" means no brood visible on this frame.',
  '- "unknown" if you cannot tell from the photo quality.',
  '- For diseases consider: chalkbrood, sacbrood, American Foulbrood (AFB), European Foulbrood (EFB), Nosema, deformed wing virus (DWV).',
  '- For pests consider: Varroa mites (visible on bee bodies), small hive beetles (SHB), wax moth larvae, ants.',
  '- Only report diseases/pests you can reasonably identify from the photo. Use "low" confidence when unsure.',
  '- If the queen is visible, describe her location on the frame.',
  '- Ratios should sum to <= 1.0; estimate visually.',
  '- recommendations should be specific and actionable (e.g. "Test for Varroa with an alcohol wash next inspection").',
  '- If the photo is not of a bee frame, return broodPattern "unknown", queenSpotted false, empty arrays, and a note in overallAssessment.',
].join('\n');

/** Extract the first JSON object from a possibly fence-wrapped string. */
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

/** Normalize an image input into a base64 data URL suitable for the vision API. */
function normalizeImageDataUrl(imageBase64: string): string {
  const trimmed = imageBase64.trim();
  if (trimmed.startsWith('data:')) return trimmed;
  // Raw base64 — assume JPEG (most common from cameras/uploads).
  return 'data:image/jpeg;base64,' + trimmed;
}

/** Coerce a possibly-missing or mistyped field to a sane default. */
function safeAnalysis(raw: any): FrameAnalysis {
  const arr = (v: any): any[] => (Array.isArray(v) ? v : []);
  const num01 = (v: any): number => {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  };
  const conf = (v: any): 'high' | 'medium' | 'low' => {
    if (v === 'high' || v === 'medium' || v === 'low') return v;
    return 'low';
  };
  const pattern = (v: any): FrameAnalysis['broodPattern'] => {
    if (v === 'solid' || v === 'spotty' || v === 'patchy' || v === 'none' || v === 'unknown') return v;
    return 'unknown';
  };
  return {
    broodPattern: pattern(raw?.broodPattern),
    queenSpotted: Boolean(raw?.queenSpotted),
    queenLocation: typeof raw?.queenLocation === 'string' ? raw.queenLocation : 'not visible',
    broodRatio: num01(raw?.broodRatio),
    honeyRatio: num01(raw?.honeyRatio),
    pollenRatio: num01(raw?.pollenRatio),
    cappedBroodPresent: Boolean(raw?.cappedBroodPresent),
    eggsVisible: Boolean(raw?.eggsVisible),
    larvaeVisible: Boolean(raw?.larvaeVisible),
    diseases: arr(raw?.diseases).map((d: any) => ({
      type: String(d?.type ?? 'unknown'),
      confidence: conf(d?.confidence),
      note: String(d?.note ?? ''),
    })),
    pests: arr(raw?.pests).map((p: any) => ({
      type: String(p?.type ?? 'unknown'),
      count: typeof p?.count === 'number' ? p.count : undefined,
      note: String(p?.note ?? ''),
    })),
    overallAssessment: String(raw?.overallAssessment ?? 'No assessment available.'),
    recommendations: arr(raw?.recommendations).map((r: any) => String(r)),
    concerns: arr(raw?.concerns).map((c: any) => ({
      type: String(c?.type ?? 'unknown'),
      note: String(c?.note ?? ''),
    })),
  };
}

/**
 * Send a base64-encoded JPEG frame photo to the vision API and get back
 * a structured FrameAnalysis.
 */
export async function analyzeFramePhoto(
  imageBase64: string,
  hiveName?: string,
): Promise<FrameAnalysis> {
  const apiKey = process.env.SYNTHETIC_NEW_API_KEY;
  if (!apiKey) {
    throw new Error('SYNTHETIC_NEW_API_KEY environment variable is not set. Cannot call vision API.');
  }

  const dataUrl = normalizeImageDataUrl(imageBase64);
  const userText = hiveName
    ? 'Analyze this frame photo from hive "' + hiveName + '". Return ONLY the JSON analysis.'
    : 'Analyze this frame photo. Return ONLY the JSON analysis.';

  const body = {
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    stream: false,
    temperature: 0.2,
  };

  const authHeader = 'Bearer ' + apiKey;
  let resp: Response;
  try {
    resp = await fetch(VISION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Vision API request failed: ' + (e instanceof Error ? e.message : String(e)));
  }

  if (resp.status === 429) {
    const retryAfter = resp.headers.get('retry-after');
    const msg = retryAfter
      ? 'Vision API rate limit reached (429). Try again in ' + retryAfter + ' seconds.'
      : 'Vision API rate limit reached (429). Please wait a moment and try again.';
    throw new Error(msg);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error('Vision API authentication failed (' + resp.status + '). Check SYNTHETIC_NEW_API_KEY.');
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('Vision API ' + resp.status + ': ' + txt.slice(0, 300));
  }

  const data = await resp.json() as any;
  const content: string = data.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new Error('Vision API returned empty content.');
  }

  const jsonStr = extractJson(content);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Vision API returned non-JSON: ' + content.slice(0, 300));
  }

  return safeAnalysis(parsed);
}
