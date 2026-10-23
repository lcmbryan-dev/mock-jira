"use strict";

const STATUSES = ["To Do", "In Progress", "In Review", "Done"];
const TYPES = ["Story", "Bug", "Task", "Epic"];
const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"];
const USERS = ["Unassigned", "Alice", "Bob", "Carol", "Dave"];
const PROJECT_KEY = "MJ";
const STORAGE_KEY = "mock-jira-v1";

let state = load();
let view = "board";
let editingId = null;

function seed() {
  const now = Date.now();
  const mk = (n, title, type, status, priority, assignee, points, labels, description) => ({
    id: n, title, type, status, priority, assignee, points, labels, description,
    comments: [], created: now, updated: now,
  });
  return {
    nextId: 9,
    issues: [
      mk(1, "Set up CI pipeline", "Task", "Done", "High", "Alice", 3, ["devops"], "Run lint and tests on every push."),
      mk(2, "User login page", "Story", "In Review", "High", "Bob", 5, ["frontend", "auth"], "As a user I can sign in with email and password."),
      mk(3, "Fix crash when uploading empty file", "Bug", "In Progress", "Highest", "Carol", 2, ["backend"], "Uploading a 0-byte file throws a 500."),
      mk(4, "Design dashboard layout", "Story", "In Progress", "Medium", "Dave", 8, ["design"], ""),
      mk(5, "Payments epic", "Epic", "To Do", "Medium", "Unassigned", null, ["payments"], "Umbrella for all payments work."),
      mk(6, "Add password reset email", "Story", "To Do", "Medium", "Unassigned", 3, ["auth"], ""),
      mk(7, "Update README with setup steps", "Task", "To Do", "Low", "Alice", 1, ["docs"], ""),
      mk(8, "Typo on pricing page", "Bug", "To Do", "Lowest", "Bob", 1, ["frontend"], ""),
    ],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to seed */ }
  return seed();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}

const $ = (id) => document.getElementById(id);
const key = (issue) => `${PROJECT_KEY}-${issue.id}`;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

function initials(name) {
  return name === "Unassigned" ? "?" : name.slice(0, 2).toUpperCase();
}

function fillSelect(sel, values, withBlank) {
  if (!withBlank) sel.textContent = "";
  for (const v of values) sel.append(el("option", { value: v, text: v }));
}

