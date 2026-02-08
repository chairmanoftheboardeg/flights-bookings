/* global EGR_CONFIG, escapeHtml, fmtTime, fmtDate, statusDotClass, prettyStatus, shortId, makeFakeBarcode */
/* global initSupabase, getSession, signIn, signUp, signOut, onAuthStateChange */

let session = null;
let flightsCache = [];
let bookingsCache = [];
let requestsCache = [];
let checkinsCache = [];
let alertsCache = [];

function setLoading(el, msg){ el.innerHTML = `<div class="notice">${escapeHtml(msg)}</div>`; }

function setAuthUI(){
  const authed = Boolean(session?.user);
  document.querySelector("[data-authed]").style.display = authed ? "block" : "none";
  document.querySelector("[data-unauthed]").style.display = authed ? "none" : "block";
  document.querySelectorAll("[data-auth-only]").forEach(n=>n.disabled = !authed);

  const who = document.querySelector("#who");
  who.textContent = authed ? (session.user.email || "Signed in") : "Not signed in";
}

async function fetchPublicFlights(date){
  const args = {};
  args[EGR_CONFIG.PARAM_PUBLIC_FLIGHTS_DATE] = date || null;
  const { data, error } = await window.supabaseClient.rpc(EGR_CONFIG.RPC_PUBLIC_FLIGHTS, args);
  if(error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchMyBookings(){
  const { data, error } = await window.supabaseClient
    .from("egr_bookings")
    .select("booking_id, flight_id, pnr, status, created_at, updated_at")
    .order("created_at", { ascending:false });
  if(error) throw error;
  return data || [];
}

async function fetchMyCheckinRequests(){
  const { data, error } = await window.supabaseClient
    .from("egr_checkin_requests")
    .select("request_id, booking_id, requested_seat, status, created_at, decided_at, decision_reason")
    .order("created_at", { ascending:false });
  if(error) throw error;
  return data || [];
}

async function fetchMyCheckins(){
  const { data, error } = await window.supabaseClient
    .from("egr_checkins")
    .select("checkin_id, booking_id, seat, boarding_group, checked_in_at");
  if(error) throw error;
  return data || [];
}

async function fetchAlerts(){
  const { data, error } = await window.supabaseClient
    .from("egr_alerts")
    .select("alert_id, audience, title, message, created_at")
    .order("created_at", { ascending:false })
    .limit(10);
  if(error) throw error;
  return data || [];
}

function flightLabel(f){
  if(!f) return "Unknown flight";
  return `${f.flight_number} • ${f.origin} → ${f.destination} • ${fmtDate(f.flight_date)} • STD ${fmtTime(f.sched_dep)}`;
}

function buildFlightMap(rows){
  const m = new Map();
  for(const r of rows){
    if(r.flight_id) m.set(r.flight_id, r);
  }
  return m;
}

function applyFlightFilters(rows){
  const date = document.querySelector("#flt_date").value || "";
  const origin = (document.querySelector("#flt_origin").value || "").trim().toUpperCase();
  const dest = (document.querySelector("#flt_dest").value || "").trim().toUpperCase();
  const q = (document.querySelector("#flt_q").value || "").trim().toLowerCase();

  return rows.filter(r=>{
    if(date && fmtDate(r.flight_date) !== date) return false;
    if(origin && String(r.origin||"").toUpperCase() !== origin) return false;
    if(dest && String(r.destination||"").toUpperCase() !== dest) return false;

    if(q){
      const hay = `${r.flight_number||""} ${r.origin||""} ${r.destination||""} ${r.status||""}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFlights(){
  const box = document.querySelector("#flightsBox");
  const rows = applyFlightFilters(flightsCache);

  if(rows.length === 0){
    box.innerHTML = `<div class="notice">No flights match your filters.</div>`;
    return;
  }

  const canBook = Boolean(session?.user);
  let html = `<table class="table">
    <thead><tr>
      <th>Flight</th>
      <th>Date</th>
      <th>Route</th>
      <th>STD</th>
      <th>Status</th>
      <th>Action</th>
    </tr></thead><tbody>`;

  for(const r of rows.slice(0, 40)){
    html += `<tr>
      <td><b>${escapeHtml(r.flight_number||"—")}</b></td>
      <td>${escapeHtml(fmtDate(r.flight_date))}</td>
      <td>${escapeHtml(r.origin||"—")} → ${escapeHtml(r.destination||"—")}</td>
      <td>${escapeHtml(fmtTime(r.sched_dep))}</td>
      <td>
        <span class="badge"><span class="dot-sm ${statusDotClass(r.status)}"></span>${escapeHtml(prettyStatus(r.status))}</span>
      </td>
      <td class="actions">
        <button class="btn primary" ${canBook ? "" : "disabled"} data-book="${escapeHtml(r.flight_id)}">Book</button>
      </td>
    </tr>`;
  }
  html += `</tbody></table>`;
  box.innerHTML = html;

  box.querySelectorAll("[data-book]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const flightId = btn.getAttribute("data-book");
      await createBooking(flightId, btn);
    });
  });
}

async function createBooking(flightId, btn){
  btn.disabled = true;
  btn.textContent = "Booking…";
  try{
    const args = {};
    args[EGR_CONFIG.PARAM_CREATE_BOOKING_FLIGHT_ID] = flightId;
    const { data, error } = await window.supabaseClient.rpc(EGR_CONFIG.RPC_CREATE_BOOKING, args);
    if(error) throw error;
    await refreshMyData();
    toast(`Booking confirmed. PNR: ${data?.pnr || "—"}`);
  }catch(err){
    console.error(err);
    toast(`Booking failed: ${err?.message || String(err)}`);
  }finally{
    btn.disabled = false;
    btn.textContent = "Book";
  }
}

function findRequestByBooking(bookingId){
  return requestsCache.find(r=>r.booking_id === bookingId) || null;
}
function findCheckinByBooking(bookingId){
  return checkinsCache.find(c=>c.booking_id === bookingId) || null;
}

function renderBookings(){
  const box = document.querySelector("#bookingsBox");
  if(!session?.user){
    box.innerHTML = `<div class="notice">Sign in to view your bookings.</div>`;
    return;
  }

  if(bookingsCache.length === 0){
    box.innerHTML = `<div class="notice">No bookings yet. Use the flight search above to book a seat.</div>`;
    return;
  }

  const flightMap = buildFlightMap(flightsCache);

  let html = `<table class="table">
    <thead><tr>
      <th>PNR</th>
      <th>Flight</th>
      <th>Status</th>
      <th>Online check-in</th>
      <th>Boarding pass</th>
    </tr></thead><tbody>`;

  for(const b of bookingsCache){
    const f = flightMap.get(b.flight_id);
    const req = findRequestByBooking(b.booking_id);
    const chk = findCheckinByBooking(b.booking_id);

    let ci = "Not requested";
    if(req) ci = `Request: ${req.status}`;
    if(chk) ci = `Checked in • Seat ${chk.seat || "—"} • Group ${chk.boarding_group || "—"}`;

    html += `<tr>
      <td class="mono"><b>${escapeHtml(b.pnr || "—")}</b><div style="color:var(--muted);font-size:12px;margin-top:2px;">${escapeHtml(shortId(b.booking_id))}</div></td>
      <td>${escapeHtml(f ? flightLabel(f) : (b.flight_id ? shortId(b.flight_id) : "—"))}</td>
      <td>${escapeHtml(b.status || "—")}</td>
      <td>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div>${escapeHtml(ci)}</div>
          <div class="actions">
            <button class="btn" data-ci="${escapeHtml(b.booking_id)}" ${req || chk ? "disabled" : ""}>Request check-in</button>
          </div>
        </div>
      </td>
      <td class="actions">
        <button class="btn primary" data-pass="${escapeHtml(b.booking_id)}" ${chk ? "" : "disabled"}>View</button>
      </td>
    </tr>`;
  }
  html += `</tbody></table>`;
  box.innerHTML = html;

  box.querySelectorAll("[data-ci]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const bookingId = btn.getAttribute("data-ci");
      await requestCheckin(bookingId, btn);
    });
  });

  box.querySelectorAll("[data-pass]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const bookingId = btn.getAttribute("data-pass");
      openPassModal(bookingId);
    });
  });
}

async function requestCheckin(bookingId, btn){
  const seat = (prompt("Requested seat (optional). Example: 12A") || "").trim();
  btn.disabled = true;
  btn.textContent = "Submitting…";
  try{
    const args = {};
    args[EGR_CONFIG.PARAM_REQUEST_CHECKIN_BOOKING_ID] = bookingId;
    args[EGR_CONFIG.PARAM_REQUEST_CHECKIN_SEAT] = seat || null;

    const { error } = await window.supabaseClient.rpc(EGR_CONFIG.RPC_REQUEST_CHECKIN, args);
    if(error) throw error;

    await refreshMyData();
    toast("Online check-in request submitted.");
  }catch(err){
    console.error(err);
    toast(`Request failed: ${err?.message || String(err)}`);
  }finally{
    btn.disabled = false;
    btn.textContent = "Request check-in";
  }
}

function renderAlerts(){
  const box = document.querySelector("#alertsBox");
  if(!alertsCache.length){
    box.innerHTML = `<div class="notice">No alerts at this time.</div>`;
    return;
  }
  let html = "";
  for(const a of alertsCache.slice(0,6)){
    html += `<div class="notice" style="margin-bottom:10px;">
      <b>${escapeHtml(a.title)}</b>
      <div style="margin-top:6px;">${escapeHtml(a.message)}</div>
      <div style="margin-top:8px; font-size:12px; color:var(--muted);">
        ${escapeHtml(new Date(a.created_at).toLocaleString())} • ${escapeHtml(a.audience)}
      </div>
    </div>`;
  }
  box.innerHTML = html;
}

function toast(msg){
  const el = document.querySelector("#toast");
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(()=>{ el.style.opacity = "0"; }, 3200);
}

function openPassModal(bookingId){
  const booking = bookingsCache.find(b=>b.booking_id === bookingId);
  const checkin = checkinsCache.find(c=>c.booking_id === bookingId);
  if(!booking || !checkin) return;

  const flightMap = buildFlightMap(flightsCache);
  const f = flightMap.get(booking.flight_id);

  const modal = document.querySelector("#modal");
  const body = document.querySelector("#modalBody");

  body.innerHTML = `
    <div class="pass">
      <div class="top">
        <div style="display:flex; align-items:center; gap:10px;">
          <img src="${escapeHtml(EGR_CONFIG.BRAND_LOGO_URL)}" alt="${escapeHtml(EGR_CONFIG.BRAND_NAME)}"/>
          <div>
            <div class="big">Boarding pass</div>
            <div style="color:var(--muted); font-size:13px;">${escapeHtml(EGR_CONFIG.BRAND_NAME)}</div>
          </div>
        </div>
        <div class="mono" style="font-weight:900; font-size:16px;">PNR ${escapeHtml(booking.pnr || "—")}</div>
      </div>

      <div class="mid">
        <div class="kv"><div class="k">Flight</div><div class="v">${escapeHtml(f?.flight_number || shortId(booking.flight_id))}</div></div>
        <div class="kv"><div class="k">From</div><div class="v">${escapeHtml(f?.origin || "—")}</div></div>
        <div class="kv"><div class="k">To</div><div class="v">${escapeHtml(f?.destination || "—")}</div></div>
        <div class="kv"><div class="k">Date</div><div class="v">${escapeHtml(fmtDate(f?.flight_date))}</div></div>

        <div class="kv"><div class="k">STD</div><div class="v">${escapeHtml(fmtTime(f?.sched_dep))}</div></div>
        <div class="kv"><div class="k">Seat</div><div class="v">${escapeHtml(checkin.seat || "—")}</div></div>
        <div class="kv"><div class="k">Group</div><div class="v">${escapeHtml(checkin.boarding_group || "—")}</div></div>
        <div class="kv"><div class="k">Status</div><div class="v">${escapeHtml(prettyStatus(f?.status))}</div></div>
      </div>

      <div class="barcode">
        <div class="fakecode mono">${escapeHtml(makeFakeBarcode(booking.pnr))}</div>
        <button class="btn primary" type="button" id="printPass">Print</button>
      </div>
    </div>

    <div class="spacer"></div>
    <div class="notice">
      Note: This is a virtual boarding pass for the Emirates Group Roblox experience.
    </div>
  `;

  body.querySelector("#printPass").addEventListener("click", ()=>{
    window.print();
  });

  modal.classList.add("open");
}

function closeModal(){
  document.querySelector("#modal").classList.remove("open");
}

async function refreshMyData(){
  if(!session?.user){
    bookingsCache = [];
    requestsCache = [];
    checkinsCache = [];
    alertsCache = [];
    renderBookings();
    renderAlerts();
    return;
  }

  const [bookings, reqs, checkins, alerts] = await Promise.all([
    fetchMyBookings(),
    fetchMyCheckinRequests(),
    fetchMyCheckins(),
    fetchAlerts()
  ]);

  bookingsCache = bookings;
  requestsCache = reqs;
  checkinsCache = checkins;
  alertsCache = alerts;

  renderBookings();
  renderAlerts();
}

async function refreshFlights(){
  const date = document.querySelector("#flt_date").value || null;
  setLoading(document.querySelector("#flightsBox"), "Loading flights…");
  try{
    flightsCache = await fetchPublicFlights(date);
    renderFlights();
  }catch(err){
    console.error(err);
    document.querySelector("#flightsBox").innerHTML = `
      <div class="notice">
        <b>Cannot load flights.</b><br/>
        This portal expects the public RPC <code>${escapeHtml(EGR_CONFIG.RPC_PUBLIC_FLIGHTS)}</code>.<br/>
        Error: <code>${escapeHtml(err?.message || String(err))}</code>
      </div>`;
  }
}

function bind(){
  document.querySelector("#year").textContent = new Date().getFullYear();

  document.querySelectorAll("[data-brand-logo]").forEach(img => img.src = EGR_CONFIG.BRAND_LOGO_URL);
  document.querySelector("[data-brand-name]").textContent = EGR_CONFIG.BRAND_NAME;
  document.querySelector("[data-brand-sub]").textContent = EGR_CONFIG.BRAND_SUBTITLE;

  document.querySelector("#loginForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const email = document.querySelector("#loginEmail").value.trim();
    const password = document.querySelector("#loginPassword").value;
    const btn = document.querySelector("#loginBtn");
    btn.disabled = true; btn.textContent = "Signing in…";
    try{
      const { error } = await signIn(email, password);
      if(error) throw error;
    }catch(err){
      toast(`Sign in failed: ${err?.message || String(err)}`);
    }finally{
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });

  document.querySelector("#signupForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const email = document.querySelector("#signupEmail").value.trim();
    const password = document.querySelector("#signupPassword").value;
    const btn = document.querySelector("#signupBtn");
    btn.disabled = true; btn.textContent = "Creating…";
    try{
      const { error } = await signUp(email, password);
      if(error) throw error;
      toast("Account created. Check your inbox if email confirmation is enabled.");
    }catch(err){
      toast(`Sign up failed: ${err?.message || String(err)}`);
    }finally{
      btn.disabled = false; btn.textContent = "Create account";
    }
  });

  document.querySelector("#signoutBtn").addEventListener("click", async ()=>{
    await signOut();
  });

  document.querySelector("#flt_date").value = new Date().toISOString().slice(0,10);
  for(const id of ["flt_date","flt_origin","flt_dest","flt_q"]){
    const el = document.querySelector("#"+id);
    el.addEventListener("input", ()=>renderFlights());
    el.addEventListener("change", ()=>refreshFlights());
  }
  document.querySelector("#refreshFlights").addEventListener("click", ()=>refreshFlights());

  document.querySelector("#modal").addEventListener("click", (e)=>{
    if(e.target.id === "modal" || e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape") closeModal();
  });
}

window.addEventListener("DOMContentLoaded", async ()=>{
  await initSupabase();
  window.supabaseClient = supabaseClient;

  bind();

  session = await getSession();
  setAuthUI();

  onAuthStateChange(async (s)=>{
    session = s;
    setAuthUI();
    await refreshMyData();
    renderFlights();
  });

  await refreshFlights();
  await refreshMyData();
});
