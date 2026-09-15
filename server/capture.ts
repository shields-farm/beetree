// server/capture.ts — the Mentra → BeeTree capture loop.
//
// One entry point: a frame photo (from glasses or phone) plus optional spoken
// context goes in; a stored image, a structured analysis, ranked ontology
// candidates, and a short spoken reply come out.
//
//   1. store the JPEG on disk                  (mediaStore)
//   2. resolve which hive this is              (resolveHive)
//   3. vision analysis                         (vision.analyzeFramePhoto)
//   4. ontology inference + differential       (inference.inferFromFrame)
//   5. record the observation as evidence      (ontology.recordEvidence)
//   6. promote to a colony state ONLY when it clears MIN_SUPPORTED
//   7. compose a <=2-sentence spoken reply     (composeSpeech)
//
// Step 6 is the discipline that keeps the ontology honest. A photo is weak
// evidence; an under-threshold candidate gets recorded as a candidate and
// nothing more. The beekeeper's correction (correctCapture) is what turns a
// candidate into a label.

import { db, genId, now } from './db.js';
import { analyzeFramePhoto, type FrameAnalysis } from './vision.js';
import { inferFromFrame, outstandingChecks, hasObservableEvidence, MIN_SUPPORTED, type InferenceResult } from './inference.js';
import { recordEvidence, recordInstantiation, getSeasonPhaseFor, getEntity } from './ontology.js';
import { logAgenticEvent } from './agenticLog.js';
import { saveDataUrl, deleteMediaFile, MEDIA_KEEP_PER_HIVE, MEDIA_URL_PREFIX } from './mediaStore.js';

export interface CaptureInput {
  /** Base64 data URL or bare base64 JPEG. */
  image: string;
  /** Explicit hive, when the caller knows it (app-side picker). */
  hiveId?: string;
  /** Free text or voice transcript that may name the hive. */
  transcript?: string;
  /** Where the frame came from. */
  source?: 'glasses' | 'phone' | 'upload';
  /** Capture time; defaults to now. */
  capturedAt?: string;
}

export interface CaptureResult {
  captureId: string;
  mediaId: string;
  mediaUrl: string;
  hiveId: string | null;
  hiveName: string | null;
  hiveResolvedBy: 'explicit' | 'transcript' | 'single-hive' | 'unresolved';
  analysis: FrameAnalysis;
  inference: InferenceResult;
  outstandingChecks: string[];
  /** States written to the ontology (only those clearing MIN_SUPPORTED). */
  recordedStates: { state: string; confidence: number; instantiationId: string }[];
  evidenceId: string;
  speech: string;
  capturedAt: string;
}

// ─── Hive resolution ────────────────────────────────────────────────────────

interface HiveLite { id: string; name: string; apiaryId: string }

export function listHives(): HiveLite[] {
  return db.prepare(
    `SELECT entity_id AS id, name, apiaryId FROM hives WHERE superseded_by IS NULL ORDER BY name`,
  ).all() as HiveLite[];
}

/**
 * Work out which hive a capture belongs to.
 *
 * Explicit id wins. Otherwise we look for a hive name or its distinguishing
 * token inside the spoken transcript — "checking Hive Alpha, brood looks spotty"
 * resolves to Hive Alpha. This is deliberately deterministic rather than another
 * model call: the capture path is latency-sensitive and a wrong hive silently
 * poisons the ontology, so we would rather return null and ask.
 */
