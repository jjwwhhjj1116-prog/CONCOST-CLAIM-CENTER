/** Mount-time FontFaceSet.ready reads force layout in Chromium. The caller performs the initial refit. */
export function watchDocumentFonts(refit: () => void): () => void {
  const fonts = document.fonts;
  if (!fonts) return () => undefined;
  let active = true, frame = 0, timer = 0;
  const loaded = () => { if (active) refit(); };
  if (Reflect.has(fonts, 'onloadingdone') && Reflect.has(fonts, 'onloadingerror')) {
    fonts.addEventListener('loadingdone', loaded);
    fonts.addEventListener('loadingerror', loaded);
  } else {
    // Retain the ready promise on older browsers, after the first rendering turn.
    frame = requestAnimationFrame(() => { timer = window.setTimeout(() => { void fonts.ready.then(loaded); }, 0); });
  }
  return () => {
    active = false;
    cancelAnimationFrame(frame); window.clearTimeout(timer);
    fonts.removeEventListener('loadingdone', loaded);
    fonts.removeEventListener('loadingerror', loaded);
  };
}
