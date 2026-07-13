import './style.css';
import { degrees, PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type Crop = { x: number; y: number; width: number; height: number };

const icons = {
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>',
  crop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">M</span><span>Margin</span><small>PDF 裁切器</small></div>
      <div class="file-meta" id="fileMeta"><span class="status-dot"></span><span>等待文档</span></div>
      <div class="top-actions">
        <button class="button button-quiet" id="openButton">${icons.file}<span>打开 PDF</span></button>
        <button class="button button-accent" id="exportButton" disabled>${icons.crop}<span>导出裁切版</span></button>
      </div>
    </header>

    <section class="workspace empty" id="workspace">
      <aside class="page-rail" aria-label="页面导航">
        <div class="rail-label">页面</div>
        <div class="page-list" id="pageList"></div>
      </aside>

      <section class="stage" id="stage">
        <div class="drop-zone" id="dropZone">
          <div class="drop-icon">${icons.upload}</div>
          <h1>把 PDF 放到这里</h1>
          <p>拖入文件，框选需要保留的页面区域</p>
          <button class="button button-accent" id="chooseButton">选择 PDF</button>
          <span class="drop-hint">文件仅在本机处理</span>
        </div>

        <div class="document-stage" id="documentStage">
          <div class="canvas-wrap" id="canvasWrap">
            <canvas id="pdfCanvas"></canvas>
            <div class="crop-shade" id="cropShade"></div>
            <div class="selection" id="selection">
              <i data-handle="nw" aria-hidden="true"></i><i data-handle="ne" aria-hidden="true"></i>
              <i data-handle="se" aria-hidden="true"></i><i data-handle="sw" aria-hidden="true"></i>
            </div>
          </div>
          <div class="page-controls">
            <button class="icon-button" id="prevPage" aria-label="上一页">${icons.chevronLeft}</button>
            <span><strong id="currentPageLabel">1</strong> / <span id="totalPagesLabel">1</span></span>
            <button class="icon-button" id="nextPage" aria-label="下一页">${icons.chevronRight}</button>
            <span class="control-divider"></span>
            <span id="pageSizeLabel">—</span>
          </div>
        </div>
      </section>

      <aside class="inspector">
        <div class="inspector-heading">
          <span class="eyebrow">裁切范围</span>
          <h2>保留区域</h2>
          <p>在页面上拖动鼠标框选，框内内容会被保留。</p>
        </div>

        <div class="scope-switch" role="group" aria-label="裁切应用范围">
          <button class="active" data-scope="current">仅当前页</button>
          <button data-scope="all">全部页面</button>
        </div>

        <div class="measure-grid">
          <label><span>左边距</span><div><input id="cropX" type="number" min="0" max="100" step="0.1" value="0"><em>%</em></div></label>
          <label><span>上边距</span><div><input id="cropY" type="number" min="0" max="100" step="0.1" value="0"><em>%</em></div></label>
          <label><span>宽度</span><div><input id="cropW" type="number" min="1" max="100" step="0.1" value="100"><em>%</em></div></label>
          <label><span>高度</span><div><input id="cropH" type="number" min="1" max="100" step="0.1" value="100"><em>%</em></div></label>
        </div>

        <div class="preset-row">
          <button id="resetCrop">整页</button>
          <button id="clearCrop">清除本页设置</button>
        </div>

        <div class="inspector-note">
          <span>${icons.check}</span>
          <p><strong>不会压缩画质</strong>导出时只修改页面边界，文字和矢量内容保持清晰。</p>
        </div>
      </aside>
    </section>
    <input id="filePicker" type="file" accept="application/pdf,.pdf" hidden>
    <div class="toast" id="toast"></div>
  </main>
`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const workspace = $('#workspace');
const stage = $('#stage');
const dropZone = $('#dropZone');
const canvas = $<HTMLCanvasElement>('#pdfCanvas');
const canvasWrap = $('#canvasWrap');
const selection = $('#selection');
const toast = $('#toast');
const inputs = {
  x: $<HTMLInputElement>('#cropX'), y: $<HTMLInputElement>('#cropY'),
  width: $<HTMLInputElement>('#cropW'), height: $<HTMLInputElement>('#cropH'),
};

let sourceBytes: Uint8Array | null = null;
let sourceName = '';
let pdf: pdfjs.PDFDocumentProxy | null = null;
let pageNumber = 1;
let renderToken = 0;
let scope: 'current' | 'all' = 'current';
const pageCrops = new Map<number, Crop>();
let allPagesCrop: Crop | null = null;
let drawing = false;
let dragMode: 'draw' | 'move' | 'resize' = 'draw';
let dragHandle = '';
let dragStart = { x: 0, y: 0 };
let dragCrop: Crop = { x: 0, y: 0, width: 1, height: 1 };

const fullCrop = (): Crop => ({ x: 0, y: 0, width: 1, height: 1 });
const activeCrop = () => scope === 'all' ? (allPagesCrop ?? fullCrop()) : (pageCrops.get(pageNumber) ?? fullCrop());

function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.textContent = message;
  toast.className = `toast visible ${type}`;
  window.setTimeout(() => toast.classList.remove('visible'), type === 'error' ? 6000 : 2800);
}

async function openFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.pdf')) return showToast('请选择 PDF 文件', 'error');
  let step = '读取文件';
  try {
    workspace.classList.add('loading');
    const safeBytes = new Uint8Array(await file.arrayBuffer());
    step = '解析文档';
    const loaded = await pdfjs.getDocument({ data: safeBytes.slice() }).promise;
    sourceBytes = safeBytes;
    sourceName = file.name || 'document.pdf';
    pdf = loaded;
    pageNumber = 1;
    pageCrops.clear();
    allPagesCrop = null;
    workspace.classList.remove('empty');
    $('#exportButton').removeAttribute('disabled');
    $('#fileMeta').innerHTML = `<span class="status-dot ready"></span><span title="${sourceName}">${sourceName}</span><small>${pdf.numPages} 页</small>`;
    $('#totalPagesLabel').textContent = String(pdf.numPages);
    buildPageList();
    step = '渲染页面';
    await renderPage();
    showToast('PDF 已载入，可以开始框选');
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    const message = detail.includes('password')
      ? '这个 PDF 受密码保护，目前无法打开'
      : `${step}失败：${detail || '未知错误'}`;
    showToast(message, 'error');
  } finally {
    workspace.classList.remove('loading');
  }
}

function buildPageList() {
  const list = $('#pageList');
  list.innerHTML = '';
  if (!pdf) return;
  for (let index = 1; index <= pdf.numPages; index++) {
    const button = document.createElement('button');
    button.className = index === pageNumber ? 'page-item active' : 'page-item';
    button.innerHTML = `<span>${String(index).padStart(2, '0')}</span><i></i>`;
    button.title = `第 ${index} 页`;
    button.addEventListener('click', () => goToPage(index));
    list.append(button);
  }
}

async function renderPage() {
  if (!pdf) return;
  const token = ++renderToken;
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(320, stage.clientWidth - 120);
  const availableHeight = Math.max(360, stage.clientHeight - 130);
  const scale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height, 1.55);
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  canvasWrap.style.width = `${viewport.width}px`;
  canvasWrap.style.height = `${viewport.height}px`;
  if (token !== renderToken) return;
  await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
  $('#currentPageLabel').textContent = String(pageNumber);
  $('#pageSizeLabel').textContent = `${Math.round(baseViewport.width)} × ${Math.round(baseViewport.height)} pt`;
  updatePageListState();
  updateSelectionUI();
  ($('#prevPage') as HTMLButtonElement).disabled = pageNumber === 1;
  ($('#nextPage') as HTMLButtonElement).disabled = pageNumber === pdf.numPages;
}

function updatePageListState() {
  document.querySelectorAll<HTMLButtonElement>('.page-item').forEach((button, index) => {
    button.classList.toggle('active', index + 1 === pageNumber);
    button.classList.toggle('cropped', pageCrops.has(index + 1) || allPagesCrop !== null);
  });
}

function updateSelectionUI() {
  const crop = activeCrop();
  const isEditable = scope === 'all' ? allPagesCrop !== null : pageCrops.has(pageNumber);
  selection.classList.toggle('editable', isEditable);
  selection.style.left = `${crop.x * 100}%`;
  selection.style.top = `${crop.y * 100}%`;
  selection.style.width = `${crop.width * 100}%`;
  selection.style.height = `${crop.height * 100}%`;
  canvasWrap.style.setProperty('--crop-left', `${crop.x * 100}%`);
  canvasWrap.style.setProperty('--crop-top', `${crop.y * 100}%`);
  canvasWrap.style.setProperty('--crop-right', `${(1 - crop.x - crop.width) * 100}%`);
  canvasWrap.style.setProperty('--crop-bottom', `${(1 - crop.y - crop.height) * 100}%`);
  inputs.x.value = (crop.x * 100).toFixed(1);
  inputs.y.value = (crop.y * 100).toFixed(1);
  inputs.width.value = (crop.width * 100).toFixed(1);
  inputs.height.value = (crop.height * 100).toFixed(1);
}

function setCrop(crop: Crop) {
  const normalized = {
    x: Math.max(0, Math.min(crop.x, 0.99)),
    y: Math.max(0, Math.min(crop.y, 0.99)),
    width: Math.max(0.01, Math.min(crop.width, 1 - crop.x)),
    height: Math.max(0.01, Math.min(crop.height, 1 - crop.y)),
  };
  if (scope === 'all') allPagesCrop = normalized;
  else pageCrops.set(pageNumber, normalized);
  updateSelectionUI();
  updatePageListState();
}

async function goToPage(next: number) {
  if (!pdf || next < 1 || next > pdf.numPages || next === pageNumber) return;
  pageNumber = next;
  await renderPage();
  document.querySelector('.page-item.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function pointerPosition(event: PointerEvent) {
  const rect = canvasWrap.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
    width: rect.width,
    height: rect.height,
  };
}

canvasWrap.addEventListener('pointerdown', (event) => {
  if (!pdf) return;
  drawing = true;
  canvasWrap.setPointerCapture(event.pointerId);
  const point = pointerPosition(event);
  dragStart = { x: point.x / point.width, y: point.y / point.height };
  dragCrop = { ...activeCrop() };
  const target = event.target as HTMLElement;
  const handle = target.closest<HTMLElement>('.selection i')?.dataset.handle;
  dragMode = handle ? 'resize' : target.closest('.selection.editable') ? 'move' : 'draw';
  dragHandle = handle ?? '';
  canvasWrap.classList.add('selecting');
});

canvasWrap.addEventListener('pointermove', (event) => {
  if (!drawing) return;
  const point = pointerPosition(event);
  const current = { x: point.x / point.width, y: point.y / point.height };
  const dx = current.x - dragStart.x;
  const dy = current.y - dragStart.y;

  if (dragMode === 'move') {
    setCrop({
      ...dragCrop,
      x: Math.max(0, Math.min(dragCrop.x + dx, 1 - dragCrop.width)),
      y: Math.max(0, Math.min(dragCrop.y + dy, 1 - dragCrop.height)),
    });
    return;
  }

  if (dragMode === 'resize') {
    const minSize = 0.02;
    let left = dragCrop.x;
    let top = dragCrop.y;
    let right = dragCrop.x + dragCrop.width;
    let bottom = dragCrop.y + dragCrop.height;
    if (dragHandle.includes('w')) left = Math.max(0, Math.min(dragCrop.x + dx, right - minSize));
    if (dragHandle.includes('e')) right = Math.min(1, Math.max(right + dx, left + minSize));
    if (dragHandle.includes('n')) top = Math.max(0, Math.min(dragCrop.y + dy, bottom - minSize));
    if (dragHandle.includes('s')) bottom = Math.min(1, Math.max(bottom + dy, top + minSize));
    setCrop({ x: left, y: top, width: right - left, height: bottom - top });
    return;
  }

  const x = Math.min(dragStart.x, current.x);
  const y = Math.min(dragStart.y, current.y);
  setCrop({ x, y, width: Math.max(0.01, Math.abs(current.x - dragStart.x)), height: Math.max(0.01, Math.abs(current.y - dragStart.y)) });
});

canvasWrap.addEventListener('pointerup', () => {
  drawing = false;
  canvasWrap.classList.remove('selecting');
});

Object.entries(inputs).forEach(([key, input]) => {
  input.addEventListener('change', () => {
    const crop = activeCrop();
    const value = Number(input.value) / 100;
    setCrop({ ...crop, [key]: value });
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((button) => {
  button.addEventListener('click', () => {
    scope = button.dataset.scope as 'current' | 'all';
    document.querySelectorAll('[data-scope]').forEach(el => el.classList.toggle('active', el === button));
    updateSelectionUI();
  });
});

$('#resetCrop').addEventListener('click', () => setCrop(fullCrop()));
$('#clearCrop').addEventListener('click', () => {
  if (scope === 'all') allPagesCrop = null;
  else pageCrops.delete(pageNumber);
  updateSelectionUI();
  updatePageListState();
});

async function chooseFile() {
  $<HTMLInputElement>('#filePicker').click();
}

$('#openButton').addEventListener('click', chooseFile);
$('#chooseButton').addEventListener('click', chooseFile);
$<HTMLInputElement>('#filePicker').addEventListener('change', async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (file) await openFile(file);
  input.value = '';
});
$('#prevPage').addEventListener('click', () => goToPage(pageNumber - 1));
$('#nextPage').addEventListener('click', () => goToPage(pageNumber + 1));

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); chooseFile(); }
  if (event.key === 'ArrowLeft') goToPage(pageNumber - 1);
  if (event.key === 'ArrowRight') goToPage(pageNumber + 1);
});

['dragenter', 'dragover'].forEach(type => document.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(type => document.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
}));
document.addEventListener('drop', async (event) => {
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  await openFile(file);
});

async function saveInBrowser(bytes: Uint8Array, suggestedName: string) {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([data], { type: 'application/pdf' });
  const pickerWindow = window as Window & {
    showSaveFilePicker?: (options: object) => Promise<{
      name: string;
      createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };

  if (pickerWindow.showSaveFilePicker) {
    try {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'PDF 文档', accept: { 'application/pdf': ['.pdf'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle.name;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      console.warn('File System Access API unavailable, falling back to download.', error);
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggestedName;
}

$('#exportButton').addEventListener('click', async () => {
  if (!sourceBytes || !pdf) return;
  const button = $<HTMLButtonElement>('#exportButton');
  try {
    button.disabled = true;
    button.classList.add('working');
    button.querySelector('span')!.textContent = '正在导出…';
    const source = await PDFDocument.load(sourceBytes.slice());
    const output = await PDFDocument.create();
    const sourcePages = source.getPages();

    for (let index = 0; index < sourcePages.length; index++) {
      const sourcePage = sourcePages[index];
      const mediaBox = sourcePage.getMediaBox();
      const crop = allPagesCrop ?? pageCrops.get(index + 1);
      let box = {
        left: mediaBox.x,
        bottom: mediaBox.y,
        right: mediaBox.x + mediaBox.width,
        top: mediaBox.y + mediaBox.height,
      };

      if (crop) {
        const displayPage = await pdf.getPage(index + 1);
        const viewport = displayPage.getViewport({ scale: 1 });
        const left = crop.x * viewport.width;
        const top = crop.y * viewport.height;
        const right = (crop.x + crop.width) * viewport.width;
        const bottom = (crop.y + crop.height) * viewport.height;
        const points = [
          viewport.convertToPdfPoint(left, top), viewport.convertToPdfPoint(right, top),
          viewport.convertToPdfPoint(right, bottom), viewport.convertToPdfPoint(left, bottom),
        ];
        const xs = points.map(point => point[0]);
        const ys = points.map(point => point[1]);
        box = { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
      }

      const width = box.right - box.left;
      const height = box.top - box.bottom;
      const embedded = await output.embedPage(sourcePage, box);
      const newPage = output.addPage([width, height]);
      newPage.drawPage(embedded, { x: 0, y: 0, width, height });
      newPage.setRotation(degrees(sourcePage.getRotation().angle));
    }

    const title = source.getTitle();
    const author = source.getAuthor();
    const subject = source.getSubject();
    const keywords = source.getKeywords();
    if (title) output.setTitle(title);
    if (author) output.setAuthor(author);
    if (subject) output.setSubject(subject);
    if (keywords) output.setKeywords(keywords.split(/[,;]\s*/).filter(Boolean));
    output.setProducer('Margin PDF Cropper');
    const bytes = await output.save();
    const suggestedName = sourceName.replace(/\.pdf$/i, '') + '-cropped.pdf';
    const savedName = await saveInBrowser(bytes, suggestedName);
    if (savedName) showToast(`已保存：${savedName}`);
  } catch (error) {
    console.error(error);
    showToast('导出失败，请重试', 'error');
  } finally {
    button.disabled = false;
    button.classList.remove('working');
    button.querySelector('span')!.textContent = '导出裁切版';
  }
});

window.addEventListener('resize', () => { if (pdf) renderPage(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
}