export function resolveHive(
  explicitId: string | undefined,
  transcript: string | undefined,
  hives: HiveLite[] = listHives(),
): { hive: HiveLite | null; by: CaptureResult['hiveResolvedBy'] } {
  if (explicitId) {
    const h = hives.find((x) => x.id === explicitId);
    if (h) return { hive: h, by: 'explicit' };
  }

  if (transcript && transcript.trim()) {
    const t = transcript.toLowerCase();
    // Longest name first so "Hive Alpha Two" beats "Hive Alpha".
    const byName = [...hives].sort((a, b) => b.name.length - a.name.length);
    for (const h of byName) {
      if (!h.name) continue;
      if (t.includes(h.name.toLowerCase())) return { hive: h, by: 'transcript' };
      // Also match the distinctive tail: "Hive Alpha" -> "alpha".
      const token = h.name.toLowerCase().replace(/^hive\s+/, '').trim();
      if (token.length >= 4 && new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) {
        return { hive: h, by: 'transcript' };
      }
    }
    // "hive three" / "hive 3"
    const numMatch = /\bhive\s+(\d+)\b/.exec(t);
    if (numMatch) {
      const n = numMatch[1];
      const h = hives.find((x) => new RegExp(`\\b0*${n}\\b`).test(x.name) || x.name.toLowerCase().includes(` ${n}`));
      if (h) return { hive: h, by: 'transcript' };
    }
  }

  // Without a display there is nothing to disambiguate on, so an unattributed
  // capture on a single-hive yard is safe to attribute. More than one hive and
  // we refuse — an unlabelled observation is still useful, a mislabelled one is
  // actively harmful to the dataset.
  if (hives.length === 1) return { hive: hives[0], by: 'single-hive' };

  return { hive: null, by: 'unresolved' };
}

// ─── Speech composition ─────────────────────────────────────────────────────

/** Sentence-case a state class for speech: 'Queenless' -> 'queenless'. */
function say(state: string): string {
  const spaced = state.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced;
}

/**
 * Turn a capture into what the glasses should say out loud.
 *
 * Two sentences maximum. The point of the glasses is that the beekeeper's hands
 * are busy, so this leads with the conclusion-if-we-have-one and the single most
 * important check if we do not. It never reads the raw analysis aloud.
 */
export function composeSpeech(r: {
  hiveName: string | null;
  analysis: FrameAnalysis;
  inference: InferenceResult;
  checks: string[];
}): string {
  const { hiveName, analysis, inference, checks } = r;
  const where = hiveName ? ` on ${hiveName}` : '';

  // A frame the model could not read must never name a state, even a hedged one.
  // With no positive observation we have nothing to reason from, and speaking a
  // 9%-confidence "queenless" out loud would be worse than staying quiet, because
  // the beekeeper would act on it.
  if (!hasObservableEvidence(analysis)) {
    return `Couldn't read that frame${where}. Try again with the comb flat and out of direct sun.`;
  }

  const parts: string[] = [];

  if (inference.supported.length > 0) {
    const top = inference.supported[0];
    const brood = analysis.broodPattern !== 'unknown' ? `${analysis.broodPattern} brood, ` : '';
    parts.push(`${brood}looks ${say(top.state)}${where} — about ${Math.round(top.confidence * 100)} percent.`);
    const next = top.checks[0];
    if (next) parts.push(next);
  } else if (inference.lead) {
    const top = inference.lead;
    const brood = analysis.broodPattern !== 'unknown' ? `${analysis.broodPattern} brood` : 'That frame';
    // State the ambiguity explicitly. A 0.2 answer presented as an answer is the
    // exact failure the vocab's spotty_mixed notes warn against.
    const others = inference.ranked.slice(1, 3).map((c) => say(c.state));
    const alt = others.length ? ` Could also be ${others.join(' or ')}.` : '';
    parts.push(`${brood}${where} — too close to call (best guess ${say(top.state)}, ${Math.round(top.confidence * 100)} percent).${alt}`);
    const check = checks[0] ?? top.checks[0];
    if (check) parts.push(check);
  } else {
    parts.push(`Frame${where} logged, but no diagnosis matched.`);
  }

  // Two sentences, hard stop.
  const joined = parts.filter(Boolean).slice(0, 2).join(' ');
  return joined.length > 320 ? joined.slice(0, 317) + '...' : joined;
}

// ─── The capture itself ─────────────────────────────────────────────────────

/**
 * Run the full loop for one frame. Throws when the image is unusable or the
 * vision model fails; a capture that silently produces nothing would be worse
 * than an error, because the beekeeper would assume it worked.
 */
