// Детерминированные правила rules-v1 (04 §2–4). Чистая функция: тот же вход — тот же выход.
// Используется mock-API и предпросмотром объяснения в мастере. Не меняет статусы.
const FEATURES = [
  { id: 'traffic_light', cat: 'TRANSPORT', w: 3, aliases: ['светофор', 'светофоры', 'светофоров', 'светофора', 'светофорами', 'бағдаршам', 'бағдаршамдар'] },
  { id: 'road', cat: 'TRANSPORT', w: 1, aliases: ['дорога', 'дороги', 'дороге', 'дорог', 'дорогу', 'дорожный', 'жол', 'жолдар', 'жолды'] },
  { id: 'bus', cat: 'TRANSPORT', w: 3, aliases: ['автобус', 'автобусы', 'автобусов', 'автобусе'] },
  { id: 'transit_stop', cat: 'TRANSPORT', w: 2, aliases: ['остановка', 'остановки', 'остановке', 'аялдама'] },
  { id: 'water_meter', cat: 'UTILITIES', w: 3, aliases: ['счетчик воды', 'счетчики воды', 'су есептегіш'] },
  { id: 'water_leak', cat: 'UTILITIES', w: 3, aliases: ['утечка воды', 'утечки воды', 'утечек воды', 'су ағуы'] },
  { id: 'street_light', cat: 'UTILITIES', w: 3, aliases: ['освещение улицы', 'уличное освещение'] },
  { id: 'school', cat: 'EDUCATION', w: 1, aliases: ['школа', 'школы', 'школе', 'школ', 'школу', 'мектеп', 'мектептер'] },
  { id: 'school_service', cat: 'EDUCATION', w: 3, aliases: ['электронный дневник', 'школьное приложение', 'мектеп қосымшасы'] },
  { id: 'air_quality', cat: 'ECOLOGY', w: 3, aliases: ['качество воздуха', 'качества воздуха', 'ауа сапасы'] },
  { id: 'waste', cat: 'ECOLOGY', w: 2, aliases: ['мусор', 'мусора', 'отходы', 'отходов', 'қоқыс'] },
  { id: 'safety', cat: 'SAFETY', w: 1, aliases: ['безопасность', 'безопасности', 'безопасный', 'қауіпсіздік'] },
  { id: 'emergency_button', cat: 'SAFETY', w: 3, aliases: ['тревожная кнопка', 'тревожные кнопки', 'тревожной кнопки'] },
  { id: 'clinic_queue', cat: 'HEALTH', w: 3, aliases: ['очередь в поликлинике', 'запись к врачу', 'дәрігерге жазылу'] },
  { id: 'museum_guide', cat: 'TOURISM', w: 3, aliases: ['аудиогид', 'музейный гид'] },
  { id: 'access_map', cat: 'ACCESSIBILITY', w: 3, aliases: ['карта доступности', 'доступный маршрут'] },
];
const DIGITAL = ['датчик', 'датчики', 'датчиков', 'датчиками', 'приложение', 'приложения', 'умный', 'умные', 'умных', 'цифровой', 'цифровая', 'цифровое', 'онлайн', 'сенсор', 'сенсоры', 'қосымша'];
const ORG_BY_CAT = {
  TRANSPORT: 'DEMO_TRANSPORT', UTILITIES: 'DEMO_UTILITIES', ECOLOGY: 'DEMO_ECOLOGY',
  EDUCATION: 'DEMO_SOCIAL', HEALTH: 'DEMO_SOCIAL', TOURISM: 'DEMO_SOCIAL', ACCESSIBILITY: 'DEMO_SOCIAL',
  SAFETY: 'DEMO_SAFETY', OTHER: 'DEMO_TRIAGE',
};
const CAT_RU = {
  TRANSPORT: 'транспортной теме', UTILITIES: 'теме ЖКХ', EDUCATION: 'теме образования',
  ECOLOGY: 'теме экологии', SAFETY: 'теме безопасности', HEALTH: 'теме здравоохранения',
  TOURISM: 'теме культуры и туризма', ACCESSIBILITY: 'теме доступной среды', OTHER: 'нескольким направлениям',
};

