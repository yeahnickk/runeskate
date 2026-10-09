// Every door and gate in RuneSkate stands open: nobody gets stuck behind one, members' gates included.
// tools/export-world.ts leaves their models out of the meshes and tools/small-locs.ts lists the tile edges
// (and whole tiles, for the big shape-10 gates) they block, which tools/build.py then leaves open.
export const OPENABLE = /door|gate|curtain|arena (entrance|exit)/i;
const NEVER = /trap ?door|manhole|gate post/i;
/** shapes that close something off: straight/L/corner walls (0-3), diagonal walls (9), solid objects (10, 11) */
const SHAPES = new Set([0, 1, 2, 3, 9, 10, 11]);

export function opens(t: any, shape: number): boolean {
  const nm: string = t?.name || '';
  return !!nm && SHAPES.has(shape) && OPENABLE.test(nm) && !NEVER.test(nm);
}
