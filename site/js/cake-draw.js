/*
 * Draws one simple cake as SVG from { colors | tastes, shape, size, message }.
 *   shape: "round" (default), "square", "rectangle" or "design" (round, with sparkles).
 *   Several colours show as stripes on the side. Used for the cake menu, the home page,
 *   the order summary and the small cakes in the order list.
 */
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var C = window.CakeCatalog;
  var counter = 0;
  var CREAM = "#fff3e3";

  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(node);
    return node;
  }

  // Wavy frosting edge: a band from y0 down to a wavy line about `depth` lower, from x to x+w.
  function skirt(x, y0, w, depth, color, parent) {
    var bumps = Math.max(4, Math.round(w / 22));
    var step = w / bumps;
    var d = "M" + x + " " + y0 + " h" + w + " v" + depth;
    for (var i = bumps; i > 0; i--) {
      var cx = x + (i - 0.5) * step;
      d += " Q" + cx + " " + (y0 + depth + (i % 2 ? 16 : 8)) + " " + (x + (i - 1) * step) + " " + (y0 + depth);
    }
    return el("path", { d: d + " Z", fill: color }, parent);
  }

  function topping(svg, cx, cy, message) {
    if (message) {
      el("rect", { x: cx - 46, y: cy - 14, width: 92, height: 24, rx: 12, fill: "#fff", stroke: "#f0c8d4" }, svg);
      var t = el("text", {
        x: cx, y: cy + 2.5, "text-anchor": "middle", "font-size": 11, "font-weight": 700,
        fill: "#c2416b", "font-family": "Georgia, serif",
      }, svg);
      t.textContent = message.length > 14 ? message.slice(0, 13) + "…" : message;
    } else {
      el("circle", { cx: cx, cy: cy - 4, r: 10, fill: "#c2416b" }, svg);
      el("path", { d: "M" + cx + " " + (cy - 13) + " q4 -13 15 -13", stroke: "#3d7a3a", "stroke-width": 2.5, fill: "none", "stroke-linecap": "round" }, svg);
    }
  }

  function sparkle(svg, x, y, r, color) {
    el("path", {
      d: "M" + x + " " + (y - r) + " L" + (x + r * 0.28) + " " + (y - r * 0.28) + " L" + (x + r) + " " + y +
         " L" + (x + r * 0.28) + " " + (y + r * 0.28) + " L" + x + " " + (y + r) +
         " L" + (x - r * 0.28) + " " + (y + r * 0.28) + " L" + (x - r) + " " + y +
         " L" + (x - r * 0.28) + " " + (y - r * 0.28) + " Z",
      fill: color,
    }, svg);
  }

  function colorsFor(cake) {
    if (cake.colors && cake.colors.length) return cake.colors;
    var tastes = (cake.tastes && cake.tastes.length) ? cake.tastes : ["vanilla"];
    return tastes.map(function (n) { return (C.tastes[n] || C.tastes.vanilla).color; });
  }

  // Vertical stripes of colour across x .. x+w, inside `parent`.
  function stripes(parent, colors, x, y, w, h) {
    var band = w / colors.length;
    colors.forEach(function (color, i) {
      el("rect", { x: x + i * band, y: y, width: band + 0.6, height: h, fill: color }, parent);
    });
  }

  function draw(svg, cake) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var colors = colorsFor(cake);
    var shape = cake.shape === "square" || cake.shape === "rectangle" ? cake.shape : "round";
    var size = ["small", "medium", "large"].indexOf(cake.size) === -1 ? "medium" : cake.size;
    var k = { small: 0.86, medium: 1, large: 1.14 }[size];
    var H = 300, floor = H - 40;   // where the cake stands
    svg.setAttribute("viewBox", "0 96 260 " + (H - 96));   // the cake only fills the lower part

    // plate
    el("ellipse", { cx: 130, cy: H - 24, rx: 120, ry: 15, fill: "#ecd2c7" }, svg);
    el("ellipse", { cx: 130, cy: H - 28, rx: 110, ry: 11, fill: "#fbefe8" }, svg);

    var defs = el("defs", {}, svg);
    var clipId = "cake-clip-" + (++counter);
    var clip = el("clipPath", { id: clipId }, defs);
    var g = el("g", { "clip-path": "url(#" + clipId + ")" }, svg);
    var topX, topY;   // centre of the top, for the cherry / message

    if (shape === "round") {
      var rx = 88 * k, ry = rx * 0.27, bodyH = 100, cx = 130;
      var yt = floor - bodyH;          // centre of the top ellipse
      var body = "M" + (cx - rx) + " " + yt + " L" + (cx - rx) + " " + floor +
        " A" + rx + " " + ry + " 0 0 0 " + (cx + rx) + " " + floor + " L" + (cx + rx) + " " + yt + " Z";
      el("path", { d: body }, clip);
      stripes(g, colors, cx - rx, yt - ry, rx * 2, bodyH + ry * 2 + 2);
      el("rect", { x: cx - rx, y: floor - 14, width: rx * 2, height: 5, fill: "rgba(255,255,255,0.3)" }, g);
      skirt(cx - rx, yt, rx * 2, ry + 6, CREAM, g);
      el("ellipse", { cx: cx, cy: yt, rx: rx, ry: ry, fill: CREAM }, svg);
      el("ellipse", { cx: cx, cy: yt, rx: rx - 7, ry: ry - 3, fill: "none", stroke: "#f3dcc4", "stroke-width": 1.5 }, svg);
      topX = cx; topY = yt;
    } else {
      // seen from a little above and to the side: front, right side and top
      var w, d, bodyH2 = 92;
      if (shape === "square") { w = 112 * k; d = w; }
      else { w = 168 * k; d = w * 0.5; }
      var dx = d * 0.45, dy = d * 0.3;
      var fx = 130 - (w + dx) / 2, fy = floor - bodyH2;   // top-left corner of the front face
      el("path", { d: "M" + fx + " " + fy + " h" + w + " l" + dx + " " + (-dy) + " v" + bodyH2 + " l" + (-dx) + " " + dy + " h" + (-w) + " Z" }, clip);
      stripes(g, colors, fx, fy - dy, w + dx, bodyH2 + dy + 2);
      // the right side is a little darker
      el("path", { d: "M" + (fx + w) + " " + fy + " l" + dx + " " + (-dy) + " v" + bodyH2 + " l" + (-dx) + " " + dy + " Z", fill: "rgba(60,20,10,0.16)" }, g);
      el("rect", { x: fx, y: floor - 14, width: w + dx, height: 5, fill: "rgba(255,255,255,0.3)" }, g);
      skirt(fx, fy, w, 6, CREAM, g);
      el("path", { d: "M" + (fx + w) + " " + fy + " l" + dx + " " + (-dy) + " v10 l" + (-dx) + " " + dy + " Z", fill: "#f1e1cc" }, g);
      el("path", { d: "M" + fx + " " + fy + " h" + w + " l" + dx + " " + (-dy) + " h" + (-w) + " Z", fill: CREAM }, svg);
      topX = fx + (w + dx) / 2; topY = fy - dy / 2;
    }

    topping(svg, topX, topY - 4, cake.message);

    if (cake.shape === "design") {
      sparkle(svg, 26, 130, 11, "#f19bb0");
      sparkle(svg, 236, 118, 14, "#c2416b");
      sparkle(svg, 226, 190, 8, "#f2d65c");
      sparkle(svg, 30, 200, 7, "#c2416b");
    }
  }

  window.CakeDraw = { draw: draw };
})();

