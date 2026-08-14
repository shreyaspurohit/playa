// Journal icon — a colorful open book with a pencil. Uses a fixed, soft palette
// chosen to read on every theme: the cream pages stand out on the dark themes,
// the coral cover / blue pencil / yellow tip stand out on the light themes, and
// the dark outline frames it where the background is light. The artwork fills
// most of the viewBox so it visually matches the favorite star beside it.

interface Props {
  /** Pixel size (applied to width + height). Defaults to 26 to match the star. */
  size?: number;
}

const COVER = '#e8956f';   // soft coral (not a harsh red)
const PAGE = '#f7f1e8';    // warm cream
const INK = '#33323d';     // outline / lead
const PENCIL = '#7cc1dd';  // soft blue
const TIP = '#f4cd6a';     // soft yellow

export function JournalIcon({ size = 26 }: Props) {
  return (
    <svg
      class="journal-icon"
      viewBox="0 0 24 24"
      width={size} height={size}
      aria-hidden="true"
    >
      <g stroke={INK} stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">
        {/* coral cover */}
        <path
          fill={COVER}
          d="M12 4.6C8.3 2.5 3.6 2.3 1.4 3.6L1.4 21C3.6 19.8 8.3 20 12 22.1C15.7 20 20.4 19.8 22.6 21L22.6 3.6C20.4 2.3 15.7 2.5 12 4.6Z"
        />
        {/* cream pages, inset so the cover peeks around them */}
        <path
          fill={PAGE}
          d="M12 6.1C8.7 4.3 4.4 4.1 3 4.9L3 19.4C4.4 18.6 8.7 18.8 12 20.6C15.3 18.8 19.6 18.6 21 19.4L21 4.9C19.6 4.1 15.3 4.3 12 6.1Z"
        />
        {/* spine */}
        <path d="M12 6.1L12 20.6" />
      </g>
      {/* pencil over the right page: dark underlay gives it an outline, blue body on top */}
      <line x1="14.8" y1="17.6" x2="20" y2="11.8" stroke={INK} stroke-width="4" stroke-linecap="round" />
      <line x1="14.8" y1="17.6" x2="20" y2="11.8" stroke={PENCIL} stroke-width="2.4" stroke-linecap="round" />
      {/* sharpened wood tip + lead point */}
      <path d="M14.8 17.6L13.3 19.1L16.2 18.2Z" fill={TIP} stroke={INK} stroke-width="1" stroke-linejoin="round" />
      <circle cx="13.4" cy="19" r="0.62" fill={INK} />
    </svg>
  );
}
