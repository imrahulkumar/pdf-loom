/* Convert & Export */
(function (App) {
  'use strict';
  const { util, lib, UserError, icon } = App;
  const PDF = '.pdf,application/pdf';
  const ui = () => App.ui;
  const esc = util.escapeHtml;

  // ---------- shared: editor → PDF tools ----------
  const SAMPLE_MD = `# Project Report

Write **Markdown** on the left and see the preview on the right.

## Highlights
- Fast, private conversion
- Tables, code blocks and quotes
- No uploads

| Quarter | Revenue | Growth |
|---------|--------:|-------:|
| Q1      | $12,400 | 4%     |
| Q2      | $15,900 | 28%    |

> Quotes look like this.

\`\`\`js
console.log('Hello, PDF');
\`\`\`
`;
  const SAMPLE_HTML = `<!-- Paste HTML here. Inline <style> is supported. Scripts are removed. -->
<style>
  .box { border: 2px solid #e0433a; border-radius: 8px; padding: 16px; }
  h1 { color: #e0433a; }
</style>
<h1>Invoice #1024</h1>
<div class="box">
  <p><b>Billed to:</b> Acme Corp</p>
  <table>
    <tr><th>Item</th><th>Qty</th><th>Price</th></tr>
    <tr><td>Design work</td><td>10 h</td><td>$900</td></tr>
    <tr><td>Hosting</td><td>1</td><td>$40</td></tr>
  </table>
  <p style="text-align:right"><b>Total: $940</b></p>
</div>`;

  function editorTool({ id, title, desc, keywords, iconName, kind }) {
    App.registerTool({
      id, category: 'convert', icon: iconName, title, desc, keywords,
      mount(root, { tool }) {
        const { h, renderOptions, runTask } = ui();
        const s = App.toolkit.scaffold(root);
        let getHtml;
        if (kind === 'rte') {
          const wrap = h(`<div class="panel"><div class="rte-bar">
              <select aria-label="Block style"><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option></select>
              <button data-c="bold" title="Bold"><b>B</b></button><button data-c="italic" title="Italic"><i>I</i></button><button data-c="underline" title="Underline"><u>U</u></button>
              <button data-c="insertUnorderedList" title="Bulleted list">• List</button><button data-c="insertOrderedList" title="Numbered list">1. List</button>
              <button data-c="justifyLeft" title="Align left">Left</button><button data-c="justifyCenter" title="Center">Center</button><button data-c="justifyRight" title="Align right">Right</button>
              <button data-c="pagebreak" title="Insert page break">Page break</button>
            </div><div class="rte doc-render" contenteditable="true" spellcheck="true"><h1>Untitled document</h1><p>Start typing here. Use the toolbar to format text, then click <b>Create PDF</b>.</p></div></div>`);
          root.appendChild(wrap);
          const ed = wrap.querySelector('.rte');
          wrap.querySelector('.rte-bar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
          wrap.querySelector('.rte-bar').addEventListener('click', (e) => {
            const b = e.target.closest('button'); if (!b) return;
            ed.focus();
            if (b.dataset.c === 'pagebreak') document.execCommand('insertHTML', false, '<div class="html2pdf__page-break" style="border-top:1px dashed #bbb;margin:12px 0"></div><p><br></p>');
            else document.execCommand(b.dataset.c);
          });
          wrap.querySelector('select').addEventListener('change', (e) => { ed.focus(); document.execCommand('formatBlock', false, e.target.value); e.target.value = 'p'; });
          getHtml = async () => ed.innerHTML;
        } else {
          const wrap = h(`<div class="split-editor"><div class="field"><span class="label">${kind === 'md' ? 'Markdown' : 'HTML'} <button class="btn sm" type="button" style="margin-left:8px">Open file…</button><input type="file" hidden accept="${kind === 'md' ? '.md,.markdown,.txt' : '.html,.htm'}"></span><textarea class="input" spellcheck="false"></textarea></div><div class="field"><span class="label">Preview</span><div class="preview-box doc-render"></div></div></div>`);
          root.appendChild(wrap);
          const ta = wrap.querySelector('textarea');
          const pv = wrap.querySelector('.preview-box');
          const fileIn = wrap.querySelector('input[type=file]');
          wrap.querySelector('button').onclick = () => fileIn.click();
          fileIn.onchange = async () => { if (fileIn.files[0]) { ta.value = await fileIn.files[0].text(); update(); } };
          ta.value = kind === 'md' ? SAMPLE_MD : SAMPLE_HTML;
          const render = async () => {
            const purify = await lib.purify();
            if (kind === 'md') { const marked = await lib.marked(); return purify.sanitize(marked.parse(ta.value)); }
            return purify.sanitize(ta.value, { ADD_TAGS: ['style'], FORCE_BODY: true, WHOLE_DOCUMENT: false });
          };
          let t;
          const update = () => {
            clearTimeout(t);
            t = setTimeout(async () => {
              try {
                const html = await render();
                if (kind === 'html') {
                  // preview inside a sandboxed iframe so pasted CSS can't affect this page
                  pv.innerHTML = '';
                  const fr = document.createElement('iframe');
                  fr.setAttribute('sandbox', '');
                  fr.style.cssText = 'width:100%;height:100%;min-height:380px;border:0;background:#fff';
                  fr.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{font-family:Georgia,serif;color:#111}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:4px 6px}</style>${html}`;
                  pv.appendChild(fr);
                } else pv.innerHTML = html;
              } catch (e) { pv.textContent = ui().friendlyError(e); }
            }, 200);
          };
          ta.addEventListener('input', update);
          update();
          getHtml = render;
        }
        const opts = renderOptions([
          { id: 'name', label: 'File name', type: 'text', default: kind === 'md' ? 'markdown.pdf' : kind === 'html' ? 'page.pdf' : 'document.pdf' },
          { id: 'format', label: 'Page size', type: 'select', default: 'a4', choices: [['a4', 'A4'], ['letter', 'US Letter'], ['legal', 'US Legal'], ['a5', 'A5']] },
          { id: 'orientation', label: 'Orientation', type: 'seg', default: 'portrait', choices: [['portrait', 'Portrait'], ['landscape', 'Landscape']] },
          { id: 'margin', label: 'Margins', type: 'seg', default: '15', choices: [['5', 'Narrow'], ['15', 'Normal'], ['25', 'Wide']] },
        ]);
        const p = h('<div class="panel" style="margin-top:16px"></div>'); p.appendChild(opts.el); root.appendChild(p);
        const actions = h('<div class="actions"><button class="btn primary big">Create PDF</button></div>');
        root.appendChild(actions);
        s.mountTail();
        const btn = actions.querySelector('button');
        btn.onclick = () => runTask({
          button: btn, progress: s.progress, resultEl: s.resultEl, errorEl: s.errorEl,
          task: async (progress) => {
            const o = opts.get();
            const html = await getHtml();
            if (!html.replace(/<[^>]*>/g, '').trim() && !/<img/i.test(html)) throw new UserError('The document is empty.');
            const blob = await util.htmlToPdfBlob(html, { format: o.format, orientation: o.orientation, margin: +o.margin, progress, fitWidth: kind === 'html' });
            const name = /\.pdf$/i.test(o.name) ? o.name : (o.name || 'document') + '.pdf';
            return { outputs: [{ name, blob }] };
          },
        });
      },
    });
  }

  editorTool({ id: 'create-pdf', title: 'Create PDF', desc: 'Write and format a document in a rich-text editor and save it as PDF.', keywords: 'new blank write document editor word processor', iconName: 'create', kind: 'rte' });
  editorTool({ id: 'markdown-to-pdf', title: 'Markdown to PDF', desc: 'Convert Markdown with tables and code blocks into a clean PDF, with live preview.', keywords: 'md readme github', iconName: 'markdown', kind: 'md' });
  editorTool({ id: 'html-to-pdf', title: 'HTML to PDF', desc: 'Paste HTML or open an .html file and convert it to PDF.', keywords: 'web page htm code', iconName: 'code', kind: 'html' });

  // ---------- spreadsheets ----------
  async function workbookToPdf(wb, opts, progress) {
    const XLSX = await lib.xlsx();
    const purify = await lib.purify();
    let html = '';
    wb.SheetNames.forEach((name, i) => {
      const ws = wb.Sheets[name];
      if (!ws['!ref']) return;
      const doc = new DOMParser().parseFromString(XLSX.utils.sheet_to_html(ws, { editable: false }), 'text/html');
      const table = doc.querySelector('table');
      if (!table) return;
      if (i > 0 && html) html += '<div class="html2pdf__page-break"></div>';
      if (wb.SheetNames.length > 1 || opts.titles) html += `<h2>${esc(name)}</h2>`;
      html += purify.sanitize(table.outerHTML);
    });
    if (!html) throw new UserError('The spreadsheet is empty.');
    return util.htmlToPdfBlob(html, { format: opts.format, orientation: opts.orientation, margin: 8, progress, fitWidth: true });
  }
  const sheetOptions = [
    { id: 'format', label: 'Page size', type: 'select', default: 'a4', choices: [['a4', 'A4'], ['letter', 'US Letter'], ['a3', 'A3']] },
    { id: 'orientation', label: 'Orientation', type: 'seg', default: 'landscape', choices: [['portrait', 'Portrait'], ['landscape', 'Landscape']] },
  ];
  App.registerTool({
    id: 'excel-to-pdf', category: 'convert', icon: 'excel',
    title: 'Excel to PDF', desc: 'Convert XLSX, XLS and ODS spreadsheets to PDF. Wide sheets are scaled to fit.',
    keywords: 'xlsx xls spreadsheet sheet ods',
    accept: '.xlsx,.xls,.xlsm,.ods', action: 'Convert to PDF', options: sheetOptions,
    async run({ file, opts, progress }) {
      const XLSX = await lib.xlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      return { outputs: [{ name: util.baseName(file.name) + '.pdf', blob: await workbookToPdf(wb, opts, progress) }] };
    },
  });
  App.registerTool({
    id: 'csv-to-pdf', category: 'convert', icon: 'table',
    title: 'CSV to PDF', desc: 'Turn CSV or TSV data into a neatly formatted PDF table.',
    keywords: 'comma separated data table tsv',
    accept: '.csv,.tsv,.txt', action: 'Convert to PDF', options: sheetOptions,
    async run({ file, opts, progress }) {
      const XLSX = await lib.xlsx();
      const text = await file.text();
      const wb = XLSX.read(text, { type: 'string', FS: /\.tsv$/i.test(file.name) ? '\t' : undefined, raw: true });
      wb.SheetNames = wb.SheetNames.slice(0, 1);
      return { outputs: [{ name: util.baseName(file.name) + '.pdf', blob: await workbookToPdf(wb, opts, progress) }] };
    },
  });

  // ---------- PDF to Excel ----------
  function linesToRows(lines) {
    const rows = lines.map((l) => {
      const cells = [];
      let cur = null;
      for (const it of l.items) {
        if (cur && it.x - (cur.x2) < Math.max(it.h, cur.h) * 0.9) { cur.text += (it.x - cur.x2 > it.h * 0.15 ? ' ' : '') + it.str; cur.x2 = it.x + it.w; }
        else { cur = { x: it.x, x2: it.x + it.w, h: it.h, text: it.str }; cells.push(cur); }
      }
      return cells.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);
    }).filter((r) => r.length);
    // cluster cell start positions into column anchors
    const xs = rows.flat().map((c) => c.x).sort((a, b) => a - b);
    const anchors = [];
    for (const x of xs) { if (!anchors.length || x - anchors[anchors.length - 1].max > 12) anchors.push({ min: x, max: x }); else anchors[anchors.length - 1].max = x; }
    return rows.map((cells) => {
      const out = new Array(anchors.length).fill('');
      for (const c of cells) {
        let col = anchors.findIndex((a) => c.x >= a.min - 6 && c.x <= a.max + 6);
        if (col < 0) col = anchors.reduce((best, a, i) => (Math.abs(a.min - c.x) < Math.abs(anchors[best].min - c.x) ? i : best), 0);
        while (out[col] && col < out.length - 1) col++;
        const num = /^-?[$€£₹]?\(?-?[\d,]+(\.\d+)?\)?%?$/.test(c.text) ? parseFloat(c.text.replace(/[$€£₹,%()]/g, '')) * (/^\(.*\)$/.test(c.text) ? -1 : 1) : NaN;
        out[col] = Number.isFinite(num) && !/^0\d/.test(c.text) ? (c.text.endsWith('%') ? num / 100 : num) : c.text;
      }
      return out;
    });
  }
  App.registerTool({
    id: 'pdf-to-excel', category: 'convert', icon: 'excel',
    title: 'PDF to Excel', desc: 'Extract tables and data from PDF pages into an XLSX spreadsheet or CSV.',
    keywords: 'xlsx spreadsheet table extract csv data',
    accept: PDF, action: 'Convert to Excel',
    note: 'Columns are detected from text positions. Works best with digitally created PDFs that contain clear tables.',
    options: [
      { id: 'layout', label: 'Sheets', type: 'seg', default: 'per', choices: [['per', 'One sheet per page'], ['one', 'All pages in one sheet']] },
      { id: 'fmt', label: 'Format', type: 'seg', default: 'xlsx', choices: [['xlsx', 'XLSX'], ['csv', 'CSV']] },
    ],
    async run({ file, opts, progress }) {
      const XLSX = await lib.xlsx();
      const pdf = await util.openPdfJs(file);
      const sheets = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        progress((i - 1) / pdf.numPages, `Analyzing page ${i}`);
        const page = await pdf.getPage(i);
        const { lines } = await util.pageLines(page);
        sheets.push(linesToRows(lines));
      }
      pdf.destroy();
      if (!sheets.flat().length) throw new UserError('No text found. For scanned PDFs, run OCR first.');
      const base = util.baseName(file.name);
      const wb = XLSX.utils.book_new();
      if (opts.layout === 'one' || opts.fmt === 'csv') XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets.flatMap((s, i) => (i ? [[], ...s] : s))), 'Data');
      else sheets.forEach((rows, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.length ? rows : [['(no text on this page)']]), `Page ${i + 1}`));
      if (opts.fmt === 'csv') {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets.Data);
        return { outputs: [{ name: base + '.csv', blob: new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }) }] };
      }
      const ab = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      return { outputs: [{ name: base + '.xlsx', blob: new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }] };
    },
  });

  // ---------- PDF to PowerPoint ----------
  App.registerTool({
    id: 'pdf-to-pptx', category: 'convert', icon: 'slides',
    title: 'PDF to PowerPoint', desc: 'Turn each PDF page into a slide in an editable PPTX presentation.',
    keywords: 'pptx ppt slides presentation keynote',
    accept: PDF, action: 'Convert to PPTX',
    options: [{ id: 'dpi', label: 'Slide image quality', type: 'select', default: '150', choices: [['100', 'Standard'], ['150', 'High'], ['220', 'Very high']] }],
    async run({ file, opts, progress }) {
      const PptxGenJS = await lib.pptx();
      const pdf = await util.openPdfJs(file);
      const pptx = new PptxGenJS();
      let w, hh;
      for (let i = 1; i <= pdf.numPages; i++) {
        progress((i - 1) / pdf.numPages, `Rendering slide ${i} of ${pdf.numPages}`);
        const c = await util.renderPage(pdf, i, { dpi: +opts.dpi });
        if (i === 1) { w = c.pdfWidth / 72; hh = c.pdfHeight / 72; pptx.defineLayout({ name: 'PDF', width: w, height: hh }); pptx.layout = 'PDF'; }
        const slide = pptx.addSlide();
        const r = Math.min(w / (c.pdfWidth / 72), hh / (c.pdfHeight / 72));
        const iw = (c.pdfWidth / 72) * r; const ih = (c.pdfHeight / 72) * r;
        slide.addImage({ data: c.toDataURL('image/jpeg', 0.88), x: (w - iw) / 2, y: (hh - ih) / 2, w: iw, h: ih });
        c.width = c.height = 0;
      }
      pdf.destroy();
      progress(0.97, 'Packaging PPTX…');
      const blob = await pptx.write({ outputType: 'blob' });
      return { outputs: [{ name: util.baseName(file.name) + '.pptx', blob }] };
    },
  });

  // ---------- PDF to HTML ----------
  App.registerTool({
    id: 'pdf-to-html', category: 'convert', icon: 'code',
    title: 'PDF to HTML', desc: 'Convert a PDF into a web page, either reflowed text or a faithful visual copy.',
    keywords: 'web page htm website',
    accept: PDF, action: 'Convert to HTML',
    options: [{ id: 'mode', label: 'Mode', type: 'seg', default: 'text', full: true, choices: [['text', 'Reflowed text (semantic)'], ['visual', 'Visual copy (images + selectable text)']] }],
    async run({ file, opts, progress }) {
      const base = util.baseName(file.name);
      let body = '';
      if (opts.mode === 'text') {
        const { pages, hasText } = await util.pdfParagraphs(file, progress);
        if (!hasText) throw new UserError('No text found. Try "Visual copy" mode, or run OCR first.');
        body = pages.map((paras, i) => `<section id="page-${i + 1}">\n${paras.map((p) => (p.heading ? `<h2>${esc(p.text)}</h2>` : `<p>${esc(p.text)}</p>`)).join('\n')}\n</section>`).join('\n<hr>\n');
        body = `<main style="max-width:760px;margin:40px auto;padding:0 16px;font:17px/1.65 Georgia,serif;color:#111">${body}</main>`;
      } else {
        const pdf = await util.openPdfJs(file);
        const S = 1.5;
        for (let i = 1; i <= pdf.numPages; i++) {
          progress((i - 1) / pdf.numPages, `Converting page ${i}`);
          const c = await util.renderPage(pdf, i, { scale: S * 1.5 });
          const page = await pdf.getPage(i);
          const { lines, width, height } = await util.pageLines(page);
          const spans = lines.flatMap((l) => l.items).map((it) => `<span style="left:${(it.x * S).toFixed(1)}px;top:${((it.y - it.h * 0.85) * S).toFixed(1)}px;font-size:${(it.h * S).toFixed(1)}px">${esc(it.str)}</span>`).join('');
          body += `<div class="pg" style="width:${width * S}px;height:${height * S}px;background-image:url(${c.toDataURL('image/jpeg', 0.85)})">${spans}</div>\n`;
          c.width = c.height = 0;
        }
        pdf.destroy();
        body = `<style>body{background:#888;margin:0;padding:20px 0}.pg{position:relative;margin:0 auto 20px;background-size:100% 100%;box-shadow:0 2px 10px rgba(0,0,0,.4)}.pg span{position:absolute;color:transparent;white-space:pre;font-family:sans-serif;line-height:1}.pg span::selection{background:rgba(0,100,255,.3)}</style>${body}`;
      }
      const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(base)}</title></head><body>\n${body}\n</body></html>`;
      return { outputs: [{ name: base + '.html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }) }] };
    },
  });

  // ---------- PDF to EPUB ----------
  App.registerTool({
    id: 'pdf-to-epub', category: 'convert', icon: 'book',
    title: 'PDF to EPUB', desc: 'Create a reflowable eBook from a text-based PDF for Kindle, Apple Books and more.',
    keywords: 'ebook kindle kobo reader reflow',
    accept: PDF, action: 'Convert to EPUB',
    options: [
      { id: 'title', label: 'Book title', type: 'text', default: '', placeholder: 'Uses the file name if empty' },
      { id: 'author', label: 'Author', type: 'text', default: '' },
    ],
    async run({ file, opts, progress }) {
      const JSZip = await lib.jszip();
      const { pages, hasText } = await util.pdfParagraphs(file, progress);
      if (!hasText) throw new UserError('No text found. For scanned PDFs, run OCR first.');
      const title = opts.title.trim() || util.baseName(file.name);
      const uid = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : Date.now());
      const x = (s) => esc(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
      // group pages into chapters that start at headings
      const chapters = [];
      pages.forEach((paras) => paras.forEach((p) => {
        if (p.heading || !chapters.length) chapters.push({ title: p.heading ? p.text : title, html: p.heading ? `<h2>${x(p.text)}</h2>` : `<p>${x(p.text)}</p>` });
        else chapters[chapters.length - 1].html += `<p>${x(p.text)}</p>`;
      }));
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
      const xhtml = (t, b) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${x(t)}</title><style>body{font-family:serif;line-height:1.5}h2{font-family:sans-serif}</style></head><body>${b}</body></html>`;
      chapters.forEach((c, i) => zip.file(`OEBPS/ch${i + 1}.xhtml`, xhtml(c.title, c.html)));
      zip.file('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol>${chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${x(c.title.slice(0, 80))}</a></li>`).join('')}</ol></nav>`));
      const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${x(title)}</dc:title><dc:language>en</dc:language>${opts.author ? `<dc:creator>${x(opts.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((c, i) => `<item id="c${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((c, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`);
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
      return { outputs: [{ name: util.baseName(file.name) + '.epub', blob }], message: `${chapters.length} chapter${chapters.length > 1 ? 's' : ''} created.` };
    },
  });

  // ---------- EPUB to PDF ----------
  App.registerTool({
    id: 'ebook-to-pdf', category: 'convert', icon: 'book',
    title: 'eBook to PDF', desc: 'Convert DRM-free EPUB eBooks to PDF, including images.',
    keywords: 'epub book kindle reader',
    accept: '.epub', action: 'Convert to PDF',
    note: 'Only DRM-free EPUB files are supported. Long books can take a few minutes.',
    options: [{ id: 'format', label: 'Page size', type: 'select', default: 'a5', choices: [['a5', 'A5 (book)'], ['a4', 'A4'], ['letter', 'US Letter']] }],
    async run({ file, opts, progress }) {
      const JSZip = await lib.jszip();
      const purify = await lib.purify();
      const zip = await JSZip.loadAsync(file);
      const read = (p) => { const f = zip.file(decodeURIComponent(p)) || zip.file(p); return f ? f.async('string') : null; };
      const container = await read('META-INF/container.xml');
      if (!container) throw new UserError("This doesn't look like a valid EPUB file.");
      const opfPath = new DOMParser().parseFromString(container, 'application/xml').querySelector('rootfile').getAttribute('full-path');
      const opfDir = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
      const opf = new DOMParser().parseFromString(await read(opfPath), 'application/xml');
      if (opf.querySelector('encryption') || zip.file('META-INF/encryption.xml')) throw new UserError('This eBook is DRM-protected and can\'t be converted.');
      const manifest = {};
      opf.querySelectorAll('manifest > item').forEach((it) => { manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') }; });
      const spine = [...opf.querySelectorAll('spine > itemref')].map((r) => manifest[r.getAttribute('idref')]).filter((m) => m && /html/.test(m.type));
      const resolve = (base, rel) => { const parts = (base.replace(/[^/]*$/, '') + rel).split('/'); const out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); } return out.join('/'); };
      let html = '';
      for (let i = 0; i < spine.length; i++) {
        progress((i / spine.length) * 0.3, `Reading chapter ${i + 1} of ${spine.length}`);
        const path = opfDir + spine[i].href;
        const src = await read(path);
        if (!src) continue;
        let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
        if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(src, 'text/html');
        const body = doc.body || doc.querySelector('body');
        if (!body) continue;
        for (const img of body.querySelectorAll('img, image')) {
          const attr = img.tagName.toLowerCase() === 'img' ? 'src' : (img.getAttribute('href') ? 'href' : 'xlink:href');
          const ref = img.getAttribute(attr) || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          if (!ref || /^data:/.test(ref)) continue;
          const f = zip.file(resolve(path, ref.split('#')[0]));
          if (!f) continue;
          const b64 = await f.async('base64');
          const mime = /\.png$/i.test(ref) ? 'image/png' : /\.gif$/i.test(ref) ? 'image/gif' : /\.svg$/i.test(ref) ? 'image/svg+xml' : 'image/jpeg';
          if (img.tagName.toLowerCase() === 'img') img.setAttribute('src', `data:${mime};base64,${b64}`);
          else { const ni = doc.createElement('img'); ni.setAttribute('src', `data:${mime};base64,${b64}`); (img.closest('svg') || img).replaceWith(ni); }
        }
        if (html) html += '<div class="html2pdf__page-break"></div>';
        html += purify.sanitize(body.innerHTML, { FORBID_TAGS: ['style', 'link'] });
      }
      if (!html) throw new UserError('No readable chapters were found in this EPUB.');
      const blob = await util.htmlToPdfBlob(html, { format: opts.format, margin: 14, progress: (p, m) => progress(p === null ? null : 0.3 + p * 0.7, m) });
      return { outputs: [{ name: util.baseName(file.name) + '.pdf', blob }] };
    },
  });

  // ---------- PDF to ZIP ----------
  App.registerTool({
    id: 'pdf-to-zip', category: 'convert', icon: 'zip',
    title: 'PDF to ZIP', desc: 'Export every page as an image and bundle them in a single ZIP archive.',
    keywords: 'archive images bundle export pages',
    accept: PDF, action: 'Create ZIP', options: App.pdfImageOptions,
    async run(args) {
      const { outputs, base, count } = await util.pdfToImages(args);
      args.progress(0.98, 'Compressing…');
      return { outputs: [{ name: base + '-pages.zip', blob: await util.zipOutputs(outputs) }], message: `${count} page image${count > 1 ? 's' : ''} in one archive.` };
    },
  });

  // ---------- Invert / recolor ----------
  function colorMatrix(mode) {
    switch (mode) {
      case 'sepia': return [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
      case 'gray': return [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722];
      default: return null;
    }
  }
  App.registerTool({
    id: 'invert-pdf', category: 'convert', icon: 'contrast',
    title: 'Invert PDF Colours', desc: 'Make a dark-mode, inverted, sepia or grayscale copy for comfortable reading or printing.',
    keywords: 'dark mode night negative grayscale black and white sepia recolor',
    accept: PDF, action: 'Convert colors',
    options: [
      { id: 'mode', label: 'Style', type: 'seg', default: 'dark', full: true, choices: [['dark', 'Dark mode'], ['invert', 'Invert'], ['sepia', 'Sepia'], ['gray', 'Grayscale']] },
      { id: 'dpi', label: 'Quality', type: 'select', default: '150', choices: [['100', '100 DPI'], ['150', '150 DPI'], ['200', '200 DPI'], ['300', '300 DPI']] },
    ],
    async run({ file, opts, progress }) {
      const mode = opts.mode;
      const M = colorMatrix(mode);
      // invert + hue-rotate(180deg) keeps hues recognisable in dark mode
      const H = [-0.574, 1.43, 0.144, 0.426, 0.43, 0.144, 0.426, 1.43, -0.856];
      const doc = await util.rasterizePdf(file, {
        dpi: +opts.dpi, quality: 0.85, progress,
        transform(c) {
          const ctx = c.getContext('2d');
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            let r = d[i], g = d[i + 1], b = d[i + 2];
            if (mode === 'invert' || mode === 'dark') { r = 255 - r; g = 255 - g; b = 255 - b; }
            if (mode === 'dark') {
              const nr = H[0] * r + H[1] * g + H[2] * b, ng = H[3] * r + H[4] * g + H[5] * b, nb = H[6] * r + H[7] * g + H[8] * b;
              r = nr * 0.86 + 22; g = ng * 0.86 + 22; b = nb * 0.86 + 24; // soften pure black / white
            } else if (M) {
              const nr = M[0] * r + M[1] * g + M[2] * b, ng = M[3] * r + M[4] * g + M[5] * b, nb = M[6] * r + M[7] * g + M[8] * b;
              r = nr; g = ng; b = nb;
            }
            d[i] = r; d[i + 1] = g; d[i + 2] = b; // Uint8ClampedArray clamps automatically
          }
          ctx.putImageData(img, 0, 0);
          return c;
        },
      });
      return { outputs: [{ name: `${util.baseName(file.name)}-${mode}.pdf`, blob: util.pdfBlob(await doc.save()) }] };
    },
  });

  // ---------- PDF to audio (text to speech) ----------
  App.registerTool({
    id: 'pdf-to-audio', category: 'convert', icon: 'audio',
    title: 'PDF to Audio', desc: 'Listen to any PDF read aloud, with sentence highlighting and adjustable speed.',
    keywords: 'text to speech tts read aloud listen voice',
    privacy: 'Text is read aloud with your device\'s built-in voices. Nothing is uploaded.',
    mount(root, { tool }) {
      const { h, createDropzone, toast } = ui();
      const s = App.toolkit.scaffold(root);
      if (!('speechSynthesis' in window)) { root.appendChild(h('<div class="error-box">Your browser doesn\'t support text-to-speech.</div>')); return; }
      const dz = createDropzone({ accept: PDF, onFiles: ([f]) => { dz.el.remove(); start(f); } });
      root.appendChild(dz.el);
      s.mountTail();
      async function start(file) {
        s.progress.set(null, 'Extracting text…');
        let pages;
        try { pages = await util.extractText(file, (p, m) => s.progress.set(p, m)); } catch (e) { s.progress.hide(); s.errorEl.textContent = ui().friendlyError(e); s.errorEl.classList.remove('hidden'); return; }
        s.progress.hide();
        const text = pages.join('\n\n').replace(/[ \t]+/g, ' ');
        if (!text.trim()) { s.errorEl.textContent = 'No text found. For scanned PDFs, run OCR first.'; s.errorEl.classList.remove('hidden'); return; }
        const sentences = text.replace(/\n(?!\n)/g, ' ').match(/[^.!?\n]+[.!?]*[\s\n]*|\n+/g).filter((x) => x.trim());
        const panel = h(`<div class="panel">
            <div class="toolbar">
              <button class="btn primary" data-a="play">${icon('play')} Play</button>
              <button class="btn" data-a="pause">${icon('pause')} Pause</button>
              <button class="btn" data-a="stop">${icon('stop')} Stop</button>
              <span class="spacer"></span>
              <select class="input" style="width:auto;max-width:240px" aria-label="Voice"></select>
              <label class="small" style="display:flex;align-items:center;gap:6px">Speed <input type="range" min="0.5" max="2" step="0.1" value="1" style="width:100px"> <output>1.0×</output></label>
            </div>
            <div class="reader"></div>
            <p class="small muted" style="margin-top:8px">Click any sentence to start reading from there.</p>
          </div>`);
        root.insertBefore(panel, s.errorEl);
        const reader = panel.querySelector('.reader');
        sentences.forEach((t, i) => { const sp = document.createElement('span'); sp.textContent = t; sp.dataset.i = i; reader.appendChild(sp); });
        const voiceSel = panel.querySelector('select');
        const rate = panel.querySelector('input[type=range]');
        const out = panel.querySelector('output');
        rate.oninput = () => { out.textContent = (+rate.value).toFixed(1) + '×'; };
        const fillVoices = () => {
          const vs = speechSynthesis.getVoices();
          voiceSel.innerHTML = vs.map((v, i) => `<option value="${i}" ${v.default ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
        };
        fillVoices();
        speechSynthesis.onvoiceschanged = fillVoices;
        let idx = 0; let playing = false;
        const mark = (i) => { reader.querySelectorAll('mark').forEach((m) => m.replaceWith(...m.childNodes)); const sp = reader.querySelector(`[data-i="${i}"]`); if (sp) { const m = document.createElement('mark'); sp.replaceWith(m); m.appendChild(sp); m.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
        const speakNext = () => {
          if (!playing || idx >= sentences.length) { playing = false; return; }
          const u = new SpeechSynthesisUtterance(sentences[idx]);
          const v = speechSynthesis.getVoices()[+voiceSel.value];
          if (v) u.voice = v;
          u.rate = +rate.value;
          mark(idx);
          u.onend = () => { if (playing) { idx++; speakNext(); } };
          u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') { playing = false; toast('Speech error: ' + e.error); } };
          speechSynthesis.speak(u);
        };
        panel.querySelector('.toolbar').addEventListener('click', (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.a === 'play') {
            if (speechSynthesis.paused) { speechSynthesis.resume(); return; }
            if (!playing) { playing = true; speakNext(); }
          }
          if (b.dataset.a === 'pause') speechSynthesis.pause();
          if (b.dataset.a === 'stop') { playing = false; speechSynthesis.cancel(); idx = 0; mark(-1); }
        });
        reader.addEventListener('click', (e) => {
          const sp = e.target.closest('[data-i]'); if (!sp) return;
          playing = false; speechSynthesis.cancel();
          idx = +sp.dataset.i;
          setTimeout(() => { playing = true; speakNext(); }, 60);
        });
        window.addEventListener('hashchange', () => { playing = false; speechSynthesis.cancel(); }, { once: true });
      }
    },
  });
})(window.App);
