-- بيانات تجريبية اختيارية لمنصة إنجاز (فنيون وتقييمات وهمية للعرض فقط)
-- لا تُطبَّق تلقائياً. شغّلها يدوياً على فرع تجريبي أو محلياً:
--   psql "$NETLIFY_DB_URL" -f seed/sample_data.sql
-- احذفها قبل الإطلاق:  DELETE FROM customers WHERE whatsapp = '50000000';  ثم احذف الفنيين التجريبيين

BEGIN;

INSERT INTO technicians (service_id, name, whatsapp)
SELECT s.id, v.name, v.whatsapp
FROM (VALUES
  ('ac',    'خالد للتكييف',            '55123401'),
  ('ac',    'مؤسسة النسيم للتبريد',    '66234502'),
  ('ac',    'أبو يوسف للتكييف',        '33345603'),
  ('ac',    'فني التبريد السريع',      '77456704'),
  ('plumb', 'راشد للسباكة',            '55567805'),
  ('plumb', 'سباكة الدوحة',            '66678906'),
  ('plumb', 'عمر الأدوات الصحية',      '33789007'),
  ('elec',  'الريان للكهرباء',          '55890108'),
  ('elec',  'نور للتمديدات',           '66901209'),
  ('elec',  'فهد كهربائي معتمد',       '77012310'),
  ('carp',  'ورشة الأرز للنجارة',      '55123411'),
  ('carp',  'نجارة الخليج',            '33234512')
) AS v(code, name, whatsapp)
JOIN services s ON s.code = v.code;

INSERT INTO customers (whatsapp, name) VALUES ('50000000', 'عميل تجريبي');

-- (whatsapp الفني, التكلفة بالريال, تقييم التكلفة, الجودة, السرعة, قبل كم يوم)
WITH v(tw, cost, c, q, s, days) AS (VALUES
  ('55123401',250,4,5,4, 2),('55123401',180,4,4,5, 3),('55123401',400,3,5,5, 4),
  ('66234502',150,5,4,3, 5),('66234502',120,5,4,4, 6),('66234502',200,4,3,4, 7),('66234502',140,5,4,3, 8),
  ('33345603',450,3,5,5, 9),('33345603',600,2,5,4,10),
  ('55567805',150,4,4,5,11),('55567805',220,4,5,5,12),('55567805',100,5,4,4,13),
  ('66678906', 90,5,3,4,14),('66678906',110,5,4,3,15),
  ('33789007',300,3,5,3,16),('33789007',280,3,5,4,17),('33789007',200,4,4,3,18),
  ('55890108',180,4,5,5,19),('55890108',160,4,4,5,20),
  ('66901209',100,5,4,4,21),('66901209',120,5,4,3,22),('66901209', 80,5,3,4,23),
  ('77012310',350,3,5,4,24),
  ('55123411',500,4,5,4,25),('55123411',750,4,5,3,26),('55123411',900,3,4,4,27),
  ('33234512',300,5,4,5,28),('33234512',350,4,3,5,29)
),
ins AS (
  INSERT INTO orders (customer_id, technician_id, service_id, status, cost_qar, created_at, completed_at)
  SELECT (SELECT id FROM customers WHERE whatsapp = '50000000'), t.id, t.service_id, 'completed', v.cost,
         now() - make_interval(days => v.days) - interval '3 hours', now() - make_interval(days => v.days)
    FROM v JOIN technicians t ON t.whatsapp = v.tw
  RETURNING id, technician_id, cost_qar, completed_at
)
INSERT INTO ratings (order_id, technician_id, cost_score, quality_score, speed_score, created_at)
SELECT ins.id, ins.technician_id, v.c, v.q, v.s, ins.completed_at
  FROM ins JOIN technicians t ON t.id = ins.technician_id
  JOIN v ON v.tw = t.whatsapp AND v.cost = ins.cost_qar;

COMMIT;
