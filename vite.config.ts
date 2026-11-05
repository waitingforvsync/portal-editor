import { defineConfig } from 'vitest/config';

export default defineConfig({
    base: './',    // assets by relative paths: GitHub Pages serves the build under /portal-editor/
    server: {
        port: 5173,
        strictPort: true,    // fail rather than move, so .vscode/launch.json's URL holds
    },
    test: {
        include: ['test/**/*.test.ts'],
    },
});
