import { describe, expect, it } from 'vitest';
import { routeIdea as legacy } from '../../../src/domain/routing/rules';
import { routeIdea, analyzeRoutingText, routeAnalyzed } from '../../../src/domain/routing/rules-v2';
import { loadCatalogFromSeed } from './fixture-harness';
import type { RoutingInput } from '../../../src/domain/routing/types';

const catalog = loadCatalogFromSeed();
const input = (title: string, problem = 'Описание текущей ситуации для жителей.', solution = 'Предлагаю улучшить сервис для жителей.'): RoutingInput => ({
  title, problem, solution, requestedCategoryCode: null, territoryCode: 'DEMO_SEMEY',
});

describe('rules-v2 development guard and model policy', () => {
  for (const phrase of ['Нет светофора', 'Светофор не работает', 'Светофоров не хватает', 'Бағдаршам жоқ', 'Бағдаршам жұмыс істемейді']) {
    it(`treats ${phrase} as a problem rather than exclusion`, () => {
      const result = routeIdea(input(phrase), catalog);
      expect(result.detectedCategoryCode).toBe('TRANSPORT');
      expect(result.mode).toBe('ASSIGNED');
      expect(result.analysis?.occurrences?.some((o) => o.state === 'PROBLEM')).toBe(true);
    });
  }
  for (const phrase of ['Не нужны светофоры', 'Светофор нам не требуется', 'Бағдаршам қажет емес']) {
    it(`excludes ${phrase} without deleting the positive alternative`, () => {
      const result = routeIdea(input(phrase, 'Светофор уже работает хорошо.', 'Создать цифровой мониторинг воздуха.'), catalog);
      expect(result.detectedCategoryCode).toBe('ECOLOGY');
      expect(result.mode).toBe('ASSIGNED');
      expect(result.scores.TRANSPORT).toBeUndefined();
      expect(result.reasonCodes).toContain('EXCLUDED_TOPIC_IGNORED');
    });
  }
  it('keeps not-only additions active and asks a human to resolve two equal main goals', () => {
    const result = routeIdea(input('Не только светофоры, но и качество воздуха'), catalog);
    expect(result.mode).toBe('TRIAGE');
    expect(result.reasonCodes).toContain('MULTIPLE_PRIMARY_TOPICS');
    expect(result.scores.TRANSPORT).toBe(3);
    expect(result.scores.ECOLOGY).toBe(3);
  });
  it('preserves an affirmative feature when another occurrence was excluded', () => {
    const result = routeIdea(input('Светофор во дворе не нужен', 'Во дворе нет потребности в изменениях.', 'Установить светофор на городской дороге.'), catalog);
    expect(result.detectedCategoryCode).toBe('TRANSPORT');
    expect(result.mode).toBe('ASSIGNED');
    expect(result.scores.TRANSPORT).toBe(4);
  });
  it('requires review for nested negation and keeps quoted claims out of confident fallback assignment', () => {
    for (const phrase of ['Не согласен, что светофор не нужен', 'Нельзя не установить светофор', 'Говорят «светофор не нужен»']) {
      expect(routeIdea(input(phrase), catalog).mode).toBe('TRIAGE');
    }
  });
  it('does not promote roots inside unrelated words and caps a supported typo below HIGH', () => {
    const unrelated = analyzeRoutingText(input('Жолдама мен сурет туралы ақпарат'));
    expect(unrelated.detectedCategoryCode).toBeNull();
    const typo = routeIdea(input('Свитофоры на перекрестке для пешеходов'), catalog);
    expect(typo.detectedCategoryCode).toBe('TRANSPORT');
    expect(typo.confidenceBand).not.toBe('HIGH');
    expect(typo.reasonCodes).toContain('FUZZY_MATCH');
  });
  it('counts each active feature once and retains school context as a secondary tag', () => {
    const result = routeIdea(input('Светофор у школы', 'Светофор '.repeat(100), 'Добавить умный светофор.'), catalog);
    expect(result.scores.TRANSPORT).toBe(3);
    expect(result.tags).toContain('EDUCATION');
    expect(routeIdea(input('Светофор у школы', 'Светофор '.repeat(100), 'Добавить умный светофор.'), catalog)).toEqual(result);
    expect(JSON.stringify(result.analysis)).not.toContain('Светофор');
  });
  it('routes validated model output with the same catalog and author-choice conflict policy', () => {
    const original = input('Нет записи к врачу');
    const result = routeAnalyzed({ ...original, requestedCategoryCode: 'TRANSPORT' }, catalog, {
      detectedCategoryCode: 'HEALTH', confidenceBand: 'HIGH', secondaryCategories: [], needsReview: false,
      digitalComponent: true, explanation: '<untrusted text>',
    });
    expect(result.ruleVersion).toBe('hybrid-v2');
    expect(result.detectedCategoryCode).toBe('HEALTH');
    expect(result.effectiveCategoryCode).toBe('TRANSPORT');
    expect(result.reasonCodes).toContain('CATEGORY_CONFLICT');
    expect(result.mode).toBe('TRIAGE');
    expect(result.explanation).not.toContain('<untrusted');
  });
  it('does not veto a correctly recognized model alternative because old keyword rules saw a negative topic', () => {
    const result = routeAnalyzed(input('Не светофор, а медицинская консультация'), catalog,
      { detectedCategoryCode: 'HEALTH', confidenceBand: 'HIGH', needsReview: false, digitalComponent: true });
    expect(result.effectiveCategoryCode).toBe('HEALTH');
    expect(result.mode).toBe('ASSIGNED');
    expect(result.organizationCode).toBe('DEMO_SOCIAL');
  });
  it('leaves legacy algorithm output shape and version unchanged', () => {
    const result = legacy(input('Умный светофор', 'Дорога у школы.', 'Добавить датчики.'), catalog);
    expect(result.ruleVersion).toBe('rules-v1');
    expect(result.analysis).toBeUndefined();
    expect(result.detectedCategoryCode).toBeUndefined();
  });
  it('does not assign a background-only strong term to the author-selected department', () => {
    const result = routeIdea({ ...input('Общее улучшение сервиса',
      'Раньше светофор был установлен возле здания.', 'Предлагаю новый сервис для жителей.'),
      requestedCategoryCode: 'TRANSPORT' }, catalog);
    expect(result.mode).toBe('TRIAGE');
  });
  it('does not let a dropdown alone override weak model evidence', () => {
    const result = routeAnalyzed({ ...input('Общая идея для жителей'), requestedCategoryCode: 'ECOLOGY' }, catalog,
      { detectedCategoryCode: 'HEALTH', confidenceBand: 'LOW', needsReview: false });
    expect(result.mode).toBe('TRIAGE');
    expect(result.effectiveCategoryCode).toBe('ECOLOGY');
  });
  it('recognizes finite Kazakh refusal cues without generic stemming', () => {
    const result = routeIdea(input('Бағдаршамнан бас тарту'), catalog);
    expect(result.mode).toBe('TRIAGE');
    expect(result.scores.TRANSPORT).toBeUndefined();
  });
  it('recognizes an explicit Kazakh қолдану intervention without loosening background guards', () => {
    const result = routeIdea(input('Бағдаршам және жол', 'Мектеп жанындағы жол мәселесі.',
      'Бағдаршам және сенсор деректерін қолдану.'), catalog);
    expect(result.detectedCategoryCode).toBe('TRANSPORT');
    expect(result.confidenceBand).toBe('HIGH');
    expect(result.mode).toBe('ASSIGNED');
    expect(result.organizationCode).toBe('DEMO_TRANSPORT');
  });
  it('does not interpret the Kazakh noun қолданушы as an intervention verb', () => {
    const result = routeIdea(input('Жалпы қызмет туралы пікір', 'Жалпы жағдай сипатталған.',
      'Қолданушы бағдаршам туралы хабарлама оқыды.'), catalog);
    expect(result.confidenceBand).not.toBe('HIGH');
    expect(result.mode).toBe('TRIAGE');
  });
});
