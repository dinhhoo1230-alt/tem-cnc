import jsQR from 'jsqr';

export function setupCamera({ dialog, video, frame, status, onCode }) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let loop = 0;
  let generation = 0;
  let lastDecode = 0;
  let lastCode = null;

  function decode(source, width, height, limit) {
    const scale = Math.min(1, limit / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(pixels.data, pixels.width, pixels.height)?.data;
  }

  function tick(time) {
    if (!stream || !dialog.open) return;
    if (time - lastDecode > 145 && video.videoWidth && video.videoHeight) {
      lastDecode = time;
      const text = decode(video, video.videoWidth, video.videoHeight, 950);
      if (text && text !== lastCode) {
        lastCode = text;
        if (accept(text)) return;
      }
    }
    loop = requestAnimationFrame(tick);
  }

  function accept(text) {
    const error = onCode(text);
    if (!error) {
      stop();
      dialog.close();
      return true;
    }
    status.textContent = error;
    return false;
  }

  function stop() {
    generation++;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    frame.hidden = true;
    cancelAnimationFrame(loop);
  }

  async function open() {
    if (dialog.open) return;
    dialog.showModal();
    const current = ++generation;
    lastCode = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Camera cần trang HTTPS. Bạn có thể chọn ảnh tem hoặc nhập mã bằng tay.';
      return;
    }
    status.textContent = 'Đang mở camera…';
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (!dialog.open || current !== generation) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      stream = next;
      video.srcObject = next;
      await video.play();
      if (!dialog.open || current !== generation) return;
      frame.hidden = false;
      status.textContent = 'Đưa mã QR trên tem vào khung.';
      loop = requestAnimationFrame(tick);
    } catch (error) {
      if (current !== generation || !dialog.open) return;
      stop();
      status.textContent = error.name === 'NotAllowedError'
        ? 'Trình duyệt chưa được cấp quyền camera. Bạn vẫn có thể chọn ảnh tem.'
        : 'Không mở được camera. Bạn vẫn có thể chọn ảnh tem.';
    }
  }

  async function fromPhoto(file) {
    const url = URL.createObjectURL(file);
    const picture = new Image();
    try {
      picture.src = url;
      await picture.decode();
      if (!dialog.open) return;
      const text = decode(picture, picture.naturalWidth, picture.naturalHeight, 1800);
      if (text) accept(text);
      else status.textContent = 'Chưa đọc được mã QR. Hãy chọn ảnh chụp rõ, thấy trọn mã trên tem.';
    } catch {
      if (dialog.open) status.textContent = 'Không mở được ảnh này. Hãy thử ảnh JPG hoặc PNG.';
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  dialog.addEventListener('close', stop);
  window.addEventListener('pagehide', stop);
  return { open, fromPhoto };
}
