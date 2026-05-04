// "faved by" chip with an inline × button to remove this friend's
// star on this specific item (camp / event / art / meet spot).
//
// The "you" chip never gets a delete button — your own star is
// already managed by the card's star button. Only friend chips do.
//
// Click on the × stops propagation so the parent row's selection
// toggle doesn't fire.
import { friendChipStyle } from '../utils/friendColor';

interface Props {
  /** Display name. Special-cased: when this is the literal "you",
   *  the chip renders as `mine` and the × button is suppressed. */
  name: string;
  /** Optional removal handler. Omit (or pass undefined) to render a
   *  read-only chip with no × — used in dense layouts (e.g., map
   *  multi-select labels) where the action would be too small to hit. */
  onRemove?: () => void;
}

export function FriendChip({ name, onRemove }: Props) {
  const mine = name === 'you';
  return (
    <span
      class={'fav-by-chip' + (mine ? ' mine' : '')}
      style={mine ? undefined : friendChipStyle(name)}
    >
      {name}
      {!mine && onRemove && (
        <button
          type="button"
          class="fav-by-chip-del"
          aria-label={`Remove ${name}'s star`}
          title={`Remove ${name}'s star`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onRemove();
          }}
        >×</button>
      )}
    </span>
  );
}
