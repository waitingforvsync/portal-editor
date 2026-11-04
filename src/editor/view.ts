// view.ts - the plan view's window onto the map: where its centre is, and how many screen
// pixels a unit takes. The map's x runs up the screen and y to the right.

export interface WorldPoint {
    x: number;
    y: number;
}

export const MIN_SCALE = 1 / 256;
export const MAX_SCALE = 64;

export class View {
    centreX = 1024;
    centreY = 1024;
    scale = 0.5;        // screen pixels per unit
    width = 1;          // the canvas, in CSS pixels
    height = 1;

    toScreen(x: number, y: number): [number, number] {
        return [this.width / 2 + (y - this.centreY) * this.scale,
            this.height / 2 - (x - this.centreX) * this.scale];
    }

    toWorld(sx: number, sy: number): WorldPoint {
        return {
            x: this.centreX - (sy - this.height / 2) / this.scale,
            y: this.centreY + (sx - this.width / 2) / this.scale,
        };
    }

    // Zoom by a factor about a screen point, which stays over the same place in the map.
    zoomAt(sx: number, sy: number, factor: number) {
        const before = this.toWorld(sx, sy);
        this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
        const after = this.toWorld(sx, sy);
        this.centreX += before.x - after.x;
        this.centreY += before.y - after.y;
    }

    // Move the map with the pointer, by a screen distance.
    pan(dsx: number, dsy: number) {
        this.centreY -= dsx / this.scale;
        this.centreX += dsy / this.scale;
    }

    // Show the box from (x0, y0) to (x1, y1), with a margin in pixels.
    fit(x0: number, y0: number, x1: number, y1: number, margin = 32) {
        this.centreX = (x0 + x1) / 2;
        this.centreY = (y0 + y1) / 2;
        const sx = (this.width - 2 * margin) / Math.max(y1 - y0, 1);
        const sy = (this.height - 2 * margin) / Math.max(x1 - x0, 1);
        this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(sx, sy)));
    }
}
