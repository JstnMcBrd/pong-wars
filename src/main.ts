import './styles.css';

import { canvas } from './canvas.js';
import { controls } from './controls.js';
import { settings } from './settings.js';

// ── Orchestration ──────────────────────────────────────────────────────────

controls.onStart(() => {
  settings.lock();
});

controls.onStop(() => {
  settings.unlock();
});

// ── Animation loop ─────────────────────────────────────────────────────────

function loop(): void {
  requestAnimationFrame(loop);

  if (controls.state !== 'running') {
    return;
  }
}

requestAnimationFrame(loop);
