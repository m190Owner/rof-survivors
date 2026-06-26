// Story-mode campaign data. Pure content — the comic look lives in storyboard.js
// and the mission rules in game.js. Each chapter has intro + outro panel arrays
// and a mission (locked biome + boss).
//
// panel = {
//   bg: 'depot'|'field'|'desert'|'marsh'|'dark',   // themed comic backdrop
//   caption: 'narration box text',                  // optional yellow caption
//   sprites: [{ img, x, y, scale, flip, rot }],     // img = /assets sprite name; x/y in %
//   bubbles: [{ x, y, text, tail }],                // speech bubbles (tail: 'l'|'r')
//   sfx: [{ x, y, text, color, rot }],              // big comic onomatopoeia
// }

export const CHAPTERS = [
  {
    id: 'ch1', title: 'Rude Awakening', biome: 0, bossType: 'boss_maw',
    sub: 'Concrete Depot',
    intro: [
      { bg: 'depot', caption: '0600. The depot. The coffee was, at last, perfect.',
        sprites: [{ img: 'char_commando', x: 38, y: 60, scale: 2.4 }, { img: 'char_medic', x: 64, y: 62, scale: 2.1 }] },
      { bg: 'depot',
        sprites: [{ img: 'char_commando', x: 35, y: 58, scale: 2.6 }],
        bubbles: [{ x: 52, y: 30, text: 'Quietest shift in weeks.', tail: 'l' }] },
      { bg: 'depot', caption: 'It was not quiet for long.',
        sprites: [{ img: 'enemy_chaser', x: 22, y: 64, scale: 2.2 }, { img: 'enemy_swarmer', x: 50, y: 70, scale: 1.8 }, { img: 'enemy_chaser', x: 76, y: 60, scale: 2.4 }],
        sfx: [{ x: 50, y: 22, text: 'RUMBLE!', color: '#ff5a3c', rot: -6 }] },
      { bg: 'depot',
        sprites: [{ img: 'char_heavy', x: 30, y: 60, scale: 2.6 }, { img: 'enemy_chaser', x: 70, y: 58, scale: 2.6 }],
        bubbles: [{ x: 40, y: 28, text: "Why are they all... bright red?", tail: 'l' }] },
      { bg: 'dark', caption: 'And then THE MAW arrived. A giant mouth with serious commitment issues.',
        sprites: [{ img: 'boss_maw', x: 52, y: 58, scale: 4.2 }],
        sfx: [{ x: 24, y: 34, text: 'CHOMP!', color: '#ffd23b', rot: 8 }] },
    ],
    outro: [
      { bg: 'depot',
        sprites: [{ img: 'boss_maw', x: 60, y: 64, scale: 3.4, rot: 28 }, { img: 'char_commando', x: 26, y: 58, scale: 2.4 }],
        bubbles: [{ x: 30, y: 26, text: 'One mouth down.', tail: 'l' }],
        sfx: [{ x: 66, y: 28, text: 'KABOOM!', color: '#ff8a3c', rot: -10 }] },
      { bg: 'field', caption: 'But the horde kept coming. The field was next.' },
    ],
  },
  {
    id: 'ch2', title: 'Field Day', biome: 1, bossType: 'boss_charger',
    sub: 'Overgrown Field',
    intro: [
      { bg: 'field', caption: 'The field. Tall grass, fresh air, certain death.',
        sprites: [{ img: 'char_demo', x: 50, y: 60, scale: 2.6 }] },
      { bg: 'field',
        sprites: [{ img: 'char_demo', x: 36, y: 58, scale: 2.7 }],
        bubbles: [{ x: 54, y: 28, text: 'I love the smell of cordite in the morning.', tail: 'l' }] },
      { bg: 'field', caption: 'The welcome party brought explosives.',
        sprites: [{ img: 'enemy_bomber', x: 30, y: 64, scale: 2 }, { img: 'enemy_ranged', x: 68, y: 60, scale: 2.2 }],
        sfx: [{ x: 50, y: 24, text: 'BEEP BEEP—', color: '#ffb84b', rot: -4 }] },
      { bg: 'dark', caption: 'THE CHARGER had exactly one move. It was a great move.',
        sprites: [{ img: 'boss_charger', x: 52, y: 58, scale: 4 }],
        sfx: [{ x: 22, y: 64, text: 'STOMP!', color: '#ff5a3c', rot: 6 }] },
    ],
    outro: [
      { bg: 'field',
        sprites: [{ img: 'boss_charger', x: 62, y: 66, scale: 3.2, rot: 30 }, { img: 'char_medic', x: 26, y: 58, scale: 2.3 }],
        bubbles: [{ x: 30, y: 26, text: 'Anyone else need a nap?', tail: 'l' }] },
      { bg: 'desert', caption: 'Onward — to the desert, and significantly worse haircuts.' },
    ],
  },
  {
    id: 'ch3', title: 'Dust & Teeth', biome: 2, bossType: 'boss_hive',
    sub: 'Desert Ruins',
    intro: [
      { bg: 'desert', caption: 'Desert Ruins. Hot, dusty, and full of things that spit.',
        sprites: [{ img: 'char_heavy', x: 50, y: 60, scale: 2.6 }] },
      { bg: 'desert',
        sprites: [{ img: 'char_heavy', x: 38, y: 58, scale: 2.7 }],
        bubbles: [{ x: 56, y: 28, text: "I'm out of water AND patience.", tail: 'l' }] },
      { bg: 'desert', caption: 'The locals were unfriendly. And damp.',
        sprites: [{ img: 'enemy_spitter', x: 30, y: 62, scale: 2.2 }, { img: 'enemy_summoner', x: 70, y: 60, scale: 2.4 }],
        sfx: [{ x: 50, y: 24, text: 'PTOOEY!', color: '#ff7bd0', rot: -8 }] },
      { bg: 'dark', caption: 'THE HIVE kept making more of itself. Rude.',
        sprites: [{ img: 'boss_hive', x: 52, y: 58, scale: 4 }],
        sfx: [{ x: 24, y: 34, text: 'BUZZZZ', color: '#d56fae', rot: 5 }] },
    ],
    outro: [
      { bg: 'desert',
        sprites: [{ img: 'boss_hive', x: 60, y: 66, scale: 3.2, rot: -26 }, { img: 'char_commando', x: 26, y: 58, scale: 2.3 }],
        bubbles: [{ x: 30, y: 26, text: 'Note to self: bring bug spray.', tail: 'l' }] },
      { bg: 'marsh', caption: 'One biome left. The marsh. Pack a mop.' },
    ],
  },
  {
    id: 'ch4', title: 'Last Stand', biome: 3, bossType: 'boss_maw',
    sub: 'Blood Marsh',
    intro: [
      { bg: 'marsh', caption: 'The Blood Marsh. The end of the line.',
        sprites: [{ img: 'char_commando', x: 50, y: 60, scale: 2.6 }] },
      { bg: 'marsh',
        sprites: [{ img: 'char_commando', x: 36, y: 58, scale: 2.6 }],
        bubbles: [{ x: 54, y: 28, text: "Whatever's running this... it's down there.", tail: 'l' }] },
      { bg: 'marsh', caption: 'The whole squad. One last push.',
        sprites: [{ img: 'char_commando', x: 28, y: 62, scale: 2 }, { img: 'char_heavy', x: 44, y: 64, scale: 2 }, { img: 'char_demo', x: 60, y: 62, scale: 2 }, { img: 'char_medic', x: 74, y: 64, scale: 2 }] },
      { bg: 'dark', caption: 'THE MAW. Again. Bigger. Angrier. Still, fundamentally, a mouth.',
        sprites: [{ img: 'boss_maw', x: 52, y: 56, scale: 5 }],
        sfx: [{ x: 20, y: 30, text: 'CHOMP CHOMP', color: '#ffd23b', rot: 7 }] },
    ],
    outro: [
      { bg: 'marsh', caption: 'The horde broke. The marsh went quiet.',
        sprites: [{ img: 'char_commando', x: 34, y: 60, scale: 2.3 }, { img: 'char_medic', x: 62, y: 62, scale: 2.2 }],
        sfx: [{ x: 50, y: 24, text: 'VICTORY!', color: '#7fff8a', rot: -6 }] },
      { bg: 'depot', caption: 'FIN. — Press DEPLOY for endless mode anytime.',
        sprites: [{ img: 'char_medic', x: 50, y: 60, scale: 2.4 }],
        bubbles: [{ x: 54, y: 26, text: 'So... same time tomorrow?', tail: 'l' }] },
    ],
  },
];
