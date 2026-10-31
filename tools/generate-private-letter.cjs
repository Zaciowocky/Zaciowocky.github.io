const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { marked } = require('marked')
const yaml = require('js-yaml')

const root = path.resolve(__dirname, '..')
const privateDir = path.join(root, 'private', 'letters')
const sourceFile = path.join(privateDir, '致小然.md')
const secretFile = path.join(privateDir, 'share-secret.json')

if (!fs.existsSync(sourceFile)) {
  throw new Error(`Private source missing: ${sourceFile}`)
}

let secret
if (fs.existsSync(secretFile)) {
  secret = JSON.parse(fs.readFileSync(secretFile, 'utf8'))
} else {
  secret = {
    slug: crypto.randomBytes(16).toString('hex'),
    key: crypto.randomBytes(32).toString('base64url')
  }
  fs.writeFileSync(secretFile, JSON.stringify(secret, null, 2) + '\n', { flag: 'wx' })
}

const key = Buffer.from(secret.key, 'base64url')
if (!/^[0-9a-f]{32}$/.test(secret.slug) || key.length !== 32) {
  throw new Error('Invalid local share secret')
}

const source = fs.readFileSync(sourceFile, 'utf8')
const frontMatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
if (!frontMatter) throw new Error('Private source needs YAML front matter')

const metadata = yaml.load(frontMatter[1])
if (!metadata.title || !metadata.date) throw new Error('Private source needs title and date')
const markdown = source.slice(frontMatter[0].length)
const payload = JSON.stringify({
  title: String(metadata.title),
  date: String(metadata.date),
  html: marked.parse(markdown)
})

const iv = crypto.randomBytes(12)
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([
  cipher.update(payload, 'utf8'),
  cipher.final(),
  cipher.getAuthTag()
])
const envelope = JSON.stringify({ iv: iv.toString('base64url'), data: encrypted.toString('base64url') })

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
  <meta name="referrer" content="no-referrer">
  <title>一封信 · Zaciowocky's Wonderland</title>
  <link rel="icon" href="/img/favicon-32.png">
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: #d8e8ef; background: #071321 url('/img/hero/wonderland-hero-v1.png') center top / cover fixed; }
    body::before { content: ''; position: fixed; inset: 0; background: linear-gradient(180deg, rgba(5,17,30,.62), rgba(5,17,30,.9)); pointer-events: none; }
    header, main { position: relative; }
    header { padding: 24px max(24px, calc((100vw - 900px)/2)); }
    header a { color: #e7d2a6; text-decoration: none; letter-spacing: .07em; }
    main { max-width: 900px; margin: 40px auto 80px; padding: clamp(28px, 6vw, 68px); border: 1px solid rgba(116,183,203,.28); border-radius: 20px; background: rgba(8,24,40,.93); box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    #status { color: #a8becb; }
    #date { color: #cbb684; font-size: .9rem; }
    article { line-height: 1.9; overflow-wrap: anywhere; }
    article h1, article h2, article h3 { color: #e5f5f5; line-height: 1.4; }
    article h1 { font-size: clamp(2rem, 5vw, 2.8rem); }
    article h2 { margin-top: 2em; border-bottom: 1px solid rgba(116,183,203,.22); padding-bottom: .25em; }
    article p { margin: 1.15em 0; }
    article blockquote { margin: 1.5em 0; padding: .2em 1.2em; border-left: 3px solid #ad925c; color: #b9cbd2; }
    article a { color: #8bd0dc; }
    article img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <header><a href="/">Zaciowocky's Wonderland</a></header>
  <main>
    <p id="status">正在打开这封信…</p>
    <p id="date" hidden></p>
    <article id="letter" hidden></article>
  </main>
  <script type="application/json" id="encrypted-letter">${envelope}</script>
  <script>
    const status = document.getElementById('status');
    const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    (async () => {
      const fragment = location.hash.slice(1);
      if (!fragment.startsWith('v1.')) throw new Error('missing key');
      const rawKey = decode(fragment.slice(3));
      if (rawKey.length !== 32) throw new Error('invalid key');
      const { iv, data } = JSON.parse(document.getElementById('encrypted-letter').textContent);
      const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, key, decode(data));
      const letter = JSON.parse(new TextDecoder().decode(plaintext));
      document.title = letter.title + " · Zaciowocky's Wonderland";
      document.getElementById('date').textContent = letter.date;
      document.getElementById('date').hidden = false;
      document.getElementById('letter').innerHTML = letter.html;
      document.getElementById('letter').hidden = false;
      status.remove();
    })().catch(() => { status.textContent = '请使用完整的分享链接打开这封信。'; });
  </script>
</body>
</html>
`

const output = path.join(root, 'source', 'letters', secret.slug, 'index.html')
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, html, 'utf8')
console.log(`Generated encrypted page: ${output}`)
console.log(`Share link: https://zaciowocky.github.io/letters/${secret.slug}/#v1.${secret.key}`)
