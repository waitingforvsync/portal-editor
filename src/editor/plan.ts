// plan.ts - the plan view: draws the map from above, and turns the pointer and keys into
// edits. Selection mode selects and moves vertices; geometry mode places them and draws
// edges; player mode puts the start and aims it. Holding Shift switches between selection
// and geometry, and Ctrl (or Cmd) adds to the selection rather than replacing it. Player mode
// has no selection: it's kept, unseen, for the other modes. While an edge is drawn, a
// selection moved or the start put, the view shows what committing it there would make,
// snapped.
//
// Cut and copy put the selection on the clipboard as a map in the text format; paste takes a
// map from the clipboard and floats it, its middle at the pointer, until a click puts it down.

import {
    addEdge, addVertex, deleteEdges, deleteVertices, docFromMap, extract, moveVertices,
    pasteMap, setStart, type Doc, type EditResult, type Endpoint,
} from '../map/edit';
import { parseMap, writeMap } from '../map/format';
import type { PortalMap, Start, Vertex } from '../map/map';
import { shadeRgb } from '../map/shades';
import { zoneCells } from '../map/cells';
import { ANGLE_STEPS, COORD_MAX } from '../map/units';
import { ANGLE_SNAP, GRID_SIZES, type Editor } from './editor';
import { hitTest, roundToGrid, snapAt, type Hit, type Snap } from './hit';
import {
    isSelected, mapSelection, selectedEdges, selectedZones, verticesOf, type Selection,
} from './selection';
import { View, type WorldPoint } from './view';

const DRAG_START = 4;    // pixels the pointer moves before a press becomes a drag
const ZONE_ALPHA = 0.5;  // a zone's floor shade over the background
const PALER = 0.2;       // a zone's soft lines: its floor as shown, this far towards white

const COLOUR = {
    background: '#16181c',
    gridMinor: 'rgba(255, 255, 255, 0.045)',
    gridMajor: 'rgba(255, 255, 255, 0.09)',
    edge: '#9aa1ad',
    construction: '#6b717c',
    vertex: '#d0d4dc',
    selected: '#ffb43c',
    selectedFill: 'rgba(255, 180, 60, 0.22)',
    hover: '#ffffff',
    hoverFill: 'rgba(255, 255, 255, 0.08)',
    snap: '#5ad2ff',
    start: '#ff6a8a',
    solid: '#4a4e57',
};

type Paste = {
    kind: 'paste'; clip: Doc; what: string; middle: WorldPoint; dx: number; dy: number;
    base?: Doc; result?: EditResult; selection: Selection;    // pasted into base
};

type Gesture =
    | { kind: 'idle' }
    | { kind: 'pan'; sx: number; sy: number; resume?: Paste }    // a pan can pause a paste
    | {
        kind: 'press'; sx: number; sy: number; selecting: boolean; adding: boolean;
        hit: Hit; snap: Snap;
    }
    | { kind: 'draw'; from: Snap; to: Snap; result?: EditResult }
    | {
        kind: 'move'; base: Doc; moving: Selection; anchor: Vertex; grab: WorldPoint;
        target?: Snap; dx: number; dy: number; result?: EditResult;
    }
    | { kind: 'box'; sx0: number; sy0: number; sx1: number; sy1: number; adding: boolean }
    | { kind: 'player'; sx: number; sy: number; start: Start; aiming: boolean; doc: Doc }
    | Paste;

const NOTHING: Selection = new Set();

function count(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

function counts(vertices: number, edges: number, zones: number): string {
    return [count(vertices, 'vertex', 'vertices'), count(edges, 'edge', 'edges'),
        count(zones, 'zone', 'zones')].join(', ');
}

function describeMap(map: PortalMap): string {
    return counts(map.vertices.length, map.edges.length, map.zones.length);
}

// Whether a clipboard event is the editor's: not one in a field, nor a copy of text selected
// on the page.
function clipboardEvent(e: ClipboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return false;
    }
    return e.type === 'paste' || (window.getSelection()?.isCollapsed ?? true);
}

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

