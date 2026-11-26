import { ModelViewer } from './viewer.js';
import { setupCamera } from './camera.js';
import { codeFromLabel, DEMO_URL, localProject, parseProject } from './project.js';

const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2, useGrouping: false });
const select = byId('group-select');
const lookup = byId('lookup');
const feedback = byId('lookup-feedback');
const partList = byId('parts');
const listTitle = byId('part-list-title');
const resultPanel = byId('scan-result');
const resultTitle = byId('scan-result-title');
const scanMatches = byId('scan-matches');
const scanner = byId('scanner');
const scanTitle = byId('scan-title');
const scanButton = byId('scan');
const scanNext = byId('scan-next');
let model = null;
let groups = [];
let group = null;
let activePart = null;
let candidates = null;
let viewer = null;
let modelRevision = 0;
let scanTrigger = scanButton;

function element(tagName, text, className) {
  const node = document.createElement(tagName);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

try {
  viewer = new ModelViewer(byId('stage'), id => showPart(model?.parts.find(part => part.id === id), false, false));
} catch {
  byId('viewer-error').hidden = false;
  byId('viewer-error').textContent = 'Trình duyệt chưa mở được mô hình 3D. Bạn vẫn có thể quét và tra thông tin cấu kiện.';
  byId('fit').disabled = true;
}

function renderPart() {
  const container = byId('part-detail');
  container.replaceChildren();
  resultPanel.hidden = !activePart;
  scanMatches.hidden = scanner.hidden || !candidates;
  scanMatches.replaceChildren();
  if (!scanMatches.hidden) {
    for (const part of candidates) {
      const button = element('button', `${part.group} · ${part.name.replace(/_/g, ' ').trim()}`, 'button button-outline');
      button.type = 'button';
      button.addEventListener('click', () => chooseCandidate(part));
      scanMatches.append(button);
    }
  }
  if (!activePart) return;
  const part = activePart;
  const prettyName = part.name.replace(/_/g, ' · ').replace(/\s+·\s*$/, '');
  const box = element('section', null, 'detail-box');
  const size = part.cut ? [...part.cut.size, part.cut.thickness].filter(Number.isFinite) : part.modelSize;
  const dimensions = size.map(value => number.format(value)).join(' × ') + ' mm';
  resultTitle.textContent = `#${part.code} · ${prettyName}`;
  byId('scan-result-meta').textContent = `${part.group} · ${dimensions}`;
  const heading = element('h3', `Cấu kiện #${part.code}`, 'part-title');
  const title = element('p', prettyName, 'part-name');
  const metadata = [
    [part.path.length ? 'Cụm lắp' : 'Nhóm tra cứu', part.group],
    [part.cut ? 'Kích thước cắt' : 'Kích thước 3D', dimensions]
  ];
  if (part.cut?.sheet != null) metadata.push(['Tấm ván cắt', `Tấm ${part.cut.sheet}`]);
  if (part.cut?.material) metadata.push(['Vật liệu', part.cut.material]);
  const dl = element('dl', null, 'meta-grid');
  for (const [key, value] of metadata) {
    const row = element('div');
    row.append(element('dt', key), element('dd', value));
    dl.append(row);
  }
  box.append(heading, title, dl);
  container.append(box);
}

function renderList(reveal = false) {
  const parts = candidates ?? (model?.parts.filter(part => group === null || part.group === group) ?? []);
  byId('list-count').textContent = parts.length;
  listTitle.textContent = candidates ? `Chọn cấu kiện #${candidates[0].code}` : 'Danh sách cấu kiện';
  const fragment = document.createDocumentFragment();
  let activeRow;
  for (const part of parts) {
    const item = element('li');
    const button = element('button');
    button.type = 'button';
    const selected = part.id === activePart?.id;
    button.setAttribute('aria-pressed', String(selected));
    const name = part.name.replace(/_/g, ' ').trim();
    button.append(element('span', `#${part.code}`, 'part-number'), element('span', candidates ? `${name} · ${part.group}` : name));
    button.addEventListener('click', () => {
      if (candidates) chooseCandidate(part);
      else showPart(part, true, true);
    });
    item.append(button);
    fragment.append(item);
    if (selected) activeRow = item;
  }
  const previousScroll = partList.scrollTop;
  partList.replaceChildren(fragment);
  partList.scrollTop = previousScroll;
  if (reveal && activeRow) partList.scrollTop = Math.max(0, activeRow.offsetTop - partList.offsetTop - 55);
}

function showPart(part, fit, reveal) {
  if (!part) return;
  candidates = null;
  feedback.textContent = '';
  if (group !== null && group !== part.group) setGroup(part.group, false);
  activePart = part;
  lookup.value = part.code;
  viewer?.highlight(part.id);
  if (fit) viewer?.fit(part.id);
  renderPart();
  renderList(reveal);
}

function setGroup(value, fit = true) {
  group = value;
  select.value = value === null ? 'all' : String(groups.indexOf(value));
  if (activePart && group !== null && group !== activePart.group) {
    activePart = null;
    lookup.value = '';
    viewer?.highlight(null);
  }
  viewer?.setGroup(group);
  if (fit) viewer?.fit(null, true);
  renderPart();
  renderList();
}

function resolveCode(text) {
  const code = codeFromLabel(text);
  if (!model) return { error: 'Hãy nạp mô hình của đơn cắt trước khi tra tem.' };
  if (code === null) return { error: 'Mã này chưa nhận ra là tem ABF. Hãy thử tem khác hoặc nhập số trên tem.' };
  const matches = model.parts.filter(part => part.code === code);
  if (matches.length === 0) return { error: `Mã #${code} không có trong đơn cắt đang mở. Hãy kiểm tra tên đơn cắt.` };
  if (matches.length > 1) return { code, matches };
  return { part: matches[0] };
}

function chooseCandidate(part) {
  const keepScanner = !scanner.hidden;
  revealLookup({ part }, keepScanner);
  if (keepScanner) {
    camera.confirmPart(part);
    resultTitle.focus({ preventScroll: true });
  }
}

function revealLookup({ part, code, matches }, keepScanner = false) {
  if (matches) {
    candidates = matches;
    activePart = null;
    lookup.value = code;
    feedback.textContent = `Có ${matches.length} cấu kiện mang mã #${code}. Chọn đúng cụm lắp từ danh sách.`;
    viewer?.highlight(null);
    renderPart();
    renderList();
    if (keepScanner) return;
    listTitle.focus({ preventScroll: true });
    listTitle.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    return;
  }
  if (group !== part.group) setGroup(part.group, false);
  showPart(part, true, true);
  if (keepScanner) return;
  resultTitle.focus({ preventScroll: true });
  byId('viewer').scrollIntoView({ block: 'start', behavior: 'instant' });
}

function displayProject(project, demo) {
  model = project;
  groups = [...new Set(model.parts.map(part => part.group))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  activePart = null;
  candidates = null;
  feedback.textContent = '';
  lookup.value = '';
  byId('project-title').textContent = model.name;
  byId('project-kind').textContent = demo ? 'ĐƠN CẮT MẪU' : 'ĐƠN CẮT ĐANG MỞ';
  const withLabels = project.parts.filter(part => part.cut).length;
  byId('project-meta').textContent = `${project.parts.length} cấu kiện${withLabels ? ` · ${withLabels} có dữ liệu cắt ABF` : ''}`;
  select.replaceChildren(new Option('Toàn bộ cấu kiện', 'all'), ...groups.map((name, i) => new Option(name, String(i))));
  viewer?.setProject(model.parts);
  const first = demo ? model.parts.find(part => part.code === 18) : null;
  setGroup(first?.group ?? null);
  if (first) showPart(first, false, true);
}

async function openDemo() {
  const revision = ++modelRevision;
  const response = await fetch(DEMO_URL);
  if (!response.ok) throw new Error('Không tải được mô hình mẫu. Hãy chọn file .abf.json.');
  const project = parseProject(await response.json());
  if (revision === modelRevision) displayProject(project, true);
}

async function initialize() {
  const revision = modelRevision;
  try {
    const saved = await localProject('get').catch(() => null);
    if (revision !== modelRevision) return;
    if (saved) {
      try {
        displayProject(parseProject(saved), false);
        return;
      } catch {
        // A previously stored file with an unsupported schema may be replaced by a later import.
      }
    }
    await openDemo();
  } catch (error) {
    if (model) return;
    byId('project-title').textContent = 'Chưa có mô hình';
    byId('project-meta').textContent = error.message;
  }
}

const camera = setupCamera({
  panel: scanner, video: byId('camera'), frame: byId('camera-frame'), target: byId('scan-target'),
  status: byId('camera-status'), retry: byId('retry-camera'), resolveCode, onResult: result => revealLookup(result, true),
  onVisibility: visible => {
    scanButton.setAttribute('aria-expanded', String(visible));
    scanNext.setAttribute('aria-expanded', String(visible));
    if (candidates) renderPart();
    if (visible) {
      scanTitle.focus({ preventScroll: true });
      scanner.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
});
const importDialog = byId('import-dialog');
const importStatus = byId('import-status');
const modelFile = byId('model-file');
const chooseModel = byId('choose-model');
const useDemo = byId('use-demo');
document.querySelectorAll('[data-close]').forEach(button => {
  button.addEventListener('click', () => byId(button.dataset.close).close());
});
for (const button of [scanButton, scanNext]) {
  button.addEventListener('click', event => {
    scanTrigger = event.currentTarget;
    if (scanner.hidden) camera.open();
    else {
      scanTitle.focus({ preventScroll: true });
      scanner.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  });
}
function dismissScanner() {
  camera.close();
  scanTrigger.focus();
}
byId('close-scan').addEventListener('click', dismissScanner);
scanner.addEventListener('keydown', event => {
  if (event.key === 'Escape') dismissScanner();
});
byId('manual-scan').addEventListener('click', () => {
  camera.close();
  lookup.focus();
});
for (const [buttonId, inputId] of [['take-photo', 'capture-file'], ['photo', 'photo-file']]) {
  const input = byId(inputId);
  byId(buttonId).addEventListener('click', () => {
    camera.preparePhoto();
    input.click();
  });
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (file) camera.fromPhoto(file);
  });
}
byId('import').addEventListener('click', () => {
  camera.close();
  importDialog.showModal();
});
chooseModel.addEventListener('click', () => modelFile.click());
modelFile.addEventListener('change', async () => {
  const file = modelFile.files[0];
  modelFile.value = '';
  if (!file) return;
  chooseModel.disabled = useDemo.disabled = true;
  try {
    importStatus.textContent = 'Đang đọc mô hình…';
    if (file.size > 50 * 1024 * 1024) throw new Error('File vượt quá 50 MB. Hãy xuất riêng đơn cắt cần tra.');
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new Error('Không đọc được gói mô hình. Hãy chọn file .abf.json xuất từ tiện ích Tem CNC.');
    }
    const project = parseProject(raw);
    modelRevision++;
    displayProject(project, false);
    try {
      await localProject('put', project);
      importStatus.textContent = '';
      importDialog.close();
    } catch {
      importStatus.textContent = 'Mô hình đã mở. Trình duyệt chưa lưu được file cho lần mở sau.';
    }
  } catch (error) {
    importStatus.textContent = error.message;
  } finally {
    chooseModel.disabled = useDemo.disabled = false;
  }
});
useDemo.addEventListener('click', async () => {
  chooseModel.disabled = useDemo.disabled = true;
  try {
    await openDemo();
    await localProject('delete').catch(() => {});
    importStatus.textContent = '';
    importDialog.close();
  } catch (error) {
    importStatus.textContent = error.message;
  } finally {
    chooseModel.disabled = useDemo.disabled = false;
  }
});
byId('lookup-form').addEventListener('submit', event => {
  event.preventDefault();
  const result = resolveCode(lookup.value);
  if (result.error) feedback.textContent = result.error;
  else {
    camera.close();
    revealLookup(result);
  }
});
select.addEventListener('change', () => {
  candidates = null;
  feedback.textContent = '';
  setGroup(select.value === 'all' ? null : groups[Number(select.value)]);
});
byId('fit').addEventListener('click', () => viewer?.fit(null, true));
initialize();
