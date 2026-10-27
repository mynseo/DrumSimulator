// claude.ai 아티팩트(단일 HTML 페이지)로 빌드한다.
// three.js는 jsDelivr에서 import map으로 불러오고, 앱 JS·CSS는 페이지 안에 넣는다.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
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
rmSync(join(outDir, 'models'), { recursive: true, force: true });

console.log(`${outFile} (${(page.length / 1024).toFixed(0)} KB, three@${THREE_VERSION} from jsDelivr)`);

// 샘플 파일은 페이지 옆에 같은 경로로 함께 올려야 한다 (페이지가 상대 경로로 불러온다)
const samples = readdirSync('public/samples/acoustic').filter((f) => f.endsWith('.mp3'));
console.log(`함께 올릴 파일: ${samples.length}개 → samples/acoustic/*.mp3 (public/samples/acoustic에서)`);
// 아티팩트 호스팅은 .glb를 내주지 않으므로, 모든 데이터를 안에 넣은 glTF JSON(.json)으로 바꿔 둔다
const io = new NodeIO();
mkdirSync(join(outDir, 'models'), { recursive: true });
for (const f of readdirSync('public/models').filter((f) => f.endsWith('.glb'))) {
  const { json, resources } = await io.writeJSON(await io.read(join('public/models', f)));
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!item.uri || !resources[item.uri]) continue;
    const mime = item.mimeType ?? 'application/octet-stream';
    item.uri = `data:${mime};base64,${Buffer.from(resources[item.uri]).toString('base64')}`;
  }
  const out = join(outDir, 'models', f.replace(/\.glb$/, '.json'));
  writeFileSync(out, JSON.stringify(json));
  console.log(`함께 올릴 모델: ${out} → models/${f.replace(/\.glb$/, '.json')}`);
}
