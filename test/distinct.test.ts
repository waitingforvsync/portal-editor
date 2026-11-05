import { describe, expect, it } from 'vitest';

import { distinctShades, type Want, type Wanted } from '../src/map/distinct';
import { docFromMap, type Doc } from '../src/map/edit';
import { parseMap } from '../src/map/format';
import { shadeFromName } from '../src/map/shades';
import { mapText } from './helpers';

// Two rooms side by side, sharing the edge from vertex 2 to 3: A (vertices 0 to 3) and B.
function rooms(floorB: number): Doc {
    const parsed = parseMap(mapText(
        'v 0 0', 'v 100 0', 'v 100 100', 'v 0 100', 'v 100 200', 'v 0 200',
        'e 0 1 KKKK', 'e 1 2 KKKK', 'e 2 3 KKKK', 'e 3 0 KKKK', 'e 2 4 KKKK', 'e 4 5 KKKK',
        'e 5 3 KKKK',
        'z 0 160 KKKK KKKK 0 1 2 3', `z ${floorB} 160 KKKK KKKK 3 2 4 5`,
    ));
    if (!parsed.ok) {
        throw new Error(parsed.errors.join('\n'));
    }
    return docFromMap(parsed.map, parsed.zoneRegions);
}

// Everything wanting one red, from the reds.
function allRed(doc: Doc): Wanted {
    const red: Want = { colour: [0.5, 0, 0], rather: ['KKKR', 'KKRR', 'KRRR', 'RRRR']
        .map((n) => shadeFromName(n)!) };
    const zones = doc.map.zones.map(() => red);
    const edges = doc.map.edges.map(() => red);
    return { floors: zones, ceilings: zones, tops: edges, bottoms: edges };
}

const SHARED = 2;    // the edge from vertex 2 to 3
const WALLS_A = [0, 1, 3];

describe('distinctShades', () => {
    it('gives the largest surface the shade most like its colour', () => {
        const doc = rooms(0);
        const { edges } = distinctShades(doc.map, doc.regions, allRed(doc));
        expect(edges[0]!.topShade).toBe(shadeFromName('KKRR'));    // a wall, 100 by 160
    });

    it('keeps level floors and ceilings across an edge apart', () => {
        const doc = rooms(0);
        const { zones } = distinctShades(doc.map, doc.regions, allRed(doc));
        expect(zones[0]!.floorShade).not.toBe(zones[1]!.floorShade);
        expect(zones[0]!.ceilingShade).not.toBe(zones[1]!.ceilingShade);
    });

    it('keeps walls apart from their floor, their ceiling and the walls at their corners', () => {
        const doc = rooms(0);
        const { zones, edges } = distinctShades(doc.map, doc.regions, allRed(doc));
        for (const e of WALLS_A) {
            expect(edges[e]!.topShade).not.toBe(zones[0]!.floorShade);
            expect(edges[e]!.topShade).not.toBe(zones[0]!.ceilingShade);
        }
        expect(edges[0]!.topShade).not.toBe(edges[1]!.topShade);
        expect(edges[3]!.topShade).not.toBe(edges[0]!.topShade);
    });

    it('keeps a riser apart from the floors at its foot and its top', () => {
        const doc = rooms(32);
        const { zones, edges } = distinctShades(doc.map, doc.regions, allRed(doc));
        const riser = edges[SHARED]!.bottomShade;
        expect(riser).not.toBe(zones[0]!.floorShade);
        expect(riser).not.toBe(zones[1]!.floorShade);
        expect(edges[SHARED]!.topShade).toBe(riser);    // nothing on top: the riser's shade
    });

    it('chooses from the shades a surface would rather have while it can', () => {
        const doc = rooms(32);
        const reds = new Set(['KKKR', 'KKRR', 'KRRR', 'RRRR'].map((n) => shadeFromName(n)!));
        const { zones, edges } = distinctShades(doc.map, doc.regions, allRed(doc));
        for (const shade of [...zones.flatMap((z) => [z.floorShade, z.ceilingShade]),
            ...edges.map((e) => e.topShade)]) {
            expect(reds.has(shade)).toBe(true);
        }
    });
});
