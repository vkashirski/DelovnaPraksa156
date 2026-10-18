/*
 * The cake menu: ready-made cakes, tastes, sizes, prices, allergens and the notice
 * we need. Shared by the browser (window.CakeCatalog) and the server
 * (require("../site/js/cake-catalog.js")), so the price and allergens shown while
 * ordering are exactly the ones the server stores. Change them here only.
 *
 * Prices are in Macedonian denars (MKD).
 *
 * ALLERGENS: these are PLACEHOLDERS for the demo. Before real customers use the site,
 * check every cake against the real recipes.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CakeCatalog = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var TIME_ZONE = "Europe/Skopje";

  var catalog = {
    sizes: {
      small: { price: 1200, serves: "6–8" },
      medium: { price: 1900, serves: "12–15" },
      large: { price: 2800, serves: "20–25" },
    },

    // The 14 allergens that must be declared in the EU; only the ones we use are listed.
    // Every cake has flour, eggs and milk in the sponge and the cream.
    allergens: ["gluten", "eggs", "milk", "nuts", "soy"],
    baseAllergens: ["gluten", "eggs", "milk"],

    // A taste: colour for the drawing + any allergen it adds on top of the base ones.
    // (vanilla and lemon are no longer on the menu; they stay here so old orders still show.)
    tastes: {
      vanilla: { color: "#f3dfae", allergens: [] },
      chocolate: { color: "#6b3f2a", allergens: ["soy"] },   // chocolate usually has soy lecithin
      triple_chocolate: { color: "#4a2618", allergens: ["soy"] },
      carrot: { color: "#d9822b", allergens: ["nuts"] },     // with walnuts
      red_velvet: { color: "#a8323f", allergens: [] },
      lemon: { color: "#f2d65c", allergens: [] },
      strawberry: { color: "#f19bb0", allergens: [] },
      raspberry: { color: "#c2275b", allergens: [] },
      pistachio: { color: "#a9c27a", allergens: ["nuts"] },
      nutella: { color: "#8b5e3c", allergens: ["nuts", "soy"] },  // hazelnut spread, with soy lecithin
      walnut: { color: "#a98260", allergens: ["nuts"] },
      cheesecake: { color: "#f6e6c8", allergens: [] },
      biscuit_pudding: { color: "#d9b48a", allergens: [] },
      tiramisu: { color: "#c9a27a", allergens: [] },
      caramel: { color: "#d08a3c", allergens: [] },
      cherry: { color: "#8e1b3a", allergens: [] },
    },

    // Ready-made cakes. Names and descriptions are in the language files: cake.<id>, cake.<id>.desc
    // "bands" (optional) = the colours drawn on the side, when one taste is not enough.
    cakes: {
      chocolate: { tastes: ["chocolate"] },
      triple_chocolate: { tastes: ["triple_chocolate"], bands: ["#3f2013", "#6b3f2a", "#8b5a3c"] },
      red_velvet: { tastes: ["red_velvet"] },
      strawberry: { tastes: ["strawberry"] },
      carrot: { tastes: ["carrot"] },
      pistachio: { tastes: ["pistachio"] },
      cheesecake: { tastes: ["cheesecake"] },
      biscuit_pudding: { tastes: ["biscuit_pudding"] },
      tiramisu: { tastes: ["tiramisu"] },
      nutella: { tastes: ["nutella"] },
      raspberry: { tastes: ["raspberry"] },
      nutella_raspberry: { tastes: ["nutella", "raspberry"] },
      black_forest: { tastes: ["chocolate", "cherry"] },
      walnut: { tastes: ["walnut"] },
      caramel: { tastes: ["caramel"] },
    },

    // Cakes that were sold before and are not any more: only needed to show old orders.
    retiredCakes: {
      vanilla: { tastes: ["vanilla"] },
      lemon: { tastes: ["lemon"] },
    },

    // The shape of the cake. "design" = your own design: a picture and details, for a small extra fee.
    shapes: ["round", "square", "rectangle", "design"],

    designFee: 400,         // your own design, on top of the size price
    deliveryFee: 200,
    leadDays: 3,            // days of notice; sooner = call us
    maxDaysAhead: 90,
    slots: ["10-12", "12-14", "14-16", "16-18"],
    messageMax: 40,
    notesMax: 500,
  };

  /* cake = { type: "base", base, shape, size }  ->  list of taste ids.
     (Orders from the first versions can be type "custom" with their own tastes list.) */
  function recipe(cake) { return catalog.cakes[cake.base] || catalog.retiredCakes[cake.base] || null; }

  catalog.tastesOf = function (cake) {
    if (cake.type === "custom") return (cake.tastes || []).slice();
    var base = recipe(cake);
    return base ? base.tastes.slice() : [];
  };

  /* colours for the stripes on the side of the drawn cake */
  catalog.colorsOf = function (cake) {
    var base = cake.type === "custom" ? null : recipe(cake);
    if (base && base.bands) return base.bands.slice();
    return catalog.tastesOf(cake).map(function (t) { return catalog.tastes[t] ? catalog.tastes[t].color : "#f3dfae"; });
  };

  catalog.allergensOf = function (cake) {
    var found = {};
    catalog.baseAllergens.forEach(function (a) { found[a] = true; });
    catalog.tastesOf(cake).forEach(function (t) {
      var taste = catalog.tastes[t];
      if (taste) taste.allergens.forEach(function (a) { found[a] = true; });
    });
    return catalog.allergens.filter(function (a) { return found[a]; });
  };

  catalog.price = function (cake, fulfilment) {
    var size = catalog.sizes[cake.size];
    var design = cake.shape === "design" || cake.type === "custom";
    var amount = (size ? size.price : 0) + (design ? catalog.designFee : 0);
    var delivery = fulfilment === "delivery" ? catalog.deliveryFee : 0;
    return { cake: amount, delivery: delivery, total: amount + delivery };
  };

  /* Dates are plain "YYYY-MM-DD" strings, counted in the bakery's time zone. */
  catalog.today = function (now) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(now || new Date());
    } catch (e) {
      var d = now || new Date();
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  };

  catalog.addDays = function (iso, days) {
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  };

  catalog.earliest = function (now) { return catalog.addDays(catalog.today(now), catalog.leadDays); };

  catalog.isDate = function (iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    return catalog.addDays(iso, 0) === iso; // rejects 2026-02-31 and similar
  };

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  return catalog;
});