export async function captureFrame(input: CaptureInput): Promise<CaptureResult> {
  const capturedAt = input.capturedAt ?? now();
  const captureId = genId('cap');
  const mediaId = genId('media');

  const saved = saveDataUrl(mediaId, input.image)
    ?? saveDataUrl(mediaId, `data:image/jpeg;base64,${input.image}`);
  if (!saved) throw new Error('Image payload was empty or not decodable base64.');

  const { hive, by } = resolveHive(input.hiveId, input.transcript);

  const analysis = await analyzeFramePhoto(input.image, hive?.name);
  const season = hive ? getSeasonPhaseFor(capturedAt).phase : null;
  const inference = inferFromFrame(analysis, season);
  const checks = outstandingChecks(inference);

  // Observation evidence — written for every capture, whatever the confidence.
  // This row IS the label candidate: frame, time, hive, verdict.
  const evidenceId = recordEvidence({
    evidence_kind: 'frame_capture',
    content: {
      capture_id: captureId,
      captured_at: capturedAt,
      source: input.source ?? 'upload',
      hive_id: hive?.id ?? null,
      hive_resolved_by: by,
      transcript: input.transcript ?? null,
      media_url: saved.url,
      media_bytes: saved.bytes,
      season_phase: season,
      analysis,
      inference: {
        ranked: inference.ranked.slice(0, 5),
        matched_cues: inference.matchedCues,
        low_confidence: inference.lowConfidence,
        min_supported: MIN_SUPPORTED,
      },
    },
    source_table: 'media_items',
    source_id: mediaId,
    recorded_at: capturedAt,
  });

  // Promote to actual colony states only where the evidence carries it.
  const recordedStates: CaptureResult['recordedStates'] = [];
  if (hive) {
    const colonyId = colonyEntityFor(hive.id);
    for (const c of inference.supported) {
      if (!colonyId) break;
      const instantiationId = recordInstantiation({
        state_class: c.state,
        subject_id: colonyId,
        valid_from: capturedAt,
        confidence: c.confidence,
        rationale: `Frame capture ${captureId}: ${c.cue} (${c.block}) at ${Math.round(c.confidence * 100)}% `
          + `after evidence weighting (vocab ${Math.round(c.vocabConfidence * 100)}% x ${c.evidenceWeight}).`
          + (c.reason ? ` Vocab reason: ${c.reason}.` : ''),
        supporting_evidence: [evidenceId],
      });
      recordedStates.push({ state: c.state, confidence: c.confidence, instantiationId });
    }
  }

  const speech = composeSpeech({ hiveName: hive?.name ?? null, analysis, inference, checks });

  // Persist the media row, then prune this hive to its retention budget.
  db.prepare(
    `INSERT INTO media_items (id, entity_id, version, superseded_by, superseded_at, inspectionId, hiveId, type, dataUrl, timestamp, label, duration, file_path)
     VALUES (?, ?, 1, NULL, NULL, ?, ?, 'photo', ?, ?, ?, NULL, ?)`,
  ).run(
    mediaId, mediaId, null, hive?.id ?? null, saved.url, capturedAt,
    input.transcript ? input.transcript.slice(0, 200) : 'frame capture',
    saved.filePath,
  );
  pruneHiveMediaFor(hive?.id ?? null);

  logAgenticEvent({
    type: 'frame-capture',
    source: 'mentra-capture',
    title: hive
      ? `Frame capture: ${hive.name}${inference.lead ? ` — ${say(inference.lead.state)}` : ''}`
      : 'Frame capture (hive unresolved)',
    body: speech,
    hiveId: hive?.id ?? null,
    hiveName: hive?.name ?? null,
    severity: inference.supported.length > 0 ? 'warning' : 'info',
    metadata: {
      captureId,
      mediaUrl: saved.url,
      hiveResolvedBy: by,
      broodPattern: analysis.broodPattern,
      matchedCues: inference.matchedCues,
      recordedStates: recordedStates.map((s) => ({ state: s.state, confidence: s.confidence })),
      evidenceId,
    },
  });

  return {
    captureId,
    mediaId,
    mediaUrl: saved.url,
    hiveId: hive?.id ?? null,
    hiveName: hive?.name ?? null,
    hiveResolvedBy: by,
    analysis,
    inference,
    outstandingChecks: checks,
    recordedStates,
    evidenceId,
    speech,
    capturedAt,
  };
}

