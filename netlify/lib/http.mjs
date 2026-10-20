// أدوات مشتركة: الردود، الأخطاء، ورموز الجلسات الموقّعة (بدون جدول جلسات)
import { createHmac, timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "بيانات الطلب غير صالحة."); }
}

/* ---------- signed tokens ----------
   token = base64url(payload JSON) + "." + HMAC-SHA256(payload, SESSION_SECRET)
   payload = { r: "customer" | "admin", id?: customerId, exp: unix ms } */
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) throw new HttpError(500, "متغير SESSION_SECRET غير مضبوط في إعدادات Netlify.");
  return s;
}
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (data) => createHmac("sha256", secret()).update(data).digest("base64url");

export function issueToken(payload, days) {
  const data = b64(JSON.stringify({ ...payload, exp: Date.now() + days * 864e5 }));
  return data + "." + sign(data);
}

export function readToken(req, role) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [data, sig] = tok.split(".");
  if (!data || !sig) throw new HttpError(401, "يلزم تسجيل الدخول.");
  const good = Buffer.from(sign(data)), got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) throw new HttpError(401, "انتهت الجلسة، سجّل الدخول من جديد.");
  let p; try { p = JSON.parse(Buffer.from(data, "base64url").toString()); } catch { throw new HttpError(401, "جلسة غير صالحة."); }
  if (p.r !== role || !(p.exp > Date.now())) throw new HttpError(401, "انتهت الجلسة، سجّل الدخول من جديد.");
  return p;
}

export function checkAdminPassword(pw) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) throw new HttpError(500, "متغير ADMIN_PASSWORD غير مضبوط في إعدادات Netlify.");
  const a = createHmac("sha256", "cmp").update(String(pw || "")).digest();
  const b = createHmac("sha256", "cmp").update(real).digest();
  return timingSafeEqual(a, b);
}

/* ---------- validation ---------- */
export const isQatarMobile = (p) => /^[3567]\d{7}$/.test(String(p || ""));
export const score = (v, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpError(400, `تقييم ${label} يجب أن يكون من 1 إلى 5.`);
  return n;
};

/* Postgres error code (the driver wraps the pg error in `cause`) */
export const pgCode = (e) => e?.code || e?.cause?.code;

/* Map Postgres errors to readable Arabic messages */
export function pgError(e) {
  if (e instanceof HttpError) return e;
  switch (pgCode(e)) {
    case "23505": return new HttpError(409, "هذا السجل موجود مسبقاً.");
    case "23503": return new HttpError(409, "لا يمكن الحذف لوجود طلبات مرتبطة. أوقفه بدلاً من الحذف.");
    case "23514": return new HttpError(400, "بيانات غير صحيحة.");
    case "P0001": return new HttpError(400, e.cause?.message || e.message);
    default: console.error(e); return new HttpError(500, "حدث خطأ في الخادم.");
  }
}
