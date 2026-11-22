// The line icons the HUD and the touch buttons share, drawn in the current text colour.
const PATHS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  fault: '<path d="M10 2 4 13h6l-2 9 10-13h-6l2-7z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  torch: '<path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><path d="M6 6h12M12 12v2"/>',
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M6 11v2"/>',
  down: '<path d="M3 19h18"/><rect x="5" y="13" width="14" height="3" rx="1.5"/><path d="M12 3v6m-3-3 3 3 3-3"/>',
  up: '<path d="M3 19h18"/><path d="M12 15V5m-4 4 4-4 4 4"/>',
  call: '<path d="m3 11 18-5v12L3 14z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  full: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  locker: '<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M12 2v20M8 6h2M8 8h2M14 6h2M14 8h2"/>',
  rotate: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M2 9a10 10 0 0 0 3 9m17-3a10 10 0 0 0-3-9"/>',
  phone: '<rect x="7" y="5" width="10" height="17" rx="2"/><path d="M14 5V2M9.5 8.5h5v4h-5zM10 16h.01M14 16h.01M12 19h.01"/>',
  toy: '<circle cx="12" cy="13.5" r="7"/><circle cx="6.5" cy="6.5" r="2.2"/><circle cx="17.5" cy="6.5" r="2.2"/><path d="M9.5 11v.01M14.5 11v.01M10 16.5h.01M14 16.5h.01"/>',
};
export type IconName = keyof typeof PATHS;
export const icon = (name: IconName): string =>
  `<svg class="cn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
