import assert from 'node:assert/strict';
import test from 'node:test';
import { preferPhotoCapture, setupCamera } from '../src/camera.js';

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
const nextQr = [
  '111111101111001111111', '100000101010101000001', '101110100100101011101',
  '101110101110101011101', '101110100011001011101', '100000100111101000001',
  '111111101010101111111', '000000001011100000000', '101101110111101001011',
  '101101001001111110111', '001011100111001000001', '110010000001010010001',
  '111110111100101010000', '000000001111010010110', '111111101101110010110',
  '100000101010000111110', '101110100110101101000', '101110101101001010010',
  '101110101010101001100', '100000100010010010001', '111111101100010010000'
];

function fakeBrowser(t, { resolveCode, pendingPermission = false, userAgent = '', search = '' }) {
  const panel = { hidden: true };
  const video = Object.assign(new EventTarget(), {
    readyState: 2, videoWidth: 320, videoHeight: 240, srcObject: null,
    play: async () => {}, pause() {}
  });
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
  let picture = qr;
  const context = {
    fillRect() {},
    drawImage(...args) { draws.push(args); },
    getImageData(x, y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      const scale = Math.floor(width / 29);
      const offset = Math.floor((width - 21 * scale) / 2);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (picture[Math.floor((y - offset) / scale)]?.[Math.floor((x - offset) / scale)] === '1') {
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
  let permissionRequests = 0;
  let grant;
  const permission = pendingPermission ? new Promise(resolve => { grant = () => resolve(stream); }) : Promise.resolve(stream);
  const overrides = new Map();
  for (const [key, value] of Object.entries({
    document: doc,
    window: Object.assign(new EventTarget(), { location: { search } }),
    navigator: { userAgent, mediaDevices: { getUserMedia() { permissionRequests++; return permission; } } },
    requestAnimationFrame: callback => { callbacks.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => callbacks.delete(id)
  })) {
    overrides.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const results = [];
  const visibility = [];
  const camera = setupCamera({
    panel, video, frame, target: { offsetWidth: 170, offsetHeight: 170 }, status, retry, resolveCode,
    onVisibility: visible => visibility.push(visible),
    onResult: result => results.push(result)
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
    show(qr) { picture = qr; },
    permissionRequests: () => permissionRequests,
    tick(time) {
      const [id, callback] = callbacks.entries().next().value;
      callbacks.delete(id);
      callback(time);
    },
    queued: () => callbacks.size
  };
}

test('successive QR codes update the result in the same camera session', async t => {
  const browser = fakeBrowser(t, {
    resolveCode(text) {
      return { part: { code: parseInt(text, 10) } };
    }
  });
  await browser.camera.open();
  const stream = browser.video.srcObject;
  browser.tick(200);
  browser.tick(350);
  browser.show(nextQr);
  browser.tick(500);
  assert.deepEqual(browser.results.map(({ part }) => part.code), [18, 31]);
  assert.deepEqual(browser.visibility, [true]);
  assert.equal(browser.panel.hidden, false);
  assert.equal(browser.frame.hidden, false);
  assert.equal(browser.video.srcObject, stream);
  assert.equal(browser.stopped(), 0);
  assert.equal(browser.queued(), 1);
  assert.match(browser.status.textContent, /#31/);
  assert.deepEqual(browser.draws[0].slice(1, 5), [75, 35, 170, 170]);
  browser.camera.close();
  assert.deepEqual(browser.visibility, [true, false]);
  assert.equal(browser.stopped(), 1);
});

test('brief missed frames do not repeat a QR, but removing it lets it be scanned again', async t => {
  const browser = fakeBrowser(t, { resolveCode: () => ({ part: { code: 18 } }) });
  await browser.camera.open();
  browser.tick(200);
  browser.show([]);
  browser.tick(350);
  browser.show(qr);
  browser.tick(500);
  assert.equal(browser.results.length, 1);
  browser.show([]);
  browser.tick(650);
  browser.tick(950);
  browser.show(qr);
  browser.tick(1100);
  assert.equal(browser.results.length, 2);
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

test('iPhone browsers in apps use photos without opening a live stream', async t => {
  const browser = fakeBrowser(t, {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Zalo',
    resolveCode: assert.fail
  });
  await browser.camera.open();
  assert.equal(browser.panel.hidden, false);
  assert.equal(browser.frame.hidden, true);
  assert.equal(browser.permissionRequests(), 0);
  assert.match(browser.status.textContent, /Chụp tem/);
});

test('normal iPhone Safari still uses video unless photo mode was explicitly requested', () => {
  const safari = { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1' };
  assert.equal(preferPhotoCapture(safari), false);
  assert.equal(preferPhotoCapture(safari, '?camera=photo'), true);
  assert.equal(preferPhotoCapture({ userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148' }), true);
  assert.equal(preferPhotoCapture({ ...safari, userAgent: safari.userAgent + ' ZaloApp/26.01' }), true);
});

test('native fullscreen exits before a detected result tears down the video', async t => {
  const accepted = { part: { code: 18 } };
  const browser = fakeBrowser(t, { resolveCode: () => accepted });
  let exitRequests = 0;
  browser.video.webkitExitFullscreen = () => { exitRequests++; };
  await browser.camera.open();
  browser.video.webkitDisplayingFullscreen = true;
  browser.video.dispatchEvent(new Event('webkitbeginfullscreen'));
  browser.tick(200);
  assert.equal(exitRequests, 1);
  assert.equal(browser.stopped(), 0);
  assert.ok(browser.video.srcObject);
  assert.equal(browser.results.length, 0);
  browser.video.webkitDisplayingFullscreen = false;
  browser.video.dispatchEvent(new Event('webkitendfullscreen'));
  assert.deepEqual(browser.results, [accepted]);
  assert.equal(browser.panel.hidden, false);
  assert.equal(browser.stopped(), 1);
});

test('a forced fullscreen player returns to the photo option if no code was decoded', async t => {
  const browser = fakeBrowser(t, { resolveCode: assert.fail });
  browser.video.webkitExitFullscreen = () => {};
  await browser.camera.open();
  browser.video.webkitDisplayingFullscreen = true;
  browser.video.dispatchEvent(new Event('webkitbeginfullscreen'));
  assert.equal(browser.stopped(), 0);
  browser.video.webkitDisplayingFullscreen = false;
  browser.video.dispatchEvent(new Event('webkitendfullscreen'));
  assert.equal(browser.panel.hidden, false);
  assert.equal(browser.stopped(), 1);
  assert.match(browser.status.textContent, /Chụp tem/);
});
