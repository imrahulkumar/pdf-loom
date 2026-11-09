/* Router, theme and offline support */
(function (App) {
  'use strict';
  const root = document.getElementById('app');

  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, query] = hash.split('?');
    const params = new URLSearchParams(query || '');
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (!path) App.ui.renderHome(root, params);
    else {
      const tool = App.tools.find((t) => t.id === path);
      if (tool) App.ui.renderTool(root, tool); else App.ui.renderNotFound(root);
    }
    if (!params.get('cat')) window.scrollTo(0, 0);
    else document.querySelector('.chips')?.scrollIntoView({ block: 'start' });
    root.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', route);
  route();

  // Theme toggle (remembered per browser)
  const saved = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  document.querySelector('.theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
  });

  // Prevent the browser from opening files dropped outside a drop zone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { if (!e.target.closest('.dropzone')) e.preventDefault(); });

  // Offline cache
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})(window.App);
