/* UI framework: tool registry, home page, generic tool workflow, shared widgets. */
(function (App) {
  'use strict';
  const { util, icon, UserError } = App;
  const { escapeHtml, formatBytes } = util;

  App.categories = [
    { id: 'essentials', name: 'Essentials', color: 'var(--c-essentials)' },
    { id: 'edit', name: 'Edit & Organize', color: 'var(--c-edit)' },
    { id: 'security', name: 'Security & Privacy', color: 'var(--c-security)' },
    { id: 'convert', name: 'Convert & Export', color: 'var(--c-convert)' },
    { id: 'ai', name: 'Smart Tools', color: 'var(--c-ai)' },
    { id: 'scan', name: 'Scan & Capture', color: 'var(--c-scan)' },
  ];
  App.tools = [];
  App.registerTool = (t) => App.tools.push(t);
  const catColor = (id) => (App.categories.find((c) => c.id === id) || {}).color || 'var(--accent)';

  // ---------- small widgets ----------
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function acceptMatcher(accept) {
    if (!accept) return () => true;
    const tokens = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return (file) => tokens.some((t) => {
      if (t.startsWith('.')) return file.name.toLowerCase().endsWith(t);
      if (t.endsWith('/*')) return (file.type || '').startsWith(t.slice(0, -1));
      return file.type === t;
    });
  }

  function describeAccept(accept) {
    if (!accept) return 'files';
    if (accept === '.pdf,application/pdf') return 'PDF files';
    if (accept.startsWith('image/')) return 'images (JPG, PNG, WebP…)';
    return accept.split(',').filter((s) => s.startsWith('.')).map((s) => s.slice(1).toUpperCase()).join(', ') + ' files';
  }

  /** Drag & drop / click-to-browse file picker. */
  function createDropzone({ accept, multiple, onFiles, label, sub }) {
    const matches = acceptMatcher(accept);
    const el = h(`<div class="dropzone" tabindex="0" role="button">
        <div class="dz-icon">${icon('upload', 28)}</div>
        <strong>${escapeHtml(label || (multiple ? 'Select files' : 'Select a file'))}</strong>
        <p class="muted">${escapeHtml(sub || 'or drop ' + describeAccept(accept) + ' here')}</p>
        <input type="file" hidden ${multiple ? 'multiple' : ''} ${accept ? `accept="${accept}"` : ''}>
      </div>`);
    const input = el.querySelector('input');
    const take = (list) => {
      const files = [...list];
      const ok = files.filter(matches);
      if (ok.length < files.length) toast(`Skipped ${files.length - ok.length} unsupported file(s). This tool accepts ${describeAccept(accept)}.`);
      if (ok.length) onFiles(multiple ? ok : [ok[0]]);
    };
    el.addEventListener('click', () => input.click());
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { take(input.files); input.value = ''; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); take(e.dataTransfer.files); });
    return {
      el,
      setCompact(on, text) {
        el.classList.toggle('compact', on);
        el.querySelector('strong').textContent = on ? (text || (multiple ? 'Add more files' : 'Choose a different file')) : (label || (multiple ? 'Select files' : 'Select a file'));
      },
    };
  }

  function createProgress() {
    const el = h('<div class="progress hidden" aria-live="polite"><div class="bar"><i></i></div><span class="msg"></span></div>');
    const bar = el.querySelector('.bar');
    const fill = el.querySelector('i');
    const msg = el.querySelector('.msg');
    return {
      el,
      set(frac, text) {
        el.classList.remove('hidden');
        if (frac === null || frac === undefined) { bar.classList.add('indeterminate'); fill.style.width = ''; }
        else { bar.classList.remove('indeterminate'); fill.style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%'; }
        if (text) msg.textContent = text;
      },
      hide() { el.classList.add('hidden'); },
    };
  }

  // Render thumbnails one at a time so many large PDFs don't freeze the page
  let thumbQueue = Promise.resolve();
  function fileThumb(file, onPages) {
    const box = h(`<div class="file-thumb">${escapeHtml(util.ext(file.name).toUpperCase().slice(0, 4))}</div>`);
    if ((file.type || '').startsWith('image/')) {
      const img = new Image();
      img.alt = '';
      img.src = URL.createObjectURL(file);
      img.onload = () => { box.textContent = ''; box.appendChild(img); };
    } else if (util.ext(file.name) === 'pdf') {
      thumbQueue = thumbQueue.then(async () => {
        try {
          const pdf = await util.openPdfJs(file);
          onPages && onPages(pdf.numPages);
          const c = await util.renderPage(pdf, 1, { maxWidth: 300, scale: 0.5 });
          box.textContent = '';
          box.appendChild(c);
          pdf.destroy();
        } catch (e) { onPages && onPages(null, e); }
      });
    }
    return box;
  }

  /** Build an options form. Returns { el, get() }. */
  function renderOptions(options, onChange) {
    const el = h('<div class="opts"></div>');
    const fields = [];
    for (const o of options) {
      const id = 'opt-' + o.id;
      let inner = '';
      const val = o.default;
      switch (o.type) {
        case 'select':
          inner = `<select class="input" id="${id}">${o.choices.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(val) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
          break;
        case 'seg':
          inner = `<div class="seg" role="radiogroup" aria-label="${escapeHtml(o.label)}">${o.choices.map(([v, l]) => `<label><input type="radio" name="${id}" value="${escapeHtml(v)}" ${String(v) === String(val) ? 'checked' : ''}><span>${escapeHtml(l)}</span></label>`).join('')}</div>`;
          break;
        case 'checkbox':
          inner = `<label class="check"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}> ${escapeHtml(o.text || o.label)}</label>`;
          break;
        case 'textarea':
          inner = `<textarea class="input" id="${id}" placeholder="${escapeHtml(o.placeholder || '')}" rows="${o.rows || 6}">${escapeHtml(val || '')}</textarea>`;
          break;
        case 'range':
          inner = `<div style="display:flex;gap:10px;align-items:center"><input type="range" id="${id}" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${val}"><output style="min-width:42px;font-weight:700;font-size:13px">${val}${o.unit || ''}</output></div>`;
          break;
        case 'file':
          inner = `<input type="file" class="input" id="${id}" accept="${o.accept || ''}">`;
          break;
        default:
          inner = `<input class="input" id="${id}" type="${o.type || 'text'}" value="${escapeHtml(val ?? '')}" placeholder="${escapeHtml(o.placeholder || '')}" ${o.min !== undefined ? `min="${o.min}"` : ''} ${o.max !== undefined ? `max="${o.max}"` : ''} ${o.step !== undefined ? `step="${o.step}"` : ''} autocomplete="off">`;
      }
      const showLabel = o.type !== 'checkbox';
      const f = h(`<div class="field ${o.full || o.type === 'textarea' || o.type === 'checkbox' ? 'full' : ''}">
          ${showLabel ? (o.type === 'seg' ? `<span class="label">${escapeHtml(o.label)}</span>` : `<label for="${id}">${escapeHtml(o.label)}</label>`) : ''}
          ${inner}
          ${o.hint ? `<span class="hint">${escapeHtml(o.hint)}</span>` : ''}
        </div>`);
      if (o.type === 'range') {
        const r = f.querySelector('input'); const out = f.querySelector('output');
        r.addEventListener('input', () => { out.textContent = r.value + (o.unit || ''); });
      }
      el.appendChild(f);
      fields.push({ o, f });
    }
    const get = () => {
      const v = {};
      for (const { o, f } of fields) {
        if (o.type === 'checkbox') v[o.id] = f.querySelector('input').checked;
        else if (o.type === 'seg') v[o.id] = (f.querySelector('input:checked') || {}).value;
        else if (o.type === 'file') v[o.id] = f.querySelector('input').files[0] || null;
        else if (o.type === 'number' || o.type === 'range') v[o.id] = parseFloat(f.querySelector('input').value);
        else v[o.id] = f.querySelector('input,select,textarea').value;
      }
      return v;
    };
    const refresh = () => {
      const v = get();
      for (const { o, f } of fields) if (o.showIf) f.classList.toggle('hidden', !o.showIf(v));
    };
    el.addEventListener('input', () => { refresh(); onChange && onChange(get()); });
    el.addEventListener('change', () => { refresh(); onChange && onChange(get()); });
    refresh();
    return { el, get };
  }

  function friendlyError(e) {
    console.error(e);
    if (e instanceof UserError) return e.message;
    if (e && /memory|allocation|Invalid array length/i.test(e.message)) return 'Your device ran out of memory. Try fewer pages, a lower DPI, or a smaller file.';
    return 'Something went wrong: ' + ((e && e.message) || e);
  }

  /** Show the outputs of a tool run. out = array | { outputs, message, title } */
  function renderResult(container, out, { onReset, resetLabel } = {}) {
    const res = Array.isArray(out) ? { outputs: out } : (out || { outputs: [] });
    const outputs = res.outputs || [];
    const files = outputs.filter((o) => o.blob);
    container.innerHTML = '';
    container.classList.remove('hidden');
    const panel = h(`<div class="panel result">
        <div class="result-head"><div class="tick">${icon('check', 20)}</div>
          <div><h2>${escapeHtml(res.title || 'Done!')}</h2>${res.message ? `<p>${escapeHtml(res.message)}</p>` : ''}</div></div>
      </div>`);
    for (const o of outputs) {
      if (o.html) panel.appendChild(h(`<div class="out-html">${o.html}</div>`));
      if (o.text !== undefined) {
        const pre = h('<div class="out-preview"></div>');
        pre.textContent = o.text.length > 200000 ? o.text.slice(0, 200000) + '\n…(preview truncated, download for full text)' : o.text;
        panel.appendChild(pre);
      }
    }
    if (files.length) {
      const list = h('<div class="out-list"></div>');
      for (const o of files) {
        const row = h(`<div class="out-item"><div class="file-meta"><div class="file-name"></div><div class="file-sub">${formatBytes(o.blob.size)}</div></div><button class="btn sm">${icon('download')} Download</button></div>`);
        row.querySelector('.file-name').textContent = o.name;
        row.querySelector('button').onclick = () => util.download(o.blob, o.name);
        list.appendChild(row);
      }
      if (files.length > 1) panel.appendChild(list);
    }
    const actions = h('<div class="result-actions"></div>');
    if (files.length === 1) {
      const b = h(`<button class="btn primary big">${icon('download')} Download ${escapeHtml(files[0].name.length > 40 ? 'file' : files[0].name)}</button>`);
      b.onclick = () => util.download(files[0].blob, files[0].name);
      actions.appendChild(b);
    } else if (files.length > 1) {
      const b = h(`<button class="btn primary big">${icon('download')} Download all (ZIP)</button>`);
      b.onclick = async () => {
        b.disabled = true;
        try { util.download(await util.zipOutputs(files), res.zipName || 'files.zip'); } catch (e) { toast(friendlyError(e)); }
        b.disabled = false;
      };
      actions.appendChild(b);
    }
    const textOut = outputs.find((o) => o.text !== undefined);
    if (textOut) {
      const c = h(`<button class="btn">${icon('copy')} Copy text</button>`);
      c.onclick = async () => {
        try { await navigator.clipboard.writeText(textOut.text); toast('Copied to clipboard'); } catch { toast('Copy failed. Select the text and copy manually.'); }
      };
      actions.appendChild(c);
    }
    if (onReset) {
      const r = h(`<button class="btn">${escapeHtml(resetLabel || 'Start over')}</button>`);
      r.onclick = onReset;
      actions.appendChild(r);
    }
    panel.appendChild(actions);
    container.appendChild(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** Runs an async task with progress UI and error handling. */
  async function runTask({ button, progress, resultEl, errorEl, task, onReset }) {
    errorEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    if (button) button.disabled = true;
    progress.set(null, 'Working…');
    try {
      const out = await task((frac, msg) => progress.set(frac, msg));
      progress.hide();
      renderResult(resultEl, out, { onReset });
      return out;
    } catch (e) {
      progress.hide();
      errorEl.textContent = friendlyError(e);
      errorEl.classList.remove('hidden');
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally {
      if (button) button.disabled = false;
    }
  }

  // ---------- generic tool workflow ----------
  function mountGeneric(tool, root) {
    const state = { files: [] };
    const multiple = !!tool.multiple;
    const needsFiles = !!tool.accept;
    const minFiles = tool.minFiles || (needsFiles ? 1 : 0);

    const errorEl = h('<div class="error-box hidden" role="alert"></div>');
    const listEl = h(`<div class="file-list ${multiple && tool.reorder ? 'thumbs' : ''}"></div>`);
    const hint = h('<p class="reorder-hint hidden">Drag files to change their order.</p>');
    const optsPanel = h('<div class="panel"><div class="panel-title">Options</div></div>');
    const opts = renderOptions(tool.options || []);
    optsPanel.appendChild(opts.el);
    const actions = h(`<div class="actions"><button class="btn primary big run">${escapeHtml(tool.action || 'Process')}</button></div>`);
    const runBtn = actions.querySelector('button');
    const progress = createProgress();
    const resultEl = h('<div class="hidden"></div>');

    let dz;
    if (needsFiles) {
      dz = createDropzone({ accept: tool.accept, multiple, onFiles: addFiles, label: tool.dropLabel });
      root.appendChild(dz.el);
    }
    if (tool.note) root.appendChild(h(`<div class="note">${escapeHtml(tool.note)}</div>`));
    root.append(hint, listEl);
    if ((tool.options || []).length) root.appendChild(optsPanel);
    root.append(errorEl, actions, progress.el, resultEl);

    function addFiles(files) {
      state.files = multiple ? state.files.concat(files) : files.slice(0, 1);
      renderList();
    }
    function renderList() {
      listEl.innerHTML = '';
      for (const file of state.files) {
        const item = h(`<div class="file-item"><div class="file-meta"><div class="file-name"></div><div class="file-sub">${formatBytes(file.size)}</div></div><button class="file-remove" aria-label="Remove file" title="Remove">×</button></div>`);
        item.querySelector('.file-name').textContent = file.name;
        item.querySelector('.file-name').title = file.name;
        const sub = item.querySelector('.file-sub');
        item.prepend(fileThumb(file, (n, err) => {
          if (err) sub.innerHTML = `<span style="color:var(--danger)">Can't preview (protected or damaged)</span>`;
          else if (n) sub.textContent = `${n} page${n === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
        }));
        item.querySelector('.file-remove').onclick = (e) => {
          e.stopPropagation();
          state.files = state.files.filter((f) => f !== file);
          renderList();
        };
        item._file = file;
        listEl.appendChild(item);
      }
      if (dz) dz.setCompact(state.files.length > 0);
      hint.classList.toggle('hidden', !(multiple && tool.reorder && state.files.length > 1));
      runBtn.disabled = state.files.length < minFiles;
      if (multiple && tool.reorder && state.files.length > 1) enableSort();
    }
    let sortable;
    async function enableSort() {
      if (sortable) return;
      try {
        const Sortable = await App.lib.sortable();
        sortable = Sortable.create(listEl, {
          animation: 150,
          ghostClass: 'sortable-ghost',
          onEnd: () => { state.files = [...listEl.children].map((c) => c._file); },
        });
      } catch { /* sorting is optional */ }
    }
    runBtn.disabled = minFiles > 0;
    runBtn.onclick = () => {
      if (state.files.length < minFiles) { toast(minFiles > 1 ? `Add at least ${minFiles} files.` : 'Add a file first.'); return; }
      runTask({
        button: runBtn, progress, resultEl, errorEl,
        task: (p) => tool.run({ files: state.files, file: state.files[0], opts: opts.get(), progress: p }),
        onReset: () => { state.files = []; renderList(); resultEl.classList.add('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); },
      });
    };
  }

  // ---------- pages ----------
  function renderHome(root, params) {
    const cat = params.get('cat');
    root.innerHTML = '';
    const hero = h(`<section class="hero">
        <h1>Every PDF tool you need.<br><span>Nothing gets uploaded.</span></h1>
        <p>${App.tools.length} free tools to merge, split, compress, convert, edit and protect PDFs. Everything runs privately in your browser.</p>
        <div class="search">${icon('search', 20)}<input type="search" placeholder="Search tools, e.g. merge, jpg, password…" aria-label="Search tools"></div>
        <ul class="trust"><li>No watermark</li><li>Files stay on your device</li><li>Works offline</li><li>No sign-up</li><li>Free forever</li></ul>
      </section>`);
    root.appendChild(hero);
    const chips = h('<div class="chips" role="toolbar" aria-label="Filter by category"></div>');
    const all = [{ id: '', name: 'All tools' }, ...App.categories];
    for (const c of all) {
      const b = h(`<button class="chip" aria-pressed="${(cat || '') === c.id}">${escapeHtml(c.name)}</button>`);
      b.onclick = () => { location.hash = c.id ? `#/?cat=${c.id}` : '#/'; };
      chips.appendChild(b);
    }
    root.appendChild(chips);
    const sections = [];
    for (const c of App.categories) {
      if (cat && c.id !== cat) continue;
      const tools = App.tools.filter((t) => t.category === c.id);
      if (!tools.length) continue;
      const sec = h(`<section class="cat-section" style="--cat:${c.color}"><h2>${escapeHtml(c.name)}</h2><div class="grid"></div></section>`);
      const grid = sec.querySelector('.grid');
      for (const t of tools) {
        const card = h(`<a class="card" href="#/${t.id}" style="--cat:${c.color}">
            <span class="ico">${icon(t.icon)}</span>
            <h3>${escapeHtml(t.title)}</h3>
            <p>${escapeHtml(t.desc)}</p>
            ${t.badge ? `<span class="badge">${escapeHtml(t.badge)}</span>` : ''}
          </a>`);
        card._search = (t.title + ' ' + t.desc + ' ' + (t.keywords || '')).toLowerCase();
        grid.appendChild(card);
      }
      sections.push(sec);
      root.appendChild(sec);
    }
    const empty = h('<p class="empty-search hidden">No tools match your search.</p>');
    root.appendChild(empty);
    root.appendChild(h(`<section class="features">
        <div class="feature"><h3>Private by design</h3><p>Files are processed on your device with JavaScript and WebAssembly. Nothing is sent to a server.</p></div>
        <div class="feature"><h3>No limits, no watermark</h3><p>No daily quotas, no sign-up walls, no stamps on your documents.</p></div>
        <div class="feature"><h3>Works offline</h3><p>After your first visit, the app and its engines are cached, so most tools work without a connection.</p></div>
        <div class="feature"><h3>Fast on any device</h3><p>There's no upload or download wait. Speed depends only on your computer or phone.</p></div>
      </section>`));
    const input = hero.querySelector('input');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      let any = false;
      for (const sec of sections) {
        let n = 0;
        for (const card of sec.querySelectorAll('.card')) {
          const show = !q || q.split(/\s+/).every((w) => card._search.includes(w));
          card.classList.toggle('hidden', !show);
          if (show) n++;
        }
        sec.classList.toggle('hidden', n === 0);
        if (n) any = true;
      }
      empty.classList.toggle('hidden', any);
    });
    document.title = 'PDFLoom — Free PDF Tools in Your Browser';
  }

  function renderTool(root, tool) {
    root.innerHTML = '';
    const page = h(`<div class="tool-page" style="--cat:${catColor(tool.category)}">
        <a class="back" href="#/">${icon('arrowLeft', 16)} All tools</a>
        <div class="tool-head"><span class="ico">${icon(tool.icon)}</span><div><h1>${escapeHtml(tool.title)}</h1><p>${escapeHtml(tool.longDesc || tool.desc)}</p></div></div>
        <div class="workspace"></div>
        <p class="privacy-note">${icon('lock', 15)} ${escapeHtml(tool.privacy || 'Your files are processed on this device and never uploaded.')}</p>
      </div>`);
    root.appendChild(page);
    const ws = page.querySelector('.workspace');
    if (tool.mount) tool.mount(ws, { tool });
    else mountGeneric(tool, ws);
    document.title = `${tool.title} — PDFLoom`;
  }

  function renderNotFound(root) {
    root.innerHTML = `<div class="not-found"><h1>Page not found</h1><p class="muted">That tool doesn't exist.</p><p style="margin-top:18px"><a class="btn primary" href="#/">Browse all tools</a></p></div>`;
  }

  App.ui = { toast, h, createDropzone, createProgress, renderOptions, renderResult, runTask, fileThumb, friendlyError, renderHome, renderTool, renderNotFound, mountGeneric };
})(window.App);
