// game-engines/engine-reel-rush/src/core/Reel.js

export class Reel {
    constructor(engine, id, position) {
        console.log(`Reel ${id} created at position`, position);
        this.container = new PIXI.Container();
        this.container.position.set(position.x, position.y);
    }

    async spinOut() {
        console.log(`Reel ${this.id} spinning out...`);
        return Promise.resolve();
    }

    async stop(newSymbolIds) {
        console.log(`Reel ${this.id} stopping with symbols:`, newSymbolIds);
        return Promise.resolve();
    }
}
