/*
 * Accounts on the client.
 *  - Every page: asks the server who is signed in (GET /api/me) and shows either a
 *    "Sign in" button or the avatar + username in the top bar. When signed in, clicking
 *    it opens a small menu with "Profile" and "Sign out".
 *  - Account page only: sign-in form, create-account form, profile editing.
 * All text comes from the i18n dictionaries, so it follows the language switch.
 */
(function () {
  function t(key) { return window.I18n ? window.I18n.t(key) : key; }
  function $(id) { return document.getElementById(id); }

  // Same rules as the server (server/server.js). The server stays the final judge.
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var USERNAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;
  var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
  var NAME_MAX = 50;
  var PHONE_RE = /^\+?[0-9 ()\/-]{6,24}$/;

  function phoneOk(v) {
    var digits = v.replace(/\D/g, "").length;
    return PHONE_RE.test(v) && digits >= 6 && digits <= 15;
  }
  function addressOk(v) { return v.length >= 5 && v.length <= 150; }

  var GUEST_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>';

  var current = null; // signed-in account, or null
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
        if (!res.ok) {
          var e = new Error(data.error || "server_error");
          e.code = data.error || "server_error";
          throw e;
        }
        return data;
      });
    });
  }

  var KNOWN_ERRORS = ["invalid_email", "invalid_username", "username_taken", "invalid_name",
    "password_short", "password_long", "email_taken", "invalid_credentials",
    "too_many_attempts", "unauthorized", "server_error", "invalid_phone", "invalid_address"];
  function codeToKey(code) {
    return "auth.err." + (KNOWN_ERRORS.indexOf(code) !== -1 ? code : "server_error");
  }

  /* ---- who the person is, for display ---- */
  function shortName(acc) {
    return acc.username || (acc.email || "").split("@")[0] || "?";
  }

  function fullName(acc) {
    return [acc.firstName, acc.lastName].filter(Boolean).join(" ");
  }

  // Signed in: the same person picture the team page uses (not a letter any more).
  function paintAvatar(el) {
    if (!el) return;
    el.classList.remove("avatar-guest");
    el.classList.add("avatar-person");
    el.style.background = "";
    el.innerHTML = '<img src="/assets/img/avatar.svg" alt="">';
  }

  function paintGuest(el) {
    if (!el) return;
    el.classList.add("avatar-guest");
    el.classList.remove("avatar-person");
    el.style.background = "";
    el.innerHTML = GUEST_ICON;
  }

  /* ---- top bar ---- */
  var link = $("account-link");
  var label = $("account-label");

  // The chip is wrapped once so the menu can sit under it.
  var menu = null, menuOpen = false;
  if (link && link.parentNode) {
    var wrap = document.createElement("div");
    wrap.className = "account-switch";
    link.parentNode.insertBefore(wrap, link);
    wrap.appendChild(link);
    menu = document.createElement("ul");
    menu.id = "account-menu";
    menu.className = "lang-menu account-menu";
    menu.hidden = true;
    menu.innerHTML =
      '<li><a id="account-menu-profile" href="' + link.getAttribute("href") + '"></a></li>' +
      '<li><button id="account-menu-logout" type="button"></button></li>';
    wrap.appendChild(menu);
  }

  function setMenu(open) {
    if (!menu) return;
    menuOpen = !!open && !!current;
    menu.hidden = !menuOpen;
    link.setAttribute("aria-expanded", menuOpen ? "true" : "false");
  }

  function renderNav() {
    if (!link || !label) return;
    if (current) {
      var name = shortName(current);
      paintAvatar($("account-avatar"));
      label.removeAttribute("data-i18n"); // the username is not translated
      label.textContent = name;
      var text = t("nav.account") + ": " + name;
      link.setAttribute("aria-label", text);
      link.setAttribute("title", text);
      link.setAttribute("aria-haspopup", "menu");
      link.setAttribute("aria-expanded", menuOpen ? "true" : "false");
      if (menu) {
        $("account-menu-profile").textContent = t("nav.profile");
        $("account-menu-logout").textContent = t("auth.logout");
      }
    } else {
      paintGuest($("account-avatar"));
      label.setAttribute("data-i18n", "nav.login");
      label.textContent = t("nav.login");
      link.setAttribute("aria-label", t("nav.login"));
      link.setAttribute("title", t("nav.login"));
      link.removeAttribute("aria-haspopup");
      link.removeAttribute("aria-expanded");
      setMenu(false);
    }
  }

  /* ---- account page ---- */
  var loginSection = $("login-section");
  var registerSection = $("register-section");
  var heading = $("auth-heading");
  var view = $("account-view");
  var note = $("auth-unavailable");
  var errorKeys = {};   // element id -> i18n key currently shown
  var statusKeys = {};  // status element id -> i18n key currently shown

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

  function status(id, key, isError) {
    statusKeys[id] = key;
    var el = $(id);
    if (el) el.classList.toggle("status-error", !!isError);
    setText(id, key);
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

  // Which form is showing when signed out: "login" (default) or "register" (URL hash #register).
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
      var name = shortName(current);
      paintAvatar($("profile-avatar"));
      $("profile-name").textContent = fullName(current) || name;
      $("account-email").textContent = current.email;
      $("account-created").textContent = formatDate(current.createdAt);
    }
  }

  function fillProfileForm() {
    var form = $("profile-form");
    if (!form || !current) return;
    form.elements["username"].value = current.username || "";
    form.elements["firstName"].value = current.firstName || "";
    form.elements["lastName"].value = current.lastName || "";
    form.elements["phone"].value = current.phone || "";
    form.elements["address"].value = current.address || "";
  }

  function rerender() {
    renderNav();
    renderAccountPage();
    Object.keys(errorKeys).forEach(function (id) { setText(id, errorKeys[id]); });
    Object.keys(statusKeys).forEach(function (id) { setText(id, statusKeys[id]); });
  }

  function setAccount(acc) {
    var changed = !!current !== !!acc;
    current = acc || null;
    if (current) fillProfileForm();
    // After signing in or out, go back to the default (Sign in) view: drop "#register".
    // (Not on the first load, so a direct link to #register keeps working.)
    if (changed && location.hash && window.history && history.replaceState) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    rerender();
    document.dispatchEvent(new CustomEvent("accountchange", { detail: { account: current, unavailable: unavailable } }));
  }

  function setBusy(form, busy) {
    var btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = busy;
  }

  /* ---- sign in ---- */
  function initLogin() {
    var form = $("login-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var identifier = form.elements["identifier"].value.trim();
      var password = form.elements["password"].value;
      var ok = true;

      fieldError("login-email", identifier ? null : "auth.err.identifier_required");
      if (!identifier) ok = false;
      fieldError("login-password", password ? null : "auth.err.password_required");
      if (!password) ok = false;
      status("login-status", null);
      if (!ok) return;

      setBusy(form, true);
      api("POST", "/api/login", { identifier: identifier, password: password })
        .then(function (data) { form.reset(); setAccount(data.account); })
        .catch(function (err) { status("login-status", codeToKey(err.code), true); })
        .then(function () { setBusy(form, false); });
    });
  }

  /* ---- create account ---- */
  function initRegister() {
    var form = $("register-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.elements["email"].value.trim();
      var username = form.elements["username"].value.trim();
      var password = form.elements["password"].value;
      var confirm = form.elements["confirm"].value;
      var ok = true;

      var emailOk = EMAIL_RE.test(email);
      fieldError("register-email", emailOk ? null : "auth.err.invalid_email");
      if (!emailOk) ok = false;
      var userOk = USERNAME_RE.test(username);
      fieldError("register-username", userOk ? null : "auth.err.invalid_username");
      if (!userOk) ok = false;
      fieldError("register-password", password.length >= 8 ? null : "auth.err.password_short");
      if (password.length < 8) ok = false;
      var matches = password === confirm;
      fieldError("register-confirm", matches ? null : "auth.err.password_mismatch");
      if (!matches) ok = false;
      status("register-status", null);
      if (!ok) return;

      setBusy(form, true);
      api("POST", "/api/register", { email: email, username: username, password: password })
        .then(function (data) { form.reset(); setAccount(data.account); })
        .catch(function (err) {
          if (err.code === "username_taken" || err.code === "invalid_username") {
            fieldError("register-username", codeToKey(err.code));
          } else {
            status("register-status", codeToKey(err.code), true);
          }
        })
        .then(function () { setBusy(form, false); });
    });
  }

  /* ---- edit profile ---- */
  function initProfile() {
    var form = $("profile-form");
    if (!form) return;

    // Editing again clears the old "saved" message.
    form.addEventListener("input", function () { status("profile-status", null); });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var username = form.elements["username"].value.trim();
      var first = form.elements["firstName"].value.trim().replace(/\s+/g, " ");
      var last = form.elements["lastName"].value.trim().replace(/\s+/g, " ");
      var phone = form.elements["phone"].value.trim().replace(/\s+/g, " ");
      var address = form.elements["address"].value.trim().replace(/\s+/g, " ");
      var ok = true;

      var userOk = USERNAME_RE.test(username);
      fieldError("profile-username", userOk ? null : "auth.err.invalid_username");
      if (!userOk) ok = false;
      [["profile-first", first], ["profile-last", last]].forEach(function (pair) {
        var good = pair[1] === "" || (pair[1].length <= NAME_MAX && NAME_RE.test(pair[1]));
        fieldError(pair[0], good ? null : "auth.err.invalid_name");
        if (!good) ok = false;
      });
      var pOk = phone === "" || phoneOk(phone);
      fieldError("profile-phone", pOk ? null : "auth.err.invalid_phone");
      if (!pOk) ok = false;
      var aOk = address === "" || addressOk(address);
      fieldError("profile-address", aOk ? null : "auth.err.invalid_address");
      if (!aOk) ok = false;
      status("profile-status", null);
      if (!ok) return;

      setBusy(form, true);
      api("PATCH", "/api/profile", { username: username, firstName: first, lastName: last, phone: phone, address: address })
        .then(function (data) {
          setAccount(data.account);
          status("profile-status", "account.saved", false);
        })
        .catch(function (err) {
          if (err.code === "unauthorized") { setAccount(null); return; }
          if (err.code === "username_taken" || err.code === "invalid_username") {
            fieldError("profile-username", codeToKey(err.code));
          } else if (err.code === "invalid_phone") {
            fieldError("profile-phone", codeToKey(err.code));
          } else if (err.code === "invalid_address") {
            fieldError("profile-address", codeToKey(err.code));
          } else {
            status("profile-status", codeToKey(err.code), true);
          }
        })
        .then(function () { setBusy(form, false); });
    });
  }

  /* ---- sign out (from the account menu in the top bar) ---- */
  function logout() {
    setMenu(false);
    api("POST", "/api/logout").catch(function () {}).then(function () {
      status("profile-status", null);
      setAccount(null);
    });
  }

  function initMenu() {
    if (!link || !menu) return;
    // Signed in: the chip opens the menu. Signed out: it is a plain link to the sign-in page.
    link.addEventListener("click", function (e) {
      if (!current) return;
      e.preventDefault();
      setMenu(!menuOpen);
    });
    $("account-menu-logout").addEventListener("click", logout);
    document.addEventListener("click", function (e) {
      if (menuOpen && !menu.contains(e.target) && !link.contains(e.target)) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuOpen) { setMenu(false); link.focus(); }
    });
    menu.addEventListener("focusout", function (e) {
      if (menuOpen && e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== link) setMenu(false);
    });
  }

  /* Shared with the other scripts. "ready" is true once /api/me has answered. */
  var ready = false;
  document.addEventListener("accountchange", function () { ready = true; });
  window.Account = {
    api: api,
    phoneOk: phoneOk,
    addressOk: addressOk,
    fullName: fullName,
    shortName: shortName,
    formatDate: formatDate,
    get current() { return current; },
    get ready() { return ready; },
    get unavailable() { return unavailable; },
    // Replace the signed-in account.
    update: function (acc) { if (acc) setAccount(acc); },
  };

  /* ---- start ---- */
  function init() {
    initLogin();
    initRegister();
    initProfile();
    initMenu();
    document.addEventListener("languagechange", rerender);
    window.addEventListener("hashchange", function () {
      rerender();
      var first = $(mode() === "register" ? "register-email" : "login-email");
      if (first && !current) first.focus();
    });

    if (location.protocol === "file:") {
      // Opened straight from disk: there is no server to talk to.
      unavailable = true;
      setAccount(null);
      return;
    }
    api("GET", "/api/me")
      .then(function (data) { setAccount(data.account); })
      .catch(function () { unavailable = true; setAccount(null); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
