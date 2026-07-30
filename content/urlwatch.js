// Runs in the page's MAIN world so it can see the real History object.
// Handshake is a React SPA; most navigation is pushState with no page load,
// which the content script would otherwise miss entirely.
(() => {
  const fire = () => window.dispatchEvent(new Event("ghosted:urlchange"));

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
