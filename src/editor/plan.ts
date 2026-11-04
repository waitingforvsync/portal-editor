// plan.ts - the plan view: draws the map from above, and turns the pointer and keys into
// edits. Placement mode places vertices and draws edges; selection mode selects and moves
// them. Holding Shift selects in either mode, adding to the selection. While an edge is drawn
// or a selection moved, the view shows what committing it there would make, snapped.

import {
    addEdge, addVertex, deleteEdges, deleteVertices, moveVertices,
    type Doc, type EditResult, type Endpoint,
} from '../map/edit';
import type { Vertex } from '../map/map';
import { shadeRgb } from '../map/shades';
import { zoneCells } from '../map/cells';
import { COORD_MAX } from '../map/units';
import { GRID_SIZES, type Editor } from './editor';
import { hitTest, snapAt, type Hit, type Snap } from './hit';
import {
    isSelected, mapSelection, selectedEdges, selectedZones, verticesOf, type Selection,
} from './selection';
import { View, type WorldPoint } from './view';

const DRAG_START = 4;    // pixels the pointer moves before a press becomes a drag

const COLOUR = {
    background: '#16181c',
    gridMinor: 'rgba(255, 255, 255, 0.045)',
    gridMajor: 'rgba(255, 255, 255, 0.09)',
    edge: '#9aa1ad',
    construction: '#6b717c',
    soft: 'rgba(255, 255, 255, 0.3)',
    vertex: '#d0d4dc',
    selected: '#ffb43c',
    selectedFill: 'rgba(255, 180, 60, 0.22)',
    hover: '#ffffff',
    hoverFill: 'rgba(255, 255, 255, 0.08)',
    snap: '#5ad2ff',
    start: '#ff6a8a',
    solid: '#4a4e57',
};

type Gesture =
    | { kind: 'idle' }
    | { kind: 'pan'; sx: number; sy: number }
    | {
        kind: 'press'; sx: number; sy: number; selecting: boolean; adding: boolean;
        hit: Hit; snap: Snap;
    }
    | { kind: 'draw'; from: Snap; to: Snap; result?: EditResult }
    | {
        kind: 'move'; base: Doc; moving: Selection; anchor: Vertex; grab: WorldPoint;
        target?: Snap; dx: number; dy: number; result?: EditResult;
    }
    | { kind: 'box'; sx0: number; sy0: number; sx1: number; sy1: number; adding: boolean };

function endpoint(snap: Snap): Endpoint {
    switch (snap.kind) {
        case 'vertex':
            return { vertex: snap.index };
        case 'edge':
            return { at: snap.at, edge: snap.index };
        case 'point':
            return { at: snap.at };
    }
}

function sameSnap(a: Snap, b: Snap): boolean {
    return a.kind === b.kind && a.at.x === b.at.x && a.at.y === b.at.y
        && (a.kind === 'point' || (b.kind !== 'point' && a.index === b.index));
}

// The open zones' cells, which the engine has: a solid zone has none.
function openCells(doc: Doc): number[][] {
    return zoneCells(doc).filter((_, z) => !doc.map.zones[z]!.solid).flat();
}

function css(rgb: readonly number[], alpha: number): string {
    return `rgba(${rgb.map(Math.round).join(', ')}, ${alpha})`;
}

