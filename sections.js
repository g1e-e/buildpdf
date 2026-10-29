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
  S.sections.forEach(s => {
    s.fields = s.fields || []; s.values = s.values || {};
    if (!Array.isArray(s.items)) {
      s.items = [];
      (s.pages || []).forEach(p => { const last = s.items[s.items.length - 1]; if (last && last.f === p.f) last.pages.push(p.i); else s.items.push({ id: id(), f: p.f, pages: [p.i] }); });
    }
    delete s.pages;
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
      onEdit: i => openEditor(sec, it, i),
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
            ne ? el('button', { class: 'sb-edits', title: 'Remove all edits on this file in this section', onclick: () => { if (confirm('Remove ' + ne + ' edit' + (ne === 1 ? '' : 's') + ' on ' + it.f + ' in "' + sec.title + '"?')) { delete it.ann; changed(true); } } }, '✎ ' + ne + ' ✕') : null,
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
        paintAnn(t, t._it, i, +cv.dataset.dw, +cv.dataset.dh);
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
        const t = el('div', { class: 'sb-page', 'data-f': p.f, 'data-i': p.i, title: 'Click to edit this page', onclick: () => openEditor(r.sec, p.it, p.i) });
        t._it = p.it;
        const cv = thumbs.get(p.f + '\u0000' + p.i + '\u0000' + pw());
        if (cv) { const node = document.createElement('canvas'); node.width = cv.width; node.height = cv.height; node.dataset.w = cv.dataset.w; node.getContext('2d').drawImage(cv, 0, 0); t.append(node); paintAnn(t, p.it, p.i, +cv.dataset.dw, +cv.dataset.dh); }
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

  const wrapText = (text, maxW, measure) => {
    const out = [];
    String(text).split('\n').forEach(par => {
      let line = '';
      par.split(/(\s+)/).forEach(tok => {
        if (!tok) return;
        const tryL = line + tok;
        if (measure(tryL) <= maxW || !line) {
          if (measure(tryL) > maxW && !line.trim()) {
            let chunk = '';
            for (const ch of tok) { if (measure(chunk + ch) > maxW && chunk) { out.push(chunk); chunk = ''; } chunk += ch; }
            line = chunk;
          } else line = tryL;
        } else { out.push(line.replace(/\s+$/, '')); line = tok.trim() ? tok : ''; }
      });
      out.push(line.replace(/\s+$/, ''));
    });
    return out;
  };
  const isInk = o => o.t === 'hl' || o.t === 'pen' || o.t === 'er';
  function drawInk(ctx, ops) {
    ops.forEach(o => {
      if (!isInk(o)) return;
      ctx.save();
      ctx.globalCompositeOperation = o.t === 'er' ? 'destination-out' : 'source-over';
      ctx.globalAlpha = o.t === 'er' ? 1 : (o.o == null ? 1 : o.o);
      if (o.t === 'hl') { ctx.fillStyle = o.c; ctx.fillRect(o.x, o.y, o.w, o.h); }
      else {
        ctx.strokeStyle = o.t === 'er' ? '#000' : o.c; ctx.lineWidth = o.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); o.p.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        if (o.p.length === 1) ctx.lineTo(o.p[0][0] + 0.01, o.p[0][1]);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
  const FONT = 'Helvetica, Arial, sans-serif';
  function drawTexts(ctx, ops) {
    ops.forEach(o => {
      if (o.t !== 'text' || !o.text) return;
      ctx.save(); ctx.font = o.size + 'px ' + FONT; ctx.fillStyle = o.c; ctx.textBaseline = 'alphabetic';
      wrapText(o.text, o.w, s => ctx.measureText(s).width).forEach((ln, k) => ctx.fillText(ln, o.x, o.y + o.size * (0.9 + 1.2 * k)));
      ctx.restore();
    });
  }
  function paintAnn(t, it, i, dw, dh) {
    t.querySelectorAll('.sb-ann').forEach(c => c.remove());
    const ops = it && it.ann && it.ann[i];
    if (!ops || !ops.length || !dw) return;
    const dpr = window.devicePixelRatio || 1, W = pw(), k = W / dw * dpr;
    const cv = el('canvas', { class: 'sb-ann' });
    cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(W * dh / dw * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0); drawInk(ctx, ops);
    ctx.setTransform(k, 0, 0, k, 0, 0); drawTexts(ctx, ops);
    t.append(cv);
  }
  const annCount = it => Object.values(it.ann || {}).reduce((a, l) => a + l.length, 0);

  const HL = [['Yellow', '#ffe14d'], ['Green', '#5ee27a'], ['Pink', '#ff6fb5'], ['Blue', '#5cc8ff']];
  const EKEY = 'buildpdf.editor';
  async function openEditor(sec, it, i) {
    const f = files.get(it.f);
    if (!f) { status(it.f + ' is not loaded. Add it again first.'); return; }
    const pref = Object.assign({ tool: 'text', hl: HL[0][1], ho: 0.35, pc: '#d92d20', pw: 3, es: 18, ts: 14, tc: '#111111', z: 1 }, JSON.parse(localStorage.getItem(EKEY) || '{}'));
    const savePref = () => localStorage.setItem(EKEY, JSON.stringify(pref));
    let ops = JSON.parse(JSON.stringify((it.ann && it.ann[i]) || []));
    let sel = -1, hist = [], fut = [], dw = 612, dh = 792, page = null, bgTimer = null;
    const s = () => pref.z * 1.5;
    const snap = () => { hist.push(JSON.stringify(ops)); if (hist.length > 200) hist.shift(); fut = []; };
    const store = () => { it.ann = it.ann || {}; if (ops.length) it.ann[i] = JSON.parse(JSON.stringify(ops)); else delete it.ann[i]; save(); ub.disabled = !hist.length; rb.disabled = !fut.length; };
    const bg = el('canvas', { class: 'ed-bg' }), ink = el('canvas', { class: 'ed-ink' }), objs = el('div', { class: 'ed-objs' });
    const sheet = el('div', { class: 'ed-page' }, bg, ink, objs);
    const stage = el('div', { class: 'ed-stage' }, sheet);
    const toolBtn = (k, label, tip) => el('button', { class: 'ed-tool', 'data-tool': k, title: tip, onclick: () => setTool(k) }, label);
    const num = (v, mn, mx, st, on, lab) => { const n = el('input', { type: 'number', min: mn, max: mx, step: st, value: v, class: 'ed-num', 'aria-label': lab, title: lab }); n.addEventListener('input', () => { const x = +n.value; if (x >= mn && x <= mx) on(x); }); return n; };
    const rng = (v, mn, mx, st, on, lab) => { const n = el('input', { type: 'range', min: mn, max: mx, step: st, value: v, 'aria-label': lab, title: lab }); n.addEventListener('input', () => on(+n.value)); return n; };
    const color = (v, on, lab) => { const n = el('input', { type: 'color', value: v, 'aria-label': lab, title: lab }); n.addEventListener('input', () => on(n.value)); return n; };
    const applySel = (k, v) => { const o = ops[sel]; if (!o) return; snap(); o[k] = v; store(); redraw(); };
    const optText = el('span', { class: 'ed-opts', 'data-for': 'text select' }, 'Size', num(pref.ts, 6, 96, 1, v => { pref.ts = v; savePref(); if (ops[sel] && ops[sel].t === 'text') applySel('size', v); }, 'Font size'),
      color(pref.tc, v => { pref.tc = v; savePref(); if (ops[sel] && ops[sel].t === 'text') applySel('c', v); }, 'Text color'));
    const optHl = el('span', { class: 'ed-opts', 'data-for': 'hl select' }, HL.map(([n, c]) => el('button', { class: 'ed-sw', title: n + ' highlight', 'data-c': c, style: 'background:' + c, onclick: () => { pref.hl = c; savePref(); paintSw(); if (ops[sel] && ops[sel].t === 'hl') applySel('c', c); } })),
      'Opacity', rng(pref.ho, 0.1, 0.9, 0.05, v => { pref.ho = v; savePref(); if (ops[sel] && ops[sel].t === 'hl') { ops[sel].o = v; store(); redraw(); } }, 'Highlight opacity'));
    const optPen = el('span', { class: 'ed-opts', 'data-for': 'pen' }, color(pref.pc, v => { pref.pc = v; savePref(); }, 'Pen color'), 'Width', rng(pref.pw, 1, 20, 1, v => { pref.pw = v; savePref(); }, 'Pen width'));
    const optEr = el('span', { class: 'ed-opts', 'data-for': 'er' }, 'Eraser size', rng(pref.es, 4, 80, 1, v => { pref.es = v; savePref(); }, 'Eraser size'), el('span', { class: 'muted' }, 'Drag to erase highlights and pen. Click an object to delete it.'));
    const paintSw = () => root2.querySelectorAll('.ed-sw').forEach(b => b.classList.toggle('on', b.dataset.c === pref.hl));
    const ub = el('button', { title: 'Undo (Ctrl+Z)', onclick: () => undo() }, '↶ Undo'), rb = el('button', { title: 'Redo (Ctrl+Y)', onclick: () => redo() }, '↷ Redo');
    const db = el('button', { title: 'Delete selected (Del)', onclick: () => del() }, '🗑 Delete');
    const zc = BP.zoomControl({ target: stage, get: () => pref.z, set: z => { pref.z = z; savePref(); zc.refresh(); layoutSheet(); }, fit: () => (stage.clientWidth - 40) / (dw * 1.5) });
    const root2 = el('div', { class: 'ed', role: 'dialog', 'aria-label': 'Edit page' },
      el('div', { class: 'ed-bar' },
        el('strong', { class: 'ed-title' }, it.f + ' · page ' + (i + 1) + ' · ' + (sec.title || 'Untitled')),
        el('span', { class: 'ed-tools' }, toolBtn('select', '⬚ Select', 'Select and move (V)'), toolBtn('text', 'T Text', 'Add text (T)'), toolBtn('hl', '▮ Highlight', 'Highlight (H)'), toolBtn('pen', '✎ Pen', 'Pen (P)'), toolBtn('er', '⌫ Eraser', 'Eraser (E)')),
        optText, optHl, optPen, optEr),
      el('div', { class: 'ed-bar ed-bar2' }, ub, rb, db,
        el('button', { title: 'Remove all edits on this page', onclick: () => { if (!ops.length || !confirm('Clear all edits on this page?')) return; snap(); ops = []; sel = -1; store(); redraw(); } }, 'Clear page'),
        zc, el('span', { class: 'muted' }, 'Ctrl + scroll to zoom'), el('span', { style: 'flex:1' }),
        el('button', { class: 'primary ed-done', onclick: () => close() }, 'Done')),
      stage);
    document.body.append(root2);
    function setTool(k) {
      pref.tool = k; savePref(); sel = k === 'select' ? sel : -1;
      root2.dataset.tool = k;
      root2.querySelectorAll('.ed-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === k));
      root2.querySelectorAll('.ed-opts').forEach(o => o.hidden = !o.dataset.for.split(' ').includes(k));
      sheet.style.setProperty('--es', pref.es * s() + 'px');
      redraw();
    }
    function layoutSheet() {
      const W = dw * s(), H = dh * s();
      sheet.style.width = W + 'px'; sheet.style.height = H + 'px';
      redraw();
      clearTimeout(bgTimer); bgTimer = setTimeout(drawBg, 150);
    }
    async function drawBg() {
      if (!page) return;
      const dpr = window.devicePixelRatio || 1, vp = page.getViewport({ scale: s() * dpr });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      bg.width = c.width; bg.height = c.height; bg.getContext('2d').drawImage(c, 0, 0);
    }
    function drawInkLayer(extra) {
      const dpr = window.devicePixelRatio || 1, k = s() * dpr;
      ink.width = Math.ceil(dw * k); ink.height = Math.ceil(dh * k);
      const ctx = ink.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0); drawInk(ctx, extra ? ops.concat(extra) : ops);
    }
    function bbox(o) {
      if (o.t === 'pen') { const xs = o.p.map(p => p[0]), ys = o.p.map(p => p[1]), m = o.w / 2; return { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m }; }
      return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
    }
    function redraw() {
      drawInkLayer();
      const z = s(); objs.textContent = '';
      ops.forEach((o, k) => {
        if (o.t !== 'text') return;
        const ta = el('textarea', { class: 'ed-ta', spellcheck: 'false', 'aria-label': 'Text' });
        ta.value = o.text;
        ta.style.cssText = 'font-size:' + o.size * z + 'px;color:' + o.c;
        let edited = false;
        ta.addEventListener('focus', () => { sel = k; edited = false; markSel(); });
        ta.addEventListener('input', () => { if (!edited) { snap(); edited = true; } o.text = ta.value; store(); });
        ta.addEventListener('blur', () => { if (!o.text.trim() && ops.includes(o)) { ops.splice(ops.indexOf(o), 1); sel = -1; store(); redraw(); } });
        const box = el('div', { class: 'ed-text', 'data-k': k }, ta);
        box.style.cssText = 'left:' + o.x * z + 'px;top:' + o.y * z + 'px;width:' + o.w * z + 'px;height:' + o.h * z + 'px';
        objs.append(box);
      });
      if (sel >= 0 && ops[sel] && pref.tool === 'select') {
        const b = bbox(ops[sel]);
        const sb = el('div', { class: 'ed-sel' }, ops[sel].t === 'pen' ? null : el('span', { class: 'ed-rs', title: 'Resize' }));
        sb.style.cssText = 'left:' + b.x * z + 'px;top:' + b.y * z + 'px;width:' + b.w * z + 'px;height:' + b.h * z + 'px';
        objs.append(sb);
      }
      markSel();
      ub.disabled = !hist.length; rb.disabled = !fut.length; db.disabled = !(sel >= 0 && ops[sel]);
    }
    const markSel = () => { objs.querySelectorAll('.ed-text').forEach(b => b.classList.toggle('on', +b.dataset.k === sel)); db.disabled = !(sel >= 0 && ops[sel]); };
    const pt = e => { const r = sheet.getBoundingClientRect(); return [(e.clientX - r.left) / s(), (e.clientY - r.top) / s()]; };
    function hit(x, y, inkOnly) {
      for (let k = ops.length - 1; k >= 0; k--) {
        const o = ops[k];
        if (o.t === 'er' || (inkOnly && o.t === 'text')) continue;
        if (o.t === 'pen') { if (o.p.some(([a, b]) => Math.hypot(a - x, b - y) <= o.w / 2 + 4)) return k; continue; }
        const b = bbox(o); if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k;
      }
      return -1;
    }
    function drag(e, move, up) {
      e.preventDefault();
      const id2 = e.pointerId; sheet.setPointerCapture && sheet.setPointerCapture(id2);
      const mv = ev => { if (ev.pointerId === id2) move(pt(ev), ev); };
      const end = ev => { if (ev.pointerId !== id2) return; sheet.removeEventListener('pointermove', mv); sheet.removeEventListener('pointerup', end); sheet.removeEventListener('pointercancel', end); up && up(pt(ev)); };
      sheet.addEventListener('pointermove', mv); sheet.addEventListener('pointerup', end); sheet.addEventListener('pointercancel', end);
    }
    sheet.addEventListener('pointerdown', e => {
      if (e.button) return;
      const [x, y] = pt(e), tool = pref.tool, tbox = e.target.closest('.ed-text');
      if (tool === 'text') {
        if (tbox) return;
        e.preventDefault();
        snap(); ops.push({ t: 'text', x, y: y - pref.ts * 0.6, w: Math.min(220, dw - x), h: pref.ts * 2.6, text: '', size: pref.ts, c: pref.tc });
        sel = ops.length - 1; store(); redraw();
        const ta = objs.querySelector('.ed-text[data-k="' + sel + '"] textarea'); hist.pop(); ta && setTimeout(() => ta.focus());
        hist.push(JSON.stringify(ops.slice(0, -1)));
        return;
      }
      if (tool === 'hl') {
        const o = { t: 'hl', x, y, w: 0, h: 0, c: pref.hl, o: pref.ho };
        drag(e, ([a, b]) => { o.w = a - x; o.h = b - y; drawInkLayer(o); }, () => {
          if (Math.abs(o.w) < 2 || Math.abs(o.h) < 2) { drawInkLayer(); return; }
          const b = bbox(o); snap(); ops.push(Object.assign(o, b)); store(); redraw();
        });
        return;
      }
      if (tool === 'pen' || tool === 'er') {
        if (tool === 'er' && tbox) { snap(); ops.splice(+tbox.dataset.k, 1); sel = -1; store(); redraw(); e.preventDefault(); return; }
        const o = tool === 'pen' ? { t: 'pen', p: [[x, y]], c: pref.pc, w: pref.pw, o: 1 } : { t: 'er', p: [[x, y]], w: pref.es };
        let far = 0;
        drag(e, ([a, b]) => { const l = o.p[o.p.length - 1]; if (Math.hypot(a - l[0], b - l[1]) < 0.6) return; far = Math.max(far, Math.hypot(a - x, b - y)); o.p.push([+a.toFixed(1), +b.toFixed(1)]); drawInkLayer(o); }, () => {
          if (tool === 'er' && far < 3) { const k = hit(x, y, true); drawInkLayer(); if (k >= 0) { snap(); ops.splice(k, 1); store(); redraw(); } return; }
          snap(); ops.push(o); store(); redraw();
        });
        return;
      }
      const rs = e.target.closest('.ed-rs');
      const k = rs ? sel : tbox ? +tbox.dataset.k : hit(x, y);
      sel = k; redraw();
      if (k < 0) return;
      const o = ops[k], start = JSON.stringify(ops), o0 = JSON.parse(JSON.stringify(o));
      let movedAny = false;
      drag(e, ([a, b]) => {
        const dx = a - x, dy = b - y; movedAny = true;
        if (rs) { o.w = Math.max(10, o0.w + dx); o.h = Math.max(8, o0.h + dy); }
        else if (o.t === 'pen') o.p = o0.p.map(([px, py]) => [px + dx, py + dy]);
        else { o.x = o0.x + dx; o.y = o0.y + dy; }
        redraw();
      }, () => { if (movedAny) { hist.push(start); fut = []; store(); redraw(); } });
    });
    function del() { if (!(sel >= 0 && ops[sel])) return; snap(); ops.splice(sel, 1); sel = -1; store(); redraw(); }
    function undo() { if (!hist.length) return; fut.push(JSON.stringify(ops)); ops = JSON.parse(hist.pop()); sel = -1; store(); redraw(); }
    function redo() { if (!fut.length) return; hist.push(JSON.stringify(ops)); ops = JSON.parse(fut.pop()); sel = -1; store(); redraw(); }
    const key = e => {
      const typing = e.target.closest && e.target.closest('textarea,input');
      if (e.key === 'Escape') { e.stopImmediatePropagation(); if (typing) e.target.blur(); else close(); return; }
      if (typing) return;
      const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (c && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (c && k === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
      else if (!c && { v: 'select', t: 'text', h: 'hl', p: 'pen', e: 'er' }[k]) setTool({ v: 'select', t: 'text', h: 'hl', p: 'pen', e: 'er' }[k]);
    };
    document.addEventListener('keydown', key, true);
    function close() {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.removeEventListener('keydown', key, true);
      root2.remove(); store(); renderSections(); renderPreview();
      const n = (it.ann && it.ann[i] || []).length;
      status(n ? 'Saved ' + n + ' edit' + (n === 1 ? '' : 's') + ' on ' + it.f + ' page ' + (i + 1) + '.' : 'No edits on ' + it.f + ' page ' + (i + 1) + '.');
    }
    paintSw(); setTool(pref.tool);
    try {
      const doc = await getDoc(it.f);
      page = await doc.getPage(i + 1);
      const v = page.getViewport({ scale: 1 }); dw = v.width; dh = v.height;
    } catch (e) { status('This page could not be opened for editing.'); }
    layoutSheet(); drawBg();
  }

  async function flatten(out, cp, ops, font) {
    const { degrees, rgb } = PDFLib;
    const r = ((cp.getRotation().angle % 360) + 360) % 360;
    const cb = cp.getCropBox(), x0 = cb.x, y0 = cb.y, w = cb.width, h = cb.height;
    if (ops.some(o => o.t === 'hl' || o.t === 'pen')) {
      const k = 2, Iw = Math.ceil(w * k), Ih = Math.ceil(h * k);
      const c = document.createElement('canvas'); c.width = Iw; c.height = Ih;
      const ctx = c.getContext('2d');
      const T = { 0: [k, 0, 0, k, 0, 0], 90: [0, -k, k, 0, 0, Ih], 180: [-k, 0, 0, -k, Iw, Ih], 270: [0, k, -k, 0, Iw, 0] }[r] || [k, 0, 0, k, 0, 0];
      ctx.setTransform(...T); drawInk(ctx, ops);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const img = await out.embedPng(await blob.arrayBuffer());
      cp.drawImage(img, { x: x0, y: y0, width: w, height: h });
    }
    const map = (X, Y) => ({ 0: [x0 + X, y0 + h - Y], 90: [x0 + Y, y0 + X], 180: [x0 + w - X, y0 + Y], 270: [x0 + w - Y, y0 + h - X] }[r] || [x0 + X, y0 + h - Y]);
    const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0; return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
    ops.forEach(o => {
      if (o.t !== 'text' || !o.text) return;
      wrapText(winAnsi(o.text), o.w, s => font.widthOfTextAtSize(s, o.size)).forEach((ln, j) => {
        if (!ln) return;
        const [x, y] = map(o.x, o.y + o.size * (0.9 + 1.2 * j));
        cp.drawText(ln, { x, y, size: o.size, font, color: hex(o.c), rotate: degrees(r) });
      });
    });
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
      const firstPage = new Map();
      let annFont = null;
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
            const ann = p.it && p.it.ann && p.it.ann[p.i];
            if (ann && ann.length) { annFont = annFont || await out.embedFont(StandardFonts.Helvetica); await flatten(out, cp, ann, annFont); }
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