function filtered() {
  const q = $("f-search").value.trim().toLowerCase();
  const type = $("f-type").value, who = $("f-assignee").value, prio = $("f-priority").value;
  return state.issues.filter((i) => {
    if (type && i.type !== type) return false;
    if (who && i.assignee !== who) return false;
    if (prio && i.priority !== prio) return false;
    if (q) {
      const hay = `${key(i)} ${i.title} ${(i.labels || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function render() {
  const issues = filtered();
  const root = $("view");
  root.textContent = "";
  root.append(view === "board" ? renderBoard(issues) : renderBacklog(issues));
}

function renderCard(i) {
  const card = el("div", { class: "card", draggable: "true", "data-id": i.id, onclick: () => openDialog(i.id) });
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(i.id));
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.append(el("div", { class: "title", text: i.title }));
  if (i.labels && i.labels.length) {
    card.append(el("div", { class: "labels" }, i.labels.map((l) => el("span", { class: "label", text: l }))));
  }
  card.append(el("div", { class: "row" }, [
    el("span", { class: `type ${i.type}`, title: i.type, text: i.type[0] }),
    el("span", { class: "key", text: key(i) }),
    el("span", { class: `prio ${i.priority}`, title: i.priority, text: "▲" }),
    i.points != null ? el("span", { class: "points", text: String(i.points) }) : null,
    el("span", { class: "spacer" }),
    el("span", { class: `avatar ${i.assignee === "Unassigned" ? "none" : ""}`, title: i.assignee, text: initials(i.assignee) }),
  ]));
  return card;
}

function renderBoard(issues) {
  const board = el("div", { class: "board" });
  for (const status of STATUSES) {
    const items = issues.filter((i) => i.status === status);
    const col = el("div", { class: "column", "data-status": status });
    col.append(el("h3", {}, [status.toUpperCase(), el("span", { class: "count", text: String(items.length) })]));
    items.forEach((i) => col.append(renderCard(i)));
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("over");
      const issue = state.issues.find((x) => x.id === Number(e.dataTransfer.getData("text/plain")));
      if (issue && issue.status !== status) {
        issue.status = status;
        issue.updated = Date.now();
        save();
        render();
      }
    });
    board.append(col);
  }
  return board;
}

function renderBacklog(issues) {
  if (!issues.length) return el("div", { class: "empty", text: "No issues match your filters." });
  const table = el("table", { class: "list" });
  table.append(el("thead", {}, el("tr", {}, ["Type", "Key", "Summary", "Status", "Priority", "Assignee", "Points"].map((h) => el("th", { text: h })))));
  const body = el("tbody");
  [...issues].sort((a, b) => b.id - a.id).forEach((i) => {
    body.append(el("tr", { class: "item", onclick: () => openDialog(i.id) }, [
      el("td", {}, el("span", { class: `type ${i.type}`, title: i.type, text: i.type[0] })),
      el("td", { class: "key", text: key(i) }),
      el("td", { text: i.title }),
      el("td", {}, el("span", { class: `status-pill ${i.status.replace(" ", "-")}`, text: i.status })),
      el("td", {}, el("span", { class: `prio ${i.priority}`, text: i.priority })),
      el("td", { text: i.assignee }),
      el("td", { text: i.points != null ? String(i.points) : "" }),
    ]));
  });
  table.append(body);
  return table;
}

function renderComments(issue) {
  const ul = $("comments");
  ul.textContent = "";
  for (const c of issue.comments) {
    ul.append(el("li", {}, [
      el("div", { class: "when", text: new Date(c.at).toLocaleString() }),
      el("div", { text: c.text }),
    ]));
  }
}

function openDialog(id) {
  editingId = id ?? null;
  const issue = id != null ? state.issues.find((i) => i.id === id) : null;
  $("dlg-title").textContent = issue ? `${key(issue)}` : "Create issue";
  $("i-title").value = issue ? issue.title : "";
  $("i-desc").value = issue ? issue.description : "";
  $("i-status").value = issue ? issue.status : STATUSES[0];
  $("i-type").value = issue ? issue.type : "Task";
  $("i-priority").value = issue ? issue.priority : "Medium";
  $("i-assignee").value = issue ? issue.assignee : "Unassigned";
  $("i-points").value = issue && issue.points != null ? issue.points : "";
  $("i-labels").value = issue ? (issue.labels || []).join(", ") : "";
  $("i-delete").hidden = !issue;
  $("comments-wrap").hidden = !issue;
  $("meta").textContent = issue
    ? `Created ${new Date(issue.created).toLocaleString()} | Updated ${new Date(issue.updated).toLocaleString()}`
    : "";
  if (issue) renderComments(issue);
  $("c-text").value = "";
  $("dlg").showModal();
  $("i-title").focus();
}

function submitForm(e) {
  e.preventDefault();
  const title = $("i-title").value.trim();
  if (!title) return;
  const pts = $("i-points").value;
  const fields = {
    title,
    description: $("i-desc").value,
    status: $("i-status").value,
    type: $("i-type").value,
    priority: $("i-priority").value,
    assignee: $("i-assignee").value,
    points: pts === "" ? null : Number(pts),
    labels: $("i-labels").value.split(",").map((s) => s.trim()).filter(Boolean),
    updated: Date.now(),
  };
  if (editingId != null) {
    Object.assign(state.issues.find((i) => i.id === editingId), fields);
  } else {
    state.issues.push({ id: state.nextId++, comments: [], created: Date.now(), ...fields });
  }
  save();
  $("dlg").close();
  refreshFilters();
  render();
}

function refreshFilters() {
  // Keep the current choice when the option list is rebuilt.
  const keep = ["f-type", "f-assignee", "f-priority"].map((id) => $(id).value);
  for (const [id, vals] of [["f-type", TYPES], ["f-assignee", USERS], ["f-priority", PRIORITIES]]) {
    const sel = $(id);
    const label = sel.options[0].textContent;
    sel.textContent = "";
    sel.append(el("option", { value: "", text: label }));
    fillSelect(sel, vals, true);
  }
  ["f-type", "f-assignee", "f-priority"].forEach((id, n) => { $(id).value = keep[n]; });
}

function bind() {
  fillSelect($("i-status"), STATUSES);
  fillSelect($("i-type"), TYPES);
  fillSelect($("i-priority"), PRIORITIES);
  fillSelect($("i-assignee"), USERS);
  refreshFilters();

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    view = t.dataset.view;
    render();
  }));
  ["f-search", "f-type", "f-assignee", "f-priority"].forEach((id) => $(id).addEventListener("input", render));
  $("f-clear").addEventListener("click", () => {
    ["f-search", "f-type", "f-assignee", "f-priority"].forEach((id) => { $(id).value = ""; });
    render();
  });

  $("btn-create").addEventListener("click", () => openDialog(null));
  $("issue-form").addEventListener("submit", submitForm);
  $("dlg-close").addEventListener("click", () => $("dlg").close());
  $("i-cancel").addEventListener("click", () => $("dlg").close());
  $("i-delete").addEventListener("click", () => {
    if (!confirm("Delete this issue permanently?")) return;
    state.issues = state.issues.filter((i) => i.id !== editingId);
    save();
    $("dlg").close();
    render();
  });
  $("c-add").addEventListener("click", () => {
    const text = $("c-text").value.trim();
    const issue = state.issues.find((i) => i.id === editingId);
    if (!text || !issue) return;
    issue.comments.push({ text, at: Date.now() });
    issue.updated = Date.now();
    save();
    $("c-text").value = "";
    renderComments(issue);
  });

  $("btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "mock-jira-export.json" });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.issues) || typeof data.nextId !== "number") throw new Error("bad shape");
      state = data;
      save();
      render();
    } catch (err) {
      alert("That file is not a valid Mock Jira export.");
    }
  });
  $("btn-reset").addEventListener("click", () => {
    if (!confirm("Reset all data to the sample issues?")) return;
    state = seed();
    save();
    render();
  });
}

bind();
render();
