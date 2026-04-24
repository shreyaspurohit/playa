// Inline tent triangle. Replaces the 🏕 emoji in the UI — not every
// phone font ships U+1F3D5, and missing-glyph fallback renders the
// Unicode hex ("0153D5") next to the label. Same outline shape as
// the tent on the map SVG, so the sidebar icon reads as the thing
// it represents. Inherits theme via `currentColor`.
interface Props {
  /** Pixel size (applied to width + height). Defaults to 14. */
  size?: number;
}

export function TentIcon({ size = 14 }: Props) {
  return (
    <svg
      class="tent-icon"
      viewBox="0 0 24 24"
      width={size} height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Triangle tent silhouette + a small door slit so it reads
          as a tent rather than a plain triangle at tiny sizes. */}
      <path d="M 3 20 L 12 4 L 21 20 Z" />
      <path d="M 12 20 L 12 11" stroke="var(--bg, #fff)" stroke-width="2" fill="none" />
    </svg>
  );
}
