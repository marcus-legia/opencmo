import { SOCIAL, type SocialKey } from "./icons";

/** Logo "Open O": vòng hở 76° + chấm terracotta, dựng trên lưới 64. */
/** Con chồn gõ laptop (`public/logo.svg`, có chuyển động). `size` là chiều cao; ảnh rộng gấp ~1.8. */
export function LogoMark({ size = 28 }: { size?: number }) {
  // SVG gains nothing from the image optimizer, so it stays a plain <img>.
  return <img src="/logo.svg" width={Math.round(size * LOGO_RATIO)} height={size} alt="" className="lv-logo" />;
}

const LOGO_RATIO = 236 / 132;

/** Logo nền tảng trắng trên ô màu của hãng. `size` là cạnh ô; logo bằng nửa cạnh. */
export function SocialTile({ k, size, radius, title = true }: { k: SocialKey; size: number; radius: number; title?: boolean }) {
  const s = SOCIAL[k];
  return (
    <span
      className="lv-social"
      title={title ? s.name : undefined}
      style={{ width: size, height: size, borderRadius: radius, background: s.color }}
    >
      <svg viewBox="0 0 24 24" width={Math.round(size / 2)} height={Math.round(size / 2)} aria-hidden="true">
        <path d={s.d} fill="#fff" />
      </svg>
    </span>
  );
}

/** Icon nét Lucide. */
export function LineIcon({ d, size = 20, color = "#f2946f", width = 1.8 }: { d: string; size?: number; color?: string; width?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="lv-icon"
    >
      <path d={d} />
    </svg>
  );
}
