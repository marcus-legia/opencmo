/**
 * Reads a document saved at any version up to the current one, then validates it.
 *
 * Every incompatible schema change bumps `DOCUMENT_VERSION` and adds ONE step to `STEPS`: step n takes a version-n
 * document and returns version n+1. Never edit a step that exists: old documents in the database go through that
 * exact chain forever.
 */

import { DOCUMENT_VERSION, DocumentSchema, type ClipDocument } from './schema.ts';

type Step = (document: Record<string, unknown>) => Record<string, unknown>;

/** `STEPS[n]` takes version n to n + 1. None yet: version 1 is the first. */
const STEPS: Record<number, Step> = {};

const REMOVED_KINDS = new Set(['lottie', 'scene3d']);
const REMOVED_TRACKS = new Set(['cameraPhi', 'cameraTheta', 'cameraDistance']);

/**
 * Lottie and 3D were removed on 2026-10-24 without a version bump, so version-1 documents saved before that
 * still carry them and would fail the strict schema (the project could not be opened or exported). Dropping
 * them on every read keeps those projects editable; it is a no-op for anything saved since.
 */
function pruneRemoved(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(item && typeof item === 'object' && REMOVED_KINDS.has((item as { kind?: unknown }).kind as string)))
      .filter((item) => !(item && typeof item === 'object' && REMOVED_TRACKS.has((item as { property?: unknown }).property as string)))
      .map(pruneRemoved);
  }
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'studio3d') continue;
    out[key] = pruneRemoved(item);
  }
  return out;
}

export function migrate(input: unknown): ClipDocument {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('document must be an object');
  }
  let document = input as Record<string, unknown>;
  let version = document.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`document has no valid version (got ${JSON.stringify(version)})`);
  }
  if (version > DOCUMENT_VERSION) {
    throw new Error(`document version ${version} is newer than this editor (${DOCUMENT_VERSION}); reload the page`);
  }
  while (version < DOCUMENT_VERSION) {
    const step = STEPS[version];
    if (!step) throw new Error(`no migration from document version ${version}`);
    document = step(document);
    version += 1;
    document.version = version;
  }
  return DocumentSchema.parse(pruneRemoved(document));
}
