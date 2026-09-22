/* Ambient homepage fairy dust; no external libraries or pointer interception. */
(() => {
  window.wonderlandDustCleanup?.();
  let disposeLayer = () => {};
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let disposeCursor = () => {};

  function watchSubtitle() {
    disposeCursor();
    const subtitle = document.querySelector('#subtitle');
    if (!subtitle) return;
    const update = () => subtitle.parentElement.classList.toggle('wonderland-typed-done',
      subtitle.textContent.trim() === 'Down the rabbit hole.');
    const observer = new MutationObserver(update);
    observer.observe(subtitle, { childList: true, characterData: true, subtree: true });
    update();
    disposeCursor = () => observer.disconnect();
  }

  function mount() {
    watchSubtitle();
    disposeLayer();
    disposeLayer = () => {};
    const header = document.querySelector('#page-header.full_page');
    if (!header || motion.matches) return;

    const layer = document.createElement('div');
    layer.className = 'wonderland-dust';
    layer.setAttribute('aria-hidden', 'true');
    const count = window.innerWidth <= 768 ? 48 : 128;
    const colors = ['#b8e9ff', '#90d3ff', '#c6b9f0', '#d6b779'];
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('span');
      particle.className = 'wonderland-dust__particle';
      const depth = Math.random();
      const duration = 24 + Math.random() * 32;
      const color = Math.random() < .08 ? colors[3] : colors[Math.floor(Math.random() * 3)];
      const values = {
        '--x': `${Math.random() * 100}%`,
        '--size': `${4 + depth * 10}px`,
        '--duration': `${duration}s`,
        '--delay': `${-Math.random() * duration}s`,
        '--twinkle': `${2 + Math.random() * 4}s`,
        '--drift': `${-45 + Math.random() * 90}px`,
        '--alpha': `${.45 + depth * .45}`,
        '--glow': color
      };
      for (const [key, value] of Object.entries(values)) particle.style.setProperty(key, value);
      layer.appendChild(particle);
    }
    header.appendChild(layer);
    const updateMask = () => {
      layer.style.setProperty('--travel', `${-header.clientHeight * 1.25}px`);
      const bounds = header.getBoundingClientRect();
      const title = header.querySelector('#site-info')?.getBoundingClientRect();
      const width = bounds.width;
      const height = bounds.height;
      // Match the centered cover crop of the 1672 x 941 background image.
      const scale = Math.max(width / 1672, height / 941);
      const cx = 1260 * scale + (width - 1672 * scale) / 2;
      const cy = 510 * scale + (height - 941 * scale) / 2;
      const textMask = title ? `<rect x="0" y="${title.top - bounds.top - 18}" width="${width}" height="${title.height + 36}" rx="18" fill="black"/>` : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><mask id="safe"><rect width="100%" height="100%" fill="white"/>${textMask}<ellipse cx="${cx}" cy="${cy}" rx="${340 * scale}" ry="${450 * scale}" fill="black"/></mask></defs><rect width="100%" height="100%" fill="white" mask="url(#safe)"/></svg>`;
      const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      layer.style.maskImage = mask;
      layer.style.webkitMaskImage = mask;
    };
    updateMask();
    const resize = new ResizeObserver(updateMask);
    resize.observe(header);
    const siteInfo = header.querySelector('#site-info');
    if (siteInfo) resize.observe(siteInfo);
    let inView = true;
    const pause = () => layer.classList.toggle('is-paused', document.hidden || !inView);
    const observer = new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      pause();
    });
    observer.observe(header);
    document.addEventListener('visibilitychange', pause);
    pause();
    disposeLayer = () => {
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener('visibilitychange', pause);
      layer.remove();
    };
  }
  document.addEventListener('pjax:complete', mount);
  motion.addEventListener('change', mount);
  window.wonderlandDustCleanup = () => {
    disposeLayer();
    disposeCursor();
    document.removeEventListener('pjax:complete', mount);
    motion.removeEventListener('change', mount);
  };
  mount();
})();
