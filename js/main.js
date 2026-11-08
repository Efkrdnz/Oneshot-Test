// PhysLab entry point.
import { App } from './ui/app.js';

const app = new App();
window.physlab = app; // handy for debugging from the console
app.start().catch((e) => {
  console.error(e);
  const s = document.getElementById('statusHint');
  if (s) s.textContent = 'Something went wrong while starting: ' + e.message;
});
