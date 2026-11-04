'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../source/js/pageviews.js'), 'utf8');

function setup() {
  const nodes = Object.fromEntries(['page_pv', 'site_pv', 'site_uv'].map(key =>
    [`busuanzi_value_${key}`, { style: {}, setAttribute() {}, removeAttribute() {} }]));
  const scripts = [];
  const timers = new Map();
  const window = { location: { href: 'https://example.test/post/' },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const document = { readyState: 'complete', getElementById: id => nodes[id] || null,
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild(script) { scripts.push(script); } } };
  const context = vm.createContext({ window, document, Date });
  vm.runInContext(source, context);
  const reply = data => window[new URL(scripts.at(-1).src).searchParams.get('jsonpCallback')](data);
  return { nodes, scripts, timers, window, context, reply };
}

let env = setup();
assert.equal(env.scripts[0].referrerPolicy, 'no-referrer-when-downgrade');
env.reply({ page_pv: 0, site_pv: 42, site_uv: '9' });
assert.equal(env.nodes.busuanzi_value_page_pv.textContent, '0');
assert.equal(env.nodes.busuanzi_value_site_pv.textContent, '42');
vm.runInContext(source, env.context);
assert.equal(env.scripts.length, 1, 'duplicate bootstrap must not double count');

env = setup();
env.scripts[0].onerror();
assert.match(env.nodes.busuanzi_value_page_pv.textContent, /暂不可用/);
env.nodes.busuanzi_value_page_pv.onclick();
env.reply({ page_pv: 12, site_pv: 55, site_uv: 10 });
assert.equal(env.nodes.busuanzi_value_page_pv.textContent, '12');
assert.equal(env.nodes.busuanzi_value_page_pv.onclick, null);

env = setup();
[...env.timers.values()][0]();
assert.match(env.nodes.busuanzi_value_page_pv.textContent, /重试/);

env = setup();
env.reply({ page_pv: '<script>', site_pv: 1, site_uv: 1 });
assert.match(env.nodes.busuanzi_value_page_pv.textContent, /暂不可用/);

env = setup();
env.window.location.href = 'https://example.test/another-post/';
env.reply({ page_pv: 999, site_pv: 1, site_uv: 1 });
assert.notEqual(env.nodes.busuanzi_value_page_pv.textContent, '999');
env.window.WonderlandPageViews.load();
env.reply({ page_pv: 3, site_pv: 2, site_uv: 1 });
assert.equal(env.nodes.busuanzi_value_page_pv.textContent, '3');
console.log('PASS: counts, zero, error/retry, timeout, invalid response, duplicate load and navigation.');
