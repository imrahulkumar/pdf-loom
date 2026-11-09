/* Edit & Organize: edit, organize, rotate, crop/resize, watermark, page numbers, header/footer, extract text, OCR */
(function (App) {
  'use strict';
  const { util, lib, UserError, icon } = App;
  const PDF = '.pdf,application/pdf';
  const ui = () => App.ui;

  /** Standard workspace scaffold for custom tools. */
  function scaffold(root) {
    const { h, createProgress } = ui();
    const errorEl = h('<div class="error-box hidden" role="alert"></div>');
    const progress = createProgress();
    const resultEl = h('<div class="hidden"></div>');
    return { errorEl, progress, resultEl, mountTail() { root.append(errorEl, progress.el, resultEl); } };
  }
  function reset(root, tool) { root.innerHTML = ''; tool.mount(root, { tool }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  App.toolkit = { scaffold, reset };

  async function fontFor(doc, name, bold) {
    const { StandardFonts } = await lib.pdflib();
    const key = { Helvetica: bold ? 'HelveticaBold' : 'Helvetica', TimesRoman: bold ? 'TimesRomanBold' : 'TimesRoman', Courier: bold ? 'CourierBold' : 'Courier' }[name] || 'Helvetica';
    doc.__fonts = doc.__fonts || {};
    if (!doc.__fonts[key]) doc.__fonts[key] = await doc.embedFont(StandardFonts[key]);
    return doc.__fonts[key];
  }
  App.util.fontFor = fontFor;

  // ---------------- Edit PDF (add text, white-out) ----------------
  App.registerTool({
    id: 'edit-pdf', category: 'edit', icon: 'edit',
    title: 'Edit PDF', desc: 'Add text anywhere and white-out existing content to replace it.',
    keywords: 'add text type write fill whiteout annotate',
    mount(root, { tool }) {
      const { h, createDropzone, runTask } = ui();
      const s = scaffold(root);
      const dz = createDropzone({ accept: PDF, onFiles: ([file]) => { dz.el.remove(); start(file); } });
      root.appendChild(dz.el);
      async function start(file) {
        const bar = h(`<div class="panel"><div class="toolbar">
            <div class="seg" role="radiogroup" aria-label="Tool">
              <label><input type="radio" name="emode" value="text" checked><span>${icon('text', 14)} Add text</span></label>
              <label><input type="radio" name="emode" value="rect"><span>White-out</span></label>
            </div>
            <span class="spacer"></span>
            <select class="input" style="width:auto" aria-label="Font"><option value="Helvetica">Helvetica</option><option value="TimesRoman">Times</option><option value="Courier">Courier</option></select>
            <input class="input" type="number" min="4" max="144" value="14" style="width:74px" aria-label="Font size">
            <input class="input" type="color" value="#000000" style="width:46px" aria-label="Text color">
            <label class="check"><input type="checkbox"> Bold</label>
          </div><p class="small muted">Click on a page to add text. Drag the dashed border to move it. In White-out mode, drag to cover existing content.</p></div>`);
        root.appendChild(bar);
        const [fontSel, sizeIn, colorIn, boldIn] = bar.querySelectorAll('select, input[type=number], input[type=color], input[type=checkbox]');
        const style = () => ({ font: fontSel.value, size: Math.max(4, +sizeIn.value || 14), color: colorIn.value, bold: boldIn.checked });
        const holder = h('<div></div>');
        root.appendChild(holder);
        s.progress.set(null, 'Loading pages…');
        root.appendChild(s.progress.el);
        let ed;
        try {
          ed = await App.PageEditor.create(holder, file, { mode: 'text', rectClass: 'rbox white', getTextStyle: style });
        } catch (e) { s.progress.hide(); root.appendChild(s.errorEl); s.errorEl.textContent = ui().friendlyError(e); s.errorEl.classList.remove('hidden'); return; }
        s.progress.hide();
        bar.addEventListener('change', (e) => {
          if (e.target.name === 'emode') ed.setMode(e.target.value);
          else ed.restyleSelected(style());
        });
        bar.addEventListener('input', (e) => { if (e.target.name !== 'emode') ed.restyleSelected(style()); });
        const actions = h(`<div class="actions"><button class="btn primary big">Apply changes</button></div>`);
        root.appendChild(actions);
        s.mountTail();
        const btn = actions.querySelector('button');
        btn.onclick = () => runTask({
          button: btn, progress: s.progress, resultEl: s.resultEl, errorEl: s.errorEl,
          onReset: () => reset(root, tool),
          task: async (progress) => {
            const items = ed.getItems();
            if (!items.length) throw new UserError('Add some text or white-out boxes first.');
            const { rgb, degrees } = await lib.pdflib();
            const doc = await util.loadPdf(file);
            const pages = doc.getPages();
            items.sort((a, b) => (a.type === 'rect' ? 0 : 1) - (b.type === 'rect' ? 0 : 1));
            for (const it of items) {
              const page = pages[it.pageIndex];
              if (it.type === 'rect') page.drawRectangle({ x: it.x, y: it.y, width: it.width, height: it.height, color: rgb(1, 1, 1) });
              else {
                const font = await fontFor(doc, it.font, it.bold);
                const [r, g, b] = util.hexToRgb01(it.color);
                page.drawText(util.safeText(font, it.text), { x: it.x, y: it.y, size: it.size, font, color: rgb(r, g, b), lineHeight: it.size * 1.15, rotate: degrees(it.rotation) });
              }
            }
            progress(0.9, 'Saving…');
            return { outputs: [{ name: util.baseName(file.name) + '-edited.pdf', blob: util.pdfBlob(await doc.save()) }] };
          },
        });
      }
    },
  });
  // white-out box style
  const st = document.createElement('style');
  st.textContent = '.rbox.white{background:#fff;outline:2px dashed var(--accent)}';
  document.head.appendChild(st);

  // ---------------- Organize pages ----------------
  App.registerTool({
    id: 'organize-pages', category: 'edit', icon: 'grid',
    title: 'Organize Pages', desc: 'Reorder, rotate, delete and insert pages, or combine pages from several PDFs.',
    keywords: 'reorder sort arrange delete remove pages move insert blank',
    mount(root, { tool }) {
      const { h, createDropzone, runTask, toast } = ui();
      const s = scaffold(root);
      const sources = []; // { file, pdf }
      const grid = h('<div class="page-grid"></div>');
      const bar = h(`<div class="toolbar hidden">
          <button class="btn sm" data-a="rl">${icon('rotCcw')} Rotate all</button>
          <button class="btn sm" data-a="rr">${icon('rotCw')} Rotate all</button>
          <button class="btn sm" data-a="rev">Reverse order</button>
          <button class="btn sm" data-a="blank">${icon('plus')} Blank page</button>
          <span class="spacer"></span><span class="small muted count"></span>
        </div>`);
      const dz = createDropzone({ accept: PDF, multiple: true, onFiles: addFiles });
      const actions = h('<div class="actions hidden"><button class="btn primary big">Save PDF</button></div>');
      root.append(dz.el, bar, grid, actions);
      s.mountTail();
      let sortable;

      function updateCount() {
        const cards = [...grid.children];
        const live = cards.filter((c) => !c._st.deleted).length;
        bar.querySelector('.count').textContent = `${live} page${live === 1 ? '' : 's'}${cards.length - live ? ` · ${cards.length - live} deleted` : ''}`;
        grid.querySelectorAll('.page-card').forEach((c, i) => { c.querySelector('.pn').textContent = i + 1; });
      }
      function card(stt) {
        const c = h(`<div class="page-card"><div class="pthumb"></div><div class="pbar"><span class="pn"></span><span class="pbtns">
            <button class="icon-btn" data-a="l" title="Rotate left" aria-label="Rotate left">${icon('rotCcw')}</button>
            <button class="icon-btn" data-a="r" title="Rotate right" aria-label="Rotate right">${icon('rotCw')}</button>
            <button class="icon-btn" data-a="d" title="Duplicate" aria-label="Duplicate">${icon('copy')}</button>
            <button class="icon-btn" data-a="x" title="Delete / restore" aria-label="Delete page">${icon('trash')}</button>
          </span></div></div>`);
        c._st = stt;
        c.querySelector('.pbtns').addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          const a = b.dataset.a;
          if (a === 'l' || a === 'r') { stt.rot = (stt.rot + (a === 'l' ? 270 : 90)) % 360; paintRot(c); }
          if (a === 'x') { stt.deleted = !stt.deleted; c.classList.toggle('deleted', stt.deleted); }
          if (a === 'd') { const copy = card({ ...stt, deleted: false }); c.after(copy); }
          updateCount();
        });
        const thumb = c.querySelector('.pthumb');
        if (stt.blank) thumb.innerHTML = '<canvas width="105" height="148"></canvas>';
        else {
          const src = sources[stt.src];
          util.renderPage(src.pdf, stt.page + 1, { maxWidth: 220, scale: 0.4 }).then((cv) => { thumb.appendChild(cv); paintRot(c); });
        }
        paintRot(c);
        return c;
      }
      function paintRot(c) { const cv = c.querySelector('canvas'); if (cv) cv.style.transform = `rotate(${c._st.rot}deg) scale(${c._st.rot % 180 ? 0.72 : 1})`; }

      async function addFiles(files) {
        s.errorEl.classList.add('hidden');
        for (const file of files) {
          try {
            const pdf = await util.openPdfJs(file);
            const idx = sources.push({ file, pdf }) - 1;
            for (let i = 0; i < pdf.numPages; i++) grid.appendChild(card({ src: idx, page: i, rot: 0, deleted: false }));
          } catch (e) { toast(ui().friendlyError(e)); }
        }
        if (sources.length) {
          dz.setCompact(true, 'Add pages from another PDF');
          bar.classList.remove('hidden');
          actions.classList.remove('hidden');
          updateCount();
          if (!sortable) { const Sortable = await lib.sortable(); sortable = Sortable.create(grid, { animation: 150, ghostClass: 'sortable-ghost', filter: '.icon-btn', preventOnFilter: false, onEnd: updateCount }); }
        }
      }
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const a = b.dataset.a;
        const cards = [...grid.children];
        if (a === 'rl' || a === 'rr') cards.forEach((c) => { c._st.rot = (c._st.rot + (a === 'rl' ? 270 : 90)) % 360; paintRot(c); });
        if (a === 'rev') cards.reverse().forEach((c) => grid.appendChild(c));
        if (a === 'blank') grid.appendChild(card({ blank: true, rot: 0, deleted: false }));
        updateCount();
      });
      const btn = actions.querySelector('button');
      btn.onclick = () => runTask({
        button: btn, progress: s.progress, resultEl: s.resultEl, errorEl: s.errorEl,
        onReset: () => { sources.forEach((x) => x.pdf.destroy()); reset(root, tool); },
        task: async (progress) => {
          const { PDFDocument, degrees } = await lib.pdflib();
          const cards = [...grid.children].map((c) => c._st).filter((x) => !x.deleted);
          if (!cards.length) throw new UserError('All pages are deleted. Keep at least one page.');
          const out = await PDFDocument.create();
          const docs = {};
          let lastSize = [595.28, 841.89];
          for (let i = 0; i < cards.length; i++) {
            progress(i / cards.length, `Assembling page ${i + 1} of ${cards.length}`);
            const c = cards[i];
            let page;
            if (c.blank) page = out.addPage(lastSize);
            else {
              if (!docs[c.src]) docs[c.src] = await util.loadPdf(sources[c.src].file);
              [page] = await out.copyPages(docs[c.src], [c.page]);
              out.addPage(page);
              const sz = page.getSize(); lastSize = [sz.width, sz.height];
            }
            page.setRotation(degrees((page.getRotation().angle + c.rot) % 360));
          }
          const name = util.baseName(sources[0].file.name) + '-organized.pdf';
          return { outputs: [{ name, blob: util.pdfBlob(await out.save()) }], message: `${cards.length} pages saved.` };
        },
      });
    },
  });

  // ---------------- Rotate ----------------
  App.registerTool({
    id: 'rotate-pdf', category: 'edit', icon: 'rotate',
    title: 'Rotate PDF', desc: 'Rotate all or selected pages by 90°, 180° or 270°.',
    keywords: 'turn orientation landscape portrait',
    accept: PDF, multiple: true, action: 'Rotate',
    options: [
      { id: 'angle', label: 'Rotation', type: 'seg', default: '90', choices: [['90', '90° clockwise'], ['180', '180°'], ['270', '90° counter-clockwise']] },
      { id: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'All pages', hint: 'Leave empty for all pages, or e.g. 1, 3-5' },
    ],
    async run({ files, opts, progress }) {
      const { degrees } = await lib.pdflib();
      const outputs = [];
      for (let f = 0; f < files.length; f++) {
        progress(f / files.length, `Rotating ${files[f].name}`);
        const doc = await util.loadPdf(files[f]);
        const set = util.parsePageSet(opts.pages, doc.getPageCount());
        doc.getPages().forEach((p, i) => { if (!set || set.has(i)) p.setRotation(degrees((p.getRotation().angle + +opts.angle) % 360)); });
        outputs.push({ name: util.baseName(files[f].name) + '-rotated.pdf', blob: util.pdfBlob(await doc.save()) });
      }
      return { outputs, zipName: 'rotated.zip' };
    },
  });

  // ---------------- Crop & Resize ----------------
  App.registerTool({
    id: 'crop-resize-pdf', category: 'edit', icon: 'crop',
    title: 'Crop & Resize', desc: 'Trim page margins, or fit pages onto A4, Letter or a custom size.',
    keywords: 'margins trim page size a4 letter scale',
    accept: PDF, action: 'Apply',
    options: [
      { id: 'mode', label: 'Mode', type: 'seg', default: 'crop', full: true, choices: [['crop', 'Crop margins'], ['resize', 'Resize pages']] },
      { id: 'top', label: 'Top (mm)', type: 'number', default: 10, min: 0, showIf: (v) => v.mode === 'crop' },
      { id: 'right', label: 'Right (mm)', type: 'number', default: 10, min: 0, showIf: (v) => v.mode === 'crop' },
      { id: 'bottom', label: 'Bottom (mm)', type: 'number', default: 10, min: 0, showIf: (v) => v.mode === 'crop' },
      { id: 'left', label: 'Left (mm)', type: 'number', default: 10, min: 0, showIf: (v) => v.mode === 'crop' },
      { id: 'size', label: 'Target size', type: 'select', default: 'a4', choices: [['a4', 'A4'], ['letter', 'US Letter'], ['legal', 'US Legal'], ['a3', 'A3'], ['a5', 'A5'], ['custom', 'Custom…']], showIf: (v) => v.mode === 'resize' },
      { id: 'cw', label: 'Width (mm)', type: 'number', default: 210, min: 10, showIf: (v) => v.mode === 'resize' && v.size === 'custom' },
      { id: 'ch', label: 'Height (mm)', type: 'number', default: 297, min: 10, showIf: (v) => v.mode === 'resize' && v.size === 'custom' },
      { id: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'All pages' },
    ],
    async run({ file, opts, progress }) {
      const MM = 72 / 25.4;
      const src = await util.loadPdf(file);
      const set = util.parsePageSet(opts.pages, src.getPageCount());
      const base = util.baseName(file.name);
      if (opts.mode === 'crop') {
        src.getPages().forEach((p, i) => {
          if (set && !set.has(i)) return;
          const v = util.vpage(p);
          const l = opts.left * MM, r = opts.right * MM, t = opts.top * MM, b = opts.bottom * MM;
          if (l + r >= v.w - 10 || t + b >= v.h - 10) throw new UserError(`Margins are larger than page ${i + 1}.`);
          const a = v.toUser(l, b); const c = v.toUser(v.w - r, v.h - t);
          const x = Math.min(a.x, c.x), y = Math.min(a.y, c.y), w = Math.abs(c.x - a.x), hh = Math.abs(c.y - a.y);
          p.setCropBox(x, y, w, hh);
          p.setMediaBox(x, y, w, hh);
        });
        return { outputs: [{ name: base + '-cropped.pdf', blob: util.pdfBlob(await src.save()) }] };
      }
      const { PDFDocument } = await lib.pdflib();
      let [tw, th] = opts.size === 'custom' ? [opts.cw * MM, opts.ch * MM] : App.PAGE_SIZES[opts.size];
      const out = await PDFDocument.create();
      const pages = src.getPages();
      for (let i = 0; i < pages.length; i++) {
        progress(i / pages.length, `Resizing page ${i + 1}`);
        const p = pages[i];
        if (set && !set.has(i)) { const [cp] = await out.copyPages(src, [i]); out.addPage(cp); continue; }
        const v = util.vpage(p);
        const cb = v.box;
        const emb = await out.embedPage(p, { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
        // match target orientation to the visual orientation of the source page
        let W = tw, H = th;
        if ((v.w > v.h) !== (W > H)) [W, H] = [H, W];
        // page user space is unrotated; swap again for sideways pages
        const sideways = v.rot === 90 || v.rot === 270;
        const [uw, uh] = sideways ? [H, W] : [W, H];
        const np = out.addPage([uw, uh]);
        const s = Math.min(uw / cb.width, uh / cb.height);
        np.drawPage(emb, { x: (uw - cb.width * s) / 2, y: (uh - cb.height * s) / 2, width: cb.width * s, height: cb.height * s });
        np.setRotation(p.getRotation());
      }
      return { outputs: [{ name: base + '-resized.pdf', blob: util.pdfBlob(await out.save()) }] };
    },
  });

  // ---------------- Watermark ----------------
  App.registerTool({
    id: 'add-watermark', category: 'edit', icon: 'droplet',
    title: 'Add Watermark', desc: 'Stamp text or an image over your pages with custom opacity, angle and position.',
    keywords: 'stamp confidential draft logo overlay',
    accept: PDF, action: 'Add watermark',
    options: [
      { id: 'kind', label: 'Watermark type', type: 'seg', default: 'text', full: true, choices: [['text', 'Text'], ['image', 'Image']] },
      { id: 'text', label: 'Text', type: 'text', default: 'CONFIDENTIAL', showIf: (v) => v.kind === 'text' },
      { id: 'image', label: 'Image (PNG or JPG)', type: 'file', accept: 'image/png,image/jpeg', showIf: (v) => v.kind === 'image' },
      { id: 'font', label: 'Font', type: 'select', default: 'Helvetica', choices: [['Helvetica', 'Helvetica'], ['TimesRoman', 'Times'], ['Courier', 'Courier']], showIf: (v) => v.kind === 'text' },
      { id: 'size', label: 'Font size', type: 'number', default: 60, min: 6, max: 400, showIf: (v) => v.kind === 'text' },
      { id: 'scale', label: 'Image width', type: 'range', min: 5, max: 100, default: 40, unit: '%', showIf: (v) => v.kind === 'image' },
      { id: 'color', label: 'Color', type: 'color', default: '#e0433a', showIf: (v) => v.kind === 'text' },
      { id: 'opacity', label: 'Opacity', type: 'range', min: 5, max: 100, default: 25, unit: '%' },
      { id: 'angle', label: 'Rotation', type: 'range', min: -90, max: 90, default: 45, unit: '°' },
      { id: 'pos', label: 'Position', type: 'seg', default: 'center', choices: [['center', 'Center'], ['tile', 'Tiled'], ['top', 'Top'], ['bottom', 'Bottom']] },
      { id: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'All pages' },
    ],
    async run({ file, opts, progress }) {
      const { rgb, degrees } = await lib.pdflib();
      const doc = await util.loadPdf(file);
      const set = util.parsePageSet(opts.pages, doc.getPageCount());
      let font, img, text;
      if (opts.kind === 'image') {
        if (!opts.image) throw new UserError('Choose an image for the watermark.');
        img = await App.util.embedImage(doc, opts.image);
      } else {
        font = await fontFor(doc, opts.font, true);
        text = util.safeText(font, opts.text || '');
        if (!text.trim()) throw new UserError('Enter the watermark text.');
      }
      const [r, g, b] = opts.kind === 'text' ? util.hexToRgb01(opts.color) : [0, 0, 0];
      const A = (opts.angle * Math.PI) / 180;
      const pages = doc.getPages();
      pages.forEach((p, i) => {
        if (set && !set.has(i)) return;
        if (i % 10 === 0) progress(i / pages.length, `Stamping page ${i + 1}`);
        const v = util.vpage(p);
        let ew, eh;
        if (img) { ew = v.w * opts.scale / 100; eh = ew * img.height / img.width; }
        else { ew = font.widthOfTextAtSize(text, opts.size); eh = opts.size * 0.7; }
        const draw = (cx, cy) => {
          // origin so that the rotated element is centred on (cx, cy)
          const ox = cx - (ew / 2 * Math.cos(A) - eh / 2 * Math.sin(A));
          const oy = cy - (ew / 2 * Math.sin(A) + eh / 2 * Math.cos(A));
          const u = v.toUser(ox, oy);
          const rot = degrees(opts.angle + v.rot);
          if (img) p.drawImage(img, { x: u.x, y: u.y, width: ew, height: eh, opacity: opts.opacity / 100, rotate: rot });
          else p.drawText(text, { x: u.x, y: u.y, size: opts.size, font, color: rgb(r, g, b), opacity: opts.opacity / 100, rotate: rot });
        };
        if (opts.pos === 'tile') {
          const sx = Math.max(ew, eh) * 1.5 + 40; const sy = Math.max(eh * 4, 120);
          for (let y = -sy; y < v.h + sy; y += sy) for (let x = -sx / 2 + ((y / sy) % 2 ? sx / 2 : 0); x < v.w + sx; x += sx) draw(x, y);
        } else if (opts.pos === 'top') draw(v.w / 2, v.h - eh - 40);
        else if (opts.pos === 'bottom') draw(v.w / 2, eh + 40);
        else draw(v.w / 2, v.h / 2);
      });
      return { outputs: [{ name: util.baseName(file.name) + '-watermarked.pdf', blob: util.pdfBlob(await doc.save()) }] };
    },
  });

  // ---------------- Page numbers ----------------
  App.registerTool({
    id: 'page-numbers', category: 'edit', icon: 'hash',
    title: 'Add Page Numbers', desc: 'Number your pages with your choice of position, format and style.',
    keywords: 'pagination numbering footer',
    accept: PDF, action: 'Add page numbers',
    options: [
      { id: 'pos', label: 'Position', type: 'select', default: 'bc', choices: [['bc', 'Bottom center'], ['br', 'Bottom right'], ['bl', 'Bottom left'], ['tc', 'Top center'], ['tr', 'Top right'], ['tl', 'Top left']] },
      { id: 'format', label: 'Format', type: 'select', default: '{n}', choices: [['{n}', '1'], ['Page {n}', 'Page 1'], ['Page {n} of {total}', 'Page 1 of 10'], ['{n} / {total}', '1 / 10'], ['- {n} -', '- 1 -']] },
      { id: 'start', label: 'Start at number', type: 'number', default: 1, min: 0 },
      { id: 'size', label: 'Font size', type: 'number', default: 11, min: 5, max: 72 },
      { id: 'margin', label: 'Margin (pt)', type: 'number', default: 28, min: 0 },
      { id: 'color', label: 'Color', type: 'color', default: '#333333' },
      { id: 'skip', label: 'Skip', type: 'checkbox', text: "Don't number the first page (cover)" },
    ],
    async run({ file, opts }) {
      const { rgb } = await lib.pdflib();
      const doc = await util.loadPdf(file);
      const font = await fontFor(doc, 'Helvetica');
      const [r, g, b] = util.hexToRgb01(opts.color);
      const pages = doc.getPages();
      const numbered = opts.skip ? pages.length - 1 : pages.length;
      pages.forEach((p, i) => {
        if (opts.skip && i === 0) return;
        const n = (opts.start || 0) + i - (opts.skip ? 1 : 0);
        const label = opts.format.replace('{n}', n).replace('{total}', numbered + (opts.start || 1) - 1);
        const v = util.vpage(p);
        const m = opts.margin;
        const vy = opts.pos[0] === 't' ? v.h - m - opts.size * 0.7 : m;
        const anchor = { l: 'left', c: 'center', r: 'right' }[opts.pos[1]];
        const vx = anchor === 'left' ? m : anchor === 'right' ? v.w - m : v.w / 2;
        util.drawVisualText(p, label, { vx, vy, size: opts.size, font, color: rgb(r, g, b), anchor });
      });
      return { outputs: [{ name: util.baseName(file.name) + '-numbered.pdf', blob: util.pdfBlob(await doc.save()) }] };
    },
  });

  // ---------------- Headers & footers ----------------
  App.registerTool({
    id: 'headers-footers', category: 'edit', icon: 'layout',
    title: 'Headers & Footers', desc: 'Add header and footer text with page, date and file name variables.',
    keywords: 'header footer running title date',
    accept: PDF, action: 'Add header & footer',
    options: [
      { id: 'header', label: 'Header text', type: 'text', default: '{file}', full: true, hint: 'Variables: {page} {total} {date} {file}' },
      { id: 'halign', label: 'Header alignment', type: 'seg', default: 'left', choices: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
      { id: 'footer', label: 'Footer text', type: 'text', default: 'Page {page} of {total}', full: true },
      { id: 'falign', label: 'Footer alignment', type: 'seg', default: 'right', choices: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
      { id: 'size', label: 'Font size', type: 'number', default: 9, min: 5, max: 48 },
      { id: 'margin', label: 'Margin (pt)', type: 'number', default: 24, min: 0 },
      { id: 'color', label: 'Color', type: 'color', default: '#555555' },
      { id: 'line', label: 'Divider', type: 'checkbox', text: 'Draw a thin divider line' },
    ],
    async run({ file, opts }) {
      const { rgb } = await lib.pdflib();
      const doc = await util.loadPdf(file);
      const font = await fontFor(doc, 'Helvetica');
      const [r, g, b] = util.hexToRgb01(opts.color);
      const color = rgb(r, g, b);
      const pages = doc.getPages();
      const date = new Date().toLocaleDateString();
      const fill = (t, i) => t.replace(/\{page\}/g, i + 1).replace(/\{total\}/g, pages.length).replace(/\{date\}/g, date).replace(/\{file\}/g, util.baseName(file.name));
      pages.forEach((p, i) => {
        const v = util.vpage(p);
        const m = opts.margin;
        const put = (text, align, vy) => {
          if (!text.trim()) return;
          const vx = align === 'left' ? m : align === 'right' ? v.w - m : v.w / 2;
          util.drawVisualText(p, fill(text, i), { vx, vy, size: opts.size, font, color, anchor: align });
        };
        put(opts.header, opts.halign, v.h - m - opts.size * 0.7);
        put(opts.footer, opts.falign, m);
        if (opts.line && v.rot === 0) {
          const bx = v.box.x, by = v.box.y;
          if (opts.header.trim()) p.drawLine({ start: { x: bx + m, y: by + v.h - m - opts.size * 0.7 - 5 }, end: { x: bx + v.w - m, y: by + v.h - m - opts.size * 0.7 - 5 }, thickness: 0.5, color });
          if (opts.footer.trim()) p.drawLine({ start: { x: bx + m, y: by + m + opts.size + 3 }, end: { x: bx + v.w - m, y: by + m + opts.size + 3 }, thickness: 0.5, color });
        }
      });
      return { outputs: [{ name: util.baseName(file.name) + '-header-footer.pdf', blob: util.pdfBlob(await doc.save()) }] };
    },
  });

  // ---------------- Extract text ----------------
  App.registerTool({
    id: 'extract-text', category: 'edit', icon: 'text',
    title: 'Extract Text', desc: 'Pull all selectable text out of a PDF as plain text.',
    keywords: 'txt copy text content',
    accept: PDF, action: 'Extract text',
    options: [{ id: 'sep', label: 'Page markers', type: 'checkbox', text: 'Insert "--- Page N ---" markers', default: true }],
    async run({ file, opts, progress }) {
      const pages = await util.extractText(file, progress);
      const text = pages.map((t, i) => (opts.sep ? `--- Page ${i + 1} ---\n` : '') + t).join('\n\n');
      if (!pages.join('').trim()) throw new UserError('No selectable text found. This PDF is probably scanned. Use "OCR PDF" instead.');
      return { outputs: [{ text, name: util.baseName(file.name) + '.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) }], message: `${pages.length} pages · ${text.split(/\s+/).filter(Boolean).length.toLocaleString()} words` };
    },
  });

  // ---------------- OCR ----------------
  App.registerTool({
    id: 'ocr-pdf', category: 'edit', icon: 'scan',
    title: 'OCR PDF', desc: 'Recognize text in scanned PDFs and make them searchable and selectable.',
    keywords: 'scanned searchable recognize tesseract text recognition',
    accept: PDF, action: 'Run OCR', badge: 'WASM',
    note: 'The OCR engine and language data (~15 MB) download on first use, then they\'re cached. Recognition runs on your device and may take a while for long documents.',
    options: [
      { id: 'lang', label: 'Document language', type: 'select', default: 'eng', choices: [['eng', 'English'], ['hin', 'Hindi'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['por', 'Portuguese'], ['ita', 'Italian'], ['nld', 'Dutch'], ['rus', 'Russian'], ['ara', 'Arabic'], ['chi_sim', 'Chinese (Simplified)'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['eng+hin', 'English + Hindi']] },
      { id: 'out', label: 'Output', type: 'seg', default: 'pdf', choices: [['pdf', 'Searchable PDF'], ['txt', 'Text only']] },
      { id: 'dpi', label: 'Scan resolution', type: 'select', default: '200', choices: [['150', '150 DPI (fast)'], ['200', '200 DPI'], ['300', '300 DPI (accurate)']] },
      { id: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'All pages' },
    ],
    async run({ file, opts, progress }) {
      const T = await lib.tesseract();
      const { PDFDocument } = await lib.pdflib();
      const pdf = await util.openPdfJs(file);
      const set = util.parsePageSet(opts.pages, pdf.numPages);
      const list = Array.from({ length: pdf.numPages }, (_, i) => i).filter((i) => !set || set.has(i));
      let k = 0;
      progress(null, 'Loading OCR engine…');
      const worker = await T.createWorker(opts.lang, 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') progress((k + m.progress) / list.length, `Recognizing page ${k + 1} of ${list.length}`);
          else if (m.status) progress(null, m.status.replace(/^./, (c) => c.toUpperCase()) + '…');
        },
      });
      const texts = [];
      const wantPdf = opts.out === 'pdf';
      const doc = wantPdf ? await util.loadPdf(file) : null;
      try {
        for (; k < list.length; k++) {
          const i = list[k];
          const canvas = await util.renderPage(pdf, i + 1, { dpi: +opts.dpi });
          const page = doc && doc.getPage(i);
          const overlay = page && util.vpage(page).rot === 0;
          const { data } = await worker.recognize(canvas, overlay ? { pdfTextOnly: true } : {}, { text: true, pdf: wantPdf });
          texts.push(`--- Page ${i + 1} ---\n${(data.text || '').trim()}`);
          if (wantPdf && data.pdf) {
            const ocrDoc = await PDFDocument.load(new Uint8Array(data.pdf));
            if (overlay) {
              // lay the invisible text layer over the original page, keeping original quality
              const [emb] = await doc.embedPdf(ocrDoc, [0]);
              const cb = page.getCropBox();
              page.drawPage(emb, { x: cb.x, y: cb.y, width: cb.width, height: cb.height });
            } else {
              // rotated page: replace with OCR'd image page scaled to the same visual size
              const [np] = await doc.copyPages(ocrDoc, [0]);
              const sz = np.getSize();
              np.scale(canvas.pdfWidth / sz.width, canvas.pdfHeight / sz.height);
              doc.removePage(i);
              doc.insertPage(i, np);
            }
          }
          canvas.width = canvas.height = 0;
        }
      } finally {
        await worker.terminate();
        pdf.destroy();
      }
      const text = texts.join('\n\n');
      const base = util.baseName(file.name);
      const outputs = [];
      if (wantPdf) outputs.push({ name: base + '-ocr.pdf', blob: util.pdfBlob(await doc.save()) });
      outputs.push({ text, name: base + '-ocr.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) });
      return { outputs, zipName: base + '-ocr.zip', message: `Recognized ${list.length} page${list.length > 1 ? 's' : ''}.` };
    },
  });
})(window.App);
