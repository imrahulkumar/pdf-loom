/* Essentials: merge, split, compress, PDF→images, Word↔PDF, images→PDF */
(function (App) {
  'use strict';
  const { util, lib, UserError } = App;
  const PDF = '.pdf,application/pdf';

  // ---------------- Merge ----------------
  App.registerTool({
    id: 'merge-pdf', category: 'essentials', icon: 'merge',
    title: 'Merge PDF', desc: 'Combine multiple PDFs into one file. Drag to set the order.',
    keywords: 'combine join append',
    accept: PDF, multiple: true, reorder: true, minFiles: 2, action: 'Merge PDFs',
    options: [
      { id: 'name', label: 'Output file name', type: 'text', default: 'merged.pdf' },
      { id: 'blank', label: 'Blank page', type: 'checkbox', text: 'Insert a blank page after odd-length documents (for duplex printing)' },
    ],
    async run({ files, opts, progress }) {
      const { PDFDocument } = await lib.pdflib();
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, `Adding ${files[i].name}`);
        const src = await util.loadPdf(files[i]);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        if (opts.blank && pages.length % 2 === 1 && i < files.length - 1) {
          const last = pages[pages.length - 1].getSize();
          out.addPage([last.width, last.height]);
        }
      }
      progress(0.95, 'Saving…');
      const bytes = await out.save();
      const name = /\.pdf$/i.test(opts.name) ? opts.name : (opts.name || 'merged') + '.pdf';
      return { outputs: [{ name, blob: util.pdfBlob(bytes) }], message: `Merged ${files.length} files into ${out.getPageCount()} pages.` };
    },
  });

  // ---------------- Split ----------------
  App.registerTool({
    id: 'split-pdf', category: 'essentials', icon: 'split',
    title: 'Split PDF', desc: 'Split by page ranges, every page, or every N pages. Extract or remove pages.',
    keywords: 'extract separate pages remove delete',
    accept: PDF, action: 'Split PDF',
    options: [
      { id: 'mode', label: 'Mode', type: 'seg', default: 'ranges', full: true, choices: [['ranges', 'Custom ranges'], ['every', 'Every page'], ['chunk', 'Every N pages'], ['extract', 'Extract pages'], ['remove', 'Remove pages']] },
      { id: 'ranges', label: 'Page ranges', type: 'text', default: '1-2, 3-', hint: 'Each range becomes a separate PDF. Example: 1-3, 4, 5-', showIf: (v) => v.mode === 'ranges' },
      { id: 'pages', label: 'Pages', type: 'text', default: '1, 3-5', hint: 'Example: 1, 3-5, 8', showIf: (v) => v.mode === 'extract' || v.mode === 'remove' },
      { id: 'n', label: 'Pages per file', type: 'number', default: 2, min: 1, showIf: (v) => v.mode === 'chunk' },
    ],
    async run({ file, opts, progress }) {
      const src = await util.loadPdf(file);
      const total = src.getPageCount();
      const base = util.baseName(file.name);
      let groups;
      if (opts.mode === 'every') groups = src.getPageIndices().map((i) => [i]);
      else if (opts.mode === 'chunk') {
        const n = Math.max(1, Math.floor(opts.n || 1));
        groups = [];
        for (let i = 0; i < total; i += n) groups.push(src.getPageIndices().slice(i, i + n));
      } else if (opts.mode === 'extract') {
        const g = util.parseRanges(opts.pages, total);
        if (!g) throw new UserError('Enter the pages to extract.');
        groups = [g.flat()];
      } else if (opts.mode === 'remove') {
        const set = util.parsePageSet(opts.pages, total);
        if (!set) throw new UserError('Enter the pages to remove.');
        const keep = src.getPageIndices().filter((i) => !set.has(i));
        if (!keep.length) throw new UserError("You can't remove every page.");
        groups = [keep];
      } else {
        groups = util.parseRanges(opts.ranges, total);
        if (!groups) throw new UserError('Enter at least one page range.');
      }
      const outputs = [];
      for (let k = 0; k < groups.length; k++) {
        progress(k / groups.length, `Creating file ${k + 1} of ${groups.length}`);
        const doc = await util.copyToNewDoc(src, groups[k]);
        const g = groups[k];
        const label = opts.mode === 'remove' ? 'edited' : opts.mode === 'extract' ? 'extracted' : g.length === 1 ? `page-${g[0] + 1}` : `pages-${g[0] + 1}-${g[g.length - 1] + 1}`;
        outputs.push({ name: `${base}-${label}.pdf`, blob: util.pdfBlob(await doc.save()) });
      }
      return { outputs, zipName: `${base}-split.zip`, message: `${outputs.length} file${outputs.length > 1 ? 's' : ''} created from ${total} pages.` };
    },
  });

  // ---------------- Compress ----------------
  const LEVELS = {
    light: { quality: 0.8, maxDim: 3000, dpi: 150 },
    balanced: { quality: 0.62, maxDim: 2000, dpi: 120 },
    strong: { quality: 0.42, maxDim: 1300, dpi: 90 },
  };

  /** Re-encode embedded JPEG images in place. Keeps text and vectors intact. */
  async function recompressImages(doc, { quality, maxDim }, progress) {
    const { PDFName, PDFRawStream, PDFNumber, PDFArray } = await lib.pdflib();
    const N = (n) => PDFName.of(n);
    const ctx = doc.context;
    const images = ctx.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(N('Subtype')) === N('Image'));
    let changed = 0;
    for (let k = 0; k < images.length; k++) {
      const [ref, obj] = images[k];
      if (k % 3 === 0) progress(0.1 + 0.75 * (k / images.length), `Optimizing image ${k + 1} of ${images.length}`);
      const d = obj.dict;
      let filter = ctx.lookup(d.get(N('Filter')));
      if (filter instanceof PDFArray) filter = filter.size() === 1 ? ctx.lookup(filter.get(0)) : null;
      if (filter !== N('DCTDecode')) continue;
      if (d.get(N('Decode')) || d.get(N('ImageMask'))) continue;
      const cs = ctx.lookup(d.get(N('ColorSpace')));
      let rgb = cs === N('DeviceRGB');
      if (cs instanceof PDFArray && ctx.lookup(cs.get(0)) === N('ICCBased')) {
        const icc = ctx.lookup(cs.get(1));
        const n = icc && icc.dict && ctx.lookup(icc.dict.get(N('N')));
        rgb = n && n.asNumber && n.asNumber() === 3;
      }
      if (!rgb) continue; // leave gray, CMYK and special color spaces alone
      const src = obj.contents;
      if (src.length < 8000) continue;
      let bmp;
      try { bmp = await createImageBitmap(new Blob([src], { type: 'image/jpeg' })); } catch { continue; }
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const nw = Math.max(1, Math.round(bmp.width * scale));
      const nh = Math.max(1, Math.round(bmp.height * scale));
      const c = document.createElement('canvas');
      c.width = nw; c.height = nh;
      c.getContext('2d').drawImage(bmp, 0, 0, nw, nh);
      bmp.close && bmp.close();
      const blob = await util.canvasToBlob(c, 'image/jpeg', quality);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      c.width = c.height = 0;
      if (bytes.length >= src.length * 0.92) continue;
      const nd = d.clone(ctx);
      nd.set(N('Width'), PDFNumber.of(nw));
      nd.set(N('Height'), PDFNumber.of(nh));
      nd.set(N('ColorSpace'), N('DeviceRGB'));
      nd.set(N('BitsPerComponent'), PDFNumber.of(8));
      nd.set(N('Filter'), N('DCTDecode'));
      nd.delete(N('DecodeParms'));
      ctx.assign(ref, PDFRawStream.of(nd, bytes));
      changed++;
    }
    return { changed, total: images.length };
  }

  App.registerTool({
    id: 'compress-pdf', category: 'essentials', icon: 'compress',
    title: 'Compress PDF', desc: 'Reduce file size while keeping the best quality possible.',
    keywords: 'reduce shrink smaller optimize size',
    accept: PDF, multiple: true, action: 'Compress PDF',
    options: [
      { id: 'level', label: 'Compression level', type: 'seg', default: 'balanced', full: true, choices: [['light', 'Light (best quality)'], ['balanced', 'Balanced'], ['strong', 'Strong (smallest)']] },
      { id: 'raster', label: 'Maximum', type: 'checkbox', text: 'Maximum compression: convert pages to images (text will no longer be selectable)' },
    ],
    async run({ files, opts, progress }) {
      const L = LEVELS[opts.level] || LEVELS.balanced;
      const outputs = [];
      const notes = [];
      for (let f = 0; f < files.length; f++) {
        const file = files[f];
        const step = (p, m) => progress((f + p) / files.length, (files.length > 1 ? `[${f + 1}/${files.length}] ` : '') + m);
        let best = await util.readBytes(file);
        const original = best.length;
        step(0.05, 'Analyzing…');
        const doc = await util.loadPdf(file);
        await recompressImages(doc, L, step);
        step(0.88, 'Rebuilding file…');
        const a = await doc.save({ useObjectStreams: true });
        if (a.length < best.length) best = a;
        if (opts.raster) {
          const r = await util.rasterizePdf(file, { dpi: L.dpi, quality: L.quality, progress: (p, m) => step(0.3 + p * 0.6, m) });
          const b = await r.save({ useObjectStreams: true });
          if (b.length < best.length) best = b;
        }
        const pct = Math.round((1 - best.length / original) * 100);
        notes.push(pct > 0 ? `${file.name}: ${util.formatBytes(original)} → ${util.formatBytes(best.length)} (−${pct}%)` : `${file.name}: already well optimized`);
        outputs.push({ name: util.baseName(file.name) + '-compressed.pdf', blob: util.pdfBlob(best) });
      }
      return { outputs, zipName: 'compressed.zip', message: notes.join(' · ') };
    },
  });

  // ---------------- PDF to images ----------------
  async function pdfToImages({ file, opts, progress }) {
    const pdf = await util.openPdfJs(file);
    const set = util.parsePageSet(opts.pages, pdf.numPages);
    const list = Array.from({ length: pdf.numPages }, (_, i) => i).filter((i) => !set || set.has(i));
    const type = opts.format === 'png' ? 'image/png' : opts.format === 'webp' ? 'image/webp' : 'image/jpeg';
    const extn = opts.format === 'png' ? 'png' : opts.format === 'webp' ? 'webp' : 'jpg';
    const base = util.baseName(file.name);
    const outputs = [];
    for (let k = 0; k < list.length; k++) {
      progress(k / list.length, `Rendering page ${list[k] + 1} (${k + 1} of ${list.length})`);
      const c = await util.renderPage(pdf, list[k] + 1, { dpi: +opts.dpi || 150 });
      const blob = await util.canvasToBlob(c, type, (opts.quality || 90) / 100);
      c.width = c.height = 0;
      outputs.push({ name: `${base}-page-${String(list[k] + 1).padStart(String(pdf.numPages).length, '0')}.${extn}`, blob });
    }
    pdf.destroy();
    return { outputs, base, count: list.length };
  }
  App.util.pdfToImages = pdfToImages;
  const imageOptions = [
    { id: 'format', label: 'Format', type: 'seg', default: 'jpg', choices: [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']] },
    { id: 'dpi', label: 'Resolution', type: 'select', default: '150', choices: [['72', '72 DPI (screen)'], ['150', '150 DPI (standard)'], ['300', '300 DPI (print)'], ['600', '600 DPI (maximum)']] },
    { id: 'quality', label: 'Quality', type: 'range', min: 40, max: 100, default: 90, unit: '%', showIf: (v) => v.format !== 'png' },
    { id: 'pages', label: 'Pages', type: 'text', default: '', placeholder: 'All pages', hint: 'Leave empty for all pages, or e.g. 1-3, 7' },
  ];
  App.pdfImageOptions = imageOptions;

  App.registerTool({
    id: 'pdf-to-jpg', category: 'essentials', icon: 'image',
    title: 'PDF to JPG', desc: 'Turn every page into a high-quality JPG, PNG or WebP image, up to 600 DPI.',
    keywords: 'png image picture export convert webp',
    accept: PDF, action: 'Convert to images', options: imageOptions,
    async run(args) {
      const { outputs, base, count } = await pdfToImages(args);
      return { outputs, zipName: `${base}-images.zip`, message: `${count} image${count > 1 ? 's' : ''} created.` };
    },
  });

  // ---------------- Images to PDF ----------------
  function jpegOrientation(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return 1;
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off); off += 2;
      if (marker === 0xFFE1) {
        if (v.getUint32(off + 2) !== 0x45786966) return 1;
        const tiff = off + 8;
        const little = v.getUint16(tiff) === 0x4949;
        const ifd = tiff + v.getUint32(tiff + 4, little);
        const n = v.getUint16(ifd, little);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little);
        }
        return 1;
      }
      if ((marker & 0xFF00) !== 0xFF00) break;
      off += v.getUint16(off);
    }
    return 1;
  }

  /** Embed any browser-decodable image, preserving original bytes for plain JPG/PNG. */
  async function embedImage(doc, file) {
    const bytes = await util.readBytes(file);
    const type = file.type || '';
    try {
      if (type === 'image/png' || /\.png$/i.test(file.name)) return await doc.embedPng(bytes);
      if ((type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) && jpegOrientation(bytes) === 1) return await doc.embedJpg(bytes);
    } catch { /* fall through to canvas re-encode */ }
    let bmp;
    try { bmp = await createImageBitmap(new Blob([bytes], { type })); } catch { throw new UserError(`"${file.name}" couldn't be read as an image.`); }
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    const blob = await util.canvasToBlob(c, 'image/jpeg', 0.92);
    return doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  }
  App.util.embedImage = embedImage;

  const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };
  App.PAGE_SIZES = SIZES;

  async function imagesToPdf(files, opts, progress) {
    const { PDFDocument } = await lib.pdflib();
    const doc = await PDFDocument.create();
    const margin = +opts.margin || 0;
    for (let i = 0; i < files.length; i++) {
      progress(i / files.length, `Adding image ${i + 1} of ${files.length}`);
      const img = await embedImage(doc, files[i]);
      let pw, ph;
      if (opts.size === 'fit') { pw = img.width * 0.75 + margin * 2; ph = img.height * 0.75 + margin * 2; }
      else {
        [pw, ph] = SIZES[opts.size] || SIZES.a4;
        const landscape = opts.orient === 'landscape' || (opts.orient === 'auto' && img.width > img.height);
        if (landscape) [pw, ph] = [ph, pw];
      }
      const page = doc.addPage([pw, ph]);
      const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
      const w = img.width * s; const h = img.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    return doc;
  }
  App.util.imagesToPdf = imagesToPdf;

  App.registerTool({
    id: 'images-to-pdf', category: 'essentials', icon: 'images',
    title: 'Images to PDF', desc: 'Convert JPG, PNG, WebP and other images into a single PDF.',
    keywords: 'jpg to pdf png photo picture convert',
    accept: 'image/*', multiple: true, reorder: true, action: 'Create PDF',
    options: [
      { id: 'size', label: 'Page size', type: 'select', default: 'a4', choices: [['fit', 'Fit to image'], ['a4', 'A4'], ['letter', 'US Letter'], ['legal', 'US Legal'], ['a3', 'A3'], ['a5', 'A5']] },
      { id: 'orient', label: 'Orientation', type: 'seg', default: 'auto', choices: [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], showIf: (v) => v.size !== 'fit' },
      { id: 'margin', label: 'Margin', type: 'seg', default: '0', choices: [['0', 'None'], ['18', 'Small'], ['40', 'Large']] },
    ],
    async run({ files, opts, progress }) {
      const doc = await imagesToPdf(files, opts, progress);
      return { outputs: [{ name: files.length === 1 ? util.baseName(files[0].name) + '.pdf' : 'images.pdf', blob: util.pdfBlob(await doc.save()) }], message: `${files.length} image${files.length > 1 ? 's' : ''} converted.` };
    },
  });

  // ---------------- Word to PDF ----------------
  App.registerTool({
    id: 'word-to-pdf', category: 'essentials', icon: 'word',
    title: 'Word to PDF', desc: 'Convert DOCX documents to PDF, including images and tables.',
    keywords: 'docx doc microsoft office convert',
    accept: '.docx', action: 'Convert to PDF',
    note: 'Layout is approximated: fonts and complex formatting may differ from Word. Legacy .doc files aren\'t supported; save them as .docx first.',
    options: [
      { id: 'format', label: 'Page size', type: 'select', default: 'a4', choices: [['a4', 'A4'], ['letter', 'US Letter']] },
    ],
    async run({ file, opts, progress }) {
      const mammoth = await lib.mammoth();
      progress(null, 'Reading document…');
      const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      if (!res.value.trim()) throw new UserError('This document appears to be empty.');
      const blob = await util.htmlToPdfBlob(res.value, { format: opts.format, progress });
      return { outputs: [{ name: util.baseName(file.name) + '.pdf', blob }] };
    },
  });

  // ---------------- PDF to Word ----------------
  function xmlEsc(s) {
    return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  async function buildDocx(pages) {
    const JSZip = await lib.jszip();
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    let body = '';
    pages.forEach((paras, i) => {
      for (const p of paras) {
        const rpr = p.heading ? `<w:rPr><w:b/><w:sz w:val="${Math.min(48, Math.round(p.size * 2))}"/></w:rPr>` : '';
        body += `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
      }
      if (i < pages.length - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    });
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  App.registerTool({
    id: 'pdf-to-word', category: 'essentials', icon: 'filetext',
    title: 'PDF to Word', desc: 'Convert PDF text into an editable DOCX document.',
    keywords: 'docx doc editable convert microsoft office',
    accept: PDF, action: 'Convert to Word',
    note: 'Text and headings are rebuilt into editable paragraphs. Complex layouts and images aren\'t carried over. For scanned PDFs, run OCR first.',
    async run({ file, progress }) {
      const { pages, hasText } = await util.pdfParagraphs(file, progress);
      if (!hasText) throw new UserError('No text was found. This looks like a scanned PDF. Run "OCR PDF" first to make it searchable.');
      progress(0.95, 'Building DOCX…');
      return { outputs: [{ name: util.baseName(file.name) + '.docx', blob: await buildDocx(pages) }] };
    },
  });
})(window.App);
