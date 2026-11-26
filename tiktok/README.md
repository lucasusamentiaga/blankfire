# Vídeos de TikTok de Blankfire (gratis, en tu PC)

Cada día a las 08:30 se generan dos vídeos verticales (1080x1920, ~20 s): uno en español y otro en inglés, con la misma idea pero textos propios.

- **Qué se ve:** la app de verdad (bot, comisiones o radar) con datos de ejemplo, marcada como «Demo · datos de ejemplo». Nunca se graba tu cuenta ni tu dinero.
- **Textos:** gancho, 4 frases y cierre, con la tipografía de Blankfire. Las ideas están en `ideas.json` (rotan solas; añade más cuando quieras). Ninguna promete ganancias.
- **Sonido:** sin música a propósito. La eliges en TikTok al publicar: es la forma legal de usar canciones de moda y además ayuda al alcance.
- **Dónde quedan:** `tiktok/cola/` (y una copia en `OneDrive\Blankfire TikTok` para tenerlos en el móvil). Junto a cada vídeo, un `.txt` con la descripción y los hashtags.

## Publicar

Nada se publica sin tu OK. Dos formas:
1. Desde el móvil: abre el vídeo en OneDrive, compártelo a TikTok, elige música, pega la descripción del `.txt` y publica.
2. Pídeselo a Claude («sube los vídeos de hoy»): te enseña cada vídeo, le dices OK y lo sube desde el navegador de la app de Claude (hay que iniciar sesión en TikTok ahí una vez).

## A mano

```
cd tiktok
npm install
npx playwright install chromium
node make.mjs --today                 # los dos de hoy
node make.mjs --idea=rug --lang=en    # uno concreto
node make.mjs --all                   # todos, para revisar
powershell -ExecutionPolicy Bypass -File programar.ps1   # la tarea diaria
```
