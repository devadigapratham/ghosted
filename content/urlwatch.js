// Runs in the page's MAIN world (see manifest). Handshake is a React SPA, so
// navigations happen via history.pushState/replaceState with no page load.
// We patch both and dispatch a DOM event that the isolated-world content
// script listens for. No data crosses worlds — the listener reads
// location.href itself.
(() => {
  const fire = () => window.dispatchEvent(new Event("hs2s:urlchange"));
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      fire();
      return result;
    };
  }
  window.addEventListener("popstate", fire);
})();
