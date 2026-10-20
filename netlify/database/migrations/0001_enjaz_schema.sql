-- =====================================================================
-- قاعدة بيانات منصة إنجاز للصيانة المنزلية في قطر
-- PostgreSQL 14+ · Netlify Database migration 0001
-- الجداول: services (الخدمات) · customers (العملاء) · technicians (الفنيون)
--          orders (الطلبات) · ratings (التقييمات)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الخدمات
-- ---------------------------------------------------------------------
CREATE TABLE services (
    id          SMALLSERIAL PRIMARY KEY,
    code        VARCHAR(20)  NOT NULL UNIQUE,           -- ac, plumb, elec, carp
    name_ar     VARCHAR(60)  NOT NULL,
    description VARCHAR(200),
    sort_order  SMALLINT     NOT NULL DEFAULT 0,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,     -- إيقاف الخدمة يخفيها من الشاشة الرئيسية
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2) العملاء — التسجيل برقم واتساب، والاسم اختياري
-- ---------------------------------------------------------------------
CREATE TABLE customers (
    id             BIGSERIAL PRIMARY KEY,
    whatsapp       CHAR(8)      NOT NULL UNIQUE
                   CHECK (whatsapp ~ '^[3567][0-9]{7}$'),   -- رقم قطري بدون +974
    name           VARCHAR(100),                             -- اختياري
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- 3) الفنيون — تُدخلهم الإدارة حسب الخدمة
-- ---------------------------------------------------------------------
CREATE TABLE technicians (
    id          BIGSERIAL PRIMARY KEY,
    service_id  SMALLINT     NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    name        VARCHAR(100) NOT NULL,
    whatsapp    CHAR(8)      NOT NULL
                CHECK (whatsapp ~ '^[3567][0-9]{7}$'),
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (service_id, whatsapp)                         -- لا يتكرر الرقم في نفس الخدمة
);
CREATE INDEX idx_technicians_service ON technicians(service_id) WHERE is_active;

-- ---------------------------------------------------------------------
-- 4) الطلبات — تُنشأ تلقائياً عند ضغط العميل على «تواصل عبر واتساب»
-- ---------------------------------------------------------------------
CREATE TYPE order_status AS ENUM ('pending', 'completed', 'cancelled');
-- pending = قيد الاتفاق · completed = مكتملة · cancelled = ملغاة

