/**
 * API shapes of projects, clips, revisions, transcripts and exports, matching
 * `packages/engine/opencmo/editing/models.py`.
 *
 * Every time in `RevisionSettings` is in SOURCE video seconds.
 */

export type ProjectStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export type ProcessingStage =
  | "queued"
  | "probe"
  | "download"
  | "render"
  | "transcribe"
  | "done"
  | "failed"
  | "cancelled";

/**
 * Khung hình chọn lúc TẠO job. Khác `FrameLayout` của revision ở đúng một giá
 * trị: "auto" nghĩa là "cắt nếu dò được mặt, đệm nếu không" — chỉ trả lời được
 * sau khi bám mặt chạy, nên nó không bao giờ đi vào `RevisionSettings`.
 */
export type JobLayout = "auto" | "fill" | "fit";

export type ProjectSettings = {
  aspect: AspectRatio;
  layout: JobLayout;
  captions: boolean;
};

export type Moment = {
  start: number;
  end: number;
  hook: string;
  reason: string;
  score: number;
};

export type ProjectClip = {
  /** Null chỉ khi clip chưa được migrate — không dùng cho editor/export. */
  id: string | null;
  index: number;
  revision: number | null;
  moment: Moment;
  /** False khi file clip đã bị xoá khỏi đĩa; media URL khi đó trả 410. */
  available: boolean;
  /** Tỷ lệ của chính file đang phát ở `preview_url`, không phải mặc định của job. */
  preview_aspect?: AspectRatio;
  /** Kích thước output có thể download; preview trên trang có thể nhẹ hơn. */
  preview_width?: number;
  preview_height?: number;
  preview_url: string;
  download_url: string;
  /** Bản export mới nhất đã xong, null khi clip chưa được export lần nào. */
  export_url: string | null;
  export_revision: number | null;
};

export type Project = {
  id: string;
  source_name: string;
  /** Tên người dùng đặt nếu có, không thì tiêu đề lấy từ probe. */
  title: string | null;
  favorite: boolean;
  status: ProjectStatus;
  stage: ProcessingStage;
  duration: number | null;
  clips_requested: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  settings: ProjectSettings;
  /** Lúc attempt gần nhất bắt đầu; null khi chưa worker nào nhận. */
  attempt_started_at: string | null;
  clips: ProjectClip[];
  /** Preview của clip đầu tiên trên trang thư viện; null khi chưa có clip. */
  thumbnail_url?: string | null;
  /**
   * Chỉ có ở danh sách project: số clip của job. Danh sách không gửi `clips`
   * (nặng), nên đếm `clips` ở đó luôn ra 0 và mọi project xong đều ghi "No usable
   * moments found" (UAT production 29/09).
   */
  clip_count?: number;
  /** Chỉ có ở `GET /projects/{id}`. */
  has_transcript?: boolean;
};

export type ProjectPage = {
  items: Project[];
  next_cursor: string | null;
};

export type AspectRatio = "9:16" | "1:1" | "16:9";
export type FrameLayout = "fill" | "fit" | "manual";

export type TextEdit = {
  start: number;
  end: number;
  text: string;
};

export type RevisionSettings = {
  source_start: number;
  source_end: number;
  aspect: AspectRatio;
  layout: FrameLayout;
  /** 0–1 theo bề ngang khung nguồn; bắt buộc khi `layout` là "manual". */
  focus_x: number | null;
  captions: boolean;
  /** Đường CŨ: một tiêu đề cố định 0–3 giây. Chỉ còn ở revision đã lưu. */
  headline: string;
  /** Đường MỚI: N lớp chữ, mỗi lớp có khoảng thời gian và style riêng. */
  texts?: TextLayer[];
  text_edits: TextEdit[];
  cuts?: VideoCut[];
  broll?: BRoll[];
  caption_style?: CanvasTextStyle;
  headline_style?: CanvasTextStyle;
};

export type VideoCut = { start: number; end: number };
/** Mốc tính trên TIMELINE (sau cắt ghép), không phải trên video nguồn. */
export type TextLayer = {
  text: string;
  start: number;
  end: number;
  style: CanvasTextStyle;
};
export type BRoll = VideoCut & { asset_id: string; at: number };
export type CanvasTextStyle = {
  font: "DejaVu Sans" | "DejaVu Serif" | "DejaVu Sans Mono";
  size: number;
  color: string;
  bold: boolean;
  x: number;
  y: number;
};
export type EditorMedia = {
  id: string;
  name: string;
  duration: number;
  url: string;
  /** Web upload được probe bất đồng bộ; bản local cũ không có hai trường này. */
  status?: "pending" | "ready" | "failed";
  error?: string | null;
};
export type TranscriptWord = { start: number; end: number; text: string };

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[] | null;
};

export type TranscriptArtifact = {
  artifact_version: number;
  transcript: {
    version: number;
    language: string;
    source: "subs" | "scribe" | "whisper";
    segments: TranscriptSegment[];
  };
};

