# Abai settlement catalogue

Source: Kazakhstan Bureau of National Statistics, [KATO NK RK 11-2025](https://stat.gov.kz/ru/classifiers/statistical/21/), updated **2026-09-18**. The exact XLSX download URL and its SHA-256 are recorded in `abai.json.source`.

Coverage: **326 registered localities**, including 4 cities, 2 towns and 320 rural localities, grouped under all 10 districts and the two regional city administrations. This matches the [regional administration's 2026 structure](https://www.gov.kz/memleket/entities/abay/documents/details/1031934?lang=ru).

Extraction uses AB=10 and KATO's registered-locality encoding: HIJ>000 with IJ=00/80/90, plus the regional cities 101010000 and 101810000. Subsidiary farmsteads/other objects with population below 50 are not separate registered settlement choices; they can be described with the location text and map inside their parent locality. Administrative districts and rural administrations are grouping metadata, not settlement options. The encoding is documented in the [official classifier specification](https://stat.gov.kz/upload/iblock/b79/39nf76eyu5gsa6jn83vsz6u6leiiz1hv/%D0%9D%D0%9A%20%D0%A0%D0%9A%2011-2025.docx).

Russian and Kazakh names come from the classifier. English display names use product transliterations, not an official English nomenclature. Homonymous localities in the same district are distinguished by rural administration or station designation.

Reproduce extraction with `scripts/extract-abai-territories.py` (Python + openpyxl), using the source workbook at `.data/territories/kato.xlsx`. Apply with `npm run db:territories`. The import is transactional and repeatable: it preserves existing UUIDs, legacy Semey references, ideas, users and routing rules. CLI seed and API bootstrap include it for new installations. No production dependency downloads data at runtime.
