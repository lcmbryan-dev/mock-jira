"use strict";

const TOKEN_KEY = "mock-bank-token";
const $ = (id) => document.getElementById(id);
const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

let token = sessionStorage.getItem(TOKEN_KEY);
let accounts = [];
let selectedId = null;

// Every backend call goes through here so it shows up as a clean fetch/XHR in DevTools.
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    if (res.status === 401 && token) signOut();
    throw Object.assign(new Error(data.error.message), { status: res.status, code: data.error.code });
  }
  return data;
}

function show(view) {
  $("login-view").hidden = view !== "login";
  $("app-view").hidden = view !== "app";
}

function signOut() {
  token = null;
  sessionStorage.removeItem(TOKEN_KEY);
  show("login");
}

async function enterApp() {
  const me = await api("GET", "/api/me");
  $("welcome").textContent = `Hello, ${me.fullName}`;
  show("app");
  await refreshAccounts();
}

async function refreshAccounts() {
  accounts = (await api("GET", "/api/accounts")).accounts;
  if (!accounts.some((a) => a.id === selectedId)) selectedId = accounts[0]?.id ?? null;

  $("accounts").innerHTML = "";
  for (const a of accounts) {
    const li = document.createElement("li");
    li.className = "account" + (a.id === selectedId ? " selected" : "");
    li.dataset.testid = `account-${a.id}`;
    li.innerHTML = `<span>${a.type} <small class="muted">#${a.id}</small></span><strong>${money(a.balance)}</strong>`;
    li.addEventListener("click", () => { selectedId = a.id; refreshAccounts(); });
    $("accounts").append(li);
  }
  $("from").innerHTML = accounts.map((a) => `<option value="${a.id}">${a.type} #${a.id} (${money(a.balance)})</option>`).join("");
  if (selectedId) $("from").value = selectedId;
  await refreshTransactions();
}

async function refreshTransactions() {
  $("tx-account").textContent = selectedId ? `— account #${selectedId}` : "";
  const body = $("transactions");
  body.innerHTML = "";
  if (!selectedId) return;
  const { transactions } = await api("GET", `/api/accounts/${selectedId}/transactions?limit=10`);
  for (const t of transactions) {
    const credit = t.type === "deposit" || t.type === "transfer_in";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${new Date(t.date).toLocaleString()}</td><td>${t.id}</td><td></td><td>${t.type}</td>` +
      `<td class="num ${credit ? "credit" : "debit"}">${credit ? "+" : "−"}${money(t.amount)}</td><td class="num">${money(t.balanceAfter)}</td>`;
    tr.children[2].textContent = t.description; // user-supplied text: avoid innerHTML
    body.append(tr);
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("login-error");
  err.hidden = true;
  try {
    const res = await api("POST", "/api/auth/login", { username: $("username").value.trim(), password: $("password").value });
    token = res.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    $("password").value = "";
    await enterApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$("transfer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("transfer-msg");
  msg.hidden = false;
  msg.className = "";
  try {
    const r = await api("POST", "/api/transfers", {
      fromAccountId: $("from").value,
      toAccountId: $("to").value.trim(),
      amount: Number($("amount").value),
      description: $("description").value.trim(),
    });
    msg.textContent = `Transfer ${r.transferId} completed`;
    msg.className = "success";
    $("amount").value = $("description").value = "";
    await refreshAccounts();
  } catch (ex) {
    msg.textContent = ex.message;
    msg.className = "error";
  }
});

$("logout").addEventListener("click", async () => {
  try { await api("POST", "/api/auth/logout"); } catch { /* already expired */ }
  signOut();
});

if (token) enterApp().catch(signOut); else show("login");