/* Small text helpers shared by the order page and the order list. */
(function () {
  function t(key) { return window.I18n ? window.I18n.t(key) : key; }

  // t() with {placeholders}
  function fmt(key, vars) {
    return t(key).replace(/\{(\w+)\}/g, function (m, name) {
      return vars && vars[name] !== undefined ? vars[name] : m;
    });
  }

  function money(n) {
    var s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, window.I18n && window.I18n.lang === "en" ? "," : ".");
    return fmt("money", { n: s });
  }

  // "2026-10-24" -> "Sat, 24 October 2026" / "саб, 24 октомври 2026" (no time zone surprises)
  function formatDay(iso) {
    if (!iso) return "";
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var en = window.I18n && window.I18n.lang === "en";
    var months = en
      ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
      : ["јануари", "февруари", "март", "април", "мај", "јуни", "јули", "август", "септември", "октомври", "ноември", "декември"];
    var days = en ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["нед", "пон", "вто", "сре", "чет", "пет", "саб"];
    return days[d.getUTCDay()] + ", " + p[2] + " " + months[p[1] - 1] + " " + p[0];
  }

  function slot(id) {
    var parts = String(id).split("-");
    return parts[0] + ":00–" + parts[1] + ":00";
  }

  // "Milk, Eggs, Gluten"
  function allergens(list) {
    return list.map(function (a) { return t("allergen." + a); }).join(", ");
  }

  // "Chocolate" for a cake from the menu; orders from the first versions can have been
  // "Your own cake: Lemon, Pistachio" (their own tastes).
  function cakeName(cake) {
    if (cake.type !== "custom") return t("cake." + cake.base);
    var names = (cake.tastes || []).map(function (x) { return t("taste." + x); }).join(", ");
    return t("order.custom.name") + ": " + names;
  }

  window.CakeUI = { t: t, fmt: fmt, money: money, formatDay: formatDay, slot: slot, allergens: allergens, cakeName: cakeName };
})();
