"use client";

/**
 * Record a take in the browser, with the script beside the lens (plan 2026-11-15 A1).
 *
 * The camera preview is mirrored like a selfie; the file is not. Slices land on the device every few seconds
 * (`SliceStore`), so a closed tab can be recovered the next time the recorder opens. The finished take is handed to
 * the caller as a plain File: it goes up the same way as any upload (TUS, never through Next.js), and the worker
 * treats it as untrusted user media.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ScriptBeat } from "@/lib/cmo/writer/types";

import {
  beatAt,
  clockLabel,
  COUNTDOWN_SECONDS,
  discardTake,
  pickMime,
  rebuildTake,
  SLICE_MS,
  SliceStore,
  storedTakes,
  TakeClock,
  takeName,
  type StoredTake,
} from "./recorder";

type Phase = "idle" | "countdown" | "recording" | "paused" | "saving";
type Device = { id: string; label: string };

export type RecorderProps = {
  /** The script's beats when the edit came from one: the prompter shows them, paced by their seconds. */
  beats?: ScriptBeat[];
  title?: string;
  /** Where the take goes, e.g. "It goes into this edit at the playhead." */
  destination: string;
  /** The take must have picture (a new edit is a video); the camera cannot be turned off. */
  requireCamera?: boolean;
  onDone: (file: File, seconds: number) => Promise<void> | void;
  onClose: () => void;
};

const MAX_TEXT = 12_000;
const FONT = { min: 16, max: 40, step: 4, initial: 24 };

