/* Busuanzi-compatible client, served with the blog instead of a remote bootstrap.
 * Keep the original service and full-page referrer so existing counts continue.
 * No fabricated zero or localStorage counter is used when the service fails.
 */
(() => {
  'use strict';

  if (window.WonderlandPageViews) {
    window.WonderlandPageViews.load();
    return;
  }

  const metrics = ['page_pv', 'site_pv', 'site_uv'];
  let active = null;
  let sequence = 0;

  function elements() {
    return metrics.map(key => [key, document.getElementById(`busuanzi_value_${key}`)])
      .filter(([, element]) => element);
  }

  function clearRetry(element) {
    element.onclick = null;
    element.onkeydown = null;
    element.removeAttribute('role');
    element.removeAttribute('tabindex');
    element.style.cursor = '';
  }

  function loading() {
    elements().forEach(([, element]) => {
      clearRetry(element);
      element.textContent = '加载中…';
      element.title = '正在读取浏览量';
      element.setAttribute('aria-live', 'polite');
    });
  }

  function unavailable() {
    elements().forEach(([, element]) => {
      element.textContent = '暂不可用，重试';
      element.title = '统计服务暂时无法连接，点击重试';
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.style.cursor = 'pointer';
      element.onclick = () => load(true);
      element.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          load(true);
        }
      };
    });
  }

  function load(force = false) {
    const page = window.location.href;
    if (active && active.page === page && !force) return;
    if (active) active.cleanup();
    loading();

    const callback = `WonderlandBusuanzi_${Date.now()}_${++sequence}`;
    const script = document.createElement('script');
    let timer;
    let finished = false;
    const request = {
      page,
      cleanup() {
        finished = true;
        window.clearTimeout(timer);
        script.remove();
        delete window[callback];
      }
    };
    active = request;

    const fail = () => {
      if (finished || active !== request) return;
      request.cleanup();
      if (window.location.href === page) unavailable();
    };

    window[callback] = data => {
      if (finished || active !== request) return;
      if (window.location.href !== page) {
        request.cleanup();
        return;
      }
      const values = elements();
      const validCount = value => (typeof value === 'number' || typeof value === 'string') &&
        /^\d+$/.test(String(value));
      if (!data || values.some(([key]) => !validCount(data[key]))) {
        fail();
        return;
      }
      values.forEach(([key, element]) => {
        clearRetry(element);
        element.textContent = String(data[key]);
        element.title = '浏览量由不蒜子统计';
        const container = document.getElementById(`busuanzi_container_${key}`);
        if (container) container.style.display = 'inline';
      });
      request.cleanup();
    };

    script.async = true;
    script.referrerPolicy = 'no-referrer-when-downgrade';
    script.src = `https://busuanzi.ibruce.info/busuanzi?jsonpCallback=${callback}`;
    script.onerror = fail;
    // Retry only on an explicit click; a timed-out request might already count.
    timer = window.setTimeout(fail, 12000);
    document.head.appendChild(script);
  }

  window.WonderlandPageViews = { load };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => load(), { once: true });
  } else {
    load();
  }
})();
