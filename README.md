# PDFLoom

39 free PDF tools that run entirely in the browser. Files are never uploaded. There's no backend and no build step: it's plain HTML, CSS and JavaScript, with libraries lazy-loaded from CDNs and cached for offline use.

## Run it

```bash
python3 -m http.server 8080     # or: npm start
# open http://localhost:8080
```

Any static file host works for deployment: Netlify, Vercel, GitHub Pages, Cloudflare Pages, S3, or nginx. Serve over HTTPS so the camera (Scan to PDF) and offline caching work.

## Tools

| Category | Tools |
|---|---|
| Essentials | Merge, Split (ranges / every page / every N / extract / remove), Compress, PDF→JPG/PNG/WebP, Images→PDF, Word→PDF, PDF→Word |
| Edit & Organize | Edit PDF (add text, white-out), Organize pages (reorder, rotate, delete, duplicate, blank pages, combine files), Rotate, Crop & Resize, Watermark (text/image, tiled), Page numbers, Headers & footers, Extract text, OCR (searchable PDF) |
| Security & Privacy | Protect (AES-256 + permissions), Remove password, Redact (search & mark, true removal), Flatten, Privacy scanner (metadata/XMP/GPS/JS/attachments/revisions → clean copy), Fingerprint (per-recipient invisible IDs + detection) |
| Convert & Export | Create PDF (rich-text editor), Markdown→PDF, HTML→PDF, Excel→PDF, CSV→PDF, PDF→Excel/CSV, PDF→PowerPoint, PDF→HTML, PDF→EPUB, EPUB→PDF, PDF→ZIP, Invert colours (dark/invert/sepia/gray), PDF→Audio (read aloud) |
| Smart tools | Summarizer (extractive, on-device), Compare PDFs (visual + text diff), Repair PDF |
| Scan | Scan to PDF (camera or photos, auto-crop, document enhancement) |

## How it works

```
index.html            app shell
css/styles.css        design tokens (light + dark), all styles
js/lib.js             CDN loader, PDF I/O, rendering, text extraction, HTML→PDF, helpers
js/ui.js              tool registry, home page, generic tool workflow, widgets
js/viewer.js          page editor overlay (used by Edit and Redact)
js/tools/*.js         the tools, grouped by category
js/app.js             hash router, theme toggle, service worker registration
sw.js                 offline cache
```

Engines: [`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib), a pdf-lib fork with encryption, for editing and writing. [PDF.js](https://mozilla.github.io/pdf.js/) for rendering and text. [Tesseract.js](https://tesseract.projectnaptha.com/) for OCR. Plus JSZip, html2pdf.js, mammoth, SheetJS, PptxGenJS, marked, DOMPurify and SortableJS.

### Adding a tool

Simple tools are declarative. The generic workflow builds the drop zone, file list, options form, progress bar and download UI:

```js
App.registerTool({
  id: 'my-tool', category: 'edit', icon: 'edit',
  title: 'My Tool', desc: 'One-line description.',
  accept: '.pdf,application/pdf', multiple: false, action: 'Run',
  options: [{ id: 'level', label: 'Level', type: 'seg', default: 'a', choices: [['a', 'A'], ['b', 'B']] }],
  async run({ file, files, opts, progress }) {
    const doc = await App.util.loadPdf(file);
    // ...
    return { outputs: [{ name: 'out.pdf', blob: App.util.pdfBlob(await doc.save()) }] };
  },
});
```

Interactive tools implement `mount(root)` instead.

## Known limits

- **Word / Excel / HTML / EPUB → PDF** render through html2canvas. Output pages are images, so text isn't selectable, and complex Word layouts are approximated. Legacy `.doc`, `.ppt` and PowerPoint→PDF aren't supported.
- **PDF → Word / EPUB / HTML / Excel** rebuild text from positions. Images and complex layouts aren't carried over.
- **Redact, Flatten (everything), Invert, and Compress' "maximum" mode** rasterize pages. That's intentional: it's what makes redaction irreversible.
- **Remove password** needs the password, or works on files that only have restrictions. It doesn't crack passwords.
- **Edit PDF** adds and covers content. It doesn't reflow existing text.
- Not included from the original feature set: Chat with PDF (needs an AI API key), P2P share and the collaborative whiteboard (need a signalling server), Audio→PDF transcription, and the GST invoice / POS billing generators.
