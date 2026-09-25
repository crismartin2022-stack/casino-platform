// game-engines/engine-reel-rush/src/core/Symbol.js
import { gsap } from 'gsap';

export class Symbol extends PIXI.Sprite {
    constructor(texture, symbolId) {
        super(texture);
        this.symbolId = symbolId;
        this.anchor.set(0.5);
        this.state = 'idle';
        this.setupAnimations();
    }

    setupAnimations() {
        // Animación de "respiración" en estado idle
        this.idleAnimation = gsap.to(this.scale, {
            x: 1.05, y: 1.05,
            duration: 2,
            repeat: -1,
            yoyo: true,
            ease: "power1.inOut"
        });
    }

    setTexture(symbolId) {
        // Cambiar la textura del símbolo
        this.texture = this.engine.app.loader.resources[symbolId].texture;
        this.symbolId = symbolId;
    }

    playWinAnimation() {
        if (this.state === 'win') return; // Evitar superposición de animaciones
        this.state = 'win';
        this.idleAnimation.kill(); // Pausar la animación de respiración
        
        // Animación de parpadeo
        gsap.to(this, {
            alpha: 0.4,
            duration: 0.2,
            repeat: 3,
            yoyo: true,
            onComplete: () => {
                this.alpha = 1;
                this.state = 'idle';
                this.setupAnimations(); // Reanudar la animación de respiración
            }
        });
    }
    
    // Animación de "desvanecimiento" para la mecánica Tumble
    async tumbleOut() {
        this.state = 'tumbling';
        this.idleAnimation.kill();
        
        await gsap.to(this, {
            alpha: 0,
            y: `-=${this.engine.config.symbolHeight}`,
            duration: 0.5,
            ease: "power2.in"
        });
        
        // Limpiar el símbolo
        this.destroy();
    }
}
