/* Page behaviour: mobile menu, cookie banner, decorative cakes, contact form validation. */
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

  /* ---- decorative cakes: <svg data-cake='{"layers":[...]}' data-cake-message="i18n key"> ---- */
  function drawCakes() {
    if (!window.CakeDraw) return;
    var nodes = document.querySelectorAll("svg[data-cake]");
    for (var i = 0; i < nodes.length; i++) {
      try {
        var cake = JSON.parse(nodes[i].getAttribute("data-cake"));
        var msgKey = nodes[i].getAttribute("data-cake-message");
        if (msgKey) cake.message = t(msgKey);
        window.CakeDraw.draw(nodes[i], cake);
      } catch (e) { /* leave it empty */ }
    }
  }
  // After DOMContentLoaded, so the i18n engine has picked the saved language first.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", drawCakes);
  else drawCakes();
  document.addEventListener("languagechange", drawCakes);

  /* ---- gallery: slow endless strip you can also drag (or move with the arrow keys) ----
     The photos are copied once so it loops without a jump. Visitors who prefer reduced
     motion get a plain strip they scroll by hand. */
  var marquee = document.getElementById("gallery-marquee");
  if (marquee) {
    var track = marquee.querySelector(".marquee-track");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (track && !reduce) {
      Array.prototype.slice.call(track.children).forEach(function (li) {
        var copy = li.cloneNode(true);
        copy.setAttribute("aria-hidden", "true");
        var img = copy.querySelector("img");
        if (img) { img.alt = ""; img.removeAttribute("data-i18n-alt"); }
        track.appendChild(copy);
      });
      marquee.classList.add("is-moving");

      var SPEED = 30;          // pixels per second when nobody is touching it
      var offset = 0;          // how far the strip has moved to the left
      var half = 0;            // width of one set of photos
      var glide = 0;           // extra speed left over from a drag, fades out
      var dragging = false, lastX = 0, lastT = 0, lastFrame = 0;

      var measure = function () { half = track.scrollWidth / 2; };
      var wrap = function () { if (half > 0) offset = ((offset % half) + half) % half; };
      var paint = function () { track.style.transform = "translate3d(" + (-offset) + "px,0,0)"; };

      var frame = function (now) {
        var dt = Math.min(now - (lastFrame || now), 50) / 1000;
        lastFrame = now;
        if (!dragging) {
          offset += (SPEED + glide) * dt;
          glide *= Math.pow(0.05, dt);
          if (Math.abs(glide) < 1) glide = 0;
        }
        wrap(); paint();
        window.requestAnimationFrame(frame);
      };

      marquee.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        dragging = true; glide = 0;
        lastX = e.clientX; lastT = e.timeStamp;
        marquee.classList.add("is-dragging");
        try { marquee.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ }
      });
      marquee.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        var dx = e.clientX - lastX, dt = (e.timeStamp - lastT) / 1000;
        offset -= dx;
        if (dt > 0) glide = Math.max(-2500, Math.min(2500, -dx / dt));
        lastX = e.clientX; lastT = e.timeStamp;
      });
      var release = function (e) {
        if (!dragging) return;
        dragging = false;
        marquee.classList.remove("is-dragging");
        if (e && e.timeStamp - lastT > 80) glide = 0;   // held still before letting go
      };
      marquee.addEventListener("pointerup", release);
      marquee.addEventListener("pointercancel", release);

      // arrow keys: the strip needs focus first (Tab)
      marquee.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight") { glide = 900; e.preventDefault(); }
        else if (e.key === "ArrowLeft") { glide = -900; e.preventDefault(); }
      });

      measure();
      window.addEventListener("load", measure);
      window.addEventListener("resize", measure);
      window.requestAnimationFrame(frame);
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
