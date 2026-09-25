// game-engines/engine-reel-rush/src/core/Engine.js (actualizado)
import { Application } from 'pixi.js';
import { Reel } from './Reel.js';
import { TumbleFeature } from '../features/TumbleFeature.js';
import { AssetLoader } from '../utils/AssetLoader.js'; // <-- IMPORTAMOS EL CARGADOR
import { SoundManager } from '../utils/SoundManager.js';
import { gsap } from 'gsap';

export class Engine {
    constructor(config, canvasContainer) {
        // ... (el constructor igual que antes)
        this.app = new Application({ ... });
        // ...
        this.init();
    }

    async init() {
        // 1. Cargar todos los assets ANTES de hacer nada
        await new AssetLoader().load();
        
        // 2. Una vez cargados, crear las ruletas
        this.createReels();
        
        // 3. Iniciar animaciones de fondo
        this.startBackgroundAnimation();
        
        console.log('Engine Reel Rush initialized and assets loaded.');
    }
    
    // ... (el resto del código de Engine.js igual que antes)
}
