// map.ts - the map as the editor holds it and the text format stores it: vertices, edges
// and zones. Regions, holes and cells are worked out from these.

import type { Coord, Height } from './units';

export interface Vertex {
    x: Coord;
    y: Coord;
}

// An edge between two vertices (indices), in one shade: a wall, or the riser or lintel
// faces between two zones.
export interface Edge {
    a: number;
    b: number;
    shade: number;
}

// A zone is known by its perimeter: its outline's vertices, clockwise from any of them.
// Holes aren't stored. A solid zone has nothing in it, such as a pillar; it keeps its heights
// and shades, unused, for when it's made open again.
export interface Zone {
    solid: boolean;
    floor: Height;
    ceiling: Height;
    floorShade: number;
    ceilingShade: number;
    perimeter: number[];
}

// Where the player starts, facing angle (in 256ths of a turn).
export interface Start {
    x: Coord;
    y: Coord;
    angle: number;
}

export interface PortalMap {
    start: Start;
    vertices: Vertex[];
    edges: Edge[];
    zones: Zone[];
}
