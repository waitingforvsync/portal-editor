# portal-editor

A browser map editor for [portalc](https://github.com/waitingforvsync/portalc), the BBC
Micro portal engine. Maps are made of vertices and edges; the regions the edges enclose are
zones, with floor and ceiling heights and shades.

So far: the map text format (reading, checking and writing); a plan view for placing
vertices, drawing edges, and selecting, moving, deleting, cutting, copying and pasting them,
and for putting the player's start, with the zones and their convex cells worked out as you
go; a 3D view of the map as the engine draws it; a properties panel for the selected zones,
edges and vertices; an export of the map as the engine loads it; and an import of Doom
levels. It opens on the demo map.

It runs at <https://waitingforvsync.github.io/portal-editor/>.

## Running

Needs Node 22.12 or later.

```
npm install
npm run dev      # serve the editor at http://localhost:5173
npm test         # run the tests
npm run check    # type-check
npm run build    # type-check, then build into dist/
```

### In VS Code

`.vscode/` holds the project's tasks, launch configuration and settings.

| Action | How |
|--------|-----|
| Run the editor, with breakpoints in the TS | F5 ("Editor in Chrome": starts the dev server, opens Chrome) |
| Type-check, errors to the Problems panel | Ctrl+Shift+B |
| Run the tests | Testing panel (with the recommended Vitest extension), or the `test` task |
| Install, build, serve | Terminal > Run Task: `install`, `build`, `dev` |

The dev server always uses port 5173, and stops rather than move if it's taken.

### Publishing

Each push to `main` runs `.github/workflows/pages.yml`, which tests and builds the editor and
publishes `dist/` with GitHub Pages at <https://waitingforvsync.github.io/portal-editor/>. It
can also be run by hand from the repository's Actions tab. The build refers to its assets by
relative paths (`base` in `vite.config.ts`), so it works under the repository's path.

## Using the editor

The plan view, on the left, shows the map from above, x up the screen and y to the right,
zones in their floor shades and solid zones hatched. It has three modes: selection (S),
geometry (G) and player (P). The 3D view is beside it, and the divider between them moves.

### Selection mode (S)

The editor starts in selection mode.

| Action | Does |
|--------|------|
| Click a vertex, edge or zone | Selects it, in place of the selection |
| Click in space | Clears the selection |
| Drag something | Moves the selection, selecting what's dragged first if it isn't |
| Drag from space | Selects what lies inside the box |

Holding Ctrl (or Cmd) adds to the selection rather than replacing it; Ctrl+click in space
still clears it.

The selection is a set of vertices. An edge is selected when both its ends are, and a zone
when every vertex of its outline is (the vertices of its holes don't count), so selecting a
zone doesn't select what's inside it.

### Geometry mode (G)

| Action | Does |
|--------|------|
| Click in space | Adds a vertex, selected |
| Click on an edge | Splits the edge with a new vertex, selected |
| Click on a vertex | Selects it |
| Drag | Draws an edge from where the drag starts to where it ends |

A drawn edge starts and ends on a vertex, or on an edge (splitting it), or at a new vertex.
Where it crosses edges, they all split there. Closing an outline makes a zone. The line and
the vertices along it end up selected.

Holding Shift switches between selection and geometry: in selection mode, Shift+click adds a
vertex and Shift+drag draws an edge; in geometry mode, Shift selects as selection mode does.

### Player mode (P)

| Action | Does |
|--------|------|
| Click | Puts the start there, on the grid, facing as it did |
| Drag | Puts the start where the drag begins, facing along it: in steps of 8 256ths of a turn with the grid on |
| Arrows | Nudge the start a grid step |

Player mode has no selection: the selection is kept, unseen, for the other modes, and a click
in the 3D view selects nothing. The plan shows where a click would put the start, and the
panel shows the start's x, y and angle.

### Everywhere

| Key or action | Does |
|---------------|------|
| Delete | Deletes the selected edges, leaving their ends selected; with no edges selected, deletes the selected vertices and their edges |
| Ctrl+X, Ctrl+C, Ctrl+V | Cut, copy, paste: see below |
| Arrows | Nudge the selection a grid step |
| Esc | Cancels a drag under way, else clears the selection |
| Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y | Undo, redo |
| [ and ] | Grid size down and up (the Grid button turns snapping on or off) |
| C | Shows the soft lines between zones' convex cells (at first), or hides them |
| D | The 3D view in flat colours (at first), or in the engine's dithers |
| F | Shows the whole map |
| Wheel | Zooms about the pointer |
| Right or middle drag | Pans |
| Ctrl+O, Ctrl+S | Opens a map; saves it (as a download) |
| Ctrl+E | Exports the map as the engine loads it (as a download) |

### Cut, copy and paste

Copy (Ctrl+C) puts the selection on the clipboard as a map of its own, in the text format:
the selected vertices, the edges between them and the zones they make, each zone keeping the
properties of the zone it was part of. Cut (Ctrl+X) copies, then deletes the selected
vertices and their edges.

Paste (Ctrl+V) floats the clipboard's map with the middle of its extent at the pointer,
moving in whole grid steps so what was on the grid stays on it. A click puts it down,
selected, and Esc cancels; a right drag pans meanwhile. It lands as a moved selection does:
edges split where they cross, vertices merge where they meet, and its zones win where they
overlap. As the clipboard holds text, a map can be pasted from another tab, or from a text
editor. Player mode has no selection, so it neither copies nor pastes.

### Properties panel

The panel on the right shows what's selected: its zones, its edges and its vertices, each in
a section of its own, or "None selected". In player mode it shows the start instead: its x
and y, stepping by the grid, and its angle, stepping by 8 and wrapping round.

| Section | Shows |
|---------|-------|
| Zones | Solid; the floor and ceiling heights, each with its shade |
| Edges | The top shade (walls and lintels) and bottom shade (risers), and what the edges draw |
| Vertices | x and y |

A field shows the value everything selected shares, or "mixed". Setting it sets it on all of
them; - and + (or Up and Down in the field) step each from its own value, 8 units a step, or
64 with Shift. Typing a value commits it on Enter or on leaving the field, and Esc puts it
back. A change that would put a floor at or above its ceiling is refused, with the reason in
the status line. A shade opens a grid of all 35, drawn as the engine dithers them.

A solid zone's heights and shades are hidden, not lost: clearing Solid brings them back, and
the file keeps them. With open and solid zones selected together, the fields change only the
open ones.

An edge draws a wall where it has an open zone on one side only; between two open zones, a
riser where the floors differ and a lintel where the ceilings do; otherwise nothing.

A vertex's x and y can be changed when it's the only one selected, which moves it as a drag
would: onto another vertex it merges, across edges it splits them. Up and Down step it a grid
step.

Each change is a step to undo; a run of steps of one field (with - and +, or Up and Down)
undoes as one.

### 3D view

The 3D view shows the map as the engine draws it, from a camera that circles the middle of
the plan view at the middle of the map's heights. Pan and zoom are shared: panning or zooming
either view moves both, and the zoom sets how far off the camera is. Turning the camera is
the 3D view's own.

| Action | Does |
|--------|------|
| Drag | Turns the camera: across to circle round, up and down to tilt, from below the floors to straight down |
| Click a wall, riser or lintel | Selects its edge, in place of the selection |
| Click a floor or ceiling | Selects its zone, in place of the selection |
| Ctrl+click (or Cmd+click) | Adds to the selection, or clears it on nothing |
| Click on nothing | Clears the selection |
| Wheel | Zooms both views |
| Right or middle drag | Pans both views |

Every surface shows from one side only, so from outside the map you see into it. An edge
draws a wall between an open zone and the outside or a solid zone, in its top shade; a riser
where two floors differ, seen from the lower, in its bottom shade; and a lintel where two
ceilings differ, seen from the higher, in its top shade. Floors face up and ceilings down. A
solid zone, like the outside, has no surfaces of its own: a pillar shows as the walls round
it. Shades show as flat colours, or as the engine dithers them (D), each 4x2 tile laid on the
screen's pixels at the Beeb's 2:1 pixel shape.

Selected surfaces are tinted amber, with posts up the selected vertices; the surface under
the pointer is lit, and named in the status line. The start shows as a post up to eye height
(80 units) with an arrow the way it faces. While an edit is under way in the plan, the 3D
view shows its result too.

### Convex cells

The engine holds the map as convex cells of at most 8 sides each. Every zone is cut into
them after each edit: its region is cut into triangles, which are merged back across the
diagonals between them while the result stays convex and within 8 sides, trying several ways
and keeping the fewest cells. The diagonals left are the soft edges. Both views draw zones
from their cells. The plan shows the soft lines, dashed and a little paler than the zone's
floor, and the cell count in the status line; C hides them.
The demo map's open zones make 26 cells (portalc's hand-built scene has 27).

### Export

Export (Ctrl+E) saves the map as the engine loads it, as the map's name with `.bin`: its
open zones' convex cells, their sides and edges, the vertices they use, and the start, as
`docs/export.md` lays out. The engine has one shade an edge, so an edge's top shade is the
one exported. The status line gives the counts and the size. A map that can't
be exported (more than 256 of anything, an edge 2048 units long or more, heights spanning
more than 255 steps of 8, or a start outside every open zone) is refused, with each reason
listed.

### Importing Doom levels

Opening a Doom WAD (`.wad`) asks which of its levels to import: a dialog lists them by
episode, each with its numbers of lines and sectors, and Esc or Cancel imports none. (A WAD
with one level imports it straight away.) The map is named after the level, such as
`e1m1.pmap`, and the console lists what the import changed or left out. WADs are id Software's:
git ignores them, so they stay out of this repository.

- **Geometry.** Each linedef becomes an edge, between only the vertices linedefs use: the
  node builder's split vertices are left out, as are linedefs with one sector on both sides,
  which bound nothing. Lines that cross are split where they cross. Lines that run
  straight on through a vertex no other line meets, as where a wall's texture changes along
  it, are joined into one edge, which takes the longest line's textures.
- **Zones.** Each region the edges enclose becomes a zone, with the sector its boundary's
  sidedefs face into. A sector in several pieces gives a zone each; a region with no sector,
  such as the inside of a pillar, is solid.
- **Size and heights.** Everything is scaled by 2, bringing Doom's eye height (41) near the
  engine's (80), and laid out as Doom's automap shows it, north up the page. A closed sector
  (a door) is opened to 4 below its neighbours' lowest ceiling, as a door opens; one with no
  room to open is solid.
- **Shades.** Each surface starts from its flat's or texture's average colour: a wall's
  middle texture, a lintel's upper texture on the side it's seen from (the sky, between two
  skies), a riser's lower texture on its side, a sky ceiling the sky's. The shades can't
  follow Doom's browns and greys, so a level is recoloured in what they do well: blues,
  purples and reds, and dark and olive greens (`src/doom/colour.ts`). A surface's colour
  sets its family and lightness, not its exact hue:
  - greenish colours take the greens, bluish ones the blues and strong reds the reds; greys
    and browns take a ramp from blue in the dark, through purple, to red in the light;
  - lightness goes by rank among the level's surfaces, kept dark;
  - the greens, blues and reds least like the level's average glow, pure and at full light:
    the acid among E1M1's browns is bright green.
- **Lighting.** Floors take all the light, from above; ceilings less; walls, lintels and
  risers more the more squarely they face the north-west.
- **Neighbours apart.** The engine draws a line only where the shade changes, so surfaces
  that meet must differ. Largest first, each surface takes the shade most like its colour,
  from its family while it can, that none of its neighbours has (`src/map/distinct.ts`):
  a zone's floor and ceiling and the faces round it, the floors (or ceilings) at a riser's
  (or lintel's) foot and top, level floors and ceilings across an edge, and faces meeting
  at a corner.
- **The start** is player 1's, facing the same way.

Things other than the start, lighting, specials and tags aren't imported. Most of Doom's
levels are too big to export as they are: more than 256 vertices, edges or sides.

### Snapping and edits

A new vertex, the end of a drawn edge, or a moved selection's grabbed vertex snaps to the
nearest vertex within reach, else the nearest edge within reach, else the grid (or whole
units with the grid off). On an edge it snaps to a grid point where one lies exactly on the
edge. While drawing or moving, the view shows what letting go would make: snapped, with
vertices merged where they meet and edges split where they cross. A crossing rounds to whole
units, which can put a small kink in the edges it splits.

After every edit the zones are worked out again from the edges. A zone keeps its properties
through the edit by its edges: a region takes the properties of the zone that lay along its
edges before. A zone moved whole wins over one that didn't move, and among several, the
largest wins. So a zone split in two gives both halves its properties; deleting the edge
between two zones keeps the larger one's; a zone dragged onto another takes the overlap. A
region drawn inside a zone takes that zone's properties, and one drawn in empty space gets
the defaults (floor 0, ceiling 160, floor `KRRR`, ceiling `KKKB`; new edges `BBRR`).

## Layout

| Path | What |
|------|------|
| `.github/workflows/pages.yml` | Testing, building and publishing with GitHub Pages |
| `docs/format.md` | The map text format |
| `docs/export.md` | The export the engine loads |
| `maps/demo.pmap` | portalc's demo scene |
| `src/main.ts` | The page: toolbar, the two views, panel, status line; opening, saving, exporting |
| `src/map/units.ts` | Coordinate and height types, and their checks |
| `src/map/map.ts` | The map: vertices, edges, zones, start |
| `src/map/shades.ts` | The engine's 35-shade catalogue, and the nearest to a colour |
| `src/map/geometry.ts` | Exact predicates on whole-unit points |
| `src/map/regions.ts` | The regions the edges enclose, with their holes |
| `src/map/check.ts` | What makes a map well formed |
| `src/map/format.ts` | Reading and writing the text format |
| `src/map/planarize.ts` | Making edges planar again after an edit |
| `src/map/straighten.ts` | Edges that run straight on through a vertex joined into one |
| `src/map/zones.ts` | Rebuilding the zones after an edit, keeping their properties |
| `src/map/edit.ts` | The editing operations |
| `src/map/faces.ts` | What an edge draws: wall, riser or lintel |
| `src/map/triangulate.ts` | A region cut into triangles |
| `src/map/cells.ts` | Zones cut into convex cells |
| `src/map/export.ts` | The map as the engine loads it |
| `src/map/distinct.ts` | Shades that keep neighbouring surfaces apart |
| `src/editor/view.ts` | The plan view's pan and zoom |
| `src/editor/hit.ts` | What's under the pointer, and snapping |
| `src/editor/selection.ts` | Edges and zones selected through their vertices |
| `src/editor/editor.ts` | The editor's state, with undo and redo |
| `src/editor/plan.ts` | The plan view: drawing, and pointer and key handling |
| `src/editor/panel.ts` | The properties panel |
| `src/editor/camera.ts` | The 3D view's orbiting camera |
| `src/editor/scene.ts` | The map's surfaces in 3D, and picking them |
| `src/editor/renderer.ts` | Drawing the surfaces with WebGL2 |
| `src/editor/view3d.ts` | The 3D view: drawing, and pointer handling |
| `src/editor/levels.ts` | The dialog asking which of a WAD's levels to import |
| `src/doom/wad.ts` | Reading Doom's WADs: levels, the palette, flats' and textures' colours |
| `src/doom/level.ts` | A Doom level as a map |
| `src/doom/colour.ts` | The colours an imported level's surfaces want |
| `test/` | Tests, one file per module |

In the browser's console, `portal.editor`, `portal.plan`, `portal.view3d` and `portal.panel`
are the editor's state, the two views and the properties panel.
