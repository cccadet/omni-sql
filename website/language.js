/* global document, navigator, location, localStorage, URL */
(() => {
  const supported = (value) => value === "en" || value === "pt-BR";
  const url = new URL(location.href);
  const requested = url.searchParams.get("lang");
  const current = document.documentElement.lang;
  const storageKey = "omni-sql.website.language";
  let saved;

  try {
    saved = localStorage.getItem(storageKey);
    if (supported(requested)) localStorage.setItem(storageKey, requested);
  } catch {
    // Language links still work when browser storage is unavailable.
  }

  const browserLanguage = (navigator.languages?.length ? navigator.languages : [navigator.language])
    .find((value) => /^(en|pt)(-|$)/i.test(value));
  const preferred = supported(requested) ? requested
    : current === "pt-BR" ? current
    : supported(saved) ? saved
    : /^pt(-|$)/i.test(browserLanguage) ? "pt-BR" : "en";

  if (preferred !== current) {
    const base = new URL(".", document.currentScript.src);
    const target = new URL(preferred === "pt-BR" ? "pt/" : "./", base);
    target.search = url.search;
    target.hash = url.hash;
    location.replace(target.href);
  }
})();
