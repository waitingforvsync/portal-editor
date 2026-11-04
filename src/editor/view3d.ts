// view3d.ts - the 3D view: the map as the engine shows it, from a camera orbiting the plan's
// centre, at the middle of the map's heights. It shares the plan's pan and zoom (right drag
// pans and the wheel zooms, in either view; the zoom sets how far off the camera is) and has
// its own yaw and pitch (left drag). A click selects: a wall, riser or lintel selects its edge,
// a floor, ceiling, top or bottom its zone; with Shift it adds to the selection, and a click on
// nothing clears it. It shows what the plan shows, an edit under way included.

import type { Doc } from '../map/edit';
import { zoneAt, type Hit } from './hit';
import { add, Camera, distanceFor, MAX_PITCH, type Vec3 } from './camera';
import type { Editor } from './editor';
import type { PlanView } from './plan';
import { HOVER, MARKER, Renderer, SELECTED } from './renderer';
import { buildScene, pick, type Scene, type Surface } from './scene';
import { selectedEdges, selectedZones, verticesOf, type Selection } from './selection';

const DRAG_START = 4;        // pixels the pointer moves before a press becomes a drag
const TURN = 0.008;          // radians a pixel of drag turns the camera
const EYE_HEIGHT = 80;       // the engine's PT_CAM_HEIGHT, 10 steps of 8
const ARROW = 48;            // the start marker's arrow, in units

type Gesture =
    | { kind: 'idle' }
    | { kind: 'press'; sx: number; sy: number; adding: boolean }
    | { kind: 'turn'; sx: number; sy: number; yaw: number; pitch: number }
    | { kind: 'pan'; camera: Camera; grab: Vec3; centre: [number, number] };

function describe(surface: Surface, doc: Doc): string {
    switch (surface.kind) {
        case 'wall':
        case 'riser':
        case 'lintel':
            return `${surface.kind} of edge ${surface.owner}`;
        case 'top':
        case 'bottom':
            return `${surface.kind} of solid zone ${surface.owner}`;
        default:
            return `${surface.kind} of zone ${surface.owner}`
                + ` (${surface.kind === 'floor' ? doc.map.zones[surface.owner]!.floor
                    : doc.map.zones[surface.owner]!.ceiling})`;
    }
}

export class View3D {
    readonly camera = new Camera();
    private readonly renderer: Renderer;
    private gesture: Gesture = { kind: 'idle' };
    private frame = 0;
    private scene: Scene | undefined;
    private sceneDoc: Doc | undefined;
    private hover: number | undefined;
    private flagged: { scene: Scene; selection: Selection; hover: number | undefined } | undefined;

