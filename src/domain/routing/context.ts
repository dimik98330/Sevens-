// Conservative clause-level intent guard used only by the offline fallback.
// It never interprets arbitrary "not" as removal of a whole category.
import type { EvidenceState, RoutingInput } from './types';

export interface ContextToken { value: string; start: number; end: number }
export interface ContextClause {
  field: 'title' | 'problem' | 'solution';
  index: number;
  text: string;
  tokens: ContextToken[];
  followedByContrast: boolean;
  uncertain: boolean;
}

export const ACTION_CUE = /созда\p{L}*|установ\p{L}*|внедр\p{L}*|добав\p{L}*|показ\p{L}*|отремонт\p{L}*|разработ\p{L}*|предлага\p{L}*|мониторинг|отслежив\p{L}*|нуж(?:ен|на|ны|но)|требу\p{L}*|орнат\p{L}*|жасау|жасай\p{L}*|ұсын\p{L}*|қажет|керек|бақыла\p{L}*|көрсет\p{L}*|(?<!\p{L})қолдану(?!\p{L})/u;
export const DEFICIT_CUE = /(?:^|\s)нет(?:\s|$)|отсутств\p{L}*|не\s+(?:работа\p{L}*|хватает|могу|может|могут)|жоқ|істемейді|жетіспейді|алмайды/u;

export function extractContext(input: RoutingInput): ContextClause[] {
  const clauses: ContextClause[] = [];
  for (const field of ['title', 'problem', 'solution'] as const) {
    const source = input[field].normalize('NFC');
    const matches = [...source.matchAll(/[^.!?;\n,]+/gu)];
    for (let i = 0; i < matches.length; i++) {
      const part = matches[i]!;
      const tokens = [...part[0].matchAll(/[\p{L}\p{N}]+/gu)].map((token) => ({
        value: token[0].toLowerCase().replace(/ё/g, 'е'),
        start: part.index! + token.index!, end: part.index! + token.index! + token[0].length,
      }));
      if (!tokens.length) continue;
      clauses.push({ field, index: clauses.length,
        text: part[0].toLowerCase().replace(/ё/g, 'е'), tokens,
        followedByContrast: /^\s*(?:а|но|бірақ)\s/u.test(matches[i + 1]?.[0].toLowerCase() ?? ''),
        uncertain: /не\s+(?:соглас\p{L}*|счита\p{L}*)|(?:нельзя|невозможно|не могу)\s+не(?=\s|$)|емес\s+емес/u.test(source.toLowerCase()),
      });
    }
  }
  return clauses;
}

export function occurrenceState(clause: ContextClause, first: number, last: number,
  weakLocation = false): EvidenceState {
  const before = clause.tokens.slice(Math.max(0, first - 7), first).map((t) => t.value).join(' ');
  const after = clause.tokens.slice(last + 1, last + 8).map((t) => t.value).join(' ');
  const text = clause.text;
  // Attributed speech, nested and double negation need semantic review.
  if (clause.uncertain || /[«»“”"]/.test(text)) {
    return 'UNCERTAIN';
  }
  const additive = /не\s+(?:только|просто)(?=\s|$)/u.test(before)
    || /^(?:ғана\s+емес|тек\s+емес)(?=\s|$)/u.test(after)
    || /(?:тек\s+|ғана\s+)[\p{L}\s]*емес/u.test(text);
  if (additive) return clause.field === 'problem' ? 'PROBLEM' : 'REQUEST';
  // A failure/absence is the problem being proposed for resolution.
  if (/^(?:[\p{L}]+\s+){0,2}не\s+(?:работа\p{L}*|функциониру\p{L}*|учитыва\p{L}*)(?=\s|$)/u.test(after)
    || /жұмыс\s+істемейді|ескермейді/u.test(after)) return 'PROBLEM';
  // "No problems with X" is different from "No X".
  if (/(?:нет|не существует)\s+(?:никаких\s+)?проблем/u.test(before)
    || /^(?:сейчас\s+)?нет\s+(?:никаких\s+)?проблем/u.test(after)
    || /мәсел\p{L}*\s+жоқ/u.test(after)
    || /(?:работает|работают)\s+(?:уже\s+)?(?:хорошо|исправно)|(?:уже\s+)?(?:исправно|хорошо)\s+работа\p{L}*/u.test(text)
    || /жақсы\s+жұмыс\s+істейді/u.test(text)) return 'BACKGROUND';
  if (/қарсы\s+емес\p{L}*/u.test(text)) return 'UNCERTAIN';
  if (/(?:не\s+(?:нужен|нужна|нужны|нужно|требуется|требуются)|отказаться\s+от|не\s+устанавливать|нет\s+(?:необходимости|нужды|смысла))(?:\s+(?:нам|здесь|сейчас|вообще|новый|новые|этот|эти|устанавливать|ставить|покупать|создавать|строить)){0,3}$/u.test(before)
    || /^(?:(?:во?|на|у|для)\s+\p{L}+(?:\s+\p{L}+)?\s+)?(?:(?:нам|здесь|сейчас|вообще|уже|абсолютно)\s+){0,3}(?:не\s+(?:нужен|нужна|нужны|нужно|требуется|требуются)|(?:керек|қажет)\s+емес)/u.test(after)
    || /бас\s+тарт|қарсымын|(?:^|\s)қарсы(?:\s|$)|ұсынбаймын|орнатпау|қажеті\s+жоқ/u.test(after + ' ' + before)
    || /^емес(?=\s|$)/u.test(after) || /(?:^|\s)не$/u.test(before)) return 'EXCLUDED';
  if (/(?:нет|отсутствует|отсутствуют|не\s+хватает|недостаточно)(?:\s+\p{L}+){0,3}$/u.test(before)
    || /^(?:нет|отсутствует|отсутствуют|не\s+хватает|жетіспейді|жоқ)(?=\s|$)/u.test(after)
    || /не\s+(?:могу|может|могут|удается)|алмайды|мүмкіндіг\p{L}*\s+(?:жоқ|болмауы)/u.test(text)) return 'PROBLEM';
  if (!/предлага\p{L}*|нуж(?:ен|на|ны|но)|необходимо|давайте|требу\p{L}*|қажет|керек|жасау|орнату/u.test(text)
    && /уже\s+(?:есть|имеется|установлен\p{L}*)|раньше|ранее|бұрын|орнатылған|(?:^|\s)бар(?:\s|$)/u.test(text)) return 'BACKGROUND';
  if (weakLocation && /возле|рядом|маңында|жанында|(?:^|\s)у\s/u.test(text)) return 'BACKGROUND';
  if (/(?:^|\s)(?:не|нет|емес|жоқ)(?:\s|$)|істемейді|болмауы/u.test(text)) return 'UNCERTAIN';
  return clause.field === 'problem' ? 'PROBLEM' : 'REQUEST';
}
