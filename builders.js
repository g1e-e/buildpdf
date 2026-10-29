(() => {
  const BP = window.BuildPDF;
  const KEY = 'buildpdf.builder';
  const tabs = document.getElementById('tabs');
  function show(id) {
    const b = BP.builders.find(x => x.id === id) || BP.builders[0];
    BP.active = b.id;
    localStorage.setItem(KEY, b.id);
    BP.builders.forEach(x => { x.el.hidden = x !== b; });
    document.querySelectorAll('[data-for]').forEach(e => { e.hidden = e.dataset.for !== b.id; });
    tabs.querySelectorAll('button').forEach(t => { const on = t.dataset.builder === b.id; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
    document.body.dataset.builder = b.id;
    if (b.onShow) b.onShow();
  }
  BP.builders.forEach(b => tabs.append(BP.el('button', { role: 'tab', 'data-builder': b.id, onclick: () => show(b.id) }, b.name)));
  BP.show = show;
  show(localStorage.getItem(KEY) || 'board');
})();
