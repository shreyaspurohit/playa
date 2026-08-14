// A small icon button that opens the Journal editor prefilled with a camp /
// event / Food / art context (ADR 20 D4). Sits next to the favorite star on
// cards and rows. Stops propagation so it never triggers row-level handlers.
import type { JournalContext } from '../types';
import { requestJournalEntry } from '../utils/journalEntryBus';
import { JournalIcon } from './JournalIcon';

interface Props {
  context: JournalContext;
  /** Smaller footprint for inline list rows (events / schedule / food), where
   *  the neighboring controls are ~28px rather than the 36px card star. */
  compact?: boolean;
  className?: string;
}

export function AddJournalButton({ context, compact, className }: Props) {
  return (
    <button
      type="button"
      class={'journal-add-btn' + (compact ? ' compact' : '') + (className ? ' ' + className : '')}
      title="Add a private journal entry"
      aria-label="Add a journal entry"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); requestJournalEntry(context); }}
    >
      <JournalIcon size={compact ? 17 : 22} />
    </button>
  );
}
