import { ModelViewer } from './viewer.js';
import { setupCamera } from './camera.js';
import { codeFromLabel, DEMO_URL, localProject, parseProject } from './project.js';

const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2, useGrouping: false });
const select = byId('group-select');
const lookup = byId('lookup');
const feedback = byId('lookup-feedback');
const partList = byId('parts');
const tag = byId('selection-tag');
let model = null;
let groups = [];
let group = null;
let activePart = null;
let candidates = null;
let viewer = null;
let modelRevision = 0;

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
  tag.hidden = !activePart || !viewer;
  if (!activePart) return;
  const part = activePart;
  const prettyName = part.name.replace(/_/g, ' · ').replace(/\s+·\s*$/, '');
  tag.textContent = `#${part.code} · ${prettyName}`;
  const box = element('section', null, 'detail-box');
  const size = part.cut ? [...part.cut.size, part.cut.thickness].filter(Number.isFinite) : part.modelSize;
  const heading = element('h3', `Cấu kiện #${part.code}`, 'part-title');
  const title = element('p', prettyName, 'part-name');
  const metadata = [
    [part.path.length ? 'Cụm lắp' : 'Nhóm tra cứu', part.group],
    [part.cut ? 'Kích thước cắt' : 'Kích thước 3D', size.map(value => number.format(value)).join(' × ') + ' mm']
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
  const fragment = document.createDocumentFragment();
  let activeRow;
  for (const part of parts) {
    const item = element('li');
    const button = element('button');
    button.type = 'button';
    const selected = part.id === activePart?.id;
    button.setAttribute('aria-pressed', String(selected));
    button.append(element('span', `#${part.code}`, 'part-number'), element('span', part.name.replace(/_/g, ' ').trim()));
    button.addEventListener('click', () => showPart(part, true, true));
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

function findPart(text) {
  const code = codeFromLabel(text);
  if (!model) return 'Hãy nạp mô hình trước khi tra tem.';
  if (code === null) return 'Không nhận ra số cấu kiện. Hãy dùng tem ABF hoặc nhập số in trên tem.';
  const matches = model.parts.filter(part => part.code === code);
  if (matches.length === 0) return `Không tìm thấy mã #${code} trong đơn cắt này.`;
  if (matches.length > 1) {
    candidates = matches;
    activePart = null;
    lookup.value = code;
    viewer?.highlight(null);
    renderPart();
    renderList();
    return `Mã #${code} trùng trong mô hình. Hãy chọn cấu kiện từ danh sách.`;
  }
  const [part] = matches;
  if (group !== part.group) setGroup(part.group, false);
  showPart(part, true, true);
  if (matchMedia('(max-width: 820px)').matches) setTimeout(() => byId('viewer').scrollIntoView({ block: 'start' }), 75);
  return '';
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

const scanDialog = byId('camera-dialog');
const camera = setupCamera({
  dialog: scanDialog, video: byId('camera'), frame: byId('camera-frame'), status: byId('camera-status'),
  onCode: text => {
    const error = findPart(text);
    feedback.textContent = error;
    return error;
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
byId('scan').addEventListener('click', camera.open);
byId('photo').addEventListener('click', () => byId('photo-file').click());
byId('photo-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await camera.fromPhoto(file);
});
byId('import').addEventListener('click', () => importDialog.showModal());
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
  feedback.textContent = findPart(lookup.value);
});
select.addEventListener('change', () => {
  candidates = null;
  feedback.textContent = '';
  setGroup(select.value === 'all' ? null : groups[Number(select.value)]);
});
byId('fit').addEventListener('click', () => viewer?.fit(null, true));
initialize();
