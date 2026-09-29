-- B-01: static category catalog (enum-fixed, 03 section 2 + 01 FR-04).
INSERT INTO categories (code, name_ru, name_kk, active) VALUES
  ('TRANSPORT', 'Транспорт', 'Көлік', TRUE),
  ('UTILITIES', 'ЖКХ', 'ТКШ', TRUE),
  ('EDUCATION', 'Образование', 'Білім беру', TRUE),
  ('ECOLOGY', 'Экология', 'Экология', TRUE),
  ('SAFETY', 'Безопасность', 'Қауіпсіздік', TRUE),
  ('HEALTH', 'Здравоохранение', 'Денсаулық сақтау', TRUE),
  ('TOURISM', 'Туризм и культура', 'Туризм және мәдениет', TRUE),
  ('ACCESSIBILITY', 'Доступная среда', 'Қолжетімді орта', TRUE),
  ('OTHER', 'Другое', 'Басқа', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ru = EXCLUDED.name_ru,
  name_kk = EXCLUDED.name_kk,
  active = EXCLUDED.active;
