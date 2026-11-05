import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { lighting, surfaceWants, type Surface } from '../src/doom/colour';
import { importLevel, SCALE } from '../src/doom/level';
import { levelNames, levelSize, readLevel, readWad } from '../src/doom/wad';
import { checkMap } from '../src/map/check';
import type { Want } from '../src/map/distinct';
import { zoneAt } from '../src/editor/hit';
import { exportMap } from '../src/map/export';
import { nearestShade, shadeFromName, shadeRgb } from '../src/map/shades';

// ---- a WAD made here: lumps written as Doom lays them out ----

function ascii(text: string, length = text.length): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => text.charCodeAt(i) || 0);
}

function lump(size: number, write: (view: DataView, bytes: Uint8Array) => void): Uint8Array {
    const bytes = new Uint8Array(size);
    write(new DataView(bytes.buffer), bytes);
    return bytes;
}

function records<T>(items: readonly T[], size: number,
    write: (view: DataView, bytes: Uint8Array, at: number, item: T) => void): Uint8Array {
    return lump(items.length * size, (view, bytes) =>
        items.forEach((item, i) => write(view, bytes, i * size, item)));
}

function makeWad(lumps: readonly [string, Uint8Array][]): Uint8Array {
    const size = lumps.reduce((sum, [, data]) => sum + data.length, 12);
    return lump(size + lumps.length * 16, (view, bytes) => {
        bytes.set(ascii('IWAD'));
        view.setInt32(4, lumps.length, true);
        view.setInt32(8, size, true);
        let at = 12;
        lumps.forEach(([name, data], i) => {
            bytes.set(data, at);
            const entry = size + i * 16;
            view.setInt32(entry, at, true);
            view.setInt32(entry + 4, data.length, true);
            bytes.set(ascii(name, 8), entry + 8);
            at += data.length;
        });
    });
}

// An 8x8 patch of one palette index.
function patch(index: number): Uint8Array {
    return lump(8 + 8 * 4 + 8 * 13, (view, bytes) => {
        view.setInt16(0, 8, true);
        view.setInt16(2, 8, true);
        for (let col = 0; col < 8; col++) {
            const at = 40 + col * 13;
            view.setInt32(8 + col * 4, at, true);
            bytes.set([0, 8, 0, ...Array<number>(8).fill(index), 0, 0xff], at);
        }
    });
}

// Wall textures, each one 8x8 patch of the same name with a P in front.
function textures(names: readonly string[]): Uint8Array {
    const header = 4 + names.length * 4;
    return lump(header + names.length * 32, (view, bytes) => {
        view.setInt32(0, names.length, true);
        names.forEach((name, i) => {
            const at = header + i * 32;
            view.setInt32(4 + i * 4, at, true);
            bytes.set(ascii(name, 8), at);
            view.setInt16(at + 12, 8, true);
            view.setInt16(at + 14, 8, true);
            view.setInt16(at + 20, 1, true);
            view.setInt16(at + 26, i, true);    // its patch, as PNAMES numbers them
        });
    });
}

type Side = [sector: number, upper?: string, lower?: string, middle?: string];
type Line = [v1: number, v2: number, front: number, back?: number];

// Room A (sector 0) with a pillar in it; room B (sector 1) east of it, a step up with a lower
// ceiling, and a second piece of B well away; a closed door (sector 2) north of A. Doom's x
// runs east and y north; vertex 16 is one the node builder added. A's west wall is in two
// lines either side of vertex 17, and B's east wall in two either side of 18, its texture
// changing there.
const VERTICES = [[0, 0], [256, 0], [256, 256], [0, 256], [512, 0], [512, 256], [0, 320],
    [256, 320], [64, 64], [64, 96], [96, 96], [96, 64], [1024, 0], [1280, 0], [1280, 256],
    [1024, 256], [128, 128], [0, 96], [512, 128]];
