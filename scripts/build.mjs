// Build: bundles src/ into dist/ (the installable web app), and also writes
// dist/artifact.html — a single-file copy for previewing inside Claude.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari14'],
  outfile: join(out, 'app.js'),
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

// The drawing reader (Anthropic SDK) is big, so it is its own file, loaded on demand
await build({
  entryPoints: ['src/drawingai.js'],
  bundle: true,
  format: 'iife',
  globalName: 'FSCFReader',
  target: ['es2020', 'safari14'],
  outfile: join(out, 'reader.js'),
  minify: true,
  legalComments: 'none',
});

// Single-file version for the Claude artifact preview
const css = readFileSync(join(out, 'styles.css'), 'utf8');
const js = readFileSync(join(out, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const artifact = `<title>FSCF Ireland</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#23282d">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@600;700&display=swap">
<style>
${css}
</style>
<div id="app"></div>
<div id="sheet-root"></div>
<script>
${js}
</script>
`;
writeFileSync(join(out, 'artifact.html'), artifact);
console.log('Built dist/ (app.js %d KB, artifact.html %d KB)', Math.round(js.length / 1024), Math.round(artifact.length / 1024));

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const body = readFileSync(join(out, p));
      res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }).listen(5173, () => console.log('Serving on http://localhost:5173'));
}
