// Registro de clientes de motor: el servidor dice qué motor usa cada juego y aquí se carga su clase.
export const ENGINE_LOADERS = {
  'reel-rush': () => import('./engine-reel-rush/src/ReelRushEngine.js').then((m) => m.ReelRushEngine),
  megaways: () => import('./engine-megaways/src/MegawaysEngine.js').then((m) => m.MegawaysEngine),
  'bonus-buy': () => import('./engine-bonus-buy/src/BonusBuyEngine.js').then((m) => m.BonusBuyEngine),
  'hold-win': () => import('./engine-hold-win/src/HoldWinEngine.js').then((m) => m.HoldWinEngine),
  'colossal-reels': () => import('./engine-colossal-reels/src/ColossalEngine.js').then((m) => m.ColossalEngine),
  'cluster-pays': () => import('./engine-cluster-pays/src/ClusterPaysEngine.js').then((m) => m.ClusterPaysEngine),
  'scatter-pays': () => import('./engine-scatter-pays/src/ScatterPaysEngine.js').then((m) => m.ScatterPaysEngine),
  'expanding-symbol': () => import('./engine-expanding-symbol/src/ExpandingSymbolEngine.js').then((m) => m.ExpandingSymbolEngine),
  'sticky-wilds': () => import('./engine-sticky-wilds/src/StickyWildsEngine.js').then((m) => m.StickyWildsEngine),
  'megaways-cascade': () => import('./engine-megaways-cascade/src/MegawaysCascadeEngine.js').then((m) => m.MegawaysCascadeEngine),
  'treasure-chests': () => import('./engine-treasure-chests/src/TreasureChestsEngine.js').then((m) => m.TreasureChestsEngine),
  'cash-collect': () => import('./engine-cash-collect/src/CashCollectEngine.js').then((m) => m.CashCollectEngine),
  craps: () => import('./engine-craps/src/CrapsEngine.js').then((m) => m.CrapsEngine),
};
