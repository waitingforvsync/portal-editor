import { defineConfig } from 'vitest/config';

export default defineConfig({
    server: {
        port: 5173,
        strictPort: true,    // fail rather than move, so .vscode/launch.json's URL holds
    },
    test: {
        include: ['test/**/*.test.ts'],
    },
});
