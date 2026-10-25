/**
 * Đọc document đã lưu ở version bất kỳ → version hiện tại, rồi validate.
 *
 * Mỗi lần đổi schema theo kiểu không tương thích thì tăng `DOCUMENT_VERSION` và
 * thêm MỘT bước vào `STEPS`: bước n nhận document version n, trả version n+1.
 * Không bao giờ sửa một bước đã có — document cũ trong database đi qua đúng chuỗi
 * đó mãi mãi.
 */

import { DOCUMENT_VERSION, DocumentSchema, type ClipDocument } from './schema.ts';

type Step = (document: Record<string, unknown>) => Record<string, unknown>;

/** `STEPS[n]` đưa version n lên n + 1. Chưa có bước nào: version 1 là bản đầu. */
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
