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

/** Carga una tipografía: archivo propio (url) o de Google Fonts (solo el nombre). */
export async function loadAnyFont(family, url) {
  if (!family || typeof document === 'undefined') return;
  if (url) return loadFontFile(family, url);
  if (document.querySelector?.(`link[data-font="${family}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.font = family;
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700;900&display=swap`;
  document.head.appendChild(link);
  await Promise.race([document.fonts?.load?.(`16px "${family}"`) ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
}

/**
 * Muestra una imagen, GIF o video a pantalla completa (entrada del bonus, premios por monto…).
 * Se cierra al tocar, al terminar el video o al pasar `seconds`. Con `amount`, el importe se ve encima.
 */
export async function playMediaOverlay(url, seconds = 3, { amount = null, text = null, turbo = false } = {}) {
  if (!url || typeof document === 'undefined') return;
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const box = document.createElement('div');
  box.className = 'bonus-intro';
  const el = mediaEl(url, { fit: 'contain' });
  const hint = document.createElement('small');
  hint.textContent = 'Toca para continuar';
  box.append(el, hint);
  if (amount) {
    const cap = document.createElement('div');
    cap.className = 'tier-cap';
    cap.innerHTML = `${text ? `<small>${esc(text)}</small>` : ''}<b>${esc(amount)}</b>`;
    box.append(cap);
  }
  document.body.appendChild(box);
  const max = Math.max(1, Math.min(15, Number(seconds) || 3)) * 1000;
  await new Promise((resolve) => {
    const done = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(done, turbo ? max / 2 : max);
    box.addEventListener('click', done, { once: true });
    if (isVideo(url)) el.addEventListener('ended', done, { once: true });
  });
  box.remove();
}

/** Nivel de premio por monto alcanzado (theme.winTiers): el más alto con «desde» ≤ x veces la apuesta. */
export function winTierFor(theme, x) {
  return (theme?.winTiers || []).map((t, i) => ({ ...t, i, from: Number(t.from) })).filter((t) => t.from > 0)
    .sort((a, b) => a.from - b.from).filter((t) => x >= t.from).pop() || null;
}
