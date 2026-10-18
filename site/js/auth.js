/*
 * Accounts on the client.
 *  - Every page: asks the server who is logged in (GET /api/me) and switches the
 *    nav link between "Log in" and "My account".
 *  - Account page only: sign-up form, log-in form, log-out button.
 * All text comes from the i18n dictionaries, so it follows the language switch.
 */
(function () {
  function t(key) { return window.I18n ? window.I18n.t(key) : key; }
  function $(id) { return document.getElementById(id); }

  var link = $("account-link");
  var current = null; // logged-in account, or null
  var unavailable = false;

  /* ---- talking to the API ---- */
  function api(method, url, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || "server_error"); e.code = data.error || "server_error"; throw e; }
        return data;
      });
    });
  }

  /* ---- nav link ---- */
  function renderNav() {
    if (!link) return;
    var key = current ? "nav.account" : "nav.login";
    link.setAttribute("data-i18n", key);
    link.textContent = t(key);
  }

  /* ---- account page ---- */
  var loginSection = $("login-section");
  var registerSection = $("register-section");
  var heading = $("auth-heading");
  var view = $("account-view");
  var note = $("auth-unavailable");
  var errorKeys = {};    // element id -> i18n key currently shown
  var statusKeys = {};   // status element id -> i18n key currently shown

  function setText(id, key) {
    var el = $(id);
    if (el) el.textContent = key ? t(key) : "";
  }

  function fieldError(id, key) {
    errorKeys["err-" + id] = key;
    setText("err-" + id, key);
    var input = $(id);
    if (input) input.setAttribute("aria-invalid", key ? "true" : "false");
  }

  function status(id, key) {
    statusKeys[id] = key;
    setText(id, key);
  }

  var KNOWN_ERRORS = ["invalid_email", "password_short", "password_long", "email_taken",
    "invalid_credentials", "too_many_attempts", "server_error"];
  function codeToKey(code) {
    return "auth.err." + (KNOWN_ERRORS.indexOf(code) !== -1 ? code : "server_error");
  }

  // Formatted by hand: older browsers ship without Macedonian locale data.
  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var en = window.I18n && window.I18n.lang === "en";
    var months = en
      ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
      : ["јануари", "февруари", "март", "април", "мај", "јуни", "јули", "август", "септември", "октомври", "ноември", "декември"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  // Which form is showing: "login" (default) or "register" (URL hash #register).
  function mode() { return location.hash === "#register" ? "register" : "login"; }

  function renderAccountPage() {
    if (!loginSection) return;
    var showForms = !current && !unavailable;
    loginSection.hidden = !(showForms && mode() === "login");
    registerSection.hidden = !(showForms && mode() === "register");
    view.hidden = !current;
    note.hidden = !unavailable;
    var key = current ? "account.title" : (mode() === "register" ? "auth.register.title" : "auth.login.title");
    heading.setAttribute("data-i18n", key);
    heading.textContent = t(key);
    if (current) {
      $("account-email").textContent = current.email;
      $("account-created").textContent = formatDate(current.createdAt);
    }
  }

  function rerender() {
    renderNav();
    renderAccountPage();
    Object.keys(errorKeys).forEach(function (id) { setText(id, errorKeys[id]); });
    Object.keys(statusKeys).forEach(function (id) { setText(id, statusKeys[id]); });
  }

  function setAccount(acc) {
    current = acc || null;
    rerender();
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setBusy(form, busy) {
    var btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = busy;
  }

  function initLogin() {
    var form = $("login-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.elements["email"].value.trim();
      var password = form.elements["password"].value;
      var ok = true;

      var emailOk = EMAIL_RE.test(email);
      fieldError("login-email", emailOk ? null : "auth.err.invalid_email");
      if (!emailOk) ok = false;
      fieldError("login-password", password ? null : "auth.err.password_required");
      if (!password) ok = false;
      status("login-status", null);
      if (!ok) return;

      setBusy(form, true);
      api("POST", "/api/login", { email: email, password: password })
        .then(function (data) { form.reset(); setAccount(data.account); })
        .catch(function (err) { status("login-status", codeToKey(err.code)); })
        .then(function () { setBusy(form, false); });
    });
  }

  function initRegister() {
    var form = $("register-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.elements["email"].value.trim();
      var password = form.elements["password"].value;
      var confirm = form.elements["confirm"].value;
      var ok = true;

      var emailOk = EMAIL_RE.test(email);
      fieldError("register-email", emailOk ? null : "auth.err.invalid_email");
      if (!emailOk) ok = false;
      fieldError("register-password", password.length >= 8 ? null : "auth.err.password_short");
      if (password.length < 8) ok = false;
      var matches = password === confirm;
      fieldError("register-confirm", matches ? null : "auth.err.password_mismatch");
      if (!matches) ok = false;
      status("register-status", null);
      if (!ok) return;

      setBusy(form, true);
      api("POST", "/api/register", { email: email, password: password })
        .then(function (data) { form.reset(); setAccount(data.account); })
        .catch(function (err) { status("register-status", codeToKey(err.code)); })
        .then(function () { setBusy(form, false); });
    });
  }

  function initLogout() {
    var btn = $("logout-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      api("POST", "/api/logout").catch(function () {}).then(function () { setAccount(null); });
    });
  }

  /* ---- start ---- */
  function init() {
    initLogin();
    initRegister();
    initLogout();
    document.addEventListener("languagechange", rerender);
    window.addEventListener("hashchange", function () {
      rerender();
      var first = $(mode() === "register" ? "register-email" : "login-email");
      if (first && !current) first.focus();
    });

    if (location.protocol === "file:") {
      // Opened straight from disk: there is no server to talk to.
      unavailable = true;
      rerender();
      return;
    }
    api("GET", "/api/me")
      .then(function (data) { setAccount(data.account); })
      .catch(function () { unavailable = true; rerender(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
