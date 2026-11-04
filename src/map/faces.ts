// faces.ts - what an edge's shade colours in the engine: a wall where there's an open zone on
// one side only, else the riser where the floors differ and the lintel where the ceilings do.
// Each face is seen from one side: a wall from its open zone, a riser from the lower floor, a
// lintel from the higher ceiling.

import type { PortalMap } from './map';
import type { Region } from './regions';

export type Face = 'wall' | 'riser' | 'lintel';

// A face, the heights it spans, and the side of its edge (going a to b) it's seen from.
export interface PlacedFace {
    face: Face;
    bottom: number;
    top: number;
    seen: 'right' | 'left';
}

// The zone either side of each edge, -1 for none: on its right going a to b, then on its
// left. A construction line has none either side.
export function edgeZones(map: PortalMap, regions: readonly Region[]): [number, number][] {
    const sides = map.edges.map((): [number, number] => [-1, -1]);
    const edgeOf = new Map<number, number>();
    const key = (a: number, b: number) => Math.min(a, b) * 4294967296 + Math.max(a, b);
    map.edges.forEach((e, i) => edgeOf.set(key(e.a, e.b), i));
    regions.forEach((region, z) => {
        for (const cycle of [region.perimeter, ...region.holes]) {
            cycle.forEach((u, k) => {
                const v = cycle[(k + 1) % cycle.length]!;
                const e = edgeOf.get(key(u, v))!;
                sides[e]![map.edges[e]!.a === u ? 0 : 1] = z;
            });
        }
    });
    return sides;
}

// The faces an edge shows, with the zones on its right and left (-1 for none).
export function placeFaces(map: PortalMap, right: number, left: number): PlacedFace[] {
    const open = (z: number) => (z >= 0 && !map.zones[z]!.solid ? map.zones[z] : undefined);
    const p = open(right);
    const q = open(left);
    if (!p || !q) {
        const z = p ?? q;
        return z ? [{ face: 'wall', bottom: z.floor, top: z.ceiling, seen: p ? 'right' : 'left' }]
            : [];
    }
    const faces: PlacedFace[] = [];
    if (p.floor !== q.floor) {
        faces.push({
            face: 'riser', bottom: Math.min(p.floor, q.floor), top: Math.max(p.floor, q.floor),
            seen: p.floor < q.floor ? 'right' : 'left',
        });
    }
    if (p.ceiling !== q.ceiling) {
        faces.push({
            face: 'lintel', bottom: Math.min(p.ceiling, q.ceiling),
            top: Math.max(p.ceiling, q.ceiling), seen: p.ceiling > q.ceiling ? 'right' : 'left',
        });
    }
    return faces;
}

// The faces an edge between two zones (-1 for none) shows.
export function facesBetween(map: PortalMap, right: number, left: number): Face[] {
    return placeFaces(map, right, left).map((f) => f.face);
}
