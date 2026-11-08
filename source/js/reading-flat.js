/* Article-only enhancements; source Markdown remains the content authority. */
(() => {
  function mount() {
    const article = document.querySelector('#post #article-container');
    if (!article) return;
    const toc = document.querySelector('#card-toc .toc-content > ol');
    if (toc && !article.querySelector('.mobile-reading-toc')) {
      const details = document.createElement('details');
      details.className = 'mobile-reading-toc';
      const summary = document.createElement('summary');
      summary.textContent = '文章目录';
      const list = toc.cloneNode(true);
      list.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      details.append(summary, list);
      article.prepend(details);
    }
    article.querySelectorAll('table').forEach(table => {
      if (table.closest('figure.highlight, .table-wrap')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrap';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', '表格，可横向滚动');
      table.before(wrapper);
      wrapper.append(table);
    });
  }
  mount();
  document.addEventListener('pjax:complete', mount);
})();