const SIDES: Side[] = [
    [0, '-', '-', 'GREY'],          // 0: A's walls
    [0, 'RED', 'GREEN'],            // 1: A, facing B
    [1, 'BLUE', 'BLUE'],            // 2: B, facing A
    [1, '-', '-', 'GREY'],          // 3: B's walls
    [0, 'GREY'],                    // 4: A, facing the door
    [2, '-', '-'],                  // 5: the door, facing A
    [2, '-', '-', 'GREY'],          // 6: the door's walls
    [1, '-', '-', 'RED'],           // 7: B's walls, in red
];
// each with its front side on its right going v1 to v2, seen with north up
const LINES: Line[] = [
    [1, 0, 0], [0, 17, 0], [3, 2, 4, 5], [2, 1, 1, 2],         // A
    [4, 1, 3], [5, 18, 3], [2, 5, 3],                           // B
    [3, 6, 6], [6, 7, 6], [7, 2, 6],                            // the door
    [8, 11, 0], [11, 10, 0], [10, 9, 0], [9, 8, 0],             // the pillar
    [13, 12, 3], [12, 15, 3], [15, 14, 3], [14, 13, 3],         // B's other piece
    [17, 3, 0],                                                 // A's west wall, continued
    [18, 4, 7],                                                 // B's east wall, continued
];
const SECTORS = [[0, 128], [32, 96], [0, 0]];
const PALETTE = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]];

const TEST_WAD = makeWad([
    ['PLAYPAL', lump(768, (_, bytes) => PALETTE.forEach((c, i) => bytes.set(c, i * 3)))],
    ['E1M1', new Uint8Array()],
    ['THINGS', records([[128, 32, 90, 1, 7]], 10, (view, _, at, t) =>
        t.forEach((n, k) => view.setInt16(at + k * 2, n, true)))],
    ['LINEDEFS', records(LINES, 14, (view, _, at, [v1, v2, front, back]) => {
        view.setUint16(at, v1, true);
        view.setUint16(at + 2, v2, true);
        view.setUint16(at + 10, front, true);
        view.setUint16(at + 12, back ?? 0xffff, true);
    })],
    ['SIDEDEFS', records(SIDES, 30, (view, bytes, at, [sector, upper, lower, middle]) => {
        bytes.set(ascii(upper ?? '-', 8), at + 4);
        bytes.set(ascii(lower ?? '-', 8), at + 12);
        bytes.set(ascii(middle ?? '-', 8), at + 20);
        view.setUint16(at + 28, sector, true);
    })],
    ['VERTEXES', records(VERTICES, 4, (view, _, at, [x, y]) => {
        view.setInt16(at, x!, true);
        view.setInt16(at + 2, y!, true);
    })],
    ['SECTORS', records(SECTORS, 26, (view, bytes, at, [floor, ceiling]) => {
        view.setInt16(at, floor!, true);
        view.setInt16(at + 2, ceiling!, true);
        bytes.set(ascii('FLOORG', 8), at + 4);
        bytes.set(ascii('FLOORR', 8), at + 12);
    })],
    ['TEXTURE1', textures(['RED', 'GREEN', 'BLUE', 'GREY'])],
    ['PNAMES', lump(4 + 4 * 8, (view, bytes) => {
        view.setInt32(0, 4, true);
        ['PRED', 'PGREEN', 'PBLUE', 'PGREY'].forEach((n, i) => bytes.set(ascii(n, 8), 4 + i * 8));
    })],
    ['PRED', patch(1)], ['PGREEN', patch(2)], ['PBLUE', patch(3)], ['PGREY', patch(4)],
    ['F_START', new Uint8Array()],
    ['FLOORG', new Uint8Array(4096).fill(2)],
    ['FLOORR', new Uint8Array(4096).fill(1)],
    ['F_END', new Uint8Array()],
]);

describe('readWad', () => {
    it('refuses what isn\'t a WAD', () => {
        expect(() => readWad(ascii('PK\x03\x04 not a wad'))).toThrow(/not a WAD/);
    });

    it('finds the levels and reads their lumps', () => {
        const wad = readWad(TEST_WAD);
        expect(levelNames(wad)).toEqual(['E1M1']);
        const level = readLevel(wad, 'E1M1');
        expect(level.vertices).toHaveLength(19);
        expect(level.linedefs[3]).toMatchObject({ v1: 2, v2: 1, front: 1, back: 2 });
        expect(level.linedefs[0]!.back).toBe(-1);
        expect(level.sidedefs[1]).toMatchObject({ upper: 'RED', lower: 'GREEN', sector: 0 });
        expect(level.things[0]).toMatchObject({ x: 128, y: 32, angle: 90, type: 1 });
    });

    it('gives a level\'s size from its lumps', () => {
        expect(levelSize(readWad(TEST_WAD), 'E1M1')).toEqual({ linedefs: 20, sectors: 3 });
    });
});

