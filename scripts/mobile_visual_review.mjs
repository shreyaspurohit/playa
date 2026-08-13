import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const [shellPath, htmlPath, outputDir, profileDir] = process.argv.slice(2);
if (!shellPath || !htmlPath || !outputDir || !profileDir) {
  throw new Error(
    'usage: node scripts/mobile_visual_review.mjs '
    + '<headless-shell> <site/index.html> <output-dir> <profile-dir>',
  );
}

await mkdir(outputDir, { recursive: true });

// On restricted macOS runners Chromium cannot create its normal Mach IPC
// rendezvous. Headless Shell's test-only single-process mode keeps the render
// local while CDP uses anonymous pipes instead of a denied TCP listener.
const child = spawn(shellPath, [
  '--headless',
  '--single-process',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profileDir}`,
  '--remote-debugging-pipe',
  '--window-size=390,844',
  'about:blank',
], {
  stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
});

let nextId = 1;
let readBuffer = Buffer.alloc(0);
const pending = new Map();
let stderr = '';

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });

child.stdio[4].on('data', (chunk) => {
  readBuffer = Buffer.concat([readBuffer, chunk]);
  for (;;) {
    const end = readBuffer.indexOf(0);
    if (end < 0) break;
    const raw = readBuffer.subarray(0, end).toString('utf8');
    readBuffer = readBuffer.subarray(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (!message.id) continue;
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result ?? {});
  }
});

function send(method, params = {}, sessionId) {
  const id = nextId++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdio[3].write(`${JSON.stringify(payload)}\0`);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let sessionId;
async function evaluate(expression, awaitPromise = true) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}

async function screenshot(name) {
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, sessionId);
  await writeFile(`${outputDir}/${name}.png`, Buffer.from(result.data, 'base64'));
}

// Keep route order stable so screenshots and metric output remain comparable.
const allRoutes = [
  ['schedule', '.schedule-filters'],
  ['food', '.food-search-sticky'],
  ['art', '.site-chrome-context'],
  ['map', '.map-control-panel'],
  ['camps', '.site-chrome-context'],
];
const requestedRoutes = new Set(
  (process.env.MOBILE_REVIEW_ROUTES || '')
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean),
);
const routes = requestedRoutes.size
  ? allRoutes.filter(([route]) => requestedRoutes.has(route))
  : allRoutes;
if (!routes.length) throw new Error('MOBILE_REVIEW_ROUTES matched no known routes');

function metricsExpression(selector) {
  return `(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: round(rect.top), bottom: round(rect.bottom),
        height: round(rect.height), width: round(rect.width),
        position: getComputedStyle(element).position,
      };
    };
    const chrome = document.querySelector('.site-chrome');
    const retained = document.querySelector(${JSON.stringify(selector)});
    const overflow = [...document.querySelectorAll('body *')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0
        && (rect.left < -0.5 || rect.right > 390.5 || rect.width > 390.5))
      .slice(0, 12)
      .map(({ element, rect }) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        classes: [...element.classList].slice(0, 4),
        left: round(rect.left), right: round(rect.right), width: round(rect.width),
      }));
    const internalOverflow = [...document.querySelectorAll('body *')]
      .filter((element) => element.scrollWidth > element.clientWidth + 0.5)
      .slice(0, 20)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        classes: [...element.classList].slice(0, 4),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
      }));
    const bearingArrow = document.querySelector('.brc-bearing-arrow');
    const bearingArrowRect = bearingArrow?.getBoundingClientRect();
    return {
      hash: location.hash,
      y: round(scrollY),
      collapsed: chrome?.classList.contains('chrome-collapsed') ?? false,
      chrome: box(chrome),
      retained: box(retained),
      viewport: { width: innerWidth, height: innerHeight },
      visualViewport: window.visualViewport ? {
        width: round(window.visualViewport.width),
        height: round(window.visualViewport.height),
        scale: round(window.visualViewport.scale),
      } : null,
      body: {
        clientWidth: document.body.clientWidth,
        scrollWidth: document.body.scrollWidth,
        rect: box(document.body),
      },
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      nearMeActive: document.querySelector('.food-wrap .sched-filter-btn.near')
        ?.getAttribute('aria-pressed') === 'true',
      foodRows: document.querySelectorAll('.food-wrap .food-row').length,
      bearingArrow: Boolean(bearingArrow),
      bearingArrowVisible: Boolean(bearingArrowRect
        && bearingArrowRect.width > 0
        && bearingArrowRect.height > 0
        && bearingArrowRect.bottom > 0
        && bearingArrowRect.top < innerHeight
        && bearingArrowRect.right > 0
        && bearingArrowRect.left < innerWidth),
      bearingExplained: (document.querySelector('.map-meet-row.active')?.textContent || '')
        .includes('dashed map arrow points from your GPS position'),
      overflow,
      internalOverflow,
    };
  })()`;
}

function validate(report) {
  const failures = [];
  for (const [route, states] of Object.entries(report)) {
    if (route === 'syncModal') {
      if (!states.menu.present) failures.push('sync menu: Dropbox entry is missing');
      if (!states.menu.visible) failures.push('sync menu: Dropbox entry is outside the viewport');
      if (!states.menu.named) failures.push('sync menu: Dropbox entry is not explicitly named');
      if (!states.menu.branded) failures.push('sync menu: official blue Dropbox glyph is missing');
      if ((states.menu.height ?? 0) < 44) failures.push('sync menu: Dropbox entry is smaller than 44px');
      if ((states.menu.left ?? -1) < 0 || (states.menu.right ?? 391) > 390) {
        failures.push('sync menu: Dropbox entry is clipped by the viewport');
      }
      if (!states.present) failures.push('sync modal: Dropbox settings are missing');
      if (!states.dedicatedTitle) failures.push('sync modal: dedicated Dropbox title is missing');
      if (states.aboutTitle) failures.push('sync modal: incorrectly opened the About dialog');
      if (!states.visible) failures.push('sync modal: Dropbox settings are outside the viewport');
      if (states.viewport.width !== 390 || states.viewport.height !== 844) {
        failures.push('sync modal: viewport is not 390x844');
      }
      if (states.documentWidth !== states.viewport.width || states.overflow.length) {
        failures.push('sync modal: document has horizontal overflow');
      }
      if (!states.actionButtons.length) failures.push('sync modal: no action button rendered');
      if (states.actionButtons.some((button) => button.height < 44)) {
        failures.push('sync modal: action button is smaller than 44px');
      }
      continue;
    }
    if (states.expanded.collapsed) failures.push(`${route}: expanded state is collapsed`);
    if (!states.collapsed.collapsed) failures.push(`${route}: did not stay collapsed`);
    if (states.revealed.collapsed) failures.push(`${route}: did not reveal`);
    if ((states.collapsed.retained?.top ?? 999) > 7) {
      failures.push(`${route}: retained control is not at viewport top`);
    }
    for (const [state, metrics] of Object.entries(states)) {
      if (metrics.viewport.width !== 390 || metrics.viewport.height !== 844) {
        failures.push(`${route}/${state}: viewport is not 390x844`);
      }
      if (metrics.documentWidth !== metrics.viewport.width) {
        failures.push(`${route}/${state}: document has horizontal overflow`);
      }
    }
    if (route === 'food' && states.nearMe) {
      if (!states.nearMe.nearMeActive) failures.push('food: Near me did not activate');
      if (states.nearMe.foodRows >= states.expanded.foodRows) {
        failures.push('food: Near me did not reduce the Food rows at the test position');
      }
      if (!states.nearMe.restoredAfterSecondClick) failures.push('food: Near me did not toggle off');
      if (states.nearMe.restoredRows !== states.expanded.foodRows) {
        failures.push('food: toggling Near me off did not restore the prior rows');
      }
    }
    if (route === 'map' && states.navigation) {
      if (!states.navigation.bearingArrow) {
        failures.push('map: selected GPS destination has no bearing arrow');
      }
      if (!states.navigation.bearingArrowVisible) {
        failures.push('map: GPS bearing arrow is outside the captured viewport');
      }
      if (!states.navigation.bearingExplained) {
        failures.push('map: selected GPS destination does not explain the arrow');
      }
    }
  }
  return failures;
}

try {
  await send('Browser.getVersion');
  const { targetInfos } = await send('Target.getTargets');
  let page = targetInfos.find((target) => target.type === 'page');
  if (!page) {
    const created = await send('Target.createTarget', { url: 'about:blank' });
    page = { targetId: created.targetId };
  }
  ({ sessionId } = await send('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  }));

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  }, sessionId);

  const url = pathToFileURL(htmlPath);
  url.searchParams.set(
    'now',
    process.env.MOBILE_REVIEW_NOW || '2026-08-31T13:00:00-07:00',
  );
  url.searchParams.set(
    'gps',
    process.env.MOBILE_REVIEW_GPS || '40.786958,-119.202994',
  );
  url.hash = 'camps';
  await send('Page.navigate', { url: url.href }, sessionId);
  await evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      if (document.querySelector('.site-chrome')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('app did not render'));
      setTimeout(poll, 50);
    };
    poll();
  })`);

  // Guarantee enough scroll range even on empty Schedule/Art fixtures.
  await evaluate(`(() => {
    const spacer = document.createElement('div');
    spacer.id = 'mobile-review-spacer';
    spacer.style.height = '1800px';
    spacer.style.pointerEvents = 'none';
    spacer.setAttribute('aria-hidden', 'true');
    document.body.append(spacer);
  })()`);

  const report = {};
  for (const [route, selector] of routes) {
    await evaluate(`location.hash = ${JSON.stringify(`#${route}`)}`);
    await delay(650);
    await evaluate('scrollTo(0, 0)');
    await delay(350);

    report[route] = { expanded: await evaluate(metricsExpression(selector)) };
    await screenshot(`${route}-expanded`);

    await evaluate(`new Promise(async (resolve) => {
      // The primary chrome can exceed 400px when both simulated-time and
      // simulated-location banners are present. Scroll well past its full
      // height so the collapse transition cannot anchor the document at y=0.
      for (const y of [40, 80, 120, 240, 400, 600, 800]) {
        scrollTo(0, y);
        await new Promise((next) => requestAnimationFrame(() => next()));
      }
      setTimeout(resolve, 350);
    })`);
    report[route].collapsed = await evaluate(metricsExpression(selector));
    await screenshot(`${route}-collapsed`);

    await evaluate(`new Promise((resolve) => {
      scrollTo(0, Math.max(0, scrollY - 16));
      setTimeout(resolve, 350);
    })`);
    report[route].revealed = await evaluate(metricsExpression(selector));
    await screenshot(`${route}-revealed`);

    if (route === 'food') {
      await evaluate('scrollTo(0, 0)');
      await delay(350);
      await evaluate(`document.querySelector('.food-wrap .sched-filter-btn.near')?.click()`);
      await delay(350);
      // Center the active toggle rather than placing it behind Food's sticky
      // search bar; the screenshot should visibly prove the selected state.
      await evaluate(`document.querySelector('.food-controls')?.scrollIntoView({ block: 'center' })`);
      await delay(200);
      report[route].nearMe = await evaluate(metricsExpression(selector));
      await screenshot('food-near-me');
      await evaluate(`document.querySelector('.food-wrap .sched-filter-btn.near')?.click()`);
      await delay(200);
      report[route].nearMe.restoredAfterSecondClick = await evaluate(
        `document.querySelector('.food-wrap .sched-filter-btn.near')?.getAttribute('aria-pressed') === 'false'`,
      );
      report[route].nearMe.restoredRows = await evaluate(
        `document.querySelectorAll('.food-wrap .food-row').length`,
      );
    }
    if (route === 'map') {
      // Keyboard activation selects the exact fixture marker; a synthetic
      // click at client (0,0) would intentionally invoke nearest-hit testing.
      await evaluate(`document.querySelector('.brc-poi-ranger')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )`);
      await delay(350);
      await evaluate(`new Promise(async (resolve) => {
        const svg = document.querySelector('.brc-svg');
        if (!svg) { resolve(); return; }
        // Keep the map immediately below its retained controls, then move only
        // downward so the direction-aware global chrome stays collapsed.
        const svgDocumentTop = svg.getBoundingClientRect().top + scrollY;
        const destination = Math.max(scrollY + 120, svgDocumentTop - 225);
        const start = scrollY;
        for (const fraction of [0.25, 0.5, 0.75, 1]) {
          scrollTo(0, start + (destination - start) * fraction);
          await new Promise((next) => requestAnimationFrame(() => next()));
        }
        setTimeout(resolve, 350);
      })`);
      report[route].navigation = await evaluate(metricsExpression(selector));
      await screenshot('map-navigation');
    }
  }

  // Build-gated cloud sync lives in a dedicated modal rather than a route.
  // When this review build enables it, exercise the real menu path and keep a
  // mobile screenshot/metric record alongside the tab captures.
  if (await evaluate(`Boolean(document.querySelector('meta[name="bm-sync-provider"]'))`)) {
    await evaluate('scrollTo(0, 0)');
    await evaluate(`document.querySelector('.header-menu-trigger')?.click()`);
    await evaluate(`new Promise((resolve) => {
      const deadline = Date.now() + 2000;
      const settled = () => {
        const entry = document.querySelector('.header-menu-sync');
        if (entry && !entry.disabled) resolve();
        else if (Date.now() >= deadline) resolve();
        else setTimeout(settled, 25);
      };
      settled();
    })`);
    const syncMenu = await evaluate(`(() => {
      const entry = document.querySelector('.header-menu-sync');
      const rect = entry?.getBoundingClientRect();
      const glyph = entry?.querySelector('.header-menu-dropbox-glyph path');
      return {
        present: Boolean(entry),
        visible: Boolean(rect && rect.bottom > 0 && rect.top < innerHeight),
        named: (entry?.textContent || '').includes('Dropbox sync'),
        branded: glyph?.getAttribute('fill')?.toLowerCase() === '#0061ff',
        left: rect ? Math.round(rect.left * 100) / 100 : -1,
        right: rect ? Math.round(rect.right * 100) / 100 : 391,
        height: rect ? Math.round(rect.height * 100) / 100 : 0,
      };
    })()`);
    await screenshot('sync-menu');
    await evaluate(`document.querySelector('.header-menu-sync')?.click()`);
    await delay(200);
    report.syncModal = await evaluate(`(() => {
      const round = (value) => Math.round(value * 100) / 100;
      const settings = document.querySelector('.sync-modal-card .sync-settings');
      const settingsRect = settings?.getBoundingClientRect();
      const overflow = [...document.querySelectorAll('.sync-modal-card *')]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0
          && (rect.left < -0.5 || rect.right > 390.5 || rect.width > 390.5))
        .slice(0, 12)
        .map(({ element, rect }) => ({
          tag: element.tagName.toLowerCase(),
          classes: [...element.classList].slice(0, 4),
          left: round(rect.left), right: round(rect.right), width: round(rect.width),
        }));
      return {
        menu: ${JSON.stringify(syncMenu)},
        present: Boolean(settings),
        dedicatedTitle: document.querySelector('#sync-modal-title')?.textContent === 'Dropbox sync',
        aboutTitle: Boolean(document.querySelector('.modal:not(.modal-hidden) #info-title')),
        visible: Boolean(settingsRect
          && settingsRect.bottom > 0 && settingsRect.top < innerHeight),
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        overflow,
        actionButtons: [...document.querySelectorAll('.sync-modal-card .sync-settings .action-btn')]
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return { width: round(rect.width), height: round(rect.height) };
          }),
      };
    })()`);
    await screenshot('sync-modal');
  } else if (process.env.MOBILE_REVIEW_EXPECT_SYNC === '1') {
    throw new Error('mobile review expected Dropbox sync metadata, but none was built');
  }

  await writeFile(`${outputDir}/metrics.json`, `${JSON.stringify(report, null, 2)}\n`);
  const failures = validate(report);
  for (const [route, states] of Object.entries(report)) {
    if (route === 'syncModal') {
      console.log(
        `sync     present=${states.present} buttons=${states.actionButtons.length} `
        + `width=${states.documentWidth}`,
      );
      continue;
    }
    console.log(
      `${route.padEnd(8)} collapse=${states.collapsed.collapsed} `
      + `retainedTop=${states.collapsed.retained?.top} `
      + `reveal=${!states.revealed.collapsed} `
      + `width=${states.collapsed.documentWidth}`,
    );
  }
  console.log(`screenshots: ${outputDir}`);
  console.log(`metrics: ${outputDir}/metrics.json`);
  if (failures.length) {
    throw new Error(`mobile review assertions failed:\n- ${failures.join('\n- ')}`);
  }

  await send('Browser.close');
  await delay(250);
} catch (error) {
  console.error(error?.stack || String(error));
  if (stderr) console.error(stderr.split('\n').slice(-30).join('\n'));
  child.kill('SIGTERM');
  process.exitCode = 1;
}
