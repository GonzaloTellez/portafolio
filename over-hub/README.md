# Réplica HTML del prototipo OVER Collab Hub

Convierte el prototipo de Figma (copia `dmoiKQGXpYT1p23S66Nd8e`) en HTML interactivo.

- `gen.py`: traduce nodos de Figma a HTML/CSS posicionado (SVG locales desde la geometría, máscaras, textos).
- `gen2.py`: recorre el prototipo desde el feed (navegaciones, overlays, variantes) y escribe `out/build.json`.
- `player.js`: reproductor que interpreta las interacciones de Figma (variables, condiciones, hovers, overlays).
- `assemble.py`: arma `out/index.html` con fuentes locales.
- `datos/`: respuesta de la API guardada (la API del plan gratuito tiene un límite muy bajo por archivo).
