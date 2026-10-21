// واجهة API لمنصة إنجاز — دالة واحدة تخدم كل المسارات تحت /api/
import { getDatabase } from "@netlify/database";
import {
  HttpError, json, body, issueToken, readToken, checkAdminPassword,
  isQatarMobile, score, pgError, pgCode, env,
} from "../lib/http.mjs";

export const config = { path: "/api/*" };

let _db;
const db = () => (_db ??= getDatabase());
const num = (v) => (v == null ? null : Number(v));

const SORTS = { cost: "avg_cost", quality: "avg_quality", speed: "avg_speed" };

/* ================= public ================= */

async function listServices() {
  return db().sql`
    SELECT id, code, name_ar, description
      FROM services WHERE is_active ORDER BY sort_order, id`;
}

async function listTechnicians(url) {
  const code = url.searchParams.get("service") || "";
  const sort = SORTS[url.searchParams.get("sort")] || SORTS.cost; // الافتراضي: التكلفة تنازلياً
  // عمود الترتيب من قائمة ثابتة؛ القيمة المدخلة تمر كمعامل
  const rows = await db().sql.unsafe(
    `SELECT technician_id, name, whatsapp, service_code, service_name,
            avg_cost, avg_quality, avg_speed, ratings_count
       FROM technician_scores
      WHERE service_code = $1
      ORDER BY ${sort} DESC NULLS LAST, ratings_count DESC, technician_id`,
    [code]
  );
  return rows.map((r) => ({
    id: String(r.technician_id), name: r.name, whatsapp: r.whatsapp,
    service: r.service_code, serviceName: r.service_name,
    avgCost: num(r.avg_cost), avgQuality: num(r.avg_quality), avgSpeed: num(r.avg_speed),
    ratings: Number(r.ratings_count),
  }));
}

async function login(req) {
  const { whatsapp, name, remember } = await body(req);
  if (!isQatarMobile(whatsapp)) throw new HttpError(400, "رقم واتساب غير صحيح. يجب أن يكون 8 أرقام ويبدأ بـ 3 أو 5 أو 6 أو 7.");
  const clean = String(name || "").trim().slice(0, 100) || null;
  const [c] = await db().sql`
    INSERT INTO customers (whatsapp, name, last_login_at)
    VALUES (${whatsapp}, ${clean}, now())
    ON CONFLICT (whatsapp) DO UPDATE
       SET last_login_at = now(), name = COALESCE(EXCLUDED.name, customers.name)
    RETURNING id, whatsapp, name`;
  // «تذكرني»: جلسة 90 يوماً، وإلا يوم واحد (والواجهة تحفظ الرمز في الجلسة الحالية فقط)
  return {
    token: issueToken({ r: "customer", id: String(c.id) }, remember ? 90 : 1),
    customer: { id: String(c.id), whatsapp: c.whatsapp, name: c.name },
  };
}

/* ================= customer ================= */

async function myOrders(cid) {
  const rows = await db().sql`
    SELECT o.id, o.status, o.cost_qar, o.created_at, o.completed_at,
           t.id AS technician_id, t.name AS technician_name, t.whatsapp AS technician_whatsapp,
           s.code AS service_code, s.name_ar AS service_name,
           (r.id IS NOT NULL) AS rated
      FROM orders o
      JOIN technicians t ON t.id = o.technician_id
      JOIN services s    ON s.id = o.service_id
 LEFT JOIN ratings r     ON r.order_id = o.id
     WHERE o.customer_id = ${cid}
  ORDER BY o.created_at DESC
     LIMIT 100`;
  return rows.map((o) => ({
    id: String(o.id), status: o.status, cost: num(o.cost_qar),
    createdAt: o.created_at, completedAt: o.completed_at,
    technician: { id: String(o.technician_id), name: o.technician_name, whatsapp: o.technician_whatsapp },
    service: o.service_code, serviceName: o.service_name, rated: o.rated,
  }));
}

async function createOrder(req, cid) {
  const { technicianId } = await body(req);
  const rows = await db().sql`
    INSERT INTO orders (customer_id, technician_id, service_id)
    SELECT ${cid}, t.id, t.service_id
      FROM technicians t JOIN services s ON s.id = t.service_id
     WHERE t.id = ${technicianId} AND t.is_active AND s.is_active
    RETURNING id, status, created_at`;
  if (!rows.length) throw new HttpError(404, "الفني غير متاح.");
  return { id: String(rows[0].id), status: rows[0].status, createdAt: rows[0].created_at };
}

