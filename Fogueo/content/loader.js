// Los content scripts clásicos no pueden usar `import`; cargamos el panel como módulo.
(async () => {
  if (window.__fogueoLoaded) return;
  window.__fogueoLoaded = true;
  try {
    const mod = await import(chrome.runtime.getURL('content/panel.js'));
    mod.mount();
  } catch (e) {
    console.warn('[Blankfire] no se pudo iniciar el panel:', e);
  }
})();
