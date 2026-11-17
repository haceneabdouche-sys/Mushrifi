#!/usr/bin/env node

const API = (process.env.MUSHRIFI_LICENSE_API || "https://mushrifi-license-server.hacene47211.workers.dev").replace(/\/+$/, "");
const TOKEN = process.env.MUSHRIFI_ADMIN_API_TOKEN || "";

function usage() {
  console.log(`إدارة تراخيص مُشرِفي — لا تحفظ رمز المسؤول داخل الملفات.

المتغيرات المطلوبة:
  MUSHRIFI_ADMIN_API_TOKEN   رمز المسؤول من أسرار Cloudflare
  MUSHRIFI_LICENSE_API       عنوان خادم التراخيص (اختياري)

الأوامر:
  node scripts/admin.mjs issue annual [days]   إصدار ترخيص سنوي (365 يوماً افتراضياً)
  node scripts/admin.mjs issue trial [days]    إصدار تجربة (30 يوماً افتراضياً)
  node scripts/admin.mjs issue perpetual       إصدار ترخيص دائم
  node scripts/admin.mjs list                  عرض التراخيص والأجهزة
  node scripts/admin.mjs suspend <license-id>  تعليق ترخيص
  node scripts/admin.mjs renew <license-id> [days] تجديد ترخيص (365 يوماً افتراضياً)
  node scripts/admin.mjs help                  عرض المساعدة

يظهر رمز التفعيل مرة واحدة عند الإصدار؛ انسخه واحفظه في مكان آمن.
لا ترسل رمز المسؤول أو مفتاح توقيع التراخيص إلى أي شخص.`);
}

async function request(path, method = "GET", body) {
  if (!TOKEN) throw new Error("عيّن MUSHRIFI_ADMIN_API_TOKEN في متغيرات البيئة؛ لا تضعه في هذا الملف.");
  const response = await fetch(API + path, {
    method,
    headers: {
      authorization: "Bearer " + TOKEN,
      ...(body ? { "content-type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("استجابة الخادم ليست JSON صالحة (HTTP " + response.status + ")."); }
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.error || "رفض الخادم الطلب") + " (HTTP " + response.status + ").");
  }
  return data;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "issue") {
    const type = args[0] || "annual";
    if (!["annual", "trial", "perpetual"].includes(type)) throw new Error("نوع الترخيص يجب أن يكون annual أو trial أو perpetual.");
    const body = { licenseType: type };
    if (type !== "perpetual" && args[1] !== undefined) {
      const days = Number(args[1]);
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("عدد الأيام يجب أن يكون عدداً صحيحاً بين 1 و3650.");
      body.durationDays = days;
    }
    const result = await request("/v1/admin/licenses", "POST", body);
    console.log("تم إصدار الترخيص.");
    console.log("معرّف الترخيص: " + result.licenseId);
    console.log("النوع: " + result.licenseType);
    console.log("الانتهاء: " + (result.expiresAt ? new Date(result.expiresAt).toISOString() : "دائم"));
    console.log("\nرمز التفعيل — يظهر مرة واحدة فقط:");
    console.log(result.activationCode);
    console.log("\nاحفظ الرمز بأمان. لا يمكن استرجاعه من الخادم بعد هذه المرة.");
    return;
  }

  if (command === "list") {
    const result = await request("/v1/admin/licenses");
    console.log(JSON.stringify(result.licenses || [], null, 2));
    return;
  }

  if (command === "suspend") {
    const id = args[0];
    if (!id) throw new Error("أدخل معرّف الترخيص المراد تعليقه.");
    const result = await request("/v1/admin/licenses/" + encodeURIComponent(id) + "/suspend", "POST", {});
    console.log("حالة الترخيص: " + result.status);
    return;
  }

  if (command === "renew") {
    const id = args[0];
    if (!id) throw new Error("أدخل معرّف الترخيص المراد تجديده.");
    const days = args[1] === undefined ? 365 : Number(args[1]);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("مدة التجديد يجب أن تكون بين 1 و3650 يوماً.");
    const result = await request("/v1/admin/licenses/" + encodeURIComponent(id) + "/renew", "POST", { durationDays: days });
    console.log("تم التجديد. تاريخ الانتهاء الجديد: " + new Date(result.expiresAt).toISOString());
    console.log(result.note || "");
    return;
  }

  usage();
  throw new Error("أمر غير معروف: " + command);
}

main().catch(error => {
  console.error("خطأ: " + (error?.message || "تعذر تنفيذ الأمر"));
  process.exitCode = 1;
});
