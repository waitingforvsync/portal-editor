// scene.ts - the map in three dimensions, as the 3D view draws it and picks from it: surfaces,
// each flat and seen from one side, made of triangles and outlined along its edges. An edge
// makes walls and lintels in its top shade and risers in its bottom shade (faces.ts); an open
// zone makes a floor and a ceiling, each a fan of triangles across each of its convex cells
// (cells.ts); a solid zone, beside open ones, a top at their highest ceiling and a bottom at
// their lowest floor. The outside makes nothing.

import type { Doc } from '../map/edit';
import { edgeZones, placeFaces } from '../map/faces';
import { fan, zoneCells } from '../map/cells';
import { add, cross, dot, normalize, type Ray, type Vec3 } from './camera';

export type SurfaceKind = 'wall' | 'riser' | 'lintel' | 'floor' | 'ceiling' | 'top' | 'bottom';

export const SOLID_SHADE = -1;    // a solid zone's top and bottom, which have no shade

export interface Surface {
    kind: SurfaceKind;
    owner: number;        // its edge (a wall, riser or lintel), else its zone
    shade: number;
    normal: Vec3;         // the way it faces, unit length
    triangles: Vec3[];    // three corners each, anticlockwise about the normal
    outline: Vec3[];      // two ends each
}

export interface Scene {
    surfaces: Surface[];
    low: number;          // the open zones' lowest floor and highest ceiling
    high: number;
    spans: ([number, number] | undefined)[];    // the same, of the open zones at each vertex
}

const DEFAULT_SPAN: [number, number] = [0, 160];

function minus(a: Vec3, b: Vec3): Vec3 {
    return add(a, b, -1);
}

// A triangle's corners in the order that runs anticlockwise about the normal.
function facing(p: Vec3, q: Vec3, r: Vec3, normal: Vec3): Vec3[] {
    return dot(cross(minus(q, p), minus(r, p)), normal) > 0 ? [p, q, r] : [p, r, q];
}

// The sides of a closed polygon, as pairs of ends.
function loop(points: readonly Vec3[]): Vec3[] {
    return points.flatMap((p, k) => [p, points[(k + 1) % points.length]!]);
}

export function buildScene(doc: Doc): Scene {
    const { map, regions } = doc;
    const { vertices, edges, zones } = map;
    const surfaces: Surface[] = [];
    const sides = edgeZones(map, regions);
    const cells = zoneCells(doc);
    const at = (v: number, height: number): Vec3 => [vertices[v]!.x, vertices[v]!.y, height];

    // walls, risers and lintels
    edges.forEach((e, i) => {
        const [right, left] = sides[i]!;
        const a = vertices[e.a]!;
        const b = vertices[e.b]!;
        const across = normalize([a.y - b.y, b.x - a.x, 0]);    // the right, going a to b
        for (const f of placeFaces(map, right, left)) {
            const normal = f.seen === 'right' ? across : minus([0, 0, 0], across);
            const corners = [at(e.a, f.bottom), at(e.b, f.bottom), at(e.b, f.top), at(e.a, f.top)];
            const [c0, c1, c2, c3] = corners as [Vec3, Vec3, Vec3, Vec3];
            const shade = f.face === 'riser' ? e.bottomShade : e.topShade;
            surfaces.push({
                kind: f.face, owner: i, shade, normal,
                triangles: [...facing(c0, c1, c2, normal), ...facing(c0, c2, c3, normal)],
                outline: loop(corners),
            });
        }
    });

    // the open zones beside each zone, and at each vertex
    const beside = zones.map((): number[] => []);
    sides.forEach(([right, left]) => {
        if (right >= 0 && left >= 0) {
            beside[right]!.push(left);
            beside[left]!.push(right);
        }
    });
    const spans: ([number, number] | undefined)[] = vertices.map(() => undefined);
    const widen = (span: [number, number] | undefined, low: number,
        high: number): [number, number] =>
        (span ? [Math.min(span[0], low), Math.max(span[1], high)] : [low, high]);
    let all: [number, number] | undefined;

    // floors and ceilings, and solid zones' tops and bottoms
    zones.forEach((zone, z) => {
        const region = regions[z]!;
        const cycles = [region.perimeter, ...region.holes];
        let level: [number, number] | undefined;
        if (!zone.solid) {
            level = [zone.floor, zone.ceiling];
            all = widen(all, zone.floor, zone.ceiling);
            for (const v of cycles.flat()) {
                spans[v] = widen(spans[v], zone.floor, zone.ceiling);
            }
        } else {
            for (const other of beside[z]!) {
                const o = zones[other]!;
                if (!o.solid) {
                    level = widen(level, o.floor, o.ceiling);
                }
            }
        }
        if (!level) {
            return;
        }
        const triangles = cells[z]!.flatMap((cell) => fan(vertices, cell));
        const flat = (kind: SurfaceKind, height: number, up: boolean, shade: number) => {
            const normal: Vec3 = [0, 0, up ? 1 : -1];
            surfaces.push({
                kind, owner: z, shade, normal,
                triangles: triangles.flatMap(([a, b, c]) =>
                    facing(at(a, height), at(b, height), at(c, height), normal)),
                outline: cycles.flatMap((cycle) => loop(cycle.map((v) => at(v, height)))),
            });
        };
        if (zone.solid) {
            flat('top', level[1], true, SOLID_SHADE);
            flat('bottom', level[0], false, SOLID_SHADE);
        } else {
            flat('floor', zone.floor, true, zone.floorShade);
            flat('ceiling', zone.ceiling, false, zone.ceilingShade);
        }
    });

    const [low, high] = all ?? DEFAULT_SPAN;
    return { surfaces, low, high, spans };
}

// How far along the ray it meets the triangle, if it does.
function meet(ray: Ray, a: Vec3, b: Vec3, c: Vec3): number | undefined {
    const ab = minus(b, a);
    const ac = minus(c, a);
    const p = cross(ray.direction, ac);
    const det = dot(ab, p);
    if (det === 0) {
        return undefined;
    }
    const s = minus(ray.origin, a);
    const u = dot(s, p) / det;
    if (u < 0 || u > 1) {
        return undefined;
    }
    const q = cross(s, ab);
    const v = dot(ray.direction, q) / det;
    if (v < 0 || u + v > 1) {
        return undefined;
    }
    const t = dot(ac, q) / det;
    return t > 0 ? t : undefined;
}

// The surface the ray meets first among those facing it, if any.
export function pick(scene: Scene, ray: Ray): number | undefined {
    let best: number | undefined;
    let nearest = Infinity;
    scene.surfaces.forEach((surface, i) => {
        if (dot(surface.normal, ray.direction) >= 0) {
            return;
        }
        const t = surface.triangles;
        for (let k = 0; k + 2 < t.length; k += 3) {
            const d = meet(ray, t[k]!, t[k + 1]!, t[k + 2]!);
            if (d !== undefined && d < nearest) {
                nearest = d;
                best = i;
            }
        }
    });
    return best;
}
