// hit.ts - what's under the pointer in the plan view, and where a vertex put there would
// snap to: the nearest vertex within reach, else the nearest edge within reach, else a point
// on the grid (or the nearest whole unit with the grid off).

import type { Doc } from '../map/edit';
import { onSegmentInterior } from '../map/geometry';
import type { Vertex } from '../map/map';
import { COORD_MAX, toCoord } from '../map/units';
import type { View, WorldPoint } from './view';

export const VERTEX_REACH = 8;    // screen pixels
export const EDGE_REACH = 6;

export type Hit =
    | { kind: 'vertex'; index: number }
    | { kind: 'edge'; index: number }
    | { kind: 'zone'; index: number }
    | { kind: 'none' };

// Where a new vertex would go: onto a vertex, onto an edge (splitting it), or a free point.
export type Snap =
    | { kind: 'vertex'; index: number; at: Vertex }
    | { kind: 'edge'; index: number; at: Vertex }
    | { kind: 'point'; at: Vertex };

// Vertices and edges a search should pass over.
export interface Exclude {
    vertex?: (v: number) => boolean;
    edge?: (e: number) => boolean;
}

function clampCoord(n: number) {
    return toCoord(Math.min(COORD_MAX, Math.max(0, Math.round(n))));
}

// A point rounded to the grid (size 0: to whole units), kept in range.
export function roundToGrid(p: WorldPoint, grid: number): Vertex {
    const g = grid > 0 ? grid : 1;
    return { x: clampCoord(Math.round(p.x / g) * g), y: clampCoord(Math.round(p.y / g) * g) };
}

export function nearestVertex(
    doc: Doc, view: View, sx: number, sy: number, exclude?: Exclude,
): number | undefined {
    let best: number | undefined;
    let bestDistance = VERTEX_REACH;
    doc.map.vertices.forEach((v, i) => {
        if (exclude?.vertex?.(i)) {
            return;
        }
        const [vx, vy] = view.toScreen(v.x, v.y);
        const d = Math.hypot(vx - sx, vy - sy);
        if (d <= bestDistance) {
            best = i;
            bestDistance = d;
        }
    });
    return best;
}

// The nearest edge within reach, and the point on it nearest the pointer, in whole units:
// on the grid where a grid point lies exactly on the edge there.
export function nearestEdge(
    doc: Doc, view: View, sx: number, sy: number, grid: number, exclude?: Exclude,
): { index: number; at: Vertex } | undefined {
    const p = view.toWorld(sx, sy);
    let best: { index: number; at: Vertex } | undefined;
    let bestDistance = EDGE_REACH;
    doc.map.edges.forEach((e, i) => {
        if (exclude?.edge?.(i)) {
            return;
        }
        const a = doc.map.vertices[e.a]!;
        const b = doc.map.vertices[e.b]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
        const t = Math.min(1, Math.max(0, along));
        const q = { x: a.x + t * dx, y: a.y + t * dy };
        const [qx, qy] = view.toScreen(q.x, q.y);
        const d = Math.hypot(qx - sx, qy - sy);
        if (d <= bestDistance) {
            const onGrid = roundToGrid(q, grid);
            const useGrid = grid > 0 && onSegmentInterior(a, b, onGrid);
            best = { index: i, at: useGrid ? onGrid : roundToGrid(q, 0) };
            bestDistance = d;
        }
    });
    return best;
}

function inRing(p: WorldPoint, ring: readonly Vertex[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if ((a.x > p.x) !== (b.x > p.x) && a.y + ((p.x - a.x) * (b.y - a.y)) / (b.x - a.x) > p.y) {
            inside = !inside;
        }
    }
    return inside;
}

// The zone whose region holds a point.
export function zoneAt(doc: Doc, p: WorldPoint): number | undefined {
    const ring = (cycle: readonly number[]) => cycle.map((v) => doc.map.vertices[v]!);
    const i = doc.regions.findIndex((r) => inRing(p, ring(r.perimeter))
        && !r.holes.some((h) => inRing(p, ring(h))));
    return i < 0 ? undefined : i;
}

// What a click at a screen point picks: a vertex, else an edge, else (when asked) a zone.
export function hitTest(doc: Doc, view: View, sx: number, sy: number, withZones: boolean): Hit {
    const v = nearestVertex(doc, view, sx, sy);
    if (v !== undefined) {
        return { kind: 'vertex', index: v };
    }
    const e = nearestEdge(doc, view, sx, sy, 0);
    if (e !== undefined) {
        return { kind: 'edge', index: e.index };
    }
    const z = withZones ? zoneAt(doc, view.toWorld(sx, sy)) : undefined;
    return z === undefined ? { kind: 'none' } : { kind: 'zone', index: z };
}

// Where a vertex placed at a screen point would go.
export function snapAt(
    doc: Doc, view: View, sx: number, sy: number, grid: number, exclude?: Exclude,
): Snap {
    const v = nearestVertex(doc, view, sx, sy, exclude);
    if (v !== undefined) {
        return { kind: 'vertex', index: v, at: doc.map.vertices[v]! };
    }
    const e = nearestEdge(doc, view, sx, sy, grid, exclude);
    if (e !== undefined) {
        return { kind: 'edge', ...e };
    }
    return { kind: 'point', at: roundToGrid(view.toWorld(sx, sy), grid) };
}
