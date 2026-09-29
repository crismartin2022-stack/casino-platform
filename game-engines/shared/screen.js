// Pantalla completa y giro de pantalla, compartido por todas las interfaces (tragamonedas y mesa).
// Android/Chrome: pantalla completa + bloqueo de orientación. iPhone: no hay API para forzar el giro
// (se avisa al jugador que gire el teléfono); añadido a la pantalla de inicio el juego ya ocupa todo.
const d = typeof document !== 'undefined' ? document : null;

export const canFullscreen = () => !!(d && (d.fullscreenEnabled || d.webkitFullscreenEnabled));
export const isFullscreen = () => !!(d && (d.fullscreenElement || d.webkitFullscreenElement));
export const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export async function enterFullscreen() {
  const el = d?.documentElement;
  const fn = el && (el.requestFullscreen || el.webkitRequestFullscreen);
  if (fn && !isFullscreen()) await fn.call(el, { navigationUI: 'hide' });
}

export async function toggleFullscreen() {
  try {
    if (isFullscreen()) await (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    else await enterFullscreen();
  } catch { /* el navegador lo rechazó (p. ej. iframe sin allow="fullscreen") */ }
}

/**
 * Gira la vista a la otra orientación. Devuelve true si se pudo bloquear la orientación;
 * false si el dispositivo no lo permite (hay que pedirle al jugador que gire el teléfono).
 */
export async function rotate(current) {
  const target = current === 'portrait' ? 'landscape' : 'portrait';
  try {
    await enterFullscreen();
    if (!screen.orientation?.lock) return false;
    await screen.orientation.lock(target);
    return true;
  } catch {
    return false;
  }
}

/** Llama a fn cuando se entra o se sale de pantalla completa (para cambiar el icono). */
export function onFullscreenChange(fn) {
  d?.addEventListener?.('fullscreenchange', fn);
  d?.addEventListener?.('webkitfullscreenchange', fn);
}
