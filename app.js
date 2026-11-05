/* Haider Study Guide — student and parent app. Content lives in data.js. */
const SUBJECTS = window.SUBJECTS;
const SUB = Object.fromEntries(SUBJECTS.map((s) => [s.id, s]));
const WEEKS_N = 4, TOPIC_QS = 10;
const GROUP_MAX = { maths: 1, re: 2 };

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const dkey = (d) => d.toLocaleDateString("en-CA");
const today = () => dkey(new Date());
const parse = (k) => new Date(k + "T12:00");
const niceDate = (k) => parse(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const prep = (qs) => qs.map(([q, o, e]) => ({ q, e, ans: o[0], opts: shuffle(o) }));
const tkey = (s, w) => s + ":" + w;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function ago(ts) {
  if (!ts) return "Not started yet";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2) return "Active just now";
  if (m < 60) return `Active ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Active ${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `Active ${d} day${d === 1 ? "" : "s"} ago`;
}

/* ---------- progress maths (work on any child's progress object) ---------- */
const blankProgress = () => ({ subs: [], start: null, profileAt: 0, done: {}, log: [], epoch: 0, lastActive: 0 });
function mockLine() { if (!window.MOCK_DATE) return ""; const n = Math.ceil((parse(window.MOCK_DATE) - parse(today())) / 864e5); return n > 0 ? ` · ${n} day${n === 1 ? "" : "s"} to mocks` : n > -12 ? " · Mocks in progress, good luck!" : ""; }
function curWeek(p) { if (!p.start) return 1; return Math.min(WEEKS_N, Math.max(1, Math.floor((parse(today()) - parse(p.start)) / 864e5 / 7) + 1)); }
function nextUnlock(p) { const d = parse(p.start || today()); d.setDate(d.getDate() + 7 * curWeek(p)); return d; }
const testDays = (p) => new Set(p.log.map((l) => l.d));
function streak(p) { const days = testDays(p); let n = 0; const d = new Date(); if (!days.has(dkey(d))) d.setDate(d.getDate() - 1); while (days.has(dkey(d))) { n++; d.setDate(d.getDate() - 1); } return n; }
function bestStreak(p) { const days = [...testDays(p)].sort(); let best = 0, run = 0, prev = null; for (const k of days) { const t = parse(k); run = prev && (t - prev) / 864e5 < 1.5 ? run + 1 : 1; best = Math.max(best, run); prev = t; } return best; }
function available(p) { const out = []; const cw = curWeek(p); for (let w = 0; w < cw; w++) for (const s of p.subs) if (SUB[s]) out.push({ s, w }); return out; }
const nextTopic = (p) => available(p).find((x) => !p.done[tkey(x.s, x.w)]) || null;
function summary(p) {
  const subs = p.subs.filter((s) => SUB[s]);
  const mine = Object.entries(p.done).filter(([k]) => subs.includes(k.split(":")[0]));
  const wk = new Date(); wk.setDate(wk.getDate() - 6); const weekStart = dkey(wk);
  const weekLog = p.log.filter((l) => l.d >= weekStart);
  const f14 = new Date(); f14.setDate(f14.getDate() - 13); const d14 = dkey(f14);
  const bySub = subs.map((s) => { const rs = mine.filter(([k]) => k.split(":")[0] === s).map(([, r]) => r); return { s, n: rs.length, avg: rs.length ? Math.round(rs.reduce((a, r) => a + r.s / r.t, 0) / rs.length * 100) : null }; });
  const scored = bySub.filter((x) => x.avg !== null).sort((a, b) => a.avg - b.avg);
  return {
    subs, mine, weekLog, bySub,
    weekMins: weekLog.reduce((a, l) => a + (l.m || 0), 0),
    weakest: scored.length > 1 ? scored[0] : null,
    strongest: scored.length > 1 ? scored[scored.length - 1] : null,
    bonusN: mine.filter(([, r]) => r.b).length,
    avg: mine.length ? Math.round(mine.reduce((a, [, r]) => a + r.s / r.t, 0) / mine.length * 100) : null,
    active14: [...testDays(p)].filter((k) => k >= d14).length,
    total: subs.length * WEEKS_N,
    quick: p.log.filter((l) => l.k === "daily"),
  };
}

/* ---------- server ---------- */
const API = {
  async call(method, path, body) {
    const token = store.get("asg-session")?.token;
    let r;
    try {
      r = await fetch("/api/" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { const err = new Error("You seem to be offline. Check your internet and try again."); err.status = 0; throw err; }
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(d.error || "Something went wrong. Please try again."); err.status = r.status; throw err; }
    return d;
  },
};

/* ---------- app state ---------- */
let session = store.get("asg-session"); // {token, role, childId, name}
let state = blankProgress();            // the signed-in student's progress
let family = null;                      // parent: {children:[{id,name,state}]}
let view = { name: "loading" };
let startedAt = Date.now();
let pushing = false, pushAgain = false;
const app = $("app"), main = $("main"), sub = $("sub"), bar = $("bar");

function go(v) { const prev = view.name; view = v; render(); if (v.name === "home" && prev !== "home" && prev !== "loading" && session?.role === "student") refreshStudent(); }
function setSub(html, handlers = {}) { sub.innerHTML = html; for (const id in handlers) { const el = $(id); if (el) el.onclick = handlers[id]; } }
function showError(msg) { const el = $("err"); if (el) { el.textContent = msg; el.hidden = !msg; } }
function busy(on, label) { main.disabled = on; if (on && label) main.textContent = label; }

function logout() { store.del("asg-session"); session = null; family = null; state = blankProgress(); go({ name: "welcome" }); }

/* student saving: keep a local copy, send to the server, adopt the merged result */
function localKey() { return "asg-state-" + (session?.childId || "x"); }
function save() {
  state.lastActive = Date.now();
  store.set(localKey(), state);
  push();
}
async function push() {
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    const d = await API.call("PUT", "progress", { state });
    state = d.state; store.set(localKey(), state); store.del("asg-pending");
  } catch (e) {
    if (e.status === 401) { pushing = false; return logout(); }
    store.set("asg-pending", true);
  }
  pushing = false;
  if (pushAgain) { pushAgain = false; push(); }
}
window.addEventListener("online", () => { if (session?.role === "student" && store.get("asg-pending")) push(); });

async function refreshStudent() {
  if (pushing) return;
  if (store.get("asg-pending")) return push();
  try {
    const d = await API.call("GET", "me");
    const changed = JSON.stringify(d.state) !== JSON.stringify(state);
    state = d.state; session.name = d.name; store.set("asg-session", session); store.set(localKey(), state);
    if (changed && (view.name === "home" || view.name === "subjects")) render();
  } catch (e) { if (e.status === 401) logout(); }
}
async function loadFamily() {
  try { family = await API.call("GET", "family"); if (view.name === "pOverview" || view.name === "pChild") render(); }
  catch (e) { if (e.status === 401) logout(); else { family = family || { children: [] }; showError(e.message); } }
}

/* ---------- shared bits of markup ---------- */
function scoresSVG(p) {
  const tests = p.log.slice(-10);
  const W = 520, H = 160, L = 36, B = 22, T = 10, R = 6, n = 10, bw = (W - L - R) / n, y = (v) => T + (H - T - B) * (1 - v / 100);
  let g = "";
  [0, 50, 100].forEach((v) => { g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`; });
  for (let i = 0; i < n; i++) {
    const r = tests[i], x = L + i * bw + bw * 0.2, wd = bw * 0.6;
    if (r && r.t) { const pc = Math.round(r.s / r.t * 100), c = pc >= 80 ? "var(--good)" : pc >= 50 ? "var(--accent)" : "var(--bad)"; g += `<rect x="${x}" y="${y(pc)}" width="${wd}" height="${Math.max(2, y(0) - y(pc))}" rx="3" fill="${c}"><title>${pc}% on ${r.d}</title></rect>`; }
    else g += `<rect x="${x}" y="${y(0) - 3}" width="${wd}" height="3" rx="1.5" fill="var(--line)"/>`;
  }
  g += `<text x="${L}" y="${H - 5}">older</text><text x="${W - R}" y="${H - 5}" text-anchor="end">latest</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Last 10 test scores">${g}</svg>`;
}
function daysHTML(p) { const days = testDays(p), out = []; const d = new Date(); d.setDate(d.getDate() - 13); for (let i = 0; i < 14; i++) { const k = dkey(d); out.push(`<div class="day${days.has(k) ? " on" : ""}${k === today() ? " today" : ""}" title="${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}"></div>`); d.setDate(d.getDate() + 1); } return out.join(""); }
function subjectBars(p) {
  return p.subs.filter((s) => SUB[s]).map((s) => { const n = [0, 1, 2, 3].filter((w) => p.done[tkey(s, w)]).length; return `<div class="sbar"><span class="name">${esc(SUB[s].name)}</span><span class="track"><i style="width:${n / WEEKS_N * 100}%"></i></span><span class="n">${n}/${WEEKS_N}</span></div>`; }).join("") || `<p class="muted">No subjects chosen yet.</p>`;
}
function chipsHTML(sel) {
  const chip = (s, label) => `<label class="chip${sel.has(s.id) ? " on" : ""}" for="c-${s.id}"><input type="checkbox" id="c-${s.id}" value="${s.id}" data-group="${s.group || ""}" ${sel.has(s.id) ? "checked" : ""}>${esc(label)}</label>`;
  const maths = SUBJECTS.filter((s) => s.group === "maths"), re = SUBJECTS.filter((s) => s.id.startsWith("re-")), rest = SUBJECTS.filter((s) => s.group !== "maths" && !s.id.startsWith("re-"));
  let h = "";
  if (maths.length) h += `<h3>Maths level</h3><p class="note">Pick the tier you're sitting. You can only choose one.</p><div class="chips">${maths.map((s) => chip(s, s.level || s.name)).join("")}</div>`;
  if (re.length) h += `<h3>Religious Education</h3><p class="note">Pick the two religions you study, plus the themes.</p><div class="chips">${re.map((s) => chip(s, s.short || s.name.replace(/^RE: /, ""))).join("")}</div>`;
  return h + `${h ? "<h3>Other subjects</h3>" : ""}<div class="chips">${rest.map((s) => chip(s, s.name)).join("")}</div>`;
}
function wireChips(onChange) {
  app.querySelectorAll(".chip input").forEach((c) => (c.onchange = () => {
    if (c.checked && c.dataset.group) {
      const max = GROUP_MAX[c.dataset.group] || 1;
      const others = [...app.querySelectorAll(`.chip input[data-group="${c.dataset.group}"]`)].filter((o) => o !== c && o.checked);
      while (others.length >= max) others.shift().checked = false;
    }
    app.querySelectorAll(".chip").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
    onChange([...app.querySelectorAll(".chip input")].filter((x) => x.checked).map((x) => x.value));
  }));
}
const errBox = `<p class="error" id="err" role="alert" hidden></p>`;
function pinField(id, label, hint = "4 to 6 digits") { return `<label class="field" for="${id}">${label} <span class="hint">${hint}</span><input type="password" id="${id}" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></label>`; }

