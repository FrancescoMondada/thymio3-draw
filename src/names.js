// The pseudonym written under the QR code of the page, with the date and the time: a student shows the code of the network they
// trained, the teacher photographs it and files the photo, so the picture has to say whose it is. Every device starts with a
// pseudonym drawn at random, in the style of the handles of online games a 12 to 14 year old uses: a word of science, space or
// speed and a creature, glued together, then two digits ("NeonFalcon42", "QuantumLynx07"). 46 x 38 x 90 = about 157 000
// pseudonyms, so that two devices of a class almost never share one. The adult, or the student, can type another one.
//
// The words are the same in the four languages (they are the ones of the games, and of the screen the pupils know), so that no
// grammatical agreement is needed and the pseudonym does not depend on the language of the page.

export const NAME_MAX = 32;                 // characters of a pseudonym, typed or drawn (the longest drawn is 18)

const PREFIXES = [
  'Neon', 'Turbo', 'Pixel', 'Cyber', 'Nitro', 'Quantum', 'Hyper', 'Astro', 'Ultra', 'Delta', 'Omega', 'Zero', 'Nova', 'Binary',
  'Vector', 'Laser', 'Plasma', 'Photon', 'Orbit', 'Matrix', 'Glitch', 'Stealth', 'Shadow', 'Storm', 'Thunder', 'Frost', 'Blaze',
  'Ghost', 'Rogue', 'Apex', 'Vortex', 'Radar', 'Sonic', 'Hex', 'Byte', 'Cosmic', 'Solar', 'Lunar', 'Crimson', 'Onyx', 'Chrome',
  'Echo', 'Flux', 'Volt', 'Neutron', 'Proton',
];

const CREATURES = [
  'Falcon', 'Wolf', 'Fox', 'Lynx', 'Raven', 'Viper', 'Cobra', 'Panther', 'Hawk', 'Orca', 'Shark', 'Dragon', 'Phoenix', 'Tiger',
  'Jaguar', 'Cheetah', 'Eagle', 'Scorpion', 'Mantis', 'Hornet', 'Kraken', 'Yeti', 'Griffin', 'Pegasus', 'Sphinx', 'Golem', 'Cyborg',
  'Drone', 'Rover', 'Raptor', 'Mustang', 'Bison', 'Condor', 'Manta', 'Barracuda', 'Leopard', 'Puma', 'Stingray',
];

const NUMBERS = 90;                                   // 10 to 99
export const NAME_COUNT = PREFIXES.length * CREATURES.length * NUMBERS;
export const NAME_WORDS = { prefixes: PREFIXES, creatures: CREATURES };

// The pseudonym for a prefix, a creature and a number (indexes: the pieces of the palette)
export const composeName = (prefix, creature, number) => `${PREFIXES[prefix]}${CREATURES[creature]}${10 + number}`;

// The pieces of a pseudonym drawn at random (`rand`: a function giving a number from 0 up to 1, exclusive, as Math.random does)
export function randomParts(rand = Math.random) {
  const pick = (n) => Math.min(n - 1, Math.floor(rand() * n));
  return { prefix: pick(PREFIXES.length), creature: pick(CREATURES.length), number: pick(NUMBERS) };
}

// A pseudonym drawn at random
export function randomName(rand = Math.random) {
  const { prefix, creature, number } = randomParts(rand);
  return composeName(prefix, creature, number);
}

// A pseudonym as it is kept: text, no line break, not longer than the limit
export const cleanName = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, NAME_MAX);

// The date and the time as one short line in a language: "29 oct. 2026, 11:42"
export function formatWhen(date, lang, timeZone) {
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}
