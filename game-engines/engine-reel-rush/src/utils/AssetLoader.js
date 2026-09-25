// game-engines/engine-reel-rush/src/utils/AssetLoader.js (versión sin sonido)
import { Loader } from 'pixi.js';
import engineConfig from '../config/engine-config.json' with { type: 'json' };

export class AssetLoader {
    constructor(basePath = '') {
        this.loader = new Loader();
        this.basePath = basePath;
        this.setupManifest();
    }

    setupManifest() {
        const symbolsPath = `${this.basePath}images/symbols/`;
        const uiPath = `${this.basePath}images/ui/`;

        // 1. Cargar los símbolos (esto ya lo hacía)
        engineConfig.symbols.forEach(symbolName => {
            this.loader.add(symbolName, `${symbolsPath}${symbolName}.png`);
        });

        // 2. Cargar los elementos de la UI (esto también ya lo hacía)
        this.loader
            .add('background', `${uiPath}background.jpg`)
            .add('spinButton', `${uiPath}spinButton.png`);

        // 3. SECCIÓN DE SONIDOS - COMENTADA O ELIMINADA
        // Por ahora, no intentamos cargar sonidos para evitar errores.
        // 
        // const soundsPath = `${this.basePath}sounds/`;
        // this.loader
        //     .add('spinSound', `${soundsPath}spin.mp3`)
        //     .add('winSound', `${soundsPath}win.mp3`);
    }

    async load() {
        try {
            await this.loader.load();
            console.log('All assets loaded successfully!');
            return this.loader.resources;
        } catch (error) {
            console.error('Failed to load assets:', error);
            throw error;
        }
    }
}