CREATE TABLE orders (
    id             BIGSERIAL PRIMARY KEY,
    customer_id    BIGINT        NOT NULL REFERENCES customers(id)   ON DELETE RESTRICT,
    technician_id  BIGINT        NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
    service_id     SMALLINT      NOT NULL REFERENCES services(id)    ON DELETE RESTRICT,
    status         order_status  NOT NULL DEFAULT 'pending',
    cost_qar       NUMERIC(10,2) CHECK (cost_qar >= 0),             -- التكلفة بالريال يدخلها العميل
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    completed_at   TIMESTAMPTZ,
    CONSTRAINT completed_needs_cost
        CHECK (status <> 'completed' OR (cost_qar IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX idx_orders_customer   ON orders(customer_id, created_at DESC);
CREATE INDEX idx_orders_technician ON orders(technician_id);
CREATE INDEX idx_orders_pending    ON orders(status) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- 5) التقييمات — تقييم واحد لكل طلب مكتمل
--    1 = لا أوافق بشدة ... 5 = أوافق بشدة
-- ---------------------------------------------------------------------
CREATE TABLE ratings (
    id             BIGSERIAL PRIMARY KEY,
    order_id       BIGINT    NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    technician_id  BIGINT    NOT NULL REFERENCES technicians(id),   -- منسوخ من الطلب لتسريع المتوسطات
    cost_score     SMALLINT  NOT NULL CHECK (cost_score     BETWEEN 1 AND 5),
    quality_score  SMALLINT  NOT NULL CHECK (quality_score  BETWEEN 1 AND 5),
    speed_score    SMALLINT  NOT NULL CHECK (speed_score    BETWEEN 1 AND 5),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ratings_technician ON ratings(technician_id);

-- يضمن أن التقييم لطلب مكتمل وأن الفني يطابق فني الطلب
CREATE FUNCTION check_rating_order() RETURNS trigger AS $$
DECLARE o orders%ROWTYPE;
BEGIN
    SELECT * INTO o FROM orders WHERE id = NEW.order_id;
    IF o.status <> 'completed' THEN
        RAISE EXCEPTION 'لا يمكن تقييم طلب غير مكتمل (الطلب %)', NEW.order_id;
    END IF;
    IF o.technician_id <> NEW.technician_id THEN
        RAISE EXCEPTION 'الفني في التقييم لا يطابق فني الطلب %', NEW.order_id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rating_order
    BEFORE INSERT OR UPDATE ON ratings
    FOR EACH ROW EXECUTE FUNCTION check_rating_order();

-- يضمن أن خدمة الطلب هي خدمة الفني
CREATE FUNCTION check_order_service() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM technicians
                   WHERE id = NEW.technician_id AND service_id = NEW.service_id) THEN
        RAISE EXCEPTION 'الفني % لا يقدّم هذه الخدمة', NEW.technician_id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_service
    BEFORE INSERT OR UPDATE OF technician_id, service_id ON orders
    FOR EACH ROW EXECUTE FUNCTION check_order_service();

-- ---------------------------------------------------------------------
-- عرض متوسطات الفنيين (تستخدمه قائمة الفنيين في كل قسم)
-- ---------------------------------------------------------------------
CREATE VIEW technician_scores AS
SELECT  t.id              AS technician_id,
        t.name,
        t.whatsapp,
        s.code            AS service_code,
        s.name_ar         AS service_name,
        ROUND(AVG(r.cost_score),    2) AS avg_cost,
        ROUND(AVG(r.quality_score), 2) AS avg_quality,
        ROUND(AVG(r.speed_score),   2) AS avg_speed,
        COUNT(r.id)                    AS ratings_count
FROM technicians t
JOIN services s       ON s.id = t.service_id
LEFT JOIN ratings r   ON r.technician_id = t.id
WHERE t.is_active AND s.is_active
GROUP BY t.id, s.id;

-- ---------------------------------------------------------------------
-- بيانات المرحلة الأولى: الخدمات الأربع
-- ---------------------------------------------------------------------
INSERT INTO services (code, name_ar, description, sort_order) VALUES
    ('ac',    'التكييف',  'تركيب، تنظيف، تعبئة غاز',    1),
    ('plumb', 'السباكة',  'تسريبات، خلاطات، سخانات',     2),
    ('elec',  'الكهرباء', 'أعطال، إنارة، لوحات توزيع',  3),
    ('carp',  'النجارة',  'أبواب، خزائن، تفصيل',        4);

-- =====================================================================
-- استعلامات التشغيل الأساسية
-- =====================================================================

-- (أ) قائمة فنيي قسم معيّن — الترتيب الافتراضي حسب متوسط تقييم التكلفة تنازلياً
--     (للترتيب حسب الجودة أو السرعة استبدل avg_cost بـ avg_quality أو avg_speed)
-- SELECT * FROM technician_scores
--  WHERE service_code = 'ac'
--  ORDER BY avg_cost DESC NULLS LAST, ratings_count DESC;

-- (ب) تسجيل/دخول العميل برقم واتساب
-- INSERT INTO customers (whatsapp, name, last_login_at) VALUES ('55123456', NULL, now())
-- ON CONFLICT (whatsapp) DO UPDATE SET last_login_at = now(),
--        name = COALESCE(EXCLUDED.name, customers.name)
-- RETURNING id;

-- (ج) إنشاء طلب «قيد الاتفاق» عند الضغط على تواصل عبر واتساب
-- INSERT INTO orders (customer_id, technician_id, service_id)
-- SELECT :customer_id, t.id, t.service_id FROM technicians t WHERE t.id = :technician_id
-- RETURNING id;

-- (د) إغلاق الطلب وتقييمه (في معاملة واحدة)
-- BEGIN;
-- UPDATE orders SET status = 'completed', cost_qar = :cost, completed_at = now()
--  WHERE id = :order_id AND customer_id = :customer_id AND status = 'pending';
-- INSERT INTO ratings (order_id, technician_id, cost_score, quality_score, speed_score)
-- SELECT id, technician_id, :cost_score, :quality_score, :speed_score FROM orders WHERE id = :order_id;
-- COMMIT;
