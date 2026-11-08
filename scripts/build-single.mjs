// Builds dist/physlab.html: the whole lab in one self-contained HTML file
// (CSS and bundled JS inlined). Requires `npm install` (esbuild).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const result = await build({ entryPoints: ['js/main.js'], bundle: true, format: 'iife', minify: true, target: 'es2020', write: false });
const js = result.outputFiles[0].text;
const css = readFileSync('css/style.css', 'utf8');
let html = readFileSync('index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="css/style.css" />', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>', `<script>\n${js}\n</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/physlab.html', html);
console.log(`dist/physlab.html written (${(html.length / 1024).toFixed(0)} kB)`);
