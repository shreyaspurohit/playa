import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render } from 'preact';
import { installDom, teardownDom } from './_dom';
import { ExportModal } from '../src/components/ExportModal';
import { LS } from '../src/types';
import { writeString } from '../src/utils/storage';

function renderModal(onClose = () => {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(ExportModal, {
    open: true,
    onClose,
    source: 'api-2026',
    camps: [],
    art: [],
    campIds: ['123'],
    eventIds: [],
    artIds: [],
    myCampId: '',
    meetSpots: [],
  }), host);
  return host;
}

describe('ExportModal nickname requirement', () => {
  beforeEach(() => {
    teardownDom();
    installDom();
  });

  afterEach(() => teardownDom());

  test('shows the nickname as mandatory rather than an opt-out checkbox', () => {
    writeString(LS.nickname, 'Alice');
    const host = renderModal();
    assert.match(host.textContent ?? '', /Your nickname: Alice/);
    assert.match(host.textContent ?? '', /Always included/);
    const nicknameText = [...host.querySelectorAll('.include-row-name')]
      .find((candidate) => candidate.textContent?.includes('Your nickname'));
    assert.ok(nicknameText);
    assert.equal(
      nicknameText!.closest('.include-row')?.querySelector('input[type="checkbox"]'),
      null,
    );
  });

  test('defensively refuses download if the nickname disappears while open', () => {
    let closed = false;
    let message = '';
    (globalThis as typeof globalThis & { alert: (value: string) => void }).alert =
      (value: string) => { message = value; };
    const host = renderModal(() => { closed = true; });
    const button = [...host.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes('Download snapshot'));
    assert.ok(button);
    button!.click();
    assert.match(message, /Set your nickname/);
    assert.equal(closed, true);
    assert.equal(document.querySelector('a[download]'), null);
  });
});
