// Pure direction/threshold tracker for the mobile auto-hiding site chrome.
// Small same-direction movements accumulate so touchpad/touch scroll events do
// not need to exceed the threshold individually; changing direction resets the
// accumulated travel and makes the header reveal faster than it hides.

export interface ScrollChromeState {
  y: number;
  direction: -1 | 0 | 1;
  travel: number;
  collapsed: boolean;
}

export const INITIAL_SCROLL_CHROME: ScrollChromeState = {
  y: 0,
  direction: 0,
  travel: 0,
  collapsed: false,
};

const ALWAYS_VISIBLE_Y = 32;
const HIDE_AFTER_Y = 96;
const HIDE_TRAVEL = 24;
const REVEAL_TRAVEL = 10;

export function advanceScrollChrome(
  previous: ScrollChromeState,
  nextY: number,
  mobile: boolean,
): ScrollChromeState {
  const y = Math.max(0, nextY);
  if (!mobile || y <= ALWAYS_VISIBLE_Y) {
    return { y, direction: 0, travel: 0, collapsed: false };
  }

  const delta = y - previous.y;
  if (delta === 0) return { ...previous, y };
  const direction: -1 | 1 = delta > 0 ? 1 : -1;
  const travel = previous.direction === direction
    ? previous.travel + Math.abs(delta)
    : Math.abs(delta);

  let collapsed = previous.collapsed;
  let nextTravel = travel;
  if (!collapsed && direction === 1 && y >= HIDE_AFTER_Y && travel >= HIDE_TRAVEL) {
    collapsed = true;
    nextTravel = 0;
  } else if (collapsed && direction === -1 && travel >= REVEAL_TRAVEL) {
    collapsed = false;
    nextTravel = 0;
  }

  return { y, direction, travel: nextTravel, collapsed };
}