describe('nearestShade', () => {
    it('matches the hardware colours and their even mix', () => {
        const names = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.25, 0.25, 0.25]]
            .map((c) => nearestShade(c as [number, number, number]));
        expect(names).toEqual(['KKKK', 'RRRR', 'GGGG', 'BBBB', 'KBRG'].map(shadeFromName));
    });
});

describe('lighting', () => {
    it('lights floors fully, ceilings less, and walls by how they face the north-west', () => {
        const h = Math.SQRT1_2;
        expect(lighting([0, 0, 1])).toBe(1);
        expect(lighting(undefined)).toBe(1);
        expect(lighting([0, 0, -1])).toBeLessThan(1);
        expect(lighting([h, -h, 0])).toBeCloseTo(1);
        expect(lighting([-h, h, 0])).toBeCloseTo(0.5);
        expect(lighting([1, 0, 0])).toBeGreaterThan(lighting([0, 1, 0]));
    });
});

describe('surfaceWants', () => {
    const UP = [0, 0, 1] as const;
    const grey = (c: number): Surface => ({ colour: [c, c, c], normal: [...UP] });
    // a dim level of greys, and the one dim, strong green in it
    const level: Surface[] = [0.02, 0.04, 0.06, 0.08, 0.1, 0.12].map(grey);
    level.push({ colour: [0.01, 0.04, 0.006], normal: [...UP] });
    const wants = surfaceWants(level);
    const named = (names: string) => names.split(' ').map((n) => shadeFromName(n)!);

    it('makes the colour least like the rest glow, pure and in full light', () => {
        const acid = wants.at(-1)!;
        expect(acid.colour[0]).toBe(0);
        expect(acid.colour[1]).toBeCloseTo(1);
        expect(acid.rather).toEqual(named('KKKG KKRG KKGG KRGG KGGG GGGG'));
    });

    it('puts greys on the ramp from blue in the dark to red in the light, kept dark', () => {
        const ramp = wants.slice(0, 6);
        for (const w of ramp) {
            expect(w.colour[1]).toBe(0);
            expect(w.colour[0] + w.colour[2]).toBeLessThanOrEqual(0.75 + 1e-9);
            expect(w.rather).toContain(shadeFromName('KBBR'));
        }
        expect(ramp[0]!.colour[2]).toBeGreaterThan(ramp[0]!.colour[0]);    // bluer
        expect(ramp[5]!.colour[0]).toBeGreaterThan(ramp[5]!.colour[2]);    // redder
    });

    it('darkens what faces away from the light', () => {
        const wall = (x: number, y: number): Surface =>
            ({ colour: [0.06, 0.06, 0.06], normal: [x, y, 0] });
        const [lit, shaded] = surfaceWants([...level, wall(1, -1), wall(-1, 1)]).slice(-2);
        const light = (w: Want) => w.colour.reduce((sum, c) => sum + c);
        expect(light(lit!)).toBeGreaterThan(light(shaded!));
    });
});

