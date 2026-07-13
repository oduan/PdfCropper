import './style.css';
import { degrees, PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type Crop = { x: number; y: number; width: number; height: number };

const icons = {
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>',
  crop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <button class="brand" id="reloadButton" type="button" aria-label="Reload Margin"><span class="brand-mark">M</span><span>Margin</span></button>
      <div class="file-meta" id="fileMeta"><span class="status-dot"></span><span>Waiting for a document</span></div>
      <div class="top-actions">
        <button class="button button-accent button-export" id="exportButton" disabled>${icons.crop}<span>Export</span></button>
      </div>
    </header>

    <section class="workspace empty" id="workspace">
      <section class="stage" id="stage">
        <div class="drop-zone" id="dropZone">
          <div class="drop-icon">${icons.upload}</div>
          <h1>Drop a PDF here</h1>
          <p>Select the page area you want to keep</p>
          <button class="button button-accent" id="chooseButton">Choose PDF</button>
          <span class="drop-hint">Your file never leaves this browser</span>
        </div>

        <div class="document-stage" id="documentStage">
          <div class="workspace-hint">Drag selection to move · Drag corners to resize</div>
          <div class="canvas-wrap" id="canvasWrap">
            <canvas id="pdfCanvas"></canvas>
            <div class="crop-shade" id="cropShade"></div>
            <div class="selection" id="selection">
              <i data-handle="nw" aria-hidden="true"></i><i data-handle="ne" aria-hidden="true"></i>
              <i data-handle="se" aria-hidden="true"></i><i data-handle="sw" aria-hidden="true"></i>
              <i data-handle="n" aria-hidden="true"></i><i data-handle="e" aria-hidden="true"></i>
              <i data-handle="s" aria-hidden="true"></i><i data-handle="w" aria-hidden="true"></i>
            </div>
          </div>
          <div class="page-controls">
            <button class="icon-button" id="prevPage" aria-label="Previous page">${icons.chevronLeft}</button>
            <span><strong id="currentPageLabel">1</strong> / <span id="totalPagesLabel">1</span></span>
            <button class="icon-button" id="nextPage" aria-label="Next page">${icons.chevronRight}</button>
            <span class="control-divider"></span>
            <span id="pageSizeLabel">—</span>
          </div>
        </div>
      </section>
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

let sourceBytes: Uint8Array | null = null;
let sourceName = '';
let pdf: pdfjs.PDFDocumentProxy | null = null;
let pageNumber = 1;
let renderToken = 0;
let allPagesCrop: Crop | null = null;
let drawing = false;
let dragMode: 'move' | 'resize' = 'move';
let dragHandle = '';
let dragStart = { x: 0, y: 0 };
let dragCrop: Crop = { x: 0, y: 0, width: 1, height: 1 };

const fullCrop = (): Crop => ({ x: 0, y: 0, width: 1, height: 1 });
const activeCrop = () => allPagesCrop ?? fullCrop();

function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.textContent = message;
  toast.className = `toast visible ${type}`;
  window.setTimeout(() => toast.classList.remove('visible'), type === 'error' ? 6000 : 2800);
}

async function openFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.pdf')) return showToast('Please choose a PDF file.', 'error');
  let step = 'Reading file';
  try {
    workspace.classList.add('loading');
    const safeBytes = new Uint8Array(await file.arrayBuffer());
    step = 'Parsing document';
    const loaded = await pdfjs.getDocument({ data: safeBytes.slice() }).promise;
    sourceBytes = safeBytes;
    sourceName = file.name || 'document.pdf';
    pdf = loaded;
    pageNumber = 1;
    allPagesCrop = fullCrop();
    workspace.classList.remove('empty');
    $('#exportButton').removeAttribute('disabled');
    $('#fileMeta').innerHTML = `<span class="status-dot ready"></span><span title="${sourceName}">${sourceName}</span><small>${pdf.numPages} pages</small>`;
    $('#totalPagesLabel').textContent = String(pdf.numPages);
    step = 'Rendering page';
    await renderPage();
    showToast('PDF ready. Adjust the crop area, then export.');
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    const message = detail.includes('password')
      ? 'This PDF is password protected and cannot be opened yet.'
      : `${step} failed: ${detail || 'Unknown error'}`;
    showToast(message, 'error');
  } finally {
    workspace.classList.remove('loading');
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
  updateSelectionUI();
  ($('#prevPage') as HTMLButtonElement).disabled = pageNumber === 1;
  ($('#nextPage') as HTMLButtonElement).disabled = pageNumber === pdf.numPages;
}

function updateSelectionUI() {
  const crop = activeCrop();
  const isEditable = allPagesCrop !== null;
  selection.classList.toggle('editable', isEditable);
  selection.style.left = `${crop.x * 100}%`;
  selection.style.top = `${crop.y * 100}%`;
  selection.style.width = `${crop.width * 100}%`;
  selection.style.height = `${crop.height * 100}%`;
  canvasWrap.style.setProperty('--crop-left', `${crop.x * 100}%`);
  canvasWrap.style.setProperty('--crop-top', `${crop.y * 100}%`);
  canvasWrap.style.setProperty('--crop-right', `${(1 - crop.x - crop.width) * 100}%`);
  canvasWrap.style.setProperty('--crop-bottom', `${(1 - crop.y - crop.height) * 100}%`);
}

function setCrop(crop: Crop) {
  const normalized = {
    x: Math.max(0, Math.min(crop.x, 0.99)),
    y: Math.max(0, Math.min(crop.y, 0.99)),
    width: Math.max(0.01, Math.min(crop.width, 1 - crop.x)),
    height: Math.max(0.01, Math.min(crop.height, 1 - crop.y)),
  };
  allPagesCrop = normalized;
  updateSelectionUI();
}

async function goToPage(next: number) {
  if (!pdf || next < 1 || next > pdf.numPages || next === pageNumber) return;
  pageNumber = next;
  await renderPage();
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
  const target = event.target as HTMLElement;
  const handle = target.closest<HTMLElement>('.selection i')?.dataset.handle;
  const selectedArea = target.closest('.selection.editable');
  if (!handle && !selectedArea) return;
  drawing = true;
  canvasWrap.setPointerCapture(event.pointerId);
  const point = pointerPosition(event);
  dragStart = { x: point.x / point.width, y: point.y / point.height };
  dragCrop = { ...activeCrop() };
  dragMode = handle ? 'resize' : 'move';
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

});

canvasWrap.addEventListener('pointerup', () => {
  drawing = false;
  canvasWrap.classList.remove('selecting');
});

async function chooseFile() {
  $<HTMLInputElement>('#filePicker').click();
}

$('#chooseButton').addEventListener('click', chooseFile);
$('#reloadButton').addEventListener('click', () => window.location.reload());
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
        types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
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
    button.querySelector('span')!.textContent = 'Exporting…';
    const source = await PDFDocument.load(sourceBytes.slice());
    const output = await PDFDocument.create();
    const sourcePages = source.getPages();

    for (let index = 0; index < sourcePages.length; index++) {
      const sourcePage = sourcePages[index];
      const mediaBox = sourcePage.getMediaBox();
      const crop = allPagesCrop;
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
    if (savedName) showToast(`Saved: ${savedName}`);
  } catch (error) {
    console.error(error);
    showToast('Export failed. Please try again.', 'error');
  } finally {
    button.disabled = false;
    button.classList.remove('working');
    button.querySelector('span')!.textContent = 'Export';
  }
});

window.addEventListener('resize', () => { if (pdf) renderPage(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
}
