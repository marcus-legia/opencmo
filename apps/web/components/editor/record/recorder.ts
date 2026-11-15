/**
 * The browser recorder's logic, kept apart from the dialog so it can be checked in Node.
 *
 * What we learned from CapCut Web's recorder (docs/research/editor/2026-11-15-capcut-media.md §1): record in slices
 * of a few seconds and keep every slice on the device as it arrives, so a crashed tab loses at most one slice; pause
 * does not start a new take; one start → stop is one take. The code here is ours.
 */

/** A slice every 3 s: small enough to lose little in a crash, large enough not to flood IndexedDB. */
export const SLICE_MS = 3000;
/** The founder gets a beat to look at the lens before the take starts. */
export const COUNTDOWN_SECONDS = 3;

/**
 * The first container the browser can record, best first. MP4 first: Safari only records MP4, and Chrome's MP4 opens
 * in more players. WebM covers Firefox and older Chrome. Every one is in the worker's demuxer allowlist.
 */
const CANDIDATES = [
  "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const AUDIO_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

export function pickMime(isTypeSupported: (mime: string) => boolean, kind: "video" | "audio" = "video"): string | null {
  for (const mime of kind === "video" ? CANDIDATES : AUDIO_CANDIDATES) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      // Some browsers throw on a codec string they cannot parse: try the next one.
    }
  }
  return null;
}

/** The file extension for a recorded mime type. */
export function extensionOf(mime: string): "mp4" | "webm" | "m4a" | "weba" {
  if (mime.startsWith("audio/mp4")) return "m4a";
  // Audio-only WebM gets its own extension: the worker routes a file by extension, and `.webm` is read as video.
  if (mime.startsWith("audio/webm")) return "weba";
  return mime.includes("mp4") ? "mp4" : "webm";
}

/** "Recording 2026-11-15 14-05.mp4": sortable, and free of characters a storage path rejects. */
export function takeName(at: Date, mime: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
  return `Recording ${stamp}.${extensionOf(mime)}`;
}

/**
 * The take's length, counted by us rather than read from the file: a MediaRecorder file often has no length in its
 * header. Pauses do not count.
 */
export class TakeClock {
  private startedAt: number | null = null;
  private pausedAt: number | null = null;
  private paused = 0;
  private stoppedAt: number | null = null;

  start(now: number) {
    this.startedAt = now;
    this.pausedAt = null;
    this.paused = 0;
    this.stoppedAt = null;
  }
  pause(now: number) {
    if (this.startedAt === null || this.pausedAt !== null || this.stoppedAt !== null) return;
    this.pausedAt = now;
  }
  resume(now: number) {
    if (this.pausedAt === null) return;
    this.paused += now - this.pausedAt;
    this.pausedAt = null;
  }
  stop(now: number) {
    if (this.startedAt === null || this.stoppedAt !== null) return;
    this.resume(now);
    this.stoppedAt = now;
  }
  /** Seconds recorded so far (or in all, once stopped). */
  seconds(now: number): number {
    if (this.startedAt === null) return 0;
    const end = this.stoppedAt ?? this.pausedAt ?? now;
    return Math.max(0, (end - this.startedAt - this.paused) / 1000);
  }
}

/** mm:ss for the counter. */
export function clockLabel(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Which beat of the script is due after `seconds` of recording, pacing each beat by its own seconds (the same pace
 * as the phone prompter's auto-scroll). The last beat stays up once the script's time has run out.
 */
export function beatAt(beats: { seconds: number }[], seconds: number): number {
  let end = 0;
  for (let index = 0; index < beats.length; index++) {
    end += Math.max(1, beats[index]!.seconds);
    if (seconds < end) return index;
  }
  return Math.max(0, beats.length - 1);
}

// ------------------------------------------------------------------ slices on the device

/** One unfinished take kept on the device, enough to rebuild its file. */
export type StoredTake = { id: string; mime: string; seconds: number; startedAt: string; slices: number };

const DB = "opencmo-recorder";
const SLICES = "slices";
const TAKES = "takes";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SLICES);
      request.result.createObjectStore(TAKES, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The recorder's storage could not open."));
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, work: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const request = work(t);
      t.oncomplete = () => resolve(request ? request.result : undefined);
      t.onerror = () => reject(t.error ?? new Error("The recorder's storage failed."));
      t.onabort = () => reject(t.error ?? new Error("The recorder's storage failed."));
    });
  } finally {
    db.close();
  }
}

/** The key of a slice: zero-padded so the store's key order is the slice order. */
export const sliceKey = (take: string, index: number) => `${take}/${String(index).padStart(6, "0")}`;

/**
 * Keeps slices of one take on the device. Every call swallows storage errors (private mode, a full disk): the
 * recording in memory still works, only the crash copy is lost.
 */
export class SliceStore {
  private index = 0;
  private ok = typeof indexedDB !== "undefined";
  // Writes run one after another: the last slice must not land after `discard`, or it would bring the take back
  // as "unsaved" the next time the recorder opens.
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly take: StoredTake) {}

  private enqueue(work: () => Promise<unknown>) {
    this.queue = this.queue.then(async () => {
      if (!this.ok) return;
      try {
        await work();
      } catch {
        this.ok = false;
      }
    });
    return this.queue;
  }

  begin() {
    return this.enqueue(() => tx([TAKES], "readwrite", (t) => void t.objectStore(TAKES).put(this.take)));
  }
  add(blob: Blob, seconds: number) {
    const index = this.index++;
    return this.enqueue(() =>
      tx([SLICES, TAKES], "readwrite", (t) => {
        t.objectStore(SLICES).put(blob, sliceKey(this.take.id, index));
        t.objectStore(TAKES).put({ ...this.take, seconds, slices: index + 1 });
      }),
    );
  }
  /** The take reached the library (or was thrown away): its crash copy goes, after any write still queued. */
  async discard() {
    await this.queue;
    this.ok = false;
    await discardTake(this.take.id);
  }
}

/** Unfinished takes left by a tab that closed while recording. */
export async function storedTakes(): Promise<StoredTake[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const all = await tx<StoredTake[]>([TAKES], "readonly", (t) => t.objectStore(TAKES).getAll() as IDBRequest<StoredTake[]>);
    return (all ?? []).filter((take) => take.slices > 0);
  } catch {
    return [];
  }
}

/** Rebuilds a stored take's file from its slices, in order. */
export async function rebuildTake(take: StoredTake): Promise<File | null> {
  try {
    const range = IDBKeyRange.bound(`${take.id}/`, `${take.id}/￿`);
    const blobs = await tx<Blob[]>([SLICES], "readonly", (t) => t.objectStore(SLICES).getAll(range) as IDBRequest<Blob[]>);
    if (!blobs?.length) return null;
    return new File(blobs, takeName(new Date(take.startedAt), take.mime), { type: take.mime.split(";")[0] });
  } catch {
    return null;
  }
}

export async function discardTake(id: string) {
  if (typeof indexedDB === "undefined") return;
  try {
    await tx([SLICES, TAKES], "readwrite", (t) => {
      t.objectStore(SLICES).delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`));
      t.objectStore(TAKES).delete(id);
    });
  } catch {
    // Left behind: the next open lists it again, and the founder can drop it then.
  }
}
