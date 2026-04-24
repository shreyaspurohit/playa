// Hand-drawn trash icon. Reads as "delete" instead of the generic ✕
// glyph (which users parse as "dismiss this notification"). Inherits
// theme via `currentColor`.
interface Props {
  /** Pixel size (applied to width + height). Defaults to 14. */
  size?: number;
}

export function TrashIcon({ size = 14 }: Props) {
  return (
    <svg
      class="trash-icon"
      viewBox="0 0 24 24"
      width={size} height={size}
      fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"
    >
      {/* Lid, handle, can body, two inner lines — a conventional
          trash silhouette that reads as "delete" at small sizes. */}
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M6 6l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
