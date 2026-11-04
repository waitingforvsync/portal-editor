// faces.ts - what an edge's shade colours in the engine: a wall where there's an open zone on
// one side only, else the riser where the floors differ and the lintel where the ceilings do.

import type { PortalMap } from './map';
import type { Region } from './regions';

export type Face = 'wall' | 'riser' | 'lintel';

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

// The faces an edge between two zones (-1 for none) shows.
export function facesBetween(map: PortalMap, right: number, left: number): Face[] {
    const open = (z: number) => (z >= 0 && !map.zones[z]!.solid ? map.zones[z] : undefined);
    const p = open(right);
    const q = open(left);
    if (!p && !q) {
        return [];
    }
    if (!p || !q) {
        return ['wall'];
    }
    const faces: Face[] = [];
    if (p.floor !== q.floor) {
        faces.push('riser');
    }
    if (p.ceiling !== q.ceiling) {
        faces.push('lintel');
    }
    return faces;
}
