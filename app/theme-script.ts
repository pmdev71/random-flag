export function themeScript() {
  return `
    (function() {
      try {
        const savedTheme = localStorage.getItem('theme');
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        const theme = savedTheme || systemTheme;
        const html = document.documentElement;
        
        if (theme === 'dark') {
          html.classList.add('dark');
          html.setAttribute('data-theme', 'dark');
        } else {
          html.classList.remove('dark');
          html.setAttribute('data-theme', 'light');
        }
        html.style.colorScheme = theme;
      } catch (e) {
        console.error('Theme initialization error:', e);
      }
    })();
  `;
}

