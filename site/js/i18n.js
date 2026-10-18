/*
 * Tiny i18n engine.
 * Both dictionaries (localisation/en.js, localisation/mk.js) are loaded up front with the page,
 * so switching language is a pure in-memory DOM update: no network, no reload.
 * The chosen language is stored in the "lang" cookie (1 year), so a returning
 * visitor gets their language back.
 *
 * Markup hooks:
 *   data-i18n="key"              -> element.textContent
 *   data-i18n-placeholder="key"  -> placeholder attribute
 *   data-i18n-aria="key"         -> aria-label attribute
 *   data-i18n-alt="key"          -> alt attribute
 *   <body data-title-key="key">  -> document.title
 *   #lang-toggle + #lang-menu    -> the globe button and its language list
 *   [data-lang="mk|en"]          -> one entry in the list
 */
(function () {
  var COOKIE_NAME = "lang";
  var COOKIE_DAYS = 365;
  var DEFAULT_LANG = "mk";
  var SUPPORTED = ["mk", "en"];
  var dict = window.I18N_DICT || {};
  var current = DEFAULT_LANG;

  function readSaved() {
    var v = window.Cookies ? window.Cookies.get(COOKIE_NAME) : null;
    return SUPPORTED.indexOf(v) !== -1 ? v : null;
  }

  function save(lang) {
    if (window.Cookies) window.Cookies.set(COOKIE_NAME, lang, COOKIE_DAYS);
  }

  function t(key) {
    var d = dict[current] || {};
    if (Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    var fb = dict[DEFAULT_LANG] || {};
    return Object.prototype.hasOwnProperty.call(fb, key) ? fb[key] : key;
  }

  function setAttr(selector, dataAttr, attr) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute(attr, t(nodes[i].getAttribute(dataAttr)));
    }
  }

  function byId(id) { return document.getElementById(id); }

  function apply() {
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    setAttr("[data-i18n-placeholder]", "data-i18n-placeholder", "placeholder");
    setAttr("[data-i18n-aria]", "data-i18n-aria", "aria-label");
    setAttr("[data-i18n-alt]", "data-i18n-alt", "alt");

    var titleKey = document.body && document.body.getAttribute("data-title-key");
    if (titleKey) document.title = t(titleKey);

    document.documentElement.setAttribute("lang", current);

    var items = document.querySelectorAll("[data-lang]");
    for (var j = 0; j < items.length; j++) {
      if (items[j].getAttribute("data-lang") === current) {
        items[j].setAttribute("aria-current", "true");
      } else {
        items[j].removeAttribute("aria-current");
      }
    }

    var btn = byId("lang-toggle");
    if (btn) {
      btn.setAttribute("aria-label", t("lang.switch"));
      btn.setAttribute("title", t("lang.switch"));
    }
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) return;
    current = lang;
    save(lang);
    apply();
    document.dispatchEvent(new CustomEvent("languagechange", { detail: { lang: lang } }));
  }

  /* ---- dropdown ---- */
  function isOpen() {
    var menu = byId("lang-menu");
    return !!menu && !menu.hidden;
  }

  function setOpen(open) {
    var menu = byId("lang-menu");
    var btn = byId("lang-toggle");
    if (!menu || !btn) return;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function init() {
    current = readSaved() || DEFAULT_LANG;
    apply();

    var btn = byId("lang-toggle");
    var menu = byId("lang-menu");
    var wrap = document.querySelector(".lang-switch");

    if (btn) btn.addEventListener("click", function () { setOpen(!isOpen()); });

    if (menu) {
      menu.addEventListener("click", function (e) {
        var item = e.target.closest ? e.target.closest("[data-lang]") : null;
        if (!item) return;
        setLang(item.getAttribute("data-lang"));
        setOpen(false);
        if (btn) btn.focus();
      });
    }

    document.addEventListener("click", function (e) {
      if (isOpen() && wrap && !wrap.contains(e.target)) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) {
        setOpen(false);
        if (btn) btn.focus();
      }
    });
  }

  window.I18n = { t: t, setLang: setLang, get lang() { return current; } };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
