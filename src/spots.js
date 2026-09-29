// Challenge spots (world tiles). Each is snapped to the nearest open tile at load; tools/spot-check.ts
// verifies every one is reachable from spawn without crossing a wall, door or fence.
//
// kinds: combo (bank n points) · grind (n seconds on rails) · manual (n seconds) · speed (n km/h)
//        trick (land a named trick) · grabflip (a grab + flip in one air) · stomp/smack (n npcs)
//        air (n seconds of hang time in one jump) · chain (bank a combo of n+ tricks)
//        letters (collect S-K-A-T-E around the spot; `high` letters need air or a grind)
// Only the ones listed in ACTIVE are placed in the world (user: too many glowing rings). Add ids back to enable.
export const ACTIVE = new Set(["bridge"]);
export const SPOTS_ALL = [
  // --- Lumbridge ---
  { id: 'courtyard', at: [3224, 3220], name: 'Castle Courtyard', task: 'Bank a 1,500 point combo', time: 40, kind: 'combo', n: 1500, xp: 3000 },
  { id: 'bridge', at: [3238, 3224], name: 'Lumbridge Bridge', task: 'Grind for 3 seconds', time: 35, kind: 'grind', n: 3, xp: 3500 },
  { id: 'goblins', at: [3249, 3237], name: 'Goblin Village Green', task: 'Stomp 2 goblins', time: 45, kind: 'stomp', n: 2, npc: 'goblin', xp: 4000 },
  { id: 'church', at: [3240, 3200], name: 'Church Road', task: 'Manual for 3 seconds', time: 30, kind: 'manual', n: 3, xp: 3000 },
  { id: 'lumstore', at: [3212, 3250], name: 'General Store', task: 'Collect S-K-A-T-E', time: 60, kind: 'letters', r: 9, xp: 4000 },
  { id: 'bobs', at: [3229, 3209], name: "Bob's Axes", task: 'Chain 3 tricks in one combo', time: 40, kind: 'chain', n: 3, xp: 3500 },
  { id: 'graveyard', at: [3246, 3192], name: 'Lumbridge Graveyard', task: 'Get 0.7s of hang time', time: 35, kind: 'air', n: 0.7, xp: 3000 },
  { id: 'crossroads', at: [3236, 3262], name: 'Lumbridge Crossroads', task: 'Land a Varial Kickflip', time: 35, kind: 'trick', trick: 'Varial', xp: 3000 },
  { id: 'lumrats', at: [3233, 3226], name: 'Castle Back Lane', task: 'Smack 2 rats', time: 45, kind: 'smack', n: 2, npc: 'rat', xp: 3000 },
  { id: 'lumeast', at: [3262, 3215], name: 'River Lum Bank', task: 'Bank a 3,000 point combo', time: 45, kind: 'combo', n: 3000, xp: 4500 },
  { id: 'swamproad', at: [3221, 3179], name: 'Swamp Road', task: 'Hit 30 km/h', time: 30, kind: 'speed', n: 30, xp: 2500 },
  // --- fields north of Lumbridge ---
  { id: 'cows', at: [3255, 3269], name: 'Cow Field', task: 'Smack 2 cows', time: 45, kind: 'smack', n: 2, npc: 'cow', xp: 3500 },
  { id: 'farm', at: [3190, 3282], name: "Fred's Farm", task: 'Land a 360 Flip', time: 40, kind: 'trick', trick: '360 Flip', xp: 4500 },
  { id: 'chickens', at: [3229, 3295], name: 'Chicken Coop', task: 'Stomp 2 chickens', time: 45, kind: 'stomp', n: 2, npc: 'chicken', xp: 3500 },
  { id: 'mill', at: [3166, 3298], name: 'Mill Lane Mill', task: 'Land a Hardflip', time: 40, kind: 'trick', trick: 'Hardflip', xp: 4000 },
  { id: 'wheat', at: [3159, 3279], name: 'Wheat Field Track', task: 'Collect S-K-A-T-E', time: 60, kind: 'letters', r: 10, xp: 4500 },
  { id: 'cowfield2', at: [3250, 3290], name: 'North Cow Pasture', task: 'Chain 4 tricks in one combo', time: 45, kind: 'chain', n: 4, xp: 4500 },
  { id: 'imps', at: [3213, 3283], name: 'Imp Hollow', task: 'Smack an imp', time: 45, kind: 'smack', n: 1, npc: 'imp', xp: 3500 },
  { id: 'riverlum', at: [3240, 3310], name: 'River Lum Meadow', task: 'Get 0.72s of hang time', time: 35, kind: 'air', n: 0.72, xp: 3500 },
  // --- Draynor ---
  { id: 'draynor', at: [3104, 3250], name: 'Draynor Straight', task: 'Hit 30 km/h', time: 30, kind: 'speed', n: 30, xp: 2500 },
  { id: 'draymarket', at: [3082, 3250], name: 'Draynor Market', task: 'Chain 4 tricks in one combo', time: 45, kind: 'chain', n: 4, xp: 4500 },
  { id: 'draybank', at: [3094, 3238], name: 'Draynor Bank Plaza', task: 'Collect S-K-A-T-E', time: 60, kind: 'letters', r: 9, xp: 4500 },
  { id: 'draymen', at: [3097, 3276], name: 'Draynor North Lane', task: 'Smack a man', time: 45, kind: 'smack', n: 1, npc: 'man', xp: 3500 },
  { id: 'manor', at: [3108, 3330], name: 'Draynor Manor Gate', task: 'Bank a 4,000 point combo', time: 50, kind: 'combo', n: 4000, xp: 6000 },
  { id: 'westgob', at: [3143, 3236], name: 'West Goblin Camp', task: 'Stomp 2 goblins', time: 45, kind: 'stomp', n: 2, npc: 'goblin', xp: 4000 },
  { id: 'wizards', at: [3108, 3173], name: "Wizards' Tower Path", task: 'Land a Double Kickflip', time: 40, kind: 'trick', trick: 'Double Kickflip', xp: 5000 },
  // --- Varrock outskirts ---
  { id: 'champions', at: [3187, 3352], name: "Champions' Guild", task: 'Bank a 5,000 point combo', time: 55, kind: 'combo', n: 5000, xp: 7000 },
  { id: 'varsouth', at: [3212, 3378], name: 'Varrock South Road', task: 'Chain 5 tricks in one combo', time: 50, kind: 'chain', n: 5, xp: 6000 },
  { id: 'varmine', at: [3285, 3362], name: 'South-east Mine', task: 'Get 0.72s of hang time', time: 35, kind: 'air', n: 0.72, xp: 4500 },
  { id: 'varchick', at: [3197, 3350], name: 'Guild Chicken Run', task: 'Land a 360 Shove-it', time: 40, kind: 'trick', trick: '360 Shove', xp: 4000 },
  // --- Al Kharid ---
  { id: 'alkharid', at: [3292, 3180], name: 'Al Kharid Gate', task: 'Land a grab + flip combo', time: 45, kind: 'grabflip', xp: 5000 },
  { id: 'akbank', at: [3272, 3168], name: 'Al Kharid Bank', task: 'Collect S-K-A-T-E', time: 60, kind: 'letters', r: 9, xp: 5000 },
  { id: 'akpalace', at: [3290, 3158], name: 'Palace Courtyard', task: 'Land a Double Heelflip', time: 40, kind: 'trick', trick: 'Double Heelflip', xp: 5000 },
  { id: 'akmine', at: [3298, 3285], name: 'Al Kharid Mine', task: 'Bank a 4,000 point combo', time: 50, kind: 'combo', n: 4000, xp: 6000 },
  { id: 'akimps', at: [3297, 3266], name: 'Desert Scrub', task: 'Smack an imp', time: 45, kind: 'smack', n: 1, npc: 'imp', xp: 3500 },
  { id: 'akroad', at: [3280, 3230], name: 'Desert Road', task: 'Hit 30 km/h', time: 30, kind: 'speed', n: 30, xp: 2500 },
  { id: 'akman', at: [3294, 3200], name: 'Al Kharid Streets', task: 'Manual for 4 seconds', time: 35, kind: 'manual', n: 4, xp: 4000 },
];
export const SPOTS = SPOTS_ALL.filter(s => ACTIVE.has(s.id));
