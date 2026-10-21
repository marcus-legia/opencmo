/**
 * Runs for real, not only at typecheck time.
 *
 *     cd apps/web && npx tsx lib/api/source.check.ts
 *
 * `sourceProblem` guards "a job pointing at someone else's file" and refuses links. Both fail
 * silently if wrong — the job would still run, just from a source it must never touch.
 */
import assert from "node:assert/strict";

import { sourceProblem, UPLOAD_ONLY } from "./source";
import { MAX_UPLOAD_BYTES, rejectReason, storageExtension } from "../upload";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

const failures: string[] = [];

function check(name: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

check("nguồn upload của chính mình được chấp nhận", () => {
  assert.equal(sourceProblem(`storage://${ME}/talk__abc.mp4`, ME), null);
});

check("nguồn upload của người khác bị chặn", () => {
  assert.equal(
    sourceProblem(`storage://${THEM}/talk__abc.mp4`, ME),
    "That upload is no longer available. Please try again.",
  );
});

check("đường dẫn vượt thư mục bị chặn dù segment đầu đúng", () => {
  // Ba segment, bắt đầu bằng uid hợp lệ — chỉ so segment đầu là không đủ.
  assert.notEqual(sourceProblem(`storage://${ME}/../${THEM}/x.mp4`, ME), null);
  assert.notEqual(sourceProblem(`storage://${ME}/sub/x.mp4`, ME), null);
});

check("links are refused: only the user's own upload starts a job", () => {
  for (const link of ["https://www.youtube.com/watch?v=abc", "https://cdn.example.com/v.mp4", "http://127.0.0.1/", ""]) {
    assert.equal(sourceProblem(link, ME), UPLOAD_ONLY, link);
  }
});

check("empty and oversized files are refused before the upload starts", () => {
  assert.equal(rejectReason("talk.mp4", 0), "That file is empty.");
  assert.equal(rejectReason("talk.mp4", 3 * 1024 ** 3), "That file is 3.0 GB. The limit is 2.0 GB.");
  assert.notEqual(rejectReason("talk.mp4", MAX_UPLOAD_BYTES + 1), null);
  assert.equal(rejectReason("talk.mp4", MAX_UPLOAD_BYTES), null);
});

check("upload không bị giới hạn theo container hay phần mở rộng", () => {
  assert.equal(rejectReason("concert.mts", 1024), null);
  assert.equal(rejectReason("camera-file.weird-container", 1024), null);
  assert.equal(rejectReason("video-without-extension", 1024), null);
  assert.equal(storageExtension("../../video.bad/ext"), "video");
  assert.equal(storageExtension("concert.MTS"), "mts");
});

if (failures.length > 0) {
  console.error(`${failures.length} kiểm tra hỏng:`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("sourceProblem: all checks passed");