export function Recorder({ beats, title, destination, requireCamera = false, onDone, onClose }: RecorderProps) {
  const [cameras, setCameras] = useState<Device[]>([]);
  const [mics, setMics] = useState<Device[]>([]);
  const [camera, setCamera] = useState<string>("");
  const [mic, setMic] = useState<string>("");
  const [cameraOn, setCameraOn] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const meter = useRef<HTMLMeterElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [font, setFont] = useState(FONT.initial);
  const [beat, setBeat] = useState(0);
  const [follow, setFollow] = useState(true);
  // The clock's interval reads this, not `follow`: it is created once per take and would keep the first value.
  const following = useRef(true);
  following.current = follow;
  const [left, setLeft] = useState<StoredTake[]>([]);
  const [live, setLive] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const store = useRef<SliceStore | null>(null);
  const clock = useRef(new TakeClock());
  const mime = useRef<string>("");
  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);

  const hasScript = Boolean(beats?.length);
  const busy = phase !== "idle";

  // ---------------------------------------------------------------- devices and preview

  const stopStream = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLive(false);
  }, []);

  const openStream = useCallback(async () => {
    stopStream();
    setError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: mic ? { deviceId: { exact: mic } } : true,
        video: cameraOn ? (camera ? { deviceId: { exact: camera } } : { width: { ideal: 1920 }, height: { ideal: 1080 } }) : false,
      });
      stream.current = next;
      setLive(true);
      if (video.current) video.current.srcObject = next;
      // Labels are empty until the user has granted access once, so list devices after the stream opens.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const named = (kind: MediaDeviceKind, fallback: string) =>
        devices.filter((device) => device.kind === kind).map((device, i) => ({ id: device.deviceId, label: device.label || `${fallback} ${i + 1}` }));
      setCameras(named("videoinput", "Camera"));
      setMics(named("audioinput", "Microphone"));
    } catch (failure) {
      const name = (failure as { name?: string }).name;
      setError(
        name === "NotAllowedError"
          ? "The browser blocked the camera or microphone. Allow them in the address bar, then try again."
          : name === "NotFoundError"
            ? "No camera or microphone was found."
            : "The camera or microphone could not start. Close other apps using it and try again.",
      );
    }
  }, [camera, cameraOn, mic, stopStream]);

  useEffect(() => {
    if (busy) return;
    void openStream();
  }, [openStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // Level meter: a peak of the microphone, read every animation frame.
  useEffect(() => {
    const current = stream.current;
    if (!current || !current.getAudioTracks().length) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(current);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const value of data) peak = Math.max(peak, Math.abs(value - 128) / 128);
      // Straight to the element: a state update here would re-render the dialog every frame of the take.
      if (meter.current) meter.current.value = peak;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [live]);

  useEffect(() => {
    void storedTakes().then(setLeft);
  }, []);

  // Closing the dialog stops everything; a take still running is dropped (its slices stay for recovery).
  useEffect(
    () => () => {
      cancelled.current = true;
      if (timer.current) window.clearInterval(timer.current);
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      stopStream();
    },
    [stopStream],
  );

  // Leaving the page mid-take asks first.
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [phase]);

  // ---------------------------------------------------------------- recording

  const tickClock = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const now = clock.current.seconds(performance.now());
      setSeconds(now);
      if (hasScript && following.current) setBeat(beatAt(beats!, now));
    }, 200);
  };

  const begin = () => {
    const current = stream.current;
    if (!current) return;
    const chosen = pickMime((type) => MediaRecorder.isTypeSupported(type), cameraOn ? "video" : "audio");
    if (!chosen) {
      setError("This browser cannot record video. Try Chrome, Edge, Firefox or Safari.");
      setPhase("idle");
      return;
    }
    mime.current = chosen;
    chunks.current = [];
    cancelled.current = false;
    const id = crypto.randomUUID();
    store.current = new SliceStore({ id, mime: chosen, seconds: 0, startedAt: new Date().toISOString(), slices: 0 });
    void store.current.begin();
    const next = new MediaRecorder(current, { mimeType: chosen, videoBitsPerSecond: 6_000_000 });
    next.ondataavailable = (event) => {
      if (!event.data.size) return;
      chunks.current.push(event.data);
      void store.current?.add(event.data, clock.current.seconds(performance.now()));
    };
    next.onstop = () => void finish();
    next.onerror = () => {
      setError("The recording stopped unexpectedly. What was recorded so far is kept.");
    };
    recorder.current = next;
    next.start(SLICE_MS);
    clock.current.start(performance.now());
    setSeconds(0);
    setBeat(0);
    setPhase("recording");
    tickClock();
  };

  const start = () => {
    if (busy || !stream.current) return;
    setError(null);
    // A "Start over" left this set; the countdown below stops when it is.
    cancelled.current = false;
    setPhase("countdown");
    let left = COUNTDOWN_SECONDS;
    setCount(left);
    const step = window.setInterval(() => {
      left -= 1;
      if (cancelled.current) return window.clearInterval(step);
      if (left > 0) return setCount(left);
      window.clearInterval(step);
      begin();
    }, 1000);
  };

  const pause = () => {
    if (recorder.current?.state !== "recording") return;
    recorder.current.pause();
    clock.current.pause(performance.now());
    setPhase("paused");
  };
  const resume = () => {
    if (recorder.current?.state !== "paused") return;
    recorder.current.resume();
    clock.current.resume(performance.now());
    setPhase("recording");
  };
  const stop = () => {
    if (!recorder.current || recorder.current.state === "inactive") return;
    clock.current.stop(performance.now());
    if (timer.current) window.clearInterval(timer.current);
    setPhase("saving");
    recorder.current.stop();
  };
  /** Throw the take away and start again. */
  const restart = () => {
    cancelled.current = true;
    if (timer.current) window.clearInterval(timer.current);
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    const take = store.current;
    store.current = null;
    if (take) void take.discard();
    chunks.current = [];
    setSeconds(0);
    setBeat(0);
    setPhase("idle");
  };

  async function finish() {
    if (cancelled.current) return;
    const take = store.current;
    const length = clock.current.seconds(performance.now());
    const type = mime.current.split(";")[0]!;
    const file = new File(chunks.current, takeName(new Date(), mime.current), { type });
    chunks.current = [];
    if (!file.size || length < 0.5) {
      setError("Nothing was recorded. Check the microphone and try again.");
      setPhase("idle");
      if (take) void take.discard();
      return;
    }
    try {
      await onDone(file, length);
      if (take) await take.discard();
      onClose();
    } catch (failure) {
      // The slices stay on the device: the take can be recovered from the list next time.
      setError(`${(failure as Error).message || "The take could not be saved."} It is kept on this device.`);
      setPhase("idle");
      void storedTakes().then(setLeft);
    }
  }

  const recover = async (take: StoredTake) => {
    const file = await rebuildTake(take);
    if (!file) {
      setError("That recording could not be read back.");
      return;
    }
    setPhase("saving");
    try {
      await onDone(file, take.seconds);
      await discardTake(take.id);
      onClose();
    } catch (failure) {
      setError((failure as Error).message || "The take could not be saved.");
      setPhase("idle");
    }
  };
  const drop = async (take: StoredTake) => {
    await discardTake(take.id);
    setLeft((all) => all.filter((item) => item.id !== take.id));
  };

  // Space starts, pauses and resumes; Escape closes when nothing is recording.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // Space on a focused control is that control's own click; acting here too would run it twice.
      if (event.target instanceof HTMLElement && event.target.closest("textarea, select, input, button")) return;
      if (event.key === "Escape" && phase === "idle") onClose();
      if (event.key === " ") {
        event.preventDefault();
        if (phase === "idle") start();
        else if (phase === "recording") pause();
        else if (phase === "paused") resume();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // ---------------------------------------------------------------- view

  const current = hasScript ? beats![Math.min(beat, beats!.length - 1)] : null;
  const next = hasScript && beat + 1 < beats!.length ? beats![beat + 1] : null;

  return (
    <div className="ed2-dialog-backdrop" role="presentation">
      <div className="ed2-dialog ed2-rec" role="dialog" aria-modal="true" aria-label="Record a take" data-testid="recorder">
        <header className="ed2-rec-head">
          <h2 className="ed2-dialog-title">{title ? `Record: ${title}` : "Record a take"}</h2>
          <span className="ed2-grow" />
          <button type="button" className="ed2-icon" aria-label="Close recorder" disabled={phase === "recording" || phase === "paused" || phase === "saving"} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="ed2-rec-body">
          <div className="ed2-rec-stage">
            {cameraOn ? <video ref={video} className="ed2-rec-video" autoPlay muted playsInline /> : <div className="ed2-rec-video is-off">Microphone only</div>}
            {phase === "countdown" ? <div className="ed2-rec-count" aria-live="assertive">{count}</div> : null}
            <div className="ed2-rec-badge" data-phase={phase}>
              {phase === "recording" ? "● " : phase === "paused" ? "Paused · " : ""}
              {clockLabel(seconds)}
            </div>
            <meter ref={meter} className="ed2-rec-level" min={0} max={1} defaultValue={0} aria-label="Microphone level" />
          </div>

          <aside className="ed2-rec-prompter" aria-label="Prompter" style={{ fontSize: font, lineHeight: `${Math.round(font * 1.4)}px` }}>
            {hasScript ? (
              <>
                <p className="ed2-rec-beat" data-testid="recorder-beat">{current?.say}</p>
                {next ? <p className="ed2-rec-next">{next.say}</p> : null}
              </>
            ) : (
              <textarea
                className="ed2-rec-text"
                value={text}
                maxLength={MAX_TEXT}
                placeholder="Paste what you want to say. It stays beside the camera while you record."
                aria-label="Prompter text"
                onChange={(event) => setText(event.target.value.slice(0, MAX_TEXT))}
              />
            )}
          </aside>
        </div>

        <div className="ed2-rec-tools">
          <button type="button" className="ed2-icon" aria-label="Smaller text" disabled={font <= FONT.min} onClick={() => setFont((f) => Math.max(FONT.min, f - FONT.step))}>
            A−
          </button>
          <button type="button" className="ed2-icon" aria-label="Larger text" disabled={font >= FONT.max} onClick={() => setFont((f) => Math.min(FONT.max, f + FONT.step))}>
            A+
          </button>
          {hasScript ? (
            <>
              <button type="button" className="ed2-icon" aria-label="Previous line" disabled={beat === 0} onClick={() => (setFollow(false), setBeat((b) => Math.max(0, b - 1)))}>
                ‹
              </button>
              <small className="ed2-muted">
                {beat + 1} / {beats!.length}
              </small>
              <button type="button" className="ed2-icon" aria-label="Next line" disabled={beat >= beats!.length - 1} onClick={() => (setFollow(false), setBeat((b) => Math.min(beats!.length - 1, b + 1)))}>
                ›
              </button>
              <label className="ed2-rec-check">
                <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> Follow the beat times
              </label>
            </>
          ) : null}
          <span className="ed2-grow" />
          <select aria-label="Camera" value={camera} disabled={busy || !cameraOn} onChange={(event) => setCamera(event.target.value)}>
            <option value="">Default camera</option>
            {cameras.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
          <select aria-label="Microphone" value={mic} disabled={busy} onChange={(event) => setMic(event.target.value)}>
            <option value="">Default microphone</option>
            {mics.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
          <label className="ed2-rec-check">
            <input type="checkbox" checked={cameraOn} disabled={busy || requireCamera} onChange={(event) => setCameraOn(event.target.checked)} /> Camera
          </label>
        </div>

        {error ? <p className="ed2-clips-error" role="alert">{error}</p> : null}

        {left.length && phase === "idle" ? (
          <ul className="ed2-dialog-list" aria-label="Unsaved recordings">
            {left.map((take) => (
              <li key={take.id} className="ed2-rec-left">
                <span>
                  Unsaved recording from {new Date(take.startedAt).toLocaleString()} · {clockLabel(take.seconds)}
                </span>
                <span className="ed2-grow" />
                <button type="button" className="ed2-btn" onClick={() => void recover(take)}>
                  Recover
                </button>
                <button type="button" className="ed2-btn" onClick={() => void drop(take)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <footer className="ed2-rec-foot">
          <small className="ed2-muted">{destination}</small>
          <span className="ed2-grow" />
          {phase === "idle" ? (
            <button type="button" className="ed2-btn ed2-primary" data-testid="recorder-start" disabled={!live} onClick={start}>
              {live || error ? "Start recording" : "Starting camera…"}
            </button>
          ) : null}
          {phase === "countdown" ? (
            <button type="button" className="ed2-btn" onClick={restart}>
              Cancel
            </button>
          ) : null}
          {phase === "recording" || phase === "paused" ? (
            <>
              <button type="button" className="ed2-btn" onClick={restart}>
                Start over
              </button>
              {phase === "recording" ? (
                <button type="button" className="ed2-btn" onClick={pause}>
                  Pause
                </button>
              ) : (
                <button type="button" className="ed2-btn" onClick={resume}>
                  Resume
                </button>
              )}
              <button type="button" className="ed2-btn ed2-primary" data-testid="recorder-stop" onClick={stop}>
                Stop and use take
              </button>
            </>
          ) : null}
          {phase === "saving" ? <span className="ed2-muted">Saving the take…</span> : null}
        </footer>
      </div>
    </div>
  );
}
