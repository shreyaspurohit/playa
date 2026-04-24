// Deterministic color per imported-friend nickname. Lets users tell
// their friends' chips apart at a glance without polluting the global
// theme palette: the hue is derived from a hash of the name, the
// saturation + lightness stay fixed, and the output is applied as an
// inline style so CSS can't accidentally override it.
//
// The "you" chip stays solid orange (matches the star gold). Friend
// chips use a hue-tinted translucent background that reads on every
// theme because the alpha lets the underlying --card / --bg show
// through.

/** FNV-1a 32-bit hash over the UTF-16 code units. Cheap, deterministic,
 *  and has noticeably better hue distribution on short inputs than
 *  the classic "djb2" we'd reach for first. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Hue in [0, 360). Skips the warm-orange band (5°–45°) where the
 *  friend chip would collide visually with the accent/star gold and
 *  read as "yours". Nudged to +90° when it lands there. */
export function friendHue(name: string): number {
  const raw = hash32(name) % 360;
  return raw >= 5 && raw < 45 ? (raw + 90) % 360 : raw;
}

/** Inline style for a friend chip. Keyed on the nickname; stable
 *  across renders. Used by CampCard's "faved by" row, EventItem's
 *  friends row, and ScheduleView's starred-by chip list. */
export function friendChipStyle(name: string): {
  background: string;
  boxShadow: string;
} {
  const h = friendHue(name);
  return {
    // Soft alpha keeps the card/bg visible underneath; same value works
    // on paper through eclipse themes.
    background: `hsla(${h}, 65%, 50%, 0.20)`,
    // Inset ring instead of a real border so layout doesn't shift.
    boxShadow: `inset 0 0 0 1px hsla(${h}, 65%, 55%, 0.55)`,
  };
}
