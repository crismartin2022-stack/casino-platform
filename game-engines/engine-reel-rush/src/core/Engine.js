// game-engines/engine-reel-rush/src/core/Engine.js

import { Application } from 'pixi.js';
import { Reel } from './Reel.js';
import { TumbleFeature } from '../features/TumbleFeature.js';
import { AssetLoader } from '../utils/AssetLoader.js';
import { SoundManager } from '../utils/SoundManager.js';
import { gsap } from 'gsap';

export class Engine {
    constructor(config, canvasContainer) {
        // Configuración base
        this.config = config;
        this.canvasContainer = canvasContainer;
        
        // 1. Crear la Aplicación de PIXI (El lienzo del juego)
        this.app = new Application({
            width: config.width,
            height: config.height,
            backgroundColor: config.backgroundColor || 0x1a1a2e,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
        });
        
        // Añadir el lienzo al contenedor HTML
        this.canvasContainer.appendChild(this.app.view);
        
        // Ajustar estilos del lienzo
        this.app.view.style.width = `${config.width}px`;
        this.app.view.style.height = `${config.height}px`;

        // Inicializar componentes
        this.reels = [];
        this.isSpinning = false;
        this.currentSpinData = [];
        
        // Instanciar mecánicas y utilidades
        this.features = {
            tumble: new TumbleFeature(this),
        };

        // Iniciar el proceso de carga e inicialización
        this.init();
    }

    async init() {
        try {
            // 1. Cargar la configuración del archivo JSON
            this.config.engineConfig = await this.loadConfig();
            
            // 2. Cargar todos los assets (imágenes, sonidos)
            await new AssetLoader().load();

            // 3. AÑADIR EL FONDO - ESTA ES LA LÍNEA CLAVE
            const background = new PIXI.Sprite(this.app.loader.resources.background.texture);
            this.app.stage.addChild(background);

            // 4. Crear las ruletas
            this.createReels();

            // 5. Iniciar animaciones de fondo (opcional)
            this.startBackgroundAnimation();

            console.log('Engine Reel Rush initialized successfully.');
        } catch (error) {
            console.error('Error initializing engine:', error);
            // Mostrar error en pantalla
            this.canvasContainer.innerHTML = `<div id="error">Failed to load game. Please refresh.<br><br>${error.message}</div>`;
        }
    }
    
    async loadConfig() {
        // La ruta es relativa al index.html
        const response = await fetch('./game-engines/engine-reel-rush/src/config/engine-config.json');
        if (!response.ok) {
            throw new Error(`Failed to load engine config: ${response.statusText}`);
        }
        return await response.json();
    }

    createReels() {
        // Usamos la configuración cargada desde el JSON
        const reelPositions = this.config.engineConfig.reelPositions;
        for (let i = 0; i < reelPositions.length; i++) {
            const reel = new Reel(this, i, reelPositions[i]);
            this.reels.push(reel);
            this.app.stage.addChild(reel.container);
        }
    }

    async spin() {
        if (this.isSpinning) return;
        this.isSpinning = true;
        
        // Sonido de giro
        SoundManager.play('spin_start');
        
        // 1. Animación de salida de símbolos
        const spinPromises = this.reels.map(reel => reel.spinOut());
        await Promise.all(spinPromises);

        // 2. Obtener datos del giro (del backend o locales para pruebas)
        this.currentSpinData = this.getSpinResults();
        
        // 3. Detener las ruletas con los nuevos símbolos
        const stopPromises = this.reels.map(reel => reel.stop(this.currentSpinData[reel.id]));
        await Promise.all(stopPromises);

        // 4. Evaluar resultados y activar la mecánica Tumble
        this.evaluateResults();
    }

    evaluateResults() {
        const winningSymbols = this.findWinningSymbols();
        if (winningSymbols.length > 0) {
            SoundManager.play('win');
            this.features.tumble.activate(winningSymbols);
        } else {
            SoundManager.play('spin_end');
            this.isSpinning = false;
            console.log('Spin finished. No win.');
        }
    }

    findWinningSymbols() {
        // Lógica para encontrar líneas ganadoras (paylines)
        // Placeholder: devuelve una lista de símbolos ganadores por ahora
        // { reel: 0, row: 1, symbolId: 'cherry' }
        return []; 
    }
    
    getSpinResults() {
        // Placeholder: Genera resultados de giro aleatorios
        // En producción, esto vendría de tu backend API
        const results = [];
        // Usamos la configuración cargada desde el JSON
        const symbols = this.config.engineConfig.symbols;
        for (let r = 0; r < this.reels.length; r++) {
            const reelResult = [];
            for (let s = 0; s < this.config.engineConfig.symbolsPerReel; s++) {
                reelResult.push(symbols[Math.floor(Math.random() * symbols.length)]);
            }
            results.push(reelResult);
        }
        return results;
    }
    
    startBackgroundAnimation() {
        // Animación sutil de fondo (ej. neón parpadeando)
        gsap.to(this.app.stage, {
            alpha: 0.95,
            duration: 2,
            repeat: -1,
            yoyo: true,
            ease: "power1.inOut"
        });
    }
}
