/*
 * Order page (pages/order.html).
 *  - Pick a cake from the drop-down (under it: what it is made of and its allergens, on
 *    the right: a fixed picture of it), a shape (round, square, rectangle, or
 *    "own design") and a size. "Own design" adds a picture and details, for a small extra fee.
 *  - We need 3 days of notice; for anything sooner the page asks the customer to call.
 *  - Delivery needs a phone and an address; a signed-in account with those saved skips the fields.
 *  - Sends everything to POST /api/orders. The server re-checks, re-prices and re-lists allergens.
 */
(function () {
  var C = window.CakeCatalog;
  var UI = window.CakeUI;
  var t = UI.t, fmt = UI.fmt;
  function $(id) { return document.getElementById(id); }

  var form = $("order-form");
  if (!form || !C) return;

  var state = {
    base: null,         // chosen cake id
    shape: /^#(design|custom)$/.test(location.hash) ? "design" : "round",
    size: "medium",
    image: null,        // data URL of the shrunk picture
    editDetails: false, // signed in, but typing different details for this order
  };
  var errors = {};      // element id -> i18n key (re-rendered on language change)
  var statusKey = null;
  var busy = false;

  function account() { return window.Account ? window.Account.current : null; }
  function fulfilment() { return form.elements["fulfilment"].value; }
  function isDesign() { return state.shape === "design"; }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // The cake as the server understands it.
  function cakeNow() { return { type: "base", base: state.base, shape: state.shape, size: state.size }; }
  function cakeChosen() { return !!state.base; }

  /* ---------- the choices ---------- */
  function choice(type, name, value, checked, inner) {
    var label = document.createElement("label");
    label.className = "choice";
    var input = document.createElement("input");
    input.type = type;
    input.name = name;
    input.value = value;
    input.checked = checked;
    var span = document.createElement("span");
    span.innerHTML = inner;
    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  // The drop-down on the left: all the cakes.
  function renderCakeSelect() {
    var sel = $("cake");
    sel.innerHTML = '<option value="">' + esc(t("order.choose.ph")) + "</option>" +
      Object.keys(C.cakes).map(function (id) {
        return '<option value="' + id + '"' + (state.base === id ? " selected" : "") + ">" + esc(t("cake." + id)) + "</option>";
      }).join("");
    sel.value = state.base || "";
  }

  // Under the drop-down: what the chosen cake is made of and its allergens. All the cakes' texts
  // sit on top of each other in one grid cell and only the chosen one is shown, so the block is
  // always as tall as the tallest one and nothing jumps when you choose (or change) a cake.
  function renderCakeInfo() {
    var box = $("cake-info");
    var traces = fmt("order.allergens.traces", { phone: t("contact.phone.value") });
    var html = '<div class="cake-info" data-for=""><h3 class="cake-info-name">&nbsp;</h3><p>' + esc(t("order.detail.empty")) + "</p></div>";
    Object.keys(C.cakes).forEach(function (id) {
      var list = C.allergensOf({ type: "base", base: id });
      html += '<div class="cake-info" data-for="' + id + '"><h3 class="cake-info-name">' + esc(t("cake." + id)) + "</h3>" +
        "<p>" + esc(t("cake." + id + ".desc")) + "</p>" +
        '<div class="allergen-box"><b>' + esc(t("order.allergens.title")) + "</b>" +
        '<ul class="allergen-list">' + list.map(function (a) { return "<li>" + esc(t("allergen." + a)) + "</li>"; }).join("") + "</ul>" +
        "</div></div>";
    });
    box.innerHTML = html;
    $("cake-traces").textContent = traces;
  }

  // Show the chosen cake's text and its picture. The picture is always the same round cake: it only
  // takes the cake's flavour colours, it does not change with the shape, the size or the message.
  function renderCakeDetail() {
    var chosen = cakeChosen();
    Array.prototype.forEach.call($("cake-info").children, function (node) {
      node.classList.toggle("is-active", node.getAttribute("data-for") === (state.base || ""));
    });
    var art = $("cake-art-svg");
    art.parentNode.classList.toggle("cake-art-empty", !chosen);
    window.CakeDraw.draw(art, {
      colors: chosen ? C.colorsOf({ type: "base", base: state.base }) : ["#ecdcd2"], shape: "round", size: "medium",
    });
  }

  var SHAPE_ICONS = {
    round: '<ellipse cx="24" cy="12" rx="17" ry="6"/><path d="M7 12v16c0 3.3 7.6 6 17 6s17-2.7 17-6V12"/>',
    square: '<path d="M9 17h22v17H9zM9 17l9-6h22l-9 6M31 17l9-6v17l-9 6"/>',
    rectangle: '<path d="M4 19h30v15H4zM4 19l9-6h30l-9 6M34 19l9-6v15l-9 6"/>',
    design: '<circle cx="24" cy="20" r="15"/><path d="M24 12v16M16 20h16"/>',
  };

  function renderShapes() {
    var box = $("shape-choices");
    box.innerHTML = "";
    C.shapes.forEach(function (id) {
      var label = document.createElement("label");
      label.className = "shape-card" + (id === "design" ? " shape-design" : "");
      label.innerHTML =
        '<input type="radio" name="shape" value="' + id + '"' + (state.shape === id ? " checked" : "") + ">" +
        '<span><svg viewBox="0 0 48 40" width="48" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' + SHAPE_ICONS[id] + "</svg>" +
        "<b>" + esc(t("shape." + id)) + "</b>" +
        (id === "design" ? "<small>" + esc(t("shape.design.note")) + "</small>" : "") + "</span>";
      box.appendChild(label);
    });
  }

  function renderSizes() {
    var box = $("size-choices");
    box.innerHTML = "";
    Object.keys(C.sizes).forEach(function (id) {
      var price = C.price({ type: "base", shape: state.shape, size: id }).cake;
      box.appendChild(choice("radio", "size", id, state.size === id,
        esc(t("size." + id)) + " <small>" + esc(fmt("order.serves", { n: C.sizes[id].serves })) + " · " + esc(UI.money(price)) + "</small>"));
    });
  }

  function renderSlots() {
    var sel = $("order-slot");
    var value = sel.value || C.slots[0];
    sel.innerHTML = C.slots.map(function (s) {
      return '<option value="' + s + '"' + (s === value ? " selected" : "") + ">" + UI.slot(s) + "</option>";
    }).join("");
  }

  // Own design: a picture, a hint and a different label for the notes.
  function renderShapeParts() {
    var design = isDesign();
    $("photo-field").hidden = !design;
    $("design-hint").hidden = !design;
    $("design-hint").textContent = fmt("order.design.hint", { fee: UI.money(C.designFee) });
    $("notes-label").textContent = t(design ? "order.notes.design" : "order.notes");
    $("cake-notes").placeholder = t(design ? "order.notes.design.ph" : "order.notes.ph");
  }

  function renderDate() {
    var date = $("order-date");
    date.min = C.earliest();
    date.max = C.addDays(C.today(), C.maxDaysAhead);
    $("date-hint").textContent = fmt("order.date.hint", {
      days: C.leadDays, date: UI.formatDay(date.min), phone: t("contact.phone.value"),
    });
    if (date.value && date.value < date.min) setError("order-date", "order.err.date_too_soon");
    else if (errors["order-date"] === "order.err.date_too_soon") setError("order-date", null);
  }

  function renderFulfilment() {
    var delivery = fulfilment() === "delivery";
    $("date-label").textContent = t(delivery ? "order.date.delivery" : "order.date.pickup");
    $("pay-card-label").textContent = t(delivery ? "order.pay.card.delivery" : "order.pay.card.pickup");
    $("pay-cash-label").textContent = t(delivery ? "order.pay.cash.delivery" : "order.pay.cash.pickup");
    $("delivery-fee-text").textContent = "+" + UI.money(C.deliveryFee);
    $("phone-label").textContent = t("order.phone") + (delivery ? "" : " " + t("order.optional"));
    renderDetails();
  }

  // Signed in with the needed details saved -> show them instead of the fields.
  function renderDetails() {
    var acc = account();
    var delivery = fulfilment() === "delivery";
    var hasSaved = !!(acc && acc.phone && (!delivery || acc.address));
    var useSaved = hasSaved && !state.editDetails;

    $("guest-note").hidden = !!acc || !(window.Account && window.Account.ready) || window.Account.unavailable;
    $("saved-details").hidden = !useSaved;
    $("detail-fields").hidden = useSaved;
    $("email-field").hidden = !!acc;
    $("address-field").hidden = !delivery;
    var missing = acc && (!acc.phone || (delivery && !acc.address));
    $("save-details-row").hidden = !missing || useSaved;

    if (useSaved) {
      var lines = [window.Account.fullName(acc) || acc.username, acc.phone];
      if (delivery) lines.push(acc.address);
      $("saved-summary").textContent = lines.join(" · ");
    }
  }

  function prefillFromAccount() {
    var acc = account();
    if (!acc) return;
    var fill = function (id, value) { if (!$(id).value && value) $(id).value = value; };
    fill("contact-name", window.Account.fullName(acc) || acc.username);
    fill("contact-phone", acc.phone);
    fill("contact-address", acc.address);
  }

  function renderSummary() {
    var cake = cakeNow();
    var price = C.price(cake, fulfilment());
    var rows = [];
    if (cakeChosen()) rows.push([t("order.summary.cake"), t("cake." + state.base)]);
    rows.push([t("order.summary.shape"), t("shape." + state.shape)]);
    rows.push([t("order.size"), t("size." + cake.size) + " (" + UI.money(C.sizes[cake.size].price) + ")"]);
    if (isDesign()) rows.push([t("order.summary.custom"), "+" + UI.money(C.designFee)]);
    var message = $("cake-message").value.trim();
    if (message) rows.push([t("order.summary.message"), "“" + message + "”"]);
    rows.push([t(fulfilment() === "delivery" ? "order.delivery" : "order.pickup"), price.delivery ? "+" + UI.money(price.delivery) : t("order.pickup.note")]);
    var date = $("order-date").value;
    if (date) rows.push([t("order.summary.when"), UI.formatDay(date) + ", " + UI.slot($("order-slot").value)]);
    $("summary").innerHTML = rows.map(function (r) {
      return "<li><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></li>";
    }).join("");
    $("total").textContent = UI.money(price.total);
  }

  function update() {
    renderCakeDetail();
    renderSummary();
  }

  function renderAll() {
    renderCakeSelect();
    renderCakeInfo();
    renderShapes();
    renderShapeParts();
    renderSizes();
    renderSlots();
    renderDate();
    renderFulfilment();
    renderPhotoText();
    update();
    Object.keys(errors).forEach(function (id) { showError(id); });
    $("order-status").textContent = statusKey ? t(statusKey) : "";
  }

  /* ---------- errors ---------- */
  function showError(id) {
    var key = errors[id];
    var box = $("err-" + id);
    var text = key ? fmt(key, { days: C.leadDays, phone: t("contact.phone.value") }) : "";
    if (box) box.textContent = text;
    var input = $(id);
    if (input) input.setAttribute("aria-invalid", key ? "true" : "false");
  }
  function setError(id, key) { errors[id] = key; showError(id); }
  function setStatus(key) { statusKey = key; $("order-status").textContent = key ? t(key) : ""; }

  /* ---------- inspiration picture (own design) ---------- */
  var MAX_SIDE = 1200;
  var MAX_INPUT = 15 * 1024 * 1024;

  function renderPhotoText() {
    var has = !!state.image;
    $("photo-pick-text").textContent = t(has ? "order.photo.change" : "order.photo.pick");
    $("photo-hint").textContent = t(has ? "order.photo.added" : "order.photo.hint");
  }

  function setImage(dataUrl) {
    state.image = dataUrl;
    var thumb = $("photo-thumb");
    thumb.hidden = !dataUrl;
    if (dataUrl) thumb.src = dataUrl; else thumb.removeAttribute("src");
    $("photo-remove").hidden = !dataUrl;
    $("photo-drop").classList.toggle("has-image", !!dataUrl);
    renderPhotoText();
  }

  function readImage(file) {
    setError("photo", null);
    if (!file) return;
    if (["image/jpeg", "image/png", "image/webp"].indexOf(file.type) === -1) return setError("photo", "order.err.invalid_image");
    if (file.size > MAX_INPUT) return setError("photo", "order.err.image_large");
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      var data = canvas.toDataURL("image/jpeg", 0.85);
      if (data.length > 1.9e6) data = canvas.toDataURL("image/jpeg", 0.6);
      setImage(data);
    };
    img.onerror = function () { URL.revokeObjectURL(url); setError("photo", "order.err.invalid_image"); };
    img.src = url;
  }

  /* ---------- sending ---------- */
  function validate() {
    var ok = true;
    var acc = account();
    var delivery = fulfilment() === "delivery";
    var date = $("order-date").value;

    setError("cake", state.base ? null : "order.err.choose_cake");
    if (!state.base) ok = false;

    if (!date || !C.isDate(date)) { setError("order-date", "order.err.invalid_date"); ok = false; }
    else if (date < C.earliest()) { setError("order-date", "order.err.date_too_soon"); ok = false; }
    else if (date > $("order-date").max) { setError("order-date", "order.err.invalid_date"); ok = false; }
    else setError("order-date", null);

    if ($("detail-fields").hidden) return ok;

    var name = $("contact-name").value.trim();
    var nameOk = name.length >= 2 && name.length <= 50 && /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(name);
    setError("contact-name", nameOk ? null : "order.err.invalid_contact_name");
    if (!nameOk) ok = false;

    if (!acc) {
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($("contact-email").value.trim());
      setError("contact-email", emailOk ? null : "auth.err.invalid_email");
      if (!emailOk) ok = false;
    }

    var phone = $("contact-phone").value.trim();
    var phoneOk = (!delivery && phone === "") || window.Account.phoneOk(phone);
    setError("contact-phone", phoneOk ? null : "auth.err.invalid_phone");
    if (!phoneOk) ok = false;

    if (delivery) {
      var addrOk = window.Account.addressOk($("contact-address").value.trim());
      setError("contact-address", addrOk ? null : "auth.err.invalid_address");
      if (!addrOk) ok = false;
    }
    return ok;
  }

  function payload() {
    var useFields = !$("detail-fields").hidden;
    var delivery = fulfilment() === "delivery";
    var cake = cakeNow();
    cake.message = $("cake-message").value.trim();
    cake.notes = $("cake-notes").value.trim();
    if (isDesign()) cake.image = state.image;
    var body = {
      cake: cake,
      fulfilment: fulfilment(),
      date: $("order-date").value,
      slot: $("order-slot").value,
      payment: form.elements["payment"].value,
      contact: {},
      saveDetails: !$("save-details-row").hidden && $("save-details").checked,
    };
    if (useFields) {
      body.contact = {
        name: $("contact-name").value.trim(),
        email: account() ? undefined : $("contact-email").value.trim(),
        phone: $("contact-phone").value.trim(),
        address: delivery ? $("contact-address").value.trim() : "",
      };
    }
    return body;
  }

  var FIELD_ERRORS = {
    invalid_cake: ["cake", "order.err.choose_cake"],
    invalid_shape: ["cake", "order.err.choose_cake"],
    invalid_date: ["order-date", "order.err.invalid_date"],
    date_too_soon: ["order-date", "order.err.date_too_soon"],
    invalid_contact_name: ["contact-name", "order.err.invalid_contact_name"],
    invalid_email: ["contact-email", "auth.err.invalid_email"],
    invalid_phone: ["contact-phone", "auth.err.invalid_phone"],
    invalid_address: ["contact-address", "auth.err.invalid_address"],
    invalid_image: ["photo", "order.err.invalid_image"],
    image_large: ["photo", "order.err.image_large"],
  };

  function onError(code) {
    var f = FIELD_ERRORS[code];
    if (f) {
      // the saved details were rejected: open the fields so they can be fixed
      if (f[0].indexOf("contact-") === 0 && $("detail-fields").hidden) {
        state.editDetails = true;
        prefillFromAccount();
        renderDetails();
      }
      setError(f[0], f[1]);
      setStatus("order.err.check");
      var input = $(f[0]);
      if (input && input.focus) input.focus();
    } else if (code === "too_many_attempts") {
      setStatus("auth.err.too_many_attempts");
    } else {
      setStatus("auth.err.server_error");
    }
  }

  function showDone(order) {
    form.hidden = true;
    $("order-done").hidden = false;
    document.querySelector(".page-head").hidden = true;
    var signedIn = !!order.linked;
    $("done-code").textContent = order.code;
    $("done-track").hidden = !signedIn;
    $("done-account").hidden = !signedIn;
    $("done-guest").hidden = signedIn;
    $("done-register").hidden = signedIn;
    window.CakeDraw.draw($("done-cake"), { colors: C.colorsOf(order.cake), shape: order.cake.shape, size: order.cake.size, message: order.cake.message });
    var rows = [
      [t("order.summary.cake"), UI.cakeName(order.cake)],
      [t("order.summary.shape"), t("shape." + (order.cake.shape || "round"))],
      [t(order.fulfilment === "delivery" ? "order.delivery" : "order.pickup"), UI.formatDay(order.date) + ", " + UI.slot(order.slot)],
      [t("order.summary.payment"), t("payment." + order.payment)],
      [t("order.total"), UI.money(order.price.total)],
    ];
    $("done-summary").innerHTML = rows.map(function (r) {
      return "<li><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></li>";
    }).join("");
    window.scrollTo(0, 0);
    $("done-card").focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    setStatus(null);
    if (!validate()) {
      setStatus("order.err.check");
      var first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      else {
        var box = $("cake");
        if (box && box.scrollIntoView) box.scrollIntoView({ block: "center" });
      }
      return;
    }
    busy = true;
    $("place-order").disabled = true;
    window.Account.api("POST", "/api/orders", payload())
      .then(function (data) {
        if (data.account) window.Account.update(data.account);
        showDone(data.order);
      })
      .catch(function (err) { onError(err.code); })
      .then(function () { busy = false; $("place-order").disabled = false; });
  });

  /* ---------- events ---------- */
  function setShape(shape) {
    state.shape = shape;
    renderShapeParts();
    renderSizes();
  }
  // old links: order.html#custom / #design open with "own design" chosen
  window.addEventListener("hashchange", function () {
    if (/^#(design|custom)$/.test(location.hash)) {
      state.shape = "design";
      renderShapes();
      setShape("design");
      update();
    }
  });

  form.addEventListener("change", function (e) {
    var el = e.target;
    if (el.name === "base") { state.base = el.value; setError("cake", null); }
    else if (el.name === "shape") setShape(el.value);
    else if (el.name === "size") state.size = el.value;
    else if (el.name === "fulfilment") renderFulfilment();
    else if (el.id === "photo-input") {
      readImage(el.files && el.files[0]);
      el.value = "";
    } else if (el.id === "order-date") {
      setError("order-date", null);
    }
    update();
  });

  form.addEventListener("input", function (e) {
    if (e.target.id === "cake-message") update();
    if (e.target.id && errors[e.target.id]) setError(e.target.id, null);
    setStatus(null);
  });

  $("photo-remove").addEventListener("click", function () { setImage(null); setError("photo", null); });

  var drop = $("photo-drop");
  ["dragenter", "dragover"].forEach(function (type) {
    drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add("dragging"); });
  });
  ["dragleave", "drop"].forEach(function (type) {
    drop.addEventListener(type, function () { drop.classList.remove("dragging"); });
  });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    readImage(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  $("edit-details").addEventListener("click", function () {
    state.editDetails = true;
    prefillFromAccount();
    renderDetails();
    $("contact-name").focus();
  });

  document.addEventListener("languagechange", renderAll);
  document.addEventListener("accountchange", function (e) {
    if (e.detail && e.detail.unavailable) {
      form.hidden = true;
      $("order-unavailable").hidden = false;
      return;
    }
    prefillFromAccount();
    renderDetails();
  });

  function init() {
    renderAll();
    if (window.Account && window.Account.ready) { prefillFromAccount(); renderDetails(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
