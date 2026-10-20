"use client";

/**
 * The full-size clip picker (plan item 1): a big player with the moment timeline under it, shown
 * over the editor. The small Clips panel only chooses the video; picking happens here.
 *
 * Every clip is a moment the user picked: there is no AI picking and no clip count or length
 * (owner decision 8). Uploads play from the local file before it is uploaded (no bytes leave the
 * browser until Make clips), links play in the YouTube IFrame player. Other links cannot be
 * previewed under the CSP (`media-src` only lists our own origins), so they are asked to upload.
 *
 * Keys: Space plays, `I` marks a start, `O` closes the moment (or adds a 30 s one without a mark),
 * Delete removes the moment under the playhead, Escape closes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { SegmentBar } from "@/components/clipping/web/SegmentBar";
import { useYouTubePlayer, youtubeId, type PlayerHandle } from "@/components/clipping/web/YouTubePlayer";
import type { AspectRatio } from "@/lib/clipping-types";
import { clock, freeMoment, markedMoment, MAX_SEGMENTS, type Segment } from "@/lib/clipping/segments";

export type PickerSource = { kind: "file"; file: File } | { kind: "link"; url: string };
type Captions = "on" | "off";

const ASPECTS: AspectRatio[] = ["9:16", "1:1", "16:9"];

/** The same handle as the YouTube hook, for a `<video>` on a local file. */
function useFilePlayer(file: File | null): PlayerHandle & { videoRef: (node: HTMLVideoElement | null) => void; src: string | null } {
  const video = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return setSrc(null);
    const url = URL.createObjectURL(file);
    setSrc(url);
    setDuration(0);
    setTime(0);
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    video.current = node;
    if (!node) return;
    node.onloadedmetadata = () => setDuration(Number.isFinite(node.duration) ? node.duration : 0);
    node.ontimeupdate = () => setTime(node.currentTime);
    node.onplay = () => setPlaying(true);
    node.onpause = () => setPlaying(false);
    node.onerror = () => setError("This file can't be played in your browser, so its moments can't be picked. Convert it to MP4 and try again.");
  }, []);

  return {
    duration,
    time,
    ready: duration > 0,
    error,
    playing,
    src,
    videoRef,
    seek: useCallback((seconds: number) => {
      if (video.current) video.current.currentTime = Math.max(0, seconds);
      setTime(Math.max(0, seconds));
    }, []),
    play: useCallback(() => void video.current?.play(), []),
    pause: useCallback(() => video.current?.pause(), []),
  };
}

type Props = {
  source: PickerSource;
  segments: Segment[];
  onSegments: (segments: Segment[]) => void;
  aspect: AspectRatio;
  onAspect: (aspect: AspectRatio) => void;
  captions: Captions;
  onCaptions: (captions: Captions) => void;
  /** Links only: the "Is this your video?" confirmation, recorded with the job. */
  mine: boolean;
  onMine: (mine: boolean) => void;
  busy: boolean;
  progress: number | null;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
};

