// Entry point. Preact mounts the entire app into #app. The <style>
// block and early-theme-apply script stay in the Python HTML template
// (site.html); everything else renders here.
import { render } from 'preact';
import { App } from './components/App';
import { registerServiceWorker } from './registerSW';

const container = document.getElementById('app');
if (!container) {
  throw new Error('bm-camps: missing #app container in HTML shell');
}
render(<App />, container);

// Install the SW after render so initial paint isn't blocked. Once
// registered, subsequent loads (including in new tabs with no network)
// are served from cache.
registerServiceWorker();
