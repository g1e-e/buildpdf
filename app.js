(() => {
  const KEY = 'buildpdf.board.v1';
  const VERSION = (document.querySelector('meta[name="buildpdf-version"]') || {}).content || '0';
  const files = new Map();
  let board = { cols: [], sel: {} };
  let uid = 0;
  const id = p => p + Date.now().toString(36) + (uid++).toString(36);
  const $ = s => document.querySelector(s);
  const boardEl = $('#board');

  function defaultBoard() {
    return { cols: [], sel: {} };
  }

  function load() {
    try {
      const b = JSON.parse(localStorage.getItem(KEY));
      if (b && Array.isArray(b.cols)) { board = b; if (!board.sel || typeof board.sel !== 'object') board.sel = {}; return; }
    } catch (e) {}
    board = defaultBoard();
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify({ cols: board.cols.map(c => ({
      id: c.id, type: c.type, title: c.title, fmt: c.fmt,
      cards: c.cards.map(k => ({ id: k.id, name: k.name, files: k.files.slice() }))
    })), sel: board.sel }));
  }

  const isPdf = n => /\.pdf$/i.test(n);

  function allPaths() {
    const s = new Set();
    board.cols.forEach(c => c.cards.forEach(k => k.files.forEach(f => s.add(f))));
    return s;
  }

  function ingest(entries) {
    let skipped = 0;
    const known = allPaths();
    const tops = new Map();
    for (const { path, file } of entries) {
      const parts = path.split('/').filter(Boolean);
      if (!isPdf(parts[parts.length - 1])) { skipped++; continue; }
      files.set(path, { file, pages: null });
      if (known.has(path)) continue;
      const top = parts.length > 1 ? parts[0] : '(no folder)';
      const sub = parts.length > 2 ? parts[1] : null;
      if (!tops.has(top)) tops.set(top, new Map());
      const subs = tops.get(top);
      const subName = sub || top + ' (loose files)';
      if (!subs.has(subName)) subs.set(subName, []);
      subs.get(subName).push(path);
    }
    const sorter = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    for (const [top, subs] of tops) {
      let col = board.cols.find(c => c.type === 'source' && c.title === top);
      if (!col) {
        col = { id: id('c'), type: 'source', title: top, cards: [] };
        const firstOut = board.cols.findIndex(c => c.type === 'output');
        board.cols.splice(firstOut < 0 ? board.cols.length : firstOut, 0, col);
      }
      const names = [...subs.keys()].sort(sorter);
      for (const n of names) {
        const ps = subs.get(n).sort(sorter);
        const existing = col.cards.find(k => k.name === n);
        if (existing) existing.files.push(...ps);
        else col.cards.push({ id: id('k'), name: n, files: ps });
      }
    }
    save();
    render();
    const missing = [...allPaths()].filter(p => !files.has(p)).length;
    const msgs = [];
    if (skipped) msgs.push(skipped + ' non-PDF file' + (skipped > 1 ? 's were' : ' was') + ' skipped.');
    if (missing) msgs.push(missing + ' PDF' + (missing > 1 ? 's' : '') + ' from the saved board are not loaded yet. Add the same folders again to restore them.');
    status(msgs.join('\n'));
    countPages();
  }

  function status(t) { const s = $('#status'); $('#statusText').textContent = t; s.hidden = !t; }
  $('#statusClose').onclick = () => status('');

  let counting = false;
  async function countPages() {
    if (counting) return;
    counting = true;
    for (const [p, f] of files) {
      if (f.pages !== null) continue;
      try {
        const doc = await PDFLib.PDFDocument.load(await f.file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
        f.pages = doc.getPageCount();
      } catch (e) { f.pages = -1; }
      updateCounts();
    }
    counting = false;
  }

  const selOf = (p, n) => {
    const s = board.sel[p];
    const all = [...Array(n).keys()];
    if (!Array.isArray(s)) return all;
    return all.filter(i => s.includes(i));
  };
  const setSel = (p, n, arr) => {
    const a = [...new Set(arr)].filter(i => i >= 0 && i < n).sort((x, y) => x - y);
    if (a.length === n) delete board.sel[p]; else board.sel[p] = a;
    save();
  };
  const pagesOf = list => {
    let n = 0, unknown = false;
    for (const p of list) { const f = files.get(p); if (!f || f.pages === null) unknown = true; else if (f.pages > 0) n += selOf(p, f.pages).length; }
    return { n, unknown };
  };
  const fmtPages = list => { const r = pagesOf(list); return r.n + (r.unknown ? '+' : '') + ' pg'; };
  const fileLabel = p => {
    const f = files.get(p);
    if (!f) return 'missing';
    if (f.pages === null) return '…';
    if (f.pages < 0) return 'unreadable';
    const k = selOf(p, f.pages).length;
    return k === f.pages ? f.pages + ' pg' : k + '/' + f.pages + ' pages';
  };
  const noneSel = p => { const f = files.get(p); return !!(f && f.pages > 0 && !selOf(p, f.pages).length); };

  function updateCounts() {
    document.querySelectorAll('[data-fpages]').forEach(e => { e.textContent = fileLabel(e.dataset.fpages); const li = e.closest('.file'); if (li) li.classList.toggle('nosel', noneSel(e.dataset.fpages)); });
    board.cols.forEach(c => {
      c.cards.forEach(k => { const e = document.querySelector(`[data-kcount="${k.id}"]`); if (e) e.textContent = k.files.length + ' PDF' + (k.files.length === 1 ? '' : 's') + ' · ' + fmtPages(k.files); });
      const e = document.querySelector(`[data-ccount="${c.id}"]`);
      if (e) { const all = c.cards.flatMap(k => k.files); e.textContent = c.cards.length + ' cards · ' + all.length + ' PDFs · ' + fmtPages(all); }
    });
  }

  const expanded = new Set();
  const BP = window.BuildPDF = window.BuildPDF || { builders: [], active: null };
  BP.register = b => BP.builders.push(b);
  let formatMenu = () => null;
  const findCard = kid => { for (const c of board.cols) { const i = c.cards.findIndex(k => k.id === kid); if (i >= 0) return { col: c, i, card: c.cards[i] }; } return null; };
  const baseName = p => p.split('/').pop();

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    }
    kids.flat().forEach(k => k != null && e.append(k));
    return e;
  }

  function render() {
    $('#drop').classList.toggle('compact', files.size > 0);
    boardEl.textContent = '';
    for (const c of board.cols) {
      const cardsEl = el('div', { class: 'cards', 'data-col': c.id });
      for (const k of c.cards) cardsEl.append(renderCard(c, k));
      const titleInput = el('input', { class: 'col-title', value: c.title, 'aria-label': 'List title' });
      if (c.type === 'source') titleInput.readOnly = true;
      titleInput.addEventListener('input', () => { c.title = titleInput.value; save(); });
      titleInput.addEventListener('change', render);
      const head = el('div', { class: 'col-head' },
        el('span', { class: 'tag' }, c.type === 'source' ? 'folder' : 'output'), titleInput,
        c.type === 'output' ? formatMenu(c) : null,
        el('button', { class: 'icon', title: 'Move list left', onclick: () => moveCol(c, -1) }, '◀'),
        el('button', { class: 'icon', title: 'Move list right', onclick: () => moveCol(c, 1) }, '▶'),
        el('button', { class: 'icon', title: 'Delete list', onclick: () => deleteCol(c) }, '✕'));
      const foot = c.type === 'output' ? el('div', { class: 'col-foot' }, el('button', { class: 'primary', onclick: () => buildLists([c]) }, 'Build PDF')) : null;
      boardEl.append(el('section', { class: 'col ' + c.type }, head, el('div', { class: 'col-meta', 'data-ccount': c.id }), cardsEl, foot));
      Sortable.create(cardsEl, { group: 'cards', handle: '.card-handle', animation: 150, onEnd: syncFromDom });
    }
    document.querySelectorAll('.files').forEach(f => Sortable.create(f, { group: 'files', handle: '.file-handle', animation: 150, onEnd: syncFromDom }));
    updateCounts();
  }

  function renderCard(c, k) {
    const open = expanded.has(k.id);
    const missing = k.files.some(p => !files.has(p));
    const row = el('div', { class: 'card-row' },
      el('span', { class: 'handle card-handle', title: 'Drag to move' }, '⠿'),
      el('span', { class: 'card-name', onclick: () => toggle(k.id), title: 'Show files' }, (open ? '▾ ' : '▸ ') + k.name),
      el('span', { class: 'count', 'data-kcount': k.id }));
    const card = el('div', { class: 'card' + (missing ? ' missing' : ''), 'data-card': k.id }, row);
    if (open) {
      const ul = el('ul', { class: 'files', 'data-card': k.id });
      for (const p of k.files) {
        ul.append(el('li', { class: 'file' + (files.has(p) ? '' : ' missing') + (noneSel(p) ? ' nosel' : ''), 'data-path': p, title: p },
          el('span', { class: 'handle file-handle', title: 'Drag to reorder or move to another card' }, '⠿'),
          el('span', { class: 'fname', title: 'Choose pages', onclick: () => openPicker(p) }, baseName(p)),
          el('span', { class: 'count', 'data-fpages': p }, fileLabel(p))));
      }
      card.append(ul);
    }
    return card;
  }

  function toggle(kid) { expanded.has(kid) ? expanded.delete(kid) : expanded.add(kid); render(); }

  function syncFromDom() {
    const cardMap = new Map();
    board.cols.forEach(c => c.cards.forEach(k => cardMap.set(k.id, k)));
    document.querySelectorAll('.files').forEach(ul => {
      const k = cardMap.get(ul.dataset.card);
      if (k) k.files = [...ul.querySelectorAll('.file')].map(li => li.dataset.path);
    });
    document.querySelectorAll('.cards').forEach(ce => {
      const c = board.cols.find(x => x.id === ce.dataset.col);
      c.cards = [...ce.children].map(e => cardMap.get(e.dataset.card)).filter(Boolean);
    });
    board.cols.forEach(c => c.cards = c.cards.filter(k => k.files.length));
    save();
    render();
  }

  function moveCard(kid, d) {
    const f = findCard(kid); const j = f.i + d;
    if (j < 0 || j >= f.col.cards.length) return;
    [f.col.cards[f.i], f.col.cards[j]] = [f.col.cards[j], f.col.cards[f.i]];
    save(); render();
  }
  function moveFile(k, p, d) {
    const i = k.files.indexOf(p), j = i + d;
    if (j < 0 || j >= k.files.length) return;
    [k.files[i], k.files[j]] = [k.files[j], k.files[i]];
    save(); render();
  }
  function moveCol(c, d) {
    const i = board.cols.indexOf(c), j = i + d;
    if (j < 0 || j >= board.cols.length) return;
    [board.cols[i], board.cols[j]] = [board.cols[j], board.cols[i]];
    save(); render();
  }
  function deleteCol(c) {
    if (c.cards.length && !confirm(`Delete "${c.title}"? Its ${c.cards.length} card(s) will be removed from the board (your files are not touched).`)) return;
    board.cols.splice(board.cols.indexOf(c), 1);
    save(); render();
  }

  const safeName = t => (t || 'output').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'output';

  async function buildLists(cols) {
    const ov = $('#overlay'), txt = $('#overlayText'), bar = $('#overlayBar');
    const report = [];
    ov.hidden = false;
    try {
      for (const c of cols) {
        const paths = c.cards.flatMap(k => k.files);
        if (!paths.length) { report.push(`"${c.title}" is empty, skipped.`); continue; }
        const out = await PDFLib.PDFDocument.create();
        const problems = [];
        for (let i = 0; i < paths.length; i++) {
          txt.textContent = `Building "${c.title}" (${i + 1} of ${paths.length}): ${baseName(paths[i])}`;
          bar.value = i / paths.length;
          const f = files.get(paths[i]);
          if (!f) { problems.push(baseName(paths[i]) + ' (not loaded)'); continue; }
          try {
            const src = await PDFLib.PDFDocument.load(await f.file.arrayBuffer(), { ignoreEncryption: true });
            f.pages = src.getPageCount();
            const idx = selOf(paths[i], f.pages);
            if (!idx.length) continue;
            const pages = await out.copyPages(src, idx);
            pages.forEach(pg => out.addPage(pg));
          } catch (e) { problems.push(baseName(paths[i]) + ' (could not be read)'); }
          await new Promise(r => setTimeout(r));
        }
        bar.value = 1;
        if (!out.getPageCount()) { report.push(`"${c.title}": no readable pages.`); continue; }
        const bytes = await out.save();
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = el('a', { href: url, download: safeName(c.title) + '.pdf' });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        report.push(`"${c.title}.pdf": ${out.getPageCount()} pages` + (problems.length ? `. Skipped: ${problems.join(', ')}` : '.'));
      }
    } finally { ov.hidden = true; updateCounts(); }
    status(report.join('\n'));
  }

  let pdfjsP = null;
  const pdfjs = () => pdfjsP || (pdfjsP = import('./lib/pdf.min.mjs?v=' + VERSION).then(m => { m.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.mjs?v=' + VERSION, location.href).href; return m; }));
  let picker = null;
  const SIZES = { S: 200, M: 300, L: 400 };
  const SKEY = 'buildpdf.thumbSize';
  const WKEY = 'buildpdf.pickerZoom';
  const clampZ = z => Math.min(4, Math.max(0.25, z));
  const pickerZoom = () => { const z = parseFloat(localStorage.getItem(WKEY)); if (z > 0) return clampZ(z); const v = localStorage.getItem(SKEY); return SIZES[v] ? SIZES[v] / 400 : 1; };

  function zoomControl(o) {
    const pct = el('button', { class: 'zc-pct', title: 'Reset to 100%', onclick: () => o.set(1) });
    const show = () => { pct.textContent = Math.round(o.get() * 100) + '%'; };
    const box = el('div', { class: 'zc', role: 'group', 'aria-label': 'Zoom' },
      el('button', { class: 'zc-out', title: 'Zoom out', onclick: () => o.set(clampZ(o.get() / 1.2)) }, '−'), pct,
      el('button', { class: 'zc-in', title: 'Zoom in', onclick: () => o.set(clampZ(o.get() * 1.2)) }, '+'),
      o.fit ? el('button', { class: 'zc-fit', title: 'Fit width', onclick: () => o.set(clampZ(o.fit())) }, 'Fit') : null,
      (o.presets || []).map(([n, z]) => el('button', { class: 'zc-pre', title: 'Size ' + n, onclick: () => o.set(z) }, n)));
    o.target.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      o.set(clampZ(o.get() * Math.exp(-e.deltaY * 0.0025)));
    }, { passive: false });
    show();
    box.refresh = show;
    return box;
  }

  function closePicker(done) {
    if (!picker) return;
    picker.obs.disconnect();
    if (picker.doc) picker.doc.destroy();
    picker.root.remove();
    const me = picker;
    picker = null;
    if (done && me.opts.onDone && me.sel) me.opts.onDone([...me.sel].sort((a, b) => a - b), me.n);
    if (me.opts.onClose) me.opts.onClose();
  }

  function openPicker(p) {
    const f = files.get(p);
    if (!f) { status(baseName(p) + ' is not loaded. Add its folder again first.'); return; }
    openPickerFor({
      file: f.file, title: baseName(p),
      initial: n => { f.pages = n; return selOf(p, n); },
      onChange: (arr, n) => setSel(p, n, arr),
      onClose: updateCounts
    });
  }

  async function openPickerFor(opts) {
    closePicker();
    const grid = el('div', { class: 'pk-grid' }, el('p', { class: 'muted' }, 'Loading pages…'));
    let zoom = pickerZoom(), settle = null;
    const zc = zoomControl({ target: grid, get: () => zoom, set: z => setZoom(z), fit: () => (grid.clientWidth - 60) / 400, presets: Object.entries(SIZES).map(([n, w]) => [n, w / 400]) });
    const counter = el('span', { class: 'pk-count' });
    const root = el('div', { class: 'overlay pk', onclick: e => { if (e.target === root) closePicker(!opts.onDone); } },
      el('div', { class: 'pk-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose pages' },
        el('div', { class: 'pk-head' },
          el('strong', { class: 'pk-title' }, opts.title), counter,
          zc,
          el('button', { onclick: () => setAll(true) }, 'Select all'),
          el('button', { onclick: () => setAll(false) }, 'Deselect all'),
          el('button', { class: 'primary pk-done', onclick: () => closePicker(true) }, opts.doneLabel || 'Done'),
          el('button', { class: 'icon', title: 'Close', onclick: () => closePicker(!opts.onDone) }, '✕')),
        el('p', { class: 'muted pk-hint' }, opts.hint || 'Click a page to include or leave it out. Shift-click to toggle a range.'),
        grid));
    document.body.append(root);
    const tw = () => Math.round(400 * zoom);
    const applySize = () => root.style.setProperty('--tw', tw() + 'px');
    applySize();
    function setZoom(z) {
      zoom = clampZ(z);
      localStorage.setItem(WKEY, zoom.toFixed(3)); applySize(); zc.refresh();
      clearTimeout(settle);
      settle = setTimeout(() => { if (picker === me && me.doc) me.thumbs.forEach(t => { const c = t.querySelector('canvas'); if (!c || +c.dataset.w !== tw()) { me.obs.unobserve(t); me.obs.observe(t); } }); }, 200);
    }
    const me = picker = { opts, root, obs: new IntersectionObserver(onSeen, { root: grid, rootMargin: '300px' }), doc: null, sel: null, n: 0, last: null, thumbs: [] };
    function paint() {
      me.thumbs.forEach((t, i) => { const on = me.sel.has(i); t.classList.toggle('on', on); t.setAttribute('aria-pressed', on); });
      counter.textContent = me.sel.size + ' of ' + me.n + ' pages selected';
      if (opts.onChange) opts.onChange([...me.sel], me.n);
    }
    function setAll(on) { if (!me.sel) return; me.sel = new Set(on ? [...Array(me.n).keys()] : []); paint(); }
    function click(i, e) {
      if (e.shiftKey && me.last !== null) {
        const on = !me.sel.has(i);
        for (let j = Math.min(me.last, i); j <= Math.max(me.last, i); j++) on ? me.sel.add(j) : me.sel.delete(j);
      } else me.sel.has(i) ? me.sel.delete(i) : me.sel.add(i);
      me.last = i; paint();
    }
    async function onSeen(entries) {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const t = en.target; me.obs.unobserve(t);
        try {
          const page = await me.doc.getPage(+t.dataset.i + 1);
          if (picker !== me) return;
          const v1 = page.getViewport({ scale: 1 });
          const w = tw();
          const old = t.querySelector('canvas');
          if (old && +old.dataset.w === w) continue;
          const vp = page.getViewport({ scale: w / v1.width * (window.devicePixelRatio || 1) });
          const cv = document.createElement('canvas');
          cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          if (picker !== me) return;
          if (w !== tw()) { page.cleanup(); continue; }
          cv.dataset.w = w;
          const img = t.querySelector('.pk-img'); img.textContent = ''; img.append(cv);
          page.cleanup();
        } catch (e) { t.querySelector('.pk-img').textContent = 'Preview unavailable'; }
      }
    }
    try {
      const lib = await pdfjs();
      const data = new Uint8Array(await opts.file.arrayBuffer());
      const doc = await lib.getDocument({ data, isEvalSupported: false, disableFontFace: false, useSystemFonts: true }).promise;
      if (picker !== me) { doc.destroy(); return; }
      me.doc = doc; me.n = doc.numPages;
      me.sel = new Set(opts.initial ? opts.initial(me.n) : [...Array(me.n).keys()]);
      grid.textContent = '';
      for (let i = 0; i < me.n; i++) {
        const t = el('button', { class: 'pk-thumb', 'data-i': i, title: 'Page ' + (i + 1), onclick: e => click(i, e) },
          el('div', { class: 'pk-img' }), el('span', { class: 'pk-check' }, '✓'), el('span', { class: 'pk-num' }, 'Page ' + (i + 1)),
          opts.onEdit ? el('span', { class: 'pk-edit', role: 'button', tabindex: '0', title: 'Edit page ' + (i + 1), onclick: e => { e.stopPropagation(); opts.onEdit(i); } }, '✎ Edit') : null);
        me.thumbs.push(t); grid.append(t); me.obs.observe(t);
      }
      paint();
    } catch (e) {
      grid.textContent = 'This PDF could not be opened for previews.';
    }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && picker) closePicker(!picker.opts.onDone); });
  document.addEventListener('mousedown', e => { if (e.shiftKey && e.target.closest && e.target.closest('.pk-thumb')) e.preventDefault(); });

  async function readDropped(items) {
    const out = [];
    const readAll = r => new Promise((res, rej) => { const acc = []; const step = () => r.readEntries(es => { if (!es.length) res(acc); else { acc.push(...es); step(); } }, rej); step(); });
    async function walk(entry, prefix) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        out.push({ path: prefix + entry.name, file });
      } else if (entry.isDirectory) {
        for (const e of await readAll(entry.createReader())) await walk(e, prefix + entry.name + '/');
      }
    }
    const entries = [...items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    for (const e of entries) await walk(e, '');
    return out;
  }

  const input = $('#folderInput');
  const pick = () => { input.value = ''; input.click(); };
  $('#chooseFolders').onclick = pick;
  $('#addFolders').onclick = pick;
  input.addEventListener('change', () => ingest([...input.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f }))));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } }));
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', async e => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); drop.classList.remove('over');
    const b = BP.builders.find(x => x.id === BP.active);
    const entries = await readDropped(e.dataTransfer.items);
    if (b && b.onFiles) b.onFiles(entries); else ingest(entries);
  });
  $('#addList').onclick = () => { board.cols.push({ id: id('c'), type: 'output', title: 'New list', cards: [] }); save(); render(); boardEl.scrollLeft = boardEl.scrollWidth; };
  $('#buildAll').onclick = () => buildLists(board.cols.filter(c => c.type === 'output'));
  $('#clearBoard').onclick = () => {
    if (!confirm('Clear the whole board and saved layout? Your files are not touched.')) return;
    localStorage.removeItem(KEY); files.clear(); expanded.clear(); board = defaultBoard(); save(); status(''); render();
  };

  const FKEY = 'buildpdf.formats';
  const itemKey = n => {
    const base = String(n).replace(/\.pdf$/i, '');
    const stripped = base.replace(/^\s*\d[\d._-]*[\s._-]+/, '');
    return (stripped.trim() ? stripped : base).trim().replace(/\s+/g, ' ').toLowerCase();
  };
  const parentName = p => { const a = p.split('/').filter(Boolean); return a.length > 1 ? a[a.length - 2] : ''; };
  const itemCard = it => typeof it === 'string' ? it : it && it.card;
  const ci = n => String(n).trim().toLowerCase();
  const saveFormats = f => localStorage.setItem(FKEY, JSON.stringify(f));
  function migrate(f) {
    let changed = false;
    for (const [n, v] of Object.entries(f)) {
      if (!v || !Array.isArray(v.lists)) continue;
      changed = true;
      delete f[n];
      for (const l of v.lists) {
        let nm = n + ' – ' + l.name, j = 2;
        while (f[nm]) nm = n + ' – ' + l.name + ' (' + j++ + ')';
        f[nm] = { items: Array.isArray(l.items) ? l.items : [], pages: v.pages && typeof v.pages === 'object' ? Object.assign({}, v.pages) : {} };
      }
    }
    return changed;
  }
  function loadFormats() {
    let f;
    try { f = JSON.parse(localStorage.getItem(FKEY)); } catch (e) {}
    if (!f || typeof f !== 'object' || Array.isArray(f)) f = {};
    if (migrate(f)) saveFormats(f);
    for (const k of Object.keys(f)) if (!f[k] || !Array.isArray(f[k].items)) delete f[k];
    return f;
  }
  const names = () => Object.keys(loadFormats()).sort((a, b) => a.localeCompare(b));

  function snapshotList(c) {
    const pages = {}, fileKeys = new Set();
    const items = c.cards.map(k => {
      const ck = itemKey(k.name);
      k.files.forEach(p => { const fk = itemKey(baseName(p)); fileKeys.add(fk); if (Array.isArray(board.sel[p])) pages[fk] = board.sel[p].slice(); });
      const foreign = k.files.some(p => itemKey(parentName(p)) !== ck);
      return foreign ? { card: ck, files: k.files.map(p => itemKey(baseName(p))) } : ck;
    });
    return { items, pages, fileKeys };
  }

  function mergeList(old, cur) {
    const items = cur.items.slice();
    const keys = new Set(items.map(itemCard));
    (old.items || []).forEach((it, i) => { if (!keys.has(itemCard(it))) items.splice(Math.min(i, items.length), 0, it); });
    const pages = Object.assign({}, old.pages || {});
    cur.fileKeys.forEach(k => delete pages[k]);
    Object.assign(pages, cur.pages);
    return { items, pages };
  }

  function applyToList(col, fmt) {
    let placed = 0;
    const notFound = [], used = new Set();
    const findCardByKey = key => {
      for (const c of board.cols) for (const k of c.cards) if (!used.has(k) && itemKey(k.name) === key) return { c, k };
      return null;
    };
    const takeFile = (key, except) => {
      for (const c of board.cols) for (const k of c.cards) {
        if (k === except) continue;
        const i = k.files.findIndex(p => itemKey(baseName(p)) === key);
        if (i >= 0) return k.files.splice(i, 1)[0];
      }
      return null;
    };
    const ordered = [];
    for (const it of fmt.items || []) {
      const key = itemCard(it);
      const hit = findCardByKey(key);
      let card;
      if (hit) { hit.c.cards.splice(hit.c.cards.indexOf(hit.k), 1); card = hit.k; placed++; }
      else if (it && Array.isArray(it.files)) card = { id: id('k'), name: key, files: [] };
      else { notFound.push(key); continue; }
      used.add(card);
      if (it && Array.isArray(it.files)) {
        const got = [];
        for (const fk of it.files) {
          const own = card.files.findIndex(p => itemKey(baseName(p)) === fk);
          if (own >= 0) { got.push(card.files.splice(own, 1)[0]); continue; }
          const p = takeFile(fk, card);
          if (p) { got.push(p); placed++; } else notFound.push(fk);
        }
        card.files = got.concat(card.files);
        if (!hit && !card.files.length) { notFound.push(key); continue; }
      }
      ordered.push(card);
    }
    col.cards = ordered.concat(col.cards);
    let pg = 0;
    const pages = fmt.pages || {};
    col.cards.forEach(k => k.files.forEach(p => {
      const fk = itemKey(baseName(p));
      if (Array.isArray(pages[fk])) { board.sel[p] = pages[fk].filter(Number.isInteger).sort((a, b) => a - b); pg++; }
    }));
    board.cols.forEach(c => c.cards = c.cards.filter(k => k.files.length));
    save(); render();
    status('Placed ' + placed + ' item' + (placed === 1 ? '' : 's') + ' in "' + col.title + '".' + (pg ? ' Applied page selections to ' + pg + ' file' + (pg === 1 ? '' : 's') + '.' : '') + (notFound.length ? ' Not found: ' + notFound.join(', ') : ''));
  }

  function chooseFormat(title, def) {
    return new Promise(res => {
      const list = names();
      if (!list.length) { status('There are no saved formats yet.'); res(null); return; }
      const sel = el('select', { class: 'fc-select', 'aria-label': 'Saved formats' }, list.map(n => el('option', { value: n }, n)));
      if (def && list.includes(def)) sel.value = def;
      const done = v => { root.remove(); document.removeEventListener('keydown', key, true); res(v); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } else if (e.key === 'Enter') { e.preventDefault(); done(sel.value); } };
      const root = el('div', { class: 'overlay fc', onclick: e => { if (e.target === root) done(null); } },
        el('div', { class: 'overlay-box fc-box', role: 'dialog', 'aria-modal': 'true' },
          el('p', {}, el('strong', {}, title)), sel,
          el('div', { class: 'fc-btns' },
            el('button', { onclick: () => done(null) }, 'Cancel'),
            el('button', { class: 'primary fc-ok', onclick: () => done(sel.value) }, 'OK'))));
      document.body.append(root);
      document.addEventListener('keydown', key, true);
      sel.focus();
    });
  }

  function askName(msg, def) {
    const n = (prompt(msg, def) || '').trim();
    if (!n) return null;
    if (loadFormats()[n] && !confirm(`A format named "${n}" already exists. Overwrite it?`)) return null;
    return n;
  }

  function relink(from, to) { board.cols.forEach(c => { if (c.fmt === from) c.fmt = to || undefined; }); save(); render(); }

  async function formatAction(c, act) {
    const f = loadFormats();
    if (act === 'save') {
      const n = askName('Save this list as a format named:', c.title); if (!n) return;
      const s = snapshotList(c); f[n] = { items: s.items, pages: s.pages }; saveFormats(f);
      c.fmt = n; save(); render(); status(`Saved "${c.title}" as format "${n}".`);
    } else if (act === 'update') {
      if (!c.fmt || !f[c.fmt]) { status(`"${c.title}" isn't linked to a format yet. Save it as a format or load one first.`); return; }
      f[c.fmt] = mergeList(f[c.fmt], snapshotList(c)); saveFormats(f); status(`Updated format "${c.fmt}" from "${c.title}".`);
    } else if (act === 'load') {
      const n = await chooseFormat(`Load a format into "${c.title}"`, c.fmt); if (!n) return;
      c.fmt = n; applyToList(c, loadFormats()[n]);
    } else if (act === 'rename') {
      const n = await chooseFormat('Rename which format?', c.fmt); if (!n) return;
      const m = askName('New name:', n); if (!m || m === n) return;
      const g = loadFormats(); g[m] = g[n]; delete g[n]; saveFormats(g); relink(n, m); status(`Renamed format "${n}" to "${m}".`);
    } else if (act === 'delete') {
      const n = await chooseFormat('Delete which format?', c.fmt); if (!n) return;
      if (!confirm(`Delete the format "${n}"? This can't be undone.`)) return;
      const g = loadFormats(); delete g[n]; saveFormats(g); relink(n, null); status(`Deleted format "${n}".`);
    }
  }

  formatMenu = c => {
    const s = el('select', { class: 'fmt-menu', 'aria-label': 'Format', title: c.fmt ? 'Linked format: ' + c.fmt : 'Format' },
      el('option', { value: '' }, 'Format'),
      el('option', { value: 'save' }, 'Save as format…'),
      el('option', { value: 'update' }, c.fmt ? `Update format "${c.fmt}"` : 'Update format (not linked)'),
      el('option', { value: 'load' }, 'Load format into this list…'),
      el('option', { value: 'rename' }, 'Rename a format…'),
      el('option', { value: 'delete' }, 'Delete a format…'));
    s.addEventListener('change', () => { const a = s.value; s.value = ''; if (a) formatAction(c, a); });
    return s;
  };

  $('#fmtFromList').onclick = async () => {
    const n = await chooseFormat('Create a new list from which format?'); if (!n) return;
    const c = { id: id('c'), type: 'output', title: n, cards: [], fmt: n };
    board.cols.push(c); applyToList(c, loadFormats()[n]); boardEl.scrollLeft = boardEl.scrollWidth;
  };
  $('#fmtExport').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(loadFormats(), null, 2)], { type: 'application/json' }));
    const a = el('a', { href: url, download: 'buildpdf-formats.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const fIn = $('#fmtFile');
  $('#fmtImport').onclick = () => { fIn.value = ''; fIn.click(); };
  fIn.addEventListener('change', async () => {
    const file = fIn.files[0]; if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) {}
    if (!data || typeof data !== 'object' || Array.isArray(data)) { status('That file is not a valid formats file.'); return; }
    migrate(data);
    const f = loadFormats(); let n = 0, skipped = 0;
    for (const [name, v] of Object.entries(data)) {
      if (!v || !Array.isArray(v.items)) { skipped++; continue; }
      if (f[name] && !confirm(`A format named "${name}" already exists. Overwrite it with the imported one?`)) { skipped++; continue; }
      f[name] = { items: v.items, pages: v.pages && typeof v.pages === 'object' ? v.pages : {} }; n++;
    }
    saveFormats(f); render();
    status('Imported ' + n + ' format' + (n === 1 ? '' : 's') + '.' + (skipped ? ' Skipped ' + skipped + '.' : ''));
  });
  loadFormats();

  if (new URLSearchParams(location.search).has('r')) history.replaceState(null, '', location.pathname + location.hash);
  $('#refreshSite').onclick = () => {
    if (files.size && !confirm('Updating reloads the page. Your board, lists, formats and page selections are kept, but you will need to add your folders again. Continue?')) return;
    location.replace(location.pathname + '?r=' + Date.now() + location.hash);
  };
  async function checkVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
      const v = (await r.json()).version;
      const newer = !!v && v !== VERSION;
      $('#updDot').hidden = !newer;
      $('#refreshSite').title = newer ? 'A newer version is available. Click to update.' : 'Load the latest version of buildpdf';
    } catch (e) {}
  }
  checkVersion();
  setInterval(checkVersion, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });

  Object.assign(BP, { zoomControl, clampZ, el, status, pdfjs, openPicker: openPickerFor, readDropped, VERSION, baseName, isPdf });
  BP.register({ id: 'board', name: 'Board builder', el: document.getElementById('builder-board') });
  load();
  render();
  if (allPaths().size) status('Your saved layout was restored. Add the same folders again to load the files.');
})();
