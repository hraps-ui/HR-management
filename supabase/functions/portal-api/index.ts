import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const PROJECT_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const BOOTSTRAP_ID = (Deno.env.get("PORTAL_BOOTSTRAP_ADMIN_ID") || "").trim();
const BOOTSTRAP_PASSWORD = Deno.env.get("PORTAL_BOOTSTRAP_ADMIN_PASSWORD") || "";
const ALLOWED_ORIGIN = "https://hraps-ui.github.io";
const VERSION0 = "0";

type AnyRow = Record<string, any>;
const emptyState = () => ({
  emp: [], vac: [], cand: [], lett: [], dsg: [], grievances: [],
  salarySlips: [], nid: 100, _cloudSeeded: false
});
const json = (body: unknown, status = 200, origin = ALLOWED_ORIGIN) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "Origin",
      "cache-control": "no-store"
    }
  });
function hex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
function unhex(s: string) { const a = new Uint8Array(Math.floor(s.length / 2)); for (let i=0;i<a.length;i++) a[i] = parseInt(s.slice(i*2,i*2+2),16); return a; }
function randomHex(n = 32) { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }
async function passwordHash(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt:unhex(saltHex), iterations:120000, hash:"SHA-256" }, key, 256);
  return hex(new Uint8Array(bits));
}
async function tokenHash(token: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}
async function db(path: string, init: RequestInit = {}): Promise<any> {
  if (!PROJECT_URL || !SERVICE_KEY) throw new Error("Supabase server secrets are missing. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for this Edge Function.");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SERVICE_KEY);
  headers.set("authorization", "Bearer " + SERVICE_KEY);
  headers.set("content-type", "application/json");
  const response = await fetch(PROJECT_URL + "/rest/v1/" + path, { ...init, headers });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error((data && (data.message || data.error_description || data.hint)) || ("Supabase database request failed (" + response.status + ")"));
  return data;
}
const filter = (s: string) => encodeURIComponent(s);
async function stateRow(): Promise<AnyRow> {
  let rows = await db("portal_state?select=id,payload,version,updated_at&id=eq.1&limit=1");
  if (!Array.isArray(rows) || !rows.length) {
    await db("rpc/bootstrap_portal_state", { method:"POST", body:JSON.stringify({p_payload:emptyState(),p_version:VERSION0}) });
    rows = await db("portal_state?select=id,payload,version,updated_at&id=eq.1&limit=1");
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error("Shared HR database could not be initialized. Run the SQL migration first.");
  return rows[0];
}
const keyOf = (e: AnyRow) => String(e && (e.code || e.empCode || e.employeeCode || e.employeeId || e.id) || "").trim();
const same = (a: unknown, b: unknown) => String(a ?? "").trim() === String(b ?? "").trim();
async function rootRows() {
  return await db("portal_users?select=*&user_type=eq.admin_root&limit=1") as AnyRow[];
}
async function createRoot(id: string, password: string) {
  const salt = randomHex(16);
  const hash = await passwordHash(password, salt);
  try {
    await db("portal_users", { method:"POST", headers:{prefer:"return=minimal"}, body:JSON.stringify({
      login_id:id, login_key:id.toLowerCase(), user_type:"admin_root", role:"admin",
      password_salt:salt, password_hash:hash, active:true
    })});
  } catch (e) {
    const existing = await rootRows();
    if (!existing.length) throw e;
  }
  return (await rootRows())[0];
}
async function makeSession(user: AnyRow) {
  const token = randomHex(32);
  await db("portal_sessions", { method:"POST", headers:{prefer:"return=minimal"}, body:JSON.stringify({
    token_hash:await tokenHash(token), user_id:user.id,
    expires_at:new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  })});
  return token;
}
async function validate(token: string) {
  if (!token) return null;
  const hash = await tokenHash(token);
  const rows = await db("portal_sessions?select=token_hash,user_id,expires_at&token_hash=eq." + filter(hash) + "&expires_at=gt." + filter(new Date().toISOString()) + "&limit=1");
  if (!Array.isArray(rows) || !rows.length) return null;
  const users = await db("portal_users?select=*&id=eq." + filter(rows[0].user_id) + "&limit=1");
  if (!Array.isArray(users) || !users.length || users[0].active !== true) return null;
  return users[0] as AnyRow;
}
async function verify(password: string, user: AnyRow) {
  return await passwordHash(password, String(user.password_salt || "")) === String(user.password_hash || "");
}
async function createEmployeeAccount(id: string, person: AnyRow, role: string, password: string) {
  const salt = randomHex(16);
  const hash = await passwordHash(password, salt);
  const recordId = String(person.id ?? id);
  const body = {
    login_id:id, login_key:id.toLowerCase(), user_type:"employee",
    role, employee_record_id:recordId, password_salt:salt,
    password_hash:hash, active:true
  };
  try {
    await db("portal_users", { method:"POST", headers:{prefer:"return=representation"}, body:JSON.stringify(body) });
  } catch (e) {
    const rows = await db("portal_users?select=*&login_key=eq." + filter(id.toLowerCase()) + "&limit=1");
    if (!Array.isArray(rows) || !rows.length) throw e;
    if (!await verify(password, rows[0])) throw new Error("Employee ID or password is incorrect.");
    return rows[0] as AnyRow;
  }
  const rows = await db("portal_users?select=*&login_key=eq." + filter(id.toLowerCase()) + "&limit=1");
  if (!Array.isArray(rows) || !rows.length) throw new Error("Could not create employee portal account.");
  return rows[0] as AnyRow;
}
function scopedPayload(payload: AnyRow, user: AnyRow) {
  if (user.role === "admin") return payload;
  const person = (payload.emp || []).find((e: AnyRow) => same(e.id, user.employee_record_id));
  const code = keyOf(person || {});
  const grievances = (payload.grievances || []).filter((g: AnyRow) => same(g.code || g.empCode || g.employeeCode, code));
  return {
    emp: person ? [person] : [], vac: [], cand: [], lett: [], dsg: [],
    grievances, salarySlips: [], nid: Number(payload.nid || 100),
    _cloudSeeded: payload._cloudSeeded === true
  };
}
async function writeState(expected: string, payload: AnyRow) {
  const latest = await stateRow();
  if (String(latest.version) !== String(expected)) return { ok:false, conflict:true, hash:String(latest.version) };
  const next = crypto.randomUUID();
  payload._cloudSeeded = true;
  const changed = await db("rpc/compare_and_swap_portal_state", {
    method:"POST",
    body:JSON.stringify({p_expected_version:String(expected),p_payload:payload,p_new_version:next})
  });
  if (changed !== true) {
    const now = await stateRow();
    return { ok:false, conflict:true, hash:String(now.version) };
  }
  await syncEmployeeAccounts(payload);
  return { ok:true, hash:next };
}
async function syncEmployeeAccounts(payload: AnyRow) {
  const accounts = await db("portal_users?select=id,employee_record_id,user_type,role,active&user_type=eq.employee");
  for (const account of (Array.isArray(accounts) ? accounts : [])) {
    const person = (payload.emp || []).find((e: AnyRow) => same(e.id, account.employee_record_id));
    if (!person || person.status === "Resigned") {
      await db("portal_users?id=eq." + filter(account.id), { method:"PATCH", headers:{prefer:"return=minimal"}, body:JSON.stringify({active:false,updated_at:new Date().toISOString()}) });
      await db("portal_sessions?user_id=eq." + filter(account.id), { method:"DELETE", headers:{prefer:"return=minimal"} });
      continue;
    }
    const role = String(person.portalRole || "User").toLowerCase() === "admin" ? "admin" : "employee";
    if (account.role !== role || account.active !== true) {
      await db("portal_users?id=eq." + filter(account.id), { method:"PATCH", headers:{prefer:"return=minimal"}, body:JSON.stringify({role,active:true,updated_at:new Date().toISOString()}) });
      await db("portal_sessions?user_id=eq." + filter(account.id), { method:"DELETE", headers:{prefer:"return=minimal"} });
    }
  }
}
async function handle(action: string, args: any[]) {
  if (action === "api_login") {
    const loginId = String(args[0] || "").trim(), password = String(args[1] || "");
    if (!loginId || !password) return {ok:false,msg:"Enter your ID and password."};
    const roots = await rootRows();
    let user: AnyRow | null = roots.find((u: AnyRow) => String(u.login_key).toLowerCase() === loginId.toLowerCase()) || null;
    if (!user && !roots.length && BOOTSTRAP_ID && BOOTSTRAP_PASSWORD && loginId === BOOTSTRAP_ID && password === BOOTSTRAP_PASSWORD) {
      user = await createRoot(BOOTSTRAP_ID, BOOTSTRAP_PASSWORD);
      await stateRow();
    }
    if (user && user.user_type === "admin_root") {
      if (!await verify(password, user)) return {ok:false,msg:"Employee ID or password is incorrect."};
      const token = await makeSession(user);
      return {ok:true,token,role:"admin",empId:null,adminId:user.login_id};
    }
    const row = await stateRow();
    const payload = row.payload || emptyState();
    const person = (payload.emp || []).find((e: AnyRow) => keyOf(e).toLowerCase() === loginId.toLowerCase());
    if (!person || person.status === "Resigned") return {ok:false,msg:"Employee ID not found or account is inactive. HR Admin must first import the employee directory."};
    let employeeUserRows = await db("portal_users?select=*&login_key=eq." + filter(loginId.toLowerCase()) + "&limit=1");
    const assignedRole = String(person.portalRole || "User").toLowerCase() === "admin" ? "admin" : "employee";
    if (!employeeUserRows.length) {
      const defaultPassword = "aps@" + keyOf(person);
      if (password !== defaultPassword) return {ok:false,msg:"Employee ID or password is incorrect. First login password is aps@ followed by your employee code."};
      user = await createEmployeeAccount(loginId, person, assignedRole, password);
    } else {
      user = employeeUserRows[0];
      if (user.user_type !== "employee" || user.active !== true || !await verify(password, user)) return {ok:false,msg:"Employee ID or password is incorrect, or this account is inactive."};
      await db("portal_users?id=eq." + filter(user.id), {method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({
        login_id:loginId, role:assignedRole, employee_record_id:String(person.id ?? loginId),
        active:true, updated_at:new Date().toISOString()
      })});
      user.role = assignedRole;
    }
    const token = await makeSession(user);
    return {ok:true,token,role:assignedRole,empId:person.id ?? null,employeeCode:keyOf(person)};
  }
  const token = String(args[0] || "");
  const user = await validate(token);
  if (!user) return {ok:false,sessionLost:true,msg:"Your session expired. Please login again."};

  if (action === "api_logout") {
    await db("portal_sessions?token_hash=eq." + filter(await tokenHash(token)), {method:"DELETE",headers:{prefer:"return=minimal"}});
    return {ok:true};
  }
  if (action === "api_load" || action === "api_poll") {
    const row = await stateRow(), payload = row.payload || emptyState(), version = String(row.version);
    if (action === "api_poll" && version === String(args[1] || "")) return {ok:true,changed:false,hash:version};
    return {
      ok:true, changed:true, hash:version,
      data:JSON.stringify(scopedPayload(payload,user)),
      needsSeed:user.role === "admin" && payload._cloudSeeded !== true
    };
  }
  if (action === "api_save") {
    if (user.role !== "admin") return {ok:false,msg:"Only HR Admin can update the shared database."};
    let payload: AnyRow;
    try { payload = JSON.parse(String(args[2] || "{}")); } catch { return {ok:false,msg:"Invalid data payload."}; }
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.emp)) return {ok:false,msg:"Invalid HR data. No changes were saved."};
    const res = await writeState(String(args[1] || ""), payload);
    return res.ok ? {ok:true,hash:res.hash} : {ok:false,conflict:true,hash:res.hash,msg:"The shared data changed on another device. The latest version has been preserved; reload before editing again."};
  }
  if (action === "api_submitGrievance") {
    if (user.user_type !== "employee" || user.role === "admin") return {ok:false,msg:"Employee self-service grievance submission is not available for this account."};
    const grievance = args[1];
    if (!grievance || typeof grievance !== "object") return {ok:false,msg:"Invalid grievance."};
    for (let attempt=0; attempt<4; attempt++) {
      const row = await stateRow(), payload = row.payload || emptyState();
      const person = (payload.emp || []).find((e: AnyRow) => same(e.id, user.employee_record_id));
      if (!person || person.status === "Resigned") return {ok:false,msg:"Your employee profile is no longer active."};
      const code = keyOf(person);
      if (String(grievance.code || grievance.empCode || "").trim().toLowerCase() !== code.toLowerCase()) return {ok:false,msg:"Employee identity could not be verified for this grievance."};
      payload.grievances = payload.grievances || [];
      grievance.id = grievance.id || Number(payload.nid || 100);
      payload.nid = Math.max(Number(payload.nid || 100), Number(grievance.id) + 1);
      payload.grievances.unshift(grievance);
      const res = await writeState(String(row.version), payload);
      if (res.ok) return {ok:true,grievance,hash:res.hash};
      if (!res.conflict) return {ok:false,msg:"Could not save grievance."};
    }
    return {ok:false,msg:"Another update is in progress. Please submit the grievance again."};
  }
  if (action === "api_info") {
    if (user.user_type !== "admin_root") return {ok:false,msg:"Only the main HR Admin account can change login settings."};
    const roots = await rootRows();
    return {ok:true,adminId:roots[0]?.login_id || "",viewerId:""};
  }
  if (action === "api_setCred") {
    const role = String(args[1] || ""), id = String(args[2] || "").trim(), pw = String(args[3] || ""), current = String(args[4] || "");
    if (user.user_type !== "admin_root" || role !== "admin") return {ok:false,msg:"Only the main HR Admin account can change the main login. Use Employee Portal Access to manage other users."};
    if (id.length < 3 || pw.length < 10) return {ok:false,msg:"Admin ID must be at least 3 characters and password at least 10 characters."};
    if (!await verify(current,user)) return {ok:false,msg:"Current admin password is incorrect."};
    const salt = randomHex(16), hash = await passwordHash(pw,salt);
    await db("portal_users?id=eq." + filter(user.id), {method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({
      login_id:id, login_key:id.toLowerCase(), password_salt:salt, password_hash:hash,
      updated_at:new Date().toISOString()
    })});
    return {ok:true,adminId:id};
  }
  if (action === "api_changeEmployeePassword") {
    if (user.user_type !== "employee" || String(args[1] || "") !== String(user.employee_record_id || "")) return {ok:false,msg:"You can change only your own employee password."};
    const current = String(args[2] || ""), next = String(args[3] || "");
    if (!await verify(current,user)) return {ok:false,msg:"Current password is incorrect."};
    if (next.length < 8) return {ok:false,msg:"New password must be at least 8 characters."};
    const salt = randomHex(16), hash = await passwordHash(next,salt);
    await db("portal_users?id=eq." + filter(user.id), {method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({
      password_salt:salt,password_hash:hash,updated_at:new Date().toISOString()
    })});
    return {ok:true};
  }
  return {ok:false,msg:"Unsupported cloud action: " + action};
}
serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", {status:204,headers:{
    "access-control-allow-origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "access-control-allow-headers":"authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods":"POST, OPTIONS","vary":"Origin"
  }});
  if (origin && origin !== ALLOWED_ORIGIN) return json({ok:false,msg:"Origin not allowed."},403);
  if (req.method !== "POST") return json({ok:false,msg:"POST required."},405);
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const args = Array.isArray(body?.args) ? body.args : [];
    const result = await handle(action,args);
    return json(result, 200, ALLOWED_ORIGIN);
  } catch (error) {
    return json({ok:false,msg:error instanceof Error ? error.message : "Unexpected server error."},500,ALLOWED_ORIGIN);
  }
});
