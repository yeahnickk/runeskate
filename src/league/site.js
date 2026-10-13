// Where Rune League's stadium stands: in the Lumbridge cabbage patch (world tiles 3194..3212 x 3285..3301), the pitch
// run east-west along it. RL's arena is scaled down to fit (K game units per uu): the karts are toy-sized, the ball's
// one of the patch's own cabbages, and the farm towers round the walls. Pure (the bake tool reads it too).
export const SITE = {
  S: 1.5,                                                         // WORLD_SCALE
  x: (3203.5 - 2048) * 1.5, z: (3293 - 2816) * 1.5,               // the patch's middle, game units (east, north)
  K: 1 / 400,                                                     // game units per uu: the pitch (12000 uu with its goals) is 30 units long
  rot: Math.PI / 2,                                               // the pitch's length (+z, toward orange) runs east
};
SITE.halfX = (6000 + 300) * SITE.K; SITE.halfZ = (4096 + 300) * SITE.K;   // the stadium's footprint, walls and all (east-west, north-south)
/** a point of the footprint (u, v in -1..1: along the pitch, across) -> game units [x (east), z (north)] */
export const footprint = (u, v) => [SITE.x + u * SITE.halfX, SITE.z + v * SITE.halfZ];
