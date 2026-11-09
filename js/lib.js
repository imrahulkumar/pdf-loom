/* Shared helpers: lazy library loading, PDF I/O, rendering, text extraction. */
window.App = window.App || {};
(function (App) {
  'use strict';

  const CDN = {
    pdflib: 'https://unpkg.com/@cantoo/pdf-lib@2.11.1/dist/pdf-lib.min.js',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    html2pdf: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
    marked: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    pptx: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    sortable: 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
    purify: 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
  };

  /** Error whose message is safe and friendly to show the user. */
  class UserError extends Error {}

  const pending = {};
  function loadScript(src) {
    if (!pending[src]) {
      pending[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => {
          delete pending[src];
          s.remove();
          reject(new UserError('Could not load a required component. Check your internet connection (needed once, then cached).'));
        };
        document.head.appendChild(s);
      });
    }
    return pending[src];
  }

  const lib = {
    async pdflib() { await loadScript(CDN.pdflib); return window.PDFLib; },
    async pdfjs() {
      await loadScript(CDN.pdfjs);
      const p = window.pdfjsLib;
      p.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
      return p;
    },
    async jszip() { await loadScript(CDN.jszip); return window.JSZip; },
    async html2pdf() { await loadScript(CDN.html2pdf); return window.html2pdf; },
    async marked() { await loadScript(CDN.marked); return window.marked; },
    async mammoth() { await loadScript(CDN.mammoth); return window.mammoth; },
    async xlsx() { await loadScript(CDN.xlsx); return window.XLSX; },
    async pptx() { await loadScript(CDN.pptx); return window.PptxGenJS; },
    async tesseract() { await loadScript(CDN.tesseract); return window.Tesseract; },
    async sortable() { await loadScript(CDN.sortable); return window.Sortable; },
    async purify() { await loadScript(CDN.purify); return window.DOMPurify; },
  };

  // ---------- generic helpers ----------
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const MAX_CANVAS_AREA = isMobile ? 16e6 : 40e6;

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  function baseName(name) { return (name || 'file').replace(/\.[^.]+$/, ''); }
  function ext(name) { const m = /\.([^.]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function hexToRgb01(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));

  async function readBytes(file) {
    if (file instanceof Uint8Array) return file;
    return new Uint8Array(await file.arrayBuffer());
  }

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new UserError('The page was too large to render on this device. Try a lower DPI.'))), type, quality);
    });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function pdfBlob(bytes) { return new Blob([bytes], { type: 'application/pdf' }); }

  async function zipOutputs(outputs) {
    const JSZip = await lib.jszip();
    const zip = new JSZip();
    const used = new Set();
    for (const o of outputs) {
      let name = o.name; let i = 1;
      while (used.has(name)) name = baseName(o.name) + ` (${i++}).` + ext(o.name);
      used.add(name);
      zip.file(name, o.blob);
    }
    return zip.generateAsync({ type: 'blob' });
  }

  // ---------- pdf-lib ----------
  /** Load a PDF with pdf-lib. Transparently unlocks files that only have an owner password. */
  async function loadPdf(file, opts = {}) {
    const { PDFDocument } = await lib.pdflib();
    const bytes = await readBytes(file);
    const name = file.name || 'document.pdf';
    try {
      return await PDFDocument.load(bytes, { updateMetadata: false, ...opts });
    } catch (e) {
      if (/encrypted/i.test(e.message)) {
        try {
          const locked = await PDFDocument.load(bytes, { password: opts.password || '', updateMetadata: false });
          return await copyToNewDoc(locked);
        } catch (e2) {
          throw new UserError(`"${name}" is protected with a password. Unlock it with the Remove Password tool first.`);
        }
      }
      throw new UserError(`Could not read "${name}". It may not be a valid PDF. Try the Repair PDF tool.`);
    }
  }

  async function copyToNewDoc(src, indices) {
    const { PDFDocument } = await lib.pdflib();
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices || src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    return out;
  }

  /**
   * Visual (as displayed) frame of a pdf-lib page, honouring /Rotate and the crop box.
   * toUser(vx, vy) maps visual coords (origin bottom-left as seen) to PDF user space.
   */
  function vpage(page) {
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const b = page.getCropBox();
    const W = b.width; const H = b.height;
    const sideways = rot === 90 || rot === 270;
    const toUser = (vx, vy) => {
      switch (rot) {
        case 90: return { x: b.x + W - vy, y: b.y + vx };
        case 180: return { x: b.x + W - vx, y: b.y + H - vy };
        case 270: return { x: b.x + vy, y: b.y + H - vx };
        default: return { x: b.x + vx, y: b.y + vy };
      }
    };
    return { w: sideways ? H : W, h: sideways ? W : H, rot, toUser, box: b };
  }

  /** Draw text so it appears at visual position/angle regardless of page rotation. */
  function drawVisualText(page, text, { vx, vy, angle = 0, size, font, color, opacity = 1, anchor = 'left' }) {
    const { degrees } = window.PDFLib;
    const v = vpage(page);
    const t = safeText(font, text);
    const tw = font.widthOfTextAtSize(t, size);
    let ox = vx;
    if (anchor === 'center') ox = vx - tw / 2;
    else if (anchor === 'right') ox = vx - tw;
    const p = v.toUser(ox, vy);
    page.drawText(t, { x: p.x, y: p.y, size, font, color, opacity, rotate: degrees(angle + v.rot) });
  }

  async function stripMetadata(doc) {
    const { PDFName, PDFDict } = await lib.pdflib();
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (info instanceof PDFDict) for (const k of info.keys()) info.delete(k);
    doc.catalog.delete(PDFName.of('Metadata'));
    doc.catalog.delete(PDFName.of('PieceInfo'));
  }

  /** Returns characters a standard font can't encode replaced, so drawText never throws. */
  function safeText(font, text) {
    const set = font.__charset || (font.__charset = new Set(font.getCharacterSet()));
    const map = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ' };
    let out = '';
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      if (ch === '\n' || set.has(cp)) out += ch;
      else if (map[ch]) out += map[ch];
      else out += '?';
    }
    return out;
  }

  // ---------- pdf.js ----------
  async function openPdfJs(file, password) {
    const pdfjs = await lib.pdfjs();
    const data = (await readBytes(file)).slice(); // pdf.js detaches the buffer, so pass a copy
    const task = pdfjs.getDocument({ data, password, isEvalSupported: false });
    try {
      return await task.promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        throw new UserError(password ? 'Incorrect password.' : `"${file.name || 'This PDF'}" needs a password to open. Unlock it with Remove Password first.`);
      }
      throw new UserError(`Could not read "${file.name || 'this file'}". It may be damaged or not a PDF.`);
    }
  }

  /** Render a page to a canvas. Use either `dpi` or `scale`; `maxWidth` caps the width in px. */
  async function renderPage(pdf, pageNum, { dpi, scale, maxWidth, rotation, intent } = {}) {
    const page = await pdf.getPage(pageNum);
    let s = dpi ? dpi / 72 : (scale || 1);
    const opts = rotation !== undefined ? { rotation } : {};
    let vp = page.getViewport({ scale: s, ...opts });
    if (maxWidth && vp.width > maxWidth) { s *= maxWidth / vp.width; vp = page.getViewport({ scale: s, ...opts }); }
    if (vp.width * vp.height > MAX_CANVAS_AREA) {
      s *= Math.sqrt(MAX_CANVAS_AREA / (vp.width * vp.height));
      vp = page.getViewport({ scale: s, ...opts });
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, intent: intent || 'display' }).promise;
    const base = page.getViewport({ scale: 1 });
    page.cleanup();
    canvas.pdfWidth = base.width; // page size in PDF points (rotation applied)
    canvas.pdfHeight = base.height;
    return canvas;
  }

  /**
   * Rebuild a PDF from rendered page images.
   * transform(canvas, i) may return a new canvas (filters, redaction boxes...).
   */
  async function rasterizePdf(file, { dpi = 150, quality = 0.8, format = 'jpeg', transform, progress, pages, password } = {}) {
    const { PDFDocument } = await lib.pdflib();
    const pdf = await openPdfJs(file, password);
    const out = await PDFDocument.create();
    const list = pages || Array.from({ length: pdf.numPages }, (_, i) => i);
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      progress && progress(k / list.length, `Rendering page ${k + 1} of ${list.length}`);
      let canvas = await renderPage(pdf, i + 1, { dpi });
      if (transform) canvas = (await transform(canvas, i)) || canvas;
      const blob = await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', quality);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const img = format === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      const page = out.addPage([canvas.pdfWidth, canvas.pdfHeight]);
      page.drawImage(img, { x: 0, y: 0, width: canvas.pdfWidth, height: canvas.pdfHeight });
      canvas.width = canvas.height = 0; // free memory
    }
    pdf.destroy();
    return out;
  }

  /** Text of a page grouped into lines (top to bottom), with per-item x positions. */
  async function pageLines(page) {
    const tc = await page.getTextContent();
    const vp = page.getViewport({ scale: 1 });
    const items = tc.items
      .filter((it) => it.str !== undefined && it.str !== '')
      .map((it) => {
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const h = Math.hypot(it.transform[2], it.transform[3]) || 10;
        return { str: it.str, x, y, w: it.width, h };
      });
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines.length && lines[lines.length - 1];
      if (line && Math.abs(line.y - it.y) <= Math.max(2, Math.min(line.h, it.h) * 0.5)) line.items.push(it);
      else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      let text = '';
      let lastEnd = null;
      for (const it of line.items) {
        if (lastEnd !== null) {
          const gap = it.x - lastEnd;
          if (gap > it.h * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += gap > it.h * 2 ? '    ' : ' ';
        }
        text += it.str;
        lastEnd = it.x + it.w;
      }
      line.text = text.replace(/\s+$/, '');
    }
    return { lines, width: vp.width, height: vp.height };
  }

  /** Extract plain text for every page: returns array of strings. */
  async function extractText(file, progress) {
    const pdf = await openPdfJs(file);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      progress && progress((i - 1) / pdf.numPages, `Reading page ${i} of ${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const { lines } = await pageLines(page);
      // Insert blank lines where vertical gaps suggest paragraph breaks
      let text = '';
      let prev = null;
      for (const l of lines) {
        if (prev && l.y - prev.y > prev.h * 1.9) text += '\n';
        text += l.text + '\n';
        prev = l;
      }
      pages.push(text.trim());
      page.cleanup();
    }
    pdf.destroy();
    return pages;
  }

  /**
   * Rebuild paragraphs from positioned text. Returns { pages: [[{ text, heading, size }]], hasText }.
   */
  async function pdfParagraphs(file, progress) {
    const pdf = await openPdfJs(file);
    const pages = [];
    let hasText = false;
    for (let i = 1; i <= pdf.numPages; i++) {
      progress && progress((i - 1) / pdf.numPages, `Reading page ${i} of ${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const { lines } = await pageLines(page);
      page.cleanup();
      const sizes = lines.map((l) => l.h).sort((a, b) => a - b);
      const median = sizes[Math.floor(sizes.length / 2)] || 10;
      const paras = [];
      let cur = null; let prev = null;
      for (const l of lines) {
        if (!l.text.trim()) continue;
        hasText = true;
        const sizeChange = prev && Math.abs(l.h - prev.h) > Math.max(prev.h, l.h) * 0.2;
        const gap = prev ? l.y - prev.y : 0;
        if (!cur || sizeChange || gap > prev.h * 1.75 || gap < 0) {
          cur = { text: l.text.trim(), size: l.h, heading: false };
          paras.push(cur);
        } else if (/-$/.test(cur.text) && /^[a-z]/.test(l.text.trim())) {
          cur.text = cur.text.slice(0, -1) + l.text.trim();
        } else {
          cur.text += ' ' + l.text.trim();
        }
        prev = l;
      }
      for (const p of paras) p.heading = p.size >= median * 1.25 && p.text.length < 140;
      pages.push(paras);
    }
    pdf.destroy();
    return { pages, hasText };
  }

  /**
   * Parse "1-3, 5, 8-" into groups of 0-based page indices.
   * Returns null for empty / "all".
   */
  function parseRanges(str, total) {
    const s = (str || '').trim().toLowerCase();
    if (!s || s === 'all') return null;
    const groups = [];
    for (const part of s.split(/[,;]+/)) {
      const p = part.trim();
      if (!p) continue;
      const m = /^(\d*)\s*-\s*(\d*)$/.exec(p);
      let a, b;
      if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
      else if (/^\d+$/.test(p)) { a = b = +p; }
      else throw new UserError(`"${part.trim()}" isn't a valid page range. Use a format like 1-3, 5, 8-10.`);
      if (a < 1 || b < 1 || a > total || b > total) throw new UserError(`Page ${Math.max(a, b)} doesn't exist. This document has ${total} page${total === 1 ? '' : 's'}.`);
      const g = [];
      if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1);
      else for (let i = a; i >= b; i--) g.push(i - 1);
      groups.push(g);
    }
    if (!groups.length) return null;
    return groups;
  }
  function parsePageSet(str, total) {
    const g = parseRanges(str, total);
    if (!g) return null;
    return new Set(g.flat());
  }

  /**
   * Render HTML into a PDF Blob via html2pdf (html2canvas + jsPDF).
   * Content is measured and rendered in chunks, then merged, so long documents don't exceed
   * browser canvas size limits. `fitWidth` widens the layout for wide tables (scaled to the page).
   */
  async function htmlToPdfBlob(html, { format = 'a4', orientation = 'portrait', margin = 12, progress, fitWidth = false } = {}) {
    const html2pdf = await lib.html2pdf();
    const { PDFDocument } = await lib.pdflib();
    progress && progress(null, 'Laying out pages…');
    const baseW = orientation === 'landscape' ? 1050 : 720;
    const host = document.createElement('div');
    host.className = 'doc-render';
    host.style.cssText = `position:absolute;left:-100000px;top:0;width:${baseW}px;`;
    if (typeof html === 'string') host.innerHTML = html; else host.appendChild(html);
    document.body.appendChild(host);
    try {
      await Promise.all([...host.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
      let width = baseW;
      if (fitWidth) { width = Math.min(4000, Math.max(baseW, host.scrollWidth)); host.style.width = width + 'px'; }
      const styles = [...host.querySelectorAll('style')];
      styles.forEach((s) => s.remove());
      // wrap stray text nodes so every top-level node can be measured
      for (const n of [...host.childNodes]) {
        if (n.nodeType === 3 && n.textContent.trim()) { const p = document.createElement('p'); n.replaceWith(p); p.appendChild(n); }
        else if (n.nodeType !== 1) n.remove();
      }
      const scale = isMobile ? 1.5 : 2;
      const maxChunk = (isMobile ? 5000 : 9000) * (baseW / width);
      const chunks = [];
      let cur = []; let curH = 0;
      for (const el of [...host.children]) {
        const forced = el.classList.contains('html2pdf__page-break');
        const hgt = el.getBoundingClientRect().height + 16;
        if (cur.length && (curH + hgt > maxChunk || forced)) { chunks.push({ els: cur, h: curH }); cur = []; curH = 0; }
        if (forced) continue;
        cur.push(el); curH += hgt;
      }
      if (cur.length) chunks.push({ els: cur, h: curH });
      if (!chunks.length) throw new UserError('There is no content to convert.');
      host.remove();
      const merged = await PDFDocument.create();
      for (let i = 0; i < chunks.length; i++) {
        progress && progress(i / chunks.length, `Rendering part ${i + 1} of ${chunks.length}…`);
        const box = document.createElement('div');
        box.className = 'doc-render';
        box.style.width = width + 'px';
        styles.forEach((s) => box.appendChild(s.cloneNode(true)));
        chunks[i].els.forEach((el) => box.appendChild(el));
        const h = chunks[i].h;
        const ab = await html2pdf().set({
          margin,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: Math.min(scale, 30000 / Math.max(1, h * 1.2)), useCORS: true, backgroundColor: '#ffffff', logging: false },
          jsPDF: { unit: 'mm', format, orientation },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'img', 'h1', 'h2', 'h3', 'li'] },
        }).from(box).outputPdf('arraybuffer');
        const part = await PDFDocument.load(ab);
        (await merged.copyPages(part, part.getPageIndices())).forEach((p) => merged.addPage(p));
      }
      return pdfBlob(await merged.save());
    } finally {
      host.remove();
    }
  }

  Object.assign(App, {
    CDN, UserError, lib, loadScript, isMobile,
    util: {
      formatBytes, baseName, ext, escapeHtml, hexToRgb01, sleep, nextFrame, readBytes, canvasToBlob, download, pdfBlob,
      zipOutputs, loadPdf, copyToNewDoc, safeText, vpage, drawVisualText, stripMetadata, openPdfJs, renderPage, rasterizePdf, pageLines, extractText,
      pdfParagraphs, parseRanges, parsePageSet, htmlToPdfBlob,
    },
  });
})(window.App);
