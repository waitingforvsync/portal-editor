# The map text format

A map is stored as text: the editor's source format. It holds only what can't be worked
out: vertices, edges and their shades, zones and their heights and shades, and where the
player starts. The regions the edges enclose, and their holes, are worked out from the
edges.

`maps/demo.pmap` is portalc's demo scene (`pt_scene_init` in `map.c`) in this format.

## Example

A 10-unit square room:

```
portalmap 1

start 5 5 0

# v x y
v 0 0
v 10 0
v 10 10
v 0 10

# e v0 v1 top-shade [bottom-shade]
e 0 1 KKBB
e 1 2 BBBR
e 2 3 RRGG
e 3 0 KKKK

# z [solid] floor ceiling floor-shade ceiling-shade perimeter
z 0 160 KRRR KKKB 0 1 2 3
```

## Layout

- One record per line: a keyword, then fields separated by spaces or tabs.
- `#` starts a comment, to the end of the line. Blank lines are ignored.
- The first record is `portalmap 1`, the format's version.
- After that, records may come in any order. Vertices are numbered from 0 in the order
  their `v` records appear; edges and zones likewise.
- Line ends may be LF or CRLF.

## Records

| Record | Fields | Meaning |
|--------|--------|---------|
| `portalmap` | version | The format version: `1`. First, and once. |
| `start` | x y angle | Where the player starts. Exactly once. |
| `v` | x y | A vertex. |
| `e` | v0 v1 top-shade [bottom-shade] | An edge between two vertices, in its shades; see below. |
| `z` | [`solid`] floor ceiling floor-shade ceiling-shade perimeter... | A zone; see below. |

## Units and conventions

| Value | Form |
|-------|------|
| x, y | Whole units, 0 to 65535. x runs up the page and y to the right, as in portalc's `map.h`. |
| angle | 256ths of a turn, 0 to 255, as the engine's camera holds it. |
| floor, ceiling | Whole units, up-positive, multiples of 8. Negative heights are allowed. The floor must be below the ceiling. |
| shade | A shade's name: its four pixels' colours, darkest first, from `K` (black), `B` (blue), `R` (red) and `G` (green). See below. |
| perimeter | Vertex numbers, at least 3, clockwise in plan, starting from any of them. |

Only differences between heights matter to the engine, so the zero point is free. The demo
map puts its main floor at 0.

### Shades

The 35 shades of portalc's catalogue (`palette.c`), darkest first:

| | | | | | | |
|---|---|---|---|---|---|---|
| `KKKK` | `KKKB` | `KKBB` | `KKKR` | `KBBB` | `KKBR` | `BBBB` |
| `KBBR` | `KKKG` | `KKRR` | `BBBR` | `KKBG` | `KBRR` | `KBBG` |
| `BBRR` | `KKRG` | `KRRR` | `BBBG` | `KBRG` | `BRRR` | `BBRG` |
| `KKGG` | `KRRG` | `RRRR` | `KBGG` | `BRRG` | `BBGG` | `KRGG` |
| `RRRG` | `BRGG` | `KGGG` | `RRGG` | `BGGG` | `RGGG` | `GGGG` |

## Edges

An edge has a top shade and a bottom shade. Between a zone and the outside, or a solid zone,
it is a wall, in its top shade. Between two open zones it shades whichever faces show: the
riser where one floor is higher, in its bottom shade, and the lintel where one ceiling is
lower, in its top shade. A record with one shade gives the edge it as both.

The engine has one shade an edge, so export takes the top shade (`docs/export.md`).

An edge with the same region on both sides (one left dangling, or one joining a hole's
outline to its surroundings) is a construction line. It is kept, but takes no part in
regions, and loading warns of it.

## Zones and regions

The edges enclose regions. A region is known by its perimeter, its outer outline, which is
the vertex cycle a zone's record gives. Holes are not stored: a region's holes are the
outlines of whatever it surrounds, and each of those is a region with a zone of its own,
solid or open.

Every region needs exactly one zone, and every zone must match a region.

A zone is open, a space with a floor and a ceiling, or `solid`: a region with nothing in it,
such as a pillar, walled all round. A solid zone still has heights and shades, unused, so
that making it open again restores them.

## What loading rejects

Each problem is reported with its line; loading reports them all, not just the first.

- A first record other than `portalmap 1`, or no `start`, or more than one.
- A record with the wrong fields, a number that isn't whole or is out of range, or a shade
  name that doesn't exist.
- Two vertices at the same point.
- An edge naming a vertex that doesn't exist, joining a vertex to itself, or repeating
  another edge (either way round).
- Two edges that cross, or a vertex lying on an edge it doesn't end. Edges meet only at
  their ends.
- A zone with fewer than 3 perimeter vertices, a step of its perimeter with no edge, or a
  floor that isn't below its ceiling.
- A zone whose perimeter isn't a region's (or is one, anticlockwise), two zones with the
  same perimeter, or a region with no zone.

## Writing

The editor writes one form: the version, a blank line, the start, then the `v`, `e` and
`z` records in that order, each group under its comment header as in the example. An edge's
bottom shade is written only where it differs from its top shade. Each perimeter starts from
its lowest-numbered vertex. Comments in a file the editor loads are
not kept.
