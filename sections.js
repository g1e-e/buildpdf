(() => {
  const BP = window.BuildPDF;
  const { el, status } = BP;
  const KEY = 'buildpdf.sections.v1';
  const TKEY = 'buildpdf.templates';
  const root = document.getElementById('builder-section');
  const files = new Map();
  const docs = new Map();
  const thumbs = new Map();
  let uid = 0;
  const id = () => 's' + Date.now().toString(36) + (uid++).toString(36);

  const FIELDS = {
    'time-range': {
      render(sec, f, changed) {
        const v = sec.values[f.key] || (sec.values[f.key] = { start: '', end: '' });
        const mk = k => { const i = el('input', { type: 'time', value: v[k] || '', 'aria-label': (k === 'start' ? 'Start' : 'End') + ' time', class: 'sb-time-' + k }); i.addEventListener('change', () => { v[k] = i.value; changed(); }); return i; };
        return el('div', { class: 'sb-field sb-time' },
          el('label', {}, 'Start ', mk('start')), el('label', {}, 'End ', mk('end')),
          el('div', { class: 'sb-total' }, 'Time Total: ' + (FIELDS['time-range'].total(v) || '—')));
      },
      total(v) {
        if (!v || !/^\d\d:\d\d/.test(v.start || '') || !/^\d\d:\d\d/.test(v.end || '')) return '';
        const m = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);
        let d = m(v.end) - m(v.start);
        if (d < 0) d += 1440;
        return Math.floor(d / 60) + 'h ' + (d % 60) + 'm';
      },
      toc(sec, f) {
        const v = sec.values[f.key] || {};
        if (!v.start && !v.end) return '';
        return 'Start ' + (v.start || '—') + ' · End ' + (v.end || '—') + ' · Time Total: ' + (this.total(v) || '—');
      },
      blocks() { return false; }
    },
    'checkbox': {
      render(sec, f, changed) {
        const c = el('input', { type: 'checkbox', class: 'sb-check' });
        c.checked = !!sec.values[f.key];
        c.addEventListener('change', () => { sec.values[f.key] = c.checked; changed(true); });
        return el('label', { class: 'sb-field sb-checkbox' }, c, ' ', f.label);
      },
      toc(sec, f) { return sec.values[f.key] ? f.label : ''; },
      blocks(sec, f) { return !!(f.blocksPages && sec.values[f.key]); }
    }
  };

  const BUILTIN = {
    'Surgical case': { sections: [
      { title: 'PreOp' },
      { title: 'History and Physical' },
      { title: 'Incision Start Time and End Time', fields: [{ type: 'time-range', key: 'time', label: 'Incision time' }] },
      { title: 'Immediate Post-operative Note' },
      { title: 'Operative Report' },
      { title: 'Pathology', fields: [{ type: 'checkbox', key: 'none', label: 'No Pathology', blocksPages: true }] },
      { title: 'Informed Consent' }
    ] }
  };

  const blank = () => ({ name: '', toc: true, sections: [] });
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!S || !Array.isArray(S.sections)) S = blank();
  S.sections.forEach(s => { s.fields = s.fields || []; s.values = s.values || {}; s.pages = s.pages || []; });
  const save = () => localStorage.setItem(KEY, JSON.stringify(S));
  const loadTemplates = () => { try { const t = JSON.parse(localStorage.getItem(TKEY)); return t && typeof t === 'object' && !Array.isArray(t) ? t : {}; } catch (e) { return {}; } };
  const allTemplates = () => Object.assign({}, loadTemplates(), BUILTIN);
  const blocked = sec => sec.fields.some(f => FIELDS[f.type] && FIELDS[f.type].blocks(sec, f));
  const newSection = t => ({ id: id(), title: t.title || 'New section', fields: JSON.parse(JSON.stringify(t.fields || [])), values: {}, pages: [] });

  function tocCount() {
    if (!S.toc) return 0;
    let pages = 1, y = 740 - 22 - 30 - 24;
    S.sections.forEach(sec => { const k = notes(sec).length; if (y < 70 + k * 15) { pages++; y = 740; } y -= 16 + k * 14 + 6; });
    return pages;
  }
  function layout() {
    const start = tocCount() + 1;
    let n = start;
    return S.sections.map(sec => {
      const refs = blocked(sec) ? [] : sec.pages.filter(p => files.has(p.f));
      const r = { sec, from: refs.length ? n : 0, to: refs.length ? n + refs.length - 1 : 0, refs };
      n += refs.length;
      return r;
    });
  }
  const range = r => !r.from ? '' : r.from === r.to ? 'p. ' + r.from : 'pp. ' + r.from + '–' + r.to;
  const notes = sec => sec.fields.map(f => FIELDS[f.type] ? FIELDS[f.type].toc(sec, f) : '').filter(Boolean);

  const drop = el('div', { class: 'sb-drop', tabindex: '0', role: 'button' },
    el('strong', {}, 'Drag and Drop'), el('span', { class: 'muted' }, ' PDFs or a folder here, or click to choose files'));
  const fileIn = el('input', { type: 'file', multiple: '', accept: '.pdf,application/pdf', hidden: '' });
  const dirIn = el('input', { type: 'file', multiple: '', webkitdirectory: '', hidden: '' });
  drop.addEventListener('click', e => { if (e.target.closest('button')) return; fileIn.value = ''; fileIn.click(); });
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  const dirBtn = el('button', { class: 'small', onclick: () => { dirIn.value = ''; dirIn.click(); } }, 'Choose folder');
  drop.append(' ', dirBtn);
  const toEntries = list => [...list].map(f => ({ path: f.webkitRelativePath || f.name, file: f }));
  fileIn.addEventListener('change', () => addFiles(toEntries(fileIn.files)));
  dirIn.addEventListener('change', () => addFiles(toEntries(dirIn.files)));
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, () => drop.classList.add('over')));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));

  const tray = el('div', { class: 'sb-tray' });
  const tplSel = el('select', { class: 'sb-tpl', 'aria-label': 'Template' });
  const tocChk = el('input', { type: 'checkbox', id: 'sbToc' });
  tocChk.addEventListener('change', () => { S.toc = tocChk.checked; changed(); });
  const toolbar = el('div', { class: 'sb-toolbar' },
    el('span', { class: 'sb-label' }, 'Template'), tplSel,
    el('button', { onclick: loadTemplate }, 'Load'),
    el('button', { onclick: saveTemplate }, 'Save as template'),
    el('button', { class: 'danger', onclick: deleteTemplate }, 'Delete'),
    el('label', { class: 'sb-toc-opt' }, tocChk, ' Table of Contents page'),
    el('button', { class: 'primary', id: 'sbBuild', onclick: build }, 'Build PDF'),
    el('button', { class: 'danger', onclick: clearAll }, 'Clear'));
  const secList = el('div', { class: 'sb-sections' });
  const left = el('section', { class: 'sb-left' }, el('button', { class: 'sb-add', onclick: () => { S.sections.push(newSection({})); changed(true); secList.scrollTop = secList.scrollHeight; } }, '+ Add Section'), secList);
  const tocEl = el('div', { class: 'sb-toc-list' });
  const tocCol = el('section', { class: 'sb-tocCol' }, el('h2', {}, 'Table of Contents'), tocEl);
  const prev = el('div', { class: 'sb-preview-inner' });
  const prevCol = el('section', { class: 'sb-preview' }, prev);
  root.append(drop, fileIn, dirIn, tray, toolbar, el('div', { class: 'sb-main' }, left, tocCol, prevCol));

  function refreshTemplates(pick) {
    const t = allTemplates();
    const cur = pick !== undefined ? pick : tplSel.value;
    tplSel.textContent = '';
    Object.keys(BUILTIN).forEach(n => tplSel.append(el('option', { value: n }, n + ' (built-in)')));
    Object.keys(loadTemplates()).filter(n => !BUILTIN[n]).sort().forEach(n => tplSel.append(el('option', { value: n }, n)));
    tplSel.value = t[cur] ? cur : (S.name && t[S.name] ? S.name : Object.keys(BUILTIN)[0]);
  }
  function hasContent() { return S.sections.some(s => s.pages.length || Object.values(s.values).some(v => v && (v === true || v.start || v.end))); }
  function loadTemplate() {
    const t = allTemplates()[tplSel.value];
    if (!t) return;
    if (hasContent() && !confirm('Load "' + tplSel.value + '"? This replaces your current sections and the pages in them.')) return;
    S.name = tplSel.value;
    S.sections = t.sections.map(newSection);
    changed(true);
    status('Loaded template "' + S.name + '".');
  }
  function saveTemplate() {
    const n = (prompt('Template name:', S.name && !BUILTIN[S.name] ? S.name : '') || '').trim();
    if (!n) return;
    if (BUILTIN[n]) { status('"' + n + '" is a built-in template. Choose another name.'); return; }
    const t = loadTemplates();
    if (t[n] && !confirm('A template named "' + n + '" already exists. Overwrite it?')) return;
    t[n] = { sections: S.sections.map(s => ({ title: s.title, fields: s.fields })) };
    localStorage.setItem(TKEY, JSON.stringify(t));
    S.name = n; save(); refreshTemplates(n);
    status('Saved template "' + n + '".');
  }
  function deleteTemplate() {
    const n = tplSel.value;
    if (BUILTIN[n]) { status('Built-in templates can\'t be deleted.'); return; }
    if (!confirm('Delete the template "' + n + '"?')) return;
    const t = loadTemplates(); delete t[n]; localStorage.setItem(TKEY, JSON.stringify(t));
    refreshTemplates('');
    status('Deleted template "' + n + '".');
  }
  function clearAll() {
    if (!confirm('Clear all sections and loaded files? Saved templates are kept.')) return;
    S = blank(); files.clear(); docs.clear(); thumbs.clear(); changed(true);
  }

  function addFiles(entries) {
    let added = 0, skipped = 0;
    for (const { path, file } of entries) {
      if (!BP.isPdf(file.name)) { skipped++; continue; }
      const key = files.has(file.name) && files.get(file.name).path !== path ? path : file.name;
      const known = S.sections.some(s => s.pages.some(p => p.f === path)) ? path : key;
      files.set(known, { file, path, n: null });
      docs.delete(known);
      [...thumbs.keys()].forEach(k => { if (k.startsWith(known + '\u0000')) thumbs.delete(k); });
      added++;
    }
    changed(true);
    status('Added ' + added + ' PDF' + (added === 1 ? '' : 's') + '.' + (skipped ? ' Skipped ' + skipped + ' non-PDF file' + (skipped === 1 ? '' : 's') + '.' : ''));
  }

  function renderTray() {
    tray.textContent = '';
    const needed = new Set();
    S.sections.forEach(s => s.pages.forEach(p => { if (!files.has(p.f)) needed.add(p.f); }));
    if (!files.size && !needed.size) { tray.append(el('span', { class: 'muted' }, 'No files yet.')); return; }
    for (const [k, f] of files) tray.append(el('span', { class: 'sb-file', title: f.path }, '📄 ' + k, f.n ? el('span', { class: 'count' }, ' ' + f.n + ' pg') : null,
      el('button', { class: 'icon', title: 'Remove from tray', onclick: () => { files.delete(k); docs.delete(k); changed(true); } }, '✕')));
    for (const k of needed) tray.append(el('span', { class: 'sb-file missing', title: 'Add this file again to use its pages' }, '⚠ ' + k + ' (not loaded)'));
  }

  function renderSections() {
    secList.textContent = '';
    S.sections.forEach((sec, idx) => {
      const title = el('input', { class: 'sb-title', value: sec.title, 'aria-label': 'Section title' });
      title.addEventListener('input', () => { sec.title = title.value; save(); renderToc(); renderPreview(); });
      const isBlocked = blocked(sec);
      const chips = el('ul', { class: 'sb-chips', 'data-sec': sec.id });
      sec.pages.forEach((p, i) => chips.append(el('li', { class: 'sb-chip' + (files.has(p.f) ? '' : ' missing'), 'data-i': i, title: p.f + ', page ' + (p.i + 1) },
        el('span', { class: 'handle' }, '⠿'), el('span', { class: 'sb-chip-t' }, p.f.replace(/\.pdf$/i, '') + ' · p' + (p.i + 1)),
        el('button', { class: 'icon', title: 'Remove page', onclick: () => { sec.pages.splice(i, 1); changed(true); } }, '✕'))));
      const card = el('div', { class: 'sb-card' + (isBlocked ? ' blocked' : ''), 'data-sec': sec.id },
        el('div', { class: 'sb-card-head' },
          el('span', { class: 'handle sb-handle', title: 'Drag to reorder' }, '⠿'),
          el('span', { class: 'sb-num' }, 'Section ' + (idx + 1) + ':'), title,
          el('button', { class: 'icon', title: 'Delete section', onclick: () => { if ((sec.pages.length || hasValues(sec)) && !confirm('Delete "' + sec.title + '"?')) return; S.sections.splice(S.sections.indexOf(sec), 1); changed(true); } }, '✕')),
        el('button', { class: 'sb-insert', onclick: () => insertPages(sec) }, 'Insert pages'),
        sec.fields.map(f => FIELDS[f.type] ? FIELDS[f.type].render(sec, f, changed) : null),
        isBlocked ? el('div', { class: 'sb-marked' }, notes(sec).join(' · ') || 'Marked') : null,
        chips);
      if (isBlocked) card.querySelector('.sb-insert').disabled = true;
      secList.append(card);
      Sortable.create(chips, { handle: '.handle', animation: 120, onEnd: e => { if (e.oldIndex === e.newIndex) return; const [m] = sec.pages.splice(e.oldIndex, 1); sec.pages.splice(e.newIndex, 0, m); changed(true); } });
    });
  }
  const hasValues = sec => Object.values(sec.values).some(v => v && (v === true || v.start || v.end));
  Sortable.create(secList, { handle: '.sb-handle', animation: 150, onEnd: e => { if (e.oldIndex === e.newIndex) return; const [m] = S.sections.splice(e.oldIndex, 1); S.sections.splice(e.newIndex, 0, m); changed(true); } });

  function chooseFile(sec) {
    return new Promise(res => {
      const keys = [...files.keys()];
      if (keys.length === 1) { res(keys[0]); return; }
      const sel = el('select', { class: 'fc-select', 'aria-label': 'File' }, keys.map(k => el('option', { value: k }, k)));
      const done = v => { box.remove(); document.removeEventListener('keydown', key, true); res(v); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } else if (e.key === 'Enter') { e.preventDefault(); done(sel.value); } };
      const box = el('div', { class: 'overlay fc', onclick: e => { if (e.target === box) done(null); } },
        el('div', { class: 'overlay-box fc-box', role: 'dialog', 'aria-modal': 'true' },
          el('p', {}, el('strong', {}, 'Insert pages into "' + sec.title + '" from:')), sel,
          el('div', { class: 'fc-btns' }, el('button', { onclick: () => done(null) }, 'Cancel'), el('button', { class: 'primary fc-ok', onclick: () => done(sel.value) }, 'Choose pages'))));
      document.body.append(box);
      document.addEventListener('keydown', key, true);
      sel.focus();
    });
  }
  async function insertPages(sec) {
    if (blocked(sec)) return;
    if (!files.size) { status('Add PDFs first: drop them on the Drag and Drop bar or click it.'); return; }
    const k = await chooseFile(sec);
    if (!k) return;
    BP.openPicker({
      file: files.get(k).file, title: k + ' → ' + sec.title,
      initial: () => [], doneLabel: 'Add pages',
      hint: 'Click the pages to add to "' + sec.title + '". They are added in page order. Shift-click selects a range.',
      onDone: (arr, n) => { files.get(k).n = n; arr.forEach(i => sec.pages.push({ f: k, i })); if (arr.length) status('Added ' + arr.length + ' page' + (arr.length === 1 ? '' : 's') + ' to "' + sec.title + '".'); changed(true); }
    });
  }

  function renderToc() {
    tocEl.textContent = '';
    const L = layout();
    const tn = tocCount();
    if (tn) tocEl.append(el('div', { class: 'sb-toc-item muted' }, el('span', {}, 'Table of Contents'), el('span', { class: 'sb-toc-pg' }, tn === 1 ? 'p. 1' : 'pp. 1–' + tn)));
    if (!L.length) tocEl.append(el('p', { class: 'muted' }, 'Add a section or load a template.'));
    L.forEach((r, i) => {
      const nt = notes(r.sec);
      tocEl.append(el('button', { class: 'sb-toc-item', onclick: () => { const h = prev.querySelector('[data-head="' + r.sec.id + '"]'); if (h) prevCol.scrollTo({ top: h.offsetTop - prev.offsetTop, behavior: 'smooth' }); } },
        el('span', { class: 'sb-toc-t' }, (i + 1) + '. ' + (r.sec.title || 'Untitled')), el('span', { class: 'sb-toc-pg' }, range(r) || (blocked(r.sec) ? '' : 'no pages')),
        nt.length ? el('span', { class: 'sb-toc-note' }, nt.join(' · ')) : null));
    });
  }

  const getDoc = k => {
    if (!docs.has(k)) docs.set(k, (async () => { const lib = await BP.pdfjs(); const d = await lib.getDocument({ data: new Uint8Array(await files.get(k).file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true }).promise; files.get(k).n = d.numPages; return d; })());
    return docs.get(k);
  };
  const W = 340;
  const obs = new IntersectionObserver(async ents => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      const t = en.target; obs.unobserve(t);
      const k = t.dataset.f, i = +t.dataset.i, ck = k + '\u0000' + i;
      try {
        let cv = thumbs.get(ck);
        if (!cv) {
          const doc = await getDoc(k);
          const page = await doc.getPage(i + 1);
          const v1 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: W / v1.width * (window.devicePixelRatio || 1) });
          cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          page.cleanup();
          thumbs.set(ck, cv);
        }
        let node = cv;
        if (cv.isConnected) { node = document.createElement('canvas'); node.width = cv.width; node.height = cv.height; node.getContext('2d').drawImage(cv, 0, 0); }
        t.textContent = ''; t.append(node);
      } catch (e) { t.textContent = 'Preview unavailable'; }
    }
  }, { root: prevCol, rootMargin: '600px' });

  function renderPreview() {
    obs.disconnect();
    prev.textContent = '';
    const L = layout();
    if (!L.length) { prev.append(el('p', { class: 'muted' }, 'The combined PDF preview appears here.')); return; }
    if (S.toc) prev.append(el('div', { class: 'sb-prev-toc' }, el('h3', {}, S.name || 'Case'), el('p', { class: 'muted' }, 'Page 1: Table of Contents (generated when you build)')));
    L.forEach((r, i) => {
      const nt = notes(r.sec);
      prev.append(el('h3', { class: 'sb-prev-head', 'data-head': r.sec.id }, (i + 1) + '. ' + (r.sec.title || 'Untitled'), el('span', { class: 'muted' }, ' ' + range(r))));
      if (nt.length) prev.append(el('p', { class: 'sb-prev-note' }, nt.join(' · ')));
      if (!r.refs.length) prev.append(el('p', { class: 'muted sb-prev-empty' }, blocked(r.sec) ? 'No pages (marked).' : 'No pages yet.'));
      r.refs.forEach((p, j) => {
        const t = el('div', { class: 'sb-page', 'data-f': p.f, 'data-i': p.i }, 'Loading…');
        prev.append(el('figure', { class: 'sb-fig' }, t, el('figcaption', {}, 'Page ' + (r.from + j) + ' · ' + p.f + ' p' + (p.i + 1))));
        obs.observe(t);
      });
    });
  }

  function changed(full) {
    save();
    tocChk.checked = S.toc !== false;
    if (full !== false) { renderTray(); renderSections(); }
    renderToc(); renderPreview();
  }

  const winAnsi = s => String(s).replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  async function build() {
    const L = layout();
    const total = L.reduce((a, r) => a + r.refs.length, 0);
    if (!total) { status('There are no pages to build yet. Use Insert pages on a section first.'); return; }
    const ov = document.getElementById('overlay'), txt = document.getElementById('overlayText'), bar = document.getElementById('overlayBar');
    ov.hidden = false;
    const { PDFDocument, StandardFonts, rgb, PDFName, PDFHexString, PDFNull } = PDFLib;
    try {
      const out = await PDFDocument.create();
      const title = (S.name || 'Case') + ' ' + today();
      out.setTitle(title);
      const srcs = new Map(), problems = [];
      const tocPages = [];
      if (S.toc) {
        const font = await out.embedFont(StandardFonts.Helvetica), bold = await out.embedFont(StandardFonts.HelveticaBold);
        let pg = out.addPage([612, 792]); tocPages.push(pg);
        let y = 740;
        const fit = (t, f, s, w) => { t = winAnsi(t); if (f.widthOfTextAtSize(t, s) <= w) return t; while (t.length > 1 && f.widthOfTextAtSize(t + '...', s) > w) t = t.slice(0, -1); return t + '...'; };
        pg.drawText(fit(S.name || 'Case', bold, 20, 500), { x: 56, y, size: 20, font: bold }); y -= 22;
        pg.drawText(winAnsi(today()), { x: 56, y, size: 11, font, color: rgb(.35, .38, .45) }); y -= 30;
        pg.drawText('Table of Contents', { x: 56, y, size: 14, font: bold }); y -= 24;
        L.forEach((r, i) => {
          const nt = notes(r.sec);
          if (y < 70 + nt.length * 15) { pg = out.addPage([612, 792]); tocPages.push(pg); y = 740; }
          const rg = winAnsi(range(r) || (blocked(r.sec) ? '' : 'no pages'));
          const rw = font.widthOfTextAtSize(rg, 12);
          pg.drawText(fit((i + 1) + '. ' + (r.sec.title || 'Untitled'), font, 12, 430), { x: 56, y, size: 12, font });
          pg.drawText(rg, { x: 556 - rw, y, size: 12, font });
          y -= 16;
          nt.forEach(n => { pg.drawText(fit(n, font, 10, 470), { x: 74, y, size: 10, font, color: rgb(.3, .33, .4) }); y -= 14; });
          y -= 6;
        });
      }
      const firstPage = new Map();
      let done = 0;
      for (const r of L) {
        for (const p of r.refs) {
          txt.textContent = 'Building (' + (++done) + ' of ' + total + ')';
          bar.value = done / total;
          try {
            if (!srcs.has(p.f)) srcs.set(p.f, await PDFDocument.load(await files.get(p.f).file.arrayBuffer(), { ignoreEncryption: true }));
            const src = srcs.get(p.f);
            if (p.i >= src.getPageCount()) throw new Error('range');
            const [cp] = await out.copyPages(src, [p.i]);
            out.addPage(cp);
            if (!firstPage.has(r.sec.id)) firstPage.set(r.sec.id, cp);
          } catch (e) { problems.push(p.f + ' p' + (p.i + 1)); }
        }
        await new Promise(res => setTimeout(res));
      }
      try {
        const ctx = out.context;
        const items = [];
        if (tocPages.length) items.push(['Table of Contents', tocPages[0]]);
        L.forEach((r, i) => { const pg = firstPage.get(r.sec.id); if (pg) items.push([(i + 1) + '. ' + (r.sec.title || 'Untitled'), pg]); });
        if (items.length) {
          const oRef = ctx.nextRef();
          const refs = items.map(() => ctx.nextRef());
          items.forEach(([t, pg], i) => {
            const d = ctx.obj({ Title: PDFHexString.fromText(t), Parent: oRef, Dest: [pg.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull] });
            if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
            if (i < refs.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
            ctx.assign(refs[i], d);
          });
          ctx.assign(oRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
          out.catalog.set(PDFName.of('Outlines'), oRef);
          out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
        }
      } catch (e) {}
      const bytes = await out.save();
      const name = title.replace(/[\\/:*?"<>|]+/g, '_') + '.pdf';
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = el('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status('"' + name + '": ' + out.getPageCount() + ' pages.' + (problems.length ? ' Skipped: ' + problems.join(', ') : ''));
    } finally { ov.hidden = true; }
  }

  BP.register({ id: 'section', name: 'Section builder', el: root, onFiles: addFiles, onShow: () => { refreshTemplates(); changed(true); } });
  refreshTemplates();
  changed(true);
})();
