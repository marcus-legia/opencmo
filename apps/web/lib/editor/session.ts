/**
 * Phiên sửa một document trong shell mới (spec editor-rewrite B2): bản trong
 * tab, autosave có khoá lạc quan, và Undo/Redo.
 *
 * Không dính React hay `fetch`: lượt lưu đi qua `SaveTransport`, nên cùng một
 * lớp chạy trong trình duyệt và trong `session.check.ts` với transport giả.
 *
 * Luật:
 * - Mỗi `commit` là MỘT bước Undo. Undo/Redo cũng là sửa đổi: chúng lưu như
 *   mọi lượt khác, không có đường ghi riêng.
 * - Lưu trễ `delay` ms sau lượt sửa cuối, mỗi lúc chỉ MỘT lượt đang bay. Sửa
 *   trong lúc đang lưu thì lưu tiếp ngay sau khi lượt kia về, với version mới.
 * - 409 (tab khác đã ghi) → `conflict`, dừng lưu. Bản trong tab KHÔNG bị ghi
 *   đè: người dùng chọn tải bản mới nhất (`adopt`), không có gì tự mất.
 * - Lỗi khác → `error`, bản trong tab còn nguyên; lượt sửa kế tiếp hay `flush`
 *   thử lại.
 */

import { canonicalJson, validate, type ClipDocument } from "@opencmo/clip-doc";

export type Saved = { version: number; document_hash: string };

export interface SaveTransport {
  /** `manifest`: thư viện media của project, lưu CÙNG lượt với document. */
  save(expectedVersion: number, document: ClipDocument, manifest?: unknown): Promise<Saved>;
}

export class SaveConflict extends Error {
  constructor(readonly current: { version: number; document: ClipDocument } | null) {
    super("This clip was changed in another tab.");
  }
}

export type SaveStatus = "saved" | "pending" | "saving" | "conflict" | "error";

export type SessionState = {
  document: ClipDocument;
  /**
   * Thư viện media (manifest). Lưu cùng lượt với document nhưng KHÔNG đi lùi
   * theo Undo — như fork: Undo một lượt sửa clip không được xoá mất file vừa
   * nhập. Đổi tên asset là đổi thư viện + một op `replace_src` (op đó mới Undo).
   */
  manifest: unknown;
  version: number;
  status: SaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** sha256 của TSX đã lưu — revision cho Export đối chiếu đúng bản này. */
  documentHash: string | null;
};

/** Undo xa hơn thế này là hiếm; mỗi bước giữ nguyên một document (vài chục KB). */
const HISTORY = 200;

/** A write rebuilt this many times because the document kept changing under it gives up. */
const ATTEMPTS = 3;

type Snapshot = { document: ClipDocument; manifest: unknown };

/** What a queued write produces: the next document, and optionally the next library. */
export type Built = ClipDocument | { document: ClipDocument; manifest: unknown };

export type TransactOptions = {
  /** `false` for bookkeeping that is saved but is not an edit the user would undo. */
  history?: boolean;
  /** For logs and future history UI; no effect on how the write applies. */
  label?: string;
  origin?: "user" | "assistant" | "system";
  /** Same meaning as in `commit`; a `manifest` returned by `build` wins. */
  manifest?: unknown;
};
const json = (value: unknown) => (value === undefined ? "" : canonicalJson(value));

export class DocumentSession {
  private document: ClipDocument;
  private manifest: unknown;
  private savedManifest: string;
  private version: number;
  private savedJson: string;
  private documentHash: string | null;
  private status: SaveStatus = "saved";
  private error: string | null = null;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  /** Bumped by `rebase`: a save sent before it answers for a version the tab no longer holds. */
  private epoch = 0;
  private listeners = new Set<() => void>();
  /** Tail of the write queue; never rejects, so one failed write doesn't stop the next. */
  private queue: Promise<unknown> = Promise.resolve();
  private snapshot: SessionState;
  conflictWith: { version: number; document: ClipDocument } | null = null;

