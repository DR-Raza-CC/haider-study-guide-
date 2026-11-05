// Haider Study Guide — API (Cloudflare Pages Function)
// Needs one KV namespace bound to this Pages project with the variable name STUDY.

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (msg, s = 400) => json({ error: msg }, s);
const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));

const PIN_RE = /^\d{4,6}$/;
const cleanName = (s) => String(s || "").trim().replace(/\s+/g, " ").slice(0, 30);
const cleanCode = (s) => String(s || "").trim().toLowerCase();

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 1000, hash: "SHA-256" }, key, 256);
  return b64u(bits);
}
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const getFam = (env) => env.STUDY.get("family", "json");
const putFam = (env, fam) => env.STUDY.put("family", JSON.stringify(fam));
const getProg = async (env, id) => (await env.STUDY.get("progress:" + id, "json")) || blankProgress();
const putProg = (env, id, p) => env.STUDY.put("progress:" + id, JSON.stringify(p));
function blankProgress() { return { subs: [], start: null, profileAt: 0, done: {}, log: [], epoch: 0, lastActive: 0 }; }

async function makeToken(fam, payload) {
  const body = b64u(enc.encode(JSON.stringify({ ...payload, exp: Date.now() + 120 * 864e5 })));
  return body + "." + (await hmac(fam.secret, body));
}
async function readToken(fam, request) {
  const t = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [body, sig] = t.split(".");
  if (!fam || !body || !sig || (await hmac(fam.secret, body)) !== sig) return null;
  let p;
  try { p = JSON.parse(dec.decode(unb64u(body))); } catch { return null; }
  if (!p || p.exp < Date.now()) return null;
  if (p.r === "parent") return p.pv === fam.parentPv ? p : null;
  const c = fam.children.find((x) => x.id === p.c);
  return c && c.pv === p.pv ? { ...p, child: c } : null;
}

// Slow down PIN guessing: 10 wrong tries per 15 minutes from one address.
async function tooMany(env, request) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const n = parseInt((await env.STUDY.get("fail:" + ip)) || "0", 10);
  return n >= 10;
}
async function noteFail(env, request) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const n = parseInt((await env.STUDY.get("fail:" + ip)) || "0", 10);
  await env.STUDY.put("fail:" + ip, String(n + 1), { expirationTtl: 900 });
}

