/**
 * Document của một clip: JSON có version, là thứ `clip-render` vẽ và (từ B1) là
 * nguồn sự thật thay cho `index.tsx` của fork.
 *
 * Mô hình khớp với cái người dùng đang có trong fork (checklist
 * `docs/editor-parity/checklist.md`), để một project mở trong fork và một project
 * đọc qua document vẽ ra cùng một khung hình. Tên thuộc tính giữ đúng tên prop
 * JSX của fork (bộ chuyển `tsx → document` đã gỡ ở R7) vì Assistant đã quen tên op
 * theo các tên này.
 *
 * ## Quy ước
 *
 * - **Thời gian luôn là GIÂY** (số thực): document không bao giờ chứa chuỗi thời gian
 *   kiểu `"15f"` hay `"02:30"` (`parseTime` đổi chúng sang giây).
 * - **Thuộc tính vắng là mặc định**, không ghi `undefined`. Document là JSON,
 *   nên `-Infinity` của `volume` được viết là chuỗi `"-Infinity"`.
 * - **Thành phần phụ tách theo vai**: `paints`, `strokes`, `shadows`, `effects`,
 *   `masks`, `tracks`, `animations`, `ranges`. Thứ tự TRONG mỗi mảng là thứ tự
 *   chồng lớp; thứ tự GIỮA các mảng không mang nghĩa (ảnh vàng chứng minh điều đó
 *   qua vòng `tsx → document → tsx` được DS vẽ lại).
 * - **`marks`**: dữ liệu OpenCMO gắn vào một container (`opencmo:reframe`,
 *   `opencmo:text-cut`…), mỗi khoá một schema (`MarksSchema`).
 * - Mọi object đều `strict`: prop lạ là lỗi, không bị lặng lẽ bỏ đi.
 */

import { z } from 'zod';

import { parsePath } from './path.ts';

export const DOCUMENT_VERSION = 1;

// ------------------------------------------------------------------ giá trị

const num = z.number().refine(Number.isFinite, 'must be a finite number');
/** Giây. */
const time = num;
const id = z.string().min(1);
const color = z.string().min(1);
const unit = num;
/** dB; `"-Infinity"` là tắt tiếng hẳn. */
const decibels = z.union([num, z.literal('-Infinity')]);

export const BLEND_MODES = [
  'sourceOver',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'colorDodge',
  'colorBurn',
  'hardLight',
  'softLight',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
const blendMode = z.enum(BLEND_MODES);

export const TRACK_PROPERTIES = [
  'x',
  'y',
  'offsetX',
  'offsetY',
  'width',
  'height',
  'rotation',
  'scale',
  'scaleX',
  'scaleY',
  'opacity',
  'cornerRadius',
  'cornerRadiusTopLeft',
  'cornerRadiusTopRight',
  'cornerRadiusBottomRight',
  'cornerRadiusBottomLeft',
  'volume',
  'color',
  'offset',
  'blur',
  'value',
  'trimStart',
  'trimEnd',
  'dashOffset',
  'd',
] as const;

export const NAMED_EASINGS = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'gentle',
  'snappy',
  'bouncy',
  'strong',
] as const;
const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const EASING = new RegExp(
  `^(?:${NAMED_EASINGS.join('|')}` +
    String.raw`|cubicBezier\(\s*${NUMBER}(?:\s*,\s*${NUMBER}){3}\s*\)` +
    String.raw`|spring\(\s*${NUMBER}\s*,\s*${NUMBER}\s*\)` +
    String.raw`|steps\(\s*\d+\s*\))$`,
);
const easing = z.string().regex(EASING, 'unknown easing');

export const ANIMATION_TYPES = [
  'fade',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'grow',
  'shrink',
  'spin',
  'twist',
  'blur',
  'appearWord',
  'appearChar',
  'scramble',
  'gain',
  // Học Palmier §C2: bật lên (0.6 → 1, có vượt nhẹ) — kiểu chữ hook của short-form.
  'pop',
  // E4 (học Palmier TextAnimation): theo từ — gõ chữ có con trỏ, từng từ trượt lên, từ đang tới bật + đổi màu.
  'typewriter',
  'wordSlide',
  'highlightPop',
] as const;

