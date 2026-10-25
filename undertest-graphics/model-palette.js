(() => {
  const hues = ['blue', 'teal', 'leaf', 'amber', 'violet', 'orange', 'cyan', 'graphite'];
  const weak = color => {
    const value = color.trim().toLowerCase();
    const style = getComputedStyle(document.documentElement);
    for (const hue of hues) {
      const strong = style.getPropertyValue(`--palette-${hue}-strong`).trim();
      if (value === strong.toLowerCase()) {
        return style.getPropertyValue(`--palette-${hue}-weak`).trim();
      }
    }
    if (!/^#[0-9a-f]{6}$/i.test(value)) return color;
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const background = dark ? '#1c1c1b' : '#ffffff';
    return '#' + [1, 3, 5].map(i => Math.round(
      parseInt(value.slice(i, i + 2), 16) * .55 +
      parseInt(background.slice(i, i + 2), 16) * .45
    ).toString(16).padStart(2, '0')).join('');
  };
  window.UndertestPalette = Object.freeze({ weak });
})();
