const strokes = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  bookmark: '<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16l-6-4-6 4z"/>',
  widgets: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  feather: '<path d="M20 4c-4-4-12 1-12 8v4h4c7 0 11-9 8-12ZM3 21l13-13m-6 6h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  leaf: '<path d="M20 3c-5 0-13 2-13 8a6 6 0 0 0 6 6c6 0 7-8 7-14ZM4 21l11-12"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'arrow-right': '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H5m6-6-6 6 6 6"/>',
  'thumb-up': '<path d="M8 10l5-7c1-.8 2 .4 2 1.7L14 9h5a2 2 0 0 1 2 2.4l-1.5 7a2 2 0 0 1-2 1.6H11l-3-1z"/><rect x="2" y="9" width="5" height="11" rx="1.4"/>',
  'thumb-down': '<g transform="rotate(180 12 12)"><path d="M8 10l5-7c1-.8 2 .4 2 1.7L14 9h5a2 2 0 0 1 2 2.4l-1.5 7a2 2 0 0 1-2 1.6H11l-3-1z"/><rect x="2" y="9" width="5" height="11" rx="1.4"/></g>',
  message: '<path d="M21 11a8.5 8.5 0 0 1-9 8 11 11 0 0 1-4-.7L3 20l1.4-4.2A7.3 7.3 0 0 1 3 11a9 8 0 0 1 18 0Z"/>',
  flag:'<path d="M5 21V4c5-5 9 5 15 0v10c-6 5-10-5-15 0"/>',
  check:'<path d="m4 12 5 5L20 6"/>', x:'<path d="m6 6 12 12M18 6 6 18"/>',
  phone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  sunrise:'<path d="M2 16h20M4 20h16M7 16a5 5 0 0 1 10 0M12 3v3M3 8l2 2m16-2-2 2"/>',
  layers:'<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5m-18 5 9 5 9-5"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  plus:'<path d="M12 4v16M4 12h16"/>', book:'<path d="M3 4c4-.5 6 .5 9 3 3-2.5 5-3.5 9-3v14c-4-.5-6.5.5-9 3-2.5-2.5-5-3.5-9-3zM12 7v14"/>'
};
export function icon(name, size = 20) {
  return '<svg aria-hidden="true" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+(strokes[name] || '')+'</svg>';
}
