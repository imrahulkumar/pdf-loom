/* Security & Privacy: encrypt, decrypt, redact, flatten, privacy scanner, fingerprint */
(function (App) {
  'use strict';
  const { util, lib, UserError, icon } = App;
  const PDF = '.pdf,application/pdf';
  const ui = () => App.ui;
  const esc = util.escapeHtml;

  // ---------------- Encrypt ----------------
  App.registerTool({
    id: 'encrypt-pdf', category: 'security', icon: 'lock',
    title: 'Protect PDF', desc: 'Encrypt a PDF with a password using AES-256 and set permissions.',
    keywords: 'password encrypt lock secure aes protect',
    accept: PDF, action: 'Protect PDF',
    options: [
      { id: 'pw', label: 'Password', type: 'password', default: '' },
      { id: 'pw2', label: 'Repeat password', type: 'password', default: '' },
      { id: 'owner', label: 'Owner password (optional)', type: 'password', default: '', hint: 'Lets you change permissions later. Defaults to the password above.' },
      { id: 'print', label: 'Printing', type: 'checkbox', text: 'Allow printing', default: true },
      { id: 'copy', label: 'Copying', type: 'checkbox', text: 'Allow copying text and images', default: true },
      { id: 'modify', label: 'Editing', type: 'checkbox', text: 'Allow editing and annotations', default: false },
    ],
    async run({ file, opts }) {
      if (!opts.pw) throw new UserError('Enter a password.');
      if (opts.pw !== opts.pw2) throw new UserError("The passwords don't match.");
      const doc = await util.loadPdf(file);
      doc.encrypt({
        userPassword: opts.pw,
        ownerPassword: opts.owner || opts.pw,
        permissions: {
          printing: opts.print ? 'highResolution' : false,
          copying: opts.copy, modifying: opts.modify, annotating: opts.modify,
          fillingForms: true, contentAccessibility: true, documentAssembly: opts.modify,
        },
      });
      return { outputs: [{ name: util.baseName(file.name) + '-protected.pdf', blob: util.pdfBlob(await doc.save()) }], message: 'Encrypted with AES-256. Keep your password safe, because it can\'t be recovered.' };
    },
  });

  // ---------------- Remove password ----------------
  App.registerTool({
    id: 'remove-password', category: 'security', icon: 'unlock',
    title: 'Remove Password', desc: 'Unlock a PDF you know the password for, and remove restrictions.',
    keywords: 'unlock decrypt unprotect restrictions',
    accept: PDF, action: 'Unlock PDF',
    options: [{ id: 'pw', label: 'Current password', type: 'password', default: '', hint: 'Leave empty if the file opens without a password but has restrictions.' }],
    async run({ file, opts }) {
      const { PDFDocument } = await lib.pdflib();
      const bytes = await util.readBytes(file);
      try {
        await PDFDocument.load(bytes, { updateMetadata: false });
        throw new UserError("This PDF isn't password protected.");
      } catch (e) { if (e instanceof UserError) throw e; }
      let doc;
      try { doc = await PDFDocument.load(bytes, { password: opts.pw || '', updateMetadata: false }); } catch (e) {
        if (/password/i.test(e.message)) throw new UserError(opts.pw ? 'Incorrect password.' : 'This PDF needs a password to open. Enter it above.');
        throw new UserError('Could not decrypt this file: ' + e.message);
      }
      const out = await util.copyToNewDoc(doc);
      ['Title', 'Author', 'Subject'].forEach((k) => { try { const v = doc['get' + k](); if (v) out['set' + k](v); } catch { /* ignore */ } });
      return { outputs: [{ name: util.baseName(file.name) + '-unlocked.pdf', blob: util.pdfBlob(await out.save()) }], message: 'Password and restrictions removed.' };
    },
  });

  // ---------------- Redact ----------------
  App.registerTool({
    id: 'redact-pdf', category: 'security', icon: 'redact',
    title: 'Redact PDF', desc: 'Permanently black out sensitive text and images. Search to redact every match.',
    keywords: 'black out censor hide sensitive remove text',
    mount(root, { tool }) {
      const { h, createDropzone, runTask } = ui();
      const { scaffold, reset } = App.toolkit;
      const s = scaffold(root);
      const dz = createDropzone({ accept: PDF, onFiles: ([file]) => { dz.el.remove(); start(file); } });
      root.appendChild(dz.el);
      async function start(file) {
        const bar = h(`<div class="panel"><div class="toolbar">
            <input class="input" type="search" placeholder="Find text to redact (e.g. a name or account number)" style="flex:1;min-width:200px">
            <button class="btn sm" data-a="find">${icon('search')} Mark all matches</button>
            <button class="btn sm" data-a="clear">Clear boxes</button>
          </div><p class="small muted">Drag on a page to draw a redaction box. Redacted pages are flattened to images, so the hidden content is really gone.</p></div>`);
        root.appendChild(bar);
        const holder = h('<div></div>');
        root.appendChild(holder);
        s.progress.set(null, 'Loading pages…');
        root.appendChild(s.progress.el);
        let ed;
        try { ed = await App.PageEditor.create(holder, file, { mode: 'rect', rectClass: 'rbox' }); } catch (e) {
          s.progress.hide(); root.appendChild(s.errorEl); s.errorEl.textContent = ui().friendlyError(e); s.errorEl.classList.remove('hidden'); return;
        }
        s.progress.hide();
        const findIn = bar.querySelector('input');
        bar.addEventListener('click', async (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.a === 'clear') ed.clear();
          if (b.dataset.a === 'find') {
            const q = findIn.value.trim().toLowerCase();
            if (!q) return ui().toast('Type something to search for.');
            let n = 0;
            const pdfjs = await lib.pdfjs();
            for (const rec of ed.pages) {
              const tc = await rec.page.getTextContent();
              for (const it of tc.items) {
                const str = (it.str || '').toLowerCase();
                let idx = str.indexOf(q);
                if (idx < 0 || !it.str.length) continue;
                const m = pdfjs.Util.transform(rec.vp.transform, it.transform);
                const fh = Math.hypot(m[2], m[3]);
                const angle = Math.atan2(m[1], m[0]);
                if (Math.abs(angle) > 0.05) continue; // only horizontal text
                const totalW = it.width * rec.vp.scale;
                while (idx >= 0) {
                  const x = m[4] + totalW * (idx / it.str.length);
                  const w = totalW * (q.length / it.str.length);
                  ed.addRect(rec, x - 1, m[5] - fh * 0.85, w + 2, fh * 1.1);
                  n++;
                  idx = str.indexOf(q, idx + q.length);
                }
              }
            }
            ui().toast(n ? `Marked ${n} match${n > 1 ? 'es' : ''}.` : 'No matches found in the text layer.');
          }
        });
        const opts = ui().renderOptions([
          { id: 'dpi', label: 'Quality of redacted pages', type: 'select', default: '150', choices: [['100', 'Normal (100 DPI)'], ['150', 'High (150 DPI)'], ['200', 'Very high (200 DPI)']] },
          { id: 'meta', label: 'Metadata', type: 'checkbox', text: 'Also remove document metadata (author, title…)', default: true },
        ]);
        const p = h('<div class="panel"></div>'); p.appendChild(opts.el); root.appendChild(p);
        const actions = h('<div class="actions"><button class="btn primary big">Redact & download</button></div>');
        root.appendChild(actions);
        s.mountTail();
        const btn = actions.querySelector('button');
        btn.onclick = () => runTask({
          button: btn, progress: s.progress, resultEl: s.resultEl, errorEl: s.errorEl,
          onReset: () => { ed.destroy(); reset(root, tool); },
          task: async (progress) => {
            const o = opts.get();
            const items = ed.getItems();
            if (!items.length) throw new UserError('Draw at least one redaction box.');
            const byPage = {};
            items.forEach((it) => { (byPage[it.pageIndex] = byPage[it.pageIndex] || []).push(it); });
            const doc = await util.loadPdf(file);
            const idxs = Object.keys(byPage).map(Number);
            for (let k = 0; k < idxs.length; k++) {
              const i = idxs[k];
              progress(k / idxs.length, `Flattening page ${i + 1}`);
              const c = await util.renderPage(ed.pdf, i + 1, { dpi: +o.dpi });
              const ctx = c.getContext('2d');
              ctx.fillStyle = '#000';
              for (const r of byPage[i]) ctx.fillRect(r.fx * c.width, r.fy * c.height, r.fw * c.width, r.fh * c.height);
              const blob = await util.canvasToBlob(c, 'image/jpeg', 0.88);
              const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
              doc.removePage(i);
              const np = doc.insertPage(i, [c.pdfWidth, c.pdfHeight]);
              np.drawImage(img, { x: 0, y: 0, width: c.pdfWidth, height: c.pdfHeight });
            }
            if (o.meta) await util.stripMetadata(doc);
            return { outputs: [{ name: util.baseName(file.name) + '-redacted.pdf', blob: util.pdfBlob(await doc.save()) }], message: `${items.length} area${items.length > 1 ? 's' : ''} redacted on ${idxs.length} page${idxs.length > 1 ? 's' : ''}.` };
          },
        });
      }
    },
  });

  // ---------------- Flatten ----------------
  App.registerTool({
    id: 'flatten-pdf', category: 'security', icon: 'layers',
    title: 'Flatten PDF', desc: 'Lock in form fields and annotations so they can no longer be edited.',
    keywords: 'form fields annotations lock bake',
    accept: PDF, action: 'Flatten PDF',
    options: [
      { id: 'mode', label: 'Mode', type: 'seg', default: 'forms', full: true, choices: [['forms', 'Form fields only (keeps text selectable)'], ['all', 'Everything (pages become images)']] },
      { id: 'dpi', label: 'Image quality', type: 'select', default: '150', choices: [['100', '100 DPI'], ['150', '150 DPI'], ['200', '200 DPI'], ['300', '300 DPI']], showIf: (v) => v.mode === 'all' },
    ],
    async run({ file, opts, progress }) {
      const base = util.baseName(file.name);
      if (opts.mode === 'all') {
        const doc = await util.rasterizePdf(file, { dpi: +opts.dpi, quality: 0.88, progress });
        return { outputs: [{ name: base + '-flattened.pdf', blob: util.pdfBlob(await doc.save()) }], message: 'All pages, forms, annotations and layers are now flat images.' };
      }
      const doc = await util.loadPdf(file);
      const form = doc.getForm();
      const n = form.getFields().length;
      if (!n) throw new UserError('This PDF has no form fields. Choose "Everything" to flatten annotations and layers.');
      form.flatten();
      return { outputs: [{ name: base + '-flattened.pdf', blob: util.pdfBlob(await doc.save()) }], message: `${n} form field${n > 1 ? 's' : ''} flattened.` };
    },
  });

  // ---------------- Privacy scanner ----------------
  async function scan(doc, bytes) {
    const L = await lib.pdflib();
    const { PDFName, PDFDict, PDFArray, PDFRawStream } = L;
    const N = (n) => PDFName.of(n);
    const ctx = doc.context;
    const r = {};
    const get = (fn) => { try { return doc[fn](); } catch { return undefined; } };
    r.meta = {
      Title: get('getTitle'), Author: get('getAuthor'), Subject: get('getSubject'), Keywords: get('getKeywords'),
      'Creator app': get('getCreator'), Producer: get('getProducer'),
      Created: get('getCreationDate'), Modified: get('getModificationDate'),
    };
    let xmp = '';
    const md = ctx.lookup(doc.catalog.get(N('Metadata')));
    if (md instanceof PDFRawStream) { try { xmp = new TextDecoder().decode(L.decodePDFRawStream(md).decode()); } catch { xmp = ''; } }
    r.xmp = !!md;
    r.gps = /GPS(Latitude|Longitude)/i.test(xmp);
    r.xmpPeople = [...new Set([...xmp.matchAll(/<(?:dc:creator|xmp:CreatorTool|pdf:Producer|photoshop:AuthorsPosition|xmpMM:DocumentID)[^>]*>([\s\S]*?)<\//g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').trim()).filter(Boolean))].slice(0, 6);
    let js = 0, files = 0, annots = 0, links = 0;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      const d = obj instanceof PDFDict ? obj : null;
      if (!d) continue;
      if (d.get(N('S')) === N('JavaScript') || d.get(N('JS'))) js++;
      if (d.get(N('Type')) === N('Filespec') && d.get(N('EF'))) files++;
    }
    for (const p of doc.getPages()) {
      const a = ctx.lookup(p.node.get(N('Annots')));
      if (a instanceof PDFArray) {
        for (let i = 0; i < a.size(); i++) {
          const an = ctx.lookup(a.get(i));
          if (an instanceof PDFDict && an.get(N('Subtype')) === N('Link')) links++; else annots++;
        }
      }
    }
    r.js = js; r.files = files; r.annots = annots; r.links = links;
    try { r.fields = doc.getForm().getFields().length; } catch { r.fields = 0; }
    const raw = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024 * 1024)));
    r.revisions = (raw.match(/%%EOF/g) || []).length;
    return r;
  }

  async function clean(doc, o) {
    const { PDFName, PDFDict, PDFArray } = await lib.pdflib();
    const N = (n) => PDFName.of(n);
    const ctx = doc.context;
    if (o.meta) await util.stripMetadata(doc);
    if (o.js) {
      doc.catalog.delete(N('OpenAction'));
      doc.catalog.delete(N('AA'));
      for (const [, obj] of ctx.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict)) continue;
        if (obj.get(N('JS'))) obj.delete(N('JS'));
        if (obj.get(N('AA'))) obj.delete(N('AA'));
      }
      const names = ctx.lookup(doc.catalog.get(N('Names')));
      if (names instanceof PDFDict) names.delete(N('JavaScript'));
    }
    if (o.files) {
      const names = ctx.lookup(doc.catalog.get(N('Names')));
      if (names instanceof PDFDict) names.delete(N('EmbeddedFiles'));
      doc.catalog.delete(N('AF'));
    }
    if (o.annots) for (const p of doc.getPages()) p.node.delete(N('Annots'));
    else if (o.files) {
      for (const p of doc.getPages()) {
        const a = ctx.lookup(p.node.get(N('Annots')));
        if (!(a instanceof PDFArray)) continue;
        for (let i = a.size() - 1; i >= 0; i--) { const an = ctx.lookup(a.get(i)); if (an instanceof PDFDict && an.get(N('Subtype')) === N('FileAttachment')) a.remove(i); }
      }
    }
  }

  App.registerTool({
    id: 'privacy-scanner', category: 'security', icon: 'shield',
    title: 'Privacy Scanner', desc: 'Find hidden metadata, scripts, attachments and edit history, then strip them.',
    keywords: 'metadata exif gps author remove clean sanitize hidden data',
    accept: PDF, action: 'Scan & clean',
    options: [
      { id: 'meta', label: 'Metadata', type: 'checkbox', text: 'Remove metadata (author, title, software, dates, XMP)', default: true },
      { id: 'js', label: 'Scripts', type: 'checkbox', text: 'Remove JavaScript and auto-run actions', default: true },
      { id: 'files', label: 'Attachments', type: 'checkbox', text: 'Remove embedded files', default: true },
      { id: 'annots', label: 'Annotations', type: 'checkbox', text: 'Remove comments, annotations and links', default: false },
    ],
    async run({ file, opts }) {
      const bytes = await util.readBytes(file);
      const doc = await util.loadPdf(file);
      const r = await scan(doc, bytes);
      const fmt = (v) => (v instanceof Date ? v.toLocaleString() : v);
      const rows = Object.entries(r.meta).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v ? `${esc(fmt(v))} <span class="pill warn">exposed</span>` : '<span class="muted">none</span>'}</td></tr>`).join('');
      const flag = (n, bad) => (n ? `<span class="pill ${bad ? 'bad' : 'warn'}">${n}</span>` : '<span class="pill ok">none</span>');
      const found = Object.values(r.meta).filter(Boolean).length + (r.xmp ? 1 : 0) + r.js + r.files + (r.revisions > 1 ? 1 : 0) + (r.gps ? 1 : 0);
      const html = `<table class="report">
          ${rows}
          <tr><th>XMP metadata packet</th><td>${r.xmp ? '<span class="pill warn">present</span>' + (r.xmpPeople.length ? ' ' + esc(r.xmpPeople.join(' · ')) : '') : '<span class="pill ok">none</span>'}</td></tr>
          <tr><th>GPS location data</th><td>${r.gps ? '<span class="pill bad">found</span>' : '<span class="pill ok">none</span>'}</td></tr>
          <tr><th>JavaScript actions</th><td>${flag(r.js, true)}</td></tr>
          <tr><th>Embedded files</th><td>${flag(r.files, true)}</td></tr>
          <tr><th>Previous revisions (incremental saves)</th><td>${r.revisions > 1 ? `<span class="pill warn">${r.revisions - 1}</span> earlier versions may be recoverable` : '<span class="pill ok">none</span>'}</td></tr>
          <tr><th>Annotations / comments</th><td>${flag(r.annots)}</td></tr>
          <tr><th>Links</th><td>${r.links || 0}</td></tr>
          <tr><th>Form fields</th><td>${r.fields}</td></tr>
        </table>`;
      await clean(doc, opts);
      const out = await doc.save();
      return {
        title: found ? `Found ${found} privacy issue${found > 1 ? 's' : ''}` : 'No major privacy issues found',
        message: 'A cleaned copy is ready. Saving it also discards any earlier revisions.',
        outputs: [{ html }, { name: util.baseName(file.name) + '-clean.pdf', blob: util.pdfBlob(out) }],
      };
    },
  });

  // ---------------- Fingerprint ----------------
  const rid = () => 'FP-' + Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  App.registerTool({
    id: 'fingerprint-pdf', category: 'security', icon: 'fingerprint',
    title: 'Fingerprint PDF', desc: 'Embed an invisible tracking ID per recipient, or check a file for one.',
    keywords: 'track leak trace watermark invisible id',
    accept: PDF, multiple: true, action: 'Run',
    options: [
      { id: 'mode', label: 'Mode', type: 'seg', default: 'embed', full: true, choices: [['embed', 'Embed fingerprint'], ['detect', 'Check for fingerprint']] },
      { id: 'recipients', label: 'Recipients (one per line)', type: 'textarea', rows: 4, default: '', placeholder: 'alice@example.com\nbob@example.com', hint: 'One uniquely fingerprinted copy is created per line. Leave empty for a single copy.', showIf: (v) => v.mode === 'embed' },
    ],
    async run({ files, opts, progress }) {
      const { rgb, PDFName, PDFString, PDFDict } = await lib.pdflib();
      if (opts.mode === 'detect') {
        let html = '<table class="report">';
        for (const f of files) {
          const text = (await util.extractText(f)).join('\n');
          const doc = await util.loadPdf(f);
          const info = doc.context.lookup(doc.context.trailerInfo.Info);
          const meta = info instanceof PDFDict ? info.get(PDFName.of('Fingerprint')) : null;
          const ids = new Set([...text.matchAll(/FPID:(FP-[0-9A-F]{10})/g)].map((m) => m[1]));
          if (meta) ids.add(meta.decodeText ? meta.decodeText() : String(meta));
          const label = text.match(/FPTO:([^\n]*?)(?:\s{2,}|$)/m);
          html += `<tr><th>${esc(f.name)}</th><td>${ids.size ? `<span class="pill bad">${esc([...ids].join(', '))}</span>${label ? ' → ' + esc(label[1].trim()) : ''}` : '<span class="pill ok">no fingerprint found</span>'}</td></tr>`;
        }
        return { title: 'Fingerprint check', outputs: [{ html: html + '</table>' }] };
      }
      const recipients = opts.recipients.split('\n').map((s) => s.trim()).filter(Boolean);
      const list = recipients.length ? recipients : [''];
      const outputs = [];
      let html = '<table class="report"><tr><th>File</th><td><b>Fingerprint ID</b></td></tr>';
      let k = 0;
      for (const f of files) {
        for (const who of list) {
          progress(k++ / (files.length * list.length), 'Fingerprinting…');
          const doc = await util.loadPdf(f);
          const font = await App.util.fontFor(doc, 'Helvetica');
          const id = rid();
          doc.getPages().forEach((p) => {
            const b = p.getCropBox();
            p.drawText(util.safeText(font, `FPID:${id}` + (who ? `  FPTO:${who}` : '')), { x: b.x + 2, y: b.y + 2, size: 1, font, color: rgb(1, 1, 1), opacity: 0 });
          });
          doc.setKeywords([...(doc.getKeywords() || '').split(/[,;]\s*/).filter(Boolean)]);
          const info = doc.context.lookup(doc.context.trailerInfo.Info);
          if (info instanceof PDFDict) info.set(PDFName.of('Fingerprint'), PDFString.of(id));
          const name = util.baseName(f.name) + (who ? '-' + who.replace(/[^\w.-]+/g, '_') : '') + '.pdf';
          outputs.push({ name, blob: util.pdfBlob(await doc.save()) });
          html += `<tr><th>${esc(name)}</th><td><code>${id}</code>${who ? ' → ' + esc(who) : ''}</td></tr>`;
        }
      }
      return { outputs: [{ html: html + '</table>' }, ...outputs], zipName: 'fingerprinted.zip', message: 'Keep this table. Use "Check for fingerprint" on a leaked copy to identify its recipient.' };
    },
  });
})(window.App);
