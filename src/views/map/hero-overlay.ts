interface HeroOverlayOptions {
  chart: any;
  item: any;
  image: HTMLImageElement;
  host: HTMLElement;
  chartContainer?: HTMLElement;
}

export function ensureHeroOverlay(host: HTMLElement, className: string, src: string) {
  let image = host.querySelector<HTMLImageElement>(`.${className.split(/\s+/)[0]}`);
  if (!image) {
    image = document.createElement('img');
    image.className = className;
    image.src = src;
    image.alt = '';
    host.appendChild(image);
  }
  return image;
}

export function bindHeroOverlay(root: any, options: HeroOverlayOptions) {
  const { chart, item, image, host, chartContainer = host } = options;
  let lastX: number | null = null;

  const sync = () => {
    if (!chart || !item || !image) return;
    const lng = item.get('longitude');
    const lat = item.get('latitude');
    if (lng == null || lat == null) return;

    const px = chart.convert({ longitude: lng, latitude: lat });
    if (!px) return;

    const hostRect = host.getBoundingClientRect();
    const chartRect = chartContainer.getBoundingClientRect();
    const offsetX = chartRect.left - hostRect.left;
    const offsetY = chartRect.top - hostRect.top;
    const nextX = offsetX + px.x;

    if (lastX != null) {
      const dx = nextX - lastX;
      if (dx > 0.4) image.classList.add('facing-right');
      else if (dx < -0.4) image.classList.remove('facing-right');
    }

    lastX = nextX;
    image.style.left = `${nextX}px`;
    image.style.top = `${offsetY + px.y}px`;
  };

  root.events.on('frameended', sync);
  return sync;
}
