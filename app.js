(() => {
  const KEY = 'buildpdf.board.v1';
  const files = new Map();
  let board = { cols: [] };
  let uid = 0;
  const id = p => p + Date.now().toString(36) + (uid++).toString(36);
  const $ = s => document.querySelector(s);
  const boardEl = $('#board');

  function defaultBoard() {
    return { cols: [
      { id: id('c'), type: 'output', title: 'General Credentialing Documents', cards: [] },
      { id: id('c'), type: 'output', title: 'Health and Physical', cards: [] }
    ] };
  }

  function load() {
    try {
      const b = JSON.parse(localStorage.getItem(KEY));
      if (b && Array.isArray(b.cols)) { board = b; return; }
    } catch (e) {}
    board = defaultBoard();
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify({ cols: board.cols.map(c => ({
      id: c.id, type: c.type, title: c.title,
      cards: c.cards.map(k => ({ id: k.id, name: k.name, files: k.files.slice() }))
    })) }));
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

  function status(t) { const s = $('#status'); s.textContent = t; s.hidden = !t; }

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

  const pagesOf = list => {
    let n = 0, unknown = false;
    for (const p of list) { const f = files.get(p); if (!f || f.pages === null) unknown = true; else if (f.pages > 0) n += f.pages; }
    return { n, unknown };
  };
  const fmtPages = list => { const r = pagesOf(list); return r.n + (r.unknown ? '+' : '') + ' pg'; };
  const fileLabel = p => {
    const f = files.get(p);
    if (!f) return 'missing';
    if (f.pages === null) return '…';
    if (f.pages < 0) return 'unreadable';
    return f.pages + ' pg';
  };

  function updateCounts() {
    document.querySelectorAll('[data-fpages]').forEach(e => e.textContent = fileLabel(e.dataset.fpages));
    board.cols.forEach(c => {
      c.cards.forEach(k => { const e = document.querySelector(`[data-kcount="${k.id}"]`); if (e) e.textContent = k.files.length + ' PDF' + (k.files.length === 1 ? '' : 's') + ' · ' + fmtPages(k.files); });
      const e = document.querySelector(`[data-ccount="${c.id}"]`);
      if (e) { const all = c.cards.flatMap(k => k.files); e.textContent = c.cards.length + ' cards · ' + all.length + ' PDFs · ' + fmtPages(all); }
    });
  }

  const expanded = new Set();
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

  function moveSelect(label, excludeId, onPick) {
    const s = el('select', { 'aria-label': label, title: label }, el('option', { value: '' }, label));
    board.cols.forEach(c => { if (c.id !== excludeId) s.append(el('option', { value: c.id }, c.title || '(untitled)')); });
    s.addEventListener('change', () => s.value && onPick(board.cols.find(c => c.id === s.value)));
    return s;
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
        ul.append(el('li', { class: 'file' + (files.has(p) ? '' : ' missing'), 'data-path': p, title: p },
          el('span', { class: 'handle file-handle', title: 'Drag to reorder or move to another card' }, '⠿'),
          el('span', { class: 'fname' }, baseName(p)),
          el('span', { class: 'count', 'data-fpages': p }, fileLabel(p)),
          moveSelect('Own card in…', null, to => splitFile(k, p, to))));
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
  function splitFile(k, p, to) {
    k.files.splice(k.files.indexOf(p), 1);
    to.cards.push({ id: id('k'), name: baseName(p).replace(/\.pdf$/i, ''), files: [p] });
    board.cols.forEach(c => c.cards = c.cards.filter(x => x.files.length));
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
            const pages = await out.copyPages(src, src.getPageIndices());
            pages.forEach(pg => out.addPage(pg));
            f.pages = src.getPageCount();
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
    ingest(await readDropped(e.dataTransfer.items));
  });
  $('#addList').onclick = () => { board.cols.push({ id: id('c'), type: 'output', title: 'New list', cards: [] }); save(); render(); boardEl.scrollLeft = boardEl.scrollWidth; };
  $('#buildAll').onclick = () => buildLists(board.cols.filter(c => c.type === 'output'));
  $('#clearBoard').onclick = () => {
    if (!confirm('Clear the whole board and saved layout? Your files are not touched.')) return;
    localStorage.removeItem(KEY); files.clear(); expanded.clear(); board = defaultBoard(); save(); status(''); render();
  };

  load();
  render();
  if (allPaths().size) status('Your saved layout was restored. Add the same folders again to load the files.');
})();