/** What a per-unit animation steps through on a `text` node. */
export const ANIMATION_UNITS = ['char', 'word', 'line'] as const;
/** Which unit moves first: `center` starts from the middle outwards, `random` is seeded by the node id. */
export const ANIMATION_ORDERS = ['first', 'center', 'last', 'random'] as const;
/** Animations that can run per unit (char/word/line) on a text node. */
export const UNIT_ANIMATION_TYPES = ['fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'pop', 'blur', 'grow'] as const;
const MASKABLE = new Set<string>(['slideUp', 'slideDown']);

export const EFFECT_TYPES = [
  'blur',
  'hueRotate',
  'brightness',
  'contrast',
  'grayscale',
  'invert',
  'saturate',
  'sepia',
  // Chỉnh màu (học Palmier §C5). exposure: stop (−2…2, nhân sáng 2^v, tăng được);
  // vibrance: −1…1 (saturate 1+v); temperature: −1 lạnh … 1 ấm; tint: −1 xanh lá … 1
  // hồng; vignette: 0…1 tối viền. Ba cái cuối là lớp phủ trên hộp của node.
  'exposure',
  'vibrance',
  'temperature',
  'tint',
  'vignette',
  // Chỉnh màu đầy đủ (E3, học Palmier Adjust): xử lý trên PIXEL của khung video/ảnh
  // (`clip-render/grade.ts`), giống nhau ở preview lẫn export. value −1…1 trừ khi ghi khác.
  // Tone: highlights, shadows, whites, blacks; saturation: −1 (xám) … 1 (gấp đôi).
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'saturation',
  // Màu theo vùng: value = độ mạnh 0…1 (1 = đúng như params).
  'curves', // params.master/red/green/blue: điểm [x, y] 0…1
  'wheels', // params.lift/gamma/gain: [r, g, b] −1…1
  'hueCurves', // params.hue/sat/lum: điểm [hue 0…1, chỉnh −1…1]
  'chromaKey', // value = range 0…1; params.color, params.spill 0…1
  // Chi tiết & hiệu ứng (0…1 trừ clarity/dehaze −1…1).
  'sharpen',
  'clarity',
  'dehaze',
  'grain', // params.size 1…4
  'glow', // params.threshold 0…1, params.radius 0…1, params.warmth 0…1
  'motionBlur', // params.angle độ
  'lut', // params.src = file .cube trong thư viện; value = độ mạnh 0…1
] as const;

/** Tham số phụ của effect chỉnh màu (E3). Mọi trường tuỳ chọn; vắng thì dùng mặc định của renderer. */
const point = z.tuple([num, num]);
const triple = z.tuple([num, num, num]);
export const EffectParamsSchema = z
  .object({
    master: z.array(point).max(16).optional(),
    red: z.array(point).max(16).optional(),
    green: z.array(point).max(16).optional(),
    blue: z.array(point).max(16).optional(),
    lift: triple.optional(),
    gamma: triple.optional(),
    gain: triple.optional(),
    hue: z.array(point).max(16).optional(),
    sat: z.array(point).max(16).optional(),
    lum: z.array(point).max(16).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    spill: num.optional(),
    size: num.optional(),
    threshold: num.optional(),
    radius: num.optional(),
    warmth: num.optional(),
    angle: num.optional(),
    midpoint: num.optional(),
    roundness: num.optional(),
    feather: num.optional(),
    /** `lut`: đường dẫn file `.cube` trong thư viện của project. */
    src: z.string().min(1).max(500).optional(),
  })
  .strict();

// `whip`: the outgoing shot shifts out and the incoming one shifts in, with directional motion blur.
export const TRANSITION_TYPES = ['dissolve', 'slideFromRight', 'slideFromLeft', 'fadeToBlack', 'fadeToWhite', 'whip'] as const;

/** How a captions layer brings each word in: `fade` from a muted ink to full ink as it is spoken. */
export const CAPTION_REVEALS = ['fade'] as const;

/** At most this many emphasized ranges per captions layer. */
export const MAX_EMPHASIS = 500;

export const CAPTION_PRESETS = ['classic', 'whisper', 'cascade', 'spotlight', 'paper', 'guinea', 'stark', 'flare', 'slam'] as const;

const objectFit = z.enum(['cover', 'contain', 'fill']);
/** Điểm neo khi media bị cắt (cover) hoặc thừa chỗ (contain): [x, y] 0…1, vắng = giữa (E5, học Palmier anchor). */
const objectPosition = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
/** `stacked`: the file holds the picture in its top half and the alpha matte (luma) in its bottom half. */
const alpha = z.literal('stacked').optional();
const fontWeight = z.union([num, z.enum(['normal', 'bold'])]);
const fontStyle = z.enum(['normal', 'italic', 'oblique']);
const textCase = z.enum(['original', 'upper', 'lower']);

// ------------------------------------------------------------------ nguồn media
//
// `src` là đường dẫn thư viện / URL, HOẶC một khai báo asset chưa có: TSX viết
// `generate.image({...})` / `transform.upscale(...)` (op `add_generated`, ô
// Generate của fork). Document giữ khai báo dưới dạng dữ liệu, tag bằng khoá
// `generate` hoặc `transform`; đầu vào của nó (`refs`, `startFrame`, `endFrame`,
// `input`) lại là nguồn, nên lồng được.

export const GENERATE_KINDS = ['image', 'video', 'voice', 'audio'] as const;
export const TRANSFORM_KINDS = ['upscale', 'removeBackground', 'addAudio'] as const;

export type AssetInput = string | AssetDeclaration;
export type AssetDeclaration =
  | {
      generate: (typeof GENERATE_KINDS)[number];
      prompt: string;
      model?: string;
      aspectRatio?: string;
      duration?: number;
      /** Độ phân giải của model (plan Palmier P1); giá nhân theo nó. */
      resolution?: string;
      audio?: boolean;
      voice?: string;
      /** Explainer (`motion-explainer`): its script and code ref — checked in editor-core/route. */
      scene?: Record<string, unknown>;
      seed?: number;
      refs?: AssetInput[];
      startFrame?: AssetInput;
      endFrame?: AssetInput;
      /** Model sửa video (G2): video thư viện được sửa và giây bắt đầu cắt trong file đó. */
      sourceVideo?: AssetInput;
      sourceStart?: number;
      /** /video: the spec hash of the shot this one continues (starts from its last frame). */
      after?: string;
    }
  | { transform: (typeof TRANSFORM_KINDS)[number]; input: AssetInput };

const assetInput: z.ZodType<AssetInput> = z.lazy(() => z.union([z.string().min(1), AssetDeclarationSchema]));

export const AssetDeclarationSchema: z.ZodType<AssetDeclaration> = z.union([
  z
    .object({
      generate: z.enum(GENERATE_KINDS),
      prompt: z.string().min(1),
      model: z.string().min(1).optional(),
      aspectRatio: z.string().min(1).optional(),
      duration: num.optional(),
      resolution: z.string().min(1).optional(),
      audio: z.boolean().optional(),
      voice: z.string().min(1).optional(),
      scene: z.record(z.string(), z.unknown()).optional(),
      seed: num.optional(),
      refs: z.array(assetInput).optional(),
      startFrame: assetInput.optional(),
      endFrame: assetInput.optional(),
      sourceVideo: assetInput.optional(),
      sourceStart: num.optional(),
      after: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    })
    .strict(),
  z.object({ transform: z.enum(TRANSFORM_KINDS), input: assetInput }).strict(),
]);

const source = assetInput;

// ------------------------------------------------------------------ thành phần phụ

export const KeyframeSchema = z
  .object({ id: id.optional(), time, value: z.union([num, color]), easing: easing.optional() })
  .strict();

export const TrackSchema = z
  .object({ id: id.optional(), property: z.enum(TRACK_PROPERTIES), keyframes: z.array(KeyframeSchema) })
  .strict()
  .superRefine((track, ctx) => {
    // Track `d` (morph của path): mỗi mốc là một đường SVG đọc được.
    if (track.property !== 'd') return;
    track.keyframes.forEach((keyframe, index) => {
      if (typeof keyframe.value !== 'string') {
        ctx.addIssue({ code: 'custom', path: ['keyframes', index, 'value'], message: 'A "d" keyframe must be path data.' });
        return;
      }
      try {
        parsePath(keyframe.value);
      } catch (error) {
        ctx.addIssue({ code: 'custom', path: ['keyframes', index, 'value'], message: error instanceof Error ? error.message : 'Invalid path data.' });
      }
    });
  });

export const AnimationSchema = z
  .object({
    id: id.optional(),
    type: z.enum(ANIMATION_TYPES),
    phase: z.enum(['in', 'out']).optional(),
    duration: time.optional(),
    delay: time.optional(),
    /** typewriter/wordSlide/highlightPop: seconds per word (default 0.2); without `duration` it runs words × perWord. */
    perWord: z.number().min(0.03).max(2).optional(),
    /** highlightPop: accent color of the word being reached (default #FFD900). */
    color: color.optional(),
    /** Runs the animation per character, word or line of a text node instead of on the whole node. */
    unit: z.enum(ANIMATION_UNITS).optional(),
    /** With `unit`: which unit starts first (default `first`). */
    order: z.enum(ANIMATION_ORDERS).optional(),
    /** With `unit`: seconds between two units' starts. */
    step: z.number().min(0.02).max(0.5).optional(),
    /** With `unit` on slideUp/slideDown: each unit slides inside its own line box instead of across it. */
    mask: z.boolean().optional(),
  })
  .strict()
  .superRefine((animation, ctx) => {
    const issue = (key: string, message: string) => ctx.addIssue({ code: 'custom', path: [key], message });
    if (animation.unit !== undefined && !(UNIT_ANIMATION_TYPES as readonly string[]).includes(animation.type)) {
      issue('unit', `unit works with ${UNIT_ANIMATION_TYPES.join(', ')}; not with ${animation.type}.`);
    }
    if (animation.unit === undefined) {
      for (const key of ['order', 'step', 'mask'] as const) {
        if (animation[key] !== undefined) issue(key, `${key} needs unit (char, word or line).`);
      }
    }
    if (animation.mask !== undefined && !MASKABLE.has(animation.type)) {
      issue('mask', `mask works with slideUp and slideDown; not with ${animation.type}.`);
    }
  });

const tracks = z.array(TrackSchema).optional();
const paintCommon = {
  id: id.optional(),
  opacity: unit.optional(),
  blendMode: blendMode.optional(),
  hidden: z.boolean().optional(),
  tracks,
};

export const ColorStopSchema = z
  .object({ id: id.optional(), offset: unit, color, opacity: unit.optional(), tracks })
  .strict();

export const PaintSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), color, ...paintCommon }).strict(),
  z
    .object({
      type: z.enum(['linearGradient', 'radialGradient']),
      rotation: num.optional(),
      stops: z.array(ColorStopSchema),
      ...paintCommon,
    })
    .strict(),
  z
    .object({
      type: z.enum(['image', 'video']),
      src: source,
      objectFit: objectFit.optional(),
      objectPosition: objectPosition.optional(),
      frameRate: num.optional(),
      alpha,
      ...paintCommon,
    })
    .strict(),
]);