    // Throws if the browser has no WebGL2.
    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly editor: Editor,
        private readonly plan: PlanView,
    ) {
        this.renderer = new Renderer(canvas);
        canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
        canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
        canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
        canvas.addEventListener('pointercancel', () => {
            this.gesture = { kind: 'idle' };
        });
        canvas.addEventListener('pointerleave', () => this.setHover(undefined));
        canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        new ResizeObserver(() => this.redraw()).observe(canvas);
        plan.onDraw(() => this.redraw());
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

    private pointerDown(e: PointerEvent) {
        if (this.gesture.kind !== 'idle') {
            return;
        }
        const [sx, sy] = this.local(e);
        if (e.button === 0) {
            this.gesture = { kind: 'press', sx, sy, adding: e.shiftKey };
        } else if (e.button === 1 || e.button === 2) {
            // the point grabbed on the level of the target stays under the pointer
            const grab = Camera.onLevel(this.camera.ray(sx, sy), this.camera.target[2]);
            if (!grab) {
                return;
            }
            const { view } = this.plan;
            this.gesture = {
                kind: 'pan', camera: this.camera.copy(), grab, centre: [view.centreX, view.centreY],
            };
        } else {
            return;
        }
        this.editor.message = '';
        this.canvas.setPointerCapture(e.pointerId);
    }

    private pointerMove(e: PointerEvent) {
        const [sx, sy] = this.local(e);
        const g = this.gesture;
        if (g.kind === 'press' && Math.hypot(sx - g.sx, sy - g.sy) >= DRAG_START) {
            this.gesture = {
                kind: 'turn', sx: g.sx, sy: g.sy, yaw: this.camera.yaw, pitch: this.camera.pitch,
            };
            this.setHover(undefined);
        }
        const now = this.gesture;
        if (now.kind === 'turn') {
            this.camera.yaw = now.yaw + (sx - now.sx) * TURN;
            this.camera.pitch = Math.min(MAX_PITCH,
                Math.max(-MAX_PITCH, now.pitch + (sy - now.sy) * TURN));
            this.redraw();
        } else if (now.kind === 'pan') {
            const at = Camera.onLevel(now.camera.ray(sx, sy), now.camera.target[2]);
            if (at) {
                this.plan.view.centreX = now.centre[0] + now.grab[0] - at[0];
                this.plan.view.centreY = now.centre[1] + now.grab[1] - at[1];
                this.plan.redraw();
            }
        } else if (now.kind === 'idle' && this.scene) {
            this.setHover(pick(this.scene, this.camera.ray(sx, sy)));
        }
    }

    private pointerUp(e: PointerEvent) {
        const g = this.gesture;
        this.gesture = { kind: 'idle' };
        if (g.kind === 'press') {
            const [sx, sy] = this.local(e);
            this.click(sx, sy, g.adding);
        }
    }

    private wheel(e: WheelEvent) {
        e.preventDefault();
        const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        const { view } = this.plan;
        view.zoomAt(view.width / 2, view.height / 2, Math.exp(-e.deltaY * lines * 0.0015));
        this.plan.redraw();
    }

    private click(sx: number, sy: number, adding: boolean) {
        const { editor, scene } = this;
        if (!scene || this.sceneDoc !== editor.doc) {
            return;    // the plan is mid-edit
        }
        const s = pick(scene, this.camera.ray(sx, sy));
        const surface = s === undefined ? undefined : scene.surfaces[s]!;
        const hit: Hit = !surface ? { kind: 'none' }
            : ['wall', 'riser', 'lintel'].includes(surface.kind)
                ? { kind: 'edge', index: surface.owner } : { kind: 'zone', index: surface.owner };
        const vertices = verticesOf(editor.doc, hit);
        editor.select(adding && vertices.length ? [...editor.selection, ...vertices] : vertices);
    }

    private setHover(surface: number | undefined) {
        if (surface === this.hover) {
            return;
        }
        this.hover = surface;
        const s = surface === undefined || !this.scene ? undefined : this.scene.surfaces[surface];
        this.plan.hint = s && this.sceneDoc ? describe(s, this.sceneDoc) : '';
        this.plan.redraw();
        this.redraw();
    }

    // ---- drawing ----

    private draw() {
        const { canvas, camera, plan } = this;
        const ratio = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width === 0 || height === 0) {
            return;
        }
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);

        const { doc, selection } = plan.shown();
        if (doc !== this.sceneDoc) {
            this.scene = buildScene(doc);
            this.sceneDoc = doc;
            this.renderer.setScene(this.scene);
            this.hover = undefined;
            this.plan.hint = '';
            this.flagged = undefined;
        }
        const scene = this.scene!;

        camera.width = width;
        camera.height = height;
        camera.target = [plan.view.centreX, plan.view.centreY, (scene.low + scene.high) / 2];
        camera.distance = distanceFor(height, plan.view.scale);

        const f = this.flagged;
        if (!f || f.scene !== scene || f.selection !== selection || f.hover !== this.hover) {
            this.renderer.setFlags(this.flags(doc, scene, selection));
            this.flagged = { scene, selection, hover: this.hover };
        }
        this.setOverlay(doc, scene, selection);

        // depth from just ahead of the eye to past the far side of the map
        const { vertices } = doc.map;
        const eye = camera.eye;
        let far = camera.distance;
        for (const p of [...vertices, doc.map.start]) {
            for (const z of [scene.low, scene.high]) {
                far = Math.max(far, Math.hypot(p.x - eye[0], p.y - eye[1], z - eye[2]));
            }
        }
        far = far * 1.1 + 1;
        this.renderer.draw(camera, {
            near: Math.max(far / 10000, camera.distance / 100), far,
            dither: this.editor.dither, ratio,
        });
    }

    // Each surface's flags: selected (its edge or zone is), and under the pointer.
    private flags(doc: Doc, scene: Scene, selection: Selection): Uint8Array {
        const edges = new Set(selectedEdges(doc, selection));
        const zones = new Set(selectedZones(doc, selection));
        return Uint8Array.from(scene.surfaces, (s, i) => {
            const byEdge = s.kind === 'wall' || s.kind === 'riser' || s.kind === 'lintel';
            const chosen = byEdge ? edges.has(s.owner) : zones.has(s.owner);
            return (chosen ? SELECTED : 0) | (i === this.hover ? HOVER : 0);
        });
    }

    // The start, standing at eye height facing its way; and a post up each selected vertex.
    private setOverlay(doc: Doc, scene: Scene, selection: Selection) {
        const ends: Vec3[] = [];
        const flags: number[] = [];
        const line = (a: Vec3, b: Vec3, flag: number) => {
            ends.push(a, b);
            flags.push(flag);
        };
        const { start, zones, vertices } = doc.map;
        const z = zoneAt(doc, start);
        const floor = z !== undefined && !zones[z]!.solid ? zones[z]!.floor : scene.low;
        const turn = (start.angle / 256) * 2 * Math.PI;
        const foot: Vec3 = [start.x, start.y, floor];
        const eye = add(foot, [0, 0, 1], EYE_HEIGHT);
        const ahead: Vec3 = [Math.cos(turn), Math.sin(turn), 0];
        const tip = add(eye, ahead, ARROW);
        const back = add(tip, ahead, -ARROW / 3);
        line(foot, eye, MARKER);
        line(eye, tip, MARKER);
        line(tip, add(back, [-ahead[1], ahead[0], 0], ARROW / 5), MARKER);
        line(tip, add(back, [ahead[1], -ahead[0], 0], ARROW / 5), MARKER);
        for (const v of selection) {
            const p = vertices[v];
            if (p) {
                const [low, high] = scene.spans[v] ?? [scene.low, scene.high];
                line([p.x, p.y, low], [p.x, p.y, high], SELECTED);
            }
        }
        this.renderer.setOverlay(ends, flags);
    }
}
