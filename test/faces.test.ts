import { describe, expect, it } from 'vitest';

import { docFromMap, type Doc } from '../src/map/edit';
import { edgeZones, facesBetween, placeFaces } from '../src/map/faces';
import { parseMap } from '../src/map/format';
import { mapText } from './helpers';

// Three rooms in a row along y, 0 to 300, and a pillar in the first:
//   zone 0: y 0..100, floor 0, ceiling 160
//   zone 1: y 100..200, floor 16, ceiling 160 (a step up)
//   zone 2: y 200..300, floor 16, ceiling 128 (a lower ceiling)
//   zone 3: the pillar, solid
function rooms(): Doc {
    const parsed = parseMap(mapText(
        'v 0 0', 'v 100 0', 'v 100 100', 'v 0 100',
        'v 100 200', 'v 0 200', 'v 100 300', 'v 0 300',
        'v 40 40', 'v 60 40', 'v 60 60', 'v 40 60',
        'e 0 1 KKKK', 'e 1 2 KKKK', 'e 2 3 KKKK', 'e 3 0 KKKK',
        'e 2 4 KKKK', 'e 4 5 KKKK', 'e 5 3 KKKK',
        'e 4 6 KKKK', 'e 6 7 KKKK', 'e 7 5 KKKK',
        'e 8 9 KKKK', 'e 9 10 KKKK', 'e 10 11 KKKK', 'e 11 8 KKKK',
        'z 0 160 KRRR KKKB 0 1 2 3',
        'z 16 160 KRRR KKKB 3 2 4 5',
        'z 16 128 KRRR KKKB 5 4 6 7',
        'z solid 0 160 KRRR KKKB 8 9 10 11',
    ));
    if (!parsed.ok) {
        throw new Error(parsed.errors.join('\n'));
    }
    return docFromMap(parsed.map, parsed.zoneRegions);
}

describe('edgeZones', () => {
    it('finds the zone either side of each edge, -1 for outside', () => {
        const doc = rooms();
        const sides = edgeZones(doc.map, doc.regions);
        // right of an edge going up the page is +y; going down it, -y
        expect(sides[0]).toEqual([0, -1]);    // 0 -> 1, up at y 0
        expect(sides[2]).toEqual([0, 1]);     // 2 -> 3, down at y 100
        expect(sides[5]).toEqual([1, 2]);     // 4 -> 5, down at y 200
        expect(sides[10]).toEqual([3, 0]);    // 10 -> 11, down at y 60: the pillar, a hole in 0
    });
});

describe('facesBetween', () => {
    const doc = rooms();
    const { map } = doc;

    it('makes a wall between an open zone and the outside, or a solid zone', () => {
        expect(facesBetween(map, 0, -1)).toEqual(['wall']);
        expect(facesBetween(map, -1, 2)).toEqual(['wall']);
        expect(facesBetween(map, 0, 3)).toEqual(['wall']);
    });

    it('makes a riser where floors differ and a lintel where ceilings do', () => {
        expect(facesBetween(map, 1, 0)).toEqual(['riser']);
        expect(facesBetween(map, 2, 1)).toEqual(['lintel']);
        expect(facesBetween(map, 0, 2)).toEqual(['riser', 'lintel']);
    });

    it('makes nothing between zones of the same heights, or with no open zone', () => {
        expect(facesBetween(map, 0, 0)).toEqual([]);
        expect(facesBetween(map, 3, -1)).toEqual([]);
        expect(facesBetween(map, -1, -1)).toEqual([]);
    });
});

describe('placeFaces', () => {
    const { map } = rooms();

    it('spans a wall from its zone\'s floor to its ceiling, seen from that zone', () => {
        expect(placeFaces(map, -1, 2)).toEqual([
            { face: 'wall', bottom: 16, top: 128, seen: 'left' },
        ]);
    });

    it('sees a riser from the lower floor and a lintel from the higher ceiling', () => {
        expect(placeFaces(map, 0, 2)).toEqual([
            { face: 'riser', bottom: 0, top: 16, seen: 'right' },
            { face: 'lintel', bottom: 128, top: 160, seen: 'right' },
        ]);
        expect(placeFaces(map, 2, 0)).toEqual([
            { face: 'riser', bottom: 0, top: 16, seen: 'left' },
            { face: 'lintel', bottom: 128, top: 160, seen: 'left' },
        ]);
    });
});
