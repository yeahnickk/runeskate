// Chat filter (server side, so the log, /stats and every client see the clean line).
// "shit" and friends become "wonderful"; other swears and slurs are starred out (f***).
// Matching looks through simple disguises (sh1t, $hit, fuuuck, f.u.c.k) but only on whole words, so
// "Scunthorpe", "class" and "cocktail" are left alone.

const WONDERFUL = /^(shit|shite|shits|shitty|shitting|shitted|bullshit|horseshit|shithead|shitheads|shitter)$/;
// stems: a word matches if it IS the stem or the stem plus a common ending
const STEMS = ['fuck', 'motherfuck', 'cunt', 'bitch', 'bastard', 'dick', 'dickhead', 'cock', 'cocksucker', 'pussy',
  'asshole', 'arsehole', 'wanker', 'wank', 'twat', 'slut', 'whore', 'fag', 'faggot', 'nigger', 'nigga', 'retard',
  'bollock', 'prick', 'jizz', 'cum', 'dildo', 'tits', 'titties', 'boob', 'piss', 'spastic', 'tranny', 'kike', 'chink',
  'rape', 'rapist', 'nonce', 'pedo', 'paedo'];
const EXACT = new Set(['ass', 'arse', 'fk', 'fck', 'fuk', 'stfu', 'wtf', 'mf', 'bs', 'kys']);
const ENDINGS = ['', 's', 'es', 'er', 'ers', 'ing', 'in', 'ed', 'y', 'ie', 'ies', 'head', 'heads', 'hole', 'holes', 'face'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', 'µ': 'u' };
function normalise(w: string) {
  let s = w.toLowerCase().replace(/./g, c => LEET[c] ?? c).replace(/[^a-z]/g, '');
  return s.replace(/(.)\1+/g, '$1$1');                    // fuuuuck -> fuuck (then tried both ways below)
}
function variants(w: string) { const n = normalise(w); return [n, n.replace(/(.)\1/g, '$1')]; }

function bad(w: string): 'wonderful' | 'star' | null {
  for (const v of variants(w)) {
    if (!v) continue;
    if (WONDERFUL.test(v)) return 'wonderful';
    if (EXACT.has(v)) return 'star';
    for (const st of STEMS) if (v.startsWith(st) && ENDINGS.includes(v.slice(st.length))) return 'star';
  }
  return null;
}

export function cleanChat(text: string): string {
  // a "word" here also swallows symbols stuck inside it (f.u.c.k, sh!t) but not spaces
  let out = text.replace(/[A-Za-z0-9@$!|+µ]+(?:[._\-*][A-Za-z0-9@$!|+µ]+)*/g, raw => {
    // trailing ! | + are punctuation ("Shit!"), not leet letters
    const tail = raw.match(/[!|+]*$/)![0], word = raw.slice(0, raw.length - tail.length);
    if (!word) return raw;
    const hit = bad(word);
    if (!hit) return raw;
    if (hit === 'wonderful') return (/[A-Z]/.test(word[0]) ? 'Wonderful' : 'wonderful') + tail;
    return word[0] + '*'.repeat(Math.max(2, word.length - 1)) + tail;
  });
  // spaced-out letters: "s h i t", "a c u n t" - test every stretch of a run of single letters
  out = out.replace(/\b[A-Za-z](?: [A-Za-z]){2,}\b/g, run => {
    const L = run.split(' ');
    for (let i = 0; i < L.length; i++) for (let j = L.length; j - i >= 3; j--) {
      const hit = bad(L.slice(i, j).join(''));
      if (hit) return [...L.slice(0, i), hit === 'wonderful' ? 'wonderful' : L[i] + '***', ...L.slice(j)].join(' ');
    }
    return run;
  });
  return out;
}
