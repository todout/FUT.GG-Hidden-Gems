# FC 27 Web App — FUT.GG Hidden Gems Helper & Auto-Lister

Herramienta diseñada para automatizar y agilizar el flujo de trabajo entre **FUT.GG (Hidden Gems)** y la **Web App de EA SPORTS FC 27**, resolviendo la necesidad de buscar manualmente cada jugador en el club, enviarlo a transferibles, presionar 'V' carta por carta y calcular precios de venta.

---

## 🚀 ¿Qué problema resuelve?

### El flujo manual anterior:
1. Ir a `https://www.fut.gg/gg-club/hidden-gems/`.
2. Ver la lista de jugadores valiosos (plata, bronce o raros por SBCs/Evos).
3. Ir a la Web App de FC 27.
4. Buscar cada jugador uno a uno en el club.
5. Enviarlo a la lista de transferibles.
6. En transferibles, ir carta por carta apretando la tecla `V` (Paletools) para comparar precios de mercado y verificar si el precio de FUT.GG es real o está desfasado.
7. Ajustar precio y listar manualmente.
*(Tiempo estimado para 15-25 jugadores: 15 a 20 minutos).*

### El nuevo flujo automatizado:
1. Abres la Web App de FC 27 en tu navegador habitual (con Paletools / FUT Enhancer activo).
2. Verás en la esquina inferior derecha el botón minimalista **`💎 [N]`** (mostrando en tiempo real el número de joyas que tienes listas para vender).
3. **Auto-sincronización en segundo plano**:
   - El script sincroniza automáticamente cada **30 minutos** (respetando el límite oficial de FUT.gg) y escanea tu club.
   - Si FUT.gg añade una joya nueva, aparece una **alerta en la parte inferior** (`💎 ¡Nueva Gema en FUT.GG!`) y el botón pulsa suavemente en verde esmeralda.
   - Si la joya nueva está en tu club, la alerta te avisa de inmediato para que puedas venderla.
4. Haces clic en el botón flotante (o pulsas **`Alt + G`**) para abrir el panel:
   - Las joyas recién agregadas se marcan con la etiqueta `✨ NUEVA`.
   - Puedes forzar una recarga manual en cualquier momento con **"🔄 Cargar de FUT.GG"**.
5. Haces clic en **"📥 Mover Todas a Transferibles"** (las mueve con delay seguro de 1.2s).
6. Haces clic en **"📊 Comprobar Mercado (Todas las Páginas) [V]"** (o verificas individualmente):
   - El script recorre **todas las páginas del mercado automáticamente por defecto**, simulando el ritmo de navegación de un humano (delays de 1.4s a 2.3s por página) con indicador de progreso en vivo (`⏳ Analizando pág. X...`) y botón `[⏹️ Detener]`.
   - **Detección inteligente de errores / snipes**: Si alguien listó una carta por descuido a un precio absurdo (ej. 1.000 vs piso real de 1.400), el helper te avisa con `⚠️ Snipe / Posible error` y basa la sugerencia en el precio real para no regalar tus monedas.
   - **Desplegable interactivo de precios**: Muestra un desglose completo con cuántas cartas hay a cada precio (ej: 2 a 1.000, 33 a 1.400, 26 a 1.500).
   - **Selección a 1-clic**: Puedes hacer clic en cualquiera de los precios del desglose para fijarlo inmediatamente como tu precio de venta.
7. Ajustas precios si lo deseas con los botones `[-]` y `[+]`, y haces clic en **"🚀 Listar Seleccionadas"** (o en **"Mover"**). Localizador multicapa de 7 vías en tu club, plantilla y transferibles. (Se lista a 1 hora con puja inicial a 1 paso inferior).

---

## 🛡️ Seguridad Anti-Ban de EA (Prioridad Absoluta)

A EA no le gustan los bots externos ni las peticiones masivas sin control. Por esa razón:
- **Se ejecuta dentro de tu navegador real (Userscript de Tampermonkey)**: Utiliza tu sesión auténtica, tus cookies de Akamai y tus tokens legítimos. No genera discrepancias de IP ni de huella TLS.
- **Delays aleatorios (Gaussian Jitter)**: Cada búsqueda en el mercado y cada listado tiene una espera humana aleatoria de **3.0 a 4.5 segundos**.
- **Pausa de seguridad por ráfagas**: Cada 10 búsquedas consecutivas, el script realiza una pausa preventiva de 15 segundos.
- **Circuit Breaker automático**: Si EA devuelve un error de límite (`429`), verificación (`521`) o Captcha, el script se **detiene inmediatamente** y emite una alerta sonoro/visual para que no se comprometa la cuenta.

---

## 📦 Herramientas Incluidas

