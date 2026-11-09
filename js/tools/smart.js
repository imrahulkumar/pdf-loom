/* Smart tools (summarize, compare, repair) and Scan to PDF */
(function (App) {
  'use strict';
  const { util, lib, UserError, icon } = App;
  const PDF = '.pdf,application/pdf';
  const ui = () => App.ui;
  const esc = util.escapeHtml;

  // ---------------- Summarizer (extractive, on-device) ----------------
  const STOP = new Set(('a an the and or but if of to in on for with at by from is are was were be been being this that these those it its as not no can will would should could may might has have had do does did so than then there their they them he she his her we our you your i me my which who whom what when where why how all any each more most other some such only own same too very just also into over under about after before between through during up down out off again further once here both few nor per via one two new use used using within without upon however therefore thus among page').split(' '));
  function summarize(text, n) {
    const clean = text.replace(/\s+/g, ' ').trim();
    const sents = (clean.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []).map((s) => s.trim()).filter((s) => s.split(' ').length >= 6 && s.length < 600);
    const words = clean.toLowerCase().match(/[a-zÀ-ɏऀ-ॿ][a-zÀ-ɏऀ-ॿ'-]{2,}/g) || [];
    const freq = {};
    for (const w of words) if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
    const max = Math.max(1, ...Object.values(freq));
    const scored = sents.map((s, i) => {
      const ws = s.toLowerCase().match(/[a-zÀ-ɏऀ-ॿ][a-zÀ-ɏऀ-ॿ'-]{2,}/g) || [];
      const score = ws.reduce((a, w) => a + (freq[w] || 0) / max, 0) / Math.pow(Math.max(ws.length, 1), 0.6);
      const pos = i < sents.length * 0.1 ? 1.25 : 1; // early sentences tend to carry the thesis
      return { s, i, score: score * pos };
    });
    const top = [...scored].sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
    const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
    return { top, keywords, words: words.length, sentences: sents.length };
  }
  App.registerTool({
    id: 'summarize-pdf', category: 'ai', icon: 'sparkles',
    title: 'PDF Summarizer', desc: 'Get the key sentences, keywords and reading stats of a document, computed on your device.',
    keywords: 'summary tldr key points ai abstract',
    accept: PDF, action: 'Summarize', badge: 'On-device',
    options: [{ id: 'len', label: 'Summary length', type: 'seg', default: '7', choices: [['4', 'Short'], ['7', 'Medium'], ['14', 'Detailed']] }],
    async run({ file, opts, progress }) {
      const pages = await util.extractText(file, progress);
      const text = pages.join('\n');
      if (text.trim().length < 200) throw new UserError('Not enough text to summarize. For scanned PDFs, run OCR first.');
      const r = summarize(text, +opts.len);
      const mins = Math.max(1, Math.round(r.words / 230));
      const html = `<div class="stats">
          <div class="stat"><b>${pages.length}</b><span>pages</span></div>
          <div class="stat"><b>${r.words.toLocaleString()}</b><span>words</span></div>
          <div class="stat"><b>${mins} min</b><span>reading time</span></div>
          <div class="stat"><b>${r.sentences.toLocaleString()}</b><span>sentences</span></div>
        </div>
        <div class="panel-title">Key points</div>
        <ol class="summary-list">${r.top.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <div class="panel-title" style="margin-top:16px">Keywords</div>
        <div class="kw">${r.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</div>`;
      const plain = `Summary of ${file.name}\n\n${r.top.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nKeywords: ${r.keywords.join(', ')}`;
      return { title: 'Summary', outputs: [{ html }, { name: util.baseName(file.name) + '-summary.txt', blob: new Blob([plain], { type: 'text/plain;charset=utf-8' }) }], message: 'Extractive summary: the most representative sentences from the document.' };
    },
  });

  // ---------------- Compare ----------------
  function lineDiff(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 4e6) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: a[i++] }); else out.push({ t: '+', s: b[j++] });
    }
    while (i < n) out.push({ t: '-', s: a[i++] });
    while (j < m) out.push({ t: '+', s: b[j++] });
    return out;
  }
  App.registerTool({
    id: 'compare-pdfs', category: 'ai', icon: 'compare',
    title: 'Compare PDFs', desc: 'See two versions side by side with highlighted visual and text differences.',
    keywords: 'diff difference versions changes side by side',
    mount(root) {
      const { h, createDropzone, toast } = ui();
      const s = App.toolkit.scaffold(root);
      const files = [null, null];
      const pick = h('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px"></div>');
      const labels = ['Original PDF', 'Changed PDF'];
      const zones = labels.map((label, k) => {
        const z = createDropzone({ accept: PDF, label, sub: 'Click or drop a PDF', onFiles: ([f]) => { files[k] = f; z.el.querySelector('strong').textContent = '✓ ' + f.name; z.el.querySelector('.muted').textContent = util.formatBytes(f.size) + ' · click to change'; } });
        pick.appendChild(z.el);
        return z;
      });
      void zones;
      const actions = h('<div class="actions"><button class="btn primary big">Compare</button></div>');
      const out = h('<div></div>');
      root.append(pick, actions);
      s.mountTail();
      root.appendChild(out);
      const btn = actions.querySelector('button');
      btn.onclick = async () => {
        if (!files[0] || !files[1]) return toast('Choose both PDFs first.');
        btn.disabled = true; out.innerHTML = ''; s.errorEl.classList.add('hidden');
        try {
          s.progress.set(null, 'Opening documents…');
          const [A, B] = await Promise.all(files.map((f) => util.openPdfJs(f)));
          // text diff
          const [ta, tb] = await Promise.all(files.map((f) => util.extractText(f)));
          const la = ta.join('\n').split('\n').map((x) => x.trim()).filter(Boolean);
          const lb = tb.join('\n').split('\n').map((x) => x.trim()).filter(Boolean);
          const diff = lineDiff(la, lb);
          const pages = Math.max(A.numPages, B.numPages);
          const textPanel = h('<div class="panel"><div class="panel-title">Text changes</div><div class="out-preview" style="max-height:260px"></div></div>');
          const pre = textPanel.querySelector('.out-preview');
          if (!diff) pre.textContent = 'Documents are too long for a line-by-line text comparison.';
          else if (!diff.length) pre.innerHTML = '<span style="color:var(--ok)">No text differences found.</span>';
          else pre.innerHTML = diff.slice(0, 2000).map((d) => `<div style="color:${d.t === '+' ? 'var(--ok)' : 'var(--danger)'}">${d.t} ${esc(d.s)}</div>`).join('');
          const summary = h(`<p class="note">${A.numPages} vs ${B.numPages} pages · ${diff ? `${diff.filter((d) => d.t === '-').length} lines removed, ${diff.filter((d) => d.t === '+').length} lines added` : ''}. Red areas in the third column show visual differences.</p>`);
          const grid = h('<div class="compare-grid"><div class="compare-col"><h3>Original</h3></div><div class="compare-col"><h3>Changed</h3></div><div class="compare-col"><h3>Differences</h3></div></div>');
          out.append(summary, textPanel, grid);
          const cols = grid.querySelectorAll('.compare-col');
          let syncing = false;
          cols.forEach((c) => c.addEventListener('scroll', () => {
            if (syncing) return; syncing = true;
            const f = c.scrollTop / Math.max(1, c.scrollHeight - c.clientHeight);
            cols.forEach((o) => { if (o !== c) o.scrollTop = f * (o.scrollHeight - o.clientHeight); });
            requestAnimationFrame(() => { syncing = false; });
          }));
          let changedPages = 0;
          for (let i = 1; i <= pages; i++) {
            s.progress.set((i - 1) / pages, `Comparing page ${i} of ${pages}`);
            const ca = i <= A.numPages ? await util.renderPage(A, i, { maxWidth: 700, scale: 1.2 }) : null;
            const cb = i <= B.numPages ? await util.renderPage(B, i, { maxWidth: 700, scale: 1.2 }) : null;
            const blank = (ref) => { const c = document.createElement('canvas'); c.width = ref.width; c.height = ref.height; const x = c.getContext('2d'); x.fillStyle = '#f3f3f3'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#999'; x.font = '20px sans-serif'; x.fillText('(no page)', 20, 40); return c; };
            const a = ca || blank(cb); const b = cb || blank(ca);
            const d = document.createElement('canvas');
            d.width = a.width; d.height = a.height;
            const dx = d.getContext('2d');
            dx.drawImage(b, 0, 0, d.width, d.height);
            const pb = dx.getImageData(0, 0, d.width, d.height);
            const pa = a.getContext('2d').getImageData(0, 0, d.width, d.height);
            let diffPx = 0;
            for (let p = 0; p < pb.data.length; p += 4) {
              const delta = Math.abs(pa.data[p] - pb.data[p]) + Math.abs(pa.data[p + 1] - pb.data[p + 1]) + Math.abs(pa.data[p + 2] - pb.data[p + 2]);
              const g = (pb.data[p] + pb.data[p + 1] + pb.data[p + 2]) / 3;
              if (delta > 60) { pb.data[p] = 230; pb.data[p + 1] = 40; pb.data[p + 2] = 40; diffPx++; } else { const v = 255 - (255 - g) * 0.3; pb.data[p] = pb.data[p + 1] = pb.data[p + 2] = v; }
            }
            dx.putImageData(pb, 0, 0);
            if (diffPx > 20) changedPages++;
            cols[0].appendChild(a); cols[1].appendChild(b); cols[2].appendChild(d);
          }
          summary.textContent = `${A.numPages} vs ${B.numPages} pages · ${changedPages} page${changedPages === 1 ? '' : 's'} with visual changes` + (diff ? ` · ${diff.filter((x) => x.t === '-').length} lines removed, ${diff.filter((x) => x.t === '+').length} added` : '') + '. Scroll any column, and the others follow.';
          A.destroy(); B.destroy();
          s.progress.hide();
        } catch (e) {
          s.progress.hide();
          s.errorEl.textContent = ui().friendlyError(e); s.errorEl.classList.remove('hidden');
        } finally { btn.disabled = false; }
      };
    },
  });

  // ---------------- Repair ----------------
  App.registerTool({
    id: 'repair-pdf', category: 'ai', icon: 'wrench',
    title: 'Repair PDF', desc: 'Recover damaged or corrupted PDFs using several recovery strategies.',
    keywords: 'fix broken corrupt damaged recover',
    accept: PDF, action: 'Repair PDF',
    async run({ file, progress }) {
      const { PDFDocument } = await lib.pdflib();
      let bytes = await util.readBytes(file);
      const log = [];
      const verify = async (b) => {
        try { const d = await util.openPdfJs(b); const ok = d.numPages > 0 && !!(await d.getPage(1)); const n = d.numPages; d.destroy(); return ok ? n : 0; } catch { return 0; }
      };
      // strategy 0: trim junk before the header / after the last %%EOF
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
      const start = head.indexOf('%PDF-');
      if (start < 0) throw new UserError("This file doesn't contain a PDF header. It may not be a PDF at all.");
      if (start > 0) { bytes = bytes.subarray(start); log.push(`Removed ${start} bytes of junk before the PDF header.`); }
      const strategies = [
        ['Rebuilt cross-reference table', async () => (await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false })).save()],
        ['Recovered pages into a fresh document', async () => {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
          const out = await PDFDocument.create();
          for (const i of src.getPageIndices()) { try { const [p] = await out.copyPages(src, [i]); out.addPage(p); } catch { log.push(`Page ${i + 1} was unrecoverable and skipped.`); } }
          if (!out.getPageCount()) throw new Error('no pages');
          return out.save();
        }],
        ['Re-rendered pages with the PDF.js recovery parser', async () => (await util.rasterizePdf(bytes, { dpi: 150, quality: 0.85, progress: (p, m) => progress(0.5 + p * 0.45, m) })).save()],
      ];
      for (let k = 0; k < strategies.length; k++) {
        const [name, fn] = strategies[k];
        progress(k / strategies.length, `Trying strategy ${k + 1} of ${strategies.length}: ${name.toLowerCase()}…`);
        try {
          const out = await fn();
          const pages = await verify(out);
          if (pages) {
            log.push(`${name}. ${pages} page${pages > 1 ? 's' : ''} recovered.`);
            return { outputs: [{ name: util.baseName(file.name) + '-repaired.pdf', blob: util.pdfBlob(out) }], message: log.join(' ') };
          }
        } catch (e) { console.warn('repair strategy failed', name, e); }
      }
      throw new UserError('Sorry, this file is too badly damaged to recover.');
    },
  });

  // ---------------- Scan to PDF ----------------
  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, th = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) ** 2;
      if (v > best) { best = v; th = i; }
    }
    return th;
  }
  /** Enhance a captured photo: optional auto-crop to the bright paper area, then a filter. */
  function enhance(src, { mode, crop }) {
    let c = src;
    if (crop) {
      const s = Math.min(1, 400 / Math.max(src.width, src.height));
      const sm = document.createElement('canvas'); sm.width = Math.round(src.width * s); sm.height = Math.round(src.height * s);
      const sx = sm.getContext('2d'); sx.drawImage(src, 0, 0, sm.width, sm.height);
      const d = sx.getImageData(0, 0, sm.width, sm.height).data;
      const hist = new Array(256).fill(0); const lum = new Uint8Array(sm.width * sm.height);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) { lum[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; hist[lum[j]]++; }
      const th = otsu(hist, lum.length);
      const rowOk = (y) => { let n = 0; for (let x = 0; x < sm.width; x++) if (lum[y * sm.width + x] > th) n++; return n > sm.width * 0.4; };
      const colOk = (x) => { let n = 0; for (let y = 0; y < sm.height; y++) if (lum[y * sm.width + x] > th) n++; return n > sm.height * 0.4; };
      let top = 0, bot = sm.height - 1, left = 0, right = sm.width - 1;
      while (top < bot && !rowOk(top)) top++;
      while (bot > top && !rowOk(bot)) bot--;
      while (left < right && !colOk(left)) left++;
      while (right > left && !colOk(right)) right--;
      const w = right - left, hh = bot - top;
      if (w > sm.width * 0.3 && hh > sm.height * 0.3 && (w < sm.width * 0.97 || hh < sm.height * 0.97)) {
        const out = document.createElement('canvas'); out.width = Math.round(w / s); out.height = Math.round(hh / s);
        out.getContext('2d').drawImage(src, left / s, top / s, w / s, hh / s, 0, 0, out.width, out.height);
        c = out;
      }
    }
    if (mode === 'color') return c;
    const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
    const ctx = out.getContext('2d'); ctx.drawImage(c, 0, 0);
    const img = ctx.getImageData(0, 0, out.width, out.height); const d = img.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 16) { const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; if (l < lo) lo = l; if (l > hi) hi = l; }
    const range = Math.max(30, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      let l = ((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) - lo) / range * 255;
      if (mode === 'bw') l = l > 150 ? 255 : 0; else l = Math.min(255, l * 1.15);
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }
  App.registerTool({
    id: 'scan-to-pdf', category: 'scan', icon: 'camera',
    title: 'Scan to PDF', desc: 'Use your camera or webcam to capture documents, auto-crop and clean them up, then save as PDF.',
    keywords: 'camera webcam phone photo capture document scanner',
    privacy: 'The camera feed is processed on this device and never leaves it.',
    mount(root, { tool }) {
      const { h, runTask, toast } = ui();
      const s = App.toolkit.scaffold(root);
      const shots = []; // canvases (original)
      const stage = h(`<div class="panel">
          <div class="scan-stage"><video playsinline muted></video><div class="placeholder">Start the camera to scan, or add photos from your device.</div></div>
          <div class="toolbar" style="justify-content:center">
            <button class="btn" data-a="cam">${icon('camera')} Start camera</button>
            <button class="btn primary hidden" data-a="snap">Capture page</button>
            <button class="btn" data-a="upload">${icon('upload')} Add photos</button>
            <input type="file" accept="image/*" capture="environment" multiple hidden>
          </div></div>`);
      const video = stage.querySelector('video');
      const fileIn = stage.querySelector('input');
      const opts = ui().renderOptions([
        { id: 'mode', label: 'Enhancement', type: 'seg', default: 'doc', choices: [['doc', 'Document (gray)'], ['bw', 'Black & white'], ['color', 'Original color']] },
        { id: 'crop', label: 'Cropping', type: 'checkbox', text: 'Auto-crop to the page edges', default: true },
        { id: 'size', label: 'Page size', type: 'select', default: 'a4', choices: [['a4', 'A4'], ['letter', 'US Letter'], ['fit', 'Fit to image']] },
      ], () => renderShots());
      const optPanel = h('<div class="panel"></div>'); optPanel.appendChild(opts.el);
      const grid = h('<div class="page-grid"></div>');
      const actions = h('<div class="actions hidden"><button class="btn primary big">Create PDF</button></div>');
      root.append(stage, grid, optPanel, actions);
      s.mountTail();
      let stream;
      const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
      window.addEventListener('hashchange', stop, { once: true });
      function renderShots() {
        grid.innerHTML = '';
        const o = opts.get();
        shots.forEach((c, i) => {
          const card = h(`<div class="page-card"><div class="pthumb"></div><div class="pbar"><span>${i + 1}</span><span class="pbtns"><button class="icon-btn" aria-label="Remove">${icon('trash')}</button></span></div></div>`);
          const prev = enhance(c, o);
          const t = document.createElement('canvas'); const k = Math.min(1, 300 / prev.width);
          t.width = prev.width * k; t.height = prev.height * k; t.getContext('2d').drawImage(prev, 0, 0, t.width, t.height);
          card.querySelector('.pthumb').appendChild(t);
          card.querySelector('button').onclick = () => { shots.splice(i, 1); renderShots(); };
          grid.appendChild(card);
        });
        actions.classList.toggle('hidden', !shots.length);
      }
      stage.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.a === 'cam') {
          if (stream) { stop(); video.srcObject = null; b.innerHTML = `${icon('camera')} Start camera`; stage.querySelector('[data-a=snap]').classList.add('hidden'); stage.querySelector('.placeholder').classList.remove('hidden'); return; }
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
            video.srcObject = stream; await video.play();
            stage.querySelector('.placeholder').classList.add('hidden');
            stage.querySelector('[data-a=snap]').classList.remove('hidden');
            b.textContent = 'Stop camera';
          } catch (err) { toast(err && err.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'No camera available. Use "Add photos" instead.'); }
        }
        if (b.dataset.a === 'snap') {
          const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
          c.getContext('2d').drawImage(video, 0, 0);
          shots.push(c); renderShots(); toast(`Page ${shots.length} captured`);
        }
        if (b.dataset.a === 'upload') fileIn.click();
      });
      fileIn.onchange = async () => {
        for (const f of fileIn.files) {
          try { const bmp = await createImageBitmap(f); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); shots.push(c); } catch { toast(`Couldn't read ${f.name}`); }
        }
        fileIn.value = ''; renderShots();
      };
      const btn = actions.querySelector('button');
      btn.onclick = () => runTask({
        button: btn, progress: s.progress, resultEl: s.resultEl, errorEl: s.errorEl,
        onReset: () => { stop(); App.toolkit.reset(root, tool); },
        task: async (progress) => {
          const o = opts.get();
          const files = [];
          for (let i = 0; i < shots.length; i++) {
            progress(i / shots.length * 0.7, `Processing page ${i + 1}`);
            const c = enhance(shots[i], o);
            const blob = await util.canvasToBlob(c, 'image/jpeg', o.mode === 'color' ? 0.85 : 0.8);
            files.push(new File([blob], `scan-${i + 1}.jpg`, { type: 'image/jpeg' }));
          }
          const doc = await util.imagesToPdf(files, { size: o.size, orient: 'auto', margin: 0 }, (p, m) => progress(0.7 + p * 0.3, m));
          const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
          return { outputs: [{ name: `scan-${stamp}.pdf`, blob: util.pdfBlob(await doc.save()) }], message: `${shots.length} page${shots.length > 1 ? 's' : ''} scanned.` };
        },
      });
    },
  });
})(window.App);
