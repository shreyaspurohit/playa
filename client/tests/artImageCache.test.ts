import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, teardownDom } from './_dom';
import { warmArtImagesWhenIdle } from '../src/utils/artImageCache';

let idleCallbacks: IdleRequestCallback[];
let messages: Array<{ type: string; url: string }>;

beforeEach(() => {
  installDom();
  idleCallbacks = [];
  messages = [];
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    value: (callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    },
  });
  Object.defineProperty(window, 'cancelIdleCallback', {
    configurable: true,
    value: () => {},
  });

  const worker = {
    postMessage(message: { type: string; url: string }, transfer: Transferable[]) {
      messages.push(message);
      const port = transfer[0] as MessagePort;
      port.postMessage({ ok: true });
    },
  } as unknown as ServiceWorker;
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: worker,
      ready: Promise.resolve({ active: worker, waiting: null }),
    },
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => teardownDom());

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('warmArtImagesWhenIdle', () => {
  test('sends unique HTTPS images one at a time only after idle callbacks', async () => {
    const stop = warmArtImagesWhenIdle([
      'https://images.example/a.jpg',
      'https://images.example/a.jpg',
      'http://images.example/not-secure.jpg',
      'https://images.example/b.jpg',
    ]);

    assert.equal(messages.length, 0);
    assert.equal(idleCallbacks.length, 1);
    idleCallbacks.shift()!({ didTimeout: false, timeRemaining: () => 20 });
    await tick();
    assert.deepEqual(messages, [{
      type: 'CACHE_ART_IMAGE', url: 'https://images.example/a.jpg',
    }]);

    await tick();
    assert.equal(idleCallbacks.length, 1);
    idleCallbacks.shift()!({ didTimeout: false, timeRemaining: () => 20 });
    await tick();
    assert.deepEqual(messages.map((message) => message.url), [
      'https://images.example/a.jpg',
      'https://images.example/b.jpg',
    ]);
    stop();
  });

  test('does not schedule background warming when Data Saver is enabled', () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: new class extends EventTarget { saveData = true; effectiveType = '4g'; }(),
    });
    warmArtImagesWhenIdle(['https://images.example/a.jpg']);
    assert.equal(idleCallbacks.length, 0);
    assert.equal(messages.length, 0);
  });

  test('does not requeue URLs already acknowledged by the worker', async () => {
    const url = 'https://images.example/source-switch.jpg';
    const stopFirst = warmArtImagesWhenIdle([url]);
    idleCallbacks.shift()!({ didTimeout: false, timeRemaining: () => 20 });
    await tick();
    assert.equal(messages.length, 1);
    stopFirst();

    const scheduledBefore = idleCallbacks.length;
    const stopSecond = warmArtImagesWhenIdle([url]);
    assert.equal(idleCallbacks.length, scheduledBefore);
    assert.equal(messages.length, 1);
    stopSecond();
  });
});
