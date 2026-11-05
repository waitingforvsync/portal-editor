// wad.ts - reading Doom's WAD files: the lump directory, a level's lumps (vertices, linedefs,
// sidedefs, sectors, things), the palette, and the average colour of each flat and wall
// texture, for matching to shades. All little-endian, as the Doom wiki's specs give them.

export interface Lump {
    name: string;
    data: DataView;
}

export interface Wad {
    lumps: Lump[];
}

export interface DoomVertex {
    x: number;
    y: number;
}

// A line between two vertices. The front side is on the right going v1 to v2, seen from
// above with north up; -1 for a side that's missing.
export interface Linedef {
    v1: number;
    v2: number;
    flags: number;
    special: number;
    tag: number;
    front: number;
    back: number;
}

export interface Sidedef {
    upper: string;
    lower: string;
    middle: string;
    sector: number;
}

export interface Sector {
    floor: number;
    ceiling: number;
    floorFlat: string;
    ceilingFlat: string;
    light: number;
    special: number;
    tag: number;
}

export interface Thing {
    x: number;
    y: number;
    angle: number;    // degrees anticlockwise from east
    type: number;
    flags: number;
}

export interface Level {
    name: string;
    vertices: DoomVertex[];
    linedefs: Linedef[];
    sidedefs: Sidedef[];
    sectors: Sector[];
    things: Thing[];
}

// A colour in linear light, each channel 0 to 1.
export type Linear = [number, number, number];

export const NO_TEXTURE = '-';
export const SKY_FLAT = 'F_SKY1';

function text(view: DataView, at: number, length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) {
        const c = view.getUint8(at + i);
        if (c === 0) {
            break;
        }
        out += String.fromCharCode(c);
    }
    return out.toUpperCase();
}

export function readWad(bytes: Uint8Array): Wad {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kind = bytes.byteLength >= 12 ? text(view, 0, 4) : '';
    if (kind !== 'IWAD' && kind !== 'PWAD') {
        throw new Error(`not a WAD file: it doesn't start 'IWAD' or 'PWAD'`);
    }
    const count = view.getInt32(4, true);
    const directory = view.getInt32(8, true);
    if (count < 0 || directory < 0 || directory + count * 16 > bytes.byteLength) {
        throw new Error(`the WAD's directory runs past its end`);
    }
    const lumps: Lump[] = [];
    for (let i = 0; i < count; i++) {
        const at = directory + i * 16;
        const start = view.getInt32(at, true);
        const size = view.getInt32(at + 4, true);
        if (start < 0 || size < 0 || start + size > bytes.byteLength) {
            throw new Error(`lump ${i} runs past the WAD's end`);
        }
        lumps.push({
            name: text(view, at + 8, 8),
            data: new DataView(bytes.buffer, bytes.byteOffset + start, size),
        });
    }
    return { lumps };
}

// The last lump of a name (as Doom takes it), between two markers if given.
function findLump(wad: Wad, name: string, range?: [number, number]): Lump | undefined {
    const [from, to] = range ?? [0, wad.lumps.length];
    for (let i = to - 1; i >= from; i--) {
        if (wad.lumps[i]!.name === name) {
            return wad.lumps[i];
        }
    }
    return undefined;
}

// The lumps between markers such as F_START and F_END (or FF_START, F1_START...).
function between(wad: Wad, prefix: string): [number, number] {
    const names = wad.lumps.map((l) => l.name);
    const [one, two] = [prefix, prefix + prefix];
    const start = Math.max(names.indexOf(`${one}_START`), names.indexOf(`${two}_START`));
    const end = Math.max(names.lastIndexOf(`${one}_END`), names.lastIndexOf(`${two}_END`));
    return start < 0 || end < start ? [0, 0] : [start + 1, end];
}

// The levels in the WAD, by marker name (E1M1 or MAP01), in order.
export function levelNames(wad: Wad): string[] {
    return wad.lumps
        .filter((l, i) => wad.lumps[i + 1]?.name === 'THINGS' && /^(E\dM\d|MAP\d\d)$/.test(l.name))
        .map((l) => l.name);
}

function records<T>(lump: Lump | undefined, size: number, read: (at: number) => T): T[] {
    if (!lump) {
        return [];
    }
    const count = Math.floor(lump.data.byteLength / size);
    return Array.from({ length: count }, (_, i) => read(i * size));
}