export const StrokeSchema = z
  .object({
    id: id.optional(),
    color,
    width: num.optional(),
    join: z.enum(['miter', 'round', 'bevel']).optional(),
    cap: z.enum(['butt', 'round', 'square']).optional(),
    miterLimit: num.optional(),
    opacity: unit.optional(),
    blendMode: blendMode.optional(),
    hidden: z.boolean().optional(),
    tracks,
  })
  .strict();

export const ShadowSchema = z
  .object({
    id: id.optional(),
    color,
    blur: num.optional(),
    offsetX: num.optional(),
    offsetY: num.optional(),
    opacity: unit.optional(),
    hidden: z.boolean().optional(),
    tracks,
  })
  .strict();

export const EffectSchema = z
  .object({ id: id.optional(), type: z.enum(EFFECT_TYPES), value: num, params: EffectParamsSchema.optional(), hidden: z.boolean().optional(), tracks })
  .strict();

const paints = z.array(PaintSchema).optional();
const strokes = z.array(StrokeSchema).optional();
const shadows = z.array(ShadowSchema).optional();
const effects = z.array(EffectSchema).optional();
const animations = z.array(AnimationSchema).optional();

const fontProps = {
  fontFamily: z.string().min(1).optional(),
  fontSize: num.optional(),
  fontWeight: fontWeight.optional(),
  fontStyle: fontStyle.optional(),
  letterSpacing: num.optional(),
  textCase: textCase.optional(),
};

