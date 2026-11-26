export const DEMO_URL = './demo.abf.json';

export function codeFromLabel(value) {
  const match = value.trim().match(/^(\d{1,12})(?=\s*\.|\s*$)/u);
  return match ? Number(match[1]) : null;
}

export function parseProject(raw) {
  if (raw?.format !== 'tem-cnc-abf' || raw.version !== 1 || typeof raw.name !== 'string'
      || !Array.isArray(raw.parts) || raw.parts.length === 0 || raw.parts.length > 10_000) {
    throw new Error('File này không phải gói .abf.json của Tem CNC.');
  }
  const ids = new Set();
  for (const part of raw.parts) {
    if (!validPart(part) || ids.has(part.id)) {
      throw new Error('File mô hình có dữ liệu cấu kiện không hợp lệ.');
    }
    ids.add(part.id);
  }
  return { ...raw, parts: [...raw.parts].sort((a, b) => a.code - b.code) };
}

function validPart(part) {
  return part && typeof part.id === 'string' && Number.isSafeInteger(part.code) && part.code >= 0
    && typeof part.name === 'string' && typeof part.group === 'string'
    && Array.isArray(part.path) && part.path.every(item => typeof item === 'string')
    && isTriple(part.position) && isTriple(part.modelSize)
    && Array.isArray(part.vertices) && part.vertices.length % 3 === 0 && part.vertices.every(Number.isFinite)
    && Array.isArray(part.triangles) && part.triangles.length % 3 === 0
    && part.triangles.every(i => Number.isInteger(i) && i >= 0 && i < part.vertices.length / 3)
    && (!part.cut || (
      (typeof part.cut.sheet === 'string' || Number.isFinite(part.cut.sheet) || part.cut.sheet == null)
      && (part.cut.material == null || typeof part.cut.material === 'string')
      && (part.cut.thickness == null || Number.isFinite(part.cut.thickness))
      && Array.isArray(part.cut.size) && part.cut.size.length === 2 && part.cut.size.every(Number.isFinite)
    ));
}

function isTriple(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

// A single local job is kept per browser. A successful write survives a reload.
export async function localProject(action, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tem-cnc', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Kho lưu mô hình đang bận.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', action === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('projects');
      const request = action === 'put' ? store.put(value, 'current')
        : action === 'delete' ? store.delete('current') : store.get('current');
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}
