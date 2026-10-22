/** Secciones de la app (módulo compartido entre servidor y cliente). */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Inicio", icon: "M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z", mobile: true },
  { href: "/calendario", label: "Calendario", icon: "M5 6h14v14H5zM5 10h14M9 4v4M15 4v4", mobile: true },
  { href: "/recetas", label: "Recetas", icon: "M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2zM6 18a2 2 0 0 1 2-2h10", mobile: true },
  { href: "/ingredientes", label: "Ingredientes", icon: "M8 4c4 0 8 3 8 8s-4 8-8 8M8 4c-2 3-2 13 0 16M5 9h6M5 15h6", mobile: false },
  { href: "/compras", label: "Compras", icon: "M5 7h14l-1.5 9h-11zM9 7a3 3 0 0 1 6 0M9 20h.01M15 20h.01", mobile: true },
  { href: "/inventario", label: "Inventario", icon: "M4 8h16v12H4zM4 8l2-4h12l2 4M10 12h4", mobile: false },
  { href: "/preparaciones", label: "Preparaciones", icon: "M5 11h14v3a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6zM3 11h18M9 7c0-1 1-1 1-2M14 7c0-1 1-1 1-2", mobile: false },
  { href: "/progreso", label: "Progreso", icon: "M4 19h16M7 16v-4M12 16V8M17 16v-7", mobile: false },
  { href: "/config", label: "Configuración", icon: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1", mobile: false },
] as const;

export const MORE_ITEMS = NAV_ITEMS.filter((i) => !i.mobile).map(({ href, label }) => ({ href, label }));
