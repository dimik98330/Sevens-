// D-01: explicit rules-v1 feature dictionary (04 section 3).
// Only the word forms listed here participate in scoring. Unlisted forms,
// typos and paraphrases may not match. Negated known terms STILL match:
// rules-v1 does not understand negation, so HIGH can be wrong too. Bands are
// dictionary-score bands, not calibrated accuracy. Each feature counts ONCE.

import type { CategoryCode } from './types';

export interface RoutingFeature {
  id: string;
  category: CategoryCode;
  weight: number;
  // Safe RU label used in explanations (dictionary text, never user input).
  label: string;
  // Whole-token matches (already normalized: lowercase, e->e, NFC).
  tokens: readonly string[];
  // Multi-word matches as token sequences, matched inside one input field.
  phrases: readonly (readonly string[])[];
}

export const RULE_VERSION = 'rules-v1' as const;

export const FEATURES: readonly RoutingFeature[] = [
  {
    id: 'traffic_light',
    category: 'TRANSPORT',
    weight: 3,
    label: 'светофор',
    tokens: ['светофор', 'светофоры', 'светофоров', 'светофора', 'бағдаршам', 'бағдаршамдар'],
    phrases: [],
  },
  {
    id: 'road',
    category: 'TRANSPORT',
    weight: 1,
    label: 'дорога',
    tokens: ['дорога', 'дороги', 'дороге', 'дорог', 'жол', 'жолдар'],
    phrases: [],
  },
  {
    id: 'bus',
    category: 'TRANSPORT',
    weight: 3,
    label: 'автобус',
    tokens: ['автобус', 'автобусы', 'автобусов', 'автобусе'],
    phrases: [],
  },
  {
    id: 'transit_stop',
    category: 'TRANSPORT',
    weight: 2,
    label: 'остановка',
    tokens: ['остановка', 'остановки', 'аялдама'],
    phrases: [],
  },
  {
    id: 'water_meter',
    category: 'UTILITIES',
    weight: 3,
    label: 'счётчик воды',
    tokens: [],
    phrases: [
      ['счетчик', 'воды'],
      ['счетчики', 'воды'],
      ['су', 'есептегіш'],
    ],
  },
  {
    id: 'water_leak',
    category: 'UTILITIES',
    weight: 3,
    label: 'утечка воды',
    tokens: [],
    phrases: [
      ['утечка', 'воды'],
      ['утечки', 'воды'],
      ['су', 'ағуы'],
    ],
  },
  {
    id: 'street_light',
    category: 'UTILITIES',
    weight: 3,
    label: 'уличное освещение',
    tokens: [],
    phrases: [
      ['освещение', 'улицы'],
      ['уличное', 'освещение'],
    ],
  },
  {
    id: 'school',
    category: 'EDUCATION',
    weight: 1,
    label: 'школа',
    tokens: ['школа', 'школы', 'школе', 'школ', 'мектеп', 'мектептер'],
    phrases: [],
  },
  {
    id: 'school_service',
    category: 'EDUCATION',
    weight: 3,
    label: 'электронный дневник',
    tokens: [],
    phrases: [
      ['электронный', 'дневник'],
      ['школьное', 'приложение'],
      ['мектеп', 'қосымшасы'],
    ],
  },
  {
    id: 'air_quality',
    category: 'ECOLOGY',
    weight: 3,
    label: 'качество воздуха',
    tokens: [],
    phrases: [
      ['качество', 'воздуха'],
      ['качества', 'воздуха'],
      ['ауа', 'сапасы'],
    ],
  },
  {
    id: 'waste',
    category: 'ECOLOGY',
    weight: 2,
    label: 'отходы',
    tokens: ['мусор', 'мусора', 'отходы', 'отходов', 'қоқыс'],
    phrases: [],
  },
  {
    id: 'safety',
    category: 'SAFETY',
    weight: 1,
    label: 'безопасность',
    tokens: ['безопасность', 'безопасности', 'безопасный', 'қауіпсіздік'],
    phrases: [],
  },
  {
    id: 'emergency_button',
    category: 'SAFETY',
    weight: 3,
    label: 'тревожная кнопка',
    tokens: [],
    phrases: [
      ['тревожная', 'кнопка'],
      ['тревожные', 'кнопки'],
    ],
  },
  {
    id: 'clinic_queue',
    category: 'HEALTH',
    weight: 3,
    label: 'запись к врачу',
    tokens: [],
    phrases: [
      ['очередь', 'в', 'поликлинике'],
      ['запись', 'к', 'врачу'],
      ['дәрігерге', 'жазылу'],
    ],
  },
  {
    id: 'museum_guide',
    category: 'TOURISM',
    weight: 3,
    label: 'аудиогид',
    tokens: ['аудиогид'],
    phrases: [['музейный', 'гид']],
  },
  {
    id: 'access_map',
    category: 'ACCESSIBILITY',
    weight: 3,
    label: 'карта доступности',
    tokens: [],
    phrases: [
      ['карта', 'доступности'],
      ['доступный', 'маршрут'],
    ],
  },
];

// Digital-component markers (04 section 3). Whole-token match only, so
// "предлагаем" never counts as "приложение". Latin variants cover
// mixed-script input; absence only adds DIGITAL_COMPONENT_NOT_CLEAR.
export const DIGITAL_MARKERS: readonly string[] = [
  'датчик',
  'датчики',
  'датчиков',
  'приложение',
  'приложения',
  'умный',
  'умные',
  'умных',
  'цифровой',
  'цифровая',
  'онлайн',
  'online',
  'сенсор',
  'sensor',
  'қосымша',
];

export const CATEGORY_NAMES_RU: Readonly<Record<CategoryCode, string>> = {
  TRANSPORT: 'Транспорт',
  UTILITIES: 'ЖКХ',
  EDUCATION: 'Образование',
  ECOLOGY: 'Экология',
  SAFETY: 'Безопасность',
  HEALTH: 'Здравоохранение',
  TOURISM: 'Туризм и культура',
  ACCESSIBILITY: 'Доступная среда',
  OTHER: 'Другое',
};

export const CATEGORY_CODES: readonly CategoryCode[] = [
  'TRANSPORT',
  'UTILITIES',
  'EDUCATION',
  'ECOLOGY',
  'SAFETY',
  'HEALTH',
  'TOURISM',
  'ACCESSIBILITY',
  'OTHER',
];
