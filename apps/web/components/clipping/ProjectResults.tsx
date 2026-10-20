"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Project, TranscriptArtifact } from "@/lib/clipping-types";

import { ApiError, api, type ApiFn } from "./api";
import { ClipResultRow } from "./ClipResultRow";
import { segmentsForClip } from "./clip-presentation";
import { projectHref } from "./ProjectLibrary";
import { pickerPath } from "@/lib/clipping/segments";

type SortKey = "time" | "score" | "duration";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "time", label: "Timeline" },
  { value: "score", label: "Selection score" },
  { value: "duration", label: "Length" },
];

export function ProjectResults({
  project,
  focusClipId,
  onFocusClip,
  onEditClip,
  apiFn = api,
  onDownloadEdits,
  onDownloadOriginals,
  onRefresh,
  zipBusy = false,
}: {
  project: Project;
  focusClipId: string | null;
  onFocusClip: (clipId: string) => void;
  onEditClip: (clipId: string) => void;
  /** Injectable để test component. */
  apiFn?: ApiFn;
  /**
   * Web gói ZIP bằng một task chạy nền (file nằm ở Storage, không ở đĩa của
   * server), nên đây là một nút chứ không phải một link.
   */
  onDownloadEdits?: (clipIds: string[]) => void;
  onDownloadOriginals?: (clipIds: string[]) => void;
  /** Đọc lại project — dùng sau khi một bản render khung mới đã xong. */
  onRefresh?: () => void;
  zipBusy?: boolean;
}) {
  // Sắp theo ý đồ: AI chọn thì khoảnh khắc mạnh nhất lên đầu; người dùng tự
  // kéo đoạn thì họ đã có thứ tự trong đầu — giữ đúng dòng thời gian của video.
  const [sort, setSort] = useState<SortKey>(project.segments?.length ? "time" : "score");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [transcript, setTranscript] = useState<TranscriptArtifact["transcript"] | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);

  const clips = useMemo(() => {
    const list = [...project.clips];
    const length = (clip: (typeof list)[number]) => clip.moment.end - clip.moment.start;
    list.sort((a, b) =>
      sort === "score"
        ? b.moment.score - a.moment.score
        : sort === "duration"
          ? length(b) - length(a)
          : a.moment.start - b.moment.start,
    );
    return list;
  }, [project.clips, sort]);

  // Chọn theo ID chứ không theo vị trí hiển thị: đổi cách sắp xếp không được
  // làm ZIP chứa nhầm clip.
  const selectableIds = project.clips
    .filter((clip) => clip.id && clip.available)
    .map((clip) => clip.id as string);
  const selectedIds = selectableIds.filter((id) => selected.has(id));
  const missing = project.clips.filter((clip) => !clip.available).length;

  useEffect(() => {
    if (selectAll.current) {
      selectAll.current.indeterminate =
        selectedIds.length > 0 && selectedIds.length < selectableIds.length;
    }
  }, [selectedIds.length, selectableIds.length]);

  useEffect(() => {
    if (!project.has_transcript || transcript || transcriptError) return;
    let cancelled = false;
    apiFn<TranscriptArtifact>(`/projects/${encodeURIComponent(project.id)}/transcript`)
      .then((data) => {
        if (!cancelled) setTranscript(data.transcript);
      })
      .catch((err) => {
        if (!cancelled) {
          setTranscriptError(
            err instanceof ApiError ? err.message : "Could not load the transcript.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.has_transcript, transcript, transcriptError, project.id, apiFn]);

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  if (project.clips.length === 0) {
    // "Pick again": a link comes back in the picker with the same moments; an upload has no link to
    // fill in, so the picker opens on the Clips tab to choose the file again.
    const isLink = /^https?:\/\//i.test(project.source_name);
    const moments = (project.segments ?? []).map((s) => ({ start: Number(s.start), end: Number(s.end) }));
    const again = isLink ? pickerPath({ source: project.source_name, segments: moments }) : pickerPath();
    return (
      <div className="processing-panel">
        <h2>No clips came out of these moments</h2>
        <p>The moments you picked gave no usable clip. Pick them again, or try a video with more speech.</p>
        <a className="primary-button" href={again}>
          Pick again
        </a>
      </div>
    );
  }

  // ZIP bản đã chỉnh chỉ hiện khi MỌI clip đang chọn đã có export — nút dẫn tới
  // lỗi 409 thì thà đừng có.
  const allExported =
    selectedIds.length > 0 &&
    selectedIds.every((id) => project.clips.find((clip) => clip.id === id)?.export_url);

  return (
    <>
      <div className="results-heading">
        <h2>
          {project.clips.length} {project.clips.length === 1 ? "clip" : "clips"} ready
        </h2>
      </div>

      {project.status === "done" && project.clips.length < project.clips_requested && (
        <p className="result-note">
          We found {project.clips.length} usable moments out of {project.clips_requested}{" "}
          requested.
        </p>
      )}
      {missing > 0 && (
        <p className="result-note warning">
          {missing === 1 ? "One clip file is" : `${missing} clip files are`} currently unavailable. Refresh this project to check again.
        </p>
      )}

      <div className="results-toolbar">
        <label className="select-all">
          <input
            ref={selectAll}
            type="checkbox"
            disabled={!selectableIds.length}
            checked={selectableIds.length > 0 && selectedIds.length === selectableIds.length}
            onChange={(event) =>
              setSelected(event.target.checked ? new Set(selectableIds) : new Set())
            }
          />
          {selectedIds.length ? `${selectedIds.length} selected` : "Select all"}
        </label>
        <label className="results-sort">
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {/* Chưa chọn gì thì nút tải tất cả — trước đây nó bị khoá tới khi người
            dùng tìm ra ô "Select all", tức là một bước thừa cho việc hay làm nhất. */}
        <button type="button" className="secondary-button"
          disabled={!selectableIds.length || zipBusy || !onDownloadOriginals}
          onClick={() => onDownloadOriginals?.(selectedIds.length ? selectedIds : selectableIds)}>
          {zipBusy ? "Packing…" : selectedIds.length ? "Download selected (.zip)" : "Download all (.zip)"}
        </button>
        {allExported && onDownloadEdits && (
            <button
              type="button"
              className="secondary-button"
              disabled={zipBusy}
              onClick={() => onDownloadEdits(selectedIds)}
            >
              {zipBusy ? "Packing…" : "Download edits with .srt (.zip)"}
            </button>
          )}
      </div>

      {transcriptError && (
        <p className="result-note warning">
          {transcriptError}
          <button type="button" className="text-button" onClick={() => setTranscriptError(null)}>
            Retry transcript
          </button>
        </p>
      )}

      <div className="local-clips">
        {clips.map((clip) => (
          <ClipResultRow
            key={clip.id ?? clip.index}
            clip={clip}
            href={projectHref(project.id, clip.id)}
            selected={!!clip.id && selected.has(clip.id)}
            focused={!!clip.id && clip.id === focusClipId}
            onSelect={(on) => clip.id && toggle(clip.id, on)}
            onFocus={() => clip.id && onFocusClip(clip.id)}
            onEdit={
              clip.revision !== null && clip.id
                ? () => onEditClip(clip.id as string)
                : undefined
            }
            transcript={segmentsForClip(
              transcript,
              clip.moment.start,
              clip.moment.end,
            )}
            transcriptLoading={Boolean(project.has_transcript && !transcript && !transcriptError)}
            hasTranscript={Boolean(project.has_transcript)}
            apiFn={apiFn}
          />
        ))}
      </div>
    </>
  );
}
