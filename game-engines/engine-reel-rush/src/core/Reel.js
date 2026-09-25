// game-engines/engine-reel-rush/src/core/Reel.js
import { Symbol } from './Symbol.js';
import { gsap } from 'gsap';

export class Reel {
    constructor(engine, id, position) {
        this.engine = engine;
        this.id = id;
        this.position = position; // { x, y }
        this.container = new PIXI.Container();
        this.container.position.set(position.x, position.y);
        
        this.symbols = [];
        this.config = engine.config;
        
        this.createSymbols();
    }

    createSymbols() {
        const symbolHeight = this.config.symbolHeight;
        const symbolsPerView = this.config.symbolsPerReel;
        
        // Crear suficientes símbolos para llenar la vista y tener un buffer
        for (let i = 0; i < symbolsPerView + 2; i++) {
            const symbolId = this.config.symbols[Math.floor(Math.random() * this.config.symbols.length)];
            const symbol = new Symbol(this.engine.app.loader.resources[symbolId].texture, symbolId);
            symbol.y = i * symbolHeight;
            this.container.addChild(symbol);
            this.symbols.push(symbol);
        }
        // Posicionar el primer símbolo correctamente
        this.positionSymbols();
    }

    positionSymbols() {
        this.symbols.forEach((symbol, index) => {
            symbol.y = index * this.config.symbolHeight;
        });
    }
    
    async spinOut() {
        // Animación de giro hacia arriba
        const duration = 1 + Math.random() * 0.5;
        const spinTimeline = gsap.timeline();
        
        this.symbols.forEach(symbol => {
            spinTimeline.to(symbol, {
                y: `-=${this.config.symbolHeight * (this.config.symbolsPerReel + 2)}`,
                duration: duration,
                ease: "power2.in"
            }, 0);
        });

        await spinTimeline;
        this.positionSymbols(); // Resetear posiciones después del giro
    }

    async stop(newSymbolIds) {
        // Colocar los nuevos símbolos
        newSymbolIds.forEach((symbolId, index) => {
            if (this.symbols[index]) {
                this.symbols[index].setTexture(symbolId);
            }
        });
        
        // Animación de parada (bounce)
        const stopTimeline = gsap.timeline();
        this.symbols.forEach(symbol => {
            stopTimeline.fromTo(symbol, 
                { y: symbol.y - this.config.symbolHeight },
                { 
                    y: symbol.y, 
                    duration: 0.5,
                    ease: "bounce.out"
                },
                this.id * 0.1 // Staggered stop
            );
        });
        await stopTimeline;
    }
}
