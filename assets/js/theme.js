(function(){
  const STORAGE_KEY = "egr_theme";
  const root = document.documentElement;

  function setTheme(theme){
    root.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    const label = document.querySelector("[data-theme-label]");
    if(label) label.textContent = theme === "light" ? "Light" : "Dark";
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  setTheme(saved || (prefersLight ? "light" : "light"));

  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-theme-toggle]");
    if(!btn) return;
    const current = root.getAttribute("data-theme") || "light";
    setTheme(current === "dark" ? "light" : "dark");
  });
})();
