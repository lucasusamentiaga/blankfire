# Blankfire

**Paper trading de memecoins dentro de [Padre](https://trade.padre.gg) (Terminal).** Practica tus trades con SOL ficticio, con los mismos precios, comisiones y slippage que en real, antes de arriesgar tu dinero.

Extensión para Chrome y Opera GX (Manifest V3). Español e inglés.

![Marca de Blankfire](Marca%20Blankfire/blankfire-lamina.png)

## Qué hace

- **Panel dentro de Padre** que detecta el token que estás viendo y te deja comprar y vender con SOL ficticio.
- **Simulación realista**: comisión de Padre, priority fee (también si la orden falla), slippage según la liquidez del pool, retraso de ejecución y rechazo de precios congelados.
- **Stop, Take y stop dinámico** que se ejecutan solos, aunque cierres la pestaña, y **órdenes límite** («compra si baja a…»).
- **Ajustes recomendados** según el tipo de token: nuevo par (en la curva de pump.fun) o graduado, explicando el porqué.
- **Diario de trading**: notas de por qué entras y sales, «¿seguiste tu plan?» y etiquetas (FOMO, venganza, con prisa…).
- **Estadísticas**: acierto, profit factor, plan vs. impulso, rachas, costes y un consejo automático.
- **Disciplina**: límite de pérdida diaria que bloquea las compras hasta el día siguiente.
- **Recorridos guiados** del panel y de la ventana, con pasos «Pruébalo» y una compra y venta guiadas que enseñan lo que se llevan las comisiones.
- Precios de **DexScreener** y **Jupiter** (para tokens recién creados). No toca tu wallet ni tu cuenta de Padre.

## Instalar (sin empaquetar)

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` (en Opera GX, `opera://extensions`).
3. Activa el **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida** y elige la carpeta `Fogueo`.
   (Opcional: añade la tipografía Code Next, mira *Tipografías* más abajo.)
5. Abre un token en [trade.padre.gg](https://trade.padre.gg): el panel aparece solo. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> lo muestra u oculta.

> La carpeta se llama `Fogueo` (el nombre original del proyecto) a propósito: el navegador identifica la extensión por su ruta, y cambiarla borraría tu cuenta de práctica.

## Estructura

```
Fogueo/              La extensión
  manifest.json
  background.js      Service worker: cuenta, precios, simulación, TP/SL y órdenes
  content/           Panel dentro de Padre (Shadow DOM) y recorrido guiado
  popup/             Ventana del icono: cartera, historial, estadísticas y ajustes
  lib/               Lógica compartida (simulación, formato) e idiomas
  _locales/          Nombre y descripción en español e inglés
Marca Blankfire/     Lámina de la marca, filosofía visual y fuentes para regenerar los iconos
tests/               Pruebas de extremo a extremo con Playwright
```

## Pruebas

```bash
cd tests
npm install
npx playwright install chromium
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 npm test
```

Las pruebas cargan la extensión en Chromium, simulan las APIs de precios y Padre, y comprueban compras, ventas, TP/SL, stop dinámico, órdenes límite, recorridos, idiomas y que nada en modo inglés quede en español.

## Aviso

Blankfire es una herramienta de práctica. Los resultados son una aproximación: en real, la ejecución puede ser peor en tokens muy nuevos o con poca liquidez. Nada de esto es asesoramiento financiero.

## Tipografías

- **Barlow** y **Barlow Semi Condensed** (SIL Open Font License) van incluidas.
- **Code Next ExtraBold** (de [Fontfabric](https://www.fontfabric.com/fonts/code-next/), gratuita) se usa para la marca, los títulos y las cifras grandes, pero **no está en el repositorio**: su licencia no permite redistribuir el archivo. Sin ella la extensión funciona igual y usa Barlow en su lugar. Para tener el aspecto original, descarga Code Next desde Fontfabric y copia `CodeNext-ExtraBold.woff2` (carpeta *Commercial/WEB*) como `Fogueo/fonts/codenext-800.woff2`.