export const TextRangeSchema = z
  .object({
    id: id.optional(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative().optional(),
    color: color.optional(),
    ...fontProps,
    paints,
    strokes,
    shadows,
    tracks,
  })
  .strict();

export const TransitionSchema = z
  .object({ type: z.enum(TRANSITION_TYPES).optional(), duration: time.optional() })
  .strict();

// ------------------------------------------------------------------ marks
//
// Dữ liệu OpenCMO gắn vào container: trạng thái của editor (khung, layout, cắt bằng
// chữ, voiceover, brand, marker). Mỗi khoá có schema riêng (R5, 07/10/2026): trước đó
// là `record<unknown>`, và một mark sai không ném lỗi — reader bỏ qua, tính năng tắt
// im lặng. Writer là op của editor-core và bộ sinh project; thêm khoá mới thì thêm ở đây.

/** Khoảng giây `[start, end]` trên nguồn. */
const RangeSchema = z.object({ start: time, end: time }).strict();

/** Khung + track bám mặt cho đổi khung trên top bar (`editor-core/reframe.ts`). */
export const ReframeMarkSchema = z
  .object({
    focus: num,
    /** `[giây nguồn, tâm 0–1]`. */
    track: z.array(z.tuple([time, num])),
    /** Thiếu ở document cũ: reader coi là `fill`. */
    mode: z.enum(['fill', 'fit']).optional(),
  })
  .strict();

export const LAYOUT_MODES = ['full', 'split-top', 'split-bottom', 'visual-only', 'pip', 'side-by-side'] as const;
/** Góc của PiP, hoặc phía của người nói khi side-by-side. */
export const LAYOUT_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right'] as const;
const unitBox = z.number().min(0).max(1);

/** Một khoảng bố cục của scene (`editor-core/layout.ts`); `full` không bao giờ được lưu. */
export const LayoutRangeSchema = z
  .object({
    start: time,
    end: time,
    mode: z.enum(['split-top', 'split-bottom', 'visual-only', 'pip', 'side-by-side', 'cell']),
    ratio: num,
    anchor: z.enum(LAYOUT_ANCHORS).optional(),
    rect: z.tuple([unitBox, unitBox, unitBox, unitBox]).optional(),
    focus: z.tuple([unitBox, unitBox]).optional(),
    fit: z.literal('fit').optional(),
    /** The panel's colour for this range (a light room, a brand colour); absent = the default dark panel. */
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .strict();

/** Scene mang `{ ranges }`; node do layout dựng mang vai của nó. */
const LayoutMarkSchema = z.union([
  z.object({ ranges: z.array(LayoutRangeSchema) }).strict(),
  z.enum(['speaker', 'panel', 'backdrop']),
]);

/** Cắt bằng chữ trên sequence (`editor-core/captions.ts`): đủ để tính lại lượt cắt. */
export const TextCutMarkSchema = z
  .object({
    /** `src` của transcript NGUỒN — tham chiếu, không nhúng transcript. */
    transcript: z.string(),
    window: RangeSchema,
    removed: z.array(RangeSchema),
    /** J/L-cut: giây nguồn đầu đoạn sau chỗ cắt → độ dời điểm cắt tiếng. */
    roll: z.record(z.string(), num).optional(),
  })
  .strict();

/** Audio của voiceover mang đủ trạng thái; phụ đề đi cùng chỉ mang `key`. */
export const VoiceoverMarkSchema = z
  .object({ key: z.string().min(1), mode: z.enum(['replace', 'overlay']), duck: num, synced: z.boolean().optional() })
  .strict();

/** Trạng thái gốc trước khi voiceover `replace` tắt tiếng/ẩn phụ đề — để trả lại. */
const VoiceoverReplacedSchema = z
  .object({
    videos: z.array(z.object({ muted: z.boolean() }).strict()),
    captions: z.array(z.object({ hidden: z.boolean() }).strict()),
  })
  .strict();

export const MARKER_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple'] as const;
export const MARKER_STATUSES = ['open', 'review', 'resolved'] as const;

/** Marker trên timeline (`editor-core/ops/markers.ts`). */
export const MarkerSchema = z
  .object({
    id: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    /** Giây trên timeline của scene. */
    time: z.number().min(0),
    /** 0 = điểm, > 0 = khoảng. */
    duration: z.number().min(0),
    color: z.enum(MARKER_COLORS),
    comment: z.string().max(4000).optional(),
    status: z.enum(MARKER_STATUSES),
  })
  .strict();

export const BRAND_ASPECTS = ['9:16', '1:1', '4:5', '16:9'] as const;
export const LOGO_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colors are hex, like #FFD400.');

/** Logo đã upload vào bucket `brand` (PNG, SVG được đổi sang PNG ở trình duyệt). */
export const BrandLogoSchema = z
  .object({
    /** Object name trong bucket `brand`: `{uid}/logo-{uuid}.png`. */
    object: z.string().regex(/^[0-9a-f-]{36}\/logo-[0-9a-f-]{36}\.png$/, 'Upload the logo again.'),
    width: z.number().int().min(16).max(4096),
    height: z.number().int().min(16).max(4096),
    corner: z.enum(LOGO_CORNERS),
    /** Bề rộng logo theo bề rộng khung. */
    size: z.number().min(0.05).max(0.4),
    opacity: z.number().min(0.1).max(1),
  })
  .strict();

/**
 * Brand Kit đã áp vào scene. Font ở đây là chuỗi: bảng font nằm ở clip-render, thứ
 * clip-doc không phụ thuộc. `BrandKitSchema` của editor-core siết font theo bảng đó.
 */
export const BrandMarkSchema = z
  .object({
    version: z.literal(1),
    colors: z
      .object({
        /** The main colour: highlighted labels. */
        primary: hex,
        secondary: hex,
        /** The accent: arrows, icons, the highlighted bar, the caption word being spoken. */
        accent: hex,
        /** Text on visuals. */
        text: hex,
        /** The fill of a visual's cards and panels. */
        background: hex,
      })
      .strict(),
    fonts: z.object({ heading: z.string().min(1), body: z.string().min(1) }).strict(),
    captions: z
      .object({
        preset: z.enum(CAPTION_PRESETS),
        /** Màu của preset (từ đang đọc, viền…): thiếu = màu nhấn của kit. */
        colors: z.array(hex).max(8).optional(),
        fontScale: z.number().min(0.5).max(2).optional(),
        position: z.enum(['top', 'center', 'bottom']).optional(),
      })
      .strict(),
    layout: z.object({ aspect: z.enum(BRAND_ASPECTS), fit: z.enum(['fill', 'fit']) }).strict(),
    logo: BrandLogoSchema.nullable(),
  })
  .strict();

/** Camera moves on the talking head (`add_camera_move`, learned from AI Producer's motion recipes). */
export const CAMERA_MOVE_KINDS = ['impact_shake', 'white_flash', 'whip', 'push_in', 'handheld', 'beat_pulse'] as const;
export const CameraMoveSchema = z
  .object({
    kind: z.enum(CAMERA_MOVE_KINDS),
    /** Clip seconds. */
    start: time,
    duration: z.number().positive().max(30),
    /** 0–1 across the kind's range (amplitude, amount, opacity). */
    strength: z.number().min(0).max(1),
    direction: z.enum(['left', 'right']).optional(),
    seed: z.number().int().min(0).max(1_000_000),
  })
  .strict();
export type CameraMove = z.infer<typeof CameraMoveSchema>;

export const MarksSchema = z
  .object({
    reframe: ReframeMarkSchema.optional(),
    layout: LayoutMarkSchema.optional(),
    'text-cut': TextCutMarkSchema.optional(),
    /** Đoạn `audio` mà J/L-cut dựng ra để mang tiếng. */
    'cut-audio': z.literal(true).optional(),
    voiceover: z.union([VoiceoverMarkSchema, z.object({ key: z.string().min(1) }).strict()]).optional(),
    'voiceover-replaced': VoiceoverReplacedSchema.optional(),
    /** Keyframe `volume` đã chèn lên video để hạ tiếng dưới giọng overlay. */
    'voiceover-duck': z.object({ keyframes: z.array(KeyframeSchema) }).strict().optional(),
    brand: BrandMarkSchema.optional(),
    /** Ảnh logo do `apply_brand` đặt. */
    'brand-logo': z.literal(true).optional(),
    markers: z.array(MarkerSchema).optional(),
    /**
     * The moves `add_camera_move` placed, and fingerprints of the tracks they baked onto the speaker (cuts copy
     * tracks without ids, so the fingerprint is how a rebuild finds its own). Rebuilt after every op.
     */
    'camera-moves': z
      .object({ moves: z.array(CameraMoveSchema).max(64), baked: z.array(z.string().regex(/^[0-9a-f]{8}$/)).max(4096) })
      .strict()
      .optional(),
    /** The white rect a `white_flash` move draws. */
    'camera-flash': z.literal(true).optional(),
    /** Visual sinh từ op: `input` là của op đó, op tự kiểm. */
    visual: z.object({ op: z.string().min(1), input: z.unknown() }).strict().optional(),
    /** The style skill whose `apply_style` placed this visual: a rerun replaces only these. */
    style: z.string().min(1).max(64).optional(),
    /** Seed variants of the shown AI media that are not on screen; `pick_variant` swaps one in. */
    variants: z.array(AssetDeclarationSchema).min(1).max(2).optional(),
  })
  .strict();

export type Marks = z.infer<typeof MarksSchema>;
export type ReframeMark = z.infer<typeof ReframeMarkSchema>;
export type LayoutRange = z.infer<typeof LayoutRangeSchema>;
export type TextCutMark = z.infer<typeof TextCutMarkSchema>;
export type VoiceoverMark = z.infer<typeof VoiceoverMarkSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type BrandMark = z.infer<typeof BrandMarkSchema>;

const marks = MarksSchema.optional();

// ------------------------------------------------------------------ nhóm prop

const editorState = {
  selected: z.boolean().optional(),
  clipHeight: num.optional(),
  expanded: z.boolean().optional(),
};

const naming = { id: id.optional(), name: z.string().optional() };

const transform = {
  x: num.optional(),
  y: num.optional(),
  offsetX: num.optional(),
  offsetY: num.optional(),
  rotation: num.optional(),
  scale: num.optional(),
  scaleX: num.optional(),
  scaleY: num.optional(),
};

const box = {
  width: num.optional(),
  height: num.optional(),
  keepAspectRatio: z.boolean().optional(),
  constrainX: z.enum(['left', 'right', 'center', 'stretch', 'scale']).optional(),
  constrainY: z.enum(['top', 'bottom', 'center', 'stretch', 'scale']).optional(),
};

const look = {
  opacity: unit.optional(),
  cornerRadius: num.optional(),
  cornerRadiusTopLeft: num.optional(),
  cornerRadiusTopRight: num.optional(),
  cornerRadiusBottomRight: num.optional(),
  cornerRadiusBottomLeft: num.optional(),
  blendMode: blendMode.optional(),
  hidden: z.boolean().optional(),
};

const timing = {
  start: time.optional(),
  end: time.optional(),
  sourceIn: time.optional(),
  sourceOut: time.optional(),
  playbackRate: num.optional(),
  transition: TransitionSchema.nullable().optional(),
};

const visual = { ...naming, ...transform, ...box, ...look, ...timing, ...editorState };
const media = {
  src: source,
  objectFit: objectFit.optional(),
  objectPosition: objectPosition.optional(),
  frameRate: num.optional(),
  alpha,
};
// `denoise` (học Palmier §C7): 0…1, khử ồn giọng nói lúc EXPORT (ffmpeg highpass + afftdn).
// Preview không nghe được — Web Audio không có bộ khử ồn tương đương; UI nói rõ điều đó.
const denoise = z.number().min(0).max(1).optional();
const audible = { volume: decibels.optional(), muted: z.boolean().optional(), syncTo: z.string().optional(), denoise };
const decorations = { paints, strokes, shadows, effects, tracks, animations };

// ------------------------------------------------------------------ node
//
// Mỗi loại node có một schema GỐC không đệ quy (để TypeScript suy được kiểu và bộ
// in TSX đọc được thứ tự prop), rồi `masks`/`children` gắn thêm qua `z.lazy`.
// Suy kiểu thẳng qua một union đệ quy thì TypeScript bỏ cuộc thành `any`.

const RectBase = z.object({ kind: z.literal('rect'), ...visual, muted: z.boolean().optional(), volume: decibels.optional(), fill: color.optional(), ...decorations, marks }).strict();

/**
 * Đường vector (SVG `d`). Không có trong DS — nền cho mũi tên, diagram, biểu đồ,
 * vẽ nét (spec visuals §4). `d` được đọc thử ngay ở schema: document mang một
 * đường hỏng thì bị từ chối lúc lưu, không phải lúc render.
 */
const PathBase = z
  .object({
    kind: z.literal('path'),
    ...visual,
    muted: z.boolean().optional(),
    d: z
      .string()
      .min(1)
      .max(100_000)
      .superRefine((d, ctx) => {
        try {
          parsePath(d);
        } catch (error) {
          ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid path data.' });
        }
      }),
    viewBox: z.tuple([num, num, num, num]).optional(),
    fillRule: z.enum(['nonzero', 'evenodd']).optional(),
    fill: color.optional(),
    dash: z.array(num).max(16).optional(),
    dashOffset: num.optional(),
    trimStart: unit.optional(),
    trimEnd: unit.optional(),
    ...decorations,
    marks,
  })
  .strict();

const TextBase = z
  .object({
    kind: z.literal('text'),
    ...visual,
    muted: z.boolean().optional(),
    text: z.string(),
    color: color.optional(),
    ...fontProps,
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    textBaseline: z.enum(['top', 'middle', 'bottom', 'alphabetic']).optional(),
    leading: num.optional(),
    ranges: z.array(TextRangeSchema).optional(),
    // E4 (học Palmier TextStyle.Background): hộp nền sau chữ — cả khối, hoặc từng dòng.
    background: z
      .object({
        color: color,
        paddingX: num.optional(),
        paddingY: num.optional(),
        radius: num.optional(),
        outlineColor: color.optional(),
        outlineWidth: num.optional(),
        perLine: z.boolean().optional(),
      })
      .strict()
      .optional(),
    // Gạch dưới / gạch trên / gạch ngang, theo bề rộng từng dòng.
    decoration: z.array(z.enum(['underline', 'overline', 'strike'])).max(3).optional(),
    // footage: chữ là cửa sổ lộ hình bên dưới, phần còn lại của khung phủ màu chữ; inverted: chữ blend difference.
    fill: z.enum(['footage', 'inverted']).optional(),
    // Nghiêng phối cảnh (độ, −89…89) — xấp xỉ affine vì Canvas 2D không có phối cảnh.
    tiltX: z.number().min(-89).max(89).optional(),
    tiltY: z.number().min(-89).max(89).optional(),
    ...decorations,
  })
  .strict();

const VideoBase = z.object({ kind: z.literal('video'), ...visual, ...media, ...audible, ...decorations }).strict();

const ImageBase = z.object({ kind: z.literal('image'), ...visual, muted: z.boolean().optional(), volume: decibels.optional(), ...media, ...decorations }).strict();

export const AudioSchema = z
  .object({
    kind: z.literal('audio'),
    ...naming,
    x: num.optional(),
    y: num.optional(),
    width: num.optional(),
    height: num.optional(),
    hidden: z.boolean().optional(),
    ...timing,
    src: source,
    ...audible,
    tracks,
    animations,
    ...editorState,
    marks,
  })
  .strict();

const GroupBase = z
  .object({
    kind: z.literal('group'),
    ...naming,
    ...transform,
    opacity: unit.optional(),
    blendMode: blendMode.optional(),
    hidden: z.boolean().optional(),
    muted: z.boolean().optional(),
    volume: decibels.optional(),
    denoise,
    ...timing,
    ...editorState,
    effects,
    tracks,
    animations,
    marks,
  })
  .strict();

const SequenceBase = z
  .object({ kind: z.literal('sequence'), ...naming, hidden: z.boolean().optional(), muted: z.boolean().optional(), volume: decibels.optional(), ...editorState, marks })
  .strict();

/** Biên của `fontScale` trên phụ đề: 25% tới 300% cỡ chữ của preset. */
export const CAPTION_SCALE_MIN = 0.25;
export const CAPTION_SCALE_MAX = 3;

export const CaptionsSchema = z
  .object({
    kind: z.literal('captions'),
    ...naming,
    src: z.string().min(1).optional(),
    // The id of the video element this layer transcribes: cutting that video by words rewrites
    // this layer. Missing = the master video's captions (documents from before linked videos).
    source: id.optional(),
    preset: z.enum(CAPTION_PRESETS).optional(),
    // Màu nhấn theo ô của preset (spotlight: chữ đang nói; guinea: 3 màu dòng).
    colors: z.array(color).optional(),
    // Đè chữ của preset: màu chữ thường, họ font (một trong FONTS của clip-render),
    // độ đậm. Thiếu thì giữ đúng preset.
    color: color.optional(),
    fontFamily: z.string().min(1).max(80).optional(),
    fontWeight: z.number().int().min(100).max(1000).optional(),
    verticalAlign: z.enum(['top', 'center', 'bottom']).optional(),
    // Nhân cỡ chữ và hộp của preset (1 = đúng preset DS). Không có thì người dùng
    // không có cách nào to/nhỏ phụ đề: layer không nhận `width`/`scale`.
    fontScale: z.number().min(CAPTION_SCALE_MIN).max(CAPTION_SCALE_MAX).optional(),
    // Nhịp dòng (học Palmier §C1): có trần thì ngắt câu theo câu → mệnh đề → giữa
    // cho tới khi dòng đủ ngắn, thay cho luật nhóm của preset. Không có thì giữ đúng DS.
    maxWords: z.number().int().min(1).max(20).optional(),
    maxChars: z.number().int().min(4).max(80).optional(),
    // Giữ dòng trên màn qua khoảng lặng ngắn hơn chừng này (giây) — hết nháy trống giữa hai câu.
    holdGap: z.number().min(0).max(2).optional(),
    // Học Palmier §C2 highlightBlock: hộp bo góc màu nhấn sau từ đang nói (chữ trên hộp tối lại).
    // E4: 'pop' — từ đang nói phóng to nhẹ + đổi màu nhấn (học Palmier highlightPop).
    highlight: z.enum(['block', 'pop']).optional(),
    // E4-e: che từ tục trên màn (chữ đầu + *), transcript không đổi.
    censor: z.boolean().optional(),
    // Keyword emphasis (style skills): words picked by meaning, not the word being spoken. Ranges are
    // SOURCE seconds, the time base of removed words, so a cut does not move them onto other words.
    emphasis: z.array(z.object({ start: num, end: num }).strict()).max(MAX_EMPHASIS).optional(),
    emphasisStyle: z
      .object({
        fontFamily: z.string().min(1).max(80).optional(),
        fontStyle: fontStyle.optional(),
        color: color.optional(),
        scale: z.number().min(1).max(1.6).optional(),
      })
      .strict()
      .optional(),
    reveal: z.enum(CAPTION_REVEALS).optional(),
    seed: num.optional(),
    offsetX: num.optional(),
    offsetY: num.optional(),
    hidden: z.boolean().optional(),
    muted: z.boolean().optional(),
    ...timing,
    ...editorState,
    tracks,
    animations,
    marks,
  })
  .strict();

export const AdjustmentLayerSchema = z
  .object({
    kind: z.literal('adjustmentLayer'),
    ...naming,
    ...transform,
    width: num.optional(),
    height: num.optional(),
    hidden: z.boolean().optional(),
    muted: z.boolean().optional(),
    ...timing,
    ...editorState,
    tracks,
    animations,
  })
  .strict();

const SceneBase = z
  .object({
    kind: z.literal('scene'),
    ...naming,
    width: num,
    height: num,
    keepAspectRatio: z.boolean().optional(),
    x: num.optional(),
    y: num.optional(),
    fill: color.optional(),
    volume: decibels.optional(),
    active: z.boolean().optional(),
    /** Số khung/giây của bản export (E2-b). Sửa vẫn theo lưới 30; vắng = 30. */
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional(),
    workarea: z.tuple([time, time]).nullable().optional(),
    playhead: time.optional(),
    timeline: z.tuple([num, num, num]).optional(),
    selected: z.boolean().optional(),
    paints,
    tracks,
    marks,
  })
  .strict();

type Masked = { masks?: RectNode[] };
type Parent = { children?: ClipNode[] };

export type RectNode = z.infer<typeof RectBase> & Masked & Parent;
export type PathNode = z.infer<typeof PathBase> & Masked;
export type TextNode = z.infer<typeof TextBase> & Masked;
export type VideoNode = z.infer<typeof VideoBase> & Masked;
export type ImageNode = z.infer<typeof ImageBase> & Masked;
export type AudioNode = z.infer<typeof AudioSchema>;
export type GroupNode = z.infer<typeof GroupBase> & Masked & Parent;
export type SequenceNode = z.infer<typeof SequenceBase> & Parent;
export type CaptionsNode = z.infer<typeof CaptionsSchema>;
export type AdjustmentLayerNode = z.infer<typeof AdjustmentLayerSchema>;
export type SceneNode = z.infer<typeof SceneBase> & Masked & Parent;
export type ClipNode =
  | SceneNode
  | RectNode
  | PathNode
  | TextNode
  | VideoNode
  | ImageNode
  | AudioNode
  | GroupNode
  | SequenceNode
  | CaptionsNode
  | AdjustmentLayerNode;
export type NodeKind = ClipNode['kind'];

const maskList = z.array(z.lazy((): z.ZodType<RectNode> => RectSchema)).optional();
const childList = z.array(z.lazy((): z.ZodType<ClipNode> => NodeSchema)).optional();

const RectFull = RectBase.extend({ masks: maskList, children: childList }).strict();
const PathFull = PathBase.extend({ masks: maskList }).strict();
const TextFull = TextBase.extend({ masks: maskList }).strict();
const VideoFull = VideoBase.extend({ masks: maskList }).strict();
const ImageFull = ImageBase.extend({ masks: maskList }).strict();
const GroupFull = GroupBase.extend({ masks: maskList, children: childList }).strict();
const SequenceFull = SequenceBase.extend({ children: childList }).strict();
const SceneFull = SceneBase.extend({ masks: maskList, children: childList }).strict();

export const RectSchema: z.ZodType<RectNode> = RectFull;
export const PathSchema: z.ZodType<PathNode> = PathFull;
export const TextSchema: z.ZodType<TextNode> = TextFull;
export const VideoSchema: z.ZodType<VideoNode> = VideoFull;
export const ImageSchema: z.ZodType<ImageNode> = ImageFull;
export const GroupSchema: z.ZodType<GroupNode> = GroupFull;
export const SequenceSchema: z.ZodType<SequenceNode> = SequenceFull;
export const SceneSchema: z.ZodType<SceneNode> = SceneFull;

/** Chọn nhánh theo `kind`: lỗi chỉ đúng prop sai của đúng loại node. */
export const NodeSchema: z.ZodType<ClipNode> = z.discriminatedUnion('kind', [
  SceneFull,
  RectFull,
  PathFull,
  TextFull,
  VideoFull,
  ImageFull,
  AudioSchema,
  GroupFull,
  SequenceFull,
  CaptionsSchema,
  AdjustmentLayerSchema,
]);

/** Thứ tự prop của từng loại node — bộ in TSX đọc từ đây. */
export const NODE_SHAPES: Record<NodeKind, z.ZodObject> = {
  scene: SceneBase,
  rect: RectBase,
  path: PathBase,
  text: TextBase,
  video: VideoBase,
  image: ImageBase,
  audio: AudioSchema,
  group: GroupBase,
  sequence: SequenceBase,
  captions: CaptionsSchema,
  adjustmentLayer: AdjustmentLayerSchema,
};

export const StageSchema = z
  .object({
    id: id.optional(),
    background: color.optional(),
    camera: z.tuple([num, num, num, num, num, num]).optional(),
    children: z.array(NodeSchema),
  })
  .strict();

export const DocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    stage: StageSchema,
  })
  .strict();

export type ClipDocument = z.infer<typeof DocumentSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type Paint = z.infer<typeof PaintSchema>;
export type ColorStop = z.infer<typeof ColorStopSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type Shadow = z.infer<typeof ShadowSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
export type TextRange = z.infer<typeof TextRangeSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
