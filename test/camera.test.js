import assert from 'node:assert/strict';
import test from 'node:test';
import { setupCamera } from '../src/camera.js';

// Synthetic QR containing 18.ABF,,, with a quiet zone around the modules.
const qr = [
  '111111101110101111111', '100000100101001000001', '101110101101101011101',
  '101110100101001011101', '101110100101101011101', '100000101011101000001',
  '111111101010101111111', '000000000000100000000', '101000110010000100101',
  '011000011101011010111', '111110100111111111111', '110110011001000000010',
  '111011101111110001011', '000000001100011011111', '111111101100011111011',
  '100000100100100011010', '101110100010011011110', '101110100101011000000',
  '101110101001110010111', '100000100101011011000', '111111101101111111101'
];

function fakeBrowser(t, { resolveCode, pendingPermission = false }) {
  const panel = { hidden: true };
  const video = {
    readyState: 2, videoWidth: 320, videoHeight: 240, srcObject: null,
    play: async () => {}, pause() {}
  };
  const attributes = new Set();
  const frame = {
    hidden: true, clientWidth: 320, clientHeight: 240,
    hasAttribute: key => attributes.has(key),
    setAttribute: key => attributes.add(key),
    removeAttribute: key => attributes.delete(key)
  };
  const track = new EventTarget();
  let stopped = 0;
  track.stop = () => { stopped++; };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const draws = [];
  const context = {
    fillRect() {},
    drawImage(...args) { draws.push(args); },
    getImageData(x, y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      const scale = Math.floor(width / 29);
      const offset = Math.floor((width - 21 * scale) / 2);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (qr[Math.floor((y - offset) / scale)]?.[Math.floor((x - offset) / scale)] === '1') {
            const i = (y * width + x) * 4;
            data.fill(0, i, i + 3);
          }
        }
      }
      return { data, width, height };
    }
  };
  const doc = new EventTarget();
  doc.createElement = () => ({ width: 0, height: 0, getContext: () => context });
  const callbacks = new Map();
  let nextId = 0;
  const status = { textContent: '' };
  const retry = new EventTarget();
  let grant;
  const permission = pendingPermission ? new Promise(resolve => { grant = () => resolve(stream); }) : Promise.resolve(stream);
  const overrides = new Map();
  for (const [key, value] of Object.entries({
    document: doc,
    window: new EventTarget(),
    navigator: { mediaDevices: { getUserMedia: () => permission } },
    requestAnimationFrame: callback => { callbacks.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => callbacks.delete(id)
  })) {
    overrides.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const results = [];
  const visibility = [];
  const camera = setupCamera({
    panel, video, frame, target: { offsetWidth: 170 }, status, retry, resolveCode,
    onVisibility: visible => visibility.push(visible),
    onResult: result => {
      assert.equal(panel.hidden, true);
      assert.equal(frame.hidden, true);
      assert.equal(video.srcObject, null);
      assert.equal(stopped, 1);
      results.push(result);
    }
  });
  t.after(() => {
    camera.close();
    for (const [key, original] of overrides) {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    }
  });
  return {
    camera, panel, frame, status, doc, video, results, draws, visibility, grant,
    stopped: () => stopped,
    tick(time) {
      const [id, callback] = callbacks.entries().next().value;
      callbacks.delete(id);
      callback(time);
    },
    queued: () => callbacks.size
  };
}

test('a matched live QR releases the stream before showing the result', async t => {
  const accepted = { part: { code: 18 } };
  const browser = fakeBrowser(t, {
    resolveCode(text) {
      assert.equal(text, '18.ABF,,,');
      return accepted;
    }
  });
  await browser.camera.open();
  browser.tick(200);
  assert.deepEqual(browser.results, [accepted]);
  assert.deepEqual(browser.visibility, [true, false]);
  assert.equal(browser.queued(), 0);
  assert.deepEqual(browser.draws[0].slice(1, 5), [75, 35, 170, 170]);
});

test('an unknown live QR leaves scanning active and is reported once', async t => {
  let attempts = 0;
  const browser = fakeBrowser(t, {
    resolveCode() {
      attempts++;
      return { error: 'Sai đơn cắt.' };
    }
  });
  await browser.camera.open();
  browser.tick(200);
  browser.tick(360);
  assert.equal(attempts, 1);
  assert.equal(browser.status.textContent, 'Sai đơn cắt.');
  assert.equal(browser.panel.hidden, false);
  assert.equal(browser.stopped(), 0);
  assert.equal(browser.queued(), 1);
  browser.camera.close();
  assert.equal(browser.stopped(), 1);
  assert.equal(browser.queued(), 0);
});

test('closing while camera permission is pending releases the late stream', async t => {
  const browser = fakeBrowser(t, { pendingPermission: true, resolveCode: assert.fail });
  const opening = browser.camera.open();
  browser.camera.close();
  browser.grant();
  await opening;
  assert.equal(browser.panel.hidden, true);
  assert.equal(browser.video.srcObject, null);
  assert.equal(browser.stopped(), 1);
  assert.equal(browser.queued(), 0);
});
