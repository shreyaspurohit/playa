// Runtime loader for the code-split WebGPU backend (ADR 21 D6, phase 2).
//
// Lives in the MAIN bundle. It pulls in the heavy `webllm-backend.js` chunk
// (which contains @mlc-ai/web-llm) via a dynamic import with a RUNTIME-computed
// specifier — esbuild cannot statically analyze it, so it stays an external
// `import()` and web-llm never folds into the inlined main bundle. The chunk is
// served same-origin from GitHub Pages next to index.html.

import type { AssistantBackend } from './session';
import type { CatalogModel } from './modelCatalog';
import type { LoadProgress } from './webllm';

type WebllmModule = {
  loadWebllmModel: (m: CatalogModel, cb?: (p: LoadProgress) => void) => Promise<AssistantBackend>;
};

const BACKEND_FILE = 'webllm-backend.js';

async function importBackend(): Promise<WebllmModule> {
  // Non-literal specifier on purpose: keeps the import external at build time.
  const url = new URL(BACKEND_FILE, document.baseURI).href;
  return import(url) as Promise<WebllmModule>;
}

export type { LoadProgress };

export async function loadWebgpuBackend(
  model: CatalogModel,
  onProgress?: (p: LoadProgress) => void,
): Promise<AssistantBackend> {
  const mod = await importBackend();
  return mod.loadWebllmModel(model, onProgress);
}
