// ==UserScript==
// @name         FC 27 - FUT.GG Hidden Gems Auto-Workflow Helper
// @namespace    https://todout.github.io/FUT.GG-Hidden-Gems/
// @version      1.9.6
// @description  Automatiza el flujo de Hidden Gems de FUT.GG en la Web App de EA FC 27: botón Sync Club con cooldown dinámico y tooltip, auto-sync en segundo plano sin notificaciones invasivas, barra en 1 línea y tabla ultra compacta.
// @author       todout
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.fut.gg/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_cookie
// @connect      fut.gg
// @connect      www.fut.gg
// @updateURL    https://raw.githubusercontent.com/todout/FUT.GG-Hidden-Gems/main/fc27_futgg_gems_helper.user.js
// @downloadURL  https://raw.githubusercontent.com/todout/FUT.GG-Hidden-Gems/main/fc27_futgg_gems_helper.user.js
// @homepageURL  https://todout.github.io/FUT.GG-Hidden-Gems/
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Obtiene la clave anónima pública del backend de Supabase (auto-capturada o fallback público de fut.gg)
    function getFutGgAnonKey() {
        return GM_getValue('futgg_anon_key', '') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcwODA5MjcwLCJleHAiOjIwODYxNjkyNzB9.5955woqTCPHWWuWuiDC1SSU6HS2v91ZxYbqe2cnTc';
    }

    // Función auxiliar para decodificar el payload de un token JWT
    function getJwtPayload(tok) {
        if (!tok || typeof tok !== 'string' || !tok.startsWith('ey')) return null;
        try {
            const parts = tok.split('.');
            if (parts.length < 2) return null;
            return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        } catch (e) {
            return null;
        }
    }

    // Calcula el estado de validez, expiración y minutos restantes de un token
    function getTokenExpiryInfo(tok) {
        const payload = getJwtPayload(tok);
        if (!payload) return { valid: false, expired: true, text: 'Token inválido o vacío' };
        if (payload.iss && payload.iss.includes('clerk')) {
            return { valid: false, expired: true, text: 'Token temporal Clerk (no sirve para el backend)' };
        }
        const isAuth = payload.role === 'authenticated' || !!payload.app_metadata || (payload.email && payload.sub);
        if (!isAuth) return { valid: false, expired: true, text: 'No autenticado' };

        const email = payload.email || (payload.user_metadata && payload.user_metadata.email) || '';
        if (payload.exp) {
            const nowSec = Math.floor(Date.now() / 1000);
            const remainingSec = payload.exp - nowSec;
            if (remainingSec <= 0) {
                const minsAgo = Math.floor(Math.abs(remainingSec) / 60);
                return {
                    valid: false,
                    expired: true,
                    email,
                    remainingSec,
                    text: `Expirado hace ${minsAgo}m (${email || 'Sesión cerrada'})`
                };
            }
            const remainingMin = Math.floor(remainingSec / 60);
            return {
                valid: true,
                expired: false,
                email,
                remainingSec,
                text: `Válido (${remainingMin}m restantes - ${email})`
            };
        }
        return { valid: true, expired: false, email, text: `Válido (${email})` };
    }

    // Verifica si un token es un JWT válido de Supabase y no ha expirado
    function isRealFutGgJwt(tok, allowExpired = false) {
        const info = getTokenExpiryInfo(tok);
        if (!info.valid) return false;
        if (!allowExpired && info.expired) return false;
        return true;
    }

    // Refresca automáticamente el token JWT usando el endpoint oficial de Supabase en FUT.GG
    function refreshSupabaseToken(refreshToken) {
        return new Promise((resolve, reject) => {
            if (!refreshToken) return reject(new Error("No hay refresh token disponible"));
            console.log("[FUT.GG Helper] Intentando renovar sesión de Supabase con refresh_token...");
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://www.fut.gg/auth/v1/token?grant_type=refresh_token',
                headers: {
                    'apikey': getFutGgAnonKey(),
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({ refresh_token: refreshToken }),
                onload: function (res) {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (res.status === 200 && data.access_token) {
                            GM_setValue('futgg_jwt', data.access_token);
                            if (data.refresh_token) {
                                GM_setValue('futgg_refresh_token', data.refresh_token);
                            }
                            console.log("%c[FUT.GG Helper] 🟢 ¡Token renovado con éxito por 1 hora más!", "color:#00ff88; font-weight:bold;");
                            resolve(data);
                        } else {
                            reject(new Error(data.msg || data.message || `Error ${res.status}`));
                        }
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: function (err) {
                    reject(err);
                }
            });
        });
    }

    // =========================================================================
    // SI ESTAMOS EN FUT.GG: CAPTURA AUTOMÁTICA DEL TOKEN JWT
    // =========================================================================
    if (window.location.hostname.includes('fut.gg')) {
        let hasShownSessionToast = false;

        function showFutGgToast(msg, isWarn = false) {
            let toast = document.getElementById('futgg-sync-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'futgg-sync-toast';
                toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;background:#101924;color:#fff;padding:12px 18px;border-radius:10px;font-family:sans-serif;font-size:13px;font-weight:bold;box-shadow:0 6px 25px rgba(0,0,0,0.6);transition:all 0.3s ease;';
                document.body.appendChild(toast);
            }
            toast.style.borderColor = isWarn ? '#ffaa00' : '#00ff88';
            toast.style.border = `2px solid ${isWarn ? '#ffaa00' : '#00ff88'}`;
            toast.textContent = msg;
            setTimeout(() => { if (toast) toast.remove(); }, 5000);
        }

        function saveFoundToken(tok, source, refreshToken = null) {
            const info = getTokenExpiryInfo(tok);
            if (!info.valid) {
                return false;
            }

            if (info.expired) {
                // Si el access_token está expirado pero tenemos un refresh_token, renovarlo de inmediato
                if (refreshToken) {
                    refreshSupabaseToken(refreshToken)
                        .then(res => {
                            if (res && res.access_token) {
                                saveFoundToken(res.access_token, "Autorefresco Supabase", res.refresh_token);
                            }
                        })
                        .catch(err => console.warn("[FUT.GG Helper] Fallo en autorefresco:", err));
                }
                return false;
            }

            // Guardar token genuino y vigente
            GM_setValue('futgg_jwt', tok);
            if (refreshToken) {
                GM_setValue('futgg_refresh_token', refreshToken);
            }
            try { localStorage.setItem('futgg_jwt', tok); } catch (e) { }

            console.log(`%c[FUT.GG Gems Helper] Token FUT.GG activo desde ${source} (${info.text})`, "color:#00ff88; font-weight:bold;");

            // Mostrar el toast ÚNICAMENTE una sola vez por sesión para confirmar la carga inicial.
            // Las renovaciones y chequeos posteriores se ejecutan en silencio por detrás sin interrumpir al usuario.
            const alreadyShown = hasShownSessionToast || sessionStorage.getItem('futgg_toast_shown') === '1';
            if (!alreadyShown) {
                hasShownSessionToast = true;
                try { sessionStorage.setItem('futgg_toast_shown', '1'); } catch (e) { }
                showFutGgToast(`💎 FUT.GG Token sincronizado: ${info.text}`);
            }
            return true;
        }

        // 1. Interceptar solicitudes fetch y XHR para capturar el token real que FUT.GG usa en vivo
        const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        try {
            const origFetch = win.fetch;
            if (origFetch) {
                win.fetch = function (...args) {
                    try {
                        const opts = args[1] || {};
                        let auth = null;
                        if (opts.headers) {
                            if (opts.headers instanceof Headers) {
                                auth = opts.headers.get('authorization') || opts.headers.get('Authorization');
                            } else if (typeof opts.headers === 'object') {
                                auth = opts.headers.authorization || opts.headers.Authorization;
                            }
                        }
                        if (auth && typeof auth === 'string' && auth.startsWith('Bearer ey')) {
                            const tok = auth.slice(7).trim();
                            saveFoundToken(tok, "fetch en vivo de FUT.GG");
                        }
                    } catch (e) { }
                    return origFetch.apply(this, args);
                };
            }

            const origSetHeader = win.XMLHttpRequest && win.XMLHttpRequest.prototype.setRequestHeader;
            if (origSetHeader) {
                win.XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
                    try {
                        if (header && header.toLowerCase() === 'authorization' && value && value.startsWith('Bearer ey')) {
                            const tok = value.slice(7).trim();
                            saveFoundToken(tok, "XHR en vivo de FUT.GG");
                        }
                    } catch (e) { }
                    return origSetHeader.apply(this, arguments);
                };
            }
        } catch (e) { }

        async function captureFutGgToken() {
            try {
                // Verificar si ya tenemos un token activo y fresco (>5 minutos)
                const currentTok = GM_getValue('futgg_jwt', '');
                const curExp = getTokenExpiryInfo(currentTok);
                const isTokenFresh = curExp.valid && !curExp.expired && (curExp.remainingSec == null || curExp.remainingSec > 300);

                // 2. Intentar de localStorage / sessionStorage de fut.gg (Supabase auth session)
                const storages = [localStorage, sessionStorage];
                for (const st of storages) {
                    if (!st) continue;
                    for (let i = 0; i < st.length; i++) {
                        const key = st.key(i);
                        const val = st.getItem(key);
                        if (val && (val.includes('access_token') || val.includes('refresh_token') || val.includes('eyJ'))) {
                            try {
                                const parsed = JSON.parse(val);
                                const tok = parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token) || parsed.token;
                                const ref = parsed.refresh_token || (parsed.currentSession && parsed.currentSession.refresh_token);
                                if (ref) {
                                    GM_setValue('futgg_refresh_token', ref);
                                }
                                if (tok && saveFoundToken(tok, `localStorage (${key})`, ref)) {
                                    return;
                                }
                            } catch (e) { }
                        }
                    }
                }

                // 3. Intentar de document.cookie
                const cookies = document.cookie.split(';');
                for (const c of cookies) {
                    const idx = c.indexOf('=');
                    if (idx === -1) continue;
                    const k = c.slice(0, idx).trim();
                    const v = decodeURIComponent(c.slice(idx + 1).trim());
                    if (k === 'futgg_jwt') {
                        const ref = GM_getValue('futgg_refresh_token', null);
                        if (saveFoundToken(v, "document.cookie (futgg_jwt)", ref)) {
                            return;
                        }
                    }
                }

                // 4. Intentar con GM_cookie para la URL completa de FUT.GG
                if (typeof GM_cookie !== 'undefined' && GM_cookie.list) {
                    GM_cookie.list({ url: 'https://www.fut.gg/' }, (cookieList, err) => {
                        if (!err && cookieList && cookieList.length > 0) {
                            for (const c of cookieList) {
                                if (c.name === 'futgg_jwt') {
                                    const ref = GM_getValue('futgg_refresh_token', null);
                                    if (saveFoundToken(c.value, "GM_cookie", ref)) {
                                        return;
                                    }
                                }
                            }
                        }
                    });
                }

                // 5. Ping de reactivación SOLO si no disponemos de un token fresco
                if (!isTokenFresh) {
                    try {
                        fetch('https://www.fut.gg/api/gg-club/sync-status/', { credentials: 'include' });
                    } catch (e) { }
                }

            } catch (e) {
                console.warn("[FUT.GG Gems Helper] Error capturando token en fut.gg:", e);
            }
        }

        // Auto-clic inteligente en botón "Sync Club" si hay una sincronización pendiente por packs o pasaron 30 min
        function checkAndClickFutGgSyncButton() {
            try {
                const isPending = GM_getValue('futgg_pending_sync_after_packs', false);
                const lastSync = Number(GM_getValue('futgg_last_club_sync_timestamp', 0));
                const elapsed = Date.now() - lastSync;
                const cooldown = 30 * 60 * 1000;

                // Solo actuar si hay sync pendiente o pasaron más de 30 min desde la última sincronización
                if (!isPending && (elapsed < cooldown && lastSync !== 0)) return;

                const buttons = Array.from(document.querySelectorAll('button'));
                const syncBtn = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === 'sync club' && !b.disabled);
                if (syncBtn) {
                    console.log("%c[FUT.GG Gems Helper] ☁️ Presionando 'Sync Club' automáticamente en la web de FUT.GG...", "color:#00ff88; font-weight:bold;");
                    syncBtn.click();
                    GM_setValue('futgg_last_club_sync_timestamp', Date.now());
                    GM_setValue('futgg_pending_sync_after_packs', false);
                    showFutGgToast("☁️ ¡Club sincronizado con EA automáticamente!");
                }
            } catch (e) { }
        }

        window.addEventListener('load', () => setTimeout(captureFutGgToken, 1000));
        setTimeout(captureFutGgToken, 1500);
        setInterval(captureFutGgToken, 60000); // Chequeo suave cada 60s
        setInterval(checkAndClickFutGgSyncButton, 10000); // Auto-detección de Sync Club en fut.gg cada 10s
        return; // No ejecutar la UI de la Web App en la web de fut.gg
    }

    console.log("%c[FUT.GG Gems Helper FC 27] Cargando en EA Web App...", "color: #00ff88; font-weight: bold; font-size: 14px;");

    // =========================================================================
    // CONFIGURACIÓN Y CONSTANTES
    // =========================================================================
    const CONFIG = {
        minMarketDelay: 2800,        // ms mínimo entre búsquedas en mercado (Anti-Ban)
        maxMarketDelay: 4200,        // ms máximo entre búsquedas en mercado
        moveDelay: 1200,             // ms entre mover cartas a transferibles
        listDelay: 3500,             // ms entre listados en el mercado
        pageDelayMin: 1400,          // ms mínimo entre páginas de mercado (humano)
        pageDelayMax: 2300,          // ms máximo entre páginas de mercado
        maxMarketPages: 2,           // Máximo de páginas por carta (optimizado para corte temprano anti-softban)
        earlyStopCount: 3,           // Cantidad de cartas al precio mínimo requeridas para corte temprano
        undercutAmount: 100,         // Descuento respecto al Lowest BIN (100 monedas para venta rápida)
        burstLimit: 10,              // Pausa de seguridad cada N búsquedas
        burstPauseMs: 6000,          // Pausa de 6s cada 10 búsquedas para evitar softban
        autoSyncIntervalMs: 15 * 60 * 1000, // 15 minutos (comprobación frecuente y segura de gemas)
        clubSyncCooldownMs: 30 * 60 * 1000, // 30 minutos (límite oficial de refresco de club en FUT.gg)
        get futggToken() {
            const gm = GM_getValue('futgg_jwt', '');
            if (gm && typeof gm === 'string' && gm.startsWith('ey')) return gm;
            try {
                const local = localStorage.getItem('futgg_jwt');
                if (local && typeof local === 'string' && local.startsWith('ey')) return local;
            } catch (e) { }
            return '';
        },
        set futggToken(val) {
            if (val) {
                GM_setValue('futgg_jwt', val);
                try { localStorage.setItem('futgg_jwt', val); } catch (e) { }
            }
        }
    };

    // Incrementos oficiales de FC Ultimate Team
    function getBidStep(price) {
        if (price < 1000) return 50;
        if (price < 10000) return 100;
        if (price < 50000) return 250;
        if (price < 100000) return 500;
        return 1000;
    }

    function roundToValidBid(price, direction = 'down') {
        if (!price || price < 200) return 200;
        const step = getBidStep(price);
        if (direction === 'down') {
            return Math.floor(price / step) * step;
        } else {
            return Math.ceil(price / step) * step;
        }
    }

    function calculateStartBid(buyNow) {
        if (!buyNow || buyNow <= 200) return 200;
        const validBuyNow = roundToValidBid(buyNow, 'down');
        const step = getBidStep(validBuyNow);
        return Math.max(200, validBuyNow - step);
    }

    function randomDelay(min, max) {
        const jitter = Math.random() * (max - min);
        return new Promise(resolve => setTimeout(resolve, min + jitter));
    }

    function formatCoins(num) {
        if (!num && num !== 0) return '---';
        return Number(num).toLocaleString('es-ES') + ' 🪙';
    }

    // =========================================================================
    // ACCESO A SERVICIOS INTERNOS Y DTOs DE LA WEB APP
    // =========================================================================
    function getAppWindow() {
        return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    }

    function createSearchCriteria(defId = null) {
        const win = getAppWindow();
        let criteria = null;

        // 1. Intentar usar UTBucketedItemSearchViewModel si está disponible (como en Paletools y FSU)
        if (typeof win.UTBucketedItemSearchViewModel !== 'undefined') {
            try {
                const vm = new win.UTBucketedItemSearchViewModel();
                if (typeof win.ItemSearchFeature !== 'undefined') {
                    vm.searchFeature = win.ItemSearchFeature.MARKET;
                }
                criteria = vm.searchCriteria;
            } catch (e) {
                criteria = null;
            }
        }

        // 2. Fallbacks estándar de EA Web App
        if (!criteria) {
            if (typeof win.UTSearchCriteriaDTO === 'function') {
                criteria = new win.UTSearchCriteriaDTO();
            } else if (win.transferobjects && typeof win.transferobjects.SearchCriteria === 'function') {
                criteria = new win.transferobjects.SearchCriteria();
            } else {
                criteria = {};
            }
        }

        criteria.count = 21;
        if (typeof win.SearchType !== 'undefined' && win.SearchType.PLAYER) {
            criteria.type = win.SearchType.PLAYER;
        } else {
            criteria.type = 'player';
        }
        if (typeof win.SearchCategory !== 'undefined' && win.SearchCategory.ANY) {
            criteria.category = win.SearchCategory.ANY;
        }

        if (defId) {
            const numId = Number(defId);
            criteria.defId = [numId];
            criteria.maskedDefId = numId;
        }

        return criteria;
    }

    function extractItemsFromEaResponse(res) {
        if (!res) return [];
        if (Array.isArray(res)) return res;
        if (res.response && Array.isArray(res.response.items)) return res.response.items;
        if (res.data && Array.isArray(res.data.items)) return res.data.items;
        if (res.items && Array.isArray(res.items)) return res.items;
        if (res.itemData && Array.isArray(res.itemData)) return res.itemData;
        if (res.response && Array.isArray(res.response.itemData)) return res.response.itemData;
        if (res.data && Array.isArray(res.data.itemData)) return res.data.itemData;
        return [];
    }

    function callEAService(serviceCall) {
        return new Promise((resolve, reject) => {
            try {
                if (!serviceCall) return reject(new Error("Llamada al servicio es nula"));

                if (typeof serviceCall.observe === 'function') {
                    const observerObj = {
                        onComplete: function (obs, response) {
                            try {
                                if (obs && typeof obs.unobserve === 'function') {
                                    obs.unobserve(this);
                                }
                            } catch (e) { }

                            if (response && response.success === false) {
                                reject(response.error || response.status || new Error("Error en servicio de EA"));
                            } else {
                                resolve(response);
                            }
                        }
                    };
                    serviceCall.observe(observerObj, observerObj.onComplete);
                } else if (typeof serviceCall.then === 'function') {
                    serviceCall.then(resolve).catch(reject);
                } else {
                    resolve(serviceCall);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // =========================================================================
    // API CLIENT DE FUT.GG
    // =========================================================================
    const FutGgClient = {
        fetchHiddenGems: async function () {
            let token = CONFIG.futggToken;

            // 1. Si está disponible GM_cookie, verificar si hay un token fresco en www.fut.gg
            if (typeof GM_cookie !== 'undefined' && GM_cookie.list) {
                try {
                    const freshCookie = await new Promise(res => {
                        GM_cookie.list({ url: 'https://www.fut.gg/' }, (cookies, err) => {
                            if (!err && cookies && cookies.length > 0) {
                                for (const c of cookies) {
                                    if (c.name === 'futgg_jwt' && isRealFutGgJwt(c.value, false)) {
                                        return res(c.value);
                                    }
                                }
                            }
                            res(null);
                        });
                    });
                    if (freshCookie) {
                        token = freshCookie;
                        CONFIG.futggToken = token;
                    }
                } catch (e) {
                    console.warn("[FUT.GG Helper] GM_cookie no disponible:", e);
                }
            }

            // 2. Si el token actual está expirado o por expirar en < 60s, renovar automáticamente en segundo plano
            const expInfo = getTokenExpiryInfo(token);
            if (expInfo.expired || (expInfo.remainingSec && expInfo.remainingSec < 60)) {
                const storedRefresh = GM_getValue('futgg_refresh_token', '');
                if (storedRefresh) {
                    try {
                        console.log("[FUT.GG Helper] Token expirado o próximo a expirar. Autorefrescando con Supabase...");
                        const refRes = await refreshSupabaseToken(storedRefresh);
                        if (refRes && refRes.access_token) {
                            token = refRes.access_token;
                            CONFIG.futggToken = token;
                            console.log("[FUT.GG Helper] Token renovado con éxito.");
                        }
                    } catch (e) {
                        console.warn("[FUT.GG Helper] Error en autorefresco con Supabase:", e);
                    }
                }
            }

            return new Promise((resolve, reject) => {
                const headers = {
                    'Accept': 'application/json'
                };
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://www.fut.gg/api/gg-club/hidden-gems/?game=27',
                    headers: headers,
                    withCredentials: true,
                    onload: async function (response) {
                        try {
                            if (response.status === 200) {
                                const json = JSON.parse(response.responseText);
                                resolve(json.data || {});
                            } else if (response.status === 401 || response.status === 403 || response.status === 404) {
                                // Si falló por autenticación, intentar un rescate con refresh_token
                                const storedRefresh = GM_getValue('futgg_refresh_token', '');
                                if (storedRefresh) {
                                    try {
                                        const refRes = await refreshSupabaseToken(storedRefresh);
                                        if (refRes && refRes.access_token) {
                                            CONFIG.futggToken = refRes.access_token;
                                            // Reintentar la llamada con el nuevo token
                                            const retryRes = await new Promise((resOk, resErr) => {
                                                GM_xmlhttpRequest({
                                                    method: 'GET',
                                                    url: 'https://www.fut.gg/api/gg-club/hidden-gems/?game=27',
                                                    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${refRes.access_token}` },
                                                    withCredentials: true,
                                                    onload: (r2) => {
                                                        if (r2.status === 200) resOk(JSON.parse(r2.responseText).data || {});
                                                        else resErr(new Error(`HTTP ${r2.status}`));
                                                    },
                                                    onerror: resErr
                                                });
                                            });
                                            return resolve(retryRes);
                                        }
                                    } catch (e) { }
                                }
                                reject(new Error(`Tu sesión de FUT.GG ha expirado (HTTP ${response.status}). Abre www.fut.gg en otra pestaña para renovarla automáticamente o haz clic en ⚙️ Token.`));
                            } else {
                                reject(new Error(`Error HTTP ${response.status} de FUT.GG: ${response.statusText || response.responseText}`));
                            }
                        } catch (e) {
                            reject(new Error("Error al procesar JSON de FUT.GG: " + e.message));
                        }
                    },
                    onerror: function (err) {
                        reject(new Error("Error de conexión con FUT.GG. Revisa tu conexión o abre fut.gg en otra pestaña."));
                    }
                });
            });
        },

        getSyncStatus: async function () {
            let token = CONFIG.futggToken;
            return new Promise((resolve) => {
                const headers = { 'Accept': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://www.fut.gg/api/gg-club/sync-status/',
                    headers: headers,
                    withCredentials: true,
                    onload: function (res) {
                        try {
                            if (res.status === 200) {
                                const json = JSON.parse(res.responseText);
                                resolve(json.data || json);
                            } else {
                                resolve(null);
                            }
                        } catch (e) {
                            resolve(null);
                        }
                    },
                    onerror: () => resolve(null)
                });
            });
        },

        triggerClubSync: async function () {
            let token = CONFIG.futggToken;
            if (!token) {
                return { success: false, error: "Token de FUT.GG no configurado." };
            }

            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://www.fut.gg/api/gg-club/sync/',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    data: JSON.stringify({}),
                    withCredentials: true,
                    onload: function (res) {
                        try {
                            const json = JSON.parse(res.responseText || '{}');
                            if (res.status >= 200 && res.status < 300) {
                                if (json.data && json.data.status === 'queue_full') {
                                    const waitSec = json.data.estimatedWaitSeconds || 60;
                                    resolve({ success: false, queueFull: true, waitMinutes: Math.max(1, Math.round(waitSec / 60)) });
                                } else {
                                    resolve({ success: true, data: json.data || json });
                                }
                            } else {
                                const msg = (json && (json.detail || json.message || json.error)) || `HTTP ${res.status}`;
                                resolve({ success: false, error: msg, status: res.status });
                            }
                        } catch (e) {
                            if (res.status >= 200 && res.status < 300) {
                                resolve({ success: true });
                            } else {
                                resolve({ success: false, error: `HTTP ${res.status}` });
                            }
                        }
                    },
                    onerror: function (err) {
                        resolve({ success: false, error: err.message || "Error de red al conectar con FUT.GG" });
                    }
                });
            });
        }
    };

    // =========================================================================
    // ESTADO DE LA APLICACIÓN
    // =========================================================================
    const State = {
        isOpen: false,
        lastScanTimestamp: 0,
        gems: [],              // Lista de cartas de FUT.GG
        clubMatches: {},       // eaId -> ItemData del club
        transferMatches: {},   // eaId -> ItemData de la lista de transferibles (sin listar)
        sellingMatches: {},    // eaId -> { item, auction, expires, expiresAt, buyNow } (vendiéndose activas)
        soldMatches: {},       // eaId -> ItemData (ya vendidas)
        hideSoldOrMissing: true, // Ocultar cartas ya vendidas o no presentes
        marketPrices: {},      // eaId -> { lowestBin, realisticBin, hasOutlier, outlierReason, count, tiers, rawItems, filterLabel, filterType, hasMore, isExtinct, crawling, updatedAt }
        openPriceBreakdowns: {}, // eaId -> boolean (si el desglose está desplegado)
        abortMarketCrawl: {},  // eaId -> boolean (para detener el escaneo continuo de páginas)
        customPrices: {},      // eaId -> precio de venta elegido por el usuario
        focusedGemId: null,    // eaId de la carta actualmente bajo interacción (para mantener el foco tras reordenar)
        isBatchRunning: false,
        batchStatusText: '',
        searchCountSession: 0,
        lastSyncTimestamp: 0,
        nextSyncTimestamp: 0,
        newGemIds: new Set(),
        autoSyncTimer: null,
        syncCountdownInterval: null
    };

    // =========================================================================
    // BÚSQUEDA Y MANIPULACIÓN DE CARTAS
    // =========================================================================
    function isItemTradeable(it) {
        if (!it) return false;
        if (it.untradeable === true || it.untradeable === 1) return false;
        if (it._untradeable === true || it._untradeable === 1) return false;
        if (typeof it.isUntradeable === 'function' && it.isUntradeable()) return false;
        return true;
    }

    function formatTimeRemaining(seconds) {
        if (!seconds || seconds <= 0) return '0 min';
        if (seconds >= 3600) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            return `${h}h ${m}m`;
        }
        const m = Math.floor(seconds / 60);
        return `${m} min`;
    }

    function matchesCard(it, eaId, name) {
        if (!it) return false;
        const numEaId = Number(eaId || 0);
        const resId = Number(it.resourceId || 0);
        const defId = Number(it.definitionId || 0);
        const maskedId = typeof it.getMaskedResourceId === 'function' ? Number(it.getMaskedResourceId()) : 0;
        const staticId = it._staticData ? Number(it._staticData.id || it._staticData.defId || it._staticData.assetId || 0) : 0;
        const assetId = Number(it.assetId || 0);
        const conceptId = Number(it.conceptId || 0);

        // 1. Coincidencia directa por ID si se dispone de eaId
        if (numEaId > 0) {
            if (resId === numEaId || defId === numEaId || maskedId === numEaId || staticId === numEaId || assetId === numEaId || conceptId === numEaId) {
                return true;
            }
            // Si el objeto tiene un ID propio claro y es diferente al buscado, descartar inmediatamente (previene cartas ajenas del caché)
            const primaryId = defId || resId || maskedId || staticId;
            if (primaryId > 0 && primaryId !== numEaId) {
                return false;
            }
        }

        // 2. Coincidencia por nombre (solo como fallback si no hay IDs discordantes)
        if (name && it._staticData) {
            const names = [
                it._staticData.name,
                it._staticData.lastName,
                it._staticData.firstName,
                it._staticData.commonName
            ].filter(Boolean).map(n => n.toLowerCase().trim());
            const target = name.toLowerCase().trim();
            if (names.some(n => n === target || n.includes(target) || target.includes(n))) {
                return true;
            }
        }
        return false;
    }

    async function findCardInAccount(gem) {
        const win = getAppWindow();
        const eaId = Number(gem.eaId);
        const name = gem.name || '';

        console.log(`%c[FUT.GG Helper] 🔎 Verificando a ${name} (eaId: ${eaId}) en tu cuenta...`, "color:#00ff88; font-weight:bold;");

        // 1. Si ya se detectó en transferibles o en venta activa
        if (State.sellingMatches[eaId]) return State.sellingMatches[eaId].item;
        if (State.transferMatches[eaId]) return State.transferMatches[eaId];
        if (State.soldMatches[eaId]) return null; // Ya vendido, no buscar en el club

        // 2. Búsqueda directa en Club vía services.Club.search (consulta en vivo al servidor de EA, inmune a RAM obsoleta)
        try {
            if (win.services && win.services.Club && typeof win.services.Club.search === 'function') {
                const criteria = createSearchCriteria(eaId);
                criteria.count = 20;
                criteria.offset = 0;
                criteria.type = 'player';
                criteria.maskedDefId = eaId;
                criteria.defId = [eaId];

                const res = await callEAService(win.services.Club.search(criteria));
                const items = extractItemsFromEaResponse(res);
                const matches = items.filter(it => matchesCard(it, eaId, name));

                if (matches.length > 0) {
                    const tradeable = matches.find(it => isItemTradeable(it));
                    const selected = tradeable || matches[0];
                    selected._isTradeable = isItemTradeable(selected);
                    State.clubMatches[eaId] = selected;
                    console.log(`[FUT.GG Helper] 🟢 Encontrado en Club (${selected._isTradeable ? 'Tradeable' : 'Intransferible'}):`, selected);
                    return selected;
                }
            }
        } catch (e) {
            console.warn(`[FUT.GG Helper] Fallo en services.Club.search específico:`, e);
        }

        // 3. Depósito de Almacenamiento (Storage de Duplicados en FC 25/27)
        try {
            if (win.services && win.services.Item && typeof win.services.Item.searchStorageItems === 'function') {
                const storageCrit = createSearchCriteria();
                storageCrit.count = 30;
                storageCrit.offset = 0;
                const res = await callEAService(win.services.Item.searchStorageItems(storageCrit));
                const items = extractItemsFromEaResponse(res);
                for (const it of items) {
                    if (matchesCard(it, eaId, name)) {
                        it._isTradeable = isItemTradeable(it);
                        State.clubMatches[eaId] = it;
                        console.log(`[FUT.GG Helper] 🟢 Encontrado en Almacenamiento/Storage:`, it);
                        return it;
                    }
                }
            }
        } catch (e) { }

        // 4. Búsqueda por lotes generales en Club si la búsqueda específica falló
        try {
            if (win.services && win.services.Club && typeof win.services.Club.search === 'function') {
                let offset = 0;
                const batchSize = 40;
                for (let p = 0; p < 2; p++) {
                    const broadCriteria = createSearchCriteria();
                    broadCriteria.count = batchSize;
                    broadCriteria.offset = offset;
                    broadCriteria.type = 'player';
                    if (gem.rating && gem.rating > 0) {
                        if (gem.rating < 65) broadCriteria.level = 'bronze';
                        else if (gem.rating < 75) broadCriteria.level = 'silver';
                        else broadCriteria.level = 'gold';
                    }

                    const res = await callEAService(win.services.Club.search(broadCriteria));
                    const items = extractItemsFromEaResponse(res);
                    if (!items || items.length === 0) break;

                    for (const it of items) {
                        if (matchesCard(it, eaId, name)) {
                            it._isTradeable = isItemTradeable(it);
                            State.clubMatches[eaId] = it;
                            return it;
                        }
                    }

                    if (items.length < batchSize) break;
                    offset += batchSize;
                }
            }
        } catch (e) { }

        // No se encontró en transferibles, venta activa ni club
        delete State.clubMatches[eaId];
        return null;
    }

    async function searchSingleCardInClub(gem) {
        notificar(`🔍 Buscando a ${gem.name} en tu club...`, "#00ccff");
        const item = await findCardInAccount(gem);
        if (item) {
            notificar(`🟢 ¡Encontrado ${gem.name} en tu cuenta!`, "#00ff88");
        } else {
            notificar(`⚪ ${gem.name} no se encontró en el club ni en transferibles`, "#ffaa00");
        }
        renderGemsTable();
    }

    async function scanClubForGems(isSilent = false) {
        const win = getAppWindow();
        if (!win.services || !win.services.Club) {
            const ready = await waitForEAServices(15000);
            if (!ready) {
                if (!isSilent) notificar("Abre la pestaña Club en la Web App una vez para inicializar servicios", "#ffaa00");
                return;
            }
        }

        if (!isSilent) notificar("🔍 Sincronizando estado de tu Club y Transferibles...", "#00ccff");
        State.clubMatches = {};
        State.transferMatches = {};
        State.sellingMatches = {};
        State.soldMatches = {};
        State.lastScanTimestamp = Date.now();

        // 1. Obtener la lista completa y fresca de transferibles directamente del servidor de EA
        let transferItems = [];
        try {
            if (win.services && win.services.Item && typeof win.services.Item.requestTransferItems === 'function') {
                const res = await callEAService(win.services.Item.requestTransferItems());
                transferItems = extractItemsFromEaResponse(res);
            } else if (win.repositories && win.repositories.Item && typeof win.repositories.Item.getTransferList === 'function') {
                const tl = win.repositories.Item.getTransferList();
                transferItems = tl && tl.items ? tl.items : (Array.isArray(tl) ? tl : []);
            }
        } catch (e) {
            console.warn("[FUT.GG Helper] Error al solicitar transferibles a EA:", e);
        }

        // Clasificar los ítems de transferibles
        for (const it of transferItems) {
            const auction = (typeof it.getAuctionData === 'function' ? it.getAuctionData() : null) || it._auction;
            const tradeState = (auction && (auction.tradeState || auction._tradeState)) || '';
            const isValidAuction = auction && (typeof auction.isValid === 'function' ? auction.isValid() : (auction.tradeId > 0));

            for (const gem of State.gems) {
                const eaId = Number(gem.eaId);
                if (matchesCard(it, eaId, gem.name)) {
                    if (tradeState === 'closed' || tradeState === 'sold') {
                        State.soldMatches[eaId] = it;
                    } else if (tradeState === 'active' || (isValidAuction && (auction.expires > 0 || auction._expires > 0))) {
                        const expiresSec = auction.expires || auction._expires || 0;
                        const buyNow = auction.buyNowPrice || auction._buyNowPrice || 0;
                        State.sellingMatches[eaId] = {
                            item: it,
                            auction: auction,
                            expires: expiresSec,
                            expiresAt: Date.now() + (expiresSec * 1000),
                            buyNow: buyNow
                        };
                    } else {
                        State.transferMatches[eaId] = it;
                    }
                }
            }
        }

        // 2. Para las gemas restantes, buscarlas en el Club en vivo
        for (const gem of State.gems) {
            const eaId = Number(gem.eaId);
            if (State.sellingMatches[eaId] || State.soldMatches[eaId] || State.transferMatches[eaId]) {
                continue;
            }
            await findCardInAccount(gem);
        }

        renderGemsTable();
        updateBadge();
        updateNewGemNoticeIfInClub();
        if (!isSilent) notificar("✅ Sincronización de Club y Mercado completada", "#00ff88");
    }

    async function openMarketSearchInWebApp(gem) {
        const win = getAppWindow();
        const eaId = Number(gem.eaId);

        // 1. Si tenemos la carta en el club o transferibles, usar comparePrice de EA si está disponible
        const item = State.transferMatches[eaId] || State.clubMatches[eaId];
        if (item && win.UTItemActionUtility && typeof win.UTItemActionUtility.comparePrice === 'function') {
            notificar(`Abriendo comparación de mercado para ${gem.name}...`, "#00ccff");
            try {
                win.UTItemActionUtility.comparePrice(item);
                return;
            } catch (e) {
                console.warn("Fallo comparePrice directo:", e);
            }
        }

        // 2. Si gNavManager y UTSearchResultsViewController están disponibles
        try {
            if (win.gNavManager) {
                const criteria = createSearchCriteria(eaId);
                criteria.maskedDefId = eaId;
                criteria.defId = [eaId];
                criteria.type = 'player';
                if (typeof win.UTSearchResultsViewController === 'function') {
                    const searchVC = new win.UTSearchResultsViewController();
                    searchVC.initWithRoot(criteria);
                    win.gNavManager.pushView(searchVC);
                    notificar(`Abriendo pantalla de búsqueda para ${gem.name}...`, "#00ff88");
                    return;
                }
            }
        } catch (e) {
            console.warn("No se pudo navegar directamente vía controller:", e);
        }

        notificar(`💡 Para ver todas las páginas en EA, busca a ${gem.name} en el Mercado de Transferencias`, "#ffaa00");
    }

    // =========================================================================
    // ANÁLISIS DE MERCADO: PISO REAL, OUTLIERS Y DETECCIÓN ANTI-SNIPE
    // =========================================================================
    function analyzeMarketTiers(allItems) {
        if (!allItems || allItems.length === 0) {
            return { tiers: [], lowestBin: null, realisticBin: null, hasOutlier: false, outlierReason: '' };
        }

        const priceMap = {};
        for (const item of allItems) {
            const buyNow = (item._auction && item._auction.buyNowPrice) || item.buyNowPrice || 0;
            if (buyNow > 0) {
                priceMap[buyNow] = (priceMap[buyNow] || 0) + 1;
            }
        }

        const tiers = Object.keys(priceMap)
            .map(p => ({ price: Number(p), count: priceMap[p] }))
            .sort((a, b) => a.price - b.price);

        if (tiers.length === 0) {
            return { tiers: [], lowestBin: null, realisticBin: null, hasOutlier: false, outlierReason: '' };
        }

        const lowestBin = tiers[0].price;
        let realisticBin = lowestBin;
        let hasOutlier = false;
        let outlierReason = '';

        if (tiers.length > 1) {
            const first = tiers[0];
            const second = tiers[1];
            const stepDiff = second.price - first.price;
            const ratio = second.price / Math.max(1, first.price);

            // Verificar si las cartas del precio mínimo fueron listadas hace segundos (snipe reciente)
            const firstItems = allItems.filter(it => {
                const p = (it._auction && it._auction.buyNowPrice) || it.buyNowPrice || 0;
                return p === first.price;
            });
            const isFreshListing = firstItems.length <= 2 && firstItems.some(it => {
                const exp = (it._auction && it._auction.expires) || it.expires || 0;
                return exp >= 3450; // Expira en > 57.5 min (listado hace menos de 2.5 min por 1h)
            });

            const minStep = getBidStep(first.price);

            // Regla de detección de Snipe / Outlier:
            // 1. Si son 1 o 2 cartas y el siguiente precio sube >= 25% o >= 300 monedas
            // 2. O si es un listado fresco (<2.5m) con una brecha de al menos 2 bid steps
            if (first.count <= 2 && (ratio >= 1.25 || stepDiff >= 300 || (isFreshListing && stepDiff >= minStep * 2))) {
                first.isOutlier = true;
                hasOutlier = true;
                realisticBin = second.price;
                const freshNotice = isFreshListing ? ' recién listada' : '';
                outlierReason = `⚠️ Posible ganga/snipe: ${first.count} carta(s)${freshNotice} a ${formatCoins(first.price)}. El piso real inicia en ${formatCoins(second.price)}.`;
            }
        }

        return { tiers, lowestBin, realisticBin, hasOutlier, outlierReason };
    }

    async function checkMarketPrice(gem, isAutomated = false, forceOpen = false) {
        const win = getAppWindow();
        const services = win.services;

        if (!services || !services.Item) {
            notificar("Servicios de mercado no listos. Abre la pestaña Mercado en la Web App una vez.", "#ffaa00");
            return;
        }

        const eaId = Number(gem.eaId);
        State.focusedGemId = eaId; // Mantener foco visual en esta carta tras reordenar
        State.abortMarketCrawl[eaId] = false;
        State.marketPrices[eaId] = {
            loading: true,
            crawling: true,
            filterLabel: forceOpen ? 'Abierto (sin tope)' : 'Iniciando...',
            filterType: forceOpen ? 'open' : 'tight',
            count: 0
        };
        State.openPriceBreakdowns[eaId] = true;
        renderGemsTable();
        notificar(`🔍 Consultando mercado de ${gem.name}...`, "#00ccff");

        // Limpiar caché antes de la primera búsqueda
        if (services.Item && typeof services.Item.clearTransferMarketCache === 'function') {
            try { services.Item.clearTransferMarketCache(); } catch (e) { }
        }

        const estPrice = Number(gem.estimatedPrice || 0);

        // Estrategia de búsqueda progresiva inteligente:
        // Etapa 1: Filtro inicial acotado (+15% / 2 bid steps sobre estPrice de FUT.GG)
        // Etapa 2: Si devuelve muestra insuficiente (< 3 cartas), ampliamos +50%
        // Etapa 3: Si aún es insuficiente (< 3 cartas) o si forceOpen=true, búsqueda abierta sin tope
        let stage = (forceOpen || estPrice <= 0) ? 3 : 1;
        let allItems = [];
        let filterLabel = '';
        let filterType = 'open';

        try {
            while (stage <= 3) {
                if (State.abortMarketCrawl[eaId]) {
                    notificar(`⏹️ Verificación detenida por el usuario para ${gem.name}`, "#ffaa00");
                    break;
                }

                // Delay humano entre etapas o peticiones automatizadas
                if (stage > 1) {
                    await randomDelay(CONFIG.pageDelayMin || 1400, CONFIG.pageDelayMax || 2300);
                } else if (isAutomated) {
                    await randomDelay(CONFIG.minMarketDelay, CONFIG.maxMarketDelay);
                }

                // Pausa de seguridad anti-ban si superamos ráfagas
                State.searchCountSession++;
                if (State.searchCountSession % CONFIG.burstLimit === 0) {
                    notificar(`🛡️ Pausa de seguridad (${CONFIG.burstPauseMs / 1000}s) para evitar softbans...`, "#ffaa00");
                    await new Promise(r => setTimeout(r, CONFIG.burstPauseMs));
                }

                // Limpiar caché de mercado de EA en cada etapa para forzar datos limpios
                if (services.Item && typeof services.Item.clearTransferMarketCache === 'function') {
                    try { services.Item.clearTransferMarketCache(); } catch (e) { }
                }

                let targetMaxBuy = 0;
                if (stage === 1) {
                    const buffer = Math.max(getBidStep(estPrice) * 2, Math.round(estPrice * 0.15));
                    targetMaxBuy = roundToValidBid(estPrice + buffer, 'up');
                    if (targetMaxBuy < 200) targetMaxBuy = 200;
                    filterLabel = `≤ ${formatCoins(targetMaxBuy)} (+15%)`;
                    filterType = 'tight';
                } else if (stage === 2) {
                    // Ampliación del 50%
                    const firstFound = allItems[0];
                    const firstFoundPrice = firstFound ? ((firstFound._auction && firstFound._auction.buyNowPrice) || firstFound.buyNowPrice || 0) : 0;
                    const base = Math.max(estPrice, firstFoundPrice);
                    targetMaxBuy = roundToValidBid(Math.round(base * 1.5), 'up');
                    if (targetMaxBuy < 200) targetMaxBuy = 200;
                    filterLabel = `≤ ${formatCoins(targetMaxBuy)} (+50%)`;
                    filterType = 'widened';
                } else {
                    // Etapa 3: Búsqueda abierta sin límite de maxBuy
                    targetMaxBuy = 0;
                    filterLabel = `Abierto (sin tope)`;
                    filterType = 'open';
                }

                const criteria = createSearchCriteria(eaId);
                criteria.count = 21;
                criteria.type = (win.SearchType && win.SearchType.PLAYER) || 'player';
                criteria.defId = [eaId];
                criteria.maskedDefId = eaId;
                if (targetMaxBuy > 0) {
                    criteria.maxBuy = targetMaxBuy;
                }

                const res = await callEAService(services.Item.searchTransferMarket(criteria, 1));
                const pageItems = extractItemsFromEaResponse(res);
                const validItems = (pageItems || []).filter(it => matchesCard(it, eaId, gem.name));

                allItems = validItems;

                // Actualizar estado en vivo en la UI
                if (State.marketPrices[eaId]) {
                    State.marketPrices[eaId].filterLabel = filterLabel;
                    State.marketPrices[eaId].filterType = filterType;
                    State.marketPrices[eaId].count = allItems.length;
                    renderGemsTable();
                }

                // Criterio de suficiencia de muestra:
                // 1. Si estamos en búsqueda abierta (stage === 3), lo devuelto por EA es el mercado completo. Terminamos.
                if (stage === 3) {
                    break;
                }

                // 2. Si obtuvimos al menos 3 cartas (o earlyStopCount), tenemos muestra suficiente para piso y detección de snipes.
                const stopThreshold = CONFIG.earlyStopCount || 3;
                if (allItems.length >= stopThreshold) {
                    break;
                }

                // 3. Si obtuvimos menos de 3 cartas (0, 1 o 2 cartas), la muestra es insuficiente para descartar snipes:
                if (stage === 1) {
                    console.log(`[FUT.GG Helper] Muestra insuficiente (${allItems.length} cartas a ${filterLabel}) para ${gem.name}. Ampliando a +50%...`);
                    stage = 2;
                } else if (stage === 2) {
                    console.log(`[FUT.GG Helper] Muestra aún insuficiente (${allItems.length} cartas a ${filterLabel}) para ${gem.name}. Pasando a búsqueda abierta...`);
                    stage = 3;
                }
            }

            if (allItems.length === 0) {
                State.marketPrices[eaId] = {
                    lowestBin: null,
                    realisticBin: null,
                    count: 0,
                    isExtinct: true,
                    tiers: [],
                    rawItems: [],
                    filterLabel,
                    filterType,
                    hasMore: false,
                    crawling: false,
                    loading: false,
                    updatedAt: Date.now()
                };
                if (!State.customPrices[eaId]) {
                    State.customPrices[eaId] = gem.estimatedPrice || 10000;
                }
                notificar(`💎 ${gem.name}: ¡Extinta en mercado! (0 listados activos)`, "#ffaa00");
            } else {
                const analysis = analyzeMarketTiers(allItems);

                State.marketPrices[eaId] = {
                    lowestBin: analysis.lowestBin,
                    realisticBin: analysis.realisticBin,
                    hasOutlier: analysis.hasOutlier,
                    outlierReason: analysis.outlierReason,
                    count: allItems.length,
                    hasMore: allItems.length >= 21,
                    filterLabel,
                    filterType,
                    tiers: analysis.tiers,
                    rawItems: allItems,
                    isExtinct: false,
                    crawling: false,
                    loading: false,
                    updatedAt: Date.now()
                };

                // Calcular precio de venta sugerido protegiendo de gangas
                const basePrice = analysis.hasOutlier ? analysis.realisticBin : analysis.lowestBin;
                if (basePrice) {
                    const suggested = Math.max(200, basePrice - CONFIG.undercutAmount);
                    State.customPrices[eaId] = roundToValidBid(suggested, 'down');
                }

                if (analysis.hasOutlier) {
                    notificar(`⚠️ ${gem.name}: ¡Ganga a ${formatCoins(analysis.lowestBin)}! Piso real: ${formatCoins(analysis.realisticBin)} (${allItems.length} cartas, filtro: ${filterLabel})`, "#ffaa00");
                } else {
                    notificar(`📊 ${gem.name}: Min BIN ${formatCoins(analysis.lowestBin)} (${allItems.length} cartas, filtro: ${filterLabel})`, "#00ff88");
                }
            }
        } catch (err) {
            console.error("[FUT.GG Helper] Error al buscar en mercado:", err);
            State.marketPrices[eaId] = { error: true, errorMsg: err.message || String(err), crawling: false, loading: false };
            notificar(`Error consultando mercado para ${gem.name}: ${err.message || err}`, "#ff4444");

            if (err && (err.status === 429 || err.status === 521 || String(err).includes("captcha"))) {
                alert("⚠️ ALERTA DE SEGURIDAD EA: Límite de peticiones alcanzado o Captcha detectado. El helper se detuvo para proteger tu cuenta.");
                throw err;
            }
        } finally {
            renderGemsTable();
        }
    }

    // Interceptar y cerrar automáticamente modales de "Destination full / Lista llena"
    function dismissEaDialogIfPresent() {
        try {
            const win = getAppWindow();
            if (win.gNavManager) {
                if (typeof win.gNavManager.hasOpenDialog === 'function' && win.gNavManager.hasOpenDialog()) {
                    if (typeof win.gNavManager.popDialog === 'function') win.gNavManager.popDialog();
                }
                const dialogController = typeof win.gNavManager.getDialogController === 'function' ? win.gNavManager.getDialogController() : null;
                if (dialogController && typeof dialogController.close === 'function') {
                    dialogController.close();
                }
            }
            const dialogs = document.querySelectorAll('.ea-dialog-view, .ut-click-shield, .dialog-view, .Dialog, .view-modal-dialog');
            dialogs.forEach(d => {
                const text = (d.textContent || '').toLowerCase();
                if (text.includes('full') || text.includes('llena') || text.includes('destination') || text.includes('destino') || text.includes('no se ha podido')) {
                    const btn = d.querySelector('.btn-standard, button, .dialog-footer button, .close-btn');
                    if (btn) btn.click();
                    else d.remove();
                }
            });
        } catch (e) { }
    }

    async function moveToTransferList(gem, silent = false) {
        const win = getAppWindow();
        const services = win.services;
        const eaId = Number(gem.eaId);

        // 1. Si la carta ya se está vendiendo en el mercado
        if (State.sellingMatches[eaId]) {
            if (!silent) notificar(`⚠️ ${gem.name} ya está en venta activa en el mercado transferible.`, "#ffaa00");
            return false;
        }

        // 2. Si la carta ya fue vendida
        if (State.soldMatches[eaId]) {
            if (!silent) notificar(`ℹ️ ${gem.name} ya fue vendido.`, "#8fa0b5");
            return false;
        }

        // 3. Si ya está registrada en transferibles
        if (State.transferMatches[eaId]) {
            if (!silent) notificar(`📋 ${gem.name} ya está en la Lista de Transferibles`, "#00ccff");
            return true;
        }

        let item = State.clubMatches[eaId];
        if (!item) {
            item = await findCardInAccount(gem);
        }

        if (!item) {
            if (!silent) notificar(`❌ No se encontró a ${gem.name} en el club (puede que ya se haya vendido)`, "#ff4444");
            return false;
        }

        // 4. Si la carta es intransferible, NO intentar mover (EA devuelve error Destination Full)
        if (!isItemTradeable(item)) {
            if (!silent) notificar(`🔒 ${gem.name} es intransferible. No puede enviarse a la Lista de Transferibles.`, "#ffaa00");
            return false;
        }

        const pile = (win.enums && win.enums.FUTItemPile && win.enums.FUTItemPile.TRANSFER) || 2;

        // 5. Verificar si en el modelo de EA ya está en Transferibles
        const currentPile = item.pile || item._pile || (typeof item.getPile === 'function' ? item.getPile() : 0);
        if (currentPile === pile || (typeof item.isTransferList === 'function' && item.isTransferList())) {
            delete State.clubMatches[eaId];
            State.transferMatches[eaId] = item;
            renderGemsTable();
            if (!silent) notificar(`📋 ${gem.name} ya está en Transferibles`, "#00ccff");
            return true;
        }

        // 6. Verificar si la lista de transferibles está llena según el repositorio de EA
        try {
            const itemRepo = win.repositories && win.repositories.Item;
            if (itemRepo) {
                const isFull = (typeof itemRepo.isFull === 'function' && itemRepo.isFull(pile)) ||
                    (typeof itemRepo.isTransferListFull === 'function' && itemRepo.isTransferListFull());
                if (isFull) {
                    if (!silent) notificar(`⚠️ Tu lista de transferibles está llena. Lista o limpia cartas antes de mover más.`, "#ffaa00");
                    return false;
                }
            }
        } catch (e) { }

        // 7. Mover a transferibles
        try {
            if (services && services.Item && typeof services.Item.move === 'function') {
                await callEAService(services.Item.move([item], pile));
            } else if (win.communication && typeof win.communication.MoveItemDelegate === 'function') {
                await new Promise((res, rej) => {
                    const delegate = new win.communication.MoveItemDelegate([item], pile);
                    delegate.addListener(win.communication.BaseDelegate.SUCCESS, this, () => res());
                    delegate.addListener(win.communication.BaseDelegate.FAIL, this, (s, err) => rej(err));
                    delegate.send();
                });
            }

            try {
                if (win.repositories && win.repositories.Item && typeof win.repositories.Item.setDirty === 'function') {
                    win.repositories.Item.setDirty(pile);
                }
            } catch (e) { }

            dismissEaDialogIfPresent();
            item.pile = pile;
            delete State.clubMatches[eaId];
            State.transferMatches[eaId] = item;
            renderGemsTable();
            if (!silent) notificar(`📋 ${gem.name} movido a la Lista de Transferibles`, "#00ff88");
            return true;
        } catch (err) {
            console.error("Error al mover a transferibles:", err);
            dismissEaDialogIfPresent();
            setTimeout(dismissEaDialogIfPresent, 100);

            const errStr = String(err && (err.message || err.statusText || err) || '').toLowerCase();
            if (errStr.includes('destination full') || errStr.includes('full') || (err && err.status === 403)) {
                item.pile = pile;
                State.transferMatches[eaId] = item;
                delete State.clubMatches[eaId];
                renderGemsTable();
                if (!silent) notificar(`📋 ${gem.name} ya registrado en Transferibles`, "#00ccff");
                return true;
            }

            if (!silent) {
                notificar(`No se pudo mover ${gem.name}: ${err.message || err}`, "#ff4444");
            }
            return false;
        }
    }

    async function listCardOnMarket(gem) {
        const win = getAppWindow();
        const services = win.services;
        const eaId = Number(gem.eaId);

        // Si ya se está vendiendo
        if (State.sellingMatches[eaId]) {
            notificar(`⚠️ ${gem.name} ya está actualmente en el mercado de transferencias`, "#ffaa00");
            return;
        }

        let item = State.transferMatches[eaId] || State.clubMatches[eaId];
        if (!item) {
            notificar(`🔍 Buscando ${gem.name} en tu cuenta antes de listar...`, "#00ccff");
            item = await findCardInAccount(gem);
        }

        if (!item) {
            notificar(`❌ No se encontró la carta de ${gem.name} en tu cuenta`, "#ff4444");
            return;
        }

        if (!isItemTradeable(item)) {
            notificar(`🔒 ${gem.name} es intransferible y no puede listarse en el mercado`, "#ffaa00");
            return;
        }

        const buyNow = State.customPrices[eaId] || gem.estimatedPrice || 1000;
        const validBuyNow = roundToValidBid(buyNow, 'down');
        const startBid = calculateStartBid(validBuyNow);

        try {
            // En EA FC Web App, services.Item.list lista directamente desde Club o Transferibles sin necesidad de mover
            await callEAService(services.Item.list(item, startBid, validBuyNow, 3600));
            dismissEaDialogIfPresent();

            delete State.transferMatches[eaId];
            delete State.clubMatches[eaId];
            State.sellingMatches[eaId] = {
                item: item,
                auction: { expires: 3600, buyNowPrice: validBuyNow, startingBid: startBid },
                expires: 3600,
                expiresAt: Date.now() + 3600000,
                buyNow: validBuyNow
            };
            State.marketPrices[eaId] = { listed: true, price: validBuyNow };
            renderGemsTable();
            notificar(`🚀 ¡${gem.name} listado por ${formatCoins(validBuyNow)}! (Puja: ${formatCoins(startBid)})`, "#00ff88");
        } catch (err) {
            console.error("Error al listar:", err);
            dismissEaDialogIfPresent();
            notificar(`❌ Error al listar ${gem.name}: ${err.message || err}`, "#ff4444");
        }
    }

    // =========================================================================
    // ACCIONES EN LOTE (BATCH CON DELAYS SEGUROS)
    // =========================================================================
    async function batchMoveAllToTransfer() {
        if (State.isBatchRunning) return;
        State.isBatchRunning = true;
        renderBatchControls();

        const gemsToMove = State.gems.filter(g => {
            const eaId = Number(g.eaId);
            const inClub = State.clubMatches[eaId];
            return inClub && isItemTradeable(inClub) && !State.transferMatches[eaId] && !State.sellingMatches[eaId];
        });

        if (gemsToMove.length === 0) {
            notificar("No hay jugadores transferibles en tu club para mover.", "#ffaa00");
            State.isBatchRunning = false;
            renderBatchControls();
            return;
        }

        let count = 0;
        for (const gem of gemsToMove) {
            if (!State.isBatchRunning) break;
            count++;
            updateBatchStatus(`Moviendo ${count}/${gemsToMove.length}: ${gem.name}...`);
            await moveToTransferList(gem);
            await randomDelay(CONFIG.moveDelay, CONFIG.moveDelay + 500);
        }

        State.isBatchRunning = false;
        updateBatchStatus(`¡Listo! Se movieron ${count} jugadores a Transferibles.`);
        renderBatchControls();
    }

    async function batchCheckAllMarketPrices() {
        if (State.isBatchRunning) return;
        State.isBatchRunning = true;
        renderBatchControls();

        const gemsToCheck = State.gems.filter(g => {
            const eaId = Number(g.eaId);
            if (State.hideSoldOrMissing) {
                const inClub = State.clubMatches[eaId];
                const inTransfer = State.transferMatches[eaId];
                const selling = State.sellingMatches[eaId];
                const sold = State.soldMatches[eaId];
                if (sold || (!inClub && !inTransfer && !selling)) return false;
            }
            return true;
        });

        for (const gem of gemsToCheck) {
            delete State.marketPrices[gem.eaId];
        }
        renderGemsTable();

        let count = 0;
        for (const gem of gemsToCheck) {
            if (!State.isBatchRunning) break;
            count++;
            updateBatchStatus(`Comparando precio ${count}/${gemsToCheck.length}: ${gem.name}...`);
            try {
                await checkMarketPrice(gem, true);
            } catch (e) {
                console.error("Error en batch market check:", e);
                break;
            }
        }

        State.isBatchRunning = false;
        updateBatchStatus(`Comparación de mercado completada.`);
        renderBatchControls();
    }

    async function batchListAllReviewed() {
        if (State.isBatchRunning) return;
        State.isBatchRunning = true;
        renderBatchControls();

        const gemsToList = State.gems.filter(g => {
            const eaId = Number(g.eaId);
            if (State.sellingMatches[eaId] || State.soldMatches[eaId]) return false;
            const inTransfer = State.transferMatches[eaId];
            const inClub = State.clubMatches[eaId];
            if (inTransfer) return true;
            if (inClub && isItemTradeable(inClub)) return true;
            return false;
        });

        if (gemsToList.length === 0) {
            notificar("No hay jugadores disponibles en tu club o transferibles para listar.", "#ffaa00");
            State.isBatchRunning = false;
            renderBatchControls();
            return;
        }

        let count = 0;
        for (const gem of gemsToList) {
            if (!State.isBatchRunning) break;
            count++;
            const price = State.customPrices[gem.eaId] || gem.estimatedPrice;
            updateBatchStatus(`Listando ${count}/${gemsToList.length}: ${gem.name} por ${formatCoins(price)}...`);

            await listCardOnMarket(gem);
            await randomDelay(CONFIG.listDelay, CONFIG.listDelay + 1000);
        }

        State.isBatchRunning = false;
        updateBatchStatus(`¡Finalizado! Se listaron ${count} cartas.`);
        renderBatchControls();
    }

    function cancelBatch() {
        State.isBatchRunning = false;
        updateBatchStatus("Operación cancelada por el usuario.");
        renderBatchControls();
    }

    // =========================================================================
    // INTERFAZ DE USUARIO (UI / HUD MODERNO)
    // =========================================================================
    function injectUIStyles() {
        if (document.getElementById('futgg-helper-styles')) return;
        const style = document.createElement('style');
        style.id = 'futgg-helper-styles';
        style.innerHTML = `
            #futgg-floating-btn {
                position: fixed;
                top: 65px;
                right: 24px;
                z-index: 99999;
                background: linear-gradient(135deg, #101924, #1a2736);
                border: 2px solid #00ff88;
                color: #ffffff;
                padding: 8px 14px;
                border-radius: 30px;
                cursor: pointer;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                font-weight: bold;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 4px 20px rgba(0, 255, 136, 0.35);
                transition: transform 0.2s, box-shadow 0.2s;
                user-select: none;
            }
            #futgg-floating-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 25px rgba(0, 255, 136, 0.55);
                border-color: #33ff9f;
            }
            #futgg-floating-btn.has-new {
                animation: futggPulse 2s infinite;
            }
            @keyframes futggPulse {
                0% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.7); }
                70% { box-shadow: 0 0 0 10px rgba(0, 255, 136, 0); }
                100% { box-shadow: 0 0 0 0 rgba(0, 255, 136, 0); }
            }
            #futgg-floating-btn .badge {
                background: #00ff88;
                color: #0c1218;
                border-radius: 12px;
                padding: 2px 8px;
                font-size: 12px;
                font-weight: 800;
                min-width: 14px;
                text-align: center;
                line-height: 1.3;
            }

            /* Banner / Notificación de Gema Nueva abajo */
            #futgg-bottom-notice {
                position: fixed;
                bottom: 20px;
                right: 24px;
                z-index: 99998;
                background: linear-gradient(135deg, rgba(16, 25, 36, 0.98), rgba(26, 39, 54, 0.98));
                border: 1px solid #00ff88;
                border-radius: 12px;
                padding: 10px 14px;
                box-shadow: 0 8px 30px rgba(0, 255, 136, 0.3), 0 4px 12px rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                gap: 12px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: #ffffff;
                max-width: 380px;
                cursor: pointer;
                animation: futggSlideUpNotice 0.35s cubic-bezier(0.16, 1, 0.3, 1);
                transition: opacity 0.3s, transform 0.3s;
                backdrop-filter: blur(10px);
            }
            #futgg-bottom-notice:hover {
                transform: translateY(-2px);
                border-color: #33ff9f;
                box-shadow: 0 10px 35px rgba(0, 255, 136, 0.45);
            }
            @keyframes futggSlideUpNotice {
                from {
                    transform: translateY(30px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            #futgg-bottom-notice .notice-icon {
                font-size: 22px;
                line-height: 1;
                filter: drop-shadow(0 0 6px rgba(0, 255, 136, 0.6));
            }
            #futgg-bottom-notice .notice-title {
                font-size: 11px;
                font-weight: 800;
                color: #00ff88;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            #futgg-bottom-notice .notice-desc {
                font-size: 13px;
                font-weight: 600;
                color: #ffffff;
                margin-top: 2px;
            }
            #futgg-bottom-notice .notice-sub {
                font-size: 11px;
                color: #8fa0b5;
                margin-top: 2px;
            }
            #futgg-bottom-notice .notice-close {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 18px;
                line-height: 1;
                cursor: pointer;
                padding: 0 4px;
                margin-left: auto;
                transition: color 0.2s;
            }
            #futgg-bottom-notice .notice-close:hover {
                color: #ffffff;
            }
            .futgg-new-badge {
                background: rgba(0, 255, 136, 0.18);
                color: #00ff88;
                border: 1px solid #00ff88;
                border-radius: 4px;
                padding: 1px 5px;
                font-size: 10px;
                font-weight: 800;
                margin-left: 6px;
                vertical-align: middle;
            }

            #futgg-panel {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 1060px;
                max-width: 96vw;
                height: 720px;
                max-height: 90vh;
                background: rgba(15, 22, 32, 0.98);
                backdrop-filter: blur(14px);
                border: 1px solid #2a3b50;
                border-radius: 16px;
                z-index: 100000;
                display: flex;
                flex-direction: column;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: #e0e6ed;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(0, 255, 136, 0.2);
            }
            #futgg-panel.hidden { display: none; }

            .futgg-header {
                padding: 12px 18px;
                background: #131c28;
                border-bottom: 1px solid #243346;
                border-radius: 16px 16px 0 0;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .futgg-header h2 {
                margin: 0;
                font-size: 17px;
                font-weight: 700;
                color: #ffffff;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .futgg-close-btn {
                background: transparent;
                border: none;
                color: #8fa0b5;
                font-size: 20px;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 6px;
                transition: color 0.2s;
            }
            .futgg-close-btn:hover { color: #ff5555; background: rgba(255,85,85,0.1); }

            .futgg-toolbar {
                padding: 8px 14px;
                background: #111a26;
                border-bottom: 1px solid #1f2e42;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: nowrap;
            }
            .futgg-btn {
                background: #1f2c3d;
                border: 1px solid #35475e;
                color: #e0e6ed;
                padding: 7px 14px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
            }
            .futgg-btn:hover:not(:disabled) {
                background: #28394e;
                border-color: #00ff88;
                color: #ffffff;
            }
            .futgg-btn.primary {
                background: #00ff88;
                color: #0c1218;
                border-color: #00ff88;
                font-weight: 700;
            }
            .futgg-btn.primary:hover:not(:disabled) {
                background: #2aff9f;
                box-shadow: 0 0 12px rgba(0, 255, 136, 0.4);
            }
            .futgg-btn.danger {
                background: #ff4444;
                color: #fff;
                border-color: #ff4444;
            }
            .futgg-btn:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: auto !important; }
            .futgg-btn:disabled:hover { background: #1f2c3d !important; border-color: #35475e !important; }

            #futgg-token-panel {
                padding: 12px 20px;
                background: #131c28;
                border-bottom: 1px solid #243346;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .futgg-body {
                flex: 1;
                overflow-y: auto;
                padding: 16px 20px;
            }
            .futgg-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
            }
            .futgg-table th {
                text-align: left;
                padding: 10px 12px;
                background: #131c28;
                color: #8fa0b5;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border-bottom: 1px solid #243346;
                position: sticky;
                top: -16px;
                z-index: 10;
            }
            .futgg-table td {
                padding: 10px 12px;
                border-bottom: 1px solid #1a2535;
                vertical-align: middle;
            }
            .futgg-table tr:hover td {
                background: rgba(30, 44, 62, 0.5);
            }
            /* Cartas que se están vendiendo actualmente (abajo del todo) */
            .futgg-table tr.row-selling {
                background: rgba(14, 25, 40, 0.75) !important;
                border-left: 4px solid #00ccff !important;
                opacity: 0.88;
            }
            .futgg-table tr.row-selling:hover {
                opacity: 1;
            }
            .futgg-table tr.row-selling td {
                border-top: 1px solid rgba(0, 204, 255, 0.22) !important;
                border-bottom: 1px solid rgba(0, 204, 255, 0.22) !important;
            }
            .futgg-table tr.row-selling:hover td {
                background: rgba(0, 204, 255, 0.12) !important;
            }

            /* Separador de sección para cartas en venta */
            .futgg-section-divider-row td {
                padding: 12px 14px 6px 14px !important;
                background: #0b131e !important;
                border-top: 2px solid #1a2a3e !important;
                border-bottom: 1px solid #1a2a3e !important;
            }
            .futgg-section-divider {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 11px;
                font-weight: 800;
                color: #00ccff;
                letter-spacing: 0.6px;
                text-transform: uppercase;
            }
            .futgg-section-divider::after {
                content: '';
                flex: 1;
                height: 1px;
                background: rgba(0, 204, 255, 0.25);
            }

            .futgg-player-cell {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .futgg-rating {
                font-weight: bold;
                font-size: 13px;
                padding: 2px 6px;
                border-radius: 4px;
                background: #202d3e;
                color: #00ff88;
                min-width: 24px;
                text-align: center;
            }
            .futgg-tag {
                display: inline-block;
                padding: 3px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
            }
            .futgg-tag.club { background: rgba(0, 255, 136, 0.15); color: #00ff88; border: 1px solid #00ff88; }
            .futgg-tag.transfer { background: rgba(255, 170, 0, 0.15); color: #ffaa00; border: 1px solid #ffaa00; }
            .futgg-tag.selling { background: rgba(0, 204, 255, 0.15); color: #00ccff; border: 1px solid #00ccff; }
            .futgg-tag.none { background: rgba(143, 160, 181, 0.1); color: #8fa0b5; }
            .futgg-tag.extinct { background: rgba(255, 85, 85, 0.2); color: #ff5555; border: 1px solid #ff5555; }

            .futgg-price-input {
                width: 80px;
                background: #131c28;
                border: 1px solid #35475e;
                color: #fff;
                padding: 4px 6px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 600;
                text-align: right;
            }
            .futgg-price-input:focus { border-color: #00ff88; outline: none; }

            .futgg-footer {
                padding: 12px 20px;
                background: #131c28;
                border-top: 1px solid #243346;
                border-radius: 0 0 16px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 12px;
                color: #8fa0b5;
            }

            #futgg-toast {
                position: fixed;
                top: 24px;
                right: 24px;
                z-index: 100001;
                background: #1a2736;
                border-left: 4px solid #00ff88;
                color: #ffffff;
                padding: 12px 18px;
                border-radius: 8px;
                box-shadow: 0 6px 20px rgba(0,0,0,0.5);
                font-size: 13px;
                font-weight: 600;
                transition: opacity 0.3s;
                opacity: 0;
                pointer-events: none;
            }
            #futgg-toast.show { opacity: 1; }

            /* ESTILOS DEL DESGLOSE DE PRECIOS */
            .futgg-price-breakdown {
                margin-top: 8px;
                background: #0d1520;
                border: 1px solid #24354b;
                border-radius: 8px;
                padding: 8px 10px;
                font-size: 11px;
                box-shadow: 0 6px 20px rgba(0,0,0,0.6);
                min-width: 250px;
                max-width: 320px;
            }
            .futgg-breakdown-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                color: #8fa0b5;
                font-size: 10px;
                font-weight: 600;
                margin-bottom: 6px;
                border-bottom: 1px solid #1c2b3d;
                padding-bottom: 4px;
            }
            .futgg-outlier-box {
                background: rgba(255, 170, 0, 0.12);
                border: 1px solid rgba(255, 170, 0, 0.4);
                color: #ffcc00;
                padding: 5px 8px;
                border-radius: 5px;
                margin-bottom: 6px;
                font-size: 10px;
                line-height: 1.35;
            }
            .futgg-tiers-container {
                display: flex;
                flex-direction: column;
                gap: 4px;
                max-height: 160px;
                overflow-y: auto;
                padding-right: 2px;
            }
            .futgg-tier-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: #15202e;
                border: 1px solid #223348;
                border-radius: 5px;
                padding: 4px 8px;
                cursor: pointer;
                transition: all 0.15s ease;
            }
            .futgg-tier-row:hover {
                background: #1d2c3f;
                border-color: #00ff88;
                transform: translateX(2px);
            }
            .futgg-tier-row.selected {
                border-color: #00ff88;
                background: rgba(0, 255, 136, 0.12);
            }
            .futgg-tier-row.outlier {
                border-color: #ffaa00;
                background: rgba(255, 170, 0, 0.08);
            }
            .futgg-tier-badge {
                font-size: 9px;
                font-weight: 700;
                padding: 1px 5px;
                border-radius: 3px;
                background: rgba(255, 170, 0, 0.25);
                color: #ffaa00;
            }
            .futgg-tier-badge.safe {
                background: rgba(0, 255, 136, 0.25);
                color: #00ff88;
            }
            .futgg-table tr.futgg-row-focused td {
                background: rgba(0, 204, 255, 0.25) !important;
                border-top: 1px solid #00ccff !important;
                border-bottom: 1px solid #00ccff !important;
                transition: background 1.5s ease;
            }
        `;
        document.head.appendChild(style);
    }

    function notificar(msg, color = "#00ff88") {
        let toast = document.getElementById('futgg-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'futgg-toast';
            document.body.appendChild(toast);
        }
        toast.style.borderLeftColor = color;
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toast.hideTimeout);
        toast.hideTimeout = setTimeout(() => toast.classList.remove('show'), 3500);
    }

    // =========================================================================
    // UTILIDADES DE SERVICIOS Y CONTEO
    // =========================================================================
    function waitForEAServices(timeoutMs = 45000) {
        return new Promise(resolve => {
            const start = Date.now();
            const check = () => {
                const win = getAppWindow();
                if (win.services && (win.services.Club || win.services.Item)) {
                    return resolve(true);
                }
                if (Date.now() - start > timeoutMs) {
                    return resolve(false);
                }
                setTimeout(check, 1000);
            };
            check();
        });
    }

    // Calcula cuántas gemas están disponibles para vender (en transferibles o en club tradeables)
    function getAvailableToSellCount() {
        let count = 0;
        for (const gem of State.gems) {
            const eaId = Number(gem.eaId);
            const inClub = State.clubMatches[eaId];
            const inTransfer = State.transferMatches[eaId];
            const selling = State.sellingMatches[eaId];
            const sold = State.soldMatches[eaId];

            if (!sold && !selling) {
                if (inTransfer || (inClub && isItemTradeable(inClub))) {
                    count++;
                }
            }
        }
        return count;
    }

    function updateBadge(explicitCount = null) {
        const badge = document.getElementById('futgg-badge');
        if (!badge) return;
        const count = explicitCount !== null ? explicitCount : getAvailableToSellCount();
        badge.textContent = count;

        const btn = document.getElementById('futgg-floating-btn');
        if (btn) {
            btn.title = `💎 Joyas disponibles para vender: ${count} (Clic o Alt+G para abrir)`;
        }
    }

    function showBottomNewGemNotice(newGems) {
        if (!newGems || newGems.length === 0) return;

        const existing = document.getElementById('futgg-bottom-notice');
        if (existing) existing.remove();

        const btn = document.getElementById('futgg-floating-btn');
        if (btn) btn.classList.add('has-new');

        const notice = document.createElement('div');
        notice.id = 'futgg-bottom-notice';

        const isSingle = newGems.length === 1;
        const first = newGems[0];

        let titleText = isSingle ? '¡Nueva Gema en FUT.GG!' : `¡${newGems.length} Nuevas Gemas en FUT.GG!`;
        let descText = '';
        let subText = '';

        if (isSingle) {
            descText = `${first.name} (${first.rating || '---'})`;
            subText = `Est: ${formatCoins(first.estimatedPrice)} • Benef: +${formatCoins(first.profit)}`;
        } else {
            const names = newGems.slice(0, 3).map(g => g.name).join(', ');
            descText = `${names}${newGems.length > 3 ? ` y ${newGems.length - 3} más` : ''}`;
            subText = 'Toca aquí para verlas en el panel';
        }

        notice.innerHTML = `
            <div class="notice-icon">💎</div>
            <div style="flex:1; min-width:0;">
                <div class="notice-title">${titleText}</div>
                <div class="notice-desc" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${descText}</div>
                <div class="notice-sub" style="font-size:11px; color:#8fa0b5; margin-top:2px;">${subText}</div>
            </div>
            <button class="notice-close" id="futgg-notice-close-btn" title="Cerrar">&times;</button>
        `;

        notice.addEventListener('click', (e) => {
            if (e.target.closest('#futgg-notice-close-btn')) {
                e.stopPropagation();
                notice.remove();
                return;
            }
            if (!State.isOpen) togglePanel();
            notice.remove();
        });

        document.body.appendChild(notice);

        clearTimeout(notice._timer);
        notice._timer = setTimeout(() => {
            if (document.body.contains(notice)) {
                notice.style.opacity = '0';
                notice.style.transform = 'translateY(20px)';
                setTimeout(() => notice.remove(), 300);
            }
        }, 25000);
    }

    function updateNewGemNoticeIfInClub() {
        const notice = document.getElementById('futgg-bottom-notice');
        if (!notice || !State.newGemIds || State.newGemIds.size === 0) return;

        const newInClub = State.gems.filter(g => State.newGemIds.has(Number(g.eaId)) && (State.transferMatches[g.eaId] || (State.clubMatches[g.eaId] && isItemTradeable(State.clubMatches[g.eaId]))));
        if (newInClub.length > 0) {
            const titleEl = notice.querySelector('.notice-title');
            const subEl = notice.querySelector('.notice-sub');
            if (titleEl) titleEl.textContent = '🔥 ¡Gema Nueva Disponible en Tu Club!';
            if (subEl) subEl.textContent = `Tienes ${newInClub.length} lista(s) para vender por ${formatCoins(newInClub[0].estimatedPrice)}`;
            notice.style.borderColor = '#00ff88';
            notice.style.boxShadow = '0 8px 30px rgba(0, 255, 136, 0.55), 0 4px 12px rgba(0,0,0,0.8)';
        }
    }

    // =========================================================================
    // DETECCIÓN DE APERTURA DE SOBRES / COMPRA DE PACKS (AUTO-SYNC CLUB CON FUT.GG)
    // =========================================================================
    let packDebounceTimer = null;
    function onPackEventDetected() {
        const PACK_WAIT_MS = 10 * 60 * 1000; // Esperar 10 minutos tras el último sobre de la tanda
        if (packDebounceTimer) clearTimeout(packDebounceTimer);

        console.log("%c[FUT.GG Helper] 🎁 Sobre o adquisición detectada. Auto-sync con FUT.GG programado en segundo plano en 10 min...", "color:#00ff88; font-weight:bold;");

        packDebounceTimer = setTimeout(async () => {
            console.log("%c[FUT.GG Helper] 🎁 10 minutos transcurridos sin nuevos sobres/adquisiciones. Verificando sincronización de club con FUT.GG en segundo plano...", "color:#00ff88; font-weight:bold;");
            
            const lastClubSync = Number(GM_getValue('futgg_last_club_sync_timestamp', 0));
            const elapsed = Date.now() - lastClubSync;
            const cooldown = CONFIG.clubSyncCooldownMs; // 30 min
            
            if (elapsed >= cooldown || lastClubSync === 0) {
                console.log("[FUT.GG Helper] ☁️ Sincronizando tu club con FUT.GG en segundo plano...");
                try {
                    const res = await FutGgClient.triggerClubSync();
                    if (res.success) {
                        GM_setValue('futgg_last_club_sync_timestamp', Date.now());
                        GM_setValue('futgg_pending_sync_after_packs', false);
                        updateClubSyncButtonState();
                        console.log("[FUT.GG Helper] ☁️ Club enviado a FUT.GG en segundo plano. Recargando joyas en 35s...");
                        setTimeout(() => loadGemsFromFutGg(true), 35000);
                    } else if (res.queueFull) {
                        console.log(`[FUT.GG Helper] ⏳ Cola de FUT.GG llena (~${res.waitMinutes}m). Reintentando en segundo plano...`);
                        GM_setValue('futgg_pending_sync_after_packs', true);
                    } else {
                        console.warn("[FUT.GG Helper] Respuesta de sync:", res.error);
                    }
                } catch (e) {
                    console.warn("[FUT.GG Helper] Fallo al auto-sincronizar tras sobre:", e);
                }
            } else {
                const remaining = Math.ceil((cooldown - elapsed) / 60000);
                GM_setValue('futgg_pending_sync_after_packs', true);
                console.log(`[FUT.GG Helper] 🎁 Auto-sync en segundo plano programado para cuando termine el cooldown (${remaining}m restantes).`);
            }
        }, PACK_WAIT_MS);
    }

    function setupPackOpeningListener() {
        const win = getAppWindow();
        if (!win) return;

        function checkUrl(url) {
            if (!url || typeof url !== 'string') return;
            const u = url.toLowerCase();
            if (u.includes('/purchased/items') || u.includes('/pack/buy') || u.includes('/pack/open') || u.includes('/pack/receive') || u.includes('/user/store')) {
                onPackEventDetected();
            }
        }

        try {
            const origXhrOpen = win.XMLHttpRequest && win.XMLHttpRequest.prototype.open;
            const origXhrSend = win.XMLHttpRequest && win.XMLHttpRequest.prototype.send;
            if (origXhrOpen && origXhrSend) {
                win.XMLHttpRequest.prototype.open = function (method, url) {
                    this._eaEndpointUrl = url;
                    return origXhrOpen.apply(this, arguments);
                };
                win.XMLHttpRequest.prototype.send = function () {
                    this.addEventListener('load', function () {
                        try {
                            if (this._eaEndpointUrl && (this.status === 200 || this.status === 201)) {
                                checkUrl(this._eaEndpointUrl);
                            }
                        } catch (e) { }
                    });
                    return origXhrSend.apply(this, arguments);
                };
            }

            if (win.fetch) {
                const origFetch = win.fetch;
                win.fetch = function (...args) {
                    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
                    return origFetch.apply(this, args).then(res => {
                        try {
                            if (res && res.ok && url) checkUrl(url);
                        } catch (e) { }
                        return res;
                    });
                };
            }
        } catch (e) {
            console.warn("[FUT.GG Helper] No se pudo inicializar interceptor de sobres:", e);
        }
    }

    function updateClubSyncButtonState() {
        const btn = document.getElementById('futgg-sync-club-remote-btn');
        if (!btn) return;

        const lastClubSync = Number(GM_getValue('futgg_last_club_sync_timestamp', 0));
        const elapsed = Date.now() - lastClubSync;
        const cooldown = CONFIG.clubSyncCooldownMs; // 30 min

        if (lastClubSync > 0 && elapsed < cooldown) {
            const remainingMins = Math.ceil((cooldown - elapsed) / 60000);
            btn.disabled = true;
            btn.style.opacity = '0.45';
            btn.style.cursor = 'not-allowed';
            btn.title = `⏳ Faltan ${remainingMins} min para poder sincronizar el club en FUT.GG (cooldown oficial de 30 min)`;
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.title = '☁️ Sincronizar tu club con FUT.GG ahora (Disponible)';
        }
    }

    async function onManualClubSyncClick() {
        const lastClubSync = Number(GM_getValue('futgg_last_club_sync_timestamp', 0));
        const elapsed = Date.now() - lastClubSync;
        const cooldown = CONFIG.clubSyncCooldownMs;

        if (elapsed < cooldown && lastClubSync !== 0) {
            updateClubSyncButtonState();
            return;
        }

        notificar("☁️ Solicitando sincronización de club en servidores de FUT.GG...", "#00ccff");
        try {
            const res = await FutGgClient.triggerClubSync();
            if (res.success) {
                GM_setValue('futgg_last_club_sync_timestamp', Date.now());
                GM_setValue('futgg_pending_sync_after_packs', false);
                updateClubSyncButtonState();
                notificar("🟢 ¡Sincronización iniciada en FUT.GG! Recargando joyas en 35s...", "#00ff88");
                setTimeout(() => loadGemsFromFutGg(true), 35000);
            } else if (res.queueFull) {
                notificar(`⏳ La cola de sincronización de FUT.GG está llena (~${res.waitMinutes}m).`, "#ffaa00");
            } else {
                notificar(`⚠️ FUT.GG respondió: ${res.error || 'No se pudo iniciar el sync'}`, "#ffaa00");
            }
        } catch (e) {
            notificar(`Error al conectar con FUT.GG: ${e.message}`, "#ff4444");
        }
    }

    function updateSyncTimerDisplay() {
        updateClubSyncButtonState();
        const label = document.getElementById('futgg-sync-timer-label');
        if (!label) return;
        if (!State.nextSyncTimestamp) {
            label.textContent = '⏱️ Auto-check: cada 15m';
            return;
        }
        const diffMs = State.nextSyncTimestamp - Date.now();
        if (diffMs <= 0) {
            label.textContent = '⏱️ Comprobando gemas...';
        } else {
            const mins = Math.ceil(diffMs / 60000);
            label.textContent = `⏱️ Auto-check: prox. en ${mins}m`;
        }
    }

    function scheduleNextAutoSync(delayMs = CONFIG.autoSyncIntervalMs) {
        if (State.autoSyncTimer) clearTimeout(State.autoSyncTimer);
        State.nextSyncTimestamp = Date.now() + delayMs;
        updateSyncTimerDisplay();
        console.log(`[FUT.GG Helper] ⏱️ Próxima auto-comprobación de gemas en ${Math.round(delayMs / 60000)} minutos.`);
        State.autoSyncTimer = setTimeout(async () => {
            console.log("[FUT.GG Helper] 🔄 Ejecutando comprobación periódica de gemas con FUT.GG...");
            if (State.isBatchRunning) {
                console.log("[FUT.GG Helper] ⏳ Batch en curso, posponiendo auto-sync 1 minuto...");
                scheduleNextAutoSync(60000);
                return;
            }

            // Si había una sincronización de club pendiente tras abrir packs y ya pasaron los 30 min de cooldown
            const isPendingPackSync = GM_getValue('futgg_pending_sync_after_packs', false);
            const lastClubSync = Number(GM_getValue('futgg_last_club_sync_timestamp', 0));
            if (isPendingPackSync && (Date.now() - lastClubSync >= CONFIG.clubSyncCooldownMs)) {
                try {
                    console.log("[FUT.GG Helper] 🎁 Ejecutando sync pendiente de club en FUT.GG tras packs...");
                    const res = await FutGgClient.triggerClubSync();
                    if (res && res.success) {
                        GM_setValue('futgg_last_club_sync_timestamp', Date.now());
                        GM_setValue('futgg_pending_sync_after_packs', false);
                        updateClubSyncButtonState();
                    }
                } catch (e) { }
            }

            try {
                await loadGemsFromFutGg(true /* isAuto */);
            } catch (e) {
                console.warn("[FUT.GG Helper] Error en auto-sync periódico:", e);
            }
            scheduleNextAutoSync(CONFIG.autoSyncIntervalMs);
        }, delayMs);
    }

    async function initAutoSync() {
        const lastSync = Number(GM_getValue('futgg_last_sync_timestamp', 0));
        const elapsed = Date.now() - lastSync;
        const cooldown = CONFIG.autoSyncIntervalMs; // 30 min

        if (!State.syncCountdownInterval) {
            State.syncCountdownInterval = setInterval(updateSyncTimerDisplay, 10000);
        }

        // Si han pasado más de 30m (o es la primera vez)
        if (elapsed >= cooldown || lastSync === 0) {
            console.log("[FUT.GG Helper] Iniciando auto-sync inicial con FUT.GG...");
            await loadGemsFromFutGg(true);
            scheduleNextAutoSync(cooldown);
        } else {
            const remaining = cooldown - elapsed;
            console.log(`[FUT.GG Helper] Sincronización reciente (hace ${Math.floor(elapsed / 60000)}m). Próxima en ${Math.ceil(remaining / 60000)}m.`);
            
            // Cargar gemas cacheadas para mostrar datos inmediatos
            try {
                const cached = GM_getValue('futgg_cached_gems', '');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        State.gems = parsed;
                        updateBadge();
                        const countEl = document.getElementById('futgg-gems-count');
                        if (countEl) countEl.textContent = `${State.gems.length} joyas en caché`;

                        waitForEAServices(25000).then(ready => {
                            if (ready && State.gems.length > 0) {
                                scanClubForGems(true);
                            }
                        });
                    }
                }
            } catch (e) { }

            if (State.gems.length === 0) {
                await loadGemsFromFutGg(true);
                scheduleNextAutoSync(cooldown);
            } else {
                scheduleNextAutoSync(remaining);
            }
        }
    }

    function createUI() {
        if (document.getElementById('futgg-floating-btn')) return;
        injectUIStyles();

        // Botón flotante: Solo emoji de diamante y número de gemas disponibles para vender
        const btn = document.createElement('div');
        btn.id = 'futgg-floating-btn';
        btn.title = "Joyas disponibles para vender (Arrastra para mover • Clic o Alt+G para abrir)";
        btn.innerHTML = `<span style="font-size:16px; line-height:1;">💎</span><span class="badge" id="futgg-badge">0</span>`;

        // Restaurar posición personalizada previa si el usuario lo arrastró
        try {
            const savedPos = JSON.parse(GM_getValue('futgg_btn_pos', 'null'));
            if (savedPos && typeof savedPos.top === 'number') {
                btn.style.top = `${savedPos.top}px`;
                if (typeof savedPos.left === 'number') {
                    btn.style.left = `${savedPos.left}px`;
                    btn.style.right = 'auto';
                }
                btn.style.bottom = 'auto';
            }
        } catch (e) { }

        // Soporte completo para arrastrar y soltar (Drag & Drop)
        let isDragging = false;
        let dragMoved = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        btn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            dragMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = btn.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            const onMouseMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (!dragMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                    dragMoved = true;
                    btn.style.cursor = 'grabbing';
                }
                if (dragMoved) {
                    btn.style.bottom = 'auto';
                    btn.style.right = 'auto';
                    const maxLeft = window.innerWidth - btn.offsetWidth - 8;
                    const maxTop = window.innerHeight - btn.offsetHeight - 8;
                    const curLeft = Math.max(8, Math.min(maxLeft, initialLeft + dx));
                    const curTop = Math.max(8, Math.min(maxTop, initialTop + dy));
                    btn.style.left = `${curLeft}px`;
                    btn.style.top = `${curTop}px`;
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                btn.style.cursor = 'pointer';
                if (dragMoved) {
                    const rect = btn.getBoundingClientRect();
                    GM_setValue('futgg_btn_pos', JSON.stringify({ top: rect.top, left: rect.left }));
                }
                setTimeout(() => { isDragging = false; }, 50);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        btn.addEventListener('click', (e) => {
            if (dragMoved) {
                e.preventDefault();
                e.stopPropagation();
                dragMoved = false;
                return;
            }
            togglePanel();
        });

        document.body.appendChild(btn);

        // Panel Principal
        const panel = document.createElement('div');
        panel.id = 'futgg-panel';
        panel.classList.add('hidden');
        panel.innerHTML = `
            <div class="futgg-header">
                <h2>💎 Joyas Ocultas de FUT.GG & Auto-Listador</h2>
                <div style="display:flex; align-items:center; gap:8px;">
                    <label style="display:inline-flex; align-items:center; gap:6px; font-size:11px; color:#cbd5e1; cursor:pointer; background:#162232; border:1px solid #23344a; padding:4px 10px; border-radius:6px; user-select:none;" title="Ocultar jugadores que ya no tienes en tu club o que ya fueron vendidos">
                        <input type="checkbox" id="futgg-hide-sold-toggle" checked style="cursor:pointer; accent-color:#00ff88;" />
                        <span>Ocultar vendidas / fuera de club (<b id="futgg-hidden-count" style="color:#00ff88;">0</b>)</span>
                    </label>
                    <button class="futgg-btn" id="futgg-toggle-token-btn" style="padding:4px 10px; font-size:11px;" title="Configuración de Token JWT de FUT.GG">⚙️ Token</button>
                    <button class="futgg-close-btn" id="futgg-close-btn" title="Cerrar">&times;</button>
                </div>
            </div>
            <div class="futgg-toolbar">
                <!-- Grupo Sincronización -->
                <div style="display:flex; gap:6px; align-items:center; background:#162232; padding:4px 6px; border-radius:8px; border:1px solid #23344a;">
                    <span style="font-size:10px; font-weight:700; color:#8fa0b5; text-transform:uppercase; margin-right:2px; letter-spacing:0.5px;">Sync:</span>
                    <button class="futgg-btn primary" id="futgg-refresh-btn" style="padding:5px 10px; font-size:11px;" title="Descarga de FUT.GG las joyas ocultas actuales (Auto-check cada 15 min)">🔄 Cargar Joyas</button>
                    <button class="futgg-btn" id="futgg-sync-club-remote-btn" style="padding:5px 10px; font-size:11px; border-color:#ff5500; color:#ff7733;" title="Envía la orden a FUT.GG para leer tu club de EA (Equivalente al botón Sync Club de su web)">☁️ Sync Club</button>
                    <button class="futgg-btn" id="futgg-scan-club-btn" style="padding:5px 10px; font-size:11px;" title="Comprueba si las joyas están en tu inventario local (Club, Transferibles, Sin Asignar)">🔍 Escanear Club</button>
                </div>

                <!-- Estado del lote / Batch si está en curso -->
                <div id="futgg-batch-controls" style="display:none; align-items:center; gap:8px;">
                    <span id="futgg-batch-status" style="font-size:11px; color:#ffaa00; font-weight:bold;">Procesando...</span>
                    <button class="futgg-btn danger" id="futgg-cancel-batch-btn" style="padding:3px 8px; font-size:10px;">Detener</button>
                </div>

                <!-- Grupo Acciones en Lote -->
                <div style="display:flex; gap:6px; align-items:center; background:#162232; padding:4px 6px; border-radius:8px; border:1px solid #23344a;">
                    <span style="font-size:10px; font-weight:700; color:#8fa0b5; text-transform:uppercase; margin-right:2px; letter-spacing:0.5px;">Acciones:</span>
                    <button class="futgg-btn" id="futgg-batch-move-btn" style="padding:5px 10px; font-size:11px;" title="Mueve todas las joyas que tienes en el club a tu Lista de Transferibles">📥 Mover Todas</button>
                    <button class="futgg-btn" id="futgg-batch-check-btn" style="padding:5px 10px; font-size:11px;" title="Revisa el precio de mercado de todas las cartas de forma inteligente y segura (Tecla V)">📊 Chequear Mercado</button>
                    <button class="futgg-btn" id="futgg-batch-list-btn" style="padding:5px 10px; font-size:11px; border-color:#00ff88; color:#00ff88; font-weight:700;" title="Pone a la venta en el mercado las cartas revisadas">🚀 Listar Todas</button>
                </div>
            </div>
            <div id="futgg-token-panel" style="display:none; flex-direction:column; gap:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                    <div>
                        <b>Token de Autenticación FUT.GG (JWT):</b>
                        <span style="font-size:11px; color:#8fa0b5;"> (Auto-sincronizado con www.fut.gg)</span>
                    </div>
                    <div id="futgg-token-status-badge" style="font-size:11px; font-weight:bold; color:#00ff88;">
                        Comprobando...
                    </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <input type="password" id="futgg-token-input" style="flex:1; background:#0c1218; border:1px solid #35475e; color:#00ff88; padding:6px 10px; border-radius:6px; font-size:12px;" placeholder="Pega tu token JWT aquí..." />
                    <button class="futgg-btn" id="futgg-paste-token-btn">📋 Pegar</button>
                    <button class="futgg-btn primary" id="futgg-save-token-btn">💾 Guardar</button>
                    <button class="futgg-btn" id="futgg-refresh-token-btn" style="border-color:#00ccff; color:#00ccff;">🔄 Refrescar</button>
                    <button class="futgg-btn" id="futgg-open-futgg-btn">🌐 Abrir FUT.GG</button>
                </div>
            </div>
            <div class="futgg-body" id="futgg-body">
                <div id="futgg-loading" style="display:none; text-align:center; padding:50px;">
                    <div style="font-size:14px; color:#8fa0b5;">Conectando con FUT.GG...</div>
                </div>
                <div id="futgg-table-container">
                    <!-- Tabla inyectada dinámicamente -->
                </div>
            </div>
            <div class="futgg-footer">
                <div style="display:flex; align-items:center; gap:12px;">
                    <span>🛡️ Modo Seguro Anti-Ban Activo (Delays 2.8s - 4.2s)</span>
                    <span id="futgg-sync-timer-label" style="color:#00ff88; font-size:11px; font-weight:600;">⏱️ Auto-check: 15m</span>
                </div>
                <div>
                    <span id="futgg-gems-count">0 joyas cargadas</span>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // Listeners Principales
        document.getElementById('futgg-close-btn').onclick = togglePanel;
        document.getElementById('futgg-refresh-btn').onclick = () => {
            scheduleNextAutoSync(CONFIG.autoSyncIntervalMs);
            loadGemsFromFutGg(false);
        };
        const syncClubRemoteBtn = document.getElementById('futgg-sync-club-remote-btn');
        if (syncClubRemoteBtn) {
            syncClubRemoteBtn.onclick = onManualClubSyncClick;
            syncClubRemoteBtn.onmouseenter = updateClubSyncButtonState;
        }
        document.getElementById('futgg-scan-club-btn').onclick = () => scanClubForGems(false);
        document.getElementById('futgg-batch-move-btn').onclick = batchMoveAllToTransfer;
        document.getElementById('futgg-batch-check-btn').onclick = batchCheckAllMarketPrices;
        document.getElementById('futgg-batch-list-btn').onclick = batchListAllReviewed;
        document.getElementById('futgg-cancel-batch-btn').onclick = cancelBatch;
        document.getElementById('futgg-toggle-token-btn').onclick = toggleTokenPanel;
        document.getElementById('futgg-save-token-btn').onclick = saveTokenManual;
        document.getElementById('futgg-paste-token-btn').onclick = pasteTokenClipboard;
        document.getElementById('futgg-refresh-token-btn').onclick = onRefreshTokenClick;
        document.getElementById('futgg-open-futgg-btn').onclick = () => window.open('https://www.fut.gg/gg-club/hidden-gems/', '_blank');

        initAutoSync();
        updateClubSyncButtonState();

        const hideToggle = document.getElementById('futgg-hide-sold-toggle');
        if (hideToggle) {
            hideToggle.onchange = (e) => {
                State.hideSoldOrMissing = e.target.checked;
                renderGemsTable();
            };
        }

        // EVENT DELEGATION PARA BOTONES DE LA TABLA (100% INMUNE A SANDBOXES DE TAMPERMONKEY)
        panel.addEventListener('click', async (e) => {
            const btn = e.target.closest('button, [data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            const eaId = btn.getAttribute('data-eaid');
            if (!action) return;

            e.preventDefault();
            e.stopPropagation();

            const gem = State.gems.find(g => String(g.eaId) === String(eaId));

            if (action === 'check-market') {
                State.focusedGemId = eaId;
                if (gem) checkMarketPrice(gem, false, false);
            } else if (action === 'search-market-open') {
                State.focusedGemId = eaId;
                if (gem) checkMarketPrice(gem, false, true);
            } else if (action === 'stop-market-crawl') {
                State.abortMarketCrawl[eaId] = true;
                if (State.marketPrices[eaId]) {
                    State.marketPrices[eaId].crawling = false;
                    State.marketPrices[eaId].loading = false;
                }
                notificar(`⏹️ Deteniendo análisis de mercado para ${gem ? gem.name : 'carta'}...`, "#ffaa00");
                renderGemsTable();
            } else if (action === 'toggle-breakdown') {
                State.openPriceBreakdowns[eaId] = !State.openPriceBreakdowns[eaId];
                renderGemsTable();
            } else if (action === 'pick-price') {
                const price = parseInt(btn.getAttribute('data-price'), 10);
                if (price && eaId) {
                    State.focusedGemId = eaId;
                    State.customPrices[eaId] = price;
                    renderGemsTable();
                    notificar(`🎯 Precio seleccionado para ${gem ? gem.name : 'jugador'}: ${formatCoins(price)} (Puja: ${formatCoins(calculateStartBid(price))})`, "#00ff88");
                }
            } else if (action === 'open-in-webapp') {
                if (gem) openMarketSearchInWebApp(gem);
            } else if (action === 'move') {
                if (gem) moveToTransferList(gem);
            } else if (action === 'list') {
                if (gem) listCardOnMarket(gem);
            } else if (action === 'adjust-price') {
                const dir = parseInt(btn.getAttribute('data-dir'), 10) || 1;
                adjustPriceByEaId(eaId, dir);
            } else if (action === 'search-club') {
                if (gem) searchSingleCardInClub(gem);
            }
        });

        panel.addEventListener('input', (e) => {
            if (e.target.classList.contains('futgg-price-input')) {
                const eaId = e.target.getAttribute('data-eaid');
                const val = parseInt(e.target.value, 10) || 0;
                State.customPrices[eaId] = val;
                const cell = e.target.closest('td');
                if (cell) {
                    const b = cell.querySelector('b');
                    if (b) b.textContent = formatCoins(calculateStartBid(val));
                }
            }
        });
    }

    function updateTokenStatusBadge() {
        const badge = document.getElementById('futgg-token-status-badge');
        if (!badge) return;
        const currentTok = document.getElementById('futgg-token-input')?.value.trim() || CONFIG.futggToken;
        if (!currentTok) {
            badge.style.color = '#8fa0b5';
            badge.textContent = '⚪ Sin token guardado';
            return;
        }
        const info = getTokenExpiryInfo(currentTok);
        if (!info.valid) {
            badge.style.color = '#ff4444';
            badge.textContent = `🔴 ${info.text}`;
        } else if (info.expired) {
            badge.style.color = '#ffaa00';
            badge.textContent = `⚠️ ${info.text}`;
        } else {
            badge.style.color = '#00ff88';
            badge.textContent = `🟢 ${info.text}`;
        }
    }

    async function onRefreshTokenClick() {
        notificar("🔄 Intentando autorefrescar token de FUT.GG...", "#00ccff");
        const btn = document.getElementById('futgg-refresh-token-btn');
        if (btn) btn.disabled = true;

        let refreshedTok = null;

        // 1. Intentar con GM_cookie para www.fut.gg
        if (typeof GM_cookie !== 'undefined' && GM_cookie.list) {
            try {
                refreshedTok = await new Promise(res => {
                    GM_cookie.list({ url: 'https://www.fut.gg/' }, (cookies, err) => {
                        if (!err && cookies && cookies.length > 0) {
                            for (const c of cookies) {
                                if (c.name === 'futgg_jwt' && isRealFutGgJwt(c.value, false)) {
                                    return res(c.value);
                                }
                            }
                        }
                        res(null);
                    });
                });
            } catch (e) { }
        }

        // 2. Si no, intentar con el refresh_token guardado
        if (!refreshedTok) {
            const storedRefresh = GM_getValue('futgg_refresh_token', '');
            if (storedRefresh) {
                try {
                    const res = await refreshSupabaseToken(storedRefresh);
                    if (res && res.access_token) {
                        refreshedTok = res.access_token;
                    }
                } catch (e) {
                    console.warn("[FUT.GG Helper] Fallo al refrescar con storedRefresh:", e);
                }
            }
        }

        if (btn) btn.disabled = false;

        if (refreshedTok) {
            CONFIG.futggToken = refreshedTok;
            document.getElementById('futgg-token-input').value = refreshedTok;
            updateTokenStatusBadge();
            notificar("🟢 ¡Token de FUT.GG renovado con éxito! Recargando joyas...", "#00ff88");
            loadGemsFromFutGg();
        } else {
            notificar("⚠️ No se pudo autorefrescar. Abre www.fut.gg en otra pestaña para reactivar la sesión.", "#ffaa00");
            window.open('https://www.fut.gg/gg-club/hidden-gems/', '_blank');
        }
    }

    function toggleTokenPanel() {
        const p = document.getElementById('futgg-token-panel');
        if (!p) return;
        const isHidden = p.style.display === 'none';
        p.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            document.getElementById('futgg-token-input').value = CONFIG.futggToken;
            updateTokenStatusBadge();
        }
    }

    function saveTokenManual() {
        const val = document.getElementById('futgg-token-input').value.trim();
        if (val) {
            const info = getTokenExpiryInfo(val);
            if (!info.valid) {
                notificar(`⚠️ Token inválido: ${info.text}`, "#ffaa00");
                return;
            }
            if (info.expired) {
                notificar(`⚠️ Advertencia: ${info.text}. Puede fallar si no lo renuevas.`, "#ffaa00");
            } else {
                notificar(`💾 Token guardado: ${info.text}`, "#00ff88");
            }
            CONFIG.futggToken = val;
            updateTokenStatusBadge();
            toggleTokenPanel();
            loadGemsFromFutGg();
        } else {
            notificar("Por favor ingresa un token válido", "#ffaa00");
        }
    }

    async function pasteTokenClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                document.getElementById('futgg-token-input').value = text.trim();
                updateTokenStatusBadge();
                notificar("Token pegado del portapapeles", "#00ccff");
            }
        } catch (e) {
            notificar("Usa Ctrl+V para pegar el token", "#ffaa00");
        }
    }

    function togglePanel() {
        const panel = document.getElementById('futgg-panel');
        if (!panel) return;
        State.isOpen = !State.isOpen;
        if (State.isOpen) {
            panel.classList.remove('hidden');
            updateClubSyncButtonState();
            const floatingBtn = document.getElementById('futgg-floating-btn');
            if (floatingBtn) floatingBtn.classList.remove('has-new');
            if (State.gems.length === 0) {
                loadGemsFromFutGg();
            } else {
                renderGemsTable();
            }
        } else {
            panel.classList.add('hidden');
        }
    }

    function updateBatchStatus(text) {
        State.batchStatusText = text;
        const statusSpan = document.getElementById('futgg-batch-status');
        if (statusSpan) statusSpan.textContent = text;
    }

    function renderBatchControls() {
        const batchControls = document.getElementById('futgg-batch-controls');
        if (!batchControls) return;
        batchControls.style.display = State.isBatchRunning ? 'flex' : 'none';
    }

    async function loadGemsFromFutGg(isAuto = false) {
        const loading = document.getElementById('futgg-loading');
        if (loading && (!isAuto || State.isOpen)) loading.style.display = 'block';

        try {
            if (!isAuto) notificar("🔄 Conectando con FUT.GG...", "#00ccff");
            const data = await FutGgClient.fetchHiddenGems();
            const items = data.items || [];

            State.gems = items.map(it => {
                const player = it.player || {};
                const pdef = player.playerDef || {};
                const name = pdef.commonName || (pdef.firstName ? `${pdef.firstName} ${pdef.lastName}` : '') || pdef.name || pdef.searchableName || 'Jugador';
                const rating = pdef.overall || pdef.overallRating || pdef.rating || 0;
                const eaId = it.eaId || player.eaId || pdef.eaId || player.id;

                return {
                    eaId: Number(eaId),
                    name: name,
                    rating: rating,
                    position: pdef.mainPosition || (pdef.position ? String(pdef.position) : 'N/A'),
                    club: pdef.club ? pdef.club.name : (pdef.uniqueClub ? pdef.uniqueClub.name : ''),
                    nation: pdef.nation ? pdef.nation.name : '',
                    estimatedPrice: it.value || it.price || 0,
                    profit: it.profit || 0,
                    isExtinct: it.isExtinct || false,
                    count: it.count || 1
                };
            });

            // Comparar con historial previo para detectar gemas nuevas
            let knownIds = [];
            try {
                const raw = GM_getValue('futgg_known_gem_ids', '[]');
                knownIds = JSON.parse(raw) || [];
            } catch (e) {
                knownIds = [];
            }

            const currentEaIds = State.gems.map(g => Number(g.eaId)).filter(id => id > 0);
            let newlyFoundGems = [];
            if (knownIds.length > 0) {
                newlyFoundGems = State.gems.filter(g => !knownIds.includes(Number(g.eaId)));
            }

            // Actualizar almacenamiento persistente
            GM_setValue('futgg_known_gem_ids', JSON.stringify(currentEaIds));
            GM_setValue('futgg_cached_gems', JSON.stringify(State.gems));
            State.newGemIds = new Set(newlyFoundGems.map(g => Number(g.eaId)));

            State.lastSyncTimestamp = Date.now();
            State.nextSyncTimestamp = Date.now() + CONFIG.autoSyncIntervalMs;
            GM_setValue('futgg_last_sync_timestamp', State.lastSyncTimestamp);
            updateSyncTimerDisplay();

            const gemsCountEl = document.getElementById('futgg-gems-count');
            if (gemsCountEl) gemsCountEl.textContent = `${State.gems.length} joyas detectadas`;

            // Si hay gemas nuevas, mostrarlas abajo
            if (newlyFoundGems.length > 0) {
                showBottomNewGemNotice(newlyFoundGems);
                notificar(`💎 ¡${newlyFoundGems.length} nueva(s) joya(s) detectada(s) en FUT.GG!`, "#00ff88");
            } else if (!isAuto) {
                notificar(`💎 ${State.gems.length} Joyas Ocultas cargadas de FUT.GG`, "#00ff88");
            }

            updateBadge();

            // Si hay gemas, escanear el club automáticamente
            if (State.gems.length > 0) {
                await scanClubForGems(isAuto);
            } else {
                renderGemsTable();
            }
        } catch (err) {
            if (!isAuto) notificar(`Error: ${err.message}`, "#ff4444");
            console.error(err);
            if (!isAuto || State.isOpen) renderErrorUI(err.message);
        } finally {
            if (loading) loading.style.display = 'none';
        }
    }

    function renderErrorUI(errorMsg) {
        const container = document.getElementById('futgg-table-container');
        if (!container) return;

        container.innerHTML = `
            <div style="text-align:center; padding: 60px 20px; color:#8fa0b5;">
                <div style="font-size:36px; margin-bottom:12px;">⚠️</div>
                <div style="font-size:16px; font-weight:700; color:#ff5555; margin-bottom:8px;">Error al conectar con FUT.GG</div>
                <div style="font-size:13px; max-width:550px; margin:0 auto 20px auto; line-height:1.5; color:#cbd5e1;">
                    ${errorMsg}
                </div>
                <div style="display:flex; justify-content:center; gap:10px;">
                    <button class="futgg-btn primary" onclick="document.getElementById('futgg-toggle-token-btn').click()">⚙️ Configurar Token JWT</button>
                    <button class="futgg-btn" onclick="window.open('https://www.fut.gg/gg-club/hidden-gems/', '_blank')">🌐 Abrir FUT.GG en otra pestaña</button>
                </div>
            </div>
        `;
    }

    function adjustPriceByEaId(eaId, direction) {
        const current = State.customPrices[eaId] || 1000;
        const step = getBidStep(current);
        const nextPrice = direction > 0 ? current + step : Math.max(200, current - step);
        State.customPrices[eaId] = roundToValidBid(nextPrice, direction > 0 ? 'up' : 'down');
        renderGemsTable();
    }

    function renderGemsTable() {
        const container = document.getElementById('futgg-table-container');
        if (!container) return;

        if (State.gems.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding: 60px 20px; color:#8fa0b5;">
                    <div style="font-size:36px; margin-bottom:12px;">💎</div>
                    <div style="font-size:16px; font-weight:600; color:#fff; margin-bottom:8px;">No hay Joyas Ocultas actualmente</div>
                    <div style="font-size:13px; max-width:500px; margin:0 auto; line-height:1.5;">
                        Tu club no tiene jugadores marcados en FUT.GG Hidden Gems en este momento, o acabas de sincronizar tu cuenta.
                        Haz clic en <b>"🔄 Cargar de FUT.GG"</b> una vez que termine la sincronización.
                    </div>
                </div>
            `;
            return;
        }

        const hasScanned = State.lastScanTimestamp > 0 || Object.keys(State.clubMatches).length > 0 || Object.keys(State.transferMatches).length > 0 || Object.keys(State.sellingMatches).length > 0;

        let soldOrMissingCount = 0;
        let sellingCount = 0;
        let availableCount = 0;

        for (const gem of State.gems) {
            const eaId = Number(gem.eaId);
            const inClub = State.clubMatches[eaId];
            const inTransfer = State.transferMatches[eaId];
            const selling = State.sellingMatches[eaId];
            const sold = State.soldMatches[eaId];

            if (sold || (hasScanned && !inClub && !inTransfer && !selling)) {
                soldOrMissingCount++;
            } else if (selling) {
                sellingCount++;
            } else if (inTransfer || (inClub && isItemTradeable(inClub))) {
                availableCount++;
            }
        }

        // Actualizar contadores
        const hiddenCountEl = document.getElementById('futgg-hidden-count');
        if (hiddenCountEl) hiddenCountEl.textContent = soldOrMissingCount;
        updateBadge(availableCount);

        const displayedGems = State.gems.filter(gem => {
            if (!hasScanned) return true;
            if (State.hideSoldOrMissing) {
                const eaId = Number(gem.eaId);
                const inClub = State.clubMatches[eaId];
                const inTransfer = State.transferMatches[eaId];
                const selling = State.sellingMatches[eaId];
                const sold = State.soldMatches[eaId];
                const isSoldOrMissing = sold || (!inClub && !inTransfer && !selling);
                if (isSoldOrMissing) return false;
            }
            return true;
        });

        // Ordenamiento prioritario:
        // 1. Disponibles para vender (arriba del todo): En Transferibles o En Club (Tradeable)
        // 2. No escaneadas aún
        // 3. Intransferibles en club
        // 4. Vendiéndose activamente (abajo del todo, como solicitó el usuario)
        // 5. Ya vendidas o fuera del club
        displayedGems.sort((a, b) => {
            const getPriority = (gem) => {
                const eaId = Number(gem.eaId);
                const selling = State.sellingMatches[eaId];
                const inTransfer = State.transferMatches[eaId];
                const inClub = State.clubMatches[eaId];
                const sold = State.soldMatches[eaId];

                // Prioridad 1: En transferibles (listas para listar de inmediato)
                if (inTransfer) return 1;
                // Prioridad 2: En club comerciables (listas para mover o listar)
                if (inClub && isItemTradeable(inClub)) return 2;
                // Prioridad 3: No escaneadas aún
                if (!hasScanned && !selling && !sold) return 3;
                // Prioridad 4: Intransferibles en club
                if (inClub && !isItemTradeable(inClub)) return 4;
                // Prioridad 5: Vendiéndose activamente en mercado (abajo del todo)
                if (selling) return 5;
                // Prioridad 6: Ya vendidas
                if (sold) return 6;
                // Prioridad 7: Fuera del club
                return 7;
            };

            const prioA = getPriority(a);
            const prioB = getPriority(b);
            if (prioA !== prioB) {
                return prioA - prioB;
            }

            // Dentro del mismo grupo, ordenar por mayor beneficio/valor real del mercado (si ya fue consultado)
            const getEffectiveValue = (gem) => {
                const id = Number(gem.eaId);
                const market = State.marketPrices[id];
                if (market && !market.error && !market.loading && !market.crawling) {
                    if (market.isExtinct) {
                        return gem.profit || gem.estimatedPrice || 10000;
                    }
                    const realPrice = market.hasOutlier ? market.realisticBin : (market.lowestBin || 0);
                    if (realPrice > 0) {
                        const cost = Math.max(0, (gem.estimatedPrice || 0) - (gem.profit || 0));
                        return Math.max(0, realPrice - cost);
                    }
                }
                return gem.profit || gem.estimatedPrice || 0;
            };

            const valA = getEffectiveValue(a);
            const valB = getEffectiveValue(b);
            if (valB !== valA) {
                return valB - valA;
            }
            return (b.estimatedPrice || 0) - (a.estimatedPrice || 0);
        });

        const gemsCountEl = document.getElementById('futgg-gems-count');
        if (gemsCountEl) {
            gemsCountEl.textContent = `${displayedGems.length} visibles (${availableCount} para vender, ${sellingCount} vendiéndose, ${soldOrMissingCount} vendidas/fuera de club)`;
        }

        if (displayedGems.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding: 60px 20px; color:#8fa0b5;">
                    <div style="font-size:36px; margin-bottom:12px;">✅</div>
                    <div style="font-size:16px; font-weight:600; color:#fff; margin-bottom:8px;">Todas las joyas detectadas ya fueron vendidas o están fuera del club</div>
                    <div style="font-size:13px; max-width:520px; margin:0 auto 16px auto; line-height:1.5; color:#cbd5e1;">
                        Se han ocultado <b>${soldOrMissingCount}</b> cartas que ya vendiste o que no están presentes en tu club.<br>
                        Desmarca la casilla <i>"Ocultar vendidas / fuera de club"</i> arriba si deseas inspeccionarlas.
                    </div>
                </div>
            `;
            return;
        }

        let html = `
            <table class="futgg-table">
                <thead>
                    <tr>
                        <th>Jugador</th>
                        <th>Precio FUT.GG</th>
                        <th>Estado Club</th>
                        <th>Mercado en Vivo</th>
                        <th>Precio de Venta</th>
                        <th>Acción</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let hasShownSellingSeparator = false;
        let itemsRenderedBeforeSelling = 0;

        for (const gem of displayedGems) {
            const eaId = Number(gem.eaId);
            const inClub = State.clubMatches[eaId];
            const inTransfer = State.transferMatches[eaId];
            const selling = State.sellingMatches[eaId];
            const sold = State.soldMatches[eaId];
            const market = State.marketPrices[eaId];
            const customPrice = State.customPrices[eaId] || gem.estimatedPrice || 0;

            // Separador de sección visual antes de las cartas que ya se están vendiendo en el mercado
            if (selling && !hasShownSellingSeparator && itemsRenderedBeforeSelling > 0) {
                hasShownSellingSeparator = true;
                html += `
                    <tr class="futgg-section-divider-row">
                        <td colspan="6">
                            <div class="futgg-section-divider">
                                <span>🚀 Ya Listadas en el Mercado (${sellingCount} ${sellingCount === 1 ? 'carta' : 'cartas'})</span>
                            </div>
                        </td>
                    </tr>
                `;
            }

            if (!selling) {
                itemsRenderedBeforeSelling++;
            }

            // Estado del club
            let clubStatusHtml = '';
            if (selling) {
                const remainingSec = selling.expiresAt ? Math.max(0, Math.floor((selling.expiresAt - Date.now()) / 1000)) : (selling.expires || 0);
                const timeStr = formatTimeRemaining(remainingSec);
                clubStatusHtml = `<span class="futgg-tag selling">🚀 Vendiéndose (${timeStr})</span>`;
            } else if (inTransfer) {
                clubStatusHtml = `<span class="futgg-tag transfer">📋 En Transferibles</span>`;
            } else if (inClub) {
                const isTradeable = isItemTradeable(inClub);
                clubStatusHtml = isTradeable
                    ? `<span class="futgg-tag club">🟢 En Club (Tradeable)</span>`
                    : `<span class="futgg-tag extinct" title="No se puede vender en el mercado">🔒 Intransferible</span>`;
            } else if (sold) {
                clubStatusHtml = `<span class="futgg-tag" style="background:rgba(100,116,139,0.2); color:#94a3b8; border:1px solid #64748b;">✅ Ya Vendido</span>`;
            } else if (hasScanned) {
                clubStatusHtml = `<span class="futgg-tag" style="background:rgba(100,116,139,0.2); color:#94a3b8; border:1px solid #64748b;">⚪ Fuera del Club</span>`;
            } else {
                clubStatusHtml = `
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span class="futgg-tag none">⚪ No escaneado</span>
                        <button class="futgg-btn" style="padding:2px 6px; font-size:10px;" data-action="search-club" data-eaid="${eaId}" title="Buscar en mi club">🔍</button>
                    </div>
                `;
            }

            // Estado del mercado en vivo
            let marketHtml = '';
            if (market && market.crawling) {
                marketHtml = `
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <span style="color:#00ff88; font-weight:bold; font-size:11px;">⏳ Analizando pág. ${market.pageLoaded || 1}... (${market.count || 0} cartas)</span>
                        <button class="futgg-btn danger" style="padding:2px 6px; font-size:10px; align-self:flex-start;" data-action="stop-market-crawl" data-eaid="${eaId}">⏹️ Detener</button>
                    </div>
                `;
            } else if (market && market.loading) {
                marketHtml = `<span style="color:#ffaa00; font-weight:bold;">⏳ Buscando en mercado...</span>`;
            } else if (market && market.listed) {
                marketHtml = `<span style="color:#00ff88; font-weight:bold;">🚀 Listado a ${formatCoins(market.price)}</span>`;
            } else if (market && market.isExtinct) {
                marketHtml = `
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span class="futgg-tag extinct" title="No hay cartas activas en el mercado">💎 ¡Extinta! (0 listadas)</span>
                        <button class="futgg-btn" style="padding:4px 8px; font-size:12px;" data-action="check-market" data-eaid="${eaId}" title="Reintentar">🔄</button>
                    </div>
                `;
            } else if (market && market.lowestBin) {
                const isBreakdownOpen = !!State.openPriceBreakdowns[eaId];
                const diff = (market.hasOutlier ? market.realisticBin : market.lowestBin) - gem.estimatedPrice;
                const diffColor = diff >= 0 ? '#00ff88' : '#ff5555';
                const hasMore = market.hasMore;

                let breakdownHtml = '';
                if (isBreakdownOpen && market.tiers && market.tiers.length > 0) {
                    breakdownHtml = `
                        <div class="futgg-price-breakdown">
                            <div class="futgg-breakdown-header">
                                <div style="display:flex; flex-direction:column; gap:2px;">
                                    <span>Cartas analizadas: <b>${market.count}${hasMore ? '+' : ''}</b></span>
                                    ${market.filterLabel ? `<span style="font-size:10px; color:#38bdf8;">🎯 Filtro: <b>${market.filterLabel}</b></span>` : ''}
                                </div>
                                <div style="display:flex; gap:4px; align-items:center;">
                                    ${market.filterType !== 'open' ? `<button class="futgg-btn" style="padding:1px 6px; font-size:9px; border-color:#38bdf8; color:#38bdf8;" data-action="search-market-open" data-eaid="${eaId}" title="Buscar en todo el mercado sin tope de precio">🌐 Sin tope</button>` : ''}
                                    <button class="futgg-btn" style="padding:1px 5px; font-size:9px;" data-action="open-in-webapp" data-eaid="${eaId}" title="Abrir en pantalla completa de EA">👁️ EA</button>
                                    <button class="futgg-btn" style="padding:1px 6px; font-size:9px; border-color:#ff5555; color:#ff7777;" data-action="toggle-breakdown" data-eaid="${eaId}" title="Comprimir lista">▲ Cerrar</button>
                                </div>
                            </div>
                            ${market.hasOutlier ? `
                                <div class="futgg-outlier-box">
                                    ⚠️ <b>Posible ganga/error:</b> 1 carta a ${formatCoins(market.lowestBin)}. El piso real es <b>${formatCoins(market.realisticBin)}</b>.
                                </div>
                            ` : ''}
                            <div class="futgg-tiers-container">
                                ${market.tiers.map(t => {
                        const isSel = customPrice === t.price;
                        return `
                                        <div class="futgg-tier-row ${t.isOutlier ? 'outlier' : ''} ${isSel ? 'selected' : ''}" data-action="pick-price" data-eaid="${eaId}" data-price="${t.price}" title="Clic para elegir este precio de venta">
                                             <span style="font-weight:700; color:#fff;">${formatCoins(t.price)}</span>
                                             <div style="display:flex; align-items:center; gap:6px;">
                                                 <span style="color:#8fa0b5; font-size:10px;">${t.count} ${t.count === 1 ? 'carta' : 'cartas'}</span>
                                                 ${t.isOutlier ? '<span class="futgg-tier-badge">⚠️ Snipe</span>' : ''}
                                                 ${t.price === market.realisticBin && market.hasOutlier ? '<span class="futgg-tier-badge safe">⭐ Real</span>' : ''}
                                                 ${isSel ? '<span style="color:#00ff88; font-size:10px;">✔</span>' : ''}
                                             </div>
                                         </div>
                                     `;
                    }).join('')}
                            </div>
                            <button class="futgg-btn" style="width:100%; margin-top:6px; padding:4px 0; font-size:10px; justify-content:center; background:#182434; border:1px solid #33475f; color:#cbd5e1; cursor:pointer;" data-action="toggle-breakdown" data-eaid="${eaId}" title="Comprimir lista de precios">▲ Comprimir lista de precios</button>
                        </div>
                    `;
                }

                marketHtml = `
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                            <div>
                                ${market.hasOutlier
                        ? `<div><span style="font-size:10px; color:#ffaa00;">⚠️ Mín: ${formatCoins(market.lowestBin)} (1)</span></div><b style="color:#00ff88;">Piso Real: ${formatCoins(market.realisticBin)}</b>`
                        : `<b>Min BIN: ${formatCoins(market.lowestBin)}</b>`
                    }
                                <div style="font-size:10px; color:#8fa0b5;">
                                    ${market.count}${hasMore ? '+' : ''} activas ${market.filterLabel ? `<span style="color:#38bdf8;">(${market.filterLabel})</span>` : ''} | Dif: <span style="color:${diffColor}; font-weight:bold;">${diff >= 0 ? '+' : ''}${diff}</span>
                                </div>
                            </div>
                            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
                                <button class="futgg-btn" style="padding:4px 8px; font-size:12px;" data-action="check-market" data-eaid="${eaId}" title="Actualizar mercado (automático)">🔄</button>
                                <button class="futgg-btn" style="padding:2px 6px; font-size:9px; white-space:nowrap; ${isBreakdownOpen ? 'border-color:#ffaa00; color:#ffaa00;' : ''}" data-action="toggle-breakdown" data-eaid="${eaId}" title="${isBreakdownOpen ? 'Comprimir lista' : 'Ver desglose de precios'}">
                                    ${isBreakdownOpen ? '▲ Comprimir' : `▼ Ver ${market.tiers.length}`}
                                </button>
                            </div>
                        </div>
                        ${breakdownHtml}
                    </div>
                `;
            } else {
                marketHtml = `<button class="futgg-btn primary" style="padding:4px 10px; font-size:11px;" data-action="check-market" data-eaid="${eaId}">Consultar Mercado (V)</button>`;
            }

            // Columna de Precio de Venta
            let priceColHtml = '';
            if (selling) {
                const remainingSec = selling.expiresAt ? Math.max(0, Math.floor((selling.expiresAt - Date.now()) / 1000)) : (selling.expires || 0);
                const timeStr = formatTimeRemaining(remainingSec);
                priceColHtml = `
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div style="font-weight:700; color:#00ff88; font-size:13px;">${formatCoins(selling.buyNow)} <span style="font-size:10px; color:#8fa0b5;">BIN</span></div>
                        <div style="font-size:10px; color:#8fa0b5;">Puja: <b>${formatCoins(calculateStartBid(selling.buyNow))}</b></div>
                        <div style="font-size:10px; color:#00ff88;">Expira: <b>${timeStr}</b></div>
                    </div>
                `;
            } else if (sold || (hasScanned && !inClub && !inTransfer)) {
                priceColHtml = `<span style="font-size:11px; color:#64748b;">-</span>`;
            } else if (inClub && !isItemTradeable(inClub)) {
                priceColHtml = `<div style="font-size:11px; color:#64748b; font-style:italic;">No comerciable</div>`;
            } else {
                priceColHtml = `
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div style="display:flex; align-items:center; gap:4px;">
                            <button class="futgg-btn" style="padding:2px 6px;" data-action="adjust-price" data-dir="-1" data-eaid="${eaId}">-</button>
                            <input type="number" class="futgg-price-input" data-eaid="${eaId}" value="${customPrice}" />
                            <button class="futgg-btn" style="padding:2px 6px;" data-action="adjust-price" data-dir="1" data-eaid="${eaId}">+</button>
                        </div>
                        <div style="font-size:10px; color:#8fa0b5;">
                            Puja: <b style="color:#00ff88;">${formatCoins(calculateStartBid(customPrice))}</b> (1h)
                        </div>
                    </div>
                `;
            }

            // Columna de Acciones disponibles
            let actionHtml = '';
            if (selling) {
                const remainingSec = selling.expiresAt ? Math.max(0, Math.floor((selling.expiresAt - Date.now()) / 1000)) : (selling.expires || 0);
                const timeStr = formatTimeRemaining(remainingSec);
                actionHtml = `
                    <div style="display:flex; gap:4px; align-items:center;">
                        <span class="futgg-tag selling" style="padding:4px 8px; font-size:11px; font-weight:700;">⏱️ Expira: ${timeStr}</span>
                    </div>
                `;
            } else if (inTransfer) {
                actionHtml = `
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button class="futgg-btn primary" style="padding:4px 10px; font-size:11px;" data-action="list" data-eaid="${eaId}" title="Listar en el mercado por el precio elegido">🚀 Listar</button>
                    </div>
                `;
            } else if (inClub && isItemTradeable(inClub)) {
                actionHtml = `
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button class="futgg-btn" style="padding:4px 8px; font-size:11px;" data-action="move" data-eaid="${eaId}" title="Mover a Transferibles">📥 Mover</button>
                        <button class="futgg-btn primary" style="padding:4px 10px; font-size:11px;" data-action="list" data-eaid="${eaId}" title="Listar directamente en el mercado">🚀 Listar</button>
                    </div>
                `;
            } else if (inClub && !isItemTradeable(inClub)) {
                actionHtml = `<span style="font-size:11px; color:#64748b; font-style:italic;">🔒 Intransferible</span>`;
            } else if (sold) {
                actionHtml = `<span style="font-size:11px; color:#64748b;">✅ Ya Vendido</span>`;
            } else if (hasScanned) {
                actionHtml = `<span style="font-size:11px; color:#64748b;">⚪ Fuera de Club</span>`;
            } else {
                actionHtml = `
                    <button class="futgg-btn" style="padding:3px 8px; font-size:10px;" data-action="search-club" data-eaid="${eaId}">🔍 Escanear</button>
                `;
            }

            const isFocused = State.focusedGemId && Number(State.focusedGemId) === eaId;
            const rowClass = `${selling ? 'row-selling' : (sold ? 'row-sold' : '')} ${isFocused ? 'futgg-row-focused' : ''}`.trim();
            html += `
                <tr class="${rowClass}" data-eaid="${eaId}" id="futgg-row-${eaId}">
                    <td>
                        <div class="futgg-player-cell">
                            <span class="futgg-rating">${gem.rating || '---'}</span>
                            <div>
                                <div style="font-weight:700; color:#fff; display:flex; align-items:center; gap:6px;">
                                    <span>${gem.name}</span>
                                    ${selling ? '<span class="futgg-tag selling" style="font-size:10px; font-weight:800; padding:1px 6px;">🚀 EN VENTA</span>' : ''}
                                    ${State.newGemIds && State.newGemIds.has(eaId) ? '<span class="futgg-new-badge">✨ NUEVA</span>' : ''}
                                </div>
                                <div style="font-size:11px; color:#8fa0b5;">${gem.club || 'Club'} (ID: ${eaId})</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="font-weight:700; color:#ffcc00;">${formatCoins(gem.estimatedPrice)}</div>
                        <div style="font-size:10px; color:#00ff88;">+${formatCoins(gem.profit)} benef.</div>
                    </td>
                    <td>${clubStatusHtml}</td>
                    <td>${marketHtml}</td>
                    <td>${priceColHtml}</td>
                    <td>${actionHtml}</td>
                </tr>
            `;
        }

        html += `</tbody></table>`;
        container.innerHTML = html;

        // Mantener foco visual y scroll hacia la carta activa si se reordenó la tabla
        if (State.focusedGemId) {
            const targetRow = container.querySelector(`tr[data-eaid="${State.focusedGemId}"]`);
            if (targetRow) {
                try {
                    targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } catch (e) { }
            }
        }
    }

    // Auto-actualización periódica de tiempos restantes en vivo cada 15s si el panel está visible
    setInterval(() => {
        if (State.isOpen && Object.keys(State.sellingMatches).length > 0) {
            renderGemsTable();
        }
    }, 15000);

    // Exponer globalmente también en window y unsafeWindow
    const win = getAppWindow();
    win.__futggCheckMarket = (id) => {
        const gem = State.gems.find(g => String(g.eaId) === String(id));
        if (gem) checkMarketPrice(gem, false);
    };
    win.__futggMoveToTransfer = (id) => {
        const gem = State.gems.find(g => String(g.eaId) === String(id));
        if (gem) moveToTransferList(gem);
    };
    win.__futggListCard = (id) => {
        const gem = State.gems.find(g => String(g.eaId) === String(id));
        if (gem) listCardOnMarket(gem);
    };

    // Interceptor activo de modales: suprime de inmediato carteles de "Destination full / Lista llena"
    try {
        const dialogObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) {
                        const isDialog = (node.classList && (node.classList.contains('ea-dialog-view') || node.classList.contains('ut-click-shield') || node.classList.contains('dialog-view'))) ||
                            (node.querySelector && node.querySelector('.ea-dialog-view, .dialog-view'));
                        if (isDialog) {
                            const text = (node.textContent || '').toLowerCase();
                            if (text.includes('destination full') ||
                                text.includes('lista de transferibles est') ||
                                text.includes('destino lleno') ||
                                (text.includes('full') && text.includes('transfer'))) {
                                console.warn("[FUT.GG Helper] 🛡️ Suprimiendo de inmediato diálogo falso de EA 'Destination full'");
                                const btn = node.querySelector('.btn-standard, button, .dialog-footer button, .close-btn');
                                if (btn) {
                                    btn.click();
                                } else if (typeof node.remove === 'function') {
                                    node.remove();
                                }
                            }
                        }
                    }
                }
            }
        });
        dialogObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) { }

    // Atajo de teclado global: Alt + G para abrir/cerrar el panel
    window.addEventListener('keydown', function (e) {
        if (e.altKey && (e.key === 'g' || e.key === 'G')) {
            e.preventDefault();
            togglePanel();
        }
    });

    // Inicializar UI e interceptor de sobres cuando la página cargue
    setupPackOpeningListener();

    window.addEventListener('load', () => {
        setTimeout(createUI, 2000);
    });

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(createUI, 2000);
    }

})();
