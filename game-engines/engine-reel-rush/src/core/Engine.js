// En game-engines/engine-reel-rush/src/core/Engine.js

// ... (el resto de los imports)

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
        
        // Iniciar el proceso de carga e inicialización de forma asíncrona
        this.startInit();
    }
    
    async startInit() {
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

    // ... (el resto de las funciones como loadConfig, createReels, etc. se quedan igual)
}
