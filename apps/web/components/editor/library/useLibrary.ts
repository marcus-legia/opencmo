"use client";

/**
 * Connects the library to the session: every manifest change is a queued `session.transact`, so
 * it is saved in the same request as the document and applies to the latest one. Library changes
 * are not Undo steps; renaming an asset makes elements follow with a `replace_src` op, and that
 * part is an Undo step.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  addAsset,
  createFolder,
  deleteFolder,
  moveAssets,
  moveFolder,
  normalizeManifest,
  orphanedMedia,
  removeAssets,
  renameAsset,
  renameFolder,
  uniqueFolderName,
  updateAsset,
  isPartial,
  type AssetRecord,
  type LibraryRecord,
  type Manifest,
  type Rename,
} from "@opencmo/clip-assets";
import type { ClipDocument } from "@opencmo/clip-doc";
import { readTranscriptText } from "@opencmo/clip-render";
import { activeScene, applyOps, walk, type OpContext } from "@opencmo/editor-core";

import type { DocumentSession } from "@/lib/editor/session";

import { elementsForGeneration } from "../generate/useGenerations";

import { deleteRemote, describe, keepLocal, nodeFor, readLocal, removeLocal, uploadable, upload } from "./store";

/** `device` = không lên Storage được (ảnh, âm thanh): khác `local` ở chỗ Retry vô ích. */
export type CloudDisplay = "uploading" | "synced" | "failed" | "local" | "device";

export type LibraryApi = {
  manifest: Manifest;
  progress: Record<string, number>;
  cloudOf: (record: LibraryRecord) => CloudDisplay | null;
  importFiles: (files: File[], folder: string) => Promise<LibraryRecord[]>;
  retry: (id: string) => void;
  rename: (id: string, name: string) => void;
  move: (ids: string[], folder: string) => void;
  remove: (ids: string[]) => void;
  createFolder: (parent: string) => string;
  renameFolder: (path: string, name: string) => void;
  moveFolder: (path: string, into: string) => void;
  deleteFolder: (path: string) => void;
  insert: (record: LibraryRecord, options: { at?: { x: number; y: number }; start: number }) => Promise<string | null>;
  /** Sửa manifest bất kỳ trên bản MỚI NHẤT (Generate ghi partial/record qua đây). */
  update: (change: (current: Manifest) => Manifest) => Promise<void>;
  /** Manifest mới nhất của session (không đợi React render lại). */
  latest: () => Manifest;
};

type Change = Manifest | { manifest: Manifest; renames: Rename[] };

