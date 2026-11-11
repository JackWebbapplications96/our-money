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
    const ex = extrasFor(y, m);
    const extra = ex.filter(o => o.counted !== false).reduce((t, o) => t + (+o.amount || 0), 0);
    const inc = state.incomes.filter(i => i.counted).reduce((t, i) => t + amountFor(i, k), 0) + extra;
    const uncounted = state.incomes.filter(i => !i.counted).reduce((t, i) => t + amountFor(i, k), 0)
      + ex.filter(o => o.counted === false).reduce((t, o) => t + (+o.amount || 0), 0);
    const bills = state.bills.filter(b => b.counted && (!b.lastMonth || b.lastMonth >= k)).reduce((t, b) => t + (+b.amount || 0), 0);
    const spend = amountFor(state.spending, k);
    const ones = oneOffsFor(y, m).reduce((t, o) => t + (+o.amount || 0), 0);
    const out = bills + spend + ones;
    return { inc, uncounted, bills, spend, ones, out, left: inc - out };
  }
  const extrasFor = (y, m) => (state.extras || []).filter(o => +o.month === m && (!o.year || +o.year === y));
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

  // ---- one-off editor
  let editOne = null, editOneList = "oneoffs";
  (() => {
    MONTHS.forEach((m, i) => $("oMonth").appendChild(new Option(m, String(i + 1))));
    const y0 = new Date().getFullYear();
    $("oYear").appendChild(new Option("Every year", ""));
    for (let y = y0 - 1; y <= y0 + 5; y++) $("oYear").appendChild(new Option(`Just ${y}`, String(y)));
  })();
  function openOne(o, list = "oneoffs") {
    editOne = o; editOneList = list;
    $("oneTitle").textContent = list === "extras" ? "Edit one-off income" : "Edit one-off";
    $("oCountedRow").hidden = list !== "extras";
    $("oCounted").checked = o.counted !== false;
    $("oName").value = o.name; $("oAmt").value = o.amount;
    $("oMonth").value = String(o.month); $("oYear").value = o.year ? String(o.year) : "";
    $("onePop").classList.add("open"); setTimeout(() => $("oName").focus(), 30);
  }
  const closeOne = () => { $("onePop").classList.remove("open"); editOne = null; };
  $("oneCancel").onclick = closeOne;
  $("onePop").addEventListener("click", e => { if (e.target.id === "onePop") closeOne(); });
  $("oneDelete").onclick = () => { const o = editOne; closeOne(); const l = editOneList; change(() => { state[l] = state[l].filter(z => z !== o); }); };
  $("oneForm").addEventListener("submit", e => {
    e.preventDefault();
    const o = editOne, l = editOneList, name = $("oName").value.trim(), amt = parseFloat($("oAmt").value);
    if (!name || isNaN(amt)) return;
    const counted = $("oCounted").checked;
    closeOne();
    change(() => { o.name = name; o.amount = amt; o.month = +$("oMonth").value; o.year = $("oYear").value ? +$("oYear").value : null; if (l === "extras") o.counted = counted; });
  });

  // ---- income editor
  let editInc = null;
  function drawChanges() {
    const box = $("iChanges"); box.innerHTML = "";
    const list = editInc.changes || [];
    if (!list.length) { box.appendChild(el("div", "empty", "No month-by-month changes.")); return; }
    list.forEach((c, idx) => {
      const r = el("div", "chg");
      const when = c.to === c.from ? monthName(c.from) : c.to ? `${monthName(c.from)} to ${monthName(c.to)}` : `From ${monthName(c.from)}`;
      r.append(el("span", null, when), el("b", "num", gbp(c.amount)));
      const x = el("button", "x", "×"); x.type = "button"; x.setAttribute("aria-label", `Remove change for ${when}`);
      x.onclick = () => { list.splice(idx, 1); drawChanges(); };
      r.appendChild(x); box.appendChild(r);
    });
  }
  function openInc(i) {
    editInc = i;
    $("iName").value = i.name; $("iNote").value = i.note || "";
    const auto = i.auto === "salary";
    $("iAmt").value = auto ? Math.round(pay(state.pay).take * 100) / 100 : i.amount;
    $("iAmt").disabled = auto; $("iAmtHint").hidden = !auto;
    $("iCounted").checked = !!i.counted;
    $("incDelete").hidden = auto;
    editInc._changesBefore = JSON.stringify(i.changes || []);
    drawChanges();
    $("incPop").classList.add("open"); setTimeout(() => $("iName").focus(), 30);
  }
  const closeInc = (keep) => {
    if (editInc && !keep) editInc.changes = JSON.parse(editInc._changesBefore);
    if (editInc) delete editInc._changesBefore;
    $("incPop").classList.remove("open"); editInc = null;
  };
  $("incCancel").onclick = () => closeInc(false);
  $("incPop").addEventListener("click", e => { if (e.target.id === "incPop") closeInc(false); });
  $("incDelete").onclick = () => { const i = editInc; closeInc(true); change(() => { state.incomes = state.incomes.filter(z => z !== i); }); };
  $("incForm").addEventListener("submit", e => {
    e.preventDefault();
    const i = editInc, name = $("iName").value.trim(), amt = parseFloat($("iAmt").value);
    if (!name || (!i.auto && isNaN(amt))) return;
    closeInc(true);
    change(() => { i.name = name; i.note = $("iNote").value.trim(); i.counted = $("iCounted").checked; if (!i.auto) i.amount = amt; });
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (editOne) closeOne(); if (editInc) closeInc(false); } });

  // ---- savings goals
  const todayKey = () => { const d = new Date(); return key(d.getFullYear(), d.getMonth() + 1); };
  const putInMonth = (k) => state.goals.reduce((t, g) => t + (g.log || []).filter(l => l.month === k).reduce((a, l) => a + +l.amount, 0), 0);
  function goalPlan() {
    // Simulate future months: each month a share of what's left goes to goals, in order.
    const rem = state.goals.map(g => Math.max(0, (+g.target || 0) - (+g.saved || 0)));
    const done = state.goals.map((g, i) => (rem[i] <= 0.005 ? "done" : null));
    const now = new Date(); let cur = { y: now.getFullYear(), m: now.getMonth() + 1 };
    const pct = (+state.savePct || 0) / 100;
    for (let n = 0; n < 240 && done.some(d => !d); n++) {
      const k = key(cur.y, cur.m);
      let pot = Math.max(0, monthTotals(cur.y, cur.m).left * pct);
      if (n === 0) pot = Math.max(0, pot - putInMonth(k));
      for (let i = 0; i < rem.length && pot > 0.005; i++) {
        if (done[i]) continue;
        const use = Math.min(pot, rem[i]); rem[i] -= use; pot -= use;
        if (rem[i] <= 0.005) done[i] = k;
      }
      cur = addMonths(cur.y, cur.m, 1);
    }
    return done;
  }
  let editGoal = null;
  function openGoal(g) {
    editGoal = g;
    $("gTitle").textContent = g ? "Edit goal" : "New goal";
    $("gName").value = g ? g.name : ""; $("gKind").value = g ? g.kind : "save";
    $("gTarget").value = g ? g.target : ""; $("gSaved").value = g ? g.saved : 0;
    $("goalDelete").hidden = !g;
    $("goalPop").classList.add("open"); setTimeout(() => $("gName").focus(), 30);
  }
  const closeGoal = () => { $("goalPop").classList.remove("open"); editGoal = null; };
  $("goalCancel").onclick = closeGoal;
  $("goalPop").addEventListener("click", e => { if (e.target.id === "goalPop") closeGoal(); });
  $("goalDelete").onclick = () => { const g = editGoal; closeGoal(); change(() => { state.goals = state.goals.filter(z => z !== g); }); };
  $("goalForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("gName").value.trim(), target = parseFloat($("gTarget").value), saved = parseFloat($("gSaved").value) || 0;
    if (!name || isNaN(target)) return;
    const g = editGoal; closeGoal();
    change(() => {
      if (g) Object.assign(g, { name, kind: $("gKind").value, target, saved });
      else state.goals.push({ id: uid(), name, kind: $("gKind").value, target, saved, log: [] });
    });
  });
  $("addGoalBtn").onclick = () => openGoal(null);
  $("savePct").addEventListener("change", e => change(() => { state.savePct = Math.min(100, Math.max(0, +e.target.value || 0)); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("goalPop").classList.contains("open")) closeGoal(); });

  function renderGoals(T) {
    const pct = +state.savePct || 0;
    $("savePct").value = pct; $("bufPct").textContent = `${100 - pct}%`;
    const left = Math.max(0, T.left), toGoals = left * pct / 100, spare = left - toGoals;
    const mName = MONTHS[sel.m - 1];
    $("goalSplit").innerHTML = "";
    const a = el("div", "split"); a.append(el("span", null, "Towards goals"), el("b", "num", gbp(toGoals, 0)));
    const b = el("div", "split"); b.append(el("span", null, "Keep spare"), el("b", "num", gbp(spare, 0)));
    $("goalSplit").append(a, b);
    $("goalSplitNote").textContent = T.left > 0
      ? `Based on ${gbp(T.left, 0)} left over in ${mName}. If the spare isn't needed, add it to a goal at the end of the month.`
      : `Nothing left over in ${mName}, so nothing to put towards goals.`;
    const list = $("goalRows"); list.innerHTML = "";
    if (!state.goals.length) list.appendChild(el("div", "empty", "No goals yet. Add debts to clear first, then things you're saving for."));
    const plan = goalPlan();
    state.goals.forEach((g, i) => {
      const saved = +g.saved || 0, target = +g.target || 0, p = target ? Math.min(1, saved / target) : 0;
      const row = el("div", "goal" + (g.kind === "debt" ? " debt" : ""));
      const top = el("div", "goal-top");
      const nm = el("button", "name namebtn", g.name); nm.onclick = () => openGoal(g);
      nm.appendChild(el("small", null, g.kind === "debt" ? "Paying off" : "Saving up"));
      const by = plan[i] === "done" ? "Done" : plan[i] ? `On track for ${monthName(plan[i])}` : "Over 20 years away";
      const eta = el("span", "eta" + (plan[i] === "done" ? " ok" : ""), by);
      const ctr = el("div", "goal-ctrls");
      const add = el("button", "chip on", g.kind === "debt" ? "+ Pay" : "+ Add");
      add.onclick = () => openPop(`${g.kind === "debt" ? "Pay towards" : "Add to"} ${g.name}`, Math.min(toGoals || 0, Math.max(0, target - saved)), [
        { label: g.kind === "debt" ? "Record payment" : "Add to savings", sub: "Counts as this month's goal money", run: v => change(() => { g.saved = saved + v; (g.log ||= []).push({ month: todayKey(), amount: v }); }) },
      ]);
      ctr.appendChild(add);
      if (i > 0) { const up = el("button", "x", "↑"); up.setAttribute("aria-label", `Move ${g.name} up`); up.onclick = () => change(() => { const s = state.goals; [s[i - 1], s[i]] = [s[i], s[i - 1]]; }); ctr.appendChild(up); }
      top.append(nm, eta, ctr);
      const bar = el("div", "gbar"); const fill = el("div", "gfill"); fill.style.width = `${p * 100}%`; bar.appendChild(fill);
      const meta = el("div", "goal-meta");
      meta.append(el("span", "num", g.kind === "debt" ? `${gbp(saved, 0)} paid of ${gbp(target, 0)}` : `${gbp(saved, 0)} of ${gbp(target, 0)}`),
                  el("span", "num", saved >= target ? "Complete" : `${gbp(target - saved, 0)} to go`));
      row.append(top, bar, meta); list.appendChild(row);
    });
  }

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
      const nm = el("button", "name namebtn", i.name); nm.setAttribute("aria-label", `Edit ${i.name}`);
      nm.onclick = () => openInc(i);
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
    const exr = $("extraRows"); exr.innerHTML = "";
    const exs = extrasFor(sel.y, sel.m);
    $("extraHead").hidden = !exs.length;
    exs.forEach(o => {
      const off = o.counted === false;
      const row = el("div", "row" + (off ? " off" : "")); row.style.gridTemplateColumns = "1fr auto auto auto";
      const nm = el("button", "name namebtn", o.name); nm.setAttribute("aria-label", `Edit ${o.name}`);
      nm.onclick = () => openOne(o, "extras");
      nm.appendChild(el("small", null, o.year ? `Just ${MONTHS[o.month - 1]} ${o.year}` : `Every ${MONTHS[o.month - 1]}`));
      const amt = el("button", "amt", gbp(o.amount)); amt.onclick = () => openOne(o, "extras");
      const chip = el("button", "chip" + (off ? "" : " on"), off ? "Not counted" : "Counted");
      chip.onclick = () => change(() => { o.counted = off; });
      const x = el("button", "x", "×"); x.setAttribute("aria-label", `Remove ${o.name}`);
      x.onclick = () => change(() => { state.extras = state.extras.filter(z => z !== o); });
      row.append(nm, amt, chip, x); exr.appendChild(row);
    });
    $("addExtraMonth").textContent = mName;
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
      const nm = el("button", "name namebtn", o.name); nm.setAttribute("aria-label", `Edit ${o.name}`);
      nm.onclick = () => openOne(o);
      nm.appendChild(el("small", null, o.year ? `Just ${MONTHS[o.month - 1]} ${o.year}` : `Every ${MONTHS[o.month - 1]}`));
      const amt = el("button", "amt", gbp(o.amount)); amt.onclick = () => openPop(o.name, +o.amount, [{ label: "Save", run: v => change(() => { o.amount = v; }) }]);
      const x = el("button", "x", "×"); x.setAttribute("aria-label", `Remove ${o.name}`);
      x.onclick = () => change(() => { state.oneoffs = state.oneoffs.filter(z => z !== o); });
      row.append(nm, amt, x); orow.appendChild(row);
    });
    $("sumOne").textContent = ones.length ? gbp(T.ones, 0) : "";

    renderGoals(T);
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
  $("addExtraBtn").onclick = () => toggleForm("addExtraForm", true);
  $("addExtraForm").addEventListener("submit", e => { e.preventDefault(); change(() => (state.extras ||= []).push({ id: uid(), month: sel.m, year: $("neYearly").checked ? null : sel.y, name: $("neName").value.trim(), amount: +$("neAmt").value, counted: true })); e.target.reset(); toggleForm("addExtraForm", false); });
  $("addBillForm").addEventListener("submit", e => { e.preventDefault(); change(() => state.bills.push({ id: uid(), name: $("nbName").value.trim(), category: $("nbCat").value, amount: +$("nbAmt").value, counted: true })); e.target.reset(); toggleForm("addBillForm", false); });
  $("addOneForm").addEventListener("submit", e => { e.preventDefault(); change(() => state.oneoffs.push({ id: uid(), month: sel.m, year: $("noYearly").checked ? null : sel.y, name: $("noName").value.trim(), amount: +$("noAmt").value })); e.target.reset(); $("noYearly").checked = true; toggleForm("addOneForm", false); });
  $("spendEdit").onclick = () => editMonthly(state.spending, "Spending money");
  const payField = (id, f, num = true) => $(id).addEventListener("change", e => change(() => { state.pay[f] = num ? +e.target.value || 0 : e.target.value; }));
  payField("pSalary", "salary"); payField("pPension", "pensionPct"); payField("pType", "pensionType", false); payField("pOther", "otherMonthly");

  // ---- screens and loading
  const show = (id) => ["login", "start", "main"].forEach(x => { $(x).hidden = x !== id; });
  function useState(s) {
    state = s; state.start ||= key(sel.y, sel.m);
    state.incomes ||= []; state.bills ||= []; state.oneoffs ||= []; state.extras ||= []; state.goals ||= []; if (state.savePct == null) state.savePct = 75;
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
