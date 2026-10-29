(() => {
  const BP = window.BuildPDF;
  const { el, status } = BP;
  const KEY = 'buildpdf.sections.v1';
  const TKEY = 'buildpdf.templates';
  const root = document.getElementById('builder-section');
  const files = new Map();
  const docs = new Map();
  const thumbs = new Map();
  const BOX = { hl: { c: '#ffe14d', o: 0.35, n: 'Highlight' }, cen: { c: '#000000', o: 1, n: 'Censor' } };
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
  S.sections.forEach(s => {
    s.fields = s.fields || []; s.values = s.values || {};
    if (!Array.isArray(s.items)) {
      s.items = [];
      (s.pages || []).forEach(p => { const last = s.items[s.items.length - 1]; if (last && last.f === p.f) last.pages.push(p.i); else s.items.push({ id: id(), f: p.f, pages: [p.i] }); });
    }
    delete s.pages;
    s.items.forEach(it => {
      if (!it.ann) return;
      for (const [pg, list] of Object.entries(it.ann)) {
        const boxes = (Array.isArray(list) ? list : []).map(o => o && o.t === 'box' && BOX[o.k] ? o : o && (o.t === 'hl' || o.t === 'wo') && o.w > 0 && o.h > 0 ? { t: 'box', k: o.t === 'hl' ? 'hl' : 'cen', x: o.x, y: o.y, w: o.w, h: o.h } : null).filter(Boolean);
        if (boxes.length) it.ann[pg] = boxes; else delete it.ann[pg];
      }
      if (!Object.keys(it.ann).length) delete it.ann;
    });
  });
  const flat = sec => sec.items.flatMap(it => it.pages.map(i => ({ f: it.f, i, it })));
  const fmtRanges = arr => { const out = []; for (let k = 0; k < arr.length; k++) { let j = k; while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++; out.push(j > k ? (arr[k] + 1) + '-' + (arr[j] + 1) : String(arr[k] + 1)); k = j; } return out.join(', '); };
  function parseRanges(t, n) {
    const out = [], seen = new Set();
    const parts = String(t).split(/[,;\s]+/).filter(Boolean);
    for (const p of parts) {
      const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(p.replace(/\s+/g, ''));
      if (!m) return { error: '"' + p + '" is not a page or range' };
      let a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b < 1) return { error: 'Pages start at 1' };
      if (n && (a > n || b > n)) return { error: 'This file has ' + n + ' page' + (n === 1 ? '' : 's') };
      const step = a <= b ? 1 : -1;
      for (let x = a; step > 0 ? x <= b : x >= b; x += step) if (!seen.has(x)) { seen.add(x); out.push(x - 1); }
    }
    return { pages: out };
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(S));
  const loadTemplates = () => { try { const t = JSON.parse(localStorage.getItem(TKEY)); return t && typeof t === 'object' && !Array.isArray(t) ? t : {}; } catch (e) { return {}; } };
  const allTemplates = () => Object.assign({}, loadTemplates(), BUILTIN);
  const blocked = sec => sec.fields.some(f => FIELDS[f.type] && FIELDS[f.type].blocks(sec, f));
  const newSection = t => ({ id: id(), title: t.title || 'New section', fields: JSON.parse(JSON.stringify(t.fields || [])), values: {}, items: [] });

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
      const refs = blocked(sec) ? [] : flat(sec).filter(p => files.has(p.f));
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
  function hasContent() { return S.sections.some(s => s.items.length || Object.values(s.values).some(v => v && (v === true || v.start || v.end))); }
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
    const out = [];
    for (const { path, file } of entries) {
      if (!BP.isPdf(file.name)) { skipped++; continue; }
      const key = files.has(file.name) && files.get(file.name).path !== path ? path : file.name;
      const known = S.sections.some(s => s.items.some(p => p.f === path)) ? path : key;
      files.set(known, { file, path, n: null });
      docs.delete(known);
      [...thumbs.keys()].forEach(k => { if (k.startsWith(known + '\u0000')) thumbs.delete(k); });
      added++;
      out.push(known);
    }
    changed(true);
    status('Added ' + added + ' PDF' + (added === 1 ? '' : 's') + '. Drag them into a section.' + (skipped ? ' Skipped ' + skipped + ' non-PDF file' + (skipped === 1 ? '' : 's') + '.' : ''));
    return out;
  }
  const pageCount = async k => { const f = files.get(k); if (!f) return 0; if (f.n) return f.n; try { return (await getDoc(k)).numPages; } catch (e) { return 0; } };
  async function addItem(sec, k, at) {
    if (blocked(sec) || !files.has(k)) return;
    const n = await pageCount(k);
    const it = { id: id(), f: k, pages: [...Array(n).keys()] };
    if (at == null || at > sec.items.length) sec.items.push(it); else sec.items.splice(at, 0, it);
    changed(true);
    status('Added ' + k + ' to "' + sec.title + '" (all ' + n + ' pages). Click its name to choose pages, or type page ranges.');
  }

  function renderTray() {
    tray.textContent = '';
    const needed = new Set();
    S.sections.forEach(s => s.items.forEach(p => { if (!files.has(p.f)) needed.add(p.f); }));
    if (!files.size && !needed.size) { tray.append(el('span', { class: 'muted' }, 'No files yet.')); return; }
    for (const [k, f] of files) tray.append(el('span', { class: 'sb-file', draggable: 'true', 'data-f': k, title: 'Drag into a section · ' + f.path, ondragstart: e => { e.dataTransfer.setData('application/x-buildpdf-file', k); e.dataTransfer.setData('text/plain', k); e.dataTransfer.effectAllowed = 'copy'; } }, '📄 ' + k, f.n ? el('span', { class: 'count' }, ' ' + f.n + ' pg') : null,
      el('button', { class: 'icon', title: 'Remove from tray', onclick: () => { files.delete(k); docs.delete(k); changed(true); } }, '✕')));
    for (const k of needed) tray.append(el('span', { class: 'sb-file missing', title: 'Add this file again to use its pages' }, '⚠ ' + k + ' (not loaded)'));
  }

  function openItem(sec, it) {
    const f = files.get(it.f);
    if (!f) { status(it.f + ' is not loaded. Add it again first.'); return; }
    BP.openPicker({
      file: f.file, title: it.f + ' → ' + sec.title,
      initial: n => { f.n = n; return it.pages.filter(i => i < n); },
      hint: 'Pages for "' + sec.title + '". Click to include or leave out. Shift-click toggles a range.',
      onChange: arr => { it.pages = arr.slice().sort((a, b) => a - b); save(); renderToc(); renderPreview(); },
      decorate: (i, box, W, dw, dh) => paintAnnInto(box, it.ann && it.ann[i], W, dw, dh),
      onClose: () => changed(true)
    });
  }
  const accepts = e => e.dataTransfer && [...e.dataTransfer.types].some(t => t === 'application/x-buildpdf-file' || t === 'Files');
  function renderSections() {
    secList.textContent = '';
    S.sections.forEach((sec, idx) => {
      const title = el('input', { class: 'sb-title', value: sec.title, 'aria-label': 'Section title' });
      title.addEventListener('input', () => { sec.title = title.value; save(); renderToc(); renderPreview(); });
      const isBlocked = blocked(sec);
      const list = el('ul', { class: 'sb-items', 'data-sec': sec.id });
      sec.items.forEach(it => {
        const loaded = files.has(it.f);
        const n = loaded ? files.get(it.f).n : 0;
        const rng = el('input', { class: 'sb-range', placeholder: 'Pages, e.g. 1-4, 5, 6-9', 'aria-label': 'Pages of ' + it.f, value: fmtRanges(it.pages) });
        const hint = el('div', { class: 'sb-range-hint', hidden: '' });
        const cnt = el('span', { class: 'count' }, it.pages.length + (n ? '/' + n : '') + ' pg');
        const ne = annCount(it);
        rng.addEventListener('input', () => {
          const res = parseRanges(rng.value, n);
          rng.classList.toggle('bad', !!res.error);
          hint.hidden = !res.error; hint.textContent = res.error || '';
          if (res.error) return;
          it.pages = res.pages; cnt.textContent = it.pages.length + (n ? '/' + n : '') + ' pg';
          save(); renderToc(); renderPreview();
        });
        rng.addEventListener('change', () => { if (!rng.classList.contains('bad')) rng.value = fmtRanges(it.pages); });
        list.append(el('li', { class: 'sb-item' + (loaded ? '' : ' missing') + (it.pages.length ? '' : ' empty'), 'data-id': it.id },
          el('div', { class: 'sb-item-row' },
            el('button', { class: 'sb-item-name', title: loaded ? 'Choose pages' : 'Add this file again to use it', onclick: () => openItem(sec, it) }, '📄 ' + it.f), cnt,
            ne ? el('button', { class: 'sb-edits', title: 'Remove all boxes on this file in this section', onclick: () => { if (confirm('Remove ' + ne + ' box' + (ne === 1 ? '' : 'es') + ' on ' + it.f + ' in "' + sec.title + '"?')) { delete it.ann; changed(true); } } }, '▭ ' + ne + ' ✕') : null,
            el('button', { class: 'icon', title: 'Remove from section', onclick: () => { sec.items.splice(sec.items.indexOf(it), 1); changed(true); } }, '✕')),
          rng, hint));
      });
      const card = el('div', { class: 'sb-card' + (isBlocked ? ' blocked' : ''), 'data-sec': sec.id },
        el('div', { class: 'sb-card-head' },
          el('span', { class: 'sb-num' }, 'Section ' + (idx + 1) + ':'), title,
          el('button', { class: 'icon', title: 'Delete section', onclick: () => { if ((sec.items.length || hasValues(sec)) && !confirm('Delete "' + sec.title + '"?')) return; S.sections.splice(S.sections.indexOf(sec), 1); changed(true); } }, '✕')),
        sec.fields.map(f => FIELDS[f.type] ? FIELDS[f.type].render(sec, f, changed) : null),
        isBlocked ? el('div', { class: 'sb-marked' }, notes(sec).join(' · ') || 'Marked') : null,
        list,
        el('div', { class: 'sb-dropzone' }, isBlocked ? 'No pages for this section' : sec.items.length ? 'Drop another PDF here' : 'Drop a PDF here'),
        el('button', { class: 'sb-insert small', onclick: () => insertPages(sec) }, 'Insert pages…'));
      if (isBlocked) card.querySelector('.sb-insert').disabled = true;
      card.addEventListener('dragover', e => { if (!accepts(e) || isBlocked) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; card.classList.add('over'); });
      card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('over'); });
      card.addEventListener('drop', async e => {
        if (!accepts(e)) return;
        e.preventDefault(); e.stopPropagation(); card.classList.remove('over');
        if (isBlocked) return;
        const k = e.dataTransfer.getData('application/x-buildpdf-file');
        if (k) { addItem(sec, k); return; }
        const keys = addFiles(await BP.readDropped(e.dataTransfer.items));
        for (const key of keys) await addItem(sec, key);
      });
      secList.append(card);
      Sortable.create(list, { animation: 120, filter: 'input,button,.sb-range-hint', preventOnFilter: false, delayOnTouchOnly: true, delay: 150, onEnd: e => { if (e.oldIndex === e.newIndex) return; const [m] = sec.items.splice(e.oldIndex, 1); sec.items.splice(e.newIndex, 0, m); changed(true); } });
    });
  }
  const hasValues = sec => Object.values(sec.values).some(v => v && (v === true || v.start || v.end));
  Sortable.create(secList, { animation: 150, draggable: '.sb-card', filter: 'input,button,select,textarea,label,.sb-item,.sb-items', preventOnFilter: false, delayOnTouchOnly: true, delay: 150, onEnd: e => { if (e.oldIndex === e.newIndex) return; const [m] = S.sections.splice(e.oldIndex, 1); S.sections.splice(e.newIndex, 0, m); changed(true); } });

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
      hint: 'Click the pages to add to "' + sec.title + '". Shift-click selects a range.',
      onDone: (arr, n) => { files.get(k).n = n; if (arr.length) { sec.items.push({ id: id(), f: k, pages: arr }); status('Added ' + arr.length + ' page' + (arr.length === 1 ? '' : 's') + ' of ' + k + ' to "' + sec.title + '".'); } changed(true); }
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
      tocEl.append(el('button', { class: 'sb-toc-item', onclick: () => { const h = prev.querySelector('[data-head="' + r.sec.id + '"]'); if (h) prevCol.scrollTo({ top: h.offsetTop - 44, behavior: 'smooth' }); } },
        el('span', { class: 'sb-toc-t' }, (i + 1) + '. ' + (r.sec.title || 'Untitled')), el('span', { class: 'sb-toc-pg' }, range(r) || (blocked(r.sec) ? '' : 'no pages')),
        nt.length ? el('span', { class: 'sb-toc-note' }, nt.join(' · ')) : null));
    });
  }

  const getDoc = k => {
    if (!docs.has(k)) docs.set(k, (async () => { const lib = await BP.pdfjs(); const d = await lib.getDocument({ data: new Uint8Array(await files.get(k).file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true }).promise; files.get(k).n = d.numPages; return d; })());
    return docs.get(k);
  };
  const ZKEY = 'buildpdf.previewZoom';
  const BASE = 600;
  let zoom = BP.clampZ(parseFloat(localStorage.getItem(ZKEY)) || 1), settle = null;
  const pw = () => Math.round(BASE * zoom);
  const applyZoom = () => prev.style.setProperty('--pw', pw() + 'px');
  function setZoom(z) {
    const ratio = prevCol.scrollHeight ? prevCol.scrollTop / prevCol.scrollHeight : 0;
    zoom = BP.clampZ(z);
    localStorage.setItem(ZKEY, zoom.toFixed(3));
    applyZoom(); zc.refresh();
    prevCol.scrollTop = ratio * prevCol.scrollHeight;
    clearTimeout(settle);
    settle = setTimeout(() => prev.querySelectorAll('.sb-page').forEach(t => { const c = t.querySelector('canvas'); if (!c || +c.dataset.w !== pw()) { obs.unobserve(t); obs.observe(t); } }), 200);
  }
  const zc = BP.zoomControl({ target: prevCol, get: () => zoom, set: setZoom, fit: () => (prevCol.clientWidth - 48) / BASE });
  prevCol.prepend(el('div', { class: 'sb-zoombar' }, el('span', { class: 'muted' }, 'Preview'), zc, el('span', { class: 'muted sb-zoomhint' }, 'Ctrl + scroll or pinch to zoom')));
  applyZoom();
  const obs = new IntersectionObserver(async ents => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      const t = en.target; obs.unobserve(t);
      const k = t.dataset.f, i = +t.dataset.i, w = pw(), ck = k + '\u0000' + i + '\u0000' + w;
      const old = t.querySelector('canvas');
      if (old && +old.dataset.w === w) continue;
      try {
        let cv = thumbs.get(ck);
        if (!cv) {
          const doc = await getDoc(k);
          const page = await doc.getPage(i + 1);
          const v1 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: w / v1.width * (window.devicePixelRatio || 1) });
          cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          page.cleanup();
          cv.dataset.w = w; cv.dataset.dw = v1.width; cv.dataset.dh = v1.height;
          thumbs.set(ck, cv);
          if (thumbs.size > 120) thumbs.delete(thumbs.keys().next().value);
        }
        if (w !== pw()) continue;
        let node = cv;
        if (cv.isConnected) { node = document.createElement('canvas'); node.width = cv.width; node.height = cv.height; node.dataset.w = w; node.getContext('2d').drawImage(cv, 0, 0); }
        t.textContent = ''; t.append(node);
        t.dataset.dw = cv.dataset.dw; t.dataset.dh = cv.dataset.dh;
        decorate(t);
      } catch (e) { t.textContent = 'Preview unavailable'; }
    }
  }, { root: prevCol, rootMargin: '800px' });

  function renderPreview() {
    obs.disconnect();
    const top = prevCol.scrollTop;
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
        const t = el('div', { class: 'sb-page', 'data-f': p.f, 'data-i': p.i });
        t._it = p.it;
        const cv = thumbs.get(p.f + '\u0000' + p.i + '\u0000' + pw());
        if (cv) { const node = document.createElement('canvas'); node.width = cv.width; node.height = cv.height; node.dataset.w = cv.dataset.w; node.getContext('2d').drawImage(cv, 0, 0); t.append(node); t.dataset.dw = cv.dataset.dw; t.dataset.dh = cv.dataset.dh; decorate(t); }
        else t.textContent = 'Loading…';
        prev.append(el('figure', { class: 'sb-fig' }, t, el('figcaption', {}, 'Page ' + (r.from + j) + ' · ' + p.f + ' p' + (p.i + 1))));
        obs.observe(t);
      });
    });
    prevCol.scrollTop = top;
  }

  function changed(full) {
    save();
    tocChk.checked = S.toc !== false;
    if (full !== false) { renderTray(); renderSections(); }
    renderToc(); renderPreview();
  }

  const winAnsi = s => String(s).replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function drawBoxes(ctx, ops) {
    ops.forEach(o => { const b = BOX[o.k]; if (!b) return; ctx.save(); ctx.globalAlpha = b.o; ctx.fillStyle = b.c; ctx.fillRect(o.x, o.y, o.w, o.h); ctx.restore(); });
  }
  function paintAnnInto(box, ops, W, dw, dh) {
    box.querySelectorAll(':scope > .sb-ann').forEach(c => c.remove());
    if (!ops || !ops.length || !dw) return;
    const dpr = window.devicePixelRatio || 1, k = W / dw * dpr;
    const cv = el('canvas', { class: 'sb-ann' });
    cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(W * dh / dw * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0); drawBoxes(ctx, ops);
    box.append(cv);
  }
  const annCount = it => Object.values(it.ann || {}).reduce((a, l) => a + l.length, 0);

  const EKEY = 'buildpdf.editor';
  const pref = Object.assign({ append: false, k: 'hl' }, JSON.parse(localStorage.getItem(EKEY) || '{}'));
  if (!BOX[pref.k]) pref.k = 'hl';
  const savePref = () => localStorage.setItem(EKEY, JSON.stringify({ append: pref.append, k: pref.k }));
  let sel = null, hist = [], fut = [];
  const apBtn = el('button', { class: 'ed-tool ed-append', title: 'Append mode: drag on a preview page to add a box (A)', onclick: () => setAppend(!pref.append) }, '▭ Append');
  const kBtns = Object.entries(BOX).map(([k, b]) => el('button', { class: 'ed-kind', 'data-k': k, title: b.n + (k === 'hl' ? ' (see-through yellow)' : ' (solid black)'), onclick: () => setKind(k) }, el('span', { class: 'ed-swatch ' + k }), b.n));
  const ub = el('button', { title: 'Undo (Ctrl+Z)', onclick: () => undo() }, '↶'), rb = el('button', { title: 'Redo (Ctrl+Y)', onclick: () => redo() }, '↷');
  const db = el('button', { title: 'Delete selected box (Del)', onclick: () => del() }, '🗑');
  const apTools = el('span', { class: 'sb-aptools' }, el('span', { class: 'ed-kinds', role: 'group', 'aria-label': 'Box type' }, kBtns), ub, rb, db);
  prevCol.querySelector('.sb-zoombar').append(apBtn, apTools);
  const opsOf = (it, i) => (it.ann && it.ann[i]) || [];
  const pagesOf = (it, i) => [...prev.querySelectorAll('.sb-page')].filter(t => t._it === it && +t.dataset.i === i);
  function decorate(t, extra) {
    const it = t._it, i = +t.dataset.i, dw = +t.dataset.dw, dh = +t.dataset.dh;
    if (!dw) return;
    paintAnnInto(t, extra ? opsOf(it, i).concat(extra) : opsOf(it, i), pw(), dw, dh);
    t.querySelectorAll(':scope > .ed-sel').forEach(n => n.remove());
    const o = sel && sel.it === it && sel.i === i && opsOf(it, i)[sel.k];
    if (o) {
      const sb = el('div', { class: 'ed-sel' }, el('span', { class: 'ed-rs', title: 'Resize' }));
      sb.style.cssText = 'left:' + o.x / dw * 100 + '%;top:' + o.y / dh * 100 + '%;width:' + o.w / dw * 100 + '%;height:' + o.h / dh * 100 + '%';
      t.append(sb);
    }
  }
  function refresh(it, i) { if (it) pagesOf(it, i).forEach(t => decorate(t)); ub.disabled = !hist.length; rb.disabled = !fut.length; db.disabled = !(sel && opsOf(sel.it, sel.i)[sel.k]); }
  function select(n) { const o = sel; sel = n; if (o) refresh(o.it, o.i); if (n) { refresh(n.it, n.i); const b = opsOf(n.it, n.i)[n.k]; if (b) setKind(b.k, true); } else refresh(); }
  const snap = (it, i) => { hist.push({ it, i, v: JSON.stringify(opsOf(it, i)) }); if (hist.length > 200) hist.shift(); fut = []; };
  const put = (it, i, ops) => { it.ann = it.ann || {}; if (ops.length) it.ann[i] = ops; else delete it.ann[i]; };
  const commit = () => { save(); renderSections(); renderToc(); if (BP.redecorate) BP.redecorate(); };
  function setAppend(v) {
    pref.append = v; savePref();
    apBtn.classList.toggle('on', v); apBtn.setAttribute('aria-pressed', v);
    prev.classList.toggle('appending', v); apTools.hidden = !v;
    if (!v) select(null);
  }
  function setKind(k, quiet) {
    pref.k = k; savePref();
    kBtns.forEach(b => { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const o = !quiet && sel && opsOf(sel.it, sel.i)[sel.k];
    if (o && o.k !== k) { snap(sel.it, sel.i); o.k = k; commit(); refresh(sel.it, sel.i); }
  }
  prev.addEventListener('pointerdown', e => {
    const t = e.target.closest('.sb-page');
    if (!pref.append || e.button || !t || !+t.dataset.dw) return;
    e.preventDefault();
    const it = t._it, i = +t.dataset.i, dw = +t.dataset.dw, dh = +t.dataset.dh;
    const pt = ev => { const r = t.getBoundingClientRect(), z = r.width / dw; return [Math.max(0, Math.min(dw, (ev.clientX - r.left) / z)), Math.max(0, Math.min(dh, (ev.clientY - r.top) / z))]; };
    const [x, y] = pt(e), ops = opsOf(it, i), rs = e.target.closest('.ed-rs');
    let k = -1;
    if (rs && sel && sel.it === it && sel.i === i) k = sel.k;
    else for (let j = ops.length - 1; j >= 0; j--) { const o = ops[j]; if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) { k = j; break; } }
    const pid = e.pointerId; t.setPointerCapture && t.setPointerCapture(pid);
    const run = (move, up) => {
      const mv = ev => { if (ev.pointerId === pid) move(pt(ev)); };
      const end = ev => { if (ev.pointerId !== pid) return; t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', end); t.removeEventListener('pointercancel', end); up(); };
      t.addEventListener('pointermove', mv); t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
    };
    if (k < 0) {
      select(null);
      const o = { t: 'box', k: pref.k, x, y, w: 0, h: 0 };
      run(([a, b]) => { o.x = Math.min(x, a); o.y = Math.min(y, b); o.w = Math.abs(a - x); o.h = Math.abs(b - y); decorate(t, o); }, () => {
        if (o.w < 3 || o.h < 3) { decorate(t); return; }
        snap(it, i); put(it, i, ops.concat(o)); commit(); refresh(it, i);
      });
      return;
    }
    select({ it, i, k });
    const o = ops[k], start = JSON.stringify(ops), o0 = Object.assign({}, o);
    let moved = false;
    run(([a, b]) => {
      const dx = a - x, dy = b - y; moved = true;
      if (rs) { o.w = Math.max(4, Math.min(dw - o.x, o0.w + dx)); o.h = Math.max(4, Math.min(dh - o.y, o0.h + dy)); }
      else { o.x = Math.max(0, Math.min(o0.x + dx, dw - o.w)); o.y = Math.max(0, Math.min(o0.y + dy, dh - o.h)); }
      pagesOf(it, i).forEach(p => decorate(p));
    }, () => { if (moved) { hist.push({ it, i, v: start }); fut = []; commit(); refresh(it, i); } });
  });
  function del() { const o = sel && opsOf(sel.it, sel.i)[sel.k]; if (!o) return; const { it, i } = sel; snap(it, i); put(it, i, opsOf(it, i).filter(b => b !== o)); sel = null; commit(); refresh(it, i); }
  function step(from, to) {
    const h = from.pop(); if (!h) return;
    to.push({ it: h.it, i: h.i, v: JSON.stringify(opsOf(h.it, h.i)) });
    put(h.it, h.i, JSON.parse(h.v)); sel = null; commit(); refresh(h.it, h.i);
  }
  const undo = () => step(hist, fut), redo = () => step(fut, hist);
  document.addEventListener('keydown', e => {
    if (!prevCol.offsetParent || document.querySelector('[role=dialog]')) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (!c && !e.altKey && k === 'a') { e.preventDefault(); setAppend(!pref.append); return; }
    if (!pref.append) return;
    if (c && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (c && k === 'y') { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); del(); }
    else if (e.key === 'Escape' && sel) select(null);
  });
  setAppend(pref.append); setKind(pref.k, true); refresh();

  function pageMap(cp) {
    const r = ((cp.getRotation().angle % 360) + 360) % 360;
    const cb = cp.getCropBox(), x0 = cb.x, y0 = cb.y, w = cb.width, h = cb.height;
    return (X, Y) => ({ 0: [x0 + X, y0 + h - Y], 90: [x0 + Y, y0 + X], 180: [x0 + w - X, y0 + Y], 270: [x0 + w - Y, y0 + h - X] }[r] || [x0 + X, y0 + h - Y]);
  }
  const cenRects = (cp, ops) => { const map = pageMap(cp); return ops.filter(o => o.k === 'cen').map(o => { const [ax, ay] = map(o.x, o.y), [bx, by] = map(o.x + o.w, o.y + o.h); return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]; }); };
  async function renderCensored(f, i, ann) {
    const page = await (await getDoc(f)).getPage(i + 1);
    const v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: RASTER_DPI / 72 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    ctx.setTransform(c.width / v1.width, 0, 0, c.height / v1.height, 0, 0); drawBoxes(ctx, ann.filter(o => o.k === 'cen'));
    return { c, vp };
  }
  async function rasterRegion(out, cache, f, i, ann, bb) {
    if (!cache.r) cache.r = await renderCensored(f, i, ann);
    const { c, vp } = cache.r;
    const pts = [vp.convertToViewportPoint(bb[0], bb[1]), vp.convertToViewportPoint(bb[2], bb[3])];
    const x0 = Math.max(0, Math.floor(Math.min(pts[0][0], pts[1][0]))), y0 = Math.max(0, Math.floor(Math.min(pts[0][1], pts[1][1])));
    const x1 = Math.min(c.width, Math.ceil(Math.max(pts[0][0], pts[1][0]))), y1 = Math.min(c.height, Math.ceil(Math.max(pts[0][1], pts[1][1])));
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const r = ((vp.rotation % 360) + 360) % 360, sw = x1 - x0, sh = y1 - y0;
    const d = document.createElement('canvas'), q = r % 180 ? [sh, sw] : [sw, sh];
    d.width = q[0]; d.height = q[1];
    const dx = d.getContext('2d');
    dx.translate(d.width / 2, d.height / 2); dx.rotate(-r * Math.PI / 180); dx.drawImage(c, x0, y0, sw, sh, -sw / 2, -sh / 2, sw, sh);
    const blob = await new Promise(res => d.toBlob(res, 'image/jpeg', 0.92));
    return (await out.embedJpg(await blob.arrayBuffer())).ref;
  }
  function flatten(cp, ops) {
    const { rgb } = PDFLib;
    const map = pageMap(cp);
    ops.forEach(o => {
      const b = BOX[o.k]; if (!b) return;
      const [ax, ay] = map(o.x, o.y), [bx, by] = map(o.x + o.w, o.y + o.h);
      const n = parseInt(b.c.slice(1), 16);
      cp.drawRectangle({ x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), color: rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255), opacity: b.o, borderWidth: 0 });
    });
  }

  const RD = (() => {
    const WS = new Set([0, 9, 10, 12, 13, 32]), DL = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
    const fail = r => { const e = new Error(r); e.fallback = r; throw e; };
    function lex(b) {
      let p = 0;
      const ws = () => { for (;;) { while (p < b.length && WS.has(b[p])) p++; if (b[p] === 37) { while (p < b.length && b[p] !== 10 && b[p] !== 13) p++; } else return; } };
      function str() {
        const o = []; let d = 1; p++;
        while (p < b.length) {
          let c = b[p++];
          if (c === 92) {
            c = b[p++];
            const m = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 }[c];
            if (m != null) o.push(m);
            else if (c >= 48 && c <= 55) { let v = c - 48; for (let k = 0; k < 2 && b[p] >= 48 && b[p] <= 55; k++) v = v * 8 + b[p++] - 48; o.push(v & 255); }
            else if (c === 13) { if (b[p] === 10) p++; }
            else if (c !== 10) o.push(c);
          } else if (c === 40) { d++; o.push(c); }
          else if (c === 41) { if (!--d) break; o.push(c); }
          else o.push(c);
        }
        return { t: 's', v: Uint8Array.from(o) };
      }
      function hex() {
        p++; let h = '';
        while (p < b.length && b[p] !== 62) { const c = b[p++]; if (!WS.has(c)) h += String.fromCharCode(c); }
        p++; if (h.length % 2) h += '0';
        const o = new Uint8Array(h.length / 2); for (let k = 0; k < o.length; k++) o[k] = parseInt(h.substr(k * 2, 2), 16);
        return { t: 's', v: o };
      }
      function word() { const s = p; while (p < b.length && !WS.has(b[p]) && !DL.has(b[p])) p++; return String.fromCharCode(...b.subarray(s, p)); }
      function obj() {
        ws(); if (p >= b.length) return null;
        const c = b[p];
        if (c === 40) return str();
        if (c === 60) { if (b[p + 1] === 60) { p += 2; const v = []; for (;;) { ws(); if (b[p] === 62 && b[p + 1] === 62) { p += 2; break; } if (p >= b.length) break; v.push(obj()); } return { t: 'd', v }; } return hex(); }
        if (c === 91) { p++; const v = []; for (;;) { ws(); if (b[p] === 93) { p++; break; } if (p >= b.length) break; v.push(obj()); } return { t: 'a', v }; }
        if (c === 47) { p++; return { t: 'n', v: word() }; }
        if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) { p++; return { t: 'k', v: String.fromCharCode(c) }; }
        const w = word();
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'i', v: parseFloat(w) };
        if (w === 'true' || w === 'false' || w === 'null') return { t: 'b', v: w };
        if (!w) { p++; return { t: 'k', v: '?' }; }
        return { t: 'o', v: w };
      }
      const ops = []; let args = [], start = -1;
      for (;;) {
        ws(); if (p >= b.length) break;
        const s0 = p, x = obj(); if (!x) break;
        if (start < 0) start = s0;
        if (x.t !== 'o') { args.push(x); continue; }
        if (x.v === 'BI') {
          const kv = [];
          for (;;) { ws(); const s1 = p, y = obj(); if (!y) break; if (y.t === 'o' && y.v === 'ID') { p = s1 + 2; break; } kv.push(y); }
          p++;
          while (p < b.length && !(WS.has(b[p - 1]) && b[p] === 69 && b[p + 1] === 73 && (p + 2 >= b.length || WS.has(b[p + 2])))) p++;
          p += 2;
          ops.push({ op: 'BI', args: kv, start, end: p });
        } else ops.push({ op: x.v, args, start, end: p });
        args = []; start = -1;
      }
      return ops;
    }
    const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
    const inv = m => { const d = m[0] * m[3] - m[1] * m[2]; if (!d) fail('singular matrix'); return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
    const tp = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const quadBox = (m, x0, y0, x1, y1) => { const q = [tp(m, x0, y0), tp(m, x1, y0), tp(m, x0, y1), tp(m, x1, y1)]; const xs = q.map(v => v[0]), ys = q.map(v => v[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
    const overlap = (g, R, frac) => R.some(r => { const ox = Math.min(g[2], r[2]) - Math.max(g[0], r[0]), oy = Math.min(g[3], r[3]) - Math.max(g[1], r[1]); return ox > (g[2] - g[0]) * frac && oy > (g[3] - g[1]) * frac && ox > 0 && oy > 0; });
    const fmt = n => { const s = (Math.round(n * 10000) / 10000).toString(); return s === '-0' ? '0' : s; };
    const hexs = a => '<' + Array.from(a, x => x.toString(16).padStart(2, '0')).join('') + '>';
    let winNames = null;
    const encNames = emb => { const m = {}; Object.values(emb.encoding.unicodeMappings).forEach(([c, n]) => { if (m[c] == null) m[c] = n; }); return m; };
    const N = PDFLib.PDFName.of;
    const nm = v => v ? String(v).replace(/^\//, '') : '';
    const num = v => v && v.asNumber ? v.asNumber() : (typeof v === 'number' ? v : NaN);
    const arr = v => v && v.asArray ? v.asArray() : [];
    function fontInfo(fd, ctx) {
      const L = k => fd.lookup(N(k));
      const sub = nm(L('Subtype'));
      if (sub === 'Type3') fail('Type3 font');
      if (sub === 'Type0') {
        if (nm(L('Encoding')) !== 'Identity-H') fail('CID font with ' + (nm(L('Encoding')) || 'custom') + ' encoding');
        const df = ctx.lookup(arr(L('DescendantFonts'))[0]);
        if (!df) fail('CID font without descendant');
        const dw = num(df.lookup(N('DW'))), W = arr(df.lookup(N('W'))).map(v => ctx.lookup(v)), map = new Map();
        for (let k = 0; k < W.length;) {
          const a = num(W[k]), b = W[k + 1];
          if (b && b.asArray) { arr(b).forEach((w, j) => map.set(a + j, num(ctx.lookup(w)))); k += 2; }
          else { const last = num(b), w = num(W[k + 2]); for (let c = a; c <= last; c++) map.set(c, w); k += 3; }
        }
        return { n: 2, w: c => map.has(c) ? map.get(c) : (isNaN(dw) ? 1000 : dw) };
      }
      const widths = L('Widths');
      if (widths) {
        const fc = num(L('FirstChar')) || 0, ws = arr(widths).map(v => num(ctx.lookup(v)));
        const fdesc = L('FontDescriptor'), mw = fdesc ? num(fdesc.lookup(N('MissingWidth'))) : NaN;
        return { n: 1, w: c => { const v = ws[c - fc]; return v == null || isNaN(v) ? (isNaN(mw) ? 0 : mw) : v; } };
      }
      const base = nm(L('BaseFont')).replace(/^[A-Z]{6}\+/, '');
      const std = Object.values(PDFLib.StandardFonts);
      if (!std.includes(base)) fail('font ' + base + ' has no widths');
      const emb = PDFLib.StandardFontEmbedder.for(base);
      const names = Object.assign({}, base === 'Symbol' || base === 'ZapfDingbats' ? encNames(emb) : (winNames = winNames || encNames(PDFLib.StandardFontEmbedder.for('Helvetica'))));
      const enc = L('Encoding');
      if (enc && enc.lookup) { let c = 0; arr(enc.lookup(N('Differences'))).forEach(v => { v = ctx.lookup(v); if (v && v.asNumber) c = v.asNumber(); else { names[c++] = nm(v); } }); }
      return { n: 1, w: c => names[c] ? emb.font.getWidthOfGlyph(names[c]) || 0 : 0 };
    }
    function readContents(page) {
      const c = page.node.Contents(); if (!c) return new Uint8Array();
      const list = c.asArray ? c.asArray().map(r => page.doc.context.lookup(r)) : [c];
      const parts = list.map(s => s instanceof PDFLib.PDFRawStream ? PDFLib.decodePDFRawStream(s).decode() : s.getContents());
      const out = new Uint8Array(parts.reduce((a, x) => a + x.length + 1, 0)); let o = 0;
      parts.forEach(x => { out.set(x, o); o += x.length; out[o++] = 10; });
      return out;
    }
    function run(page, R) {
      const ctx = page.doc.context, res = page.node.Resources();
      const fontsD = res && res.lookup(N('Font')), xoD = res && res.lookup(N('XObject'));
      const fonts = new Map();
      const getFont = n => { if (!fonts.has(n)) { const fd = fontsD && fontsD.lookup(N(n)); if (!fd) fail('missing font ' + n); fonts.set(n, fontInfo(fd, ctx)); } return fonts.get(n); };
      const bytes = readContents(page), ops = lex(bytes);
      let g = { ctm: [1, 0, 0, 1, 0, 0], tc: 0, tw: 0, th: 1, tl: 0, f: null, fs: 0, ts: 0 }, st = [], tm = [1, 0, 0, 1, 0, 0], tlm = tm;
      const edits = [], images = []; let removed = 0;
      const nv = a => a.map(x => x.v);
      function show(items) {
        const f = g.f ? getFont(g.f) : fail('text without font');
        let any = false; const outItems = [];
        for (const it of items) {
          if (it.t === 'i') { tm = mul([1, 0, 0, 1, -it.v / 1000 * g.fs * g.th, 0], tm); outItems.push(fmt(it.v)); continue; }
          if (it.t !== 's') continue;
          const b = it.v; let run2 = [];
          for (let k = 0; k + f.n <= b.length; k += f.n) {
            const code = f.n === 2 ? b[k] << 8 | b[k + 1] : b[k], w0 = f.w(code);
            const sp = f.n === 1 && code === 32 ? g.tw : 0;
            const trm = mul([g.fs * g.th, 0, 0, g.fs, 0, g.ts], mul(tm, g.ctm));
            const gb = quadBox(trm, 0, -0.22, Math.max(w0, 250) / 1000, 0.88);
            const adv = (w0 / 1000 * g.fs + g.tc + sp) * g.th;
            if (overlap(gb, R, 0.2)) {
              any = true; removed++;
              if (run2.length) { outItems.push(hexs(run2)); run2 = []; }
              if (!g.fs) fail('zero font size');
              outItems.push(fmt(-(w0 + (g.tc + sp) * 1000 / g.fs)));
            } else for (let j = 0; j < f.n; j++) run2.push(b[k + j]);
            tm = mul([1, 0, 0, 1, adv, 0], tm);
          }
          if (run2.length) outItems.push(hexs(run2));
        }
        return any ? '[' + outItems.join(' ') + '] TJ' : null;
      }
      const tstar = () => { tlm = mul([1, 0, 0, 1, 0, -g.tl], tlm); tm = tlm; };
      for (const o of ops) {
        const a = o.args, v = nv(a);
        switch (o.op) {
          case 'q': st.push(Object.assign({}, g)); break;
          case 'Q': if (st.length) g = st.pop(); break;
          case 'cm': g.ctm = mul(v, g.ctm); break;
          case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break;
          case 'Tc': g.tc = v[0]; break;
          case 'Tw': g.tw = v[0]; break;
          case 'Tz': g.th = v[0] / 100; break;
          case 'TL': g.tl = v[0]; break;
          case 'Ts': g.ts = v[0]; break;
          case 'Tf': g.f = v[0]; g.fs = v[1]; break;
          case 'Td': tlm = mul([1, 0, 0, 1, v[0], v[1]], tlm); tm = tlm; break;
          case 'TD': g.tl = -v[1]; tlm = mul([1, 0, 0, 1, v[0], v[1]], tlm); tm = tlm; break;
          case 'Tm': tm = tlm = v.slice(0, 6); break;
          case 'T*': tstar(); break;
          case 'Tj': { const r = show([a[0]]); if (r) edits.push([o, r]); break; }
          case 'TJ': { const r = show(a[0] ? a[0].v : []); if (r) edits.push([o, r]); break; }
          case "'": { tstar(); const r = show([a[0]]); if (r) edits.push([o, 'T* ' + r]); break; }
          case '"': { g.tw = v[0]; g.tc = v[1]; tstar(); const r = show([a[2]]); if (r) edits.push([o, fmt(v[0]) + ' Tw ' + fmt(v[1]) + ' Tc T* ' + r]); break; }
          case 'BI': if (overlap(quadBox(g.ctm, 0, 0, 1, 1), R, 0)) fail('inline image under a censor'); break;
          case 'Do': {
            const x = xoD && xoD.lookup(N(v[0])); if (!x) break;
            const sub = nm(x.dict.lookup(N('Subtype')));
            if (sub === 'Image') { const bb = quadBox(g.ctm, 0, 0, 1, 1); if (overlap(bb, R, 0)) images.push({ o, ctm: g.ctm.slice(), bb }); }
            else if (sub === 'Form') {
              const m = arr(x.dict.lookup(N('Matrix'))).map(num), bx = arr(x.dict.lookup(N('BBox'))).map(num);
              const M = m.length === 6 ? mul(m, g.ctm) : g.ctm;
              if (bx.length !== 4 || overlap(quadBox(M, bx[0], bx[1], bx[2], bx[3]), R, 0)) fail('form XObject under a censor');
            }
            break;
          }
        }
      }
      return { bytes, edits, images, removed };
    }
    async function redact(out, page, R, rasterImg) {
      const { bytes, edits, images, removed } = run(page, R);
      const reps = edits.map(([o, s]) => [o.start, o.end, s]);
      let n = 0;
      if (images.length) {
        const res = page.node.Resources();
        let xo = res.lookup(N('XObject'));
        for (const im of images) {
          const ref = await rasterImg(im.bb);
          if (!ref) fail('image could not be redacted');
          const name = 'BpdfRedact' + (n++);
          xo.set(N(name), ref);
          const [x0, y0, x1, y1] = im.bb;
          reps.push([im.o.start, im.o.end, 'q ' + inv(im.ctm).map(fmt).join(' ') + ' cm ' + [x1 - x0, 0, 0, y1 - y0, x0, y0].map(fmt).join(' ') + ' cm /' + name + ' Do Q']);
        }
      }
      reps.sort((a, b) => a[0] - b[0]);
      const enc = new TextEncoder(), chunks = [enc.encode('q\n')]; let p = 0;
      reps.forEach(([s, e, t]) => { chunks.push(bytes.subarray(p, s), enc.encode(t)); p = e; });
      chunks.push(bytes.subarray(p), enc.encode('\nQ\n'));
      const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0;
      chunks.forEach(c => { all.set(c, o); o += c.length; });
      page.node.set(N('Contents'), out.context.register(out.context.flateStream(all)));
      const annots = page.node.Annots && page.node.Annots();
      let dropped = 0;
      if (annots) {
        const keep = annots.asArray().filter(r => { const a = out.context.lookup(r), rc = a && a.lookup && arr(a.lookup(N('Rect'))).map(num); const hit = rc && rc.length === 4 && overlap([Math.min(rc[0], rc[2]), Math.min(rc[1], rc[3]), Math.max(rc[0], rc[2]), Math.max(rc[1], rc[3])], R, 0); if (hit) dropped++; return !hit; });
        page.node.set(N('Annots'), out.context.obj(keep));
      }
      return { removed, images: images.length, dropped };
    }
    return { redact };
  })();
  const RASTER_DPI = 250;
  async function rasterPage(out, f, i, ann) {
    const page = await (await getDoc(f)).getPage(i + 1);
    const v1 = page.getViewport({ scale: 1 }), k = RASTER_DPI / 72, vp = page.getViewport({ scale: k });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    ctx.setTransform(c.width / v1.width, 0, 0, c.height / v1.height, 0, 0); drawBoxes(ctx, ann);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    c.width = c.height = 0;
    const img = await out.embedJpg(await blob.arrayBuffer());
    const pg = out.addPage([v1.width, v1.height]);
    pg.drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
    return pg;
  }
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
      const firstPage = new Map(), redacted = [], rastered = [];
      let done = 0;
      for (const r of L) {
        for (const p of r.refs) {
          txt.textContent = 'Building (' + (++done) + ' of ' + total + ')';
          bar.value = done / total;
          try {
            if (!srcs.has(p.f)) srcs.set(p.f, await PDFDocument.load(await files.get(p.f).file.arrayBuffer(), { ignoreEncryption: true }));
            const src = srcs.get(p.f);
            if (p.i >= src.getPageCount()) throw new Error('range');
            const ann = p.it && p.it.ann && p.it.ann[p.i];
            let cp;
            if (ann && ann.some(o => o.k === 'cen')) {
              [cp] = await out.copyPages(src, [p.i]); out.addPage(cp);
              const where = p.f + ' p' + (p.i + 1);
              try {
                const cache = {};
                const info = await RD.redact(out, cp, cenRects(cp, ann), bb => rasterRegion(out, cache, p.f, p.i, ann, bb));
                flatten(cp, ann);
                redacted.push(where + ' (' + info.removed + ' characters removed' + (info.images ? ', ' + info.images + ' image' + (info.images === 1 ? '' : 's') + ' blacked out' : '') + ')');
              } catch (e) {
                out.removePage(out.getPageCount() - 1);
                cp = await rasterPage(out, p.f, p.i, ann);
                rastered.push(where + ' (' + (e.fallback || 'could not read the page') + ')');
              }
            } else { [cp] = await out.copyPages(src, [p.i]); out.addPage(cp); if (ann && ann.length) flatten(cp, ann); }
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
      status('"' + name + '": ' + out.getPageCount() + ' pages.' + (redacted.length ? ' Censored text removed on ' + redacted.join(', ') + '.' : '') + (rastered.length ? ' Turned into images to censor safely: ' + rastered.join(', ') + '.' : '') + (problems.length ? ' Skipped: ' + problems.join(', ') : ''));
    } finally { ov.hidden = true; }
  }

  BP.register({ id: 'section', name: 'Section builder', el: root, onFiles: addFiles, onShow: () => { refreshTemplates(); changed(true); } });
  refreshTemplates();
  changed(true);
})();
