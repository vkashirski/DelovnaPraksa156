/*
 * Minimal cookie helper.
 * Real cookies (path=/, SameSite=Lax) so every page, including pages/, shares them.
 * When opened straight from disk (file://) browsers do not keep cookies, so we
 * fall back to localStorage there; on the deployed site real cookies are used.
 */
(function () {
  var useStorage = location.protocol === "file:" || !navigator.cookieEnabled;

  function get(name) {
    if (useStorage) {
      try { return localStorage.getItem("ck_" + name); } catch (e) { return null; }
    }
    var parts = document.cookie ? document.cookie.split("; ") : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf("=");
      if (eq === -1) continue;
      if (decodeURIComponent(parts[i].slice(0, eq)) === name) {
        return decodeURIComponent(parts[i].slice(eq + 1));
      }
    }
    return null;
  }

  function set(name, value, days) {
    if (useStorage) {
      try { localStorage.setItem("ck_" + name, value); } catch (e) { /* ignore */ }
      return;
    }
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie =
      encodeURIComponent(name) + "=" + encodeURIComponent(value) +
      "; expires=" + expires +
      "; path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }

  window.Cookies = { get: get, set: set };
})();
