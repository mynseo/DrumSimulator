// claude.ai 아티팩트(단일 HTML 페이지)로 빌드한다.
// three.js는 jsDelivr에서 import map으로 불러오고, 앱 JS·CSS는 페이지 안에 넣는다.
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

const THREE_VERSION = JSON.parse(readFileSync('node_modules/three/package.json', 'utf8')).version;
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
const outDir = 'dist-artifact';
const outFile = process.argv[2] ?? join(outDir, 'drum-simulator.html');

process.env.VITE_TARGET = 'artifact';
await build({
  configFile: false,
  base: './',
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      external: ['three', /^three\/examples\//],
      output: { inlineDynamicImports: true },
    },
  },
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const html = readFileSync(join(outDir, 'index.html'), 'utf8');

const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[^>]*src=[^>]*><\/script>/g, '');
const importMap = { imports: { three: `${CDN}/build/three.module.min.js`, 'three/examples/jsm/': `${CDN}/examples/jsm/` } };

const page = `<title>Drum Simulator</title>
<meta name="claude:viewport-fit-sides" content="cover" />
<meta name="description" content="악보를 넣으면 3D 드러머가 실시간으로 연주하는 웹 드럼 시뮬레이터" />
<style>
${css.replaceAll('</style', '<\\/style')}
</style>
<script type="importmap">${JSON.stringify(importMap)}</script>
${body.trim()}
<script type="module">
${js.replaceAll('</script', '<\\/script')}
</script>
`;
writeFileSync(outFile, page);
rmSync(assets, { recursive: true });
console.log(`${outFile} (${(page.length / 1024).toFixed(0)} KB, three@${THREE_VERSION} from jsDelivr)`);
