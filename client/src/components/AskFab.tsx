// Floating "Ask" button — a mushroom that hovers over the content (ADR 21).
// Pulls the assistant out of the header so nickname + menu keep the top row.
// Icon-only + tooltip; the mushroom is the mycelial-network wink. It gives a
// couple of gentle pulses on the first visits so it's noticed, then settles.

import { useEffect, useState } from 'preact/hooks';
import { readString, writeString } from '../utils/storage';

const SEEN_KEY = 'bm-ask-fab-seen';

interface Props {
  onClick: () => void;
}

export function AskFab({ onClick }: Props) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const seen = parseInt(readString(SEEN_KEY, '0'), 10) || 0;
    if (seen < 2) {
      setPulse(true);
      writeString(SEEN_KEY, String(seen + 1));
    }
  }, []);

  return (
    <button
      type="button"
      class={'ask-fab' + (pulse ? ' pulse' : '')}
      onClick={() => { setPulse(false); onClick(); }}
      title="Ask — find camps, events & art"
      aria-label="Ask"
    >
      🍄
    </button>
  );
}