async function completeOrder(req, cid, orderId) {
  const b = await body(req);
  const cost = Number(b.cost);
  if (!Number.isFinite(cost) || cost < 0) throw new HttpError(400, "اكتب التكلفة بالريال.");
  const c = score(b.costScore, "التكلفة"), q = score(b.qualityScore, "الجودة"), s = score(b.speedScore, "سرعة الاستجابة");

  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const u = await client.query(
      `UPDATE orders SET status = 'completed', cost_qar = $1, completed_at = now()
        WHERE id = $2 AND customer_id = $3 AND status = 'pending'
        RETURNING technician_id`,
      [cost, orderId, cid]
    );
    if (!u.rowCount) throw new HttpError(404, "الطلب غير موجود أو أُغلق مسبقاً.");
    await client.query(
      `INSERT INTO ratings (order_id, technician_id, cost_score, quality_score, speed_score)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, u.rows[0].technician_id, c, q, s]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { ok: true };
}

/* ================= admin ================= */

async function adminLogin(req) {
  const { password } = await body(req);
  if (!checkAdminPassword(password)) throw new HttpError(401, "كلمة المرور غير صحيحة.");
  return { token: issueToken({ r: "admin" }, 1) };
}

async function adminSummary() {
  const [r] = await db().sql`
    SELECT (SELECT count(*) FROM services WHERE is_active)          AS services,
           (SELECT count(*) FROM technicians WHERE is_active)       AS technicians,
           (SELECT count(*) FROM customers)                         AS customers,
           (SELECT count(*) FROM orders WHERE status = 'pending')   AS pending,
           (SELECT count(*) FROM ratings)                           AS ratings`;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

const adminLists = {
  services: () => db().sql`
    SELECT s.id, s.code, s.name_ar, s.description, s.sort_order, s.is_active,
           (SELECT count(*) FROM technicians t WHERE t.service_id = s.id)::int AS technicians
      FROM services s ORDER BY s.sort_order, s.id`,
  technicians: () => db().sql`
    SELECT t.id, t.name, t.whatsapp, t.is_active, t.created_at, s.id AS service_id, s.name_ar AS service_name,
           ROUND(AVG(r.cost_score),1)::float AS avg_cost, ROUND(AVG(r.quality_score),1)::float AS avg_quality,
           ROUND(AVG(r.speed_score),1)::float AS avg_speed, COUNT(r.id)::int AS ratings,
           (SELECT count(*) FROM orders o WHERE o.technician_id = t.id)::int AS orders
      FROM technicians t JOIN services s ON s.id = t.service_id
 LEFT JOIN ratings r ON r.technician_id = t.id
  GROUP BY t.id, s.id ORDER BY s.sort_order, t.name`,
  customers: () => db().sql`
    SELECT c.id, c.whatsapp, c.name, c.created_at, c.last_login_at,
           (SELECT count(*) FROM orders o WHERE o.customer_id = c.id)::int AS orders
      FROM customers c ORDER BY c.last_login_at DESC NULLS LAST LIMIT 500`,
  orders: () => db().sql`
    SELECT o.id, o.status, o.cost_qar::float AS cost, o.created_at, o.completed_at,
           c.whatsapp AS customer_whatsapp, c.name AS customer_name,
           t.name AS technician_name, s.name_ar AS service_name
      FROM orders o JOIN customers c ON c.id = o.customer_id
      JOIN technicians t ON t.id = o.technician_id JOIN services s ON s.id = o.service_id
  ORDER BY o.created_at DESC LIMIT 500`,
  ratings: () => db().sql`
    SELECT r.id, r.cost_score, r.quality_score, r.speed_score, r.created_at,
           t.name AS technician_name, s.name_ar AS service_name, c.whatsapp AS customer_whatsapp
      FROM ratings r JOIN orders o ON o.id = r.order_id
      JOIN technicians t ON t.id = r.technician_id JOIN services s ON s.id = o.service_id
      JOIN customers c ON c.id = o.customer_id
  ORDER BY r.created_at DESC LIMIT 500`,
};

async function addTechnician(req) {
  const { name, serviceId, whatsapp } = await body(req);
  const n = String(name || "").trim();
  if (!n) throw new HttpError(400, "اكتب اسم الفني.");
  if (!isQatarMobile(whatsapp)) throw new HttpError(400, "رقم واتساب غير صحيح. 8 أرقام تبدأ بـ 3 أو 5 أو 6 أو 7.");
  try {
    const [t] = await db().sql`
      INSERT INTO technicians (service_id, name, whatsapp)
      VALUES (${serviceId}, ${n.slice(0, 100)}, ${whatsapp}) RETURNING id`;
    return { id: String(t.id) };
  } catch (e) {
    if (pgCode(e) === "23505") throw new HttpError(409, "هذا الرقم مسجّل في نفس الخدمة.");
    if (pgCode(e) === "23503") throw new HttpError(400, "الخدمة غير موجودة.");
    throw e;
  }
}

async function setActive(table, id, req) {
  const { isActive } = await body(req);
  const rows = table === "services"
    ? await db().sql`UPDATE services SET is_active = ${!!isActive} WHERE id = ${id} RETURNING id`
    : await db().sql`UPDATE technicians SET is_active = ${!!isActive} WHERE id = ${id} RETURNING id`;
  if (!rows.length) throw new HttpError(404, "السجل غير موجود.");
  return { ok: true };
}

async function deleteTechnician(id) {
  const rows = await db().sql`DELETE FROM technicians WHERE id = ${id} RETURNING id`;
  if (!rows.length) throw new HttpError(404, "الفني غير موجود.");
  return { ok: true };
}

/* ================= health check ================= */
// يعرض فقط هل المتغيرات موجودة (نعم/لا) دون كشف قيمها، وهل قاعدة البيانات متصلة
async function health() {
  const pw = env("ADMIN_PASSWORD") || "", ss = env("SESSION_SECRET") || "";
  const out = {
    ADMIN_PASSWORD: !!pw,
    ADMIN_PASSWORD_length: pw.length,                       // الطول فقط، للتأكد من عدم وجود حروف زائدة
    ADMIN_PASSWORD_nonLatin: /[^\x20-\x7E]/.test(pw),        // هل فيها حروف عربية أو رموز غير لاتينية
    SESSION_SECRET: ss.length >= 24,
    SESSION_SECRET_length: ss.length,                       // يجب أن يكون 24 أو أكثر
    database: false,
    deployContext: process.env.CONTEXT || null,
  };
  try { const [r] = await db().sql`SELECT count(*)::int AS n FROM services`; out.database = true; out.services = r.n; }
  catch (e) { out.databaseError = String(e?.cause?.message || e?.message || e).slice(0, 160); }
  return out;
}

/* ================= router ================= */

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const m = req.method;
  const id = (i) => { const v = parts[i]; if (!/^\d+$/.test(v || "")) throw new HttpError(400, "معرّف غير صالح."); return v; };

  try {
    const [a, b, c] = parts;

    // public
    if (m === "GET"  && a === "health")            return json(await health());
    if (m === "GET"  && a === "services" && !b)    return json(await listServices());
    if (m === "GET"  && a === "technicians" && !b) return json(await listTechnicians(url));
    if (m === "POST" && a === "login")             return json(await login(req));

    // customer
    if (a === "me" && b === "orders" && m === "GET") return json(await myOrders(readToken(req, "customer").id));
    if (a === "orders" && !b && m === "POST")       return json(await createOrder(req, readToken(req, "customer").id), 201);
    if (a === "orders" && c === "complete" && m === "POST")
      return json(await completeOrder(req, readToken(req, "customer").id, id(1)));

    // admin
    if (a === "admin") {
      if (b === "login" && m === "POST") return json(await adminLogin(req));
      readToken(req, "admin");
      if (b === "summary" && m === "GET") return json(await adminSummary());
      if (adminLists[b] && !c && m === "GET") return json(await adminLists[b]());
      if (b === "technicians" && !c && m === "POST") return json(await addTechnician(req), 201);
      if ((b === "technicians" || b === "services") && c && m === "PATCH") return json(await setActive(b, id(2), req));
      if (b === "technicians" && c && m === "DELETE") return json(await deleteTechnician(id(2)));
    }
    throw new HttpError(404, "المسار غير موجود.");
  } catch (e) {
    const err = pgError(e);
    return json({ error: err.message }, err.status || 500);
  }
};
