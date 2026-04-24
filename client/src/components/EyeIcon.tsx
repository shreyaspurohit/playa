// Eye / eye-with-slash icon, shared between the schedule's hide button,
// the restore button, and the intro-notice copy. 16×16 stroke SVG that
// inherits theme via `currentColor`, so a single <EyeIcon /> looks
// right on any background.

interface Props {
  /** Draw the slash (hide/off state). Plain eye otherwise. */
  slashed?: boolean;
  /** Pixel size (applied to width + height). Defaults to 16. */
  size?: number;
}

export function EyeIcon({ slashed = false, size = 16 }: Props) {
  return (
    <svg
      class="eye-icon"
      viewBox="0 0 24 24"
      width={size} height={size}
      fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"
    >
      {slashed ? (
        <>
          <path d="M2 12c2-4 6-7 10-7 2 0 3.7.5 5.2 1.3" />
          <path d="M22 12c-2 4-6 7-10 7-2 0-3.7-.5-5.2-1.3" />
          <circle cx="12" cy="12" r="3" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </>
      ) : (
        <>
          <path d="M2 12c2-4 6-7 10-7s8 3 10 7c-2 4-6 7-10 7s-8-3-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
