# Blankfire

**Paper trading de memecoins dentro de [Padre](https://trade.padre.gg) (Terminal).** Practica tus trades con SOL ficticio, con los mismos precios, comisiones y slippage que en real, antes de arriesgar tu dinero.

Extensión para Chrome y Opera GX (Manifest V3). Español e inglés.

![Blankfire: el panel dentro de Padre y la ventana del icono](docs/captura.png)

## Qué hace

- **Panel dentro de Padre** que detecta el token que estás viendo y te deja comprar y vender con SOL ficticio.
- **Simulación realista**: comisión de Padre más la del pool (curva de pump.fun o PumpSwap/Raydium), priority fee (también si la orden falla), slippage calculado con la curva real de pump.fun o la liquidez del pool, retraso de ejecución y rechazo de precios congelados.
- **Stop, Take y stop dinámico** que se ejecutan solos, aunque cierres la pestaña, y **órdenes límite** («compra si baja a…»).
- **Ajustes recomendados** según el tipo de token: nuevo par (en la curva de pump.fun) o graduado, explicando el porqué.
- **Diario de trading**: notas de por qué entras y sales, «¿seguiste tu plan?» y etiquetas (FOMO, venganza, con prisa…).
- **Estadísticas**: acierto, profit factor, plan vs. impulso, rachas, costes y un consejo automático.
- **Disciplina**: límite de pérdida diaria que bloquea las compras hasta el día siguiente.
- **Recorridos guiados** del panel y de la ventana, con pasos «Pruébalo» y una compra y venta guiadas que enseñan lo que se llevan las comisiones.
- **Blankfire Pro**:
  - **Qué pasó después**: gráfica del precio desde 20 min antes de entrar hasta 60 min después de vender, con el máximo y el mínimo tras tu venta y cuánto SOL te dejaste (o te ahorraste).
  - **Errores del trade** detectados al momento con reglas claras: entrar persiguiendo la subida, sin stop, posición demasiado grande, vender pronto, stop demasiado ajustado, devolver la ganancia, comisiones, trade de venganza…
  - **Análisis con IA** (Google Gemini, con tu propia clave gratuita): nota de la ejecución, fallos, lo que hiciste bien y una lección para el próximo trade.
- Precios de **DexScreener** y **Jupiter** (para tokens recién creados), con **GeckoTerminal** de respaldo si Jupiter empieza a pedir clave. No toca tu wallet ni tu cuenta de Padre.

## Instalar (sin empaquetar)

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` (en Opera GX, `opera://extensions`).
3. Activa el **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida** y elige la carpeta `Fogueo`.
5. Abre un token en [trade.padre.gg](https://trade.padre.gg): el panel aparece solo. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> lo muestra u oculta.

> La carpeta se llama `Fogueo` (el nombre original del proyecto) a propósito: el navegador identifica la extensión por su ruta, y cambiarla borraría tu cuenta de práctica.

## Actualizar

Cuando se publica una versión nueva aquí, Blankfire te avisa solo: sale una tarjeta en el panel de Padre y en la ventana del icono, y una notificación del sistema. Para actualizar:

1. Haz doble clic en **`actualizar.bat`** (en la carpeta del proyecto). Descarga la versión nueva con Git. Si no usas Git, descarga el [ZIP](https://github.com/lucasusamentiaga/blankfire/archive/refs/heads/main.zip) y reemplaza la carpeta `Fogueo`.
2. Pulsa **Recargar Blankfire** en la tarjeta. La extensión se recarga y Padre se refresca solo. Tu cuenta, posiciones y ajustes se quedan.

En **Ajustes** de la ventana ves tu versión y puedes buscar actualizaciones a mano. Las novedades de cada versión están en [`updates.json`](updates.json).

## Blankfire Pro

### Análisis con IA (cada usuario)

1. Entra en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con tu cuenta de Google.
2. Pulsa **Create API key** y cópiala.
3. En la ventana de Blankfire: **Ajustes → Blankfire Pro**, pégala en «Análisis con IA (Gemini)» y pulsa **Guardar** (se prueba sola).
4. En **Historial**, abre un trade cerrado y pulsa **Analizar**.

La clave se guarda solo en tu navegador, aparte de tu cuenta, y el panel de Padre nunca la ve. A Gemini se le envían los datos del trade y tus notas, nunca nada de tu wallet. El nivel gratuito de Gemini tiene límites por minuto y por día.

### Cobrar el Pro (para el autor)

Mientras `PRO_CONFIG.checkoutUrl` esté vacío en [`Fogueo/lib/pro.js`](Fogueo/lib/pro.js), el Pro funciona gratis para todos como **beta**. Para empezar a cobrar con [Lemon Squeezy](https://www.lemonsqueezy.com) (de Stripe; cobra, hace las facturas con IVA y genera una clave de licencia por compra):

1. Crea tu cuenta y tu tienda en Lemon Squeezy y completa la activación de la tienda (datos para cobrar).
2. Crea un producto «Blankfire Pro» con su precio (pago único o suscripción).
3. En el producto, activa **License keys** (generar claves de licencia) y pon un límite de activaciones (p. ej. 2 navegadores).
4. Publica el producto y copia su enlace de compra (**Share**).
5. Copia el número de tu tienda (Settings → Stores) y el del producto.
6. Rellena `checkoutUrl`, `storeId` y `productId` en `Fogueo/lib/pro.js`, sube el cambio y recarga Blankfire.

La extensión activa y comprueba la licencia con la License API pública de Lemon Squeezy (sin claves secretas ni servidor propio): la vuelve a comprobar cada 3 días y, sin conexión, sigue valiendo 14 días. Solo acepta licencias de tu tienda y tu producto.

> Como el código es abierto, alguien con conocimientos podría saltarse la comprobación editando el código. Para un candado real haría falta un servidor propio que haga el análisis.

## Estructura

```
Fogueo/              La extensión
  manifest.json
  background.js      Service worker: cuenta, precios, simulación, TP/SL y órdenes
  content/           Panel dentro de Padre (Shadow DOM) y recorrido guiado
  popup/             Ventana del icono: cartera, historial, estadísticas y ajustes
  lib/               Lógica compartida (simulación, formato, Pro: review.js y pro.js) e idiomas
  _locales/          Nombre y descripción en español e inglés
updates.json         Novedades de cada versión (las enseña el aviso de actualización)
actualizar.bat       Descarga la última versión con Git
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

`core.test.mjs` comprueba los cálculos (simulación, curva de pump.fun, formatos y estadísticas) sin navegador. El resto carga la extensión en Chromium, simula las APIs de precios y Padre, y comprueba compras y ventas parciales, recuperar lo invertido, TP/SL, stop dinámico, órdenes límite, límite diario, recorridos en distintas situaciones, casos visuales extremos e idiomas.

## Marca

Llama con un vacío circular: fuego sin pólvora. La lámina muestra su construcción, los tamaños del icono y la paleta; en `Marca Blankfire/` están la filosofía visual y los archivos para regenerarla.

![Lámina de la marca Blankfire](Marca%20Blankfire/blankfire-lamina.png)

## Tipografías

Todas son libres (SIL Open Font License 1.1) y van incluidas en `Fogueo/fonts/` junto a sus licencias:

- **Outfit ExtraBold**: la marca, los títulos y las cifras grandes.
- **Barlow** y **Barlow Semi Condensed**: el texto y los números del resto de la interfaz.

## Autor

Hecho por **Lucas Usamentiaga**.

- GitHub: [@lucasusamentiaga](https://github.com/lucasusamentiaga)
- Instagram: [@lucasuazz_](https://www.instagram.com/lucasuazz_/)

## Aviso

Blankfire es una herramienta de práctica. Los resultados son una aproximación: en real, la ejecución puede ser peor en tokens muy nuevos o con poca liquidez. Nada de esto es asesoramiento financiero.