export class PlanView {
    readonly view = new View();
    private gesture: Gesture = { kind: 'idle' };
    private pointer: { sx: number; sy: number } | undefined;
    private shift = false;
    private frame = 0;
    private hatch: CanvasPattern | null = null;
    private readonly drawn = new Set<() => void>();
    hint = '';    // what another view has under the pointer, for the status line

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly editor: Editor,
        private readonly report: (status: string) => void,
    ) {
        canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
        canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
        canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
        canvas.addEventListener('pointercancel', () => this.cancel());
        canvas.addEventListener('pointerleave', () => {
            if (this.gesture.kind === 'idle') {
                this.pointer = undefined;
                this.redraw();
            }
        });
        canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('keydown', (e) => this.keyDown(e));
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') {
                this.shift = false;
                this.redraw();
            }
        });
        window.addEventListener('blur', () => {
            this.shift = false;
            this.redraw();
        });
        new ResizeObserver(() => this.redraw()).observe(canvas);
        editor.onChange(() => this.redraw());
    }

    // Show the whole map.
    fit() {
        this.measure();
        const { vertices, start } = this.editor.doc.map;
        const points = vertices.length ? vertices : [start];
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const pad = vertices.length ? 0 : 512;
        this.view.fit(Math.min(...xs) - pad, Math.min(...ys) - pad,
            Math.max(...xs) + pad, Math.max(...ys) + pad);
        this.redraw();
    }

    // Hear each time the view draws: its view, or what it shows, may have changed.
    onDraw(listener: () => void) {
        this.drawn.add(listener);
    }

    redraw() {
        if (!this.frame) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                this.draw();
            });
        }
    }

    // ---- input ----

    private local(e: MouseEvent): [number, number] {
        const r = this.canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    }

    private get selecting(): boolean {
        return this.editor.mode === 'select' || this.shift;
    }

    private pointerDown(e: PointerEvent) {
        const [sx, sy] = this.local(e);
        this.pointer = { sx, sy };
        this.shift = e.shiftKey;
        if (this.gesture.kind !== 'idle') {
            return;
        }
        if (e.button === 1 || e.button === 2) {
            this.gesture = { kind: 'pan', sx, sy };
        } else if (e.button === 0) {
            const { doc } = this.editor;
            this.gesture = {
                kind: 'press', sx, sy, selecting: this.selecting, adding: e.shiftKey,
                hit: hitTest(doc, this.view, sx, sy, true),
                snap: snapAt(doc, this.view, sx, sy, this.editor.grid),
            };
        } else {
            return;
        }
        this.editor.message = '';
        this.canvas.setPointerCapture(e.pointerId);
        this.redraw();
    }

    private pointerMove(e: PointerEvent) {
        const [sx, sy] = this.local(e);
        this.pointer = { sx, sy };
        this.shift = e.shiftKey;
        const g = this.gesture;
        switch (g.kind) {
            case 'pan':
                this.view.pan(sx - g.sx, sy - g.sy);
                g.sx = sx;
                g.sy = sy;
                break;
            case 'press':
                if (Math.hypot(sx - g.sx, sy - g.sy) >= DRAG_START) {
                    this.startDrag(g, sx, sy);
                }
                break;
            case 'draw':
                this.updateDraw(g, sx, sy);
                break;
            case 'move':
                this.updateMove(g, sx, sy);
                break;
            case 'box':
                g.sx1 = sx;
                g.sy1 = sy;
                break;
        }
        this.redraw();
    }

    private pointerUp(e: PointerEvent) {
        const g = this.gesture;
        this.gesture = { kind: 'idle' };
        if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
        const { editor } = this;
        switch (g.kind) {
            case 'press':
                this.click(g);
                break;
            case 'draw':
                if (g.result) {
                    editor.commit(g.result.doc, g.result.drawn);
                } else {
                    this.place(g.from);
                }
                break;
            case 'move':
                if (g.result) {
                    editor.commit(g.result.doc, mapSelection(g.moving, g.result.vertexMap));
                }
                break;
            case 'box':
                this.boxSelect(g);
                break;
        }
        this.redraw();
    }

    private wheel(e: WheelEvent) {
        e.preventDefault();
        const [sx, sy] = this.local(e);
        const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        this.view.zoomAt(sx, sy, Math.exp(-e.deltaY * lines * 0.0015));
        // snapping reaches depend on the zoom
        const g = this.gesture;
        if (g.kind === 'draw') {
            this.updateDraw(g, sx, sy);
        } else if (g.kind === 'move') {
            this.updateMove(g, sx, sy);
        }
        this.redraw();
    }

    private cancel() {
        this.gesture = { kind: 'idle' };
        this.redraw();
    }

    private keyDown(e: KeyboardEvent) {
        const target = e.target as HTMLElement | null;
        if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
            return;
        }
        const { editor } = this;
        if (e.key === 'Shift') {
            this.shift = true;
            this.redraw();
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            const key = e.key.toLowerCase();
            if (key === 'z' || key === 'y') {
                e.preventDefault();
                if (this.gesture.kind === 'idle') {
                    if (key === 'y' || e.shiftKey) {
                        editor.redo();
                    } else {
                        editor.undo();
                    }
                }
            }
            return;
        }
        if (e.altKey) {
            return;
        }
        const step = editor.grid || 1;
        switch (e.key) {
            case 'p':
            case 'P':
                editor.setMode('place');
                break;
            case 's':
            case 'S':
                editor.setMode('select');
                break;
            case 'Escape':
                if (this.gesture.kind === 'idle') {
                    editor.select([]);
                } else {
                    this.cancel();
                }
                break;
            case 'Delete':
            case 'Backspace':
                this.deleteSelection();
                break;
            case 'g':
            case 'G':
                editor.setGrid(!editor.gridOn);
                break;
            case '[':
            case ']': {
                const i = GRID_SIZES.indexOf(editor.gridSize) + (e.key === '[' ? -1 : 1);
                editor.setGrid(true, GRID_SIZES[Math.min(GRID_SIZES.length - 1, Math.max(0, i))]);
                break;
            }
            case 'f':
            case 'F':
                this.fit();
                break;
            case 'd':
            case 'D':
                editor.setDither(!editor.dither);
                break;
            case 'c':
            case 'C':
                editor.setShowCells(!editor.showCells);
                break;
            case 'ArrowUp':
                this.nudge(step, 0);
                break;
            case 'ArrowDown':
                this.nudge(-step, 0);
                break;
            case 'ArrowRight':
                this.nudge(0, step);
                break;
            case 'ArrowLeft':
                this.nudge(0, -step);
                break;
            default:
                return;
        }
        e.preventDefault();
    }

    // ---- edits ----

    // Run an edit, reporting rather than throwing if it fails.
    private attempt(edit: () => EditResult): EditResult | undefined {
        try {
            return edit();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.editor.message = `couldn't make that edit: ${reason}`;
            return undefined;
        }
    }

    private click(press: Extract<Gesture, { kind: 'press' }>) {
        const { editor } = this;
        if (!press.selecting) {
            this.place(press.snap);
            return;
        }
        const vertices = verticesOf(editor.doc, press.hit);
        if (vertices.length === 0) {
            editor.select([]);
        } else {
            editor.select(press.adding ? [...editor.selection, ...vertices] : vertices);
        }
    }

    // A click in placement mode: select a vertex, or add one where it snaps.
    private place(snap: Snap) {
        const { editor } = this;
        if (snap.kind === 'vertex') {
            editor.select([snap.index]);
            return;
        }
        const edge = snap.kind === 'edge' ? snap.index : undefined;
        const result = this.attempt(() => addVertex(editor.doc, snap.at, edge, editor.defaults));
        if (result) {
            editor.commit(result.doc, result.added);
        }
    }

    private startDrag(press: Extract<Gesture, { kind: 'press' }>, sx: number, sy: number) {
        const { editor } = this;
        if (!press.selecting) {
            const draw: Gesture = { kind: 'draw', from: press.snap, to: press.snap };
            this.gesture = draw;
            this.updateDraw(draw, sx, sy);
            return;
        }
        if (press.hit.kind === 'none') {
            this.gesture = {
                kind: 'box', sx0: press.sx, sy0: press.sy, sx1: sx, sy1: sy, adding: press.adding,
            };
            return;
        }
        const { doc } = editor;
        if (!isSelected(doc, editor.selection, press.hit)) {
            const vertices = verticesOf(doc, press.hit);
            editor.select(press.adding ? [...editor.selection, ...vertices] : vertices);
        }
        const grab = this.view.toWorld(press.sx, press.sy);
        const move: Gesture = {
            kind: 'move', base: doc, moving: editor.selection,
            anchor: doc.map.vertices[this.anchorFor(press.hit, grab)]!, grab, dx: 0, dy: 0,
        };
        this.gesture = move;
        this.updateMove(move, sx, sy);
    }

    // The vertex a move snaps by: the one grabbed, or the nearest of what was grabbed.
    private anchorFor(hit: Hit, grab: WorldPoint): number {
        const { doc } = this.editor;
        const candidates = verticesOf(doc, hit);
        const distance = (v: number) => {
            const p = doc.map.vertices[v]!;
            return Math.hypot(p.x - grab.x, p.y - grab.y);
        };
        return candidates.reduce((best, v) => (distance(v) < distance(best) ? v : best));
    }

    private updateDraw(g: Extract<Gesture, { kind: 'draw' }>, sx: number, sy: number) {
        const { editor } = this;
        const { doc } = editor;
        const from = g.from.kind === 'vertex' ? g.from.index : undefined;
        const fromEdge = g.from.kind === 'edge' ? g.from.index : undefined;
        // the end can't snap back onto the start, or onto an edge it runs along
        const touchesFrom = (e: number) => {
            const edge = doc.map.edges[e]!;
            return e === fromEdge || edge.a === from || edge.b === from;
        };
        const to = snapAt(doc, this.view, sx, sy, editor.grid, {
            vertex: (v) => v === from,
            edge: touchesFrom,
        });
        if (g.result && sameSnap(to, g.to)) {
            return;
        }
        g.to = to;
        const degenerate = to.at.x === g.from.at.x && to.at.y === g.from.at.y;
        g.result = degenerate ? undefined
            : this.attempt(() => addEdge(doc, endpoint(g.from), endpoint(to), editor.defaults));
    }

    private updateMove(g: Extract<Gesture, { kind: 'move' }>, sx: number, sy: number) {
        const { editor, view } = this;
        const { base, moving } = g;
        const p = view.toWorld(sx, sy);
        const [ax, ay] = view.toScreen(g.anchor.x + p.x - g.grab.x, g.anchor.y + p.y - g.grab.y);
        // the anchor snaps onto what isn't moving, or to the grid
        g.target = snapAt(base, view, ax, ay, editor.grid, {
            vertex: (v) => moving.has(v),
            edge: (e) => moving.has(base.map.edges[e]!.a) || moving.has(base.map.edges[e]!.b),
        });
        let dx = g.target.at.x - g.anchor.x;
        let dy = g.target.at.y - g.anchor.y;
        // every moving vertex stays in range
        for (const v of moving) {
            const q = base.map.vertices[v]!;
            dx = Math.min(COORD_MAX - q.x, Math.max(-q.x, dx));
            dy = Math.min(COORD_MAX - q.y, Math.max(-q.y, dy));
        }
        if (dx === g.dx && dy === g.dy) {
            return;
        }
        g.dx = dx;
        g.dy = dy;
        g.result = dx === 0 && dy === 0 ? undefined
            : this.attempt(() => moveVertices(base, moving, dx, dy, editor.defaults));
    }

    private boxSelect(g: Extract<Gesture, { kind: 'box' }>) {
        const { editor, view } = this;
        const [x0, x1] = [Math.min(g.sx0, g.sx1), Math.max(g.sx0, g.sx1)];
        const [y0, y1] = [Math.min(g.sy0, g.sy1), Math.max(g.sy0, g.sy1)];
        const inside: number[] = [];
        editor.doc.map.vertices.forEach((v, i) => {
            const [sx, sy] = view.toScreen(v.x, v.y);
            if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
                inside.push(i);
            }
        });
        editor.select(g.adding ? [...editor.selection, ...inside] : inside);
    }

    // Delete the selected edges, leaving their vertices selected; with none, the vertices.
    private deleteSelection() {
        const { editor } = this;
        const { doc, selection } = editor;
        if (this.gesture.kind !== 'idle' || selection.size === 0) {
            return;
        }
        const edges = selectedEdges(doc, selection);
        const result = this.attempt(() => (edges.length
            ? deleteEdges(doc, new Set(edges), editor.defaults)
            : deleteVertices(doc, selection, editor.defaults)));
        if (result) {
            const kept = edges.length ? mapSelection(selection, result.vertexMap) : [];
            editor.commit(result.doc, kept);
        }
    }

    private nudge(dx: number, dy: number) {
        const { editor } = this;
        const { doc, selection } = editor;
        if (this.gesture.kind !== 'idle' || selection.size === 0) {
            return;
        }
        for (const v of selection) {
            const p = doc.map.vertices[v]!;
            dx = Math.min(COORD_MAX - p.x, Math.max(-p.x, dx));
            dy = Math.min(COORD_MAX - p.y, Math.max(-p.y, dy));
        }
        if (dx === 0 && dy === 0) {
            return;
        }
        const result = this.attempt(() => moveVertices(doc, selection, dx, dy, editor.defaults));
        if (result) {
            editor.commit(result.doc, mapSelection(selection, result.vertexMap));
        }
    }

    // ---- drawing ----

    // What to show: the document, or what an edit under way would make of it.
    shown(): { doc: Doc; selection: Selection } {
        const g = this.gesture;
        if (g.kind === 'move' && g.result) {
            return { doc: g.result.doc, selection: mapSelection(g.moving, g.result.vertexMap) };
        }
        if (g.kind === 'draw' && g.result) {
            return { doc: g.result.doc, selection: new Set(g.result.drawn) };
        }
        return { doc: this.editor.doc, selection: this.editor.selection };
    }

    private measure() {
        this.view.width = this.canvas.clientWidth;
        this.view.height = this.canvas.clientHeight;
    }

    private draw() {
        this.measure();
        const { canvas, view } = this;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(view.width * dpr);
        canvas.height = Math.round(view.height * dpr);
        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = COLOUR.background;
        ctx.fillRect(0, 0, view.width, view.height);
        this.drawGrid(ctx);

        const { doc, selection } = this.shown();
        const { vertices, edges, zones } = doc.map;
        const screen = (v: Vertex) => view.toScreen(v.x, v.y);
        const trace = (cycle: readonly number[]) => {
            cycle.forEach((v, k) => {
                const [sx, sy] = screen(vertices[v]!);
                if (k === 0) {
                    ctx.moveTo(sx, sy);
                } else {
                    ctx.lineTo(sx, sy);
                }
            });
            ctx.closePath();
        };
        // a zone's cells as one path: they all turn the same way, so it fills without seams
        const cells = zoneCells(doc);
        const zonePath = (z: number) => {
            ctx.beginPath();
            for (const cell of cells[z]!) {
                trace(cell);
            }
        };

        // what the pointer is over, when not mid-gesture
        const idle = this.gesture.kind === 'idle' && this.pointer !== undefined;
        const hover: Hit = idle && this.selecting
            ? hitTest(doc, view, this.pointer!.sx, this.pointer!.sy, true) : { kind: 'none' };
        const placing: Snap | undefined = idle && !this.selecting
            ? snapAt(doc, view, this.pointer!.sx, this.pointer!.sy, this.editor.grid) : undefined;

        // zones, in their floor shades; solid ones hatched
        zones.forEach((zone, z) => {
            zonePath(z);
            ctx.fillStyle = zone.solid ? this.solidFill(ctx) : css(shadeRgb(zone.floorShade), 0.5);
            ctx.fill();
        });
        for (const z of selectedZones(doc, selection)) {
            zonePath(z);
            ctx.fillStyle = COLOUR.selectedFill;
            ctx.fill();
        }
        if (hover.kind === 'zone') {
            zonePath(hover.index);
            ctx.fillStyle = COLOUR.hoverFill;
            ctx.fill();
        }

        // the soft lines between cells, once each
        if (this.editor.showCells) {
            const isEdge = new Set(edges.map((e) => Math.min(e.a, e.b) * 4294967296
                + Math.max(e.a, e.b)));
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = COLOUR.soft;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const cell of openCells(doc)) {
                cell.forEach((u, k) => {
                    const v = cell[(k + 1) % cell.length]!;
                    if (u < v && !isEdge.has(u * 4294967296 + v)) {
                        ctx.moveTo(...screen(vertices[u]!));
                        ctx.lineTo(...screen(vertices[v]!));
                    }
                });
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // edges
        const construction = new Set(doc.construction);
        const chosen = new Set(selectedEdges(doc, selection));
        const strokeEdge = (i: number) => {
            const e = edges[i]!;
            const [ax, ay] = screen(vertices[e.a]!);
            const [bx, by] = screen(vertices[e.b]!);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
        };
        ctx.lineCap = 'round';
        edges.forEach((_, i) => {
            if (chosen.has(i)) {
                return;
            }
            ctx.setLineDash(construction.has(i) ? [6, 4] : []);
            ctx.strokeStyle = construction.has(i) ? COLOUR.construction : COLOUR.edge;
            ctx.lineWidth = 1.5;
            strokeEdge(i);
        });
        ctx.setLineDash([]);
        ctx.strokeStyle = COLOUR.selected;
        ctx.lineWidth = 2.5;
        chosen.forEach(strokeEdge);
        if (hover.kind === 'edge') {
            ctx.strokeStyle = COLOUR.hover;
            strokeEdge(hover.index);
        }

        // vertices
        vertices.forEach((v, i) => {
            const [sx, sy] = screen(v);
            const on = selection.has(i);
            const size = on ? 7 : 5;
            ctx.fillStyle = on ? COLOUR.selected : COLOUR.vertex;
            ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
        });
        if (hover.kind === 'vertex') {
            this.ring(ctx, screen(vertices[hover.index]!), 7, COLOUR.hover);
        }

        this.drawStart(ctx, doc);

        // where the pointer would place, draw to, or move to
        const g = this.gesture;
        if (placing) {
            this.drawSnap(ctx, placing);
        } else if (g.kind === 'draw') {
            if (!g.result) {
                ctx.strokeStyle = COLOUR.snap;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(...screen(g.from.at));
                ctx.lineTo(...screen(g.to.at));
                ctx.stroke();
                ctx.setLineDash([]);
            }
            this.drawSnap(ctx, g.from);
            this.drawSnap(ctx, g.to);
        } else if (g.kind === 'move' && g.target) {
            this.drawSnap(ctx, g.target);
        } else if (g.kind === 'box') {
            ctx.strokeStyle = COLOUR.snap;
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 1;
            ctx.strokeRect(Math.min(g.sx0, g.sx1) + 0.5, Math.min(g.sy0, g.sy1) + 0.5,
                Math.abs(g.sx1 - g.sx0), Math.abs(g.sy1 - g.sy0));
            ctx.setLineDash([]);
        }

        this.canvas.style.cursor = g.kind === 'pan' ? 'grabbing'
            : g.kind === 'move' ? 'move'
            : this.selecting ? 'default' : 'crosshair';
        this.report(this.status(doc, selection, placing));
        for (const listener of this.drawn) {
            listener();
        }
    }

    private drawGrid(ctx: CanvasRenderingContext2D) {
        const { view } = this;
        const size = this.editor.grid;
        if (size === 0) {
            return;
        }
        const top = view.toWorld(0, 0);
        const bottom = view.toWorld(view.width, view.height);
        const levels = [[size, COLOUR.gridMinor], [size * 8, COLOUR.gridMajor]] as const;
        for (const [step, colour] of levels) {
            if (step * view.scale < 8) {
                continue;
            }
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = Math.ceil(bottom.x / step) * step; x <= top.x; x += step) {
                const [, sy] = view.toScreen(x, 0);
                ctx.moveTo(0, Math.round(sy) + 0.5);
                ctx.lineTo(view.width, Math.round(sy) + 0.5);
            }
            for (let y = Math.ceil(top.y / step) * step; y <= bottom.y; y += step) {
                const [sx] = view.toScreen(0, y);
                ctx.moveTo(Math.round(sx) + 0.5, 0);
                ctx.lineTo(Math.round(sx) + 0.5, view.height);
            }
            ctx.stroke();
        }
    }

    private solidFill(ctx: CanvasRenderingContext2D): CanvasPattern | string {
        if (!this.hatch) {
            const tile = document.createElement('canvas');
            tile.width = tile.height = 8;
            const t = tile.getContext('2d')!;
            t.fillStyle = '#26292f';
            t.fillRect(0, 0, 8, 8);
            t.strokeStyle = COLOUR.solid;
            t.lineWidth = 2;
            t.beginPath();
            t.moveTo(0, 8);
            t.lineTo(8, 0);
            t.stroke();
            this.hatch = ctx.createPattern(tile, 'repeat');
        }
        return this.hatch ?? COLOUR.solid;
    }

    private ring(
        ctx: CanvasRenderingContext2D, [sx, sy]: [number, number], r: number, colour: string,
    ) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 2 * Math.PI);
        ctx.stroke();
    }

    // A snap: a ring on a vertex, a diamond on an edge, a cross on a free point.
    private drawSnap(ctx: CanvasRenderingContext2D, snap: Snap) {
        const [sx, sy] = this.view.toScreen(snap.at.x, snap.at.y);
        ctx.strokeStyle = COLOUR.snap;
        ctx.fillStyle = COLOUR.snap;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (snap.kind === 'vertex') {
            ctx.arc(sx, sy, 7, 0, 2 * Math.PI);
        } else if (snap.kind === 'edge') {
            ctx.moveTo(sx, sy - 6);
            ctx.lineTo(sx + 6, sy);
            ctx.lineTo(sx, sy + 6);
            ctx.lineTo(sx - 6, sy);
            ctx.closePath();
        } else {
            ctx.moveTo(sx - 6, sy);
            ctx.lineTo(sx + 6, sy);
            ctx.moveTo(sx, sy - 6);
            ctx.lineTo(sx, sy + 6);
        }
        ctx.stroke();
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }

    // The start: a circle, with a tick the way it faces.
    private drawStart(ctx: CanvasRenderingContext2D, doc: Doc) {
        const { start } = doc.map;
        const [sx, sy] = this.view.toScreen(start.x, start.y);
        const turn = (start.angle / 256) * 2 * Math.PI;
        ctx.strokeStyle = COLOUR.start;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, 2 * Math.PI);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.sin(turn) * 13, sy - Math.cos(turn) * 13);
        ctx.stroke();
    }

    private status(doc: Doc, selection: Selection, placing: Snap | undefined): string {
        const { editor } = this;
        const { map } = doc;
        const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
        const counts = (v: number, e: number, z: number) => [
            count(v, 'vertex', 'vertices'), count(e, 'edge', 'edges'), count(z, 'zone', 'zones'),
        ].join(', ');
        const parts = [
            this.selecting ? 'Select' : 'Place',
            counts(map.vertices.length, map.edges.length, map.zones.length)
                + (editor.showCells ? `, ${count(openCells(doc).length, 'cell', 'cells')}` : ''),
        ];
        if (selection.size) {
            const edges = selectedEdges(doc, selection).length;
            const zones = selectedZones(doc, selection).length;
            parts.push(`selected: ${counts(selection.size, edges, zones)}`);
        }
        parts.push(editor.gridOn ? `grid ${editor.gridSize}` : 'grid off');
        const g = this.gesture;
        const at = placing?.at
            ?? (g.kind === 'draw' ? g.to.at : g.kind === 'move' ? g.target?.at : undefined);
        if (at) {
            parts.push(`x ${at.x} y ${at.y}`);
        } else if (this.pointer) {
            const p = this.view.toWorld(this.pointer.sx, this.pointer.sy);
            parts.push(`x ${Math.round(p.x)} y ${Math.round(p.y)}`);
        }
        if (g.kind === 'move' && (g.dx || g.dy)) {
            parts.push(`moving ${g.dx}, ${g.dy}`);
        }
        if (this.hint) {
            parts.push(this.hint);
        }
        if (editor.message) {
            parts.push(editor.message);
        }
        return parts.join('  |  ');
    }
}
