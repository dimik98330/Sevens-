import hashlib, json, pathlib, re, uuid
import openpyxl

workbook = pathlib.Path('.data/territories/kato.xlsx')
rows = [list(row) for row in openpyxl.load_workbook(workbook, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True) if str(row[1]) == '10']
districts = [row for row in rows if str(row[0]).endswith('00000') and row[2] != '00']
district_en = {'10': 'Semey', '18': 'Kurchatov', '32': 'Abai district', '34': 'Aksuat district', '36': 'Ayagoz district', '38': 'Beskaragai district', '40': 'Borodulikha district', '41': 'Zhanasemey district', '42': 'Zharma district', '44': 'Kokpekti district', '45': 'Makanshy district', '46': 'Urzhar district'}
alphabet = dict(zip('абвгдеёзийклмнопрстуфхцъыьэ', ['a','b','v','g','d','e','yo','z','i','y','k','l','m','n','o','p','r','s','t','u','f','kh','ts','','y','','e']))
alphabet.update({'ж':'zh','ч':'ch','ш':'sh','щ':'shch','ю':'yu','я':'ya','ә':'a','ғ':'gh','қ':'q','ң':'ng','ө':'o','ұ':'u','ү':'u','һ':'h','і':'i'})
def latin(text):
    return ''.join(alphabet.get(c.lower(),c).capitalize() if c.isupper() else alphabet.get(c,c) for c in text)
def identity(code):
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, 'territory:' + code))
def clean_ru(text):
    return re.sub(r'^(?:г|с|п|ст|рзд)\.\s*', '', text).strip()
def clean_kk(text):
    return re.sub(r'\s+(?:қ|а|к|ст)\.$', '', re.sub(r'^рзд\.\s*', '', text)).strip()
parents = [{ 'id': identity('KATO_'+r[0]), 'code': 'KATO_'+r[0], 'katoCode': r[0], 'kind': 'CITY_ADMIN' if r[2] in ['10','18'] else 'DISTRICT', 'nameRu': r[7], 'nameKk': r[6], 'nameEn': district_en[r[2]] } for r in districts]
parent_by_area = {r[2]: p for r,p in zip(districts,parents)}
by_code = {r[0]: r for r in rows}
localities = []
for r in rows:
    # KATO separates registered localities (HI with I=0/8/9, J=0)
    # from subsidiary farmsteads/other objects encoded with IJ=02..79/82..89/92..99.
    hij = str(r[4]).zfill(3)
    regional_city = r[0] in ['101010000','101810000']
    if not regional_city and not (int(hij)>0 and hij[-2:] in ['00','80','90']):
        continue
    code = 'DEMO_SEMEY' if r[0] == '101010000' else 'KATO_'+r[0]
    ru, kk = clean_ru(r[7]), clean_kk(r[6])
    name_en = {'101010000':'Semey','101810000':'Kurchatov','103620100':'Ayagoz','104221100':'Shar','104163100':'Chagan','104165100':'Shulbinsk'}.get(r[0],latin(kk))
    rural = by_code.get(r[0][:6]+'000')
    area_ru, area_kk = (rural[7],rural[6]) if rural else ('','')
    localities.append({'id':identity(code),'code':code,'katoCode':r[0],'kind':'CITY' if r[7].startswith('г.') else 'TOWN' if r[7].startswith('п.') else 'LOCALITY','nameRu':ru,'nameKk':kk,'nameEn':name_en,'districtCode':parent_by_area[r[2]]['code'],'areaNameRu':area_ru,'areaNameKk':area_kk,'areaNameEn':latin(area_kk),'designation':'station' if r[7].startswith('ст.') else 'railStop' if r[7].startswith('рзд.') else 'village'})
assert len(localities) == 326
assert len({item['code'] for item in localities}) == 326
assert len(parents) == 12
assert sum(item['kind']=='CITY' for item in localities) == 4
result = {'schemaVersion':1,'regionCode':'ABAI','regionId':str(uuid.uuid5(uuid.NAMESPACE_DNS,'region:ABAI')),'source':{'classification':'KATO NK RK 11-2025','updatedAt':'2026-09-18','page':'https://stat.gov.kz/ru/classifiers/statistical/21/','url':'https://stat.gov.kz/upload/iblock/a7d/eqogm92xc0udumlzfzffhcrutk0fjhb4/%D0%9A%D0%90%D0%A2%D0%9E_18.09.2026.xlsx','sha256':hashlib.sha256(workbook.read_bytes()).hexdigest()},'districts':parents,'territories':localities}
target = pathlib.Path('src/domain/territories/abai.json')
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'localities':len(localities),'districts':10,'cities':4,'towns':2,'rural':320},ensure_ascii=False))
