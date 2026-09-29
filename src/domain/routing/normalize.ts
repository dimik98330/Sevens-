// D-01: normalization and tokenization (04 section 3).
// NFC -> lowercase -> yo->ye -> collapse whitespace. Russian and Kazakh
// letters are preserved; nothing is transliterated or dropped.

export function normalizeText(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

// Unicode letter/number tokens. Punctuation, emoji and symbols act as
// separators, so "мәселесі." yields the token "мәселесі".
export function tokenize(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

// True when the token sequence `phrase` occurs contiguously in `tokens`.
export function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  const first = phrase[0];
  for (let i = 0; i + phrase.length <= tokens.length; i += 1) {
    if (tokens[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < phrase.length; j += 1) {
      if (tokens[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}
