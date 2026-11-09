/* PageEditor: renders PDF pages with an interactive overlay for drawing boxes and placing text. */
(function (App) {
  'use strict';
  const { util } = App;

  async function create(container, file, { mode = 'rect', rectClass = 'rbox', getTextStyle } = {}) {
    const pdf = await util.openPdfJs(file);
    const wrap = document.createElement('div');
    wrap.className = 'editor-pages';
    container.appendChild(wrap);
    const avail = Math.min(860, (container.clientWidth || 800) - 24);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pages = [];
    let currentMode = mode;
    let items = [];
    let rectStyle = rectClass;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const cssScale = avail / base.width;
      const vp = page.getViewport({ scale: cssScale }); // css-pixel viewport used for coordinate conversion
      const el = document.createElement('div');
      el.className = 'epage';
      el.style.width = vp.width + 'px';
      el.style.aspectRatio = `${vp.width} / ${vp.height}`;
      el.innerHTML = `<span class="pnum">${i}</span><canvas></canvas><div class="layer"></div>`;
      wrap.appendChild(el);
      const rec = { num: i, page, vp, cssScale, el, layer: el.querySelector('.layer'), canvas: el.querySelector('canvas'), rendered: false };
      pages.push(rec);
      attach(rec);
    }

    // Render pages lazily as they scroll into view
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const rec = pages.find((p) => p.el === en.target);
        if (rec && !rec.rendered) { rec.rendered = true; renderRec(rec); }
      }
    }, { root: wrap, rootMargin: '600px' });
    pages.forEach((p) => io.observe(p.el));

    async function renderRec(rec) {
      const vp = rec.page.getViewport({ scale: rec.cssScale * dpr });
      rec.canvas.width = Math.floor(vp.width);
      rec.canvas.height = Math.floor(vp.height);
      await rec.page.render({ canvasContext: rec.canvas.getContext('2d'), viewport: vp }).promise;
    }

    function localPoint(rec, e) {
      const r = rec.layer.getBoundingClientRect();
      const k = rec.vp.width / r.width; // handles any CSS scaling of the page
      return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    }

    function attach(rec) {
      let start = null; let box = null;
      rec.layer.addEventListener('pointerdown', (e) => {
        if (e.target !== rec.layer) return;
        if (currentMode === 'text') {
          const [x, y] = localPoint(rec, e);
          addText(rec, x, y);
          e.preventDefault();
          return;
        }
        start = localPoint(rec, e);
        box = document.createElement('div');
        box.className = rectStyle;
        place(box, start[0], start[1], 0, 0);
        rec.layer.appendChild(box);
        rec.layer.setPointerCapture(e.pointerId);
      });
      rec.layer.addEventListener('pointermove', (e) => {
        if (!start) return;
        const [x, y] = localPoint(rec, e);
        place(box, Math.min(start[0], x), Math.min(start[1], y), Math.abs(x - start[0]), Math.abs(y - start[1]));
      });
      const end = (e) => {
        if (!start) return;
        const [x, y] = localPoint(rec, e);
        const r = { x: Math.min(start[0], x), y: Math.min(start[1], y), w: Math.abs(x - start[0]), h: Math.abs(y - start[1]) };
        start = null;
        if (r.w < 4 || r.h < 4) { box.remove(); return; }
        const item = { type: 'rect', style: rectStyle, rec, ...r, el: box };
        items.push(item);
        addDelete(box, item);
      };
      rec.layer.addEventListener('pointerup', end);
      rec.layer.addEventListener('pointercancel', end);
    }

    function place(el, x, y, w, h) {
      el.style.left = x + 'px'; el.style.top = y + 'px';
      if (w !== undefined) { el.style.width = w + 'px'; el.style.height = h + 'px'; }
    }

    function addDelete(el, item) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '×';
      b.title = 'Remove';
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.onclick = (e) => { e.stopPropagation(); el.remove(); items = items.filter((i) => i !== item); };
      el.appendChild(b);
    }

    function addText(rec, x, y) {
      const st = getTextStyle ? getTextStyle() : { size: 14, color: '#000000', font: 'Helvetica' };
      const el = document.createElement('div');
      el.className = 'tbox';
      const edit = document.createElement('span');
      edit.contentEditable = 'true';
      edit.spellcheck = false;
      el.appendChild(edit);
      const item = { type: 'text', rec, x, y, el, edit, ...st };
      applyStyle(item);
      place(el, x, y);
      rec.layer.appendChild(el);
      items.push(item);
      addDelete(el, item);
      // move by dragging the dashed border area
      let drag = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.target === edit) return;
        e.stopPropagation();
        drag = { sx: e.clientX, sy: e.clientY, x: item.x, y: item.y, k: rec.vp.width / rec.layer.getBoundingClientRect().width };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        item.x = drag.x + (e.clientX - drag.sx) * drag.k;
        item.y = drag.y + (e.clientY - drag.sy) * drag.k;
        place(el, item.x, item.y);
      });
      el.addEventListener('pointerup', () => { drag = null; });
      edit.addEventListener('focus', () => { api.selected = item; });
      edit.addEventListener('keydown', (e) => { if (e.key === 'Escape') edit.blur(); });
      setTimeout(() => edit.focus(), 0);
    }

    function applyStyle(item) {
      const fam = { Helvetica: 'Helvetica, Arial, sans-serif', TimesRoman: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' }[item.font] || 'Helvetica, Arial, sans-serif';
      item.el.style.fontFamily = fam;
      item.el.style.fontSize = item.size * item.rec.cssScale + 'px';
      item.el.style.color = item.color;
      item.el.style.fontWeight = item.bold ? '700' : '400';
    }

    /** Convert displayed css-pixel rect/point to PDF user space. */
    function toPdfRect(it) {
      const [x0, y0] = it.rec.vp.convertToPdfPoint(it.x, it.y);
      const [x1, y1] = it.rec.vp.convertToPdfPoint(it.x + it.w, it.y + it.h);
      return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
    }

    const api = {
      pdf,
      pages,
      selected: null,
      setMode(m) { currentMode = m; },
      setRectStyle(s) { rectStyle = s; },
      restyleSelected(st) {
        if (!api.selected || !document.body.contains(api.selected.el)) return;
        Object.assign(api.selected, st);
        applyStyle(api.selected);
      },
      clear() { items.forEach((i) => i.el.remove()); items = []; },
      addRect(rec, x, y, w, h) {
        const box = document.createElement('div');
        box.className = rectStyle;
        place(box, x, y, w, h);
        rec.layer.appendChild(box);
        const item = { type: 'rect', style: rectStyle, rec, x, y, w, h, el: box };
        items.push(item);
        addDelete(box, item);
      },
      count() { return items.length; },
      getItems() {
        return items.map((it) => {
          const pageIndex = it.rec.num - 1;
          const rotation = it.rec.page.rotate || 0;
          if (it.type === 'rect') {
            return {
              type: 'rect', style: it.style, pageIndex, ...toPdfRect(it),
              // fractions of the displayed page, used when rasterizing
              fx: it.x / it.rec.vp.width, fy: it.y / it.rec.vp.height, fw: it.w / it.rec.vp.width, fh: it.h / it.rec.vp.height,
            };
          }
          const text = it.edit.innerText.replace(/ /g, ' ').replace(/\n$/, '');
          // baseline of first line ≈ top + 0.9em (Helvetica-like ascent with 1.15 line height)
          const [px, py] = it.rec.vp.convertToPdfPoint(it.x + 2, it.y + it.size * it.rec.cssScale * 0.9);
          return { type: 'text', pageIndex, x: px, y: py, text, size: it.size, color: it.color, font: it.font, bold: it.bold, rotation };
        }).filter((i) => i.type !== 'text' || i.text.trim());
      },
      destroy() { io.disconnect(); pdf.destroy(); wrap.remove(); },
    };
    return api;
  }

  App.PageEditor = { create };
})(window.App);