export function useLibrary({
  session,
  manifestState,
  clipId,
  projectId,
  context,
  notify,
  onLocalBytes,
}: {
  session: DocumentSession;
  manifestState: unknown;
  clipId: string;
  projectId: string;
  context: () => OpContext;
  notify: (message: string) => void;
  /** Bytes vừa vào OPFS — nguồn trước đó thiếu bytes có thể vẽ được rồi. */
  onLocalBytes: () => void;
}): LibraryApi {
  const manifest = useMemo(() => normalizeManifest(manifestState), [manifestState]);
  // File của lượt upload đang chạy TRONG PHIÊN NÀY — để thử lại. Record nói
  // `uploading` mà không có ở đây nghĩa là tab tải lên đã đóng giữa chừng.
  const files = useRef(new Map<string, File>());
  const [progress, setProgress] = useState<Record<string, number>>({});

  /** Change the LATEST manifest (background uploads come back late). */
  const change = useCallback(
    async (update: (current: Manifest) => Change) => {
      await session.transact(
        async (latest, latestManifest) => {
          const current = normalizeManifest(latestManifest);
          const result = update(current);
          const next = "renames" in result ? result.manifest : result;
          const renames = "renames" in result ? result.renames : [];
          if (next === current && !renames.length) return latest;
          if (!renames.length) return { document: latest, manifest: next, history: false };
          const applied = await applyOps(latest, [{ op: "replace_src", renames }], context());
          return { document: applied.document as ClipDocument, manifest: next };
        },
        { label: "Library change" },
      );
    },
    [context, session],
  );

  const sync = useCallback(
    async (record: AssetRecord, file: File) => {
      files.current.set(record.id, file);
      await change((current) => updateAsset(current, record.id, { cloud: { state: "uploading" } }));
      try {
        const mediaId = await upload(projectId, file, (fraction) =>
          setProgress((all) => ({ ...all, [record.id]: fraction })),
        );
        await change((current) => updateAsset(current, record.id, { cloud: { state: "synced", mediaId } }));
        files.current.delete(record.id);
      } catch (error) {
        // Không chí mạng: bytes còn trong OPFS, dùng được trên máy này. Nhưng
        // người dùng phải biết nó chưa an toàn.
        await change((current) => updateAsset(current, record.id, { cloud: { state: "failed" } }));
        notify(`${record.path.split("/").pop()} is only on this device. ${(error as Error).message}`);
      } finally {
        setProgress((all) => {
          const rest = { ...all };
          delete rest[record.id];
          return rest;
        });
      }
    },
    [change, notify, projectId],
  );

  const importFiles = useCallback(
    async (list: File[], folder: string) => {
      const out: LibraryRecord[] = [];
      for (const file of list) {
        try {
          const described = await describe(file, folder);
          let placed: LibraryRecord = described;
          let fresh = false;
          await change((current) => {
            const added = addAsset(current, described);
            placed = added.record;
            fresh = added.manifest !== current;
            return added.manifest;
          });
          out.push(placed);
          // Cùng bytes đã có (và đã lên Storage) thì không thêm bản thứ hai.
          if (!fresh && (placed as AssetRecord).cloud?.state === "synced") continue;
          await keepLocal(clipId, placed as AssetRecord, file);
          onLocalBytes();
          if (uploadable(placed.type)) void sync(placed as AssetRecord, file);
        } catch (error) {
          notify(`Could not import ${file.name}. ${(error as Error).message}`);
        }
      }
      return out;
    },
    [change, clipId, notify, onLocalBytes, sync],
  );

  const retry = useCallback(
    (id: string) =>
      void (async () => {
        const record = manifest.assets.find((item) => item.id === id) as AssetRecord | undefined;
        if (!record || isPartial(record) || !uploadable(record.type)) return;
        const file = files.current.get(id) ?? (await readLocal(clipId, record.source));
        if (!file) return notify(`${record.path} was only saved on the device that added it.`);
        await sync(record, new File([file], record.path.split("/").pop() ?? "file", { type: record.mimeType }));
      })(),
    [clipId, manifest, notify, sync],
  );

  const forget = useCallback(
    async (removed: LibraryRecord[], after: Manifest) => {
      for (const mediaId of orphanedMedia(after, removed)) await deleteRemote(projectId, mediaId);
      for (const record of removed) if (!isPartial(record)) await removeLocal(clipId, record.source);
    },
    [clipId, projectId],
  );

  const remove = useCallback(
    (ids: string[]) =>
      void (async () => {
        // A generated file leaves with the elements that declare it, in that order: a declaration
        // without its record would be generated again, and charged, without an approval.
        try {
          await session.transact(
            async (latest, latestManifest) => {
              const keys = normalizeManifest(latestManifest)
                .assets.filter((record) => ids.includes(record.id) && record.generation?.key)
                .map((record) => record.generation!.key);
              const uses = [...new Set(keys.flatMap((key) => elementsForGeneration(latest, key)))];
              if (!uses.length) return latest;
              return (await applyOps(latest, uses.map((element_id) => ({ op: "delete_element", element_id })), context())).document;
            },
            { label: "Remove generated media" },
          );
        } catch (error) {
          notify((error as Error).message || "That file is still used on the timeline.");
          return;
        }
        let removed: LibraryRecord[] = [];
        let after: Manifest | null = null;
        await change((current) => {
          const result = removeAssets(current, ids);
          removed = result.removed;
          after = result.manifest;
          return result.manifest;
        });
        if (after) await forget(removed, after);
      })(),
    [change, context, forget, notify, session],
  );

  const insert = useCallback(
    async (record: LibraryRecord, options: { at?: { x: number; y: number }; start: number }) => {
      const scene = activeScene(session.current) as unknown as Record<string, unknown> & { id?: string };
      const node = nodeFor(record, scene, options);
      if (!node || !scene.id) return null;
      // Imported subtitles (.srt/.vtt/.json) are saved as a transcript of the clip: the export runs on
      // the server and reads only stored transcripts, so captions pointing at the device's file
      // previewed fine and then failed Export.
      if (record.type === "TRANSCRIPT" && !isPartial(record) && (node as { kind?: string }).kind === "captions") {
        try {
          const asset = record as AssetRecord;
          const file = files.current.get(asset.id) ?? (await readLocal(clipId, asset.source));
          if (file) {
            const transcript = readTranscriptText(await file.text(), asset.mimeType || file.type || "application/json");
            (node as { src?: unknown }).src = await context().saveTranscript(transcript as never);
          }
        } catch (error) {
          notify(`These subtitles will show here but may not export. ${(error as Error).message}`);
        }
      }
      const ids = (document: ClipDocument) => {
        const out: string[] = [];
        walk(document, ({ entity, tag }) => {
          if (entity.kind === tag && entity.id) out.push(entity.id);
        });
        return out;
      };
      // B-roll and audio go into a row of the same lane that has room (`insert_to_row`), not one row each.
      const rowed = record.type === "VIDEO" || record.type === "IMAGE" || record.type === "AUDIO";
      let before = new Set<string>();
      const after = await session.transact(
        async (latest) => {
          const parent = (activeScene(latest) as unknown as { id?: string }).id;
          if (!rowed && !parent) throw new Error("There is no timeline to add this to.");
          before = new Set(ids(latest));
          const op = rowed ? { op: "insert_to_row", node } : { op: "insert_node", parent_id: parent, node };
          return (await applyOps(latest, [op], context())).document;
        },
        { label: "Insert media" },
      );
      // The new layer may sit inside a row (sequence): search the whole tree; for a new row take the clip, not the row.
      const fresh = ids(after).filter((id) => !before.has(id));
      return fresh[fresh.length - 1] ?? null;
    },
    [clipId, context, notify, session],
  );

  const cloudOf = useCallback(
    (record: LibraryRecord): CloudDisplay | null => {
      if (isPartial(record)) return null;
      const state = (record as AssetRecord).cloud?.state;
      // Ảnh/âm thanh do Generate sinh ra ĐÃ nằm trên Storage (`synced`); chỉ
      // file người dùng nhập mới kẹt trên máy.
      if (state !== "synced" && !uploadable(record.type)) return "device";
      if (!state) return "local";
      if (state === "uploading" && !files.current.has(record.id)) return "local";
      return state;
    },
    [],
  );

  // Fire-and-forget library edits still tell the user when the queued write was refused.
  const fire = (update: (current: Manifest) => Change) =>
    void change(update).catch((error: Error) => notify(error.message || "That library change could not be saved."));

  return {
    manifest,
    progress,
    cloudOf,
    importFiles,
    retry,
    rename: (id, name) => fire((current) => renameAsset(current, id, name)),
    move: (ids, folder) => fire((current) => moveAssets(current, ids, folder)),
    remove,
    createFolder: (parent) => {
      const name = uniqueFolderName(manifest, parent, "New folder");
      const path = parent ? `${parent}/${name}` : name;
      fire((current) => createFolder(current, path));
      return path;
    },
    renameFolder: (path, name) => fire((current) => renameFolder(current, path, name)),
    moveFolder: (path, into) => fire((current) => moveFolder(current, path, into)),
    deleteFolder: (path) =>
      void (async () => {
        let removed: LibraryRecord[] = [];
        let after: Manifest | null = null;
        await change((current) => {
          const result = deleteFolder(current, path);
          removed = result.removed;
          after = result.manifest;
          return result.manifest;
        });
        if (after) await forget(removed, after);
      })(),
    insert,
    update: (apply) => change((current) => apply(current)),
    latest: () => normalizeManifest(session.currentManifest),
  };
}