// Combine what is stored with what a device sends, so nothing is lost
// when the student and parent change things on different devices.
function merge(a, b) {
  a = a || blankProgress(); b = b || {};
  if ((b.epoch || 0) < (a.epoch || 0)) return a; // a parent reset happened; ignore old device data
  const out = blankProgress();
  out.epoch = a.epoch || 0;
  const prof = (b.profileAt || 0) > (a.profileAt || 0) ? b : a;
  out.subs = Array.isArray(prof.subs) ? prof.subs.slice(0, 20).map(String) : [];
  out.start = prof.start || a.start || b.start || null;
  out.profileAt = Math.max(a.profileAt || 0, b.profileAt || 0);
  const seen = new Set();
  for (const l of [...(a.log || []), ...(Array.isArray(b.log) ? b.log : [])]) {
    if (!l || typeof l !== "object") continue;
    const id = String(l.id || `${l.d}|${l.k}|${l.s}|${l.m}|${l.ts}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.log.push({ id, d: String(l.d || "").slice(0, 10), s: +l.s || 0, t: +l.t || 0, k: String(l.k || "").slice(0, 40), m: +l.m || 0, ts: +l.ts || 0 });
  }
  out.log.sort((x, y) => x.ts - y.ts);
  if (out.log.length > 3000) out.log = out.log.slice(-3000);
  out.done = { ...(a.done || {}) };
  const bd = b.done && typeof b.done === "object" ? b.done : {};
  for (const k of Object.keys(bd).slice(0, 500)) {
    const y = bd[k], x = out.done[k];
    if (!y || typeof y !== "object") continue;
    const clean = { s: +y.s || 0, t: +y.t || 10, b: !!y.b, d: String(y.d || "").slice(0, 10), m: +y.m || 0 };
    if (!x || clean.s > x.s || (clean.s === x.s && clean.b && !x.b)) out.done[k] = clean;
  }
  out.lastActive = Math.max(a.lastActive || 0, Math.min(+b.lastActive || 0, Date.now()));
  return out;
}

export async function onRequest({ request, env, params }) {
  if (!env.STUDY) return fail("The storage isn't connected yet. In Cloudflare, add a KV binding called STUDY to this project, then redeploy.", 500);
  const path = (params.path || []).join("/");
  const method = request.method;
  let body = {};
  if (method !== "GET" && method !== "DELETE") { try { body = await request.json(); } catch { body = {}; } }
  const fam = await getFam(env);

  // ---------- open routes ----------
  if (path === "status" && method === "GET") return json({ setup: !!fam });

  if (path === "setup" && method === "POST") {
    if (fam) return fail("This app has already been set up.", 409);
    const code = cleanCode(body.code), name = cleanName(body.childName);
    if (code.length < 6) return fail("The family code needs at least 6 characters.");
    if (!PIN_RE.test(body.parentPin || "") || !PIN_RE.test(body.childPin || "")) return fail("PINs must be 4 to 6 digits.");
    if (!name) return fail("Please enter the child's name.");
    const salt = rand(12), cs = rand(12);
    const f = {
      code, salt, parentHash: await hashPin(body.parentPin, salt), parentPv: 1, secret: rand(32), created: Date.now(),
      children: [{ id: rand(6), name, salt: cs, hash: await hashPin(body.childPin, cs), pv: 1 }],
    };
    await putFam(env, f);
    return json({ token: await makeToken(f, { r: "parent", pv: 1 }), role: "parent" });
  }

  if (path === "children" && method === "POST") {
    if (!fam) return fail("This app hasn't been set up yet.", 404);
    if (await tooMany(env, request)) return fail("Too many wrong tries. Please wait 15 minutes.", 429);
    if (cleanCode(body.code) !== fam.code) { await noteFail(env, request); return fail("That family code isn't right.", 401); }
    return json({ children: fam.children.map((c) => ({ id: c.id, name: c.name })) });
  }

  if (path === "login" && method === "POST") {
    if (!fam) return fail("This app hasn't been set up yet.", 404);
    if (await tooMany(env, request)) return fail("Too many wrong tries. Please wait 15 minutes.", 429);
    if (cleanCode(body.code) !== fam.code) { await noteFail(env, request); return fail("That family code isn't right.", 401); }
    const pin = String(body.pin || "");
    if (body.role === "parent") {
      if ((await hashPin(pin, fam.salt)) !== fam.parentHash) { await noteFail(env, request); return fail("That PIN isn't right.", 401); }
      return json({ token: await makeToken(fam, { r: "parent", pv: fam.parentPv }), role: "parent" });
    }
    const c = fam.children.find((x) => x.id === body.childId);
    if (!c) return fail("Please pick your name.", 400);
    if ((await hashPin(pin, c.salt)) !== c.hash) { await noteFail(env, request); return fail("That PIN isn't right.", 401); }
    return json({ token: await makeToken(fam, { r: "student", c: c.id, pv: c.pv }), role: "student", childId: c.id, name: c.name });
  }

  // ---------- signed-in routes ----------
  const who = await readToken(fam, request);
  if (!who) return fail("Please sign in again.", 401);

  if (who.r === "student") {
    const id = who.child.id;
    if (path === "me" && method === "GET") return json({ name: who.child.name, childId: id, state: await getProg(env, id) });
    if (path === "progress" && method === "PUT") {
      const merged = merge(await getProg(env, id), body.state);
      await putProg(env, id, merged);
      return json({ state: merged });
    }
    return fail("Not found.", 404);
  }

  // parent
  if (path === "family" && method === "GET") {
    const children = await Promise.all(fam.children.map(async (c) => ({ id: c.id, name: c.name, state: await getProg(env, c.id) })));
    return json({ children });
  }
  if (path === "child" && method === "POST") {
    const name = cleanName(body.name);
    if (!name) return fail("Please enter the child's name.");
    if (!PIN_RE.test(body.pin || "")) return fail("The PIN must be 4 to 6 digits.");
    if (fam.children.length >= 8) return fail("You can add up to 8 children.");
    const s = rand(12);
    fam.children.push({ id: rand(6), name, salt: s, hash: await hashPin(body.pin, s), pv: 1 });
    await putFam(env, fam);
    return json({ ok: true });
  }
  if (path === "parent" && method === "PATCH") {
    if (body.pin) {
      if (!PIN_RE.test(body.pin)) return fail("The PIN must be 4 to 6 digits.");
      fam.salt = rand(12); fam.parentHash = await hashPin(body.pin, fam.salt); fam.parentPv++;
    }
    if (body.code) {
      const code = cleanCode(body.code);
      if (code.length < 6) return fail("The family code needs at least 6 characters.");
      fam.code = code;
    }
    await putFam(env, fam);
    return json({ token: await makeToken(fam, { r: "parent", pv: fam.parentPv }) });
  }
  const m = path.match(/^child\/([\w-]+)$/);
  if (m) {
    const c = fam.children.find((x) => x.id === m[1]);
    if (!c) return fail("That child wasn't found.", 404);
    if (method === "DELETE") {
      fam.children = fam.children.filter((x) => x.id !== c.id);
      await putFam(env, fam);
      await env.STUDY.delete("progress:" + c.id);
      return json({ ok: true });
    }
    if (method === "PATCH") {
      let famChanged = false;
      if (body.name) { const n = cleanName(body.name); if (n) { c.name = n; famChanged = true; } }
      if (body.pin) {
        if (!PIN_RE.test(body.pin)) return fail("The PIN must be 4 to 6 digits.");
        c.salt = rand(12); c.hash = await hashPin(body.pin, c.salt); c.pv++; famChanged = true;
      }
      if (famChanged) await putFam(env, fam);
      let p = await getProg(env, c.id);
      if (body.reset) {
        p = { ...blankProgress(), subs: p.subs, start: new Date().toISOString().slice(0, 10), profileAt: Date.now(), epoch: (p.epoch || 0) + 1 };
      }
      if (Array.isArray(body.subs)) { p.subs = body.subs.slice(0, 20).map(String); p.profileAt = Date.now(); if (!p.start) p.start = new Date().toISOString().slice(0, 10); }
      if (body.unlockWeek && p.start) {
        const d = new Date(p.start + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 7);
        p.start = d.toISOString().slice(0, 10); p.profileAt = Date.now();
      }
      await putProg(env, c.id, p);
      return json({ ok: true, state: p });
    }
  }
  return fail("Not found.", 404);
}