// A zone's soft lines' colour: its floor as it shows over the background, a little paler.
function softColour(floorShade: number): string {
    const background = [1, 3, 5].map((k) => parseInt(COLOUR.background.slice(k, k + 2), 16));
    const shown = shadeRgb(floorShade).map((c, k) =>
        c * ZONE_ALPHA + background[k]! * (1 - ZONE_ALPHA));
    return css(shown.map((c) => c + (255 - c) * PALER), 1);
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
        window.addEventListener('copy', (e) => this.copy(e));
        window.addEventListener('cut', (e) => this.copy(e));
        window.addEventListener('paste', (e) => this.paste(e));
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
        const { mode } = this.editor;
        return mode === 'select' ? !this.shift : mode === 'geometry' && this.shift;
    }

    private get playing(): boolean {
        return this.editor.mode === 'player';
    }

    private pointerDown(e: PointerEvent) {
        const [sx, sy] = this.local(e);
        this.pointer = { sx, sy };
        this.shift = e.shiftKey;
        const g = this.gesture;
        if (g.kind === 'paste' && e.button === 0) {
            this.putDown(g);
            return;
        }
        if (g.kind !== 'idle' && g.kind !== 'paste') {
            return;
        }
        if (e.button === 1 || e.button === 2) {
            this.gesture = { kind: 'pan', sx, sy, resume: g.kind === 'paste' ? g : undefined };
        } else if (g.kind === 'paste') {
            return;
        } else if (e.button === 0 && this.playing) {
            const { doc, grid } = this.editor;
            const at = roundToGrid(this.view.toWorld(sx, sy), grid);
            const start = { ...at, angle: doc.map.start.angle };
            this.gesture = { kind: 'player', sx, sy, start, aiming: false, doc };
            this.updatePlayer(this.gesture, sx, sy);
        } else if (e.button === 0) {
            const { doc } = this.editor;
            this.gesture = {
                kind: 'press', sx, sy, selecting: this.selecting, adding: e.ctrlKey || e.metaKey,
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
            case 'player':
                this.updatePlayer(g, sx, sy);
                break;
            case 'paste':
                this.updatePaste(g, sx, sy);
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
            case 'pan':
                if (g.resume) {
                    this.gesture = g.resume;
                    this.updatePaste(g.resume, ...this.local(e));
                }
                break;
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
            case 'player':
                this.putStart(g.start.x, g.start.y, g.start.angle);
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
        } else if (g.kind === 'player') {
            this.updatePlayer(g, sx, sy);
        } else if (g.kind === 'paste') {
            this.updatePaste(g, sx, sy);
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
            case 'g':
            case 'G':
                editor.setMode('geometry');
                break;
            case 's':
            case 'S':
                editor.setMode('select');
                break;
            case 'p':
            case 'P':
                if (this.gesture.kind === 'paste') {
                    this.cancel();    // player mode has no selection to paste into
                }
                editor.setMode('player');
                break;
            case 'Escape':
                if (this.gesture.kind !== 'idle') {
                    this.cancel();
                } else if (!this.playing) {
                    editor.select([]);
                }
                break;
            case 'Delete':
            case 'Backspace':
                this.deleteSelection();
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

    // A click in geometry mode: select a vertex, or add one where it snaps.
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

    // The start where a press put it, aimed at the pointer once it's dragged: to the nearest
    // ANGLE_SNAP with the grid on.
    private updatePlayer(g: Extract<Gesture, { kind: 'player' }>, sx: number, sy: number) {
        g.aiming ||= Math.hypot(sx - g.sx, sy - g.sy) >= DRAG_START;
        let { angle } = g.start;
        if (g.aiming) {
            const p = this.view.toWorld(sx, sy);
            const turns = Math.atan2(p.y - g.start.y, p.x - g.start.x) / (2 * Math.PI);
            const snap = this.editor.gridOn ? ANGLE_SNAP : 1;
            angle = Math.round(turns * ANGLE_STEPS / snap) * snap;
            angle = ((angle % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
        }
        if (g.doc === this.editor.doc || angle !== g.start.angle) {
            g.start = { ...g.start, angle };
            g.doc = setStart(this.editor.doc, g.start.x, g.start.y, angle);
        }
    }

    // Put the start somewhere, if that's a change.
    private putStart(x: number, y: number, angle: number) {
        const { editor } = this;
        const now = editor.doc.map.start;
        if (x === now.x && y === now.y && angle === now.angle) {
            return;
        }
        try {
            editor.commit(setStart(editor.doc, x, y, angle), editor.selection);
        } catch (error) {
            if (!(error instanceof RangeError)) {
                throw error;
            }
            editor.tell(`refused: ${error.message}`);
        }
    }

    // Copy the selection to the clipboard, as a map of its own; cut deletes it too.
    private copy(e: ClipboardEvent) {
        const { editor } = this;
        const { doc, selection } = editor;
        if (!clipboardEvent(e) || !e.clipboardData || this.gesture.kind !== 'idle') {
            return;
        }
        if (this.playing || selection.size === 0) {
            editor.tell(`nothing selected to ${e.type}`);
            return;
        }
        const clip = extract(doc, selection, editor.defaults);
        e.clipboardData.setData('text/plain', writeMap(clip.map));
        e.preventDefault();
        if (e.type === 'cut') {
            const result = this.attempt(() => deleteVertices(doc, selection, editor.defaults));
            if (!result) {
                return;
            }
            editor.commit(result.doc, []);
        }
        editor.tell(`${e.type === 'cut' ? 'cut' : 'copied'} ${describeMap(clip.map)}`);
    }

    // Float the clipboard's map, its middle at the pointer (or the view's middle).
    private paste(e: ClipboardEvent) {
        const { editor, view } = this;
        if (!clipboardEvent(e) || !e.clipboardData || this.gesture.kind !== 'idle') {
            return;
        }
        e.preventDefault();
        if (this.playing) {
            editor.tell('paste in geometry or selection mode: player mode has no selection');
            return;
        }
        const text = e.clipboardData.getData('text/plain');
        const parsed = parseMap(text);
        if (!parsed.ok) {
            editor.tell(/^\s*portalmap\b/.test(text)
                ? `can't paste: the clipboard's map doesn't load: ${parsed.errors[0]}`
                : `nothing to paste: the clipboard doesn't hold a map`);
            return;
        }
        const clip = docFromMap(parsed.map, parsed.zoneRegions);
        const { vertices } = clip.map;
        if (!vertices.length) {
            editor.tell(`nothing to paste: the clipboard's map is empty`);
            return;
        }
        const xs = vertices.map((p) => p.x);
        const ys = vertices.map((p) => p.y);
        const middle = {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: (Math.min(...ys) + Math.max(...ys)) / 2,
        };
        const g: Paste = {
            kind: 'paste', clip, what: describeMap(clip.map), middle, dx: NaN, dy: NaN,
            selection: NOTHING,
        };
        this.gesture = g;
        editor.message = '';
        const at = this.pointer ?? { sx: view.width / 2, sy: view.height / 2 };
        this.updatePaste(g, at.sx, at.sy);
        this.redraw();
    }

    // The paste moved so its middle is at the pointer: by whole grid steps, so what was on the
    // grid stays on it, and all of it on the map.
    private updatePaste(g: Paste, sx: number, sy: number) {
        const { editor } = this;
        const p = this.view.toWorld(sx, sy);
        const step = editor.grid || 1;
        let dx = Math.round((p.x - g.middle.x) / step) * step;
        let dy = Math.round((p.y - g.middle.y) / step) * step;
        for (const q of g.clip.map.vertices) {
            dx = Math.min(COORD_MAX - q.x, Math.max(-q.x, dx));
            dy = Math.min(COORD_MAX - q.y, Math.max(-q.y, dy));
        }
        this.placePaste(g, dx, dy);
    }

    // The paste moved by dx, dy into the document, unless it's there already.
    private placePaste(g: Paste, dx: number, dy: number) {
        const { editor } = this;
        const base = editor.doc;
        if (dx === g.dx && dy === g.dy && base === g.base) {
            return;
        }
        g.dx = dx;
        g.dy = dy;
        g.base = base;
        g.result = this.attempt(() => pasteMap(base, g.clip, dx, dy, editor.defaults));
        g.selection = new Set(g.result?.added ?? []);
    }

    // Put the paste down where it floats, selected.
    private putDown(g: Paste) {
        const { editor } = this;
        this.placePaste(g, g.dx, g.dy);    // into the document as it is now
        if (!g.result) {
            return;    // it can't go there: the status line says why
        }
        this.gesture = { kind: 'idle' };
        editor.commit(g.result.doc, g.result.added);
        editor.tell(`pasted ${g.what}`);
    }

    // Delete the selected edges, leaving their vertices selected; with none, the vertices.
    private deleteSelection() {
        const { editor } = this;
        const { doc, selection } = editor;
        if (this.gesture.kind !== 'idle' || selection.size === 0 || this.playing) {
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

    // Nudge the selection, or in player mode the start, kept on the map.
    private nudge(dx: number, dy: number) {
        const { editor } = this;
        const { doc, selection } = editor;
        if (this.gesture.kind !== 'idle') {
            return;
        }
        if (this.playing) {
            const { start } = doc.map;
            const on = (n: number) => Math.min(COORD_MAX, Math.max(0, n));
            this.putStart(on(start.x + dx), on(start.y + dy), start.angle);
            return;
        }
        if (selection.size === 0) {
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
        const g = this.gesture.kind === 'pan' && this.gesture.resume
            ? this.gesture.resume : this.gesture;
        if (g.kind === 'paste' && g.result) {
            return { doc: g.result.doc, selection: g.selection };
        }
        if (g.kind === 'move' && g.result) {
            return { doc: g.result.doc, selection: mapSelection(g.moving, g.result.vertexMap) };
        }
        if (g.kind === 'draw' && g.result) {
            return { doc: g.result.doc, selection: new Set(g.result.drawn) };
        }
        if (g.kind === 'player') {
            return { doc: g.doc, selection: NOTHING };
        }
        return { doc: this.editor.doc, selection: this.playing ? NOTHING : this.editor.selection };
    }

    private measure() {
        this.view.width = this.canvas.clientWidth;
        this.view.height = this.canvas.clientHeight;
    }

    private draw() {
        if (this.gesture.kind === 'paste') {
            const g = this.gesture;
            this.placePaste(g, g.dx, g.dy);    // into the document as it is now
        }
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
        const placing: Snap | undefined = idle && !this.selecting && !this.playing
            ? snapAt(doc, view, this.pointer!.sx, this.pointer!.sy, this.editor.grid) : undefined;
        const putting: Vertex | undefined = idle && this.playing
            ? roundToGrid(view.toWorld(this.pointer!.sx, this.pointer!.sy), this.editor.grid)
            : undefined;

        // zones, in their floor shades; solid ones hatched
        zones.forEach((zone, z) => {
            zonePath(z);
            ctx.fillStyle = zone.solid ? this.solidFill(ctx)
                : css(shadeRgb(zone.floorShade), ZONE_ALPHA);
            ctx.fill();
        });

        // the soft lines between an open zone's cells, once each, a little paler than its floor
        if (this.editor.showCells) {
            const isEdge = new Set(edges.map((e) => Math.min(e.a, e.b) * 4294967296
                + Math.max(e.a, e.b)));
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            zones.forEach((zone, z) => {
                if (zone.solid) {
                    return;
                }
                ctx.strokeStyle = softColour(zone.floorShade);
                ctx.beginPath();
                for (const cell of cells[z]!) {
                    cell.forEach((u, k) => {
                        const v = cell[(k + 1) % cell.length]!;
                        if (u < v && !isEdge.has(u * 4294967296 + v)) {
                            ctx.moveTo(...screen(vertices[u]!));
                            ctx.lineTo(...screen(vertices[v]!));
                        }
                    });
                }
                ctx.stroke();
            });
            ctx.setLineDash([]);
        }

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

        this.drawStart(ctx, doc.map.start, COLOUR.start);

        // where the pointer would place, draw to, move to, or put the start
        const g = this.gesture;
        if (placing) {
            this.drawSnap(ctx, placing);
        } else if (putting) {
            this.drawStart(ctx, { ...putting, angle: doc.map.start.angle }, COLOUR.snap);
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
            : g.kind === 'move' || g.kind === 'paste' ? 'move'
            : this.selecting ? 'default' : 'crosshair';
        this.report(this.status(doc, selection, placing?.at ?? putting));
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
    private drawStart(ctx: CanvasRenderingContext2D, start: Start, colour: string) {
        const [sx, sy] = this.view.toScreen(start.x, start.y);
        const turn = (start.angle / ANGLE_STEPS) * 2 * Math.PI;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, 2 * Math.PI);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.sin(turn) * 13, sy - Math.cos(turn) * 13);
        ctx.stroke();
    }

    // The status line; pointed is where a click would place a vertex or put the start.
    private status(doc: Doc, selection: Selection, pointed: Vertex | undefined): string {
        const { editor } = this;
        const parts = [
            this.selecting ? 'Select' : this.playing ? 'Player' : 'Geometry',
            describeMap(doc.map)
                + (editor.showCells ? `, ${count(openCells(doc).length, 'cell', 'cells')}` : ''),
        ];
        if (selection.size) {
            const edges = selectedEdges(doc, selection).length;
            const zones = selectedZones(doc, selection).length;
            parts.push(`selected: ${counts(selection.size, edges, zones)}`);
        }
        parts.push(editor.gridOn ? `grid ${editor.gridSize}` : 'grid off');
        const g = this.gesture;
        const at = pointed ?? (g.kind === 'draw' ? g.to.at : g.kind === 'move' ? g.target?.at
            : g.kind === 'player' ? g.start : undefined);
        if (at) {
            parts.push(`x ${at.x} y ${at.y}`);
        } else if (this.pointer) {
            const p = this.view.toWorld(this.pointer.sx, this.pointer.sy);
            parts.push(`x ${Math.round(p.x)} y ${Math.round(p.y)}`);
        }
        if (g.kind === 'move' && (g.dx || g.dy)) {
            parts.push(`moving ${g.dx}, ${g.dy}`);
        }
        if (g.kind === 'player') {
            parts.push(`facing ${g.start.angle}`);
        }
        if (g.kind === 'paste') {
            parts.push(`pasting ${g.what}: click to put it down, Esc to cancel`);
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
