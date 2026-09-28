// Registro de clientes de motor: el servidor dice qué motor usa cada juego y aquí se carga su clase.
export const ENGINE_LOADERS = {
  'reel-rush': () => import('./engine-reel-rush/src/ReelRushEngine.js').then((m) => m.ReelRushEngine),
  megaways: () => import('./engine-megaways/src/MegawaysEngine.js').then((m) => m.MegawaysEngine),
  'bonus-buy': () => import('./engine-bonus-buy/src/BonusBuyEngine.js').then((m) => m.BonusBuyEngine),
  'hold-win': () => import('./engine-hold-win/src/HoldWinEngine.js').then((m) => m.HoldWinEngine),
  'colossal-reels': () => import('./engine-colossal-reels/src/ColossalEngine.js').then((m) => m.ColossalEngine),
};
