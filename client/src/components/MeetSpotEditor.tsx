// Modal for adding a rendezvous plan. Validates the address through
// the same parseAddress() grammar the map uses so adding a spot that
// won't render is impossible — the Save button gates on a successful
// parse.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MeetSpot } from '../types';
import { parseAddress } from '../map/address';
import type { BrcMapData } from '../map/data';

interface Props {
  onSave: (spot: MeetSpot) => void;
  onCancel: () => void;
  /** Per-year BRC geometry — drives the letter-set the address parser
   *  accepts. Authoring a meet spot under a 2024 source allows
   *  L-street addresses; under 2026 those would fail validation. */
  brc: BrcMapData;
}

export function MeetSpotEditor({ onSave, onCancel, brc }: Props) {
  const labelRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [when, setWhen] = useState('');

  useEffect(() => { labelRef.current?.focus(); }, []);

  // Parse the address on every keystroke so the "valid" hint updates
  // live. parseAddress is cheap — single regex + table lookup.
  const parsed = address.trim() ? parseAddress(address.trim(), brc) : null;
  const addressValid = parsed !== null || address.trim() === '';
  const readyToSave = label.trim().length > 0 && parsed !== null;

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onCancel();
  }

  function submit(e?: Event) {
    e?.preventDefault();
    if (!readyToSave) return;
    onSave({
      label: label.trim().slice(0, 80),
      address: address.trim().slice(0, 40),
      when: when.trim().slice(0, 40) || undefined,
    });
  }

  return (
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meet-spot-title"
      onClick={onBackdrop}
    >
      <div class="modal-card meet-spot-card">
        <div class="modal-head">
          <h2 id="meet-spot-title">Add a meet spot</h2>
          <button class="modal-close" type="button"
            aria-label="Close" onClick={onCancel}>✕</button>
        </div>
        <div class="modal-body">
          <p>
            A rendezvous plan you can share with friends. Lands on the
            map as a pin on their device after they import your share
            link — no internet needed on playa.
          </p>
          <form onSubmit={submit} class="meet-spot-form">
            <label>
              <span class="meet-spot-label">What</span>
              <input
                ref={labelRef}
                class="share-input"
                type="text"
                placeholder="e.g., Temple at sunset"
                maxLength={80}
                value={label}
                onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
              />
            </label>
            <label>
              <span class="meet-spot-label">
                Where{' '}
                <span class="meet-spot-hint">
                  — clock &amp; street like <code>7:30 &amp; E</code>
                </span>
              </span>
              <input
                class={'share-input' + (addressValid ? '' : ' invalid')}
                type="text"
                placeholder="e.g., 7:30 & E or 12:00 & Esplanade"
                maxLength={40}
                value={address}
                onInput={(e) => setAddress((e.target as HTMLInputElement).value)}
              />
              {address.trim() && !parsed && (
                <span class="meet-spot-err">
                  Not a valid BRC address yet. Try <code>clock &amp; letter</code>.
                </span>
              )}
              {parsed && (
                <span class="meet-spot-ok">
                  ✓ {parsed.clock} &amp; {parsed.street}
                </span>
              )}
            </label>
            <label>
              <span class="meet-spot-label">
                When <span class="meet-spot-hint">— optional, free-form</span>
              </span>
              <input
                class="share-input"
                type="text"
                placeholder="e.g., Wed 9pm, Tue sunset, any morning"
                maxLength={40}
                value={when}
                onInput={(e) => setWhen((e.target as HTMLInputElement).value)}
              />
            </label>
            <div class="meet-spot-actions">
              <button
                class="primary-btn" type="submit"
                disabled={!readyToSave}
              >
                Save spot
              </button>
              <button
                class="subtle-btn" type="button" onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
