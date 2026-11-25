// Couleurs des axes (carte et listes). Module séparé : il ne charge pas Leaflet (rendu serveur possible).
export const AXE_COLORS = ["#4338ca", "#0d9488", "#c2410c", "#be185d", "#0284c7", "#65a30d", "#7c3aed", "#b45309", "#0f766e", "#dc2626", "#4d7c0f", "#9333ea", "#0369a1", "#a16207", "#15803d", "#e11d48"];
export const axeColor = (i: number) => (i < 0 ? "#94a3b8" : AXE_COLORS[i % AXE_COLORS.length]);
