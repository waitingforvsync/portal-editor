// regions.ts - the regions a map's edges enclose, traced from the edges alone: each one's
// perimeter, clockwise, and its holes. Edges with the same region on both sides are
// construction lines and take no part. Expects edges that don't cross or overlap.

import type { Edge, Vertex } from './map';
import { compareDirections, pointInRing, ringArea2 } from './geometry';

export interface Region {
    perimeter: number[];    // clockwise
    holes: number[][];      // anticlockwise, each the outline of what the region surrounds
}

export interface Regions {
    regions: Region[];
    outside: number[][];    // the outlines of what nothing surrounds, anticlockwise
    construction: number[]; // edges with the same region on both sides
}

// A cycle's canonical rotation, the lexicographically smallest: equal cycles compare equal.
export function canonicalCycle(cycle: readonly number[]): number[] {
    let best = 0;
    for (let start = 1; start < cycle.length; start++) {
        for (let i = 0; i < cycle.length; i++) {
            const a = cycle[(start + i) % cycle.length]!;
            const b = cycle[(best + i) % cycle.length]!;
            if (a !== b) {
                if (a < b) {
                    best = start;
                }
                break;
            }
        }
    }
    return [...cycle.slice(best), ...cycle.slice(0, best)];
}

// Half-edge h runs along edge h >> 1, from a to b when even, b to a when odd.
function halfFrom(edges: readonly Edge[], h: number): number {
    const e = edges[h >> 1]!;
    return h & 1 ? e.b : e.a;
}

function halfTo(edges: readonly Edge[], h: number): number {
    const e = edges[h >> 1]!;
    return h & 1 ? e.a : e.b;
}

// Trace the boundary cycles of the live edges, each with its region on the right: arriving
// at a vertex, leave by the first edge anticlockwise (in plan) from the one arrived along.
function traceCycles(
    vertices: readonly Vertex[], edges: readonly Edge[], live: readonly boolean[],
) {
    const out = new Map<number, number[]>();    // vertex -> half-edges leaving it
    for (let e = 0; e < edges.length; e++) {
        if (!live[e]) {
            continue;
        }
        for (const h of [2 * e, 2 * e + 1]) {
            const v = halfFrom(edges, h);
            let list = out.get(v);
            if (list === undefined) {
                list = [];
                out.set(v, list);
            }
            list.push(h);
        }
    }
    const position = new Map<number, number>();    // half-edge -> its place in its vertex's list
    for (const [v, list] of out) {
        const from = vertices[v]!;
        list.sort((h0, h1) => {
            const p = vertices[halfTo(edges, h0)]!;
            const q = vertices[halfTo(edges, h1)]!;
            return compareDirections(p.x - from.x, p.y - from.y, q.x - from.x, q.y - from.y);
        });
        list.forEach((h, i) => position.set(h, i));
    }

    const cycleOf = new Map<number, number>();    // half-edge -> its cycle
    const cycles: number[][] = [];
    for (let e = 0; e < edges.length; e++) {
        if (!live[e]) {
            continue;
        }
        for (const first of [2 * e, 2 * e + 1]) {
            if (cycleOf.has(first)) {
                continue;
            }
            const cycle: number[] = [];
            let h = first;
            while (!cycleOf.has(h)) {
                cycleOf.set(h, cycles.length);
                cycle.push(halfFrom(edges, h));
                const list = out.get(halfTo(edges, h))!;
                const back = position.get(h ^ 1)!;
                h = list[(back + list.length - 1) % list.length]!;
            }
            cycles.push(cycle);
        }
    }
    return { cycles, cycleOf };
}

export function findRegions(vertices: readonly Vertex[], edges: readonly Edge[]): Regions {
    // construction lines have one cycle along both sides: drop them and trace again
    const live = edges.map(() => true);
    const first = traceCycles(vertices, edges, live);
    const construction: number[] = [];
    for (let e = 0; e < edges.length; e++) {
        if (first.cycleOf.get(2 * e) === first.cycleOf.get(2 * e + 1)) {
            construction.push(e);
            live[e] = false;
        }
    }
    const { cycles } = construction.length ? traceCycles(vertices, edges, live) : first;

    const ring = (cycle: readonly number[]) => cycle.map((v) => vertices[v]!);
    const regions: Region[] = [];
    const holes: number[][] = [];
    for (const cycle of cycles) {
        const area = ringArea2(ring(cycle));
        if (area > 0) {
            regions.push({ perimeter: canonicalCycle(cycle), holes: [] });
        } else if (area < 0) {
            holes.push(canonicalCycle(cycle));
        } else {
            throw new Error('a boundary cycle with no area: edges overlap');
        }
    }

    // a hole belongs to the smallest perimeter round one of its vertices; perimeters through
    // that vertex are of the regions inside the hole, so don't count
    const outside: number[][] = [];
    for (const hole of holes) {
        const p = vertices[hole[0]!]!;
        let owner: Region | undefined;
        let ownerArea = Infinity;
        for (const region of regions) {
            const r = ring(region.perimeter);
            if (pointInRing(p, r) === 'inside') {
                const area = ringArea2(r);
                if (area < ownerArea) {
                    owner = region;
                    ownerArea = area;
                }
            }
        }
        (owner ? owner.holes : outside).push(hole);
    }
    return { regions, outside, construction };
}