/* ---------- render ---------- */
function render() {
  sub.innerHTML = ""; main.disabled = false; bar.hidden = false;
  const v = view;
  const R = RENDER[v.name];
  if (R) R(v);
  const key = v.name + (v.mode || "") + (v.s || "") + (v.w ?? "") + (v.i ?? "") + (v.step || "") + (v.id || "");
  if (key !== render.last) { window.scrollTo(0, 0); render.last = key; }
}

const RENDER = {
  loading() {
    app.innerHTML = `<div class="center"><h1>Haider <span class="mark">Study Guide</span></h1><p class="muted">Loading…</p></div>`;
    bar.hidden = true;
  },

  /* ----- first run: the parent creates the family ----- */
  setupFamily(v) {
    app.innerHTML = `<div><div class="eyebrow">First-time setup · for the parent</div><h1>Set up your family</h1></div>
      <p class="muted">You only do this once. Children sign in with the family code and their own PIN. You sign in with the family code and your parent PIN.</p>
      <label class="field" for="code">Family code <span class="hint">At least 6 letters or numbers. Easy to remember, hard to guess.</span><input type="text" id="code" maxlength="30" autocomplete="off" placeholder="e.g. husain2026"></label>
      ${pinField("ppin", "Your parent PIN")}
      <div class="card"><h3>First child</h3>
        <label class="field" for="cname">Child's first name<input type="text" id="cname" maxlength="30" autocomplete="off" placeholder="e.g. Haider"></label>
        ${pinField("cpin", "Child's PIN")}
        <p class="note">You can add more children from your dashboard afterwards.</p></div>
      ${errBox}`;
    main.textContent = "Create family";
    main.onclick = async () => {
      showError("");
      busy(true, "Creating…");
      try {
        const d = await API.call("POST", "setup", { code: $("code").value, parentPin: $("ppin").value, childName: $("cname").value, childPin: $("cpin").value });
        store.set("asg-code", $("code").value.trim());
        session = { token: d.token, role: "parent" }; store.set("asg-session", session);
        go({ name: "pOverview" }); loadFamily();
      } catch (e) { showError(e.message); busy(false); main.textContent = "Create family"; }
    };
  },

  /* ----- sign in ----- */
  welcome() {
    app.innerHTML = `<div class="center"><div class="eyebrow">Year 11 mock revision</div><h1>Haider <span class="mark">Study Guide</span></h1>
      <p class="muted">Who's using the app?</p></div>
      <div class="roles">
        <button class="role" id="asStudent" type="button"><b>I'm a student</b><span>Study guides, questions and streaks</span></button>
        <button class="role" id="asParent" type="button"><b>I'm a parent</b><span>See progress for each child</span></button>
      </div>`;
    $("asStudent").onclick = () => go({ name: "loginStudent", step: "code" });
    $("asParent").onclick = () => go({ name: "loginParent" });
    bar.hidden = true;
  },

  loginStudent(v) {
    if (v.step === "code") {
      app.innerHTML = `<div><div class="eyebrow">Student sign in · step 1 of 2</div><h1>Enter your family code</h1></div>
        <p class="muted">Your parent will have told you this.</p>
        <label class="field" for="code">Family code<input type="text" id="code" maxlength="30" autocomplete="off" value="${esc(store.get("asg-code") || "")}"></label>${errBox}`;
      main.textContent = "Next";
      main.onclick = async () => {
        showError(""); busy(true, "Checking…");
        try { const d = await API.call("POST", "children", { code: $("code").value }); store.set("asg-code", $("code").value.trim()); go({ name: "loginStudent", step: "pin", kids: d.children, pick: d.children.length === 1 ? d.children[0].id : null }); }
        catch (e) { showError(e.message); busy(false); main.textContent = "Next"; }
      };
      setSub(`<button class="link" id="back" type="button">Back</button>`, { back: () => go({ name: "welcome" }) });
    } else {
      app.innerHTML = `<div><div class="eyebrow">Student sign in · step 2 of 2</div><h1>Who are you?</h1></div>
        <div class="roles">${v.kids.map((k) => `<button class="role kid${v.pick === k.id ? " on" : ""}" data-id="${k.id}" type="button"><b>${esc(k.name)}</b></button>`).join("")}</div>
        ${pinField("pin", "Your PIN", "")}${errBox}`;
      app.querySelectorAll(".kid").forEach((b) => (b.onclick = () => { v.pick = b.dataset.id; app.querySelectorAll(".kid").forEach((x) => x.classList.toggle("on", x === b)); }));
      main.textContent = "Sign in";
      main.onclick = async () => {
        showError("");
        if (!v.pick) return showError("Tap your name first.");
        busy(true, "Signing in…");
        try {
          const d = await API.call("POST", "login", { code: store.get("asg-code"), role: "student", childId: v.pick, pin: $("pin").value });
          session = { token: d.token, role: "student", childId: d.childId, name: d.name }; store.set("asg-session", session);
          const m = await API.call("GET", "me"); state = m.state; store.set(localKey(), state);
          go(state.subs.length ? { name: "home" } : { name: "subjects", first: true });
        } catch (e) { showError(e.message); busy(false); main.textContent = "Sign in"; }
      };
      setSub(`<button class="link" id="back" type="button">Back</button>`, { back: () => go({ name: "loginStudent", step: "code" }) });
    }
  },

  loginParent() {
    app.innerHTML = `<div><div class="eyebrow">Parent sign in</div><h1>Welcome back</h1></div>
      <label class="field" for="code">Family code<input type="text" id="code" maxlength="30" autocomplete="off" value="${esc(store.get("asg-code") || "")}"></label>
      ${pinField("pin", "Parent PIN", "")}${errBox}`;
    main.textContent = "Sign in";
    main.onclick = async () => {
      showError(""); busy(true, "Signing in…");
      try {
        const d = await API.call("POST", "login", { code: $("code").value, role: "parent", pin: $("pin").value });
        store.set("asg-code", $("code").value.trim());
        session = { token: d.token, role: "parent" }; store.set("asg-session", session);
        family = null; go({ name: "pOverview" }); loadFamily();
      } catch (e) { showError(e.message); busy(false); main.textContent = "Sign in"; }
    };
    setSub(`<button class="link" id="back" type="button">Back</button>`, { back: () => go({ name: "welcome" }) });
  },

  /* ----- student: choose subjects ----- */
  subjects(v) {
    const sel = new Set(v.picks || state.subs);
    app.innerHTML = `<div><div class="eyebrow">${v.first ? "Welcome, " + esc(session.name) : "Your subjects"}</div><h1>Pick your subjects</h1></div>
      <p class="muted">Each week you'll get a short study guide for every subject you pick, with ${TOPIC_QS} questions and a bonus question. You can change these any time.</p>
      <div class="row between"><h3>Subjects</h3><span class="note" id="cnt">${sel.size} chosen</span></div>
      ${chipsHTML(sel)}`;
    wireChips((picks) => { v.picks = picks; $("cnt").textContent = picks.length + " chosen"; main.disabled = !picks.length; });
    main.textContent = v.first ? "Let's start" : "Save subjects";
    main.disabled = !sel.size;
    main.onclick = () => {
      state.subs = SUBJECTS.map((s) => s.id).filter((id) => (v.picks || state.subs).includes(id));
      state.profileAt = Date.now();
      if (!state.start) state.start = today();
      save(); go({ name: "home" });
    };
    if (!v.first) setSub(`<button class="link" id="cancel" type="button">Cancel</button> <button class="link" id="out" type="button">Sign out</button>`, { cancel: () => go({ name: "home" }), out: logout });
  },

  /* ----- student: home ----- */
  home() {
    const p = state, cw = curWeek(p), nx = nextTopic(p), st = streak(p), didToday = testDays(p).has(today()), S = summary(p);
    const weekList = []; for (let w = cw - 1; w >= 0; w--) weekList.push(`<div class="topics"><h3>${w === cw - 1 ? "This week" : "Week " + (w + 1)}</h3>${S.subs.map((s) => topicBtn(s, w, nx && nx.s === s && nx.w === w)).join("")}</div>`);
    app.innerHTML = `
      <div class="row between"><div><div class="eyebrow">Week ${cw} of ${WEEKS_N}${mockLine()}</div><h1>Hi ${esc(session.name)}</h1></div><button class="btn2" id="settings" type="button">My subjects</button></div>
      ${store.get("asg-pending") ? `<p class="note warn">Saved on this device. It will sync when you're back online.</p>` : ""}
      <div class="stats">
        <div class="stat streak"><b>${st}</b><span>day streak</span></div>
        <div class="stat"><b>${S.mine.length}/${S.total}</b><span>topics done</span></div>
        <div class="stat"><b>${S.avg === null ? "–" : S.avg + "%"}</b><span>average score</span></div>
      </div>
      <div class="card"><h3>Progress by subject</h3>${subjectBars(p)}</div>
      <div class="card">
        <div class="row between"><h3>Last 10 tests</h3><span class="note">Best streak: ${bestStreak(p)} days</span></div>
        ${scoresSVG(p)}
        <h3>Last 14 days</h3><div class="days">${daysHTML(p)}</div>
        <p class="note">${didToday ? "You've done a test today. Streak safe!" : "Do any test today to keep your streak going."}</p>
      </div>
      ${weekList.join("")}`;
    app.querySelectorAll(".tp").forEach((b) => (b.onclick = () => openTopic(b.dataset.s, +b.dataset.w)));
    $("settings").onclick = () => go({ name: "subjects" });
    if (nx) {
      main.textContent = `${SUB[nx.s].name}: ${SUB[nx.s].weeks[nx.w].t}`; main.onclick = () => openTopic(nx.s, nx.w);
      setSub(`<button class="link" id="daily" type="button">Short on time? Take a quick 5-question test</button>`, { daily: startDaily });
    } else {
      main.textContent = didToday ? "Take another quick test" : "Take today's quick test"; main.onclick = startDaily;
      if (cw < WEEKS_N) setSub(`<span class="note">This week's guides are done. New guides on ${nextUnlock(p).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}.</span>`);
      else setSub(`<span class="note">All weeks complete. Keep your streak with a daily quick test.</span>`);
    }
  },

  guide(v) {
    const S = SUB[v.s], T = S.weeks[v.w];
    app.innerHTML = `<div class="row"><span class="subject">${esc(S.name)}</span><span class="eyebrow">Week ${v.w + 1} study guide</span></div>
      <h1>${esc(T.t)}</h1><p>${esc(T.intro)}</p>
      <div class="card"><h3>How it works</h3><ol class="list">${T.how.map((h) => `<li>${esc(h)}</li>`).join("")}</ol></div>
      <div class="example"><span class="eyebrow">Worked example</span><p class="q small">${esc(T.example.q)}</p><ol class="list">${T.example.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p class="ans">Answer: ${esc(T.example.a)}</p></div>`;
    main.textContent = "Walk me through it"; main.onclick = () => go({ name: "walk", s: v.s, w: v.w, i: 0 });
    setSub(`<button class="link" id="back" type="button">Back to home</button>`, { back: () => go({ name: "home" }) });
  },

  walk(v) {
    const T = SUB[v.s].weeks[v.w], st = T.walk[v.i], last = v.i === T.walk.length - 1;
    app.innerHTML = `<div class="row between"><span class="eyebrow">${esc(T.t)} · walk-through</span><span class="eyebrow">${v.i + 1} of ${T.walk.length}</span></div>
      <div class="progress"><i style="width:${(v.i + 1) / T.walk.length * 100}%"></i></div>
      <div class="card"><span class="stepnum">${v.i + 1}</span><h2>${esc(st.h)}</h2><p>${esc(st.b)}</p></div>
      ${last ? `<p class="muted">Next: ${TOPIC_QS} questions to check you've understood, then a bonus question.</p>` : ""}`;
    main.textContent = last ? `Start the ${TOPIC_QS} questions` : "Next step";
    main.onclick = () => (last ? go({ name: "quiz", mode: "topic", s: v.s, w: v.w, qs: prep(T.qs), bonusQ: prep([T.bonus])[0], i: 0, score: 0, picked: null, checked: false }) : go({ ...v, i: v.i + 1 }));
    setSub(`<button class="link" id="back" type="button">${v.i ? "Previous step" : "Back to the guide"}</button>`, { back: () => (v.i ? go({ ...v, i: v.i - 1 }) : go({ name: "guide", s: v.s, w: v.w })) });
  },

  quiz(v) {
    const inBonus = v.mode === "topic" && v.i >= v.qs.length, q = inBonus ? v.bonusQ : v.qs[v.i];
    const label = v.mode === "daily" ? "Quick daily test" : SUB[v.s].name + " · " + SUB[v.s].weeks[v.w].t;
    const pct = inBonus ? 100 : ((v.i + (v.checked ? 1 : 0)) / v.qs.length) * 100;
    const right = v.checked && q.opts[v.picked] === q.ans;
    app.innerHTML = `<div class="row between"><span class="eyebrow">${esc(label)}</span><span class="eyebrow">${inBonus ? "Bonus" : `${v.i + 1} of ${v.qs.length}`}</span></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      ${inBonus ? `<div><span class="bonus-tag">★ Bonus · foundation check</span></div>` : ""}
      <div class="q">${esc(q.q)}</div>
      <div class="opts">${q.opts.map((o, j) => { let c = "opt"; if (v.checked) { if (o === q.ans) c += " right"; else if (j === v.picked) c += " wrong"; } else if (j === v.picked) c += " sel"; return `<button class="${c}" data-j="${j}" type="button" ${v.checked ? "disabled" : ""}>${esc(o)}</button>`; }).join("")}</div>
      ${v.checked ? `<div class="fb ${right ? "good" : "bad"}"><b>${right ? "Correct!" : "Not quite. The answer is: " + esc(q.ans) + "."}</b> ${esc(q.e)}</div>` : ""}`;
    app.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { v.picked = +b.dataset.j; render(); }));
    if (!v.checked) {
      main.textContent = "Check answer"; main.disabled = v.picked === null;
      main.onclick = () => { v.checked = true; const ok = q.opts[v.picked] === q.ans; if (inBonus) v.bonus = ok; else if (ok) v.score++; render(); };
    } else {
      const lastMain = v.i === v.qs.length - 1, end = inBonus || (v.mode === "daily" && lastMain);
      main.textContent = end ? "See my result" : v.mode === "topic" && lastMain ? "Try the bonus question" : "Next question";
      main.onclick = () => {
        if (!end) { v.i++; v.picked = null; v.checked = false; render(); return; }
        const before = streak(state), m = Math.min(180, Math.max(1, Math.round((Date.now() - startedAt) / 60000)));
        state.log.push({ id: uid(), d: today(), s: v.score, t: v.qs.length, k: v.mode === "topic" ? tkey(v.s, v.w) : "daily", m, ts: Date.now() });
        if (v.mode === "topic") { const k = tkey(v.s, v.w), prev = state.done[k]; if (!prev || v.score > prev.s || (v.score === prev.s && v.bonus && !prev.b)) state.done[k] = { s: v.score, t: v.qs.length, b: !!v.bonus, d: today(), m }; }
        save();
        go({ name: "result", mode: v.mode, s: v.s, w: v.w, score: v.score, t: v.qs.length, bonus: v.bonus, grew: streak(state) > before, m });
      };
    }
    setSub(`<button class="link" id="quit" type="button">Stop and go home</button>`, { quit: () => go({ name: "home" }) });
  },

  result(v) {
    const pc = Math.round(v.score / v.t * 100), st = streak(state), S = summary(state);
    const msg = pc === 100 ? `Perfect score, ${esc(session.name)}!` : pc >= 80 ? "Great work!" : pc >= 50 ? "Good effort. Have another look at the guide." : "Keep going. Re-read the guide and try again.";
    app.innerHTML = `<div class="eyebrow">${v.mode === "topic" ? esc(SUB[v.s].name) + " · Week " + (v.w + 1) + " complete" : "Quick test complete"}</div>
      <div class="card"><div class="big">${v.score}/${v.t}</div><h2>${msg}</h2><p class="note">Time taken: ${fmtMin(v.m)} · Your parent can see this result.</p>
      ${v.mode === "topic" ? `<p>${v.bonus ? "★ You got the bonus question too. Your foundations are solid." : "You missed the bonus question. It checks an earlier skill this topic builds on, so it's worth a quick review."}</p>` : ""}</div>
      <div class="stats two"><div class="stat streak"><b>${st}</b><span>day streak${v.grew ? " — up by 1!" : ""}</span></div><div class="stat"><b>${S.mine.length}/${S.total}</b><span>topics done</span></div></div>`;
    const nx = nextTopic(state);
    main.textContent = nx ? `Next: ${SUB[nx.s].name}` : "Back to my progress";
    main.onclick = () => (nx ? openTopic(nx.s, nx.w) : go({ name: "home" }));
    const links = [`<button class="link" id="home" type="button">Back to home</button>`];
    if (v.mode === "topic" && pc < 80) links.unshift(`<button class="link" id="retry" type="button">Go over this topic again</button>`);
    setSub(links.join(" "), { home: () => go({ name: "home" }), retry: () => openTopic(v.s, v.w) });
  },

  /* ----- parent: all children ----- */
  pOverview() {
    if (!family) { app.innerHTML = `<div class="center"><h1>Your family</h1><p class="muted">Loading progress…</p></div>`; bar.hidden = true; return; }
    const cards = family.children.map((c) => {
      const p = c.state, S = summary(p), st = streak(p);
      return `<button class="kidcard" data-id="${c.id}" type="button">
        <div class="row between"><h2>${esc(c.name)}</h2><span class="pill${Date.now() - (p.lastActive || 0) < 864e5 ? " live" : ""}">${ago(p.lastActive)}</span></div>
        <div class="mini"><span><b>${st}</b> day streak</span><span><b>${S.mine.length}/${S.total || "–"}</b> topics</span><span><b>${S.avg === null ? "–" : S.avg + "%"}</b> average</span><span><b>${fmtMin(S.weekMins)}</b> this week</span></div>
        ${S.weakest ? `<p class="note">Needs most practice: ${esc(SUB[S.weakest.s].name)} (${S.weakest.avg}%)</p>` : !p.subs.length ? `<p class="note">Hasn't picked subjects yet.</p>` : ""}
      </button>`;
    }).join("");
    app.innerHTML = `<div class="row between"><div><div class="eyebrow">Parent dashboard</div><h1>Your family</h1></div><button class="btn2" id="psettings" type="button">Settings</button></div>
      ${errBox}
      <div class="kids">${cards || `<p class="muted">No children yet.</p>`}</div>`;
    app.querySelectorAll(".kidcard").forEach((b) => (b.onclick = () => go({ name: "pChild", id: b.dataset.id })));
    $("psettings").onclick = () => go({ name: "pSettings" });
    main.textContent = "Add a child"; main.onclick = () => go({ name: "pAdd" });
    setSub(`<button class="link" id="refresh" type="button">Refresh</button>`, { refresh: loadFamily });
  },

  pChild(v) {
    const c = family?.children.find((x) => x.id === v.id);
    if (!c) return go({ name: "pOverview" });
    const p = c.state, S = summary(p), st = streak(p), cw = curWeek(p);
    const rows = S.mine.slice().sort((a, b) => (b[1].d || "").localeCompare(a[1].d || "")).map(([k, r]) => { const [s, w] = k.split(":"); return `<tr><td>${esc(SUB[s].name)}<br><span class="note">Wk ${+w + 1} · ${esc(SUB[s].weeks[+w].t)}</span></td><td>${r.d ? niceDate(r.d) : "–"}</td><td class="num">${r.m ? fmtMin(r.m) : "–"}</td><td class="num">${r.s}/${r.t}${r.b ? " ★" : ""}</td></tr>`; }).join("");
    app.innerHTML = `<div><div class="eyebrow">${ago(p.lastActive)}</div><h1>${esc(c.name)}</h1></div>
      <div class="stats">
        <div class="stat streak"><b>${st}</b><span>day streak · best ${bestStreak(p)}</span></div>
        <div class="stat"><b>${fmtMin(S.weekMins)}</b><span>studied, last 7 days</span></div>
        <div class="stat"><b>${S.active14}/14</b><span>days active</span></div>
        <div class="stat"><b>${S.mine.length}/${S.total}</b><span>topics done</span></div>
        <div class="stat"><b>${S.avg === null ? "–" : S.avg + "%"}</b><span>average score</span></div>
        <div class="stat"><b>${S.bonusN}/${S.mine.length}</b><span>bonus right</span></div>
      </div>
      ${S.weakest ? `<div class="card"><h3>At a glance</h3><p>Strongest: <b>${esc(SUB[S.strongest.s].name)}</b> (${S.strongest.avg}%). Needs most practice: <b>${esc(SUB[S.weakest.s].name)}</b> (${S.weakest.avg}%).</p></div>` : ""}
      <div class="card"><div class="row between"><h3>Progress by subject</h3><span class="note">Week ${cw} of ${WEEKS_N}</span></div>${subjectBars(p)}</div>
      <div class="card"><h3>Last 10 tests</h3>${scoresSVG(p)}<h3>Last 14 days</h3><div class="days">${daysHTML(p)}</div><p class="note">${S.quick.length} quick daily test${S.quick.length === 1 ? "" : "s"} taken in total.</p></div>
      <div class="card"><h3>Every topic completed</h3>${rows ? `<div class="tablewrap"><table><thead><tr><th>Topic</th><th>Date</th><th class="num">Time</th><th class="num">Score</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">★ = bonus question right. Time runs from opening the guide to finishing the questions.</p>` : `<p class="muted">No topics finished yet.</p>`}</div>
      <div class="card"><h3>Manage ${esc(c.name)}</h3>
        <div class="row">
          <button class="btn2" id="subs" type="button">Change subjects</button>
          ${cw < WEEKS_N && p.start ? `<button class="btn2" id="unlock" type="button">Unlock week ${cw + 1} now</button>` : ""}
          <button class="btn2" id="newpin" type="button">Reset PIN</button>
          <button class="btn2" id="rename" type="button">Rename</button>
        </div>
        <div id="manage"></div>
        <div class="row" id="danger"><button class="btn2 danger" id="reset" type="button">Reset progress</button><button class="btn2 danger" id="remove" type="button">Remove child</button></div>
      </div>${errBox}`;
    const act = async (patch, done) => { showError(""); try { await API.call("PATCH", "child/" + c.id, patch); await loadFamily(); if (done) done(); } catch (e) { showError(e.message); } };
    $("subs").onclick = () => go({ name: "pSubjects", id: c.id });
    if ($("unlock")) $("unlock").onclick = () => act({ unlockWeek: true });
    $("newpin").onclick = () => { $("manage").innerHTML = `<div class="inline">${pinField("np", "New PIN for " + esc(c.name))}<button class="btn2" id="savepin" type="button">Save PIN</button></div>`; $("savepin").onclick = () => act({ pin: $("np").value }, () => { $("manage").innerHTML = `<p class="note ok">PIN changed. ${esc(c.name)} will need to sign in again.</p>`; }); };
    $("rename").onclick = () => { $("manage").innerHTML = `<div class="inline"><label class="field" for="nn">New name<input type="text" id="nn" maxlength="30" value="${esc(c.name)}"></label><button class="btn2" id="savename" type="button">Save name</button></div>`; $("savename").onclick = () => act({ name: $("nn").value }); };
    $("reset").onclick = () => { $("danger").innerHTML = `<span class="note">Delete all of ${esc(c.name)}'s scores and streaks?</span><button class="btn2 danger" id="yes" type="button">Yes, reset</button><button class="btn2" id="no" type="button">Cancel</button>`; $("yes").onclick = () => act({ reset: true }); $("no").onclick = render; };
    $("remove").onclick = () => { $("danger").innerHTML = `<span class="note">Remove ${esc(c.name)} and all their progress? This can't be undone.</span><button class="btn2 danger" id="yes" type="button">Yes, remove</button><button class="btn2" id="no" type="button">Cancel</button>`; $("yes").onclick = async () => { try { await API.call("DELETE", "child/" + c.id); await loadFamily(); go({ name: "pOverview" }); } catch (e) { showError(e.message); } }; $("no").onclick = render; };
    main.textContent = "Back to all children"; main.onclick = () => go({ name: "pOverview" });
    setSub(`<button class="link" id="refresh" type="button">Refresh</button>`, { refresh: loadFamily });
  },

  pSubjects(v) {
    const c = family?.children.find((x) => x.id === v.id);
    if (!c) return go({ name: "pOverview" });
    const sel = new Set(v.picks || c.state.subs);
    app.innerHTML = `<div><div class="eyebrow">${esc(c.name)}</div><h1>Change subjects</h1></div>
      <p class="muted">Progress in a subject is kept if you remove it and add it back later.</p>${chipsHTML(sel)}${errBox}`;
    wireChips((picks) => { v.picks = picks; main.disabled = !picks.length; });
    main.textContent = "Save subjects"; main.disabled = !sel.size;
    main.onclick = async () => { showError(""); busy(true, "Saving…"); try { await API.call("PATCH", "child/" + c.id, { subs: SUBJECTS.map((s) => s.id).filter((id) => (v.picks || c.state.subs).includes(id)) }); await loadFamily(); go({ name: "pChild", id: c.id }); } catch (e) { showError(e.message); busy(false); main.textContent = "Save subjects"; } };
    setSub(`<button class="link" id="cancel" type="button">Cancel</button>`, { cancel: () => go({ name: "pChild", id: c.id }) });
  },

  pAdd() {
    app.innerHTML = `<div><div class="eyebrow">Parent dashboard</div><h1>Add a child</h1></div>
      <label class="field" for="cname">Child's first name<input type="text" id="cname" maxlength="30" autocomplete="off"></label>
      ${pinField("cpin", "Child's PIN")}
      <p class="note">They'll sign in with the family code, tap their name and enter this PIN. They choose their own subjects the first time.</p>${errBox}`;
    main.textContent = "Add child";
    main.onclick = async () => { showError(""); busy(true, "Adding…"); try { await API.call("POST", "child", { name: $("cname").value, pin: $("cpin").value }); await loadFamily(); go({ name: "pOverview" }); } catch (e) { showError(e.message); busy(false); main.textContent = "Add child"; } };
    setSub(`<button class="link" id="cancel" type="button">Cancel</button>`, { cancel: () => go({ name: "pOverview" }) });
  },

  pSettings() {
    app.innerHTML = `<div><div class="eyebrow">Parent dashboard</div><h1>Settings</h1></div>
      <div class="card"><h3>Change your parent PIN</h3>${pinField("np", "New parent PIN")}<button class="btn2" id="savepin" type="button">Save PIN</button></div>
      <div class="card"><h3>Change the family code</h3><p class="note">Everyone will need the new code next time they sign in.</p><label class="field" for="nc">New family code<input type="text" id="nc" maxlength="30" autocomplete="off"></label><button class="btn2" id="savecode" type="button">Save family code</button></div>
      <p class="note ok" id="okmsg" hidden></p>${errBox}`;
    const ok = (m) => { $("okmsg").textContent = m; $("okmsg").hidden = false; };
    $("savepin").onclick = async () => { showError(""); try { const d = await API.call("PATCH", "parent", { pin: $("np").value }); session.token = d.token; store.set("asg-session", session); ok("Parent PIN changed."); } catch (e) { showError(e.message); } };
    $("savecode").onclick = async () => { showError(""); try { await API.call("PATCH", "parent", { code: $("nc").value }); store.set("asg-code", $("nc").value.trim()); ok("Family code changed."); } catch (e) { showError(e.message); } };
    main.textContent = "Back to dashboard"; main.onclick = () => go({ name: "pOverview" });
    setSub(`<button class="link" id="out" type="button">Sign out</button>`, { out: logout });
  },
};

function topicBtn(s, w, isNext) {
  const r = state.done[tkey(s, w)], T = SUB[s].weeks[w];
  return `<button class="tp${r ? " done" : ""}${isNext ? " next" : ""}" data-s="${s}" data-w="${w}" type="button"><span class="txt"><small>${esc(SUB[s].name)} · Week ${w + 1}</small><span class="t">${esc(T.t)}</span></span><span class="badge">${r ? `${r.s}/${r.t}${r.b ? " ★" : ""}` : isNext ? "Up next" : "To do"}</span></button>`;
}
function openTopic(s, w) { startedAt = Date.now(); go({ name: "guide", s, w }); }
function startDaily() {
  startedAt = Date.now();
  let pool = [];
  for (const k in state.done) { const [s, w] = k.split(":"); if (SUB[s] && state.subs.includes(s)) pool.push(...SUB[s].weeks[+w].qs); }
  if (pool.length < 5) for (const x of available(state)) pool.push(...SUB[x.s].weeks[x.w].qs);
  go({ name: "quiz", mode: "daily", qs: prep(shuffle(pool).slice(0, 5)), i: 0, score: 0, picked: null, checked: false });
}

/* ---------- start up ---------- */
(async function boot() {
  render();
  if (session?.role === "student") {
    state = store.get(localKey()) || blankProgress();
    go(state.subs.length ? { name: "home" } : { name: "subjects", first: true });
    refreshStudent();
    return;
  }
  if (session?.role === "parent") { go({ name: "pOverview" }); loadFamily(); return; }
  try { const s = await API.call("GET", "status"); go(s.setup ? { name: "welcome" } : { name: "setupFamily" }); }
  catch (e) { app.innerHTML = `<div class="center"><h1>Can't connect</h1><p class="muted">${esc(e.message)}</p></div>`; bar.hidden = true; }
})();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !session) return;
  if (session.role === "student" && view.name === "home") refreshStudent();
  if (session.role === "parent" && (view.name === "pOverview" || view.name === "pChild")) loadFamily();
});
