// server/acoustics.ts — Hive acoustics analysis via Buzz text API + heuristics

const BUZZ_URL = 'http://192.0.2.20:8643/v1/chat/completions';
const BUZZ_KEY = 'dev-beetree-api-key-replace-me';
const BUZZ_MODEL = 'beetree';

export interface AcousticAnalysis {
  hiveId: string;
  interpretation: 'queenright' | 'queenless' | 'swarm-preparation' | 'stressed' | 'normal' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  frequency: string; // description of dominant frequency
  pattern: string; // description of audio pattern
  notes: string;
  recommendations: string[];
}

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

/**
 * Heuristic analysis when no description is provided. Attempts to infer from
 * audio duration and a crude base64 length proxy for amplitude. This is a
 * fallback only — the Buzz-powered interpretation is preferred.
 */
function heuristicAnalysis(hiveId: string, audio?: string, duration?: number): AcousticAnalysis {
  // Use base64 length as a very rough amplitude proxy. Longer audio / larger
  // payload implies more sustained sound. We can't really do frequency analysis
  // without decoding, so we report "unknown" interpretation with low confidence.
  const audioLen = audio ? audio.length : 0;
  const dur = duration ?? 0;

  let frequency = 'unknown (raw audio not decoded)';
  let pattern = 'no description provided';
  if (audioLen > 0 && dur > 0) {
    const bytesPerSec = audioLen / dur;
    if (bytesPerSec > 8000) {
      pattern = 'Sustained loud buzzing detected (high amplitude)';
    } else if (bytesPerSec > 3000) {
      pattern = 'Moderate buzzing detected';
    } else {
      pattern = 'Quiet or intermittent sound detected';
    }
  }

  return {
    hiveId,
    interpretation: 'unknown',
    confidence: 'low',
    frequency,
    pattern,
    notes: 'Heuristic analysis only — provide a text description for an AI interpretation.',
    recommendations: [
      'Record a longer clip (10+ seconds) at the hive entrance',
      'Describe what you hear for a more accurate AI interpretation',
      'Cross-check with a visual inspection of brood and queen status',
    ],
  };
}

/**
 * Send the user's description of the hive sound to Buzz for interpretation.
 * Buzz returns a structured AcousticAnalysis-like JSON.
 */
async function buzzInterpret(
  hiveId: string,
  description: string,
  duration?: number,
): Promise<AcousticAnalysis> {
  const durLine = duration ? 'Recording duration: ' + duration + ' seconds.' : 'Recording duration unknown.';

  const systemPrompt = [
    'You are Buzz, a UGA Master Craftsman Beekeeper with expertise in hive acoustics.',
    'A beekeeper placed a microphone at the hive entrance and described what they heard.',
    'Interpret the acoustic description and determine the colony state.',
    '',
    durLine,
    'Beekeeper description: "' + description.replace(/"/g, '\\"') + '"',
    '',
    'Return ONLY a JSON object (no markdown fences, no explanation) with exactly these fields:',
    '{',
    '  "interpretation": "queenright" | "queenless" | "swarm-preparation" | "stressed" | "normal" | "unknown",',
    '  "confidence": "high" | "medium" | "low",',
    '  "frequency": string (description of dominant frequency, e.g. "steady low hum ~250Hz"),',
    '  "pattern": string (description of audio pattern, e.g. "continuous roar with no breaks"),',
    '  "notes": string (explanation of reasoning),',
    '  "recommendations": string[] (actionable next steps)',
    '}',
    '',
    'Acoustic cues:',
    '- Queenright colonies produce a steady, low-frequency hum (~200-300Hz) with a calm, continuous pattern.',
    '- Queenless colonies produce a "queenless roar" — a louder, agitated, irregular buzzing that beekeepers recognize.',
    '- Swarm preparation may produce a loud, excited "victory buzz" or piping sounds, often in the late afternoon.',
    '- Stressed colonies (heat, predators, disease) produce a higher-pitched, agitated buzz.',
    '- "Normal" means a calm, healthy-sounding hum consistent with a queenright, content colony.',
  ].join('\n');

  const body = {
    model: BUZZ_MODEL,
    messages: [{ role: 'user', content: systemPrompt }],
    stream: false,
    temperature: 0.2,
  };

  const authHeader = 'Bearer ' + BUZZ_KEY;
  let resp: Response;
  try {
    resp = await fetch(BUZZ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Buzz API request failed: ' + (e instanceof Error ? e.message : String(e)));
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('Buzz API ' + resp.status + ': ' + txt.slice(0, 200));
  }

  const data = await resp.json() as any;
  const content: string = data.choices?.[0]?.message?.content ?? '';
  if (!content) {
    throw new Error('Buzz API returned empty content.');
  }

  const jsonStr = extractJson(content);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Fallback: return a low-confidence unknown if Buzz didn't return valid JSON
    return {
      hiveId,
      interpretation: 'unknown',
      confidence: 'low',
      frequency: 'unknown',
      pattern: 'Buzz returned non-JSON: ' + content.slice(0, 120),
      notes: 'AI interpretation failed. Raw: ' + content.slice(0, 200),
      recommendations: ['Retry the analysis', 'Check your text description for clarity'],
    };
  }

  // Coerce to valid enum values
  const validInterp = ['queenright', 'queenless', 'swarm-preparation', 'stressed', 'normal', 'unknown'];
  const validConf = ['high', 'medium', 'low'];
  const interpretation = validInterp.includes(parsed.interpretation) ? parsed.interpretation : 'unknown';
  const confidence = validConf.includes(parsed.confidence) ? parsed.confidence : 'low';
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations.map((r: any) => String(r))
    : [];

  return {
    hiveId,
    interpretation,
    confidence,
    frequency: typeof parsed.frequency === 'string' ? parsed.frequency : 'unknown',
    pattern: typeof parsed.pattern === 'string' ? parsed.pattern : 'unknown',
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    recommendations,
  };
}

/**
 * Analyze a hive audio recording. If a text description is provided, send it
 * to Buzz for AI interpretation. Otherwise, fall back to a crude heuristic.
 */
export async function analyzeAcoustics(params: {
  hiveId: string;
  audio?: string;
  duration?: number;
  description?: string;
}): Promise<AcousticAnalysis> {
  const { hiveId, audio, duration, description } = params;

  if (description && description.trim()) {
    return await buzzInterpret(hiveId, description.trim(), duration);
  }

  // No description — heuristic fallback
  return heuristicAnalysis(hiveId, audio, duration);
}