import { describe, expect, it } from 'vitest';

import demoText from '../maps/demo.pmap?raw';
import { add, Camera, cross, distanceFor, dot, type Vec3 } from '../src/editor/camera';
import { buildScene, pick, SOLID_SHADE, type Surface } from '../src/editor/scene';
import { docFromMap, type Doc } from '../src/map/edit';
import { parseMap } from '../src/map/format';
import { ringArea2 } from '../src/map/geometry';

function demo(): Doc {
    const parsed = parseMap(demoText);
    if (!parsed.ok) {
        throw new Error(parsed.errors.join('\n'));
    }
    return docFromMap(parsed.map, parsed.zoneRegions);
}

// Where a point shows in a camera's view, in CSS pixels.
function onScreen(camera: Camera, p: Vec3): [number, number] {
    const m = camera.matrix(1, 100000);
    const clip = [0, 1, 2, 3].map((r) => m[r]! * p[0] + m[4 + r]! * p[1] + m[8 + r]! * p[2]
        + m[12 + r]!);
    const [x, y, , w] = clip as [number, number, number, number];
    return [(x / w + 1) / 2 * camera.width, (1 - y / w) / 2 * camera.height];
}

function camera(yaw: number, pitch: number): Camera {
    const c = new Camera();
    c.yaw = yaw;
    c.pitch = pitch;
    c.target = [1000, 2000, 50];
    c.distance = 800;
    c.width = 400;
    c.height = 300;
    return c;
}

describe('Camera', () => {
    it('looks at its target from its distance', () => {
        const c = camera(0.3, 0.7);
        const [x, y] = onScreen(c, c.target);
        expect(x).toBeCloseTo(200);
        expect(y).toBeCloseTo(150);
        expect(Math.hypot(...add(c.eye, c.target, -1))).toBeCloseTo(800);
    });

    it('looking straight down at yaw 0, shows the map as the plan does', () => {
        const c = camera(0, Math.PI / 2);
        const [cx, cy] = onScreen(c, c.target);
        const [ux, uy] = onScreen(c, add(c.target, [100, 0, 0]));    // up the page
        const [rx, ry] = onScreen(c, add(c.target, [0, 100, 0]));    // to the right
        expect(ux).toBeCloseTo(cx);
        expect(uy).toBeLessThan(cy);
        expect(rx).toBeGreaterThan(cx);
        expect(ry).toBeCloseTo(cy);
    });

    it('puts the target\'s surroundings at the plan\'s scale', () => {
        const c = camera(0.5, Math.PI / 2);
        c.distance = distanceFor(c.height, 0.25);
        const [cx] = onScreen(c, c.target);
        const [rx] = onScreen(c, add(c.target, c.right, 100));
        expect(rx - cx).toBeCloseTo(25);
    });

    it('casts rays through the view', () => {
        const c = camera(1.1, 0.4);
        const centre = c.ray(200, 150);
        expect(dot(centre.direction, c.forward)).toBeCloseTo(1);
        const p: Vec3 = [1200, 2100, 0];
        const [sx, sy] = onScreen(c, p);
        const ray = c.ray(sx, sy);
        const toward = add(p, ray.origin, -1);
        const along = dot(toward, ray.direction);
        expect(Math.hypot(...add(toward, ray.direction, -along))).toBeCloseTo(0, 3);
        const hit = Camera.onLevel(ray, 0)!;
        expect(hit[0]).toBeCloseTo(1200);
        expect(hit[1]).toBeCloseTo(2100);
    });
});

describe('buildScene', () => {
    const doc = demo();
    const scene = buildScene(doc);
    const of = (kind: Surface['kind']) => scene.surfaces.filter((s) => s.kind === kind);

    it('turns every triangle to face the way its surface does', () => {
        for (const s of scene.surfaces) {
            for (let k = 0; k < s.triangles.length; k += 3) {
                const [a, b, c] = s.triangles.slice(k, k + 3) as [Vec3, Vec3, Vec3];
                expect(dot(cross(add(b, a, -1), add(c, a, -1)), s.normal)).toBeGreaterThan(0);
            }
        }
    });

    it('gives each open zone a floor and a ceiling covering its region', () => {
        const open = doc.map.zones.filter((z) => !z.solid).length;
        expect(of('floor')).toHaveLength(open);
        expect(of('ceiling')).toHaveLength(open);
        for (const s of of('floor')) {
            const zone = doc.map.zones[s.owner]!;
            const region = doc.regions[s.owner]!;
            const ring = (cycle: number[]) => cycle.map((v) => doc.map.vertices[v]!);
            const area = [region.perimeter, ...region.holes]
                .reduce((sum, c) => sum + ringArea2(ring(c)), 0);
            let covered = 0;
            for (let k = 0; k < s.triangles.length; k += 3) {
                const [a, b, c] = s.triangles.slice(k, k + 3) as [Vec3, Vec3, Vec3];
                covered += cross(add(b, a, -1), add(c, a, -1))[2];
                expect([a[2], b[2], c[2]]).toEqual([zone.floor, zone.floor, zone.floor]);
            }
            expect(covered).toBe(area);
        }
    });

    it('closes the solid pillar at the heights of the room round it', () => {
        const pillar = doc.map.zones.findIndex((z) => z.solid);
        const [top] = of('top');
        const [bottom] = of('bottom');
        expect(top!.owner).toBe(pillar);
        expect(top!.shade).toBe(SOLID_SHADE);
        expect(top!.triangles.every((p) => p[2] === 160)).toBe(true);
        expect(bottom!.triangles.every((p) => p[2] === -32)).toBe(true);
        expect(top!.normal).toEqual([0, 0, 1]);
        expect(bottom!.normal).toEqual([0, 0, -1]);
    });

    it('makes the walls, risers and lintels the edges show', () => {
        expect(of('wall').length).toBeGreaterThan(0);
        expect(of('riser').length).toBeGreaterThan(0);
        expect(of('lintel').length).toBeGreaterThan(0);
        // the pit (zone 0) is 24 below the room round it: four risers, seen from in the pit
        const pit = doc.regions[0]!;
        const pitRisers = of('riser').filter((s) => {
            const e = doc.map.edges[s.owner]!;
            return pit.perimeter.includes(e.a) && pit.perimeter.includes(e.b);
        });
        expect(pitRisers).toHaveLength(4);
        for (const s of pitRisers) {
            expect(s.triangles.every((p) => p[2] === -24 || p[2] === 0)).toBe(true);
        }
    });
});

describe('pick', () => {
    const doc = demo();
    const scene = buildScene(doc);

    it('finds the floor below a ray from above, and not the ceiling it passes through', () => {
        // straight down into the pit, at (1536, 1536)
        const s = pick(scene, { origin: [1536, 1536, 1000], direction: [0, 0, -1] });
        expect(scene.surfaces[s!]).toMatchObject({ kind: 'floor', owner: 0 });
    });

    it('finds the ceiling above a ray from below', () => {
        const s = pick(scene, { origin: [1536, 1536, -1000], direction: [0, 0, 1] });
        expect(scene.surfaces[s!]).toMatchObject({ kind: 'ceiling', owner: 0 });
    });

    it('finds a wall seen from inside its room, and nothing past the map', () => {
        // from the pit's middle, level, toward +x: the pit's riser, seen from in the pit
        const s = pick(scene, { origin: [1536, 1536, -10], direction: [1, 0, 0] });
        expect(scene.surfaces[s!]!.kind).toBe('riser');
        expect(pick(scene, { origin: [0, 0, 5000], direction: [0, 0, 1] })).toBeUndefined();
    });
});
