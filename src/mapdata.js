// Pure data shared by the game client and serve.ts (the /map page): no three.js, no DOM.
// Portals: world tiles. `pad` = the portal in the Lumbridge courtyard, `at` = where it drops you, `back` = the
// portal home beside it.
export const PORTAL_HOME = { name: 'Lumbridge', at: [3222, 3218], col: '#3cf' };
export const PORTAL_DESTS = [
  { name: 'Varrock', pad: [3226, 3223], at: [3209, 3425], back: [3207, 3427], col: '#f93' },
  { name: 'Falador', pad: [3218, 3223], at: [2965, 3378], back: [2962, 3377], col: '#fff' },
  { name: 'Draynor', pad: [3218, 3214], at: [3092, 3249], back: [3089, 3248], col: '#9f6' },
  { name: 'Port Sarim', pad: [3218, 3211], at: [3016, 3242], back: [3013, 3241], col: '#6cf' },
  { name: 'Edgeville', pad: [3218, 3226], at: [3094, 3496], back: [3092, 3498], col: '#fd4' },
  { name: 'Al Kharid', pad: [3226, 3214], at: [3292, 3176], back: [3291, 3179], col: '#fc6' },
  { name: 'King Black Dragon', pad: [3226, 3226], sub: 'deep Wilderness!', at: [2965, 3856], back: [2964, 3853], col: '#f33' },
  // members' land: the inner corners of the courtyard, clear of the spawn-to-gate line
  { name: 'Ardougne', pad: [3220, 3224], sub: 'members', at: [2662, 3305], back: [2662, 3303], col: '#c6f', inner: true },
  { name: 'Camelot', pad: [3224, 3224], sub: 'members', at: [2733, 3474], back: [2733, 3472], col: '#ccf', inner: true },
  { name: 'Brimhaven', pad: [3220, 3213], sub: 'members · Karamja', at: [2764, 3174], back: [2764, 3172], col: '#6f9', inner: true },
  { name: 'Canifis', pad: [3224, 3213], sub: 'members · Morytania', at: [3494, 3488], back: [3494, 3486], col: '#9a8', inner: true },
];

// NPC spawns in the Lumbridge core (world tiles); the rest of F2P is in npc-spawns.js (tools/place.py)
export const CORE_SPAWNS = {
  goblin: [[3141, 3258], [3142, 3230], [3145, 3229], [3183, 3244], [3187, 3246], [3244, 3245], [3247, 3247], [3250, 3238], [3252, 3228], [3255, 3222], [3258, 3245], [3260, 3233]],
  cow: [[3254, 3258], [3258, 3260], [3261, 3259], [3243, 3295], [3247, 3284], [3255, 3278], [3160, 3318], [3182, 3329]],
  chicken: [[3185, 3277], [3187, 3278], [3191, 3277], [3228, 3297], [3230, 3299], [3232, 3299], [3196, 3352], [3198, 3354]],
  rat: [[3100, 3273], [3229, 3223], [3232, 3229], [3236, 3222], [3319, 3250]],
  imp: [[3214, 3281], [3240, 3307], [3205, 3355], [3299, 3273]],
  man: [[3223, 3240], [3231, 3207], [3100, 3279], [3294, 3196]],
  // the stone circle south of Varrock, and the pair by Draynor
  darkwizard: [[3223, 3367], [3223, 3372], [3224, 3370], [3225, 3365], [3225, 3374], [3228, 3373], [3230, 3363], [3230, 3365], [3230, 3374], [3232, 3367], [3232, 3372], [3084, 3236], [3085, 3238]],
};
