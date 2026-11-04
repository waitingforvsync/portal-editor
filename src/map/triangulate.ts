// triangulate.ts - a region cut into triangles, the first step to its convex cells (cells.ts):
// each hole is joined to the outline by a bridge to a vertex it can see, making one ring, and
// then ears are clipped from the ring. Exact on whole-unit points. Triangles run clockwise in
// plan, as the perimeter does, and every vertex of the region is a corner of one.

import { onSegmentInterior, segmentsCross, side, type Point } from './geometry';
import type { Vertex } from './map';
import type { Region } from './regions';

export type Triangle = [number, number, number];

function same(p: Point, q: Point): boolean {
    return p.x === q.x && p.y === q.y;
}

// True when q lies in the cycle's interior just beyond its vertex k: the interior is on the
// right of each side.
function inCone(vertices: readonly Vertex[], cycle: readonly number[], k: number, q: Point) {
    const n = cycle.length;
    const a = vertices[cycle[(k + n - 1) % n]!]!;
    const b = vertices[cycle[k]!]!;
    const c = vertices[cycle[(k + 1) % n]!]!;
    const right = side(a, b, q) > 0;
    const next = side(b, c, q) > 0;
    return side(a, b, c) > 0 ? right && next : right || next;
}

// True when segment p-q meets none of the cycles' sides or vertices but at its ends.
function clear(vertices: readonly Vertex[], cycles: readonly (readonly number[])[], p: Point,
    q: Point): boolean {
    for (const cycle of cycles) {
        for (let k = 0; k < cycle.length; k++) {
            const a = vertices[cycle[k]!]!;
            const b = vertices[cycle[(k + 1) % cycle.length]!]!;
            if (onSegmentInterior(p, q, a) || segmentsCross(p, q, a, b)) {
                return false;
            }
        }
    }
    return true;
}

// The ring with a hole spliced in, by the shortest bridge that runs inside the region between
// them, or undefined if there's none.
function bridge(vertices: readonly Vertex[], ring: readonly number[], hole: readonly number[],
    others: readonly (readonly number[])[]): number[] | undefined {
    const pairs: [number, number, number][] = [];
    ring.forEach((r, i) => {
        hole.forEach((h, j) => {
            const p = vertices[r]!;
            const q = vertices[h]!;
            pairs.push([(p.x - q.x) ** 2 + (p.y - q.y) ** 2, i, j]);
        });
    });
    pairs.sort((s, t) => s[0] - t[0]);
    for (const [, i, j] of pairs) {
        const p = vertices[ring[i]!]!;
        const q = vertices[hole[j]!]!;
        if (!same(p, q) && inCone(vertices, ring, i, q) && inCone(vertices, hole, j, p)
            && clear(vertices, [ring, hole, ...others], p, q)) {
            const around = [...hole.slice(j), ...hole.slice(0, j), hole[j]!];
            return [...ring.slice(0, i + 1), ...around, ...ring.slice(i)];
        }
    }
    return undefined;
}

// The region as one ring, its holes bridged in, those furthest up the page first.
function ringOf(vertices: readonly Vertex[], region: Region): number[] {
    let ring = [...region.perimeter];
    const top = (cycle: readonly number[]) => Math.max(...cycle.map((v) => vertices[v]!.x));
    const pending = [...region.holes].sort((a, b) => top(b) - top(a));
    while (pending.length) {
        let joined = false;
        for (let k = 0; k < pending.length && !joined; k++) {
            const others = pending.filter((_, m) => m !== k);
            const next = bridge(vertices, ring, pending[k]!, others);
            if (next) {
                ring = next;
                pending.splice(k, 1);
                joined = true;
            }
        }
        if (!joined) {
            break;    // a region the edges enclose always has a bridge for some hole
        }
    }
    return ring;
}

// True when no vertex of the ring but the corners' own lies in or on triangle a b c.
function empty(vertices: readonly Vertex[], ring: readonly number[], a: Point, b: Point,
    c: Point): boolean {
    for (const v of ring) {
        const q = vertices[v]!;
        if (same(q, a) || same(q, b) || same(q, c)) {
            continue;
        }
        if (side(a, b, q) >= 0 && side(b, c, q) >= 0 && side(c, a, q) >= 0) {
            return false;
        }
    }
    return true;
}

// Ears are sought from the ring's vertex start on (round the perimeter, from its first
// vertex): a different start can give different triangles.
export function triangulate(vertices: readonly Vertex[], region: Region, start = 0): Triangle[] {
    const bridged = ringOf(vertices, region);
    const at = start % bridged.length;
    const ring = [...bridged.slice(at), ...bridged.slice(0, at)];
    const out: Triangle[] = [];
    while (ring.length > 3) {
        const n = ring.length;
        let clip = -1;
        let fallback = -1;
        for (let k = 0; k < n && clip < 0; k++) {
            const a = vertices[ring[(k + n - 1) % n]!]!;
            const b = vertices[ring[k]!]!;
            const c = vertices[ring[(k + 1) % n]!]!;
            const turn = side(a, b, c);
            if (turn > 0 && empty(vertices, ring, a, b, c)) {
                clip = k;
            } else if (turn > 0 && fallback < 0) {
                fallback = k;
            }
        }
        // a ring with no ear isn't one the edges enclose; finish it rather than stop
        const k = clip >= 0 ? clip : fallback;
        if (k < 0) {
            return out;
        }
        const a = ring[(k + n - 1) % n]!;
        const b = ring[k]!;
        const c = ring[(k + 1) % n]!;
        if (side(vertices[a]!, vertices[b]!, vertices[c]!) > 0) {
            out.push([a, b, c]);
        }
        ring.splice(k, 1);
    }
    const [a, b, c] = ring;
    if (ring.length === 3 && side(vertices[a!]!, vertices[b!]!, vertices[c!]!) > 0) {
        out.push([a!, b!, c!]);
    }
    return out;
}

