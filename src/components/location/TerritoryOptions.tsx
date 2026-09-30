'use client';
import { useTranslation } from '@/features/i18n/provider';
import { territoryDisplayName, territoryGroup, territoryMatches, type CatalogTerritory } from '@/features/shared/territories';

export function TerritoryOptions({ territories, search='', selected='', useCode=false }: { territories: CatalogTerritory[]; search?: string; selected?: string; useCode?: boolean }) {
  const { locale } = useTranslation();
  const value = (t:CatalogTerritory) => useCode ? t.code : t.id ?? t.code;
  const groups = new Map<string,{label:string; items:CatalogTerritory[]}>();
  for (const territory of territories) {
    if (territory.kind === 'DISTRICT' || territory.kind === 'CITY_ADMIN') continue;
    if (territory.code === 'DEMO_LOCALITY' && value(territory) !== selected) continue;
    if (value(territory) !== selected && !territoryMatches(territory,search)) continue;
    const group = territoryGroup(territory,locale);
    const current = groups.get(group.code) ?? {label:group.label,items:[]};
    current.items.push(territory); groups.set(group.code,current);
  }
  const sorted = [...groups.entries()].sort(([a],[b]) => a==='cities' ? -1 : b==='cities' ? 1 : a.localeCompare(b));
  return sorted.map(([code,group]) => <optgroup key={code} label={group.label}>{group.items.sort((a,b)=>territoryDisplayName(a,locale).localeCompare(territoryDisplayName(b,locale),locale)).map(territory => {
    const name = territoryDisplayName(territory,locale);
    const duplicates = group.items.filter(t=>territoryDisplayName(t,locale)===name);
    const area = locale==='kk' ? territory.areaNameKk : locale==='en' ? territory.areaNameEn : territory.areaNameRu;
    const designation = territory.designation==='station' ? {ru:'станция',kk:'станция',en:'station'}[locale] : territory.designation==='railStop' ? {ru:'разъезд',kk:'разъезд',en:'railway stop'}[locale] : {ru:'село',kk:'ауыл',en:'village'}[locale];
    const detail = duplicates.some(t=>t.designation!==territory.designation) ? designation : area;
    return <option key={territory.code} value={value(territory)}>{name}{duplicates.length>1 && detail ? ` · ${detail}` : ''}</option>;
  })}</optgroup>);
}
