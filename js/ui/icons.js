// Inline SVG icon set (24x24, stroke = currentColor).

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICONS = {
  play: P('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause: P('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>'),
  step: P('<path d="M5 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>'),
  reset: P('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
  undo: P('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: P('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  flask: P('<path d="M9 3h6"/><path d="M10 3v6L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9V3"/><path d="M7.5 15h9"/>'),
  folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  help: P('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
  panel: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  minus: P('<path d="M5 12h14"/>'),
  fit: P('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  grid: P('<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>'),
  vector: P('<path d="M4 20 18 6"/><path d="M11 6h7v7"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".7" fill="currentColor"/>'),
  chevron: P('<path d="m6 9 6 6 6-6"/>'),
  trash: P('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  copy: P('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  lock: P('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  record: P('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>'),
  trail: P('<path d="M3 18c4 0 5-12 9-12s5 8 9 8"/><circle cx="21" cy="14" r="1.5" fill="currentColor"/>'),
  download: P('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: P('<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>'),
  link: P('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  save: P('<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
  target: P('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  pinIcon: P('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/>'),

  // tools
  select: P('<path d="M5 3l14 8-6 1.5L10 19z" fill="currentColor" fill-opacity=".15"/>'),
  grab: P('<path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-5.5a1.5 1.5 0 0 1 3 0V10m0-3.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 14a1.6 1.6 0 0 1 2.6-1.8L8 14"/>'),
  pan: P('<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>'),
  launch: P('<circle cx="6" cy="18" r="3"/><path d="M8.5 15.5 19 5"/><path d="M13 5h6v6"/>'),
  blast: P('<path d="M12 2l1.8 5.2L19 5l-2.2 5.2L22 12l-5.2 1.8L19 19l-5.2-2.2L12 22l-1.8-5.2L5 19l2.2-5.2L2 12l5.2-1.8L5 5l5.2 2.2z"/>'),
  scissors: P('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>'),
  eraser: P('<path d="M7 21h12"/><path d="M5.5 15.5 14 7l5 5-8.5 8.5H8z"/><path d="m10.5 10.5 5 5"/>'),
  box: P('<rect x="4.5" y="6.5" width="15" height="11" rx="1.5" fill="currentColor" fill-opacity=".15"/>'),
  circle: P('<circle cx="12" cy="12" r="7.5" fill="currentColor" fill-opacity=".15"/><path d="M12 12l5-5"/>'),
  polygon: P('<path d="M12 3.5l8 5.8-3 9.2H7l-3-9.2z" fill="currentColor" fill-opacity=".15"/>'),
  wedge: P('<path d="M4 19h16L4 7z" fill="currentColor" fill-opacity=".15"/>'),
  freeform: P('<path d="M5 18c-2-4 2-6 1-10s5-5 8-2 6 2 5 7-4 4-6 6-6 3-8-1z" fill="currentColor" fill-opacity=".15"/>'),
  container: P('<path d="M5 5v14h14V5" /><path d="M7 12h10v5H7z" fill="currentColor" fill-opacity=".35" stroke="none"/>'),
  slope: P('<path d="M3 20h18L3 8z" fill="currentColor" fill-opacity=".12"/><rect x="7" y="9" width="5" height="3.5" transform="rotate(33 9.5 10.7)" fill="currentColor" fill-opacity=".5"/><path d="M15 20a4 4 0 0 0-1.4-3"/>'),
  platform: P('<path d="M3 15h18v4H3z" fill="currentColor" fill-opacity=".15"/><path d="M5 15l2-2m3 2 2-2m3 2 2-2m3 2 1-1" />'),
  track: P('<path d="M3 6c4 0 5 12 9 12s5-8 9-8"/><path d="M3 9c4 0 5 12 9 12s5-8 9-8" stroke-opacity=".4"/>'),
  conveyor: P('<rect x="3" y="9" width="18" height="6" rx="3"/><circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/><path d="M9 6h7M14 4l2 2-2 2"/>'),
  moving: P('<rect x="6" y="11" width="12" height="4" rx="1" fill="currentColor" fill-opacity=".15"/><path d="M12 3v5M12 18v3M10 5l2-2 2 2M10 19l2 2 2-2"/>'),
  pin: P('<rect x="3" y="9" width="18" height="6" rx="1.5" fill="currentColor" fill-opacity=".12"/><circle cx="12" cy="12" r="2.4"/><path d="M12 12v0"/>'),
  weld: P('<rect x="3" y="5" width="10" height="8" rx="1" fill="currentColor" fill-opacity=".12"/><rect x="11" y="11" width="10" height="8" rx="1" fill="currentColor" fill-opacity=".12"/><path d="M10 10l4 4M14 10l-4 4"/>'),
  motor: P('<circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 0 1 7 7"/><path d="M19 12l-2-2.5M19 12l2.3-2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>'),
  rope: P('<circle cx="5" cy="4" r="1.6"/><path d="M5 5.5c0 4 4 3 4 7s-3 4-1 7"/><circle cx="9" cy="20" r="2.4" fill="currentColor" fill-opacity=".3"/>'),
  rod: P('<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M6.5 6.5l11 11" stroke-width="3"/>'),
  spring: P('<path d="M3 12h3l1.5-5 3 10 3-10 3 10 1.5-5h3"/>'),
  bungee: P('<path d="M3 12h3c1 0 1.5-4 3-4s1.5 8 3 8 1.5-8 3-8 2 4 3 4h3" stroke-dasharray="0"/><circle cx="3" cy="12" r="1.3" fill="currentColor"/><circle cx="21" cy="12" r="1.3" fill="currentColor"/>'),
  chain: P('<rect x="3" y="9" width="7" height="4" rx="2" transform="rotate(-30 6.5 11)"/><rect x="9" y="10" width="7" height="4" rx="2"/><rect x="14.5" y="11" width="7" height="4" rx="2" transform="rotate(30 18 13)"/>'),
  pulley: P('<circle cx="12" cy="6" r="3.5"/><path d="M8.5 6v9M15.5 6v12"/><rect x="6.5" y="15" width="4" height="4" rx=".6" fill="currentColor" fill-opacity=".3"/><rect x="13.5" y="18" width="4" height="3" rx=".6" fill="currentColor" fill-opacity=".3"/>'),
  rail: P('<path d="M3 15h18M3 18h18"/><rect x="8" y="9" width="7" height="5" rx="1" fill="currentColor" fill-opacity=".2"/><path d="M5 11H2.5M21.5 11H19"/>'),
  pool: P('<path d="M3 5v14h18V5"/><path d="M3 11c2 1.3 3.5 1.3 5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4 0" /><path d="M3.6 12.4h16.8V18.4H3.6z" fill="currentColor" fill-opacity=".2" stroke="none"/>'),
  pour: P('<path d="M12 3c3 4.5 5.5 7.4 5.5 10.4a5.5 5.5 0 0 1-11 0C6.5 10.4 9 7.5 12 3z" fill="currentColor" fill-opacity=".2"/>'),
  faucet: P('<path d="M4 8h9a4 4 0 0 1 4 4v1"/><path d="M8 5h4"/><path d="M10 5v3"/><path d="M17 16c.8 1.2 1.3 2 1.3 2.7a1.3 1.3 0 0 1-2.6 0c0-.7.5-1.5 1.3-2.7z" fill="currentColor"/>'),
  drain: P('<ellipse cx="12" cy="12" rx="8" ry="4"/><path d="M8 12h8M9.5 10.5h5M9.5 13.5h5"/>'),
  gate: P('<path d="M5 4v16M19 4v16"/><path d="M5 12h14" stroke="#f43f5e" stroke-dasharray="2 2"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/>'),
  timer: P('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6M18.5 6.5l1.5-1.5"/>'),
  ruler: P('<rect x="2.5" y="8" width="19" height="8" rx="1.5" transform="rotate(-20 12 12)"/><path d="M7 10.5l.8 2M10.2 9.4l.5 1.2M13.4 8.2l.8 2M16.6 7.1l.5 1.2"/>'),
  label: P('<path d="M5 6h14M12 6v13M9 19h6"/>'),
  cannon: P('<path d="M6.5 15.5 17 6.5l2 2.6-9.6 9.6"/><circle cx="7.5" cy="17" r="3.2" fill="currentColor" fill-opacity=".2"/><circle cx="20" cy="4" r="1.3" fill="currentColor"/>'),
  slingshot: P('<path d="M12 21v-8M12 13 7 5M12 13l5-8"/><path d="M7 5c1 5 2 7 5 8.5 3-1.5 4-3.5 5-8.5" stroke-dasharray="1.5 2"/><circle cx="12" cy="17" r="1.6" fill="currentColor"/>'),
  wave: P('<path d="M2 12c2-6 4-6 5 0s3 6 5 0 3-6 5 0 3 6 5 0"/>'),
  attractor: P('<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="6.5" stroke-dasharray="2 2.5"/><circle cx="12" cy="12" r="10" stroke-opacity=".4"/>'),
  fan: P('<circle cx="6" cy="12" r="1.6" fill="currentColor"/><path d="M6 12c0-4 3-6 3-6s1 3-3 6zM6 12c4 0 6 3 6 3s-3 1-6-3zM6 12c0 4-3 6-3 6s-1-3 3-6z" fill="currentColor" fill-opacity=".25"/><path d="M14 8h7M14 12h8M14 16h7"/>'),
  capsule: P('<rect x="3" y="8" width="18" height="8" rx="4" fill="currentColor" fill-opacity=".15"/>'),
  boat: P('<path d="M3 11h18l-3 7H6z" fill="currentColor" fill-opacity=".15"/><path d="M12 3v8M12 4l5 5h-5"/>'),
};

export function icon(name) {
  return ICONS[name] || ICONS.box;
}

// Replace [data-icon] placeholders in a root element.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.dataset.hydrated) continue;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.dataset.hydrated = '1';
  }
}
