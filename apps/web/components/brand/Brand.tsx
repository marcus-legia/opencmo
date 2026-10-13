import Image from "next/image";

/** Uses OpenCMO's real assets instead of redrawing the logo in text. */
export function Brand() {
  return (
    <span className="brand-lockup">
      {/* SVG gains nothing from the image optimizer, so it stays a plain <img>. */}
      <img src="/icon.svg" width="32" height="32" alt="" />
      <span>OpenCMO</span>
    </span>
  );
}

// The source PNG is 480px but `.empty-mascot` draws it at 140px; declaring the drawn
// size lets next/image serve a small WebP/AVIF instead of the full PNG.
export function Mascot({ className = "" }: { className?: string }) {
  return <Image className={className} src="/mascot/logo-poster.png" width={140} height={140} alt="" />;
}
