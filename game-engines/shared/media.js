// Fondos animados (GIF y video) y tipografías propias subidas desde el panel.
export const isVideo = (u) => /\.(mp4|webm)(\?|#|$)/i.test(String(u || ''));
export const isGif = (u) => /\.gif(\?|#|$)/i.test(String(u || ''));
export const isAnimated = (u) => isVideo(u) || isGif(u);

/** <video> en bucle, mudo y sin controles (así el navegador lo reproduce solo), o <img> para GIF/imagen. */
export function mediaEl(url, { fit = 'cover' } = {}) {
  const el = document.createElement(isVideo(url) ? 'video' : 'img');
  if (isVideo(url)) {
    Object.assign(el, { autoplay: true, muted: true, loop: true, playsInline: true, preload: 'auto' });
    el.setAttribute('muted', '');
    el.setAttribute('playsinline', '');
    el.play?.().catch(() => {});
  } else el.alt = '';
  el.src = url;
  el.style.cssText = `position:absolute;object-fit:${fit};pointer-events:none;`;
  return el;
}

/**
 * Fondo de pantalla: si la imagen de la orientación actual es un video, se pone un <video> dentro de #bg.
 * Las imágenes y los GIF van por CSS (el GIF se anima solo).
 */
export function applyBackgroundMedia(theme = {}, orientation = 'landscape') {
  const bg = document.getElementById?.('bg');
  if (!bg) return;
  const url = orientation === 'portrait' ? (theme.backgroundMobile || theme.background) : theme.background;
  let v = bg.querySelector?.('video.bgvid');
  if (isVideo(url)) {
    if (!v || v.getAttribute('src') !== url) {
      v?.remove();
      v = mediaEl(url);
      v.className = 'bgvid';
      v.style.inset = '0';
      v.style.width = '100%';
      v.style.height = '100%';
      bg.prepend(v);
    }
  } else v?.remove();
}

/** Carga una tipografía subida (woff2/woff/ttf/otf) con el nombre dado. */
export async function loadFontFile(family, url) {
  if (!family || !url || typeof FontFace === 'undefined') return;
  try {
    const f = new FontFace(family, `url("${String(url).replace(/"/g, '%22')}")`);
    await Promise.race([f.load(), new Promise((r) => setTimeout(r, 4000))]);
    if (f.status === 'loaded') document.fonts.add(f);
  } catch (e) { console.warn('No se pudo cargar la tipografía', family, e?.message); }
}