/**
 * Find the Colony entity for a hive.
 *
 * The durable link is the `isOn` relation (`onto_colony_* isOn hive-1`), NOT
 * `onto_entity.source_id`. source_id records the hive's *per-version row id* at
 * backfill time, and copy-on-write replaces that row id on every edit — hive-1's
 * source_id still points at `hive-dojcukvoaq2` while its current row id is
 * `cow-9t98tl6hf3n`. Matching on it silently finds nothing, which meant every
 * inferred state was dropped on the floor: the inference would report Queenright
 * at 0.81 and record no state at all.
 *
 * So: walk the relation graph first, and keep the source_id/properties lookup
 * only as a fallback for a hive that has no relation asserted yet.
 */
function colonyEntityFor(hiveId: string): string | null {
  const viaRelation = db.prepare(
    `SELECT e.entity_id FROM onto_entity e
       JOIN onto_relation r ON r.subject_id = e.entity_id AND r.superseded_by IS NULL
      WHERE e.superseded_by IS NULL
        AND e.entity_type = 'Colony'
        AND r.predicate = 'isOn'
        AND r.object_id = ?
      LIMIT 1`,
  ).get(hiveId) as { entity_id: string } | undefined;
  if (viaRelation) return viaRelation.entity_id;

  const row = db.prepare(
    `SELECT entity_id FROM onto_entity
      WHERE superseded_by IS NULL AND entity_type = 'Colony'
        AND (source_id = ? OR json_extract(properties,'$.hiveId') = ?)
      LIMIT 1`,
  ).get(hiveId, hiveId) as { entity_id: string } | undefined;
  return row?.entity_id ?? null;
}

/**
 * Prune a hive's stored photos down to the retention budget.
 *
 * Deletes both the file and the row for anything past `keep`, newest-first. Safe
 * to call on every capture: with fewer rows than the budget it is a no-op, and a
 * file that is already missing does not abort the row cleanup.
 */
function pruneHiveMediaFor(hiveId: string | null, keep = MEDIA_KEEP_PER_HIVE): number {
  if (!keep || keep <= 0) return 0;
  const rows = db.prepare(
    `SELECT entity_id, file_path, dataUrl FROM media_items
      WHERE superseded_by IS NULL AND type = 'photo'
        AND (? IS NULL OR hiveId = ?)
      ORDER BY timestamp DESC`,
  ).all(hiveId, hiveId) as { entity_id: string; file_path: string | null; dataUrl: string }[];

  const stale = rows.slice(keep);
  if (stale.length === 0) return 0;

  let removedFiles = 0;
  for (const s of stale) {
    const name = s.file_path ?? (s.dataUrl.startsWith(`${MEDIA_URL_PREFIX}/`)
      ? s.dataUrl.slice(MEDIA_URL_PREFIX.length + 1)
      : null);
    if (name && deleteMediaFile(name)) removedFiles++;
  }
  const del = db.prepare('DELETE FROM media_items WHERE entity_id = ?');
  for (const s of stale) del.run(s.entity_id);
  return removedFiles;
}

// ─── The beekeeper's correction — what makes it a label ─────────────────────

export interface Correction {
  /** The state the beekeeper says is actually true. */
  state: string;
  /** Optional free-text note. */
  note?: string;
  /** Optional evidence ids this correction rests on. */
  evidenceIds?: string[];
}

/**
 * Record the beekeeper's verdict over the model's. This is the training signal:
 * the pair (ai_candidates, human_state) is the ground truth a supervised model
 * would need, and it is the only reason the flywheel produces anything better
 * than a pile of unverified guesses.
 */
