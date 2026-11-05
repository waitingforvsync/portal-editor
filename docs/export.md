# The engine export

Export (Ctrl+E) writes the map as portalc's engine holds it (`map.h`): convex cells with
clockwise rings of sides, each side along an edge. It's saved as the map's name with `.bin`.
The bytes are a header, then a table for each field, end to end, with no padding. The engine
works out where each table starts from the counts in the header.

## Header

| Offset | Bytes | Field |
|--------|-------|-------|
| 0 | 1 | V, the number of vertices |
| 1 | 1 | C, the number of cells, counting cell 0 (the outside) |
| 2 | 1 | E, the number of edges |
| 3 | 1 | S, the number of sides |
| 4 | 2 | The start's x, low byte first |
| 6 | 2 | The start's y, low byte first |
| 8 | 1 | The start's angle, in 256ths of a turn |
| 9 | 1 | The cell holding the start |

A count of 256 is written as 0. No count can be 0 otherwise.

## Tables

They follow the header in this order. A 16-bit value is split into a table of low bytes and a
table of high bytes.

| Table | Entries | Each entry |
|-------|---------|------------|
| `vert_xlo`, `vert_xhi` | V | A vertex's x |
| `vert_ylo`, `vert_yhi` | V | A vertex's y |
| `cell_first` | C + 1 | A cell's first side. The last entry is S (0 if S is 256): the rings run on end to end, so a cell's ring ends where the next one's begins |
| `cell_floorz` | C | The floor's z, in 8-unit steps, increasing downwards |
| `cell_ceilz` | C | The ceiling's z, likewise: always less than the floor's |
| `cell_floor` | C | The floor's shade |
| `cell_ceil` | C | The ceiling's shade |
| `edge_angle` | E | The edge's direction within its quadrant, in 1024ths of a turn, rounded down. It serves the edge either way round |
| `edge_colour` | E | The edge's shade + 1, or 0 for a soft edge |
| `edge_len8` | E | The edge's length in 8-unit steps, rounded down |
| `side_v` | S | The side's start vertex. It ends at the next side's start |
| `side_edge` | S | The edge it runs along |
| `side_adj` | S | The cell across it, or 0 for a wall |
| `side_anghi` | S | The quadrant of its direction (`pt_quadrant`): over its edge's angle, its world angle |
| `side_entry` | S | For a portal, the side after its twin in the cell across, where a walk through it begins. For a wall, 0 |

The file is 10 + 4V + (C + 1) + 4C + 3E + 5S bytes. Cell 0's entries are all 0.

## From the map

- **Cells.** Each open zone's convex cells, zone by zone, in the zones' order, numbered on
  from cell 1. Solid zones and the outside have none.
- **Sides.** Each cell's ring, clockwise in plan, through every vertex along it. A vertex where
  the ring runs straight on is kept.
- **Edges.** One for each map edge a ring runs along, coloured by its shade, and one for each
  soft edge between two cells of a zone, coloured 0. A portal's edge is made when its first
  side, in side order, names it.
- **Vertices.** Only those the cells use, in the map's order.
- **Heights.** z = (top - height) / 8, where top is the highest ceiling or eye (a floor plus
  80, the engine's eye height). So every z is 0 or more, and every floor's z is at least 10.
- **Derived bytes.** An edge's angle, length and colour, and a side's quadrant, are made as
  portalc's map builder (`map.c`'s `end_map`) makes them. A portal's entry is made as its
  `mapasm` tool makes it. The start cell is the first cell the start lies on the inside of
  every side of, as `pt_map_find_cell` finds it.

## What export refuses

Each problem is listed:

- More than 256 vertices, cells (counting the outside), edges or sides.
- An edge, soft or not, 2048 units long or more: its length in 8-unit steps is a byte.
- Heights spanning more than 255 steps, from the lowest floor to the highest ceiling or eye.
- A start that isn't inside an open zone.
- A map with no open zones.

Shades, sprites and art aren't exported.
