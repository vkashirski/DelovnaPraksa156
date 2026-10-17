const dict = {
  mk: {},
  en: {
    nav_about: 'About', nav_team: 'Team', nav_services: 'Services', nav_news: 'News', nav_contact: 'Contact',
    hero_title: 'Welcome', hero_text: 'A short summary of what this is about.',
    about_text: 'Basic information, history, opening hours, location.',
    role: 'Role', service: 'Service', service_text: 'Description and price.',
    post: 'Post', post_text: 'Post content.',
    ph_name: 'Name', ph_email: 'Email', ph_message: 'Message', send: 'Send',
    cookie_policy: 'Cookie policy', cookie_text: 'We use cookies to improve your experience.', accept: 'Accept',
    sent: 'Thank you, your message was sent.', invalid: 'Please fill in all fields.'
  }
};
const mkExtra = { sent: 'Ви благодариме, пораката е испратена.', invalid: 'Пополнете ги сите полиња.' };

// Save the original Macedonian text so we can switch back.
document.querySelectorAll('[data-i18n]').forEach(el => dict.mk[el.dataset.i18n] = el.textContent);
document.querySelectorAll('[data-i18n-ph]').forEach(el => dict.mk[el.dataset.i18nPh] = el.placeholder);
Object.assign(dict.mk, mkExtra);

function setLang(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = dict[lang][el.dataset.i18n] ?? el.textContent; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = dict[lang][el.dataset.i18nPh] ?? el.placeholder; });
  try { localStorage.setItem('lang', lang); } catch (e) {}
}
document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
try { const saved = localStorage.getItem('lang'); if (saved && saved !== 'mk') setLang(saved); } catch (e) {}

// Cookie banner
const banner = document.getElementById('cookie-banner');
try { if (!localStorage.getItem('cookies')) banner.hidden = false; } catch (e) { banner.hidden = false; }
document.getElementById('cookie-accept').addEventListener('click', () => {
  banner.hidden = true;
  try { localStorage.setItem('cookies', 'ok'); } catch (e) {}
});

// Contact form (no backend yet: validates only)
document.getElementById('contact-form').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, status = document.getElementById('form-status'), lang = document.documentElement.lang || 'mk';
  const ok = f.name.value.trim() && /\S+@\S+\.\S+/.test(f.email.value) && f.message.value.trim();
  status.textContent = ok ? dict[lang].sent : dict[lang].invalid;
  if (ok) f.reset();
});
