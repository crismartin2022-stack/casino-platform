// game-engines/engine-reel-rush/src/utils/AssetLoader.js (MODIFICADO)
import { Loader } from 'pixi.js';
import engineConfig from '../config/engine-config.json' with { type: 'json' }; // Añadimos 'with { type: "json" }' para JSON modules

export class AssetLoader {
    // El constructor ahora acepta la ruta base de los assets
    constructor(basePath = '') {
        this.loader = new Loader();
        this.basePath = basePath; // Guardamos la ruta base, ej: './game-engines/engine-reel-rush/assets/'
        this.setupManifest();
    }

    setupManifest() {
        // Usamos la ruta base para construir la URL completa
        const symbolsPath = `${this.basePath}images/symbols/`;
        const uiPath = `${this.basePath}images/ui/`;
        const soundsPath = `${this.basePath}sounds/`;

        // Añadir todos los símbolos al loader
        engineConfig.symbols.forEach(symbolName => {
            this.loader.add(symbolName, `${symbolsPath}${symbolName}.png`);
        });

        // Añadir otros assets (UI, sonidos)
        this.loader
            .add('background', `${uiPath}background.jpg`)
            .add('spinSound', `${soundsPath}spin.mp3`)
            .add('winSound', `${soundsPath}win.mp3`);
    }

    async load() {
        try {
            await this.loader.load();
            console.log('All assets loaded successfully!');
            return this.loader.resources; // Devuelve todos los recursos cargados
        } catch (error) {
            console.error('Failed to load assets:', error);
            throw error; // Importante: lanzar el error para que el index.html lo capture
        }
    }
}
