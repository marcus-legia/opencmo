import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  chunk,
  sweepOrphanPages,
} from "./cleanup";
import { BUCKETS } from "./storage";

async function main(): Promise<void> {
  // Deadline hết giữa hai lô: không mở thêm request, cũng không xoá sau reserve.
  let now = 0;
  const removed: string[] = [];
  await sweepOrphanPages({
    deadline: 50, now: () => now,
    scan: async () => { now += 30; return ['u/old.mp4']; },
    safe: async (paths) => { now += 30; return paths; },
    remove: async (paths) => { removed.push(...paths); return true; },
  });
  assert.deepEqual(removed, [], 'không bắt đầu remove sau deadline');
  let scannedPages = 0;
  await sweepOrphanPages({
    deadline: 50, now: () => 0, maxPages: 2,
    scan: async () => { scannedPages++; return ['u/live.mp4']; },
    safe: async () => [], remove: async () => true,
  });
  assert.equal(scannedPages, 2, 'invocation có trần trang cả khi mọi file còn live');
  const events: string[] = [];
  let scanCalls = 0;
  const total = await sweepOrphanPages({
    deadline: 50, now: () => 0,
    scan: async () => scanCalls++ ? [] : Array.from({length: 201}, (_, i) => `u/${i}`),
    safe: async (paths) => {
      events.push(`check:${paths.length}`);
      return paths.filter((path) => path !== 'u/200');
    },
    remove: async (paths) => { events.push(`remove:${paths.length}`); return true; },
  });
  assert.equal(total, 200, 'file trở thành live không bị xoá');
  assert.deepEqual(events, ['check:100','remove:100','check:100','remove:100','check:1'],
    'kiểm lại tham chiếu ngay trước từng lô remove');

  assert.deepEqual(
    chunk(Array.from({ length: 201 }, (_, index) => `u/orphan-${index}.mp4`), 100).map((batch) => batch.length),
    [100, 100, 1],
    "orphan deletes remain within the 100-object Storage batch bound",
  );

  // The cron skips a row whose bucket is not in BUCKETS, and that row comes back every loop: photos never went.
  const schema = readFileSync(new URL("../../../supabase/schema/current.sql", import.meta.url), "utf8");
  const queued = /CONSTRAINT storage_deletions_bucket_check CHECK \(\(bucket = ANY \(ARRAY\[([^\]]+)\]/.exec(schema);
  assert.ok(queued, "the storage_deletions bucket check is in the schema");
  for (const bucket of queued[1].matchAll(/'([a-z]+)'::text/g)) {
    assert.ok((BUCKETS as readonly string[]).includes(bucket[1]), `the cleanup cron deletes from ${bucket[1]}`);
  }

  console.log("cleanup sweep: mọi kiểm tra xanh");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
