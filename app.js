(() => {
  const cfg = window.OUR_MONEY_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  let session = null;
  const CATS = ["Housing", "Bills & utilities", "Food", "Transport", "Pets", "Insurance", "Subscriptions", "Finance & repayments", "Saving & investing", "Other"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  let state = null;
  let saving = false, pending = false, saveTimer = null;
  const now = new Date();
  let sel = { y: now.getFullYear(), m: now.getMonth() + 1 };

  const $ = (id) => document.getElementById(id);
  const gbp = (n, dp) => {
    const v = Math.round((n || 0) * 100) / 100;
    const d = dp ?? (Math.abs(v - Math.round(v)) > 0.001 ? 2 : 0);
    return (v < 0 ? "-£" : "£") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const key = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
  const addMonths = (y, m, n) => { const t = y * 12 + (m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; };
  const uid = () => Math.random().toString(36).slice(2, 9);

  // ---- tax (2026/27, England, Wales & NI)
  const R = { pa: 12570, band: 37700, br: 0.2, hr: 0.4, addAt: 125140, ar: 0.45, taper: 100000, niPt: 12570, niUel: 50270, ni1: 0.08, ni2: 0.02 };
  function pay(p) {
    const s = +p.salary || 0, pen = s * (+p.pensionPct || 0) / 100;
    const niPay = p.pensionType === "Salary sacrifice" ? s - pen : s;
    const taxPay = p.pensionType === "Relief at source" ? s : s - pen;
    const pa = Math.max(0, R.pa - Math.max(0, s - pen - R.taper) / 2);
    const ti = Math.max(0, taxPay - pa);
    const tax = Math.min(ti, R.band) * R.br + Math.max(0, Math.min(ti, R.addAt) - R.band) * R.hr + Math.max(0, ti - R.addAt) * R.ar;
    const ni = Math.max(0, Math.min(niPay, R.niUel) - R.niPt) * R.ni1 + Math.max(0, niPay - R.niUel) * R.ni2;
    const penFromPay = p.pensionType === "Relief at source" ? pen * (1 - R.br) : pen;
    const other = (+p.otherMonthly || 0) * 12;
    const take = s - tax - ni - penFromPay - other;
    return { gross: s / 12, tax: tax / 12, ni: ni / 12, pension: penFromPay / 12, other: other / 12, take: take / 12 };
  }

  // ---- amounts for a month
  function amountFor(item, k) {
    let a = item.auto === "salary" ? pay(state.pay).take : +item.amount || 0;
    for (const c of item.changes || []) {
      if (c.from <= k && (!c.to || c.to >= k)) a = +c.amount;
    }
    return a;
  }
  function monthTotals(y, m) {
    const k = key(y, m);
    const inc = state.incomes.filter(i => i.counted).reduce((t, i) => t + amountFor(i, k), 0);
    const uncounted = state.incomes.filter(i => !i.counted).reduce((t, i) => t + amountFor(i, k), 0);
    const bills = state.bills.filter(b => b.counted && (!b.lastMonth || b.lastMonth >= k)).reduce((t, b) => t + (+b.amount || 0), 0);
    const spend = amountFor(state.spending, k);
    const ones = oneOffsFor(y, m).reduce((t, o) => t + (+o.amount || 0), 0);
    const out = bills + spend + ones;
    return { inc, uncounted, bills, spend, ones, out, left: inc - out };
  }
  const oneOffsFor = (y, m) => state.oneoffs.filter(o => +o.month === m && (!o.year || +o.year === y));

  // ---- saving
  function setStatus(t, bad) { const s = $("status"); s.textContent = t; s.classList.toggle("bad", !!bad); }
  function save() {
    clearTimeout(saveTimer);
    setStatus("Saving…");
    saveTimer = setTimeout(push, 600);
  }
  async function push() {
    if (!session) return;
    if (saving) { pending = true; return; }
    saving = true;
    const { error } = await sb.from("budgets").upsert({ user_id: session.user.id, data: state, updated_at: new Date().toISOString() });
    saving = false;
    if (error) setStatus("Couldn't save. Check your connection, then change something to try again.", true);
    else setStatus("All changes saved");
    if (pending) { pending = false; push(); }
  }
  function change(fn) { fn(); render(); save(); }

  // ---- edit popover
  let popAction = null;
  function openPop(title, value, choices) {
    $("popTitle").textContent = title;
    $("popAmt").value = Math.round(value * 100) / 100;
    const box = $("popChoices"); box.innerHTML = "";
    choices.forEach(c => {
      const b = document.createElement("button"); b.type = "button";
      b.innerHTML = `<b></b><small></small>`; b.querySelector("b").textContent = c.label; b.querySelector("small").textContent = c.sub || "";
      b.onclick = () => { const v = parseFloat($("popAmt").value); if (isNaN(v)) return; closePop(); c.run(v); };
      box.appendChild(b);
    });
    $("pop").classList.add("open"); setTimeout(() => $("popAmt").select(), 30);
  }
  function closePop() { $("pop").classList.remove("open"); }
  $("popCancel").onclick = closePop;
  $("pop").addEventListener("click", e => { if (e.target.id === "pop") closePop(); });
  $("popForm").addEventListener("submit", e => { e.preventDefault(); const first = $("popChoices").querySelector("button"); if (first) first.click(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });

  function editMonthly(item, label) {
    const k = key(sel.y, sel.m), mName = MONTHS[sel.m - 1];
    openPop(label, amountFor(item, k), [
      { label: `Just ${mName}`, sub: "Other months stay the same", run: v => change(() => { (item.changes ||= []).push({ from: k, to: k, amount: v }); }) },
      { label: `From ${mName} onwards`, sub: "Until you change it again", run: v => change(() => { (item.changes ||= []).push({ from: k, to: null, amount: v }); }) },
      { label: "Every month", sub: "Clears any month-by-month changes", run: v => change(() => { item.changes = []; if (item.auto) { item.auto = null; } item.amount = v; }) },
    ]);
  }

  // ---- bill editor
  const monthName = (k) => `${MONTHS[+k.slice(5, 7) - 1].slice(0, 3)} ${k.slice(0, 4)}`;
  let editing = null;
  (() => {
    const ms = $("bEndMonth"), ys = $("bEndYear"), cs = $("bCat");
    ms.appendChild(new Option("No end date", ""));
    MONTHS.forEach((m, i) => ms.appendChild(new Option(m, String(i + 1).padStart(2, "0"))));
    const y0 = new Date().getFullYear();
    for (let y = y0 - 1; y <= y0 + 6; y++) ys.appendChild(new Option(String(y), String(y)));
    CATS.forEach(c => cs.appendChild(new Option(c, c)));
    ms.onchange = () => { ys.disabled = !ms.value; };
  })();
  function openBill(b) {
    editing = b;
    $("bName").value = b.name; $("bAmt").value = b.amount; $("bCat").value = b.category || "Other";
    $("bEndMonth").value = b.lastMonth ? b.lastMonth.slice(5, 7) : "";
    $("bEndYear").value = b.lastMonth ? b.lastMonth.slice(0, 4) : String(sel.y);
    $("bEndYear").disabled = !b.lastMonth;
    $("billPop").classList.add("open"); setTimeout(() => $("bName").focus(), 30);
  }
  const closeBill = () => { $("billPop").classList.remove("open"); editing = null; };
  $("billCancel").onclick = closeBill;
  $("billPop").addEventListener("click", e => { if (e.target.id === "billPop") closeBill(); });
  $("billDelete").onclick = () => { const b = editing; closeBill(); change(() => { state.bills = state.bills.filter(z => z !== b); }); };
  $("billForm").addEventListener("submit", e => {
    e.preventDefault();
    const b = editing, name = $("bName").value.trim(), amt = parseFloat($("bAmt").value);
    if (!name || isNaN(amt)) return;
    const m = $("bEndMonth").value;
    closeBill();
    change(() => { b.name = name; b.amount = amt; b.category = $("bCat").value; b.lastMonth = m ? `${$("bEndYear").value}-${m}` : null; });
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeBill(); });

  // ---- render
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function render() {
    if (!state) return;
    const k = key(sel.y, sel.m), mName = MONTHS[sel.m - 1];
    $("monthLabel").textContent = `${mName} ${sel.y}`;
    $("oneMonth").textContent = mName; $("addOneMonth").textContent = mName;
    const T = monthTotals(sel.y, sel.m);
    $("tIn").textContent = gbp(T.inc, 0);
    $("tInS").textContent = T.uncounted > 0 ? `Plus ${gbp(T.uncounted, 0)} not counted` : "Income you count";
    $("tOut").textContent = gbp(T.out, 0);
    $("tOutS").textContent = `Bills ${gbp(T.bills, 0)} · spending ${gbp(T.spend, 0)} · one-offs ${gbp(T.ones, 0)}`;
    $("tLeft").textContent = gbp(T.left, 0);
    $("tLeftBox").classList.toggle("neg", T.left < 0);
    $("tLeftS").textContent = T.left < 0 ? "You're spending more than comes in" : "To save or spend";

    // income
    const ir = $("incomeRows"); ir.innerHTML = "";
    state.incomes.forEach(i => {
      const a = amountFor(i, k), base = i.auto === "salary" ? pay(state.pay).take : +i.amount || 0;
      const row = el("div", "row" + (i.counted ? "" : " off"));
      const nm = el("div", "name", i.name);
      if (Math.abs(a - base) > 0.005) { const t = el("span", "tag", "this month"); nm.appendChild(t); }
      if (i.note) nm.appendChild(el("small", null, i.note));
      const amt = el("button", "amt", gbp(a)); amt.setAttribute("aria-label", `Change ${i.name}`);
      amt.onclick = () => editMonthly(i, i.name);
      const chip = el("button", "chip" + (i.counted ? " on" : ""), i.counted ? "Counted" : "Not counted");
      chip.onclick = () => change(() => { i.counted = !i.counted; });
      row.append(nm, amt, chip);
      if (!i.auto) { const x = el("button", "x", "×"); x.setAttribute("aria-label", `Remove ${i.name}`); x.onclick = () => change(() => { state.incomes = state.incomes.filter(z => z !== i); }); row.style.gridTemplateColumns = "1fr auto auto auto"; row.append(x); }
      else row.style.gridTemplateColumns = "1fr auto auto 26px", row.append(el("span"));
      ir.appendChild(row);
    });
    $("sumIn").textContent = gbp(T.inc, 0);

    // bills
    const br = $("billRows"); br.innerHTML = "";
    CATS.forEach(cat => {
      const list = state.bills.filter(b => (b.category || "Other") === cat);
      if (!list.length) return;
      const sub = list.filter(b => b.counted && (!b.lastMonth || b.lastMonth >= k)).reduce((t, b) => t + +b.amount, 0);
      const h = el("div", "cat"); h.textContent = `${cat} · ${gbp(sub, 0)}`; br.appendChild(h);
      list.sort((a, b) => b.amount - a.amount).forEach(b => {
        const ended = b.lastMonth && b.lastMonth < k;
        const row = el("div", "row" + (b.counted && !ended ? "" : " off"));
        row.style.gridTemplateColumns = "1fr auto auto auto";
        const nm = el("button", "name namebtn", b.name);
        nm.setAttribute("aria-label", `Edit ${b.name}`);
        nm.onclick = () => openBill(b);
        if (ended) nm.appendChild(el("small", null, `Finished (last payment ${monthName(b.lastMonth)})`));
        else if (b.lastMonth) nm.appendChild(el("small", null, `Last payment ${monthName(b.lastMonth)}`));
        const amt = el("button", "amt", gbp(b.amount)); amt.setAttribute("aria-label", `Change ${b.name}`);
        amt.onclick = () => openPop(b.name, +b.amount, [{ label: "Save", sub: "Every month", run: v => change(() => { b.amount = v; }) }]);
        const chip = el("button", "chip" + (b.counted ? " on" : ""), b.counted ? "Counted" : "Not counted");
        chip.onclick = () => change(() => { b.counted = !b.counted; });
        const x = el("button", "x", "×"); x.setAttribute("aria-label", `Remove ${b.name}`);
        x.onclick = () => change(() => { state.bills = state.bills.filter(z => z !== b); });
        row.append(nm, amt, chip, x); br.appendChild(row);
      });
    });
    $("sumBills").textContent = gbp(T.bills, 0);

    // spending
    $("spendAmt").textContent = gbp(T.spend, 0);
    $("spendWeek").textContent = gbp(T.spend * 12 / 52, 0);

    // one-offs
    const orow = $("oneRows"); orow.innerHTML = "";
    const ones = oneOffsFor(sel.y, sel.m);
    if (!ones.length) orow.appendChild(el("div", "empty", `Nothing planned for ${mName}.`));
    ones.forEach(o => {
      const row = el("div", "row"); row.style.gridTemplateColumns = "1fr auto auto";
      const nm = el("div", "name", o.name); nm.appendChild(el("small", null, o.year ? `Just ${o.year}` : "Every year"));
      const amt = el("button", "amt", gbp(o.amount)); amt.onclick = () => openPop(o.name, +o.amount, [{ label: "Save", run: v => change(() => { o.amount = v; }) }]);
      const x = el("button", "x", "×"); x.setAttribute("aria-label", `Remove ${o.name}`);
      x.onclick = () => change(() => { state.oneoffs = state.oneoffs.filter(z => z !== o); });
      row.append(nm, amt, x); orow.appendChild(row);
    });
    $("sumOne").textContent = ones.length ? gbp(T.ones, 0) : "";

    // year strip
    const start = { y: +state.start.slice(0, 4), m: +state.start.slice(5, 7) };
    const months = Array.from({ length: 12 }, (_, i) => addMonths(start.y, start.m, i));
    const tots = months.map(mm => monthTotals(mm.y, mm.m));
    const max = Math.max(1, ...tots.map(t => Math.abs(t.left)));
    const bars = $("bars"); bars.innerHTML = "";
    months.forEach((mm, i) => {
      const t = tots[i];
      const b = el("button", "bar" + (t.left < 0 ? " neg" : "") + (mm.y === sel.y && mm.m === sel.m ? " sel" : ""));
      b.setAttribute("aria-label", `${MONTHS[mm.m - 1]} ${mm.y}: ${gbp(t.left, 0)} left over`);
      const f = el("div", "fill"); f.style.height = `${Math.max(2, Math.abs(t.left) / max * 100)}%`;
      b.append(f, el("span", "v", gbp(t.left, 0)), el("span", "m", MONTHS[mm.m - 1].slice(0, 3)));
      b.onclick = () => { sel = mm; render(); };
      bars.appendChild(b);
    });
    const sum = (f) => tots.reduce((a, t) => a + t[f], 0);
    const foot = $("yearFoot"); foot.innerHTML = "";
    [["Coming in", sum("inc")], ["Going out", sum("out")], ["Left over", sum("left")]].forEach(([l, v]) => {
      const s = el("span", null, `${l} over 12 months: `); const b = el("b", "num", gbp(v, 0)); s.appendChild(b); foot.appendChild(s);
    });
    const unc = sum("uncounted");
    if (unc > 0) { const s = el("span", null, "Not counted: "); s.appendChild(el("b", "num", gbp(unc, 0))); foot.appendChild(s); }

    // pay
    const P = pay(state.pay);
    $("pSalary").value = state.pay.salary; $("pPension").value = state.pay.pensionPct;
    $("pType").value = state.pay.pensionType; $("pOther").value = state.pay.otherMonthly;
    const pb = $("payBreakdown"); pb.innerHTML = "";
    [["Salary each month", P.gross], ["Income tax", -P.tax], ["National Insurance", -P.ni], ["Pension", -P.pension], ["Student loan and other", -P.other]].forEach(([l, v]) => {
      if (l === "Student loan and other" && !v) return;
      const d = el("div"); d.append(el("span", null, l), el("span", "num", gbp(v))); pb.appendChild(d);
    });
    const t = el("div", "t"); t.append(el("span", null, "Take-home each month"), el("span", "num", gbp(P.take))); pb.appendChild(t);
    pb.appendChild(el("div", "hint", "Uses 2026/27 tax rates for England, Wales and Northern Ireland."));
  }

  // ---- controls
  $("prev").onclick = () => { sel = addMonths(sel.y, sel.m, -1); render(); };
  $("next").onclick = () => { sel = addMonths(sel.y, sel.m, 1); render(); };
  const toggleForm = (id, show) => { $(id).hidden = !show; if (show) $(id).querySelector("input").focus(); };
  $("addIncomeBtn").onclick = () => toggleForm("addIncomeForm", true);
  $("addBillBtn").onclick = () => toggleForm("addBillForm", true);
  $("addOneBtn").onclick = () => toggleForm("addOneForm", true);
  document.querySelectorAll("[data-cancel]").forEach(b => b.onclick = () => toggleForm(b.dataset.cancel, false));
  CATS.forEach(c => { const o = document.createElement("option"); o.textContent = c; $("nbCat").appendChild(o); });
  $("addIncomeForm").addEventListener("submit", e => { e.preventDefault(); change(() => state.incomes.push({ id: uid(), name: $("niName").value.trim(), amount: +$("niAmt").value, counted: true, changes: [] })); e.target.reset(); toggleForm("addIncomeForm", false); });
  $("addBillForm").addEventListener("submit", e => { e.preventDefault(); change(() => state.bills.push({ id: uid(), name: $("nbName").value.trim(), category: $("nbCat").value, amount: +$("nbAmt").value, counted: true })); e.target.reset(); toggleForm("addBillForm", false); });
  $("addOneForm").addEventListener("submit", e => { e.preventDefault(); change(() => state.oneoffs.push({ id: uid(), month: sel.m, year: $("noYearly").checked ? null : sel.y, name: $("noName").value.trim(), amount: +$("noAmt").value })); e.target.reset(); $("noYearly").checked = true; toggleForm("addOneForm", false); });
  $("spendEdit").onclick = () => editMonthly(state.spending, "Spending money");
  const payField = (id, f, num = true) => $(id).addEventListener("change", e => change(() => { state.pay[f] = num ? +e.target.value || 0 : e.target.value; }));
  payField("pSalary", "salary"); payField("pPension", "pensionPct"); payField("pType", "pensionType", false); payField("pOther", "otherMonthly");

  // ---- screens and loading
  const show = (id) => ["login", "start", "main"].forEach(x => { $(x).hidden = x !== id; });
  function useState(s) {
    state = s; state.start ||= key(sel.y, sel.m);
    state.incomes ||= []; state.bills ||= []; state.oneoffs ||= [];
    state.spending ||= { id: "spend", name: "Spending money", amount: 0, changes: [] };
    state.pay ||= { salary: 0, pensionPct: 0, pensionType: "Salary sacrifice", otherMonthly: 0 };
    const st = { y: +state.start.slice(0, 4), m: +state.start.slice(5, 7) };
    const end = addMonths(st.y, st.m, 11);
    if (key(sel.y, sel.m) < state.start || key(sel.y, sel.m) > key(end.y, end.m)) sel = st;
    show("main"); setStatus("All changes saved"); render();
  }
  async function load() {
    setStatus("Loading your budget…");
    const { data, error } = await sb.from("budgets").select("data").eq("user_id", session.user.id).maybeSingle();
    if (error) { show("main"); setStatus("Couldn't load your budget. Check your connection and reload.", true); return; }
    if (data && data.data) useState(data.data);
    else show("start");
  }
  $("startBlank").onclick = () => {
    useState({
      start: key(sel.y, sel.m),
      pay: { salary: 0, pensionPct: 5, pensionType: "Salary sacrifice", otherMonthly: 0 },
      incomes: [{ id: "salary", name: "My salary", auto: "salary", note: "Take-home, worked out from My salary below", counted: true, changes: [] }],
      bills: [], oneoffs: [],
      spending: { id: "spend", name: "Spending money", amount: 0, changes: [] },
    });
    save();
  };
  document.querySelectorAll("[data-signout]").forEach(b => b.onclick = () => sb.auth.signOut());
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button"), err = $("login-error");
    btn.disabled = true; err.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
    btn.disabled = false;
    if (error) { err.textContent = "That email and password didn't match. Check them and try again."; err.hidden = false; }
  });
  sb.auth.onAuthStateChange((_event, s) => {
    const was = session?.user?.id;
    session = s;
    if (!s) { state = null; show("login"); return; }
    if (s.user.id !== was) load();
  });
})();