export function correctCapture(captureId: string, correction: Correction): {
  evidenceId: string;
  instantiationId: string | null;
  colonyId: string | null;
} {
  const original = db.prepare(
    `SELECT id, entity_id, content, source_id, recorded_at FROM onto_evidence
      WHERE superseded_by IS NULL AND source_table = 'media_items'
        AND json_extract(content,'$.capture_id') = ? LIMIT 1`,
  ).get(captureId) as { id: string; entity_id: string; content: string; source_id: string; recorded_at: string } | undefined;

  let parsed: any = {};
  try { parsed = original ? JSON.parse(original.content) : {}; } catch { /* keep {} */ }

  const hiveId: string | null = parsed?.hive_id ?? null;
  const capturedAt: string = parsed?.captured_at ?? now();

  const corrected = {
    ...parsed,
    correction: {
      state: correction.state,
      note: correction.note ?? null,
      corrected_at: now(),
      // Keep the model's view alongside the human's. The delta is the label.
      ai_ranked: parsed?.inference?.ranked ?? [],
      ai_top: parsed?.inference?.ranked?.[0]?.state ?? null,
      agreed: parsed?.inference?.ranked?.[0]?.state === correction.state,
    },
  };

  const evidenceId = recordEvidence({
    evidence_kind: 'beekeeper_correction',
    content: corrected,
    source_table: 'media_items',
    source_id: original?.source_id ?? null,
    recorded_at: capturedAt,
  });

  let instantiationId: string | null = null;
  const colonyId = hiveId ? colonyEntityFor(hiveId) : null;
  if (colonyId) {
    instantiationId = recordInstantiation({
      state_class: correction.state,
      subject_id: colonyId,
      valid_from: capturedAt,
      confidence: 0.95, // beekeeper-verified
      rationale: `Beekeeper correction on capture ${captureId}`
        + (parsed?.inference?.ranked?.[0]?.state
          ? ` (model led with ${parsed.inference.ranked[0].state}).`
          : '.')
        + (correction.note ? ` Note: ${correction.note}` : ''),
      supporting_evidence: [evidenceId, ...(correction.evidenceIds ?? [])],
    });
  }

  logAgenticEvent({
    type: 'capture-correction',
    source: 'mentra-capture',
    title: `Beekeeper correction: ${correction.state}`,
    body: correction.note ?? '',
    hiveId,
    hiveName: hiveId ? (getEntity(hiveId)?.name ?? null) : null,
    severity: 'info',
    metadata: {
      captureId,
      correctedTo: correction.state,
      modelTop: parsed?.inference?.ranked?.[0]?.state ?? null,
      agreed: corrected.correction.agreed,
      evidenceId,
    },
  });

  return { evidenceId, instantiationId, colonyId };
}

/**
 * Labelled captures — the pairs a supervised model would train on.
 * One row per corrected capture: what the model said vs what was true.
 */
export function captureLabelPairs(limit = 500): {
  captureId: string;
  hiveId: string | null;
  capturedAt: string;
  aiTop: string | null;
  humanState: string;
  agreed: boolean;
}[] {
  const rows = db.prepare(
    `SELECT json_extract(content,'$.capture_id')        AS capture_id,
            json_extract(content,'$.hive_id')          AS hive_id,
            json_extract(content,'$.captured_at')      AS captured_at,
            json_extract(content,'$.correction.ai_top')     AS ai_top,
            json_extract(content,'$.correction.state')      AS human_state,
            json_extract(content,'$.correction.agreed')     AS agreed
       FROM onto_evidence
      WHERE superseded_by IS NULL AND evidence_kind = 'beekeeper_correction'
      ORDER BY recorded_at DESC LIMIT ?`,
  ).all(limit) as any[];
  return rows.map((r) => ({
    captureId: r.capture_id,
    hiveId: r.hive_id ?? null,
    capturedAt: r.captured_at,
    aiTop: r.ai_top ?? null,
    humanState: r.human_state,
    agreed: r.agreed === 1,
  }));
}
