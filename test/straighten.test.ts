import { describe, expect, it } from 'vitest';

import { straighten } from '../src/map/straighten';
import { pts } from './helpers';

// An edge in a colour, with a name to tell which piece of a run an edge kept the fields of.
interface Coloured {
    a: number;
    b: number;
    colour: string;
    name: string;
}

// Edges given as [a, b, colour name]: the colour is the name's first letter.
function coloured(...edges: [number, number, string][]): Coloured[] {
    return edges.map(([a, b, name]) => ({ a, b, colour: name[0]!, name }));
}

const sameColour = (e: Coloured, f: Coloured) => e.colour === f.colour;

describe('straighten', () => {
    it('leaves out a vertex in the middle of a straight side of one colour', () => {
        const vertices = pts([0, 0], [5, 0], [10, 0], [10, 10], [0, 10]);
        const result = straighten(vertices,
            coloured([0, 1, 'r1'], [1, 2, 'r2'], [2, 3, 'g'], [3, 4, 'b'], [4, 0, 'k']),
            sameColour);
        expect(result.vertices).toEqual(pts([0, 0], [10, 0], [10, 10], [0, 10]));
        expect(result.edges).toEqual(coloured([0, 1, 'r1'], [1, 2, 'g'], [2, 3, 'b'], [3, 0, 'k']));
    });

    it('keeps a vertex where the colour changes along a straight side', () => {
        const vertices = pts([0, 0], [5, 0], [10, 0], [10, 10], [0, 10]);
        const edges = coloured([0, 1, 'r'], [1, 2, 'g1'], [2, 3, 'g2'], [3, 4, 'b'], [4, 0, 'k']);
        expect(straighten(vertices, edges, sameColour)).toEqual({ vertices, edges });
    });

    it('keeps corners, and vertices where more than two edges meet', () => {
        // a square split down the middle: the split's ends are straight on along the square
        // but meet three edges
        const vertices = pts([0, 0], [5, 0], [10, 0], [10, 10], [5, 10], [0, 10]);
        const edges = coloured([0, 1, 'r1'], [1, 2, 'r2'], [2, 3, 'r3'], [3, 4, 'r4'],
            [4, 5, 'r5'], [5, 0, 'r6'], [1, 4, 'r7']);
        expect(straighten(vertices, edges, sameColour)).toEqual({ vertices, edges });
    });

    it('joins a run of several, keeping the longest piece\'s fields and way', () => {
        // the bottom side in three pieces, the longest running backwards
        const vertices = pts([0, 0], [2, 0], [8, 0], [10, 0], [10, 10], [0, 10]);
        const result = straighten(vertices, coloured([0, 1, 'r1'], [2, 1, 'r2'], [2, 3, 'r3'],
            [3, 4, 'g'], [4, 5, 'b'], [5, 0, 'k']), sameColour);
        expect(result.vertices).toEqual(pts([0, 0], [10, 0], [10, 10], [0, 10]));
        expect(result.edges).toEqual(coloured([1, 0, 'r2'], [1, 2, 'g'], [2, 3, 'b'], [3, 0, 'k']));
    });

    it('ends a run where the colour changes', () => {
        // a straight path in three pieces, the last another colour
        const vertices = pts([0, 0], [0, 4], [0, 8], [0, 12]);
        const result = straighten(vertices, coloured([0, 1, 'r1'], [1, 2, 'r2'], [2, 3, 'g']),
            sameColour);
        expect(result.vertices).toEqual(pts([0, 0], [0, 8], [0, 12]));
        expect(result.edges).toEqual(coloured([0, 1, 'r1'], [1, 2, 'g']));
    });
});
