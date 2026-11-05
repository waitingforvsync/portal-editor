// distinct.ts - shades that keep neighbouring surfaces apart. The engine draws a line only
// where the shade changes, so surfaces that meet in one shade run together. Given the colour
// each surface wants, and the shades it would rather have, the surfaces take shades largest
// first: each the one most like its colour, among those it would rather have, that no
// neighbour already has. Surfaces are neighbours when they meet: a zone's floor and ceiling
// and the faces round it; a lintel and the ceilings at its top and bottom, a riser and the
// floors at its; the floors (or ceilings) of zones level across an edge; and faces seen from
// one zone that meet at a corner of its outline, their heights overlapping.

import { edgeZones, placeFaces, type PlacedFace } from './faces';
import { ringArea2 } from './geometry';
import type { Edge, PortalMap, Zone } from './map';
import type { Region } from './regions';
import { shadesByLikeness } from './shades';

export interface Want {
    colour: readonly [number, number, number];    // in linear light
    rather: readonly number[];                    // the shades to choose from first
}

export interface Wanted {
    floors: readonly Want[];       // each zone's
    ceilings: readonly Want[];
    tops: readonly Want[];         // each edge's wall or lintel
    bottoms: readonly Want[];      // each edge's riser
}

// The map with its shades chosen. A solid zone's shades, which show nowhere, are just the
// most like its colours; so is a face an edge doesn't show. An edge with no wall or lintel
// takes its riser's shade on top too, and one with no riser its top's below.
export function distinctShades(
    map: PortalMap, regions: readonly Region[], wanted: Wanted,
): PortalMap {
    const { vertices, edges, zones } = map;
    const zoneCount = zones.length;
    const floor = (z: number) => 4 * z;
    const ceiling = (z: number) => 4 * z + 1;
    const top = (e: number) => 4 * zoneCount + 2 * e;
    const bottom = (e: number) => 4 * zoneCount + 2 * e + 1;
    const nodeCount = 4 * zoneCount + 2 * edges.length;
    const want: (Want | undefined)[] = Array(nodeCount);
    zones.forEach((_, z) => {
        want[floor(z)] = wanted.floors[z];
        want[ceiling(z)] = wanted.ceilings[z];
    });
    edges.forEach((_, e) => {
        want[top(e)] = wanted.tops[e];
        want[bottom(e)] = wanted.bottoms[e];
    });
    const size = new Array<number>(nodeCount).fill(0);
    const neighbours = Array.from({ length: nodeCount }, () => new Set<number>());
    const link = (p: number, q: number) => {
        if (p !== q) {
            neighbours[p]!.add(q);
            neighbours[q]!.add(p);
        }
    };
    const open = (z: number) => z >= 0 && !zones[z]!.solid;

    // each open zone's floor and ceiling, as big as its region
    regions.forEach((region, z) => {
        if (open(z)) {
            const ring = (cycle: readonly number[]) => cycle.map((v) => vertices[v]!);
            const area = region.holes.reduce((sum, hole) => sum + ringArea2(ring(hole)),
                ringArea2(ring(region.perimeter))) / 2;
            size[floor(z)] = size[ceiling(z)] = Math.abs(area);
        }
    });

    // each edge's faces, the floors and ceilings they meet, and level floors and ceilings
    const sides = edgeZones(map, regions);
    const seenFrom = edges.map((): { zone: number; face: PlacedFace; node: number }[] => []);
    edges.forEach((e, i) => {
        const [right, left] = sides[i]!;
        const length = Math.hypot(vertices[e.b]!.x - vertices[e.a]!.x,
            vertices[e.b]!.y - vertices[e.a]!.y);
        for (const face of placeFaces(map, right, left)) {
            const [zone, other] = face.seen === 'right' ? [right, left] : [left, right];
            const node = face.face === 'riser' ? bottom(i) : top(i);
            size[node]! += length * (face.top - face.bottom);
            seenFrom[i]!.push({ zone, face, node });
            if (face.face === 'wall') {
                link(node, floor(zone));
                link(node, ceiling(zone));
            } else if (face.face === 'lintel') {
                link(node, ceiling(zone));
                link(node, ceiling(other));
            } else {
                link(node, floor(zone));
                link(node, floor(other));
            }
        }
        if (open(right) && open(left)) {
            if (zones[right]!.floor === zones[left]!.floor) {
                link(floor(right), floor(left));
            }
            if (zones[right]!.ceiling === zones[left]!.ceiling) {
                link(ceiling(right), ceiling(left));
            }
        }
    });

    // faces meeting at a corner of a zone's outline, seen from it
    const edgeAt = new Map(edges.map((e, i) => [Math.min(e.a, e.b) * 4294967296
        + Math.max(e.a, e.b), i]));
    const edgeOf = (u: number, v: number) => edgeAt.get(Math.min(u, v) * 4294967296
        + Math.max(u, v))!;
    regions.forEach((region, z) => {
        if (!open(z)) {
            return;
        }
        for (const cycle of [region.perimeter, ...region.holes]) {
            cycle.forEach((v, k) => {
                const before = edgeOf(cycle[(k + cycle.length - 1) % cycle.length]!, v);
                const after = edgeOf(v, cycle[(k + 1) % cycle.length]!);
                for (const p of seenFrom[before]!.filter((s) => s.zone === z)) {
                    for (const q of seenFrom[after]!.filter((s) => s.zone === z)) {
                        if (p.face.bottom < q.face.top && q.face.bottom < p.face.top) {
                            link(p.node, q.node);
                        }
                    }
                }
            });
        }
    });

    // largest first, each the most like its colour that no neighbour has
    const ranked = (w: Want) => {
        const likeness = shadesByLikeness(w.colour);
        const rather = new Set(w.rather);
        return [...likeness.filter((s) => rather.has(s)),
            ...likeness.filter((s) => !rather.has(s))];
    };
    const shade = new Array<number>(nodeCount).fill(-1);
    const order = [...size.keys()].filter((n) => size[n]! > 0);
    order.sort((p, q) => size[q]! - size[p]! || p - q);
    for (const n of order) {
        const taken = new Set([...neighbours[n]!].map((m) => shade[m]!));
        shade[n] = ranked(want[n]!).find((s) => !taken.has(s)) ?? ranked(want[n]!)[0]!;
    }
    const chosen = (n: number) => (shade[n]! >= 0 ? shade[n]! : ranked(want[n]!)[0]!);

    const newZones: Zone[] = zones.map((z, i) => ({
        ...z, floorShade: chosen(floor(i)), ceilingShade: chosen(ceiling(i)),
    }));
    const newEdges: Edge[] = edges.map((e, i) => {
        const topShown = shade[top(i)]! >= 0;
        const bottomShown = shade[bottom(i)]! >= 0;
        const topShade = topShown || !bottomShown ? chosen(top(i)) : chosen(bottom(i));
        return { ...e, topShade, bottomShade: bottomShown ? chosen(bottom(i)) : topShade };
    });
    return { ...map, zones: newZones, edges: newEdges };
}
