// cells.ts - each zone cut into convex cells, as the engine holds the map. The zone's region
// is triangulated (triangulate.ts), then neighbouring pieces are merged across the diagonal
// between them while the result stays convex and within the engine's PT_MAX_RING sides
// (Hertel and Mehlhorn's method: at worst four times the fewest cells). The diagonals left are
// the soft edges between cells. How few cells that leaves depends on the triangles and the
// order the diagonals are tried in, so several of each are tried and the fewest cells kept. A
// cell's ring runs clockwise, as a zone's perimeter does, through every vertex along it; a
// vertex where it runs straight on is kept, as the engine allows.

import type { Doc } from './edit';
import { side } from './geometry';
import type { Vertex } from './map';
import type { Region } from './regions';
import { triangulate, type Triangle } from './triangulate';

export const MAX_RING = 8;    // portalc map.h's PT_MAX_RING: sides a cell
const STARTS = 16;            // triangulations tried, from this many places round the ring

function sideKey(u: number, v: number): number {
    return u * 4294967296 + v;
}

function convex(vertices: readonly Vertex[], ring: readonly number[]): boolean {
    const n = ring.length;
    return ring.every((v, k) => side(vertices[ring[(k + n - 1) % n]!]!, vertices[v]!,
        vertices[ring[(k + 1) % n]!]!) >= 0);
}

// Rings p (with side u to v) and q (with side v to u) as one, or undefined if that would
// pass through a vertex twice.
function join(p: readonly number[], q: readonly number[], u: number, v: number) {
    const from = (ring: readonly number[], a: number, b: number) => {
        const k = ring.findIndex((x, i) => x === a && ring[(i + 1) % ring.length] === b);
        return [...ring.slice(k + 1), ...ring.slice(0, k + 1)];    // b round to a
    };
    const joined = [...from(p, u, v), ...from(q, v, u).slice(1, -1)];
    return new Set(joined).size === joined.length ? joined : undefined;
}

// Triangles merged into convex cells, trying the diagonals longest first or shortest first.
function merge(vertices: readonly Vertex[], triangles: readonly Triangle[],
    longestFirst: boolean): number[][] {
    const rings: (number[] | undefined)[] = triangles.map((t) => [...t]);
    const owner = new Map<number, number>();    // each side, as a ring has it, to its ring
    const claim = (i: number) => {
        const ring = rings[i]!;
        ring.forEach((u, k) => owner.set(sideKey(u, ring[(k + 1) % ring.length]!), i));
    };
    rings.forEach((_, i) => claim(i));

    const diagonals: [number, number][] = [];
    for (const key of owner.keys()) {
        const u = Math.floor(key / 4294967296);
        const v = key % 4294967296;
        if (u < v && owner.has(sideKey(v, u))) {
            diagonals.push([u, v]);
        }
    }
    const length = ([u, v]: [number, number]) =>
        (vertices[u]!.x - vertices[v]!.x) ** 2 + (vertices[u]!.y - vertices[v]!.y) ** 2;
    diagonals.sort((a, b) => (longestFirst ? length(b) - length(a) : length(a) - length(b)));

    for (const [u, v] of diagonals) {
        const p = owner.get(sideKey(u, v));
        const q = owner.get(sideKey(v, u));
        if (p === undefined || q === undefined || p === q) {
            continue;
        }
        const joined = join(rings[p]!, rings[q]!, u, v);
        if (joined && joined.length <= MAX_RING && convex(vertices, joined)) {
            owner.delete(sideKey(u, v));
            owner.delete(sideKey(v, u));
            rings[p] = joined;
            rings[q] = undefined;
            claim(p);
        }
    }
    return rings.filter((ring) => ring !== undefined);
}

export function convexCells(vertices: readonly Vertex[], region: Region): number[][] {
    const n = region.perimeter.length + region.holes.reduce((sum, h) => sum + h.length + 2, 0);
    let best: number[][] | undefined;
    for (let start = 0; start < Math.min(n, STARTS); start++) {
        const triangles = triangulate(vertices, region, start);
        for (const longestFirst of [true, false]) {
            const cells = merge(vertices, triangles, longestFirst);
            if (!best || cells.length < best.length) {
                best = cells;
            }
        }
    }
    return best ?? [];
}

// Each zone's cells, worked out once for its regions and vertices: the plan and the 3D view
// share them, and an edit that changes neither (of properties, or the start) keeps them.
interface Known {
    vertices: readonly Vertex[];
    cells: number[][][];
}
const cache = new WeakMap<readonly Region[], Known>();
export function zoneCells(doc: Doc): number[][][] {
    const { regions, map: { vertices } } = doc;
    const known = cache.get(regions);
    if (known && known.vertices === vertices) {
        return known.cells;
    }
    const cells = regions.map((region) => convexCells(vertices, region));
    cache.set(regions, { vertices, cells });
    return cells;
}

// The triangles of a fan across a convex cell, leaving out any with no area.
export function fan(vertices: readonly Vertex[], cell: readonly number[]): Triangle[] {
    const out: Triangle[] = [];
    for (let k = 1; k + 1 < cell.length; k++) {
        const t: Triangle = [cell[0]!, cell[k]!, cell[k + 1]!];
        if (side(vertices[t[0]]!, vertices[t[1]]!, vertices[t[2]]!) !== 0) {
            out.push(t);
        }
    }
    return out;
}