export function readLevel(wad: Wad, name: string): Level {
    const marker = wad.lumps.findIndex((l) => l.name === name);
    if (marker < 0) {
        throw new Error(`the WAD has no level ${name}`);
    }
    const lump = (part: string) => {
        for (let i = marker + 1; i < Math.min(marker + 12, wad.lumps.length); i++) {
            if (wad.lumps[i]!.name === part) {
                return wad.lumps[i]!;
            }
        }
        throw new Error(`level ${name} has no ${part} lump`);
    };
    const side = (n: number) => (n === 0xffff ? -1 : n);
    const vx = lump('VERTEXES').data;
    const vertices = records(lump('VERTEXES'), 4, (at) =>
        ({ x: vx.getInt16(at, true), y: vx.getInt16(at + 2, true) }));
    const ld = lump('LINEDEFS').data;
    const linedefs = records(lump('LINEDEFS'), 14, (at) => ({
        v1: ld.getUint16(at, true), v2: ld.getUint16(at + 2, true),
        flags: ld.getUint16(at + 4, true), special: ld.getUint16(at + 6, true),
        tag: ld.getUint16(at + 8, true),
        front: side(ld.getUint16(at + 10, true)), back: side(ld.getUint16(at + 12, true)),
    }));
    const sd = lump('SIDEDEFS').data;
    const sidedefs = records(lump('SIDEDEFS'), 30, (at) => ({
        upper: text(sd, at + 4, 8), lower: text(sd, at + 12, 8), middle: text(sd, at + 20, 8),
        sector: sd.getUint16(at + 28, true),
    }));
    const sc = lump('SECTORS').data;
    const sectors = records(lump('SECTORS'), 26, (at) => ({
        floor: sc.getInt16(at, true), ceiling: sc.getInt16(at + 2, true),
        floorFlat: text(sc, at + 4, 8), ceilingFlat: text(sc, at + 12, 8),
        light: sc.getInt16(at + 20, true), special: sc.getInt16(at + 22, true),
        tag: sc.getInt16(at + 24, true),
    }));
    const th = lump('THINGS').data;
    const things = records(lump('THINGS'), 10, (at) => ({
        x: th.getInt16(at, true), y: th.getInt16(at + 2, true), angle: th.getInt16(at + 4, true),
        type: th.getInt16(at + 6, true), flags: th.getInt16(at + 8, true),
    }));
    return { name, vertices, linedefs, sidedefs, sectors, things };
}

// ---- colours ----

function toLinear(c: number): number {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

// The first palette of PLAYPAL, in linear light.
export function readPalette(wad: Wad): Linear[] {
    const lump = findLump(wad, 'PLAYPAL');
    if (!lump || lump.data.byteLength < 768) {
        throw new Error(`the WAD has no palette (PLAYPAL)`);
    }
    return Array.from({ length: 256 }, (_, i): Linear => [
        toLinear(lump.data.getUint8(i * 3)),
        toLinear(lump.data.getUint8(i * 3 + 1)),
        toLinear(lump.data.getUint8(i * 3 + 2)),
    ]);
}

// The average of palette indices' colours, in linear light, or undefined for none.
function average(palette: readonly Linear[], indices: Iterable<number>): Linear | undefined {
    const sum: Linear = [0, 0, 0];
    let n = 0;
    for (const i of indices) {
        const c = palette[i]!;
        sum[0] += c[0];
        sum[1] += c[1];
        sum[2] += c[2];
        n++;
    }
    return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : undefined;
}

// A flat's average colour: 64x64 palette indices between F_START and F_END.
export function flatColour(wad: Wad, palette: readonly Linear[], name: string): Linear | undefined {
    const lump = findLump(wad, name, between(wad, 'F'));
    if (!lump || lump.data.byteLength < 4096) {
        return undefined;
    }
    return average(palette, new Uint8Array(lump.data.buffer, lump.data.byteOffset, 4096));
}

// A patch's pixels drawn into a texture's, clipped: columns of posts, each a run of indices.
function drawPatch(
    patch: DataView, pixels: Int16Array, width: number, height: number, ox: number, oy: number,
) {
    const w = patch.getInt16(0, true);
    for (let col = 0; col < w; col++) {
        const x = ox + col;
        if (x < 0 || x >= width) {
            continue;
        }
        let at = patch.getInt32(8 + col * 4, true);
        while (at < patch.byteLength && patch.getUint8(at) !== 0xff) {
            const top = patch.getUint8(at);
            const length = patch.getUint8(at + 1);
            for (let k = 0; k < length; k++) {
                const y = oy + top + k;
                if (y >= 0 && y < height) {
                    pixels[y * width + x] = patch.getUint8(at + 3 + k);
                }
            }
            at += length + 4;
        }
    }
}

// Every wall texture's average colour (its patches composed, holes left out), by name.
export function textureColours(wad: Wad, palette: readonly Linear[]): Map<string, Linear> {
    const out = new Map<string, Linear>();
    const pnames = findLump(wad, 'PNAMES');
    if (!pnames) {
        return out;
    }
    const patches = Array.from({ length: pnames.data.getInt32(0, true) },
        (_, i) => findLump(wad, text(pnames.data, 4 + i * 8, 8)));
    for (const name of ['TEXTURE1', 'TEXTURE2']) {
        const lump = findLump(wad, name);
        if (!lump) {
            continue;
        }
        const t = lump.data;
        for (let i = 0; i < t.getInt32(0, true); i++) {
            const at = t.getInt32(4 + i * 4, true);
            const width = t.getInt16(at + 12, true);
            const height = t.getInt16(at + 14, true);
            const pixels = new Int16Array(width * height).fill(-1);
            for (let p = 0; p < t.getInt16(at + 20, true); p++) {
                const pp = at + 22 + p * 10;
                const patch = patches[t.getInt16(pp + 4, true)];
                if (patch) {
                    drawPatch(patch.data, pixels, width, height, t.getInt16(pp, true),
                        t.getInt16(pp + 2, true));
                }
            }
            const colour = average(palette, [...pixels].filter((c) => c >= 0));
            if (colour) {
                out.set(text(t, at, 8), colour);
            }
        }
    }
    return out;
}