  constructor(
    initial: { document: ClipDocument; version: number; documentHash: string | null; manifest?: unknown },
    private transport: SaveTransport,
    private delay = 1000,
    /** Injected so the checks can run with stand-in documents that aren't full clips. */
    private check: (document: ClipDocument) => unknown = validate,
  ) {
    this.document = initial.document;
    this.manifest = initial.manifest;
    this.savedManifest = json(initial.manifest);
    this.version = initial.version;
    this.savedJson = canonicalJson(initial.document);
    this.documentHash = initial.documentHash;
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Ổn định giữa hai lần đổi — `useSyncExternalStore` cần đúng điều đó. */
  getState = (): SessionState => this.snapshot;

  get current(): ClipDocument {
    return this.document;
  }

  get currentManifest(): unknown {
    return this.manifest;
  }

  /**
   * Một bước sửa. Document y hệt bản đang có thì không thành bước Undo nào.
   * `history: false` cho thứ file giữ nhưng không phải lượt sửa clip (mở rộng
   * một hàng timeline, chiều cao hàng): vẫn lưu, không chen vào Undo.
   */
  commit(next: ClipDocument, options: { history?: boolean; manifest?: unknown } = {}): void {
    const manifest = "manifest" in options ? options.manifest : this.manifest;
    const sameDocument = next === this.document || canonicalJson(next) === canonicalJson(this.document);
    if (sameDocument && json(manifest) === json(this.manifest)) return;
    if (options.history !== false) {
      this.undoStack.push(this.here());
      if (this.undoStack.length > HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    this.document = next;
    this.manifest = manifest;
    this.changed();
  }

  /**
   * Queue a write. `build` gets the document (and library) as they are when the write runs, never
   * a copy read before an `await`, so writes started close together all land, in order. If the
   * document changes while `build` is awaiting (Undo, an Assistant version), `build` runs again on
   * the new one rather than overwriting it. The result is validated before it is committed: the
   * server refuses an invalid document, and autosave would then fail on every later edit.
   * Rejects with the write's own error; later writes still run.
   */
  transact(
    build: (latest: ClipDocument, manifest: unknown) => Built | Promise<Built>,
    options: TransactOptions = {},
  ): Promise<ClipDocument> {
    const write = this.queue.then(async () => {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const latest = this.document;
        const latestManifest = this.manifest;
        const built = await build(latest, latestManifest);
        if (this.document !== latest || this.manifest !== latestManifest) continue;
        const next: { document: ClipDocument; manifest?: unknown } = "stage" in built ? { document: built } : built;
        this.check(next.document);
        const manifest = "manifest" in next ? { manifest: next.manifest } : "manifest" in options ? { manifest: options.manifest } : {};
        this.commit(next.document, { history: options.history, ...manifest });
        return this.document;
      }
      throw new Error("The clip changed while this edit was being applied. Try again.");
    });
    this.queue = write.catch(() => {});
    return write;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.here());
    this.go(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.here());
    this.go(next);
  }

  private here(): Snapshot {
    return { document: this.document, manifest: this.manifest };
  }

  private go(snapshot: Snapshot): void {
    this.document = snapshot.document;
    this.changed();
  }

  /** Lưu ngay và chờ tới khi không còn gì chưa lưu (trước Export, trước khi rời trang). */
  async flush(): Promise<void> {
    for (;;) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.inflight) {
        await this.inflight;
        continue;
      }
      if (this.status === "conflict") throw new SaveConflict(this.conflictWith);
      if (!this.dirty()) return;
      await this.save();
      if (this.status === "error") throw new Error(this.error ?? "Could not save your changes.");
    }
  }

  /**
   * Nhận bản của server (sau xung đột, hay reset từ ngoài). Lịch sử Undo bỏ:
   * các bước cũ tính trên một bản không còn là bản đang lưu.
   */
  adopt(document: ClipDocument, version: number, documentHash: string | null, manifest: unknown = this.manifest): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.document = document;
    this.manifest = manifest;
    this.savedManifest = json(manifest);
    this.version = version;
    this.savedJson = canonicalJson(document);
    this.documentHash = documentHash;
    this.undoStack = [];
    this.redoStack = [];
    this.status = "saved";
    this.error = null;
    this.conflictWith = null;
    this.emit();
  }

  /**
   * Take a version the Assistant saved from this same tab. Its document replaces the tab's, but
   * the library stays the tab's: the Assistant never writes the manifest, and a library change
   * made meanwhile (a generation finishing, an upload) must still reach the server, now on top of
   * the new version. `adopt` would mark it saved unsent, and Export would miss that media.
   * A save already in flight was sent against the old version: a 409 from it is the Assistant's
   * own write, not another tab, so it must not stop autosave.
   */
  rebase(document: ClipDocument, version: number, documentHash: string | null): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.epoch++;
    this.document = document;
    this.version = version;
    this.savedJson = canonicalJson(document);
    this.documentHash = documentHash;
    this.undoStack = [];
    this.redoStack = [];
    this.status = "saved";
    this.error = null;
    this.conflictWith = null;
    this.changed();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private dirty(): boolean {
    return canonicalJson(this.document) !== this.savedJson || json(this.manifest) !== this.savedManifest;
  }

  private changed(): void {
    if (this.status !== "conflict") {
      this.status = this.dirty() ? (this.inflight ? "saving" : "pending") : this.inflight ? "saving" : "saved";
      this.error = null;
      this.schedule();
    }
    this.emit();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.inflight || !this.dirty()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, this.delay);
  }

  private save(): Promise<void> {
    if (this.inflight) return this.inflight;
    const document = this.document;
    const manifest = this.manifest;
    const documentJson = canonicalJson(document);
    const manifestJson = json(manifest);
    const epoch = this.epoch;
    this.status = "saving";
    this.emit();
    this.inflight = (async () => {
      try {
        const saved = await this.transport.save(this.version, document, manifest);
        // After a `rebase` the server still has this library (only this tab writes the manifest),
        // but the document is the rebased one unless this save landed after it.
        this.savedManifest = manifestJson;
        if (epoch === this.epoch || saved.version > this.version) {
          this.version = saved.version;
          this.savedJson = documentJson;
          this.documentHash = saved.document_hash;
        }
        this.status = this.dirty() ? "pending" : "saved";
        this.error = null;
      } catch (error) {
        if (epoch !== this.epoch) {
          this.status = this.dirty() ? "pending" : "saved";
        } else if (error instanceof SaveConflict) {
          this.status = "conflict";
          this.conflictWith = error.current;
        } else {
          this.status = "error";
          this.error = (error as Error).message || "Could not save your changes.";
        }
      } finally {
        this.inflight = null;
      }
      if (this.status === "pending") this.schedule();
      this.emit();
    })();
    return this.inflight;
  }

  private build(): SessionState {
    return {
      document: this.document,
      manifest: this.manifest,
      version: this.version,
      status: this.status,
      error: this.error,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      documentHash: this.dirty() ? null : this.documentHash,
    };
  }

  private emit(): void {
    this.snapshot = this.build();
    for (const listener of this.listeners) listener();
  }
}
