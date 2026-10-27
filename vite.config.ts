import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로로 빌드해서 GitHub Pages(/DrumSimulator/)나 다른 하위 경로에서도 그대로 동작하게 한다
  base: './',
  build: {
    rollupOptions: {
      output: {
        // three.js는 잘 바뀌지 않으므로 따로 묶어 브라우저 캐시를 살린다
        manualChunks: { three: ['three'] },
      },
    },
  },
});