export function ClipPicker(props: Props) {
  const { source, segments, onSegments, busy } = props;
  const link = source.kind === "link" ? source.url : null;
  const videoId = link ? youtubeId(link) : null;
  const youtube = useYouTubePlayer(videoId);
  const local = useFilePlayer(source.kind === "file" ? source.file : null);
  const player: PlayerHandle = source.kind === "file" ? local : youtube;
  const [mark, setMark] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const previewable = source.kind === "file" || Boolean(videoId);

  const add = useCallback(
    (moment: Segment) => onSegments([...segments, moment].sort((a, b) => a.start - b.start)),
    [onSegments, segments],
  );

  const addAtPlayhead = useCallback(() => {
    const moment = freeMoment(segments, player.time, player.duration);
    if (moment) {
      add(moment);
      setNotice(null);
    } else {
      setNotice(segments.length >= MAX_SEGMENTS ? `You can pick up to ${MAX_SEGMENTS} moments.` : "Move the playhead to a free spot first.");
    }
  }, [add, player.duration, player.time, segments]);

  const remove = useCallback((index: number) => onSegments(segments.filter((_, i) => i !== index)), [onSegments, segments]);

  // Keys work anywhere in the picker except while typing in a field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, select, textarea")) return;
      if (event.key === "Escape") return props.onClose();
      if (!player.ready || busy) return;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        if (player.playing) player.pause();
        else player.play();
      } else if (key === "i") {
        setMark(player.time);
        setNotice(null);
      } else if (key === "o") {
        if (mark === null) return addAtPlayhead();
        const result = markedMoment(segments, mark, player.time);
        if ("moment" in result) {
          add(result.moment);
          setNotice(null);
        } else setNotice(result.problem);
        setMark(null);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        const index = segments.findIndex((s) => player.time >= s.start && player.time < s.end);
        if (index >= 0) remove(index);
      } else return;
      event.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [add, addAtPlayhead, busy, mark, player, props, remove, segments]);

  const needsOwnership = source.kind === "link";
  const canSubmit = segments.length > 0 && (!needsOwnership || props.mine) && !busy;
  const title = source.kind === "file" ? source.file.name : link;

  return (
    <div className="clip-picker-backdrop" data-testid="clip-picker">
      <div className="clip-picker" role="dialog" aria-modal="true" aria-label="Pick the moments to clip">
        <header className="clip-picker-head">
          <div>
            <h2>Pick the moments to clip</h2>
            <small title={title ?? undefined}>{title}</small>
          </div>
          <button type="button" className="ed2-btn" onClick={props.onClose} disabled={busy}>Close</button>
        </header>

        <div className="clip-picker-body">
          <div className="clip-picker-stage">
            {source.kind === "file" ? (
              local.src ? <video ref={local.videoRef} src={local.src} controls playsInline preload="metadata" data-testid="picker-video" /> : null
            ) : videoId ? (
              <div className="clip-picker-yt" ref={youtube.mountRef} />
            ) : (
              <p className="clip-picker-empty">
                This link can&apos;t be previewed here, so its moments can&apos;t be picked. Upload the video file instead, or use a YouTube link.
              </p>
            )}
            {player.error ? <p className="ed2-clips-error" role="alert">{player.error}</p> : null}
          </div>

          {previewable ? (
            <SegmentBar
              duration={player.duration}
              time={player.time}
              segments={segments}
              mark={mark}
              disabled={busy}
              onChange={onSegments}
              onSeek={player.seek}
            />
          ) : null}

          <div className="clip-picker-tools">
            <button type="button" className="ed2-btn" onClick={addAtPlayhead} disabled={!player.ready || busy} data-testid="picker-add">
              Add a moment
            </button>
            <small className="ed2-clips-hint">
              {mark !== null ? `Start marked at ${clock(mark)}. Press O at the end.` : "Press I at a start and O at the end. Space plays."}
            </small>
            <span className="clip-picker-time">{player.ready ? `${clock(player.time)} / ${clock(player.duration)}` : ""}</span>
          </div>
          {notice ? <p className="ed2-clips-error" role="status">{notice}</p> : null}

          <ol className="clip-picker-list" aria-label="Picked moments">
            {segments.map((segment, index) => (
              <li key={`${index}-${segment.start}`}>
                <button type="button" className="clip-picker-jump" onClick={() => player.seek(segment.start)}>
                  <b>Clip {index + 1}</b> {clock(segment.start)} – {clock(segment.end)} · {Math.round(segment.end - segment.start)} s
                </button>
                <button type="button" className="ed2-clips-switch" onClick={() => remove(index)} disabled={busy} aria-label={`Remove clip ${index + 1}`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          {segments.length === 0 ? <p className="ed2-clips-hint">Each moment you pick becomes one clip, as long as the moment.</p> : null}
        </div>

        <footer className="clip-picker-foot">
          <fieldset className="ed2-clips-seg" role="radiogroup" aria-label="Aspect ratio">
            <legend>Frame</legend>
            {ASPECTS.map((value) => (
              <label key={value} className={props.aspect === value ? "is-on" : ""}>
                <input type="radio" name="picker-aspect" value={value} checked={props.aspect === value} disabled={busy} onChange={() => props.onAspect(value)} />
                {value}
              </label>
            ))}
          </fieldset>
          <fieldset className="ed2-clips-seg" role="radiogroup" aria-label="Captions">
            <legend>Captions</legend>
            {(["on", "off"] as const).map((value) => (
              <label key={value} className={props.captions === value ? "is-on" : ""}>
                <input type="radio" name="picker-captions" value={value} checked={props.captions === value} disabled={busy} onChange={() => props.onCaptions(value)} />
                {value === "on" ? "On" : "Off"}
              </label>
            ))}
          </fieldset>
          {needsOwnership ? (
            <label className="ed2-clips-own">
              <input type="checkbox" checked={props.mine} disabled={busy} data-testid="picker-own" onChange={(event) => props.onMine(event.target.checked)} />
              <span>
                <b>{videoId ? "Is this your YouTube video?" : "Is this your video?"}</b> Yes, I made it or I own the rights to it.
                <small>OpenCMO only makes clips from your own videos. We keep this confirmation with the job.</small>
              </span>
            </label>
          ) : null}
          {props.error ? <p className="ed2-clips-error" role="alert">{props.error}</p> : null}
          <button type="button" className="ed2-btn ed2-primary" disabled={!canSubmit} onClick={props.onSubmit} data-testid="picker-submit">
            {props.progress !== null
              ? `Uploading ${props.progress}%`
              : busy
                ? "Starting…"
                : segments.length
                  ? `Make ${segments.length} ${segments.length === 1 ? "clip" : "clips"}`
                  : "Make clips"}
          </button>
        </footer>
      </div>
    </div>
  );
}