describe('importLevel', () => {
    const { doc, notes } = importLevel(readWad(TEST_WAD), 'E1M1');
    const { map } = doc;
    // where a Doom point lands: north up the page and east to the right, scaled, the level's
    // south-west corner (0, 0) moved 256 in from the edge
    const at = (x: number, y: number) => ({ x: y * SCALE + 256, y: x * SCALE + 256 });
    const zoneOver = (x: number, y: number) => {
        const z = zoneAt(doc, at(x, y));
        return z === undefined ? undefined : map.zones[z];
    };
    const edgeBetween = (p: [number, number], q: [number, number]) => {
        const vertex = (x: number, y: number) =>
            map.vertices.findIndex((v) => v.x === at(x, y).x && v.y === at(x, y).y);
        const a = vertex(...p);
        const b = vertex(...q);
        return map.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    };

    it('makes a good map, of the vertices the lines use', () => {
        expect(checkMap(map).errors).toEqual([]);
        expect(map.vertices).toHaveLength(17);
        expect(map.vertices).not.toContainEqual(at(128, 128));
        expect(notes).toContain('1 vertices no line uses left out (the node builder\'s splits)');
    });

    it('joins lines that run straight on in one colour, leaving out the vertex between', () => {
        expect(map.vertices).not.toContainEqual(at(0, 96));
        expect(edgeBetween([0, 0], [0, 256])).toBeDefined();
        expect(notes).toContain('1 vertices where lines of one colour run straight on left out, '
            + 'the lines joined');
    });

    it('keeps the vertex where a straight wall\'s texture changes', () => {
        expect(map.vertices).toContainEqual(at(512, 128));
        const grey = edgeBetween([512, 256], [512, 128])!;
        const red = edgeBetween([512, 128], [512, 0])!;
        expect(red.topShade).not.toBe(grey.topShade);
        const [r, g, b] = shadeRgb(red.topShade);
        expect(g).toBe(0);
        expect(r).toBeGreaterThan(b);
    });

    it('gives each region a zone: a sector in pieces several, a pillar a solid one', () => {
        expect(map.zones).toHaveLength(5);
        expect(zoneOver(80, 80)!.solid).toBe(true);
        expect(zoneOver(400, 128))
            .toMatchObject({ solid: false, floor: 32 * SCALE, ceiling: 96 * SCALE });
        expect(zoneOver(1100, 128)).toMatchObject({ solid: false, floor: 32 * SCALE });
        expect(zoneOver(128, 200)).toMatchObject({ solid: false, floor: 0, ceiling: 128 * SCALE });
        expect(notes).toContain('1 sectors in several pieces: a zone each');
    });

    it('opens a closed door to below its neighbours\' lowest ceiling', () => {
        expect(zoneOver(128, 288)).toMatchObject({ solid: false, floor: 0, ceiling: 124 * SCALE });
    });

    it('shades a lintel from the higher ceiling\'s side, a riser from the lower floor\'s', () => {
        const shared = edgeBetween([256, 256], [256, 0])!;
        const [tr, tg, tb] = shadeRgb(shared.topShade);
        expect(tg).toBe(0);                  // reddish, from the upper texture
        expect(tr).toBeGreaterThan(tb);
        const [br, bg, bb] = shadeRgb(shared.bottomShade);
        expect(bb).toBe(0);
        expect(bg).toBeGreaterThan(br);      // a green, from the lower texture
    });

    it('shades floors and ceilings in their flats\' families', () => {
        const zone = zoneOver(128, 200)!;
        const [fr, fg, fb] = shadeRgb(zone.floorShade);
        expect(fb).toBe(0);
        expect(fg).toBeGreaterThan(fr);    // a green
        const [cr, cg, cb] = shadeRgb(zone.ceilingShade);
        expect(cg).toBe(0);                  // reddish
        expect(cr).toBeGreaterThan(cb);
    });

    it('starts where player 1 does, facing the same way', () => {
        expect(map.start).toEqual({ ...at(128, 32), angle: 0 });    // north: up the page
    });
});

// E1M1 of the shareware WAD, when it's there: WADs aren't in the repository.
const SHAREWARE = new URL('../docs/doom1.wad', import.meta.url);
describe.skipIf(!existsSync(SHAREWARE))('importLevel on E1M1', () => {
    it('makes a good map, and refuses only the export\'s counts', () => {
        const wad = readWad(readFileSync(SHAREWARE));
        const { doc } = importLevel(wad, 'E1M1');
        const { map } = doc;
        expect(checkMap(map).errors).toEqual([]);
        expect(map.vertices).toHaveLength(377);
        expect(map.zones).toHaveLength(100);
        expect(map.zones.filter((z) => z.solid)).toHaveLength(13);
        const result = exportMap(doc);
        expect(!result.ok && result.errors.every((e) => e.includes('a byte knows at most')))
            .toBe(true);
    });
});
