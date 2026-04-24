// Explains the BRC map grid to a first-time visitor: what the clock
// numbers and letter streets mean, and how to read a camp address.
// Opened from the (i) button in MapView's header.
import { useEffect, useRef } from 'preact/hooks';
import { BRC } from '../map/data';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MapInfoModal({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      class={'modal' + (open ? '' : ' modal-hidden')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-info-title"
      onClick={onBackdrop}
    >
      <div class="modal-card">
        <div class="modal-head">
          <h2 id="map-info-title">Reading the BRC map</h2>
          <button
            ref={closeRef}
            class="modal-close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >✕</button>
        </div>
        <div class="modal-body">
          <p>
            Black Rock City is laid out like a <strong>giant clock face</strong>,
            with <strong>The Man</strong> at the center. Every camp's address
            is the intersection of two streets: a <em>clock direction</em>
            (how far around the dial) and a <em>letter</em> (how far out from
            the Man).
          </p>

          <p>
            <strong>Clock streets</strong> (<code>2:00</code> through <code>10:00</code>)
            &mdash; these radiate out from the Man like hour hands. The arc
            from <code>10:00</code> around through <code>12:00</code> back to
            <code>2:00</code> is <em>open playa</em> (deep playa, where the
            big art lives) &mdash; no city out there. <code>6:00</code> is the
            main entrance + Center Camp direction. A fractional address like
            <code>7:30</code> means halfway between <code>7:00</code> and
            <code>8:00</code>.
          </p>

          <p>
            <strong>Letter streets</strong> (<code>A</code> through <code>K</code>)
            &mdash; concentric rings. <code>Esplanade</code> is the innermost
            promenade, closest to the Man. <code>A</code> is one block out,
            then <code>B</code>, <code>C</code>&hellip; up to{' '}
            <code>{BRC.streetLetters[BRC.streetLetters.length - 1]}</code> on the outer ring
            (~1 mile / 1.6 km from the Man). Each year has fun themed names
            for the letters (this year: <em>{BRC.streetNames.slice(1, 4).join(', ')},
            &hellip; {BRC.streetNames[BRC.streetNames.length - 1]}</em>) but
            most Burners just use the letter.
          </p>

          <p>
            <strong>Reading an address:</strong> a camp listing like
            {' '}<code>7:30 &amp; E</code> means the intersection of the{' '}
            <code>7:30</code> radial with the <code>E</code> ring &mdash;
            just south of 6:00 (entry side), about 4 blocks out from the Man.
            Starred camps show up here as pins, positioned exactly where their
            address resolves on the grid.
          </p>

          <p>
            <strong>Orientation:</strong> for {BRC.year}, True North runs along
            the <code>4:30</code> axis, so <code>12:00</code> points SW
            (bearing {BRC.twelveBearingDeg}&deg;) and <code>6:00</code> points NE.
          </p>

          <p>
            <strong>Lines on the map</strong> &mdash; two kinds:
          </p>
          <ul>
            <li>
              <strong>Solid orange line</strong> from the Man out to the
              selected pin: visualizes that camp&rsquo;s address as a radial
              + ring, so you can read the grid coordinates at a glance.
              Drawn for every selection.
            </li>
            <li>
              <strong>Dashed orange line</strong> from your <strong>GPS dot</strong>{' '}
              to the selected pin: the route bearing. Only appears when GPS
              is granted and a pin is selected. Distance, compass bearing,
              and walk/bike ETA show in the sidebar so you can head there
              directly.
            </li>
          </ul>
          <p class="footnote">
            If the dashed line enters from the edge of the map, your GPS fix
            is outside the visible area &mdash; could be a stale fix, a
            low-accuracy reading indoors, or a desktop browser reporting an
            ISP-based location instead of the burn site.
          </p>
        </div>
      </div>
    </div>
  );
}
