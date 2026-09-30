import catalog from '@/domain/territories/abai.json';
import type { Locale } from '@/features/i18n/locale';

export interface CatalogTerritory {
  id?: string;
  code: string;
  kind?: string;
  nameRu: string;
  nameKk?: string;
  nameEn?: string;
  districtCode?: string;
  areaNameRu?: string;
  areaNameKk?: string;
  areaNameEn?: string;
  designation?: string;
}
const localities = new Map(catalog.territories.map(t => [t.code,t]));
const districts = new Map(catalog.districts.map(t => [t.code,t]));
export function territoryMetadata(code: string): Partial<CatalogTerritory> {
  const record = localities.get(code);
  return record ? { nameKk:record.nameKk, nameEn:record.nameEn, districtCode:record.districtCode, kind:record.kind, areaNameRu:record.areaNameRu, areaNameKk:record.areaNameKk, areaNameEn:record.areaNameEn, designation:record.designation } : {};
}
export function territoryDisplayName(territory: CatalogTerritory, locale: Locale): string {
  const known = localities.get(territory.code);
  return locale === 'kk' ? territory.nameKk || known?.nameKk || territory.nameRu
    : locale === 'en' ? territory.nameEn || known?.nameEn || territory.nameRu : territory.nameRu;
}
export function territoryGroup(territory: CatalogTerritory, locale: Locale): { code: string; label: string } {
  const district = districts.get(territory.districtCode || localities.get(territory.code)?.districtCode || '');
  if (district?.kind === 'CITY_ADMIN') return { code:'cities', label:{ru:'Города областного значения',kk:'Облыстық маңызы бар қалалар',en:'Regional cities'}[locale] };
  return district ? { code:district.code, label:locale === 'kk' ? district.nameKk : locale === 'en' ? district.nameEn : district.nameRu }
    : { code:'other',label:{ru:'Другие территории',kk:'Басқа аумақтар',en:'Other territories'}[locale] };
}
export function territoryMatches(territory: CatalogTerritory, search: string): boolean {
  const text = [territory.nameRu,territory.nameKk,territory.nameEn,...(['ru','kk','en'] as const).map(locale=>territoryGroup(territory,locale).label)].join(' ').normalize('NFC').toLocaleLowerCase();
  return text.includes(search.normalize('NFC').trim().toLocaleLowerCase());
}
