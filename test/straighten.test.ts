import { describe, expect, it } from 'vitest';

import { straighten } from '../src/map/straighten';
import { pts } from './helpers';

interface Tagged {
    a: number;
    b: number;
    tag: string;
}

function tagged(...edges: [number, number, string][]): Tagged[] {
    return edges.map(([a, b, tag]) => ({ a, b, tag }));
}

describe('straighten', () => {
    it('leaves out a vertex in the middle of a straight side', () => {
        const vertices = pts([0, 0], [5, 0], [10, 0], [10, 10], [0, 10]);
        const result = straighten(vertices,
            tagged([0, 1, 'p'], [1, 2, 'q'], [2, 3, 'r'], [3, 4, 's'], [4, 0, 't']));
        expect(result.vertices).toEqual(pts([0, 0], [10, 0], [10, 10], [0, 10]));
        expect(result.edges).toEqual(tagged([0, 1, 'p'], [1, 2, 'r'], [2, 3, 's'], [3, 0, 't']));
    });

    it('keeps corners, and vertices where more than two edges meet', () => {
        // a square split down the middle: the split's ends are straight on along the square
        // but meet three edges
        const vertices = pts([0, 0], [5, 0], [10, 0], [10, 10], [5, 10], [0, 10]);
        const edges = tagged([0, 1, 'p'], [1, 2, 'q'], [2, 3, 'r'], [3, 4, 's'], [4, 5, 't'],
            [5, 0, 'u'], [1, 4, 'v']);
        expect(straighten(vertices, edges)).toEqual({ vertices, edges });
    });

    it('joins a run of several, keeping the longest piece\'s fields and way', () => {
        // the bottom side in three pieces, the longest running backwards
        const vertices = pts([0, 0], [2, 0], [8, 0], [10, 0], [10, 10], [0, 10]);
        const result = straighten(vertices, tagged([0, 1, 'p'], [2, 1, 'q'], [2, 3, 'r'],
            [3, 4, 's'], [4, 5, 't'], [5, 0, 'u']));
        expect(result.vertices).toEqual(pts([0, 0], [10, 0], [10, 10], [0, 10]));
        expect(result.edges).toEqual(tagged([1, 0, 'q'], [1, 2, 's'], [2, 3, 't'], [3, 0, 'u']));
    });

    it('joins straight runs across a vertex where only one edge carries on', () => {
        // a path with a straight middle, its ends meeting one edge each
        const vertices = pts([0, 0], [0, 4], [0, 8], [3, 8]);
        const result = straighten(vertices, tagged([0, 1, 'p'], [1, 2, 'q'], [2, 3, 'r']));
        expect(result.vertices).toEqual(pts([0, 0], [0, 8], [3, 8]));
        expect(result.edges).toEqual(tagged([0, 1, 'p'], [1, 2, 'r']));
    });
});
