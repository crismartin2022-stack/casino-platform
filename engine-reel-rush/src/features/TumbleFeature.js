// game-engines/engine-reel-rush/src/features/TumbleFeature.js
import { gsap } from 'gsap';

export class TumbleFeature {
    constructor(engine) {
        this.engine = engine;
        this.isActive = false;
    }

    async activate(winningSymbols) {
        console.log('Tumble Feature Activated!', winningSymbols);
        this.isActive = true;
        
        // 1. Animar la salida de los símbolos ganadores
        const tumbleOutPromises = winningSymbols.map(ws => {
            const reel = this.engine.reels[ws.reel];
            const symbol = reel.symbols[ws.row];
            return symbol.tumbleOut();
        });
        await Promise.all(tumbleOutPromises);

        // 2. Hacer caer los símbolos superiores
        await this.dropSymbols();

        // 3. Rellenar desde arriba con nuevos símbolos
        await this.fillFromTop();

        // 4. Re-evaluar después de la caída
        this.evaluateAfterTumble();
    }

    async dropSymbols() {
        // Lógica para hacer que los símbolos restantes caigan
        // ...
        console.log('Dropping symbols...');
    }
    
    async fillFromTop() {
        // Lógica para rellenar los huecos con nuevos símbolos
        // ...
        console.log('Filling from top...');
    }

    evaluateAfterTumble() {
        const newWinningSymbols = this.engine.findWinningSymbols();
        if (newWinningSymbols.length > 0) {
            // ¡Hay más ganancias! Volver a activar el Tumble.
            console.log('Another win! Tumbling again.');
            this.activate(newWinningSymbols);
        } else {
            // No más ganancias. Fin del giro.
            console.log('Tumble sequence finished.');
            this.isActive = false;
            this.engine.isSpinning = false;
        }
    }
}
