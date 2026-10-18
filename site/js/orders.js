/*
 * "My orders" on the account page: loads GET /api/orders once signed in and lists the
 * order details. An order can be cancelled (until the day before its date) after
 * answering a yes/no pop-up.
 */
(function () {
  var UI = window.CakeUI;
  if (!UI) return;
  var t = UI.t, fmt = UI.fmt;
  function $(id) { return document.getElementById(id); }

  var listEl = $("order-list");
  if (!listEl) return;

  var orders = null;      // null = not loaded yet
  var statusKey = null;
  var pending = null;     // order waiting for the yes/no answer

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function row(label, value) {
    return "<li><span>" + esc(label) + "</span><span>" + esc(value) + "</span></li>";
  }

  function card(order) {
    var c = order.cake;
    var delivery = order.fulfilment === "delivery";
    var rows = [
      row(t("orders.cake"), UI.cakeName(c) + " · " + t("size." + c.size)),
    ];
    if (c.type !== "custom") rows.push(row(t("order.shape"), t("shape." + (c.shape || "round"))));
    if (c.message) rows.push(row(t("order.summary.message"), "“" + c.message + "”"));
    rows.push(row(t("orders.allergens"), UI.allergens(order.allergens)));
    rows.push(row(t(delivery ? "order.date.delivery" : "order.date.pickup"), UI.formatDay(order.date) + ", " + UI.slot(order.slot)));
    rows.push(row(t("orders.how"), t(delivery ? "order.delivery" : "order.pickup")));
    if (delivery) rows.push(row(t("order.address"), order.contact.address));
    rows.push(row(t("order.summary.payment"), t(order.paid ? "payment.online" : "payment." + order.payment)));
    if (c.notes) rows.push(row(t("orders.notes"), c.notes));

    var cancel = order.canCancel
      ? '<button type="button" class="btn btn-outline btn-small" data-cancel="' + esc(order.id) + '">' + esc(t("orders.cancel")) + "</button>"
      : "";
    return '<article class="order' + (order.cancelled ? " order-cancelled" : "") + '">' +
      '<div class="order-top">' +
        '<svg class="mini-cake" data-order="' + esc(order.id) + '" aria-hidden="true"></svg>' +
        '<div class="order-main">' +
          '<div><span class="order-code">' + esc(order.code) + "</span>" +
            (order.cancelled ? ' <span class="tag">' + esc(t("orders.cancelled")) + "</span>" : "") + "</div>" +
          '<div class="order-when">' + esc(t("orders.placed")) + " " + esc(UI.formatDay(order.createdAt.slice(0, 10))) + "</div>" +
        "</div>" +
        (order.imageUrl ? '<img class="order-photo" src="' + esc(order.imageUrl) + '" alt="' + esc(t("orders.photo")) + '" loading="lazy">' : "") +
        '<div class="order-price">' + esc(UI.money(order.price.total)) + "</div>" +
      "</div>" +
      '<ul class="summary-list order-details">' + rows.join("") + "</ul>" +
      (cancel ? '<div class="order-foot">' + cancel + "</div>" : "") +
    "</article>";
  }

  function render() {
    $("orders-status").textContent = statusKey ? fmt(statusKey, { phone: t("contact.phone.value") }) : "";
    if (orders === null) { listEl.innerHTML = ""; return; }
    if (!orders.length) {
      listEl.innerHTML = '<p class="empty">' + esc(t("orders.empty")) + ' <a href="order.html">' + esc(t("orders.empty.cta")) + "</a></p>";
      return;
    }
    // newest order first
    var sorted = orders.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    listEl.innerHTML = sorted.map(card).join("");
    sorted.forEach(function (o) {
      var svg = listEl.querySelector('svg[data-order="' + o.id + '"]');
      if (svg) window.CakeDraw.draw(svg, { size: o.cake.size, shape: o.cake.shape, colors: window.CakeCatalog.colorsOf(o.cake) });
    });
  }

  function load() {
    window.Account.api("GET", "/api/orders")
      .then(function (data) { orders = data.orders || []; statusKey = null; render(); })
      .catch(function () { statusKey = "auth.err.server_error"; render(); });
  }

  /* ---- cancel: ask first (yes / no pop-up) ---- */
  var dialog = $("cancel-dialog");

  function renderDialog() {
    if (!dialog || !pending) return;
    $("cancel-text").textContent = fmt("orders.cancel.text", { code: pending.code });
  }

  function closeDialog() {
    if (dialog && dialog.open) dialog.close();
    pending = null;
  }

  function doCancel(order) {
    window.Account.api("POST", "/api/orders/" + order.id + "/cancel")
      .then(function (data) {
        orders = orders.map(function (o) { return o.id === data.order.id ? data.order : o; });
        statusKey = null;
        render();
      })
      .catch(function (err) {
        statusKey = err.code === "cannot_cancel" ? "orders.err.cannot_cancel" : "auth.err.server_error";
        if (err.code === "cannot_cancel") load(); // the Cancel button should disappear
        else render();
      });
  }

  listEl.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-cancel]") : null;
    if (!btn) return;
    var order = orders.filter(function (o) { return o.id === btn.getAttribute("data-cancel"); })[0];
    if (!order) return;
    pending = order;
    if (dialog && dialog.showModal) {
      renderDialog();
      dialog.showModal();
      $("cancel-no").focus();
    } else if (window.confirm(fmt("orders.cancel.text", { code: order.code }))) {
      pending = null;
      doCancel(order);
    } else {
      pending = null;
    }
  });

  if (dialog) {
    $("cancel-yes").addEventListener("click", function () {
      var order = pending;
      closeDialog();
      if (order) doCancel(order);
    });
    $("cancel-no").addEventListener("click", closeDialog);
    // clicking the dark area outside the box counts as "no"
    dialog.addEventListener("click", function (e) { if (e.target === dialog) closeDialog(); });
    dialog.addEventListener("close", function () { pending = null; });
  }

  document.addEventListener("languagechange", function () { render(); renderDialog(); });
  document.addEventListener("accountchange", function (e) {
    var acc = e.detail && e.detail.account;
    if (acc && orders === null) load();
    if (!acc) { orders = null; closeDialog(); render(); }
  });
})();
