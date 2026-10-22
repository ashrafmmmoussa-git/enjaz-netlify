/* تقييم بالنجوم الخمس — مشترك بين منصة إنجاز ولوحة الإدارة
   1 = لا أوافق بشدة … 5 = أوافق بشدة */
const STAR_LABELS = ["", "لا أوافق بشدة", "لا أوافق", "محايد", "أوافق", "أوافق بشدة"];
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.1l-5.62 2.96 1.07-6.27L2.9 9.4l6.3-.9z"/></svg>';

/* HTML for one picker; `name` must be unique on the page */
function starPicker(name, legend, hint) {
  const opts = [1, 2, 3, 4, 5].map((v) =>
    `<input type="radio" name="${name}" id="${name}-${v}" value="${v}"><label for="${name}-${v}" title="${v} — ${STAR_LABELS[v]}" aria-label="${v} من 5، ${STAR_LABELS[v]}">${STAR_SVG}</label>`
  ).join("");
  return `<fieldset class="star-field">
    <legend class="q">${legend}${hint ? ` <span class="hint">(${hint})</span>` : ""}</legend>
    <div class="star-row"><div class="stars" data-stars="${name}">${opts}</div><span class="star-text" id="${name}-text">اختر من 1 إلى 5 نجوم</span></div>
  </fieldset>`;
}

function paintStars(group, value) {
  group.querySelectorAll("label").forEach((l, i) => l.classList.toggle("on", i < value));
}
function checkedStars(name) {
  const x = document.querySelector(`input[name="${name}"]:checked`);
  return x ? +x.value : 0;
}
function setStars(name, value) {
  const group = document.querySelector(`[data-stars="${name}"]`); if (!group) return;
  group.querySelectorAll("input").forEach((i) => (i.checked = +i.value === value));
  paintStars(group, value);
  const t = document.getElementById(name + "-text");
  if (t) t.textContent = value ? `${value} من 5 · ${STAR_LABELS[value]}` : "اختر من 1 إلى 5 نجوم";
}
/* Wire hover preview and selection for every picker inside `root` (call once after inserting the HTML) */
function bindStars(root) {
  root.querySelectorAll("[data-stars]").forEach((group) => {
    const name = group.dataset.stars;
    group.addEventListener("change", () => setStars(name, checkedStars(name)));
    group.querySelectorAll("label").forEach((l, i) =>
      l.addEventListener("mouseenter", () => paintStars(group, i + 1)));
    group.addEventListener("mouseleave", () => paintStars(group, checkedStars(name)));
  });
}
/* Read-only stars for tables and lists: "★★★★☆" style with a filled fraction */
function starsInline(value) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return `<span class="stars-inline" aria-label="${v} من 5"><span style="width:${(v / 5) * 100}%"></span></span>`;
}
