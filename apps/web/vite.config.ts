import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(webRoot, '../..');
const formulaEngineRoot = resolve(repositoryRoot, 'apps/server/src/expression-engine');
const formulaEngineSourcePlugin = {
  name: 'formula-engine-source',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith('.')) return null;
    const resolved = resolve(dirname(importer.split('?')[0]), source);
    if (!resolved.startsWith(formulaEngineRoot + sep) || !resolved.endsWith('.js')) return null;
    return resolved.slice(0, -3) + '.ts';
  }
};

const apiProxyTarget = process.env.METADRIVE_API_PROXY_TARGET ?? 'http://127.0.0.1:10000';
// The custom-domain Pages deployment is rooted at /, not /metadrive/.
// Keep the project-path default for repositories without a custom domain; this repository is uneengine.
const pagesBase = process.env.GITHUB_PAGES_BASE_PATH ?? '/uneengine/';
if (pagesBase !== '/' && pagesBase !== '/uneengine/') {
  throw new Error('Unsupported GitHub Pages base path');
}

// Embed the identity of the *built frontend*, rather than the latest GitHub commit.
const frontendCommit = process.env.GITHUB_SHA ?? process.env.METADRIVE_RELEASE_SHA ?? null;
const frontendBuild = {
  commit: frontendCommit && /^[0-9a-f]{40}$/.test(frontendCommit) ? frontendCommit : null,
  builtAt: new Date().toISOString()
};

export default defineConfig({
  plugins: [formulaEngineSourcePlugin, react(), {
    name: 'frontend-release-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({type:'asset',fileName:'frontend-release.json',
        source:JSON.stringify(frontendBuild)});
    }
  }],
  define: {
    __METADRIVE_WEB_RELEASE__: JSON.stringify(frontendBuild)
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        login: resolve(process.cwd(), 'login/index.html')
      }
    }
  },
  base: process.env.GITHUB_PAGES === 'true' ? pagesBase : '/',
  server: {
    port: 5173,
    host: '0.0.0.0',
    fs: {
      allow: [webRoot, formulaEngineRoot]
    },
    proxy: {
      '/health': { target: apiProxyTarget },
      '/api': {
        target: apiProxyTarget,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest) => proxyRequest.removeHeader('origin'));
        }
      }
    }
  },
  preview: {
    port: 4173,
    host: '0.0.0.0'
  }
});
