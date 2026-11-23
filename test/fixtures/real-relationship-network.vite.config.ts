import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Isolated synthetic data; this configuration never mounts the real OS provider.
export default defineConfig({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    plugins: [{ name: 'relationship-fixture-context', enforce: 'pre', resolveId(id) {
        if (id.endsWith('/context/OSContext')) return fileURLToPath(new URL('./real-relationship-network-state.ts', import.meta.url));
    } }],
    define: { __BUILD_BRANCH__: JSON.stringify('relationship-fixture'), __BUILD_COMMIT__: JSON.stringify('fixture'),
        __BUILD_TIME__: JSON.stringify('fixture'), __BUILD_BADGE_VISIBLE__: 'false' },
    optimizeDeps: { entries: ['test/fixtures/real-relationship-network.html'] },
    server: { host: '127.0.0.1', port: 5376, strictPort: true },
});