export function normalizeText(s) {
  return (s ?? '').normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

// Каждый признак — один раз за весь документ (04 §3).
export function scoreFeatures({ title = '', problem = '', solution = '' }) {
  const doc = normalizeText(`${title} ${problem} ${solution}`);
  const padded = ` ${doc} `;
  const evidence = [];
  const scores = {};
  for (const f of FEATURES) {
    const hit = f.aliases.some((a) => padded.includes(` ${a}`) || padded.includes(`${a} `) || doc === a || padded.includes(` ${a},`) || padded.includes(` ${a}.`));
    if (hit) {
      evidence.push({ featureId: f.id, categoryCode: f.cat, weight: f.w });
      scores[f.cat] = (scores[f.cat] ?? 0) + f.w;
    }
  }
  const digital = DIGITAL.some((d) => padded.includes(` ${d}`) || padded.includes(`${d} `));
  return { scores, evidence, digital };
}

export function decideRoute(input, ctx = {}) {
  const { requestedCategoryCode = null } = input;
  const { scores, evidence, digital } = scoreFeatures(input);
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const top = entries[0]?.[1] ?? 0;
  const second = entries[1]?.[1] ?? 0;
  const band = top >= 3 && top - second >= 2 ? 'HIGH' : top >= 2 ? 'MEDIUM' : 'LOW';
  const tags = [...new Set([...entries.filter(([, s]) => s > 0).map(([c]) => c), ...(digital ? ['SMART_CITY'] : [])])];
  const reasonCodes = [];
  if (!digital) reasonCodes.push('DIGITAL_COMPONENT_NOT_CLEAR');

  let effective, mode, org, extraReasons = [];
  const requested = requestedCategoryCode && requestedCategoryCode !== 'AUTO' ? requestedCategoryCode : null;
  const topCat = entries[0]?.[0];
  if (!requested) {
    if (band === 'HIGH') { effective = topCat; mode = 'ASSIGNED'; org = ORG_BY_CAT[effective]; }
    else { effective = 'OTHER'; mode = 'TRIAGE'; org = 'DEMO_TRIAGE'; }
  } else if (requested === 'OTHER') {
    effective = 'OTHER'; mode = 'TRIAGE'; org = 'DEMO_TRIAGE';
  } else {
    effective = requested;
    if (band === 'HIGH' && topCat && topCat !== requested) {
      mode = 'TRIAGE'; org = 'DEMO_TRIAGE'; extraReasons.push('CATEGORY_CONFLICT');
    } else { mode = 'ASSIGNED'; org = ORG_BY_CAT[requested]; }
  }
  if (ctx.disabledOrganizationCodes?.includes(org)) { mode = 'TRIAGE'; org = 'DEMO_TRIAGE'; }
  if (ctx.conflictingCategoryRoute === effective && mode === 'ASSIGNED') {
    mode = 'TRIAGE'; org = 'DEMO_TRIAGE'; extraReasons.push('RULE_CONFIGURATION_CONFLICT');
  }
  const tagList = tags.filter((t) => t !== effective);
  const explanation = mode === 'TRIAGE' && effective === 'OTHER' && band === 'LOW'
    ? 'Текст не даёт уверенного направления: идея передана в демонстрационный центр разбора направлений. Специалист уточнит маршрут.'
    : mode === 'TRIAGE'
      ? `Признаки указывают на ${tagList.map((t) => CAT_RU[t] ?? t).join(', ') || 'несколько тем'} — уверенного единственного направления нет. Идея передана в демонстрационный центр разбора направлений.`
      : `Признаки указывают на ${CAT_RU[effective]}. Направлено в демонстрационную очередь. Это учебное распределение, а не официальное полномочие органа.`;
  return {
    source: 'RULES', ruleVersion: 'rules-v1', effectiveCategoryCode: effective,
    organizationCode: org, mode, confidenceBand: band,
    tags: tags.filter((t) => t !== effective || mode === 'TRIAGE'),
    scores, evidence, reasonCodes: [...reasonCodes, ...extraReasons], explanation,
  };
}
