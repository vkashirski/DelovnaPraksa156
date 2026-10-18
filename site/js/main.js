/* Page behaviour: mobile menu, cookie banner, contact form validation. */
(function () {
  function t(key) { return window.I18n ? window.I18n.t(key) : key; }

  /* ---- mobile menu ---- */
  var menuBtn = document.getElementById("menu-toggle");
  var nav = document.getElementById("site-nav");
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---- cookie notice ---- */
  var banner = document.getElementById("cookie-banner");
  if (banner && window.Cookies) {
    banner.hidden = !!window.Cookies.get("cookie_notice");
    var ok = document.getElementById("cookie-ok");
    if (ok) {
      ok.addEventListener("click", function () {
        window.Cookies.set("cookie_notice", "1", 365);
        banner.hidden = true;
      });
    }
  }

  /* ---- contact form (validation only, not sent anywhere yet) ---- */
  var form = document.getElementById("contact-form");
  if (form) {
    var status = document.getElementById("form-status");
    var errorKeys = {};   // field id -> i18n key currently shown
    var statusKey = null; // i18n key currently shown in the status line

    function showError(id, key) {
      var el = document.getElementById("err-" + id);
      var input = document.getElementById(id);
      errorKeys[id] = key;
      if (el) el.textContent = key ? t(key) : "";
      if (input) input.setAttribute("aria-invalid", key ? "true" : "false");
    }

    function renderMessages() {
      Object.keys(errorKeys).forEach(function (id) {
        var el = document.getElementById("err-" + id);
        if (el) el.textContent = errorKeys[id] ? t(errorKeys[id]) : "";
      });
      if (status) status.textContent = statusKey ? t(statusKey) : "";
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.elements["name"].value.trim();
      var email = form.elements["email"].value.trim();
      var message = form.elements["message"].value.trim();
      var ok = true;

      showError("name", name ? null : "contact.form.err.name");
      if (!name) ok = false;

      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      showError("email", emailOk ? null : "contact.form.err.email");
      if (!emailOk) ok = false;

      showError("message", message ? null : "contact.form.err.message");
      if (!message) ok = false;

      statusKey = ok ? "contact.form.ok" : null;
      renderMessages();
      if (ok) form.reset();
    });

    // Re-render dynamic messages instantly when the language changes.
    document.addEventListener("languagechange", renderMessages);
  }
})();
