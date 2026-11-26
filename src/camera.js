import jsQR from 'jsqr';

const FRAME_INTERVAL = 120;
const CAMERA_START_TIMEOUT = 8000;
const GUIDE_TEXT = 'Đưa một mã QR trên tem vào giữa khung.';
const PHOTO_TEXT = 'Chọn Chụp tem, hướng camera vào mã QR rồi xác nhận dùng ảnh. Để quét trực tiếp, mở trang bằng Safari.';

export function preferPhotoCapture({ userAgent = '', platform = '', maxTouchPoints = 0 }, search = '') {
  if (new URLSearchParams(search).get('camera') === 'photo') return true;
  const isAppleMobile = /iPhone|iPod|iPad/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  return isAppleMobile && (/Zalo/i.test(userAgent) || !/Safari\//i.test(userAgent));
}

export function setupCamera({ panel, video, frame, target, status, retry, resolveCode, onResult, onVisibility }) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let loop = null;
  let startTimeout = null;
  let generation = 0;
  let lastDecode = -Infinity;
  let lastCode = null;
  let photoOnly = preferPhotoCapture(navigator, window.location?.search);
  let hasNativeFullscreen = false;
  let afterNativeFullscreen = null;
  let exitRetry = null;

  function decode(source, x, y, width, height, limit, inversionAttempts) {
    const scale = Math.min(1, limit / Math.max(width, height));
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
      canvas.width = outputWidth;
      canvas.height = outputHeight;
    }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(source, x, y, width, height, 0, 0, outputWidth, outputHeight);
    const pixels = context.getImageData(0, 0, outputWidth, outputHeight);
    return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts })?.data;
  }

  function decodeFrame() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    // The video uses object-fit: cover. Convert the visible guide back to source pixels.
    const scale = Math.max(frame.clientWidth / width, frame.clientHeight / height);
    const side = Math.min(target.offsetWidth / scale, width, height);
    if (!Number.isFinite(side) || side < 32) return null;
    return decode(video, (width - side) / 2, (height - side) / 2, side, side, 720, 'dontInvert');
  }

  function tick(time) {
    if (!stream || panel.hidden) return;
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      if (!frame.hasAttribute('data-live')) {
        clearTimeout(startTimeout);
        startTimeout = null;
        frame.setAttribute('data-live', '');
        status.textContent = GUIDE_TEXT;
      }
      if (time - lastDecode >= FRAME_INTERVAL) {
        lastDecode = time;
        let text;
        try {
          text = decodeFrame();
        } catch {
          pause('Không đọc được hình từ camera. Hãy mở lại camera hoặc chọn ảnh tem.');
          return;
        }
        if (text && text !== lastCode) {
          lastCode = text;
          if (accept(text)) return;
        }
      }
    }
    loop = requestAnimationFrame(tick);
  }

  function accept(text) {
    const result = resolveCode(text);
    if (!result.part && !result.matches) {
      status.textContent = result.error;
      return false;
    }
    // Leave the camera view before rendering or moving focus to the result.
    afterInline(() => {
      hideScanner();
      onResult(result);
    });
    return true;
  }

  function fullscreenActive() {
    return hasNativeFullscreen || video.webkitDisplayingFullscreen === true;
  }

  function finishFullscreenExit() {
    clearTimeout(exitRetry);
    exitRetry = null;
    hasNativeFullscreen = false;
    const action = afterNativeFullscreen;
    afterNativeFullscreen = null;
    action?.();
  }

  function requestFullscreenExit() {
    try {
      if (typeof video.webkitExitFullscreen === 'function') video.webkitExitFullscreen();
      else video.webkitSetPresentationMode?.('inline');
    } catch {
      // The embedded player can reject exits until it has finished entering fullscreen.
    }
  }

  function afterInline(action) {
    if (!fullscreenActive()) {
      action();
      return;
    }
    afterNativeFullscreen = action;
    if (exitRetry !== null) return;
    exitRetry = setTimeout(() => {
      exitRetry = null;
      if (fullscreenActive()) requestFullscreenExit();
    }, 220);
    requestFullscreenExit();
  }

  function release() {
    generation++;
    if (loop !== null) cancelAnimationFrame(loop);
    loop = null;
    clearTimeout(startTimeout);
    startTimeout = null;
    const previousStream = stream;
    stream = null;
    frame.hidden = true;
    frame.removeAttribute('data-live');
    previousStream?.getTracks().forEach(track => track.stop());
    if (video.srcObject) {
      video.pause();
      video.srcObject = null;
    }
  }

  function pause(message) {
    release();
    retry.hidden = photoOnly || !navigator.mediaDevices?.getUserMedia;
    status.textContent = message;
  }

  function hideScanner() {
    if (panel.hidden) return;
    panel.hidden = true;
    release();
    onVisibility(false);
  }

  function close() {
    if (!panel.hidden) afterInline(hideScanner);
  }

  async function start() {
    if (panel.hidden) return;
    release();
    retry.hidden = true;
    lastCode = null;
    lastDecode = -Infinity;
    if (photoOnly) {
      status.textContent = PHOTO_TEXT;
      return;
    }
    if (!context || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Camera chưa dùng được trong trình duyệt này. Chọn ảnh tem hoặc nhập mã.';
      return;
    }
    const current = generation;
    status.textContent = 'Đang mở camera… Nếu trình duyệt hỏi, hãy chọn Cho phép.';
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (panel.hidden || current !== generation) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      stream = next;
      if (document.hidden) {
        pause('Camera đã tạm dừng. Chọn Mở lại camera để quét tiếp.');
        return;
      }
      for (const track of next.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (current === generation) pause('Camera đã ngắt. Hãy mở lại camera hoặc chọn ảnh tem.');
        }, { once: true });
      }
      frame.hidden = false;
      video.srcObject = next;
      startTimeout = setTimeout(() => {
        pause('Camera chưa lên hình. Hãy mở lại camera hoặc chọn ảnh tem.');
      }, CAMERA_START_TIMEOUT);
      await video.play();
      if (panel.hidden || current !== generation) return;
      loop = requestAnimationFrame(tick);
    } catch (error) {
      if (panel.hidden || current !== generation) return;
      pause(error.name === 'NotAllowedError'
        ? 'Camera chưa được cấp quyền. Hãy cho phép trong trình duyệt hoặc chọn ảnh tem.'
        : 'Không mở được camera. Hãy thử lại hoặc chọn ảnh tem.');
    }
  }

  async function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    onVisibility(true);
    await start();
  }

  function preparePhoto() {
    pause('Chọn ảnh chụp có một mã QR rõ nét.');
  }

  async function fromPhoto(file) {
    if (panel.hidden || !context) return;
    release();
    const current = generation;
    retry.hidden = photoOnly || !navigator.mediaDevices?.getUserMedia;
    status.textContent = 'Đang đọc mã trong ảnh…';
    const url = URL.createObjectURL(file);
    const picture = new Image();
    let text;
    try {
      picture.src = url;
      await picture.decode();
      if (panel.hidden || current !== generation) return;
      text = decode(picture, 0, 0, picture.naturalWidth, picture.naturalHeight, 1800, 'attemptBoth');
    } catch {
      if (!panel.hidden && current === generation) status.textContent = 'Không đọc được ảnh này. Hãy thử ảnh JPG hoặc PNG.';
      return;
    } finally {
      URL.revokeObjectURL(url);
    }
    if (text) accept(text);
    else status.textContent = 'Chưa thấy mã QR. Hãy chọn ảnh rõ hơn, thấy trọn mã trên tem.';
  }

  video.addEventListener('webkitbeginfullscreen', () => {
    if (panel.hidden || !stream) return;
    hasNativeFullscreen = true;
    photoOnly = true;
    if (!afterNativeFullscreen) afterInline(() => pause(PHOTO_TEXT));
  });
  video.addEventListener('webkitendfullscreen', finishFullscreenExit);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream && !fullscreenActive()) {
      const current = generation;
      // On iOS, the visibility event may precede the native fullscreen event.
      setTimeout(() => {
        if (document.hidden && stream && current === generation && !fullscreenActive()) {
          pause('Camera đã tạm dừng. Chọn Mở lại camera để quét tiếp.');
        }
      }, 250);
    }
  });
  window.addEventListener('pagehide', () => {
    afterNativeFullscreen = null;
    finishFullscreenExit();
    hideScanner();
  });
  retry.addEventListener('click', start);
  return { open, close, preparePhoto, fromPhoto };
}