### 1. `fc27_futgg_gems_helper.user.js` (Userscript para el Navegador)
El script principal para Tampermonkey / Violentmonkey.
- **Instalación rápida**:
  1. Abre la extensión **Tampermonkey** en tu navegador.
  2. Crea un nuevo script ("+") o ve a *Utilidades > Importar archivo*.
  3. Pega el contenido de [`fc27_futgg_gems_helper.user.js`](file:///d:/Antrigravity%20-%20Projects/fc27/fc27_futgg_gems_helper.user.js).
  4. Guarda el script (`Ctrl + S`).
  5. Entra a la [Web App de FC 27](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/). Verás el botón flotante verde en la esquina inferior derecha.

### 2. `futgg_gems_inspector.py` (CLI Local en Python)
Un script de terminal para inspeccionar tus joyas o forzar la sincronización sin abrir el navegador.
- **Ver estado y joyas**:
  ```bash
  python futgg_gems_inspector.py
  ```
- **Forzar sincronización de club con FUT.GG**:
  ```bash
  python futgg_gems_inspector.py --sync
  ```

---

## ⌨️ Atajos de Teclado
- **`Alt + G`**: Abrir / cerrar el panel de FUT.GG Hidden Gems en la Web App.

---

## 🔍 Resumen de la Investigación de APIs

1. **FUT.GG API**:
   - Endpoint: `https://www.fut.gg/api/gg-club/hidden-gems/?game=27`
   - Autenticación: Cookie de sesión o header `Authorization: Bearer <futgg_jwt>`.
   - Estado de Sincronización: `https://www.fut.gg/api/gg-club/sync-status/` (límite de 15 minutos entre syncs completos).
   - Datos por carta: `eaId` (ID exacto de EA FC), nombre, precio estimado, beneficio y flag de `isExtinct`.

2. **EA Sports FC Web App**:
   - Búsqueda de club: `services.Club.searchClubPlayers(criteria)` filtrando por `maskedDefId: eaId`.
   - Movimiento: `services.Item.move(item, 2)` (donde `2` es `ItemPile.TRANSFER`).
   - Comparación de mercado: `services.Item.searchTransferMarket(criteria)` con `defId: [eaId]`.
   - Listado en mercado: `services.Item.list(item, startBid, buyNowPrice, 3600)` (duración 1 hora).

---

## 🚀 Novedades v1.6.0
1. **Corrección de detección de cartas transferibles**:
   - Se corrigió la comprobación estricta de `untradeable` de EA, garantizando que todas tus cartas transferibles del club figuren correctamente como `🟢 En Club (Tradeable)` en lugar del falso positivo `🔒 Intransferible`.
2. **Ocultamiento automático de cartas vendidas o fuera del club**:
   - Si una joya ya fue vendida (como Elvedi) o ya no está en tu club porque FUT.GG aún no ha vuelto a sincronizar, el helper la oculta automáticamente de la tabla para no saturar tu lista con cartas obsoletas.
   - Casilla de verificación rápida en la barra de herramientas: `[✓] Ocultar vendidas / fuera de club (X)` para mostrar u ocultar cuando lo desees.
3. **Monitoreo de subastas en vivo (`🚀 VENDIÉNDOSE`)**:
   - Las cartas que ya están listadas en el mercado de transferibles muestran su estado activo con tiempo restante en cuenta regresiva (`🚀 VENDIÉNDOSE (52m)`) y su precio BIN actual, actualizándose cada 15 segundos sin peticiones extra.
   - Botones de acción adaptativos: Las cartas en venta o vendidas no muestran botones redundantes de "Mover" o "Listar".
4. **Blindaje de la acción "Mover"**:
   - Verificación previa de estado: No intenta mover cartas que ya están en el mercado, ya están vendidas o son intransferibles (evitando el error de "Destination full" que arrojaba EA al intentar mover cartas no elegibles).
   - Verificación de capacidad real de la lista de transferibles antes del envío y supresor inmediato de diálogos de EA.
5. **Persistencia y auto-captura de Token FUT.GG perfeccionada**:
   - Almacenamiento seguro en Tampermonkey con recuperación garantizada y sin rechazos por desfase horario.

## 🚀 Novedades v1.9.0
1. **Auto-Sincronización de Club al Abrir Sobres (Packs)**:
   - El script intercepta de forma pasiva cuando abres sobres o compras packs en la Web App de EA FC 27.
   - Si han transcurrido más de 30 minutos desde la última sincronización, dispara automáticamente el `Sync Club` en los servidores de FUT.GG para que detecte tus cartas nuevas de inmediato.
   - Si aún estás en cooldown (< 30 min), programa la sincronización para ejecutarse automáticamente en cuanto el cooldown finalice.
2. **Botón Directo `☁️ Sync Club FUT.GG` en la Web App**:
   - Ahora puedes forzar la sincronización de tu club con FUT.GG directamente desde la Web App de EA con un solo clic, sin necesidad de ir a la página de FUT.GG.
   - Si estás en la web de FUT.GG (`https://www.fut.gg/gg-club/...`), el helper también detecta y presiona el botón "Sync Club" automáticamente cuando está disponible.
3. **Comprobación de Nuevas Joyas cada 15 Minutos**:
   - Se redujo el intervalo de consulta de gemas de 30 a **15 minutos**. 1 sola petición GET cada 15 minutos es totalmente segura, indetectable y sin riesgo alguno de ban de IP.
4. **Notificaciones de Token Optimizadas en FUT.GG**:
   - El toast verde de sincronización de token se muestra únicamente una vez por sesión al entrar a FUT.GG; las renovaciones y lecturas posteriores operan 100% en silencio en segundo plano.
