// ==UserScript==
// @name         FC 27 - FUT.GG Hidden Gems & FUTBIN SBC Helper
// @namespace    https://todout.github.io/FUT.GG-Hidden-Gems/
// @version      1.15.2
// @description  Automatiza el flujo de Hidden Gems de FUT.GG y Soluciones SBC de FUTBIN en la Web App de EA FC 27: detección robusta de SBCs, soporte para Partidos de Marquesina, Spooky Nights, Scary Candy y navegación sin errores.
// @author       todout
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.fut.gg/*
// @match        https://www.futbin.com/*
// @match        https://futbin.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_cookie
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @connect      fut.gg
// @connect      www.fut.gg
// @connect      futbin.com
// @connect      www.futbin.com
// @connect      cdn3.futbin.com
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

    // =========================================================================
    // PARSER UNIVERSAL DE JUGADORES DESDE PLANTILLAS SBC DE FUTBIN
    // =========================================================================
    function parsePlayersFromSquadDoc(doc, htmlText = '', squadIndex = 1) {
        const players = [];
        const seenInThisSquad = new Set();
        let squadData = null;

        // 1. Extraer directamente desde los tags <script> del DOM (si doc fue parseado)
        if (doc && typeof doc.querySelectorAll === 'function') {
            const scripts = Array.from(doc.querySelectorAll('script'));
            for (const s of scripts) {
                const txt = (s.textContent || '').trim();
                if (txt.includes('"squadData"') && txt.includes('"squad"')) {
                    try {
                        const parsed = JSON.parse(txt);
                        if (parsed && parsed.squadData && Array.isArray(parsed.squadData.squad)) {
                            squadData = parsed.squadData;
                            break;
                        }
                    } catch (e) { }
                }
            }
        }

        // 2. Si no se encontró en doc, extraer de htmlText mediante regex de scripts
        if (!squadData && htmlText) {
            const scriptRegex = /<script[^>]*>([\s\S]*?"squadData"[\s\S]*?)<\/script>/gi;
            let match;
            while ((match = scriptRegex.exec(htmlText)) !== null) {
                try {
                    const parsed = JSON.parse(match[1]);
                    if (parsed && parsed.squadData && Array.isArray(parsed.squadData.squad)) {
                        squadData = parsed.squadData;
                        break;
                    }
                } catch (e) { }
            }
        }

        // 3. Procesar datos 100% nativos del JSON estructurado de FUTBIN
        if (squadData && Array.isArray(squadData.squad)) {
            for (const item of squadData.squad) {
                if (!item || (!item.playerName && (!item.statsCard || !item.statsCard.cardname))) continue;

                const name = (item.playerName || item.statsCard?.cardname || '').trim();
                if (!name || name === 'Add Player' || name.includes('Coin')) continue;

                const rating = parseInt(item.statsCard?.rating || item.rating || 0, 10);
                const position = (item.statsCard?.playerPositions?.main || item.statsCard?.position || item.position?.value || '').toUpperCase();
                const futbinId = item.id?.playerCardId?.value || item.baseId?.value || null;

                // Extraer EA Asset ID real de las URLs oficiales de imagen de FUTBIN (/players/{eaId}.png)
                let eaId = null;
                const imgUrls = [
                    item.playerImage?.fixed?.url?.image1x,
                    item.playerImage?.fixed?.url?.image2x,
                    item.statsCard?.playerImages?.playerImage?.fixed?.url?.image1x,
                    item.statsCard?.playerImages?.playerImage?.fixed?.url?.image2x
                ];
                for (const u of imgUrls) {
                    if (typeof u === 'string') {
                        const m = u.match(/\/players\/(\d+)\.png/i);
                        if (m) {
                            eaId = Number(m[1]);
                            break;
                        }
                    }
                }

                if (!eaId && item.eaId) eaId = Number(item.eaId);
                if (!eaId && item.resourceId) eaId = Number(item.resourceId);
                if (!eaId && item.defId) eaId = Number(item.defId);
                if (!eaId && futbinId && futbinId >= 50000) eaId = futbinId;

                const uniqueKey = eaId || futbinId || name;
                if (!uniqueKey || seenInThisSquad.has(uniqueKey)) continue;
                seenInThisSquad.add(uniqueKey);

                // Precio exacto reportado por FUTBIN para la plataforma (PlayStation/PC)
                const futbinPrice = parseInt(item.priceCard?.priceData?.psPrice || item.priceCard?.priceData?.pcPrice || item.priceCard?.priceData?.price || 0, 10);
                const quality = (rating > 0 && rating <= 64) ? 'bronze' : ((rating > 0 && rating <= 74) ? 'silver' : 'gold');
                const estimatedPrice = futbinPrice > 0 ? futbinPrice : (quality === 'bronze' ? 200 : (quality === 'silver' ? 350 : 700));

                players.push({
                    eaId: eaId || futbinId,
                    realEaId: eaId,
                    futbinId: futbinId,
                    name: name,
                    rating: rating,
                    position: position,
                    quality: quality,
                    futbinPrice: futbinPrice,
                    estimatedPrice: estimatedPrice,
                    squadIndex: squadIndex
                });
            }
        }

        // 4. Fallback ÚNICAMENTE a contenedores #cardlid1..11 si el JSON no estuviera disponible (ej. DOM completamente hidratado en vivo)
        if (players.length === 0 && doc && typeof doc.querySelectorAll === 'function') {
            const cardContainers = Array.from(doc.querySelectorAll('#cardlid1, #cardlid2, #cardlid3, #cardlid4, #cardlid5, #cardlid6, #cardlid7, #cardlid8, #cardlid9, #cardlid10, #cardlid11'));
            for (const el of cardContainers) {
                const nameEl = el.querySelector('.playercard-27-name, .card-name, .pcdisplay-name');
                let name = (nameEl ? nameEl.textContent : '').trim().split('\n')[0].trim();
                if (!name || name.includes('Coin') || name === 'Add Player') continue;

                let eaId = null;
                let futbinId = null;
                const link = el.querySelector('a[href*="/player/"]');
                if (link && link.href) {
                    const mLink = link.href.match(/\/player\/(\d+)/i);
                    if (mLink) futbinId = Number(mLink[1]);
                }

                const allImgs = Array.from(el.querySelectorAll('img, .playercard-27-base-img, [style*="/players/"]'));
                for (const im of allImgs) {
                    const attrs = [im.getAttribute('src'), im.getAttribute('data-src'), im.getAttribute('srcset'), im.src, im.style ? im.style.backgroundImage : null];
                    for (const attr of attrs) {
                        if (attr) {
                            const m = attr.match(/\/players\/(\d+)\.png/i);
                            if (m) {
                                eaId = Number(m[1]);
                                break;
                            }
                        }
                    }
                    if (eaId) break;
                }

                if (!eaId && futbinId && futbinId >= 50000) eaId = futbinId;
                const uniqueKey = eaId || futbinId || name;
                if (!uniqueKey || seenInThisSquad.has(uniqueKey)) continue;
                seenInThisSquad.add(uniqueKey);

                const ratingEl = el.querySelector('.playercard-27-rating, .card-rating, .pcdisplay-rat');
                let rating = 0;
                if (ratingEl) {
                    const rMatch = ratingEl.textContent.match(/\d+/);
                    if (rMatch) rating = parseInt(rMatch[0], 10);
                }

                const posEl = el.querySelector('.playercard-27-position, .card-position, .pcdisplay-pos');
                const position = posEl ? posEl.textContent.trim().toUpperCase() : '';

                const priceEl = el.querySelector('.price-segment, .player-price, .platform-price-wrapper-small, .price');
                let futbinPrice = 0;
                if (priceEl) {
                    const pText = priceEl.textContent.replace(/,/g, '').replace(/🪙/g, '').trim();
                    const pMatch = pText.match(/(\d+(\.\d+)?[kKmM]?)/);
                    if (pMatch) {
                        const rawVal = pMatch[1].toLowerCase();
                        if (rawVal.endsWith('k')) futbinPrice = Math.round(parseFloat(rawVal) * 1000);
                        else if (rawVal.endsWith('m')) futbinPrice = Math.round(parseFloat(rawVal) * 1000000);
                        else futbinPrice = parseInt(rawVal, 10);
                    }
                }

                const quality = (rating > 0 && rating <= 64) ? 'bronze' : ((rating > 0 && rating <= 74) ? 'silver' : 'gold');
                const estimatedPrice = futbinPrice > 0 ? futbinPrice : (quality === 'bronze' ? 200 : (quality === 'silver' ? 350 : 700));

                players.push({
                    eaId: eaId || futbinId,
                    realEaId: eaId,
                    futbinId: futbinId,
                    name: name,
                    rating: rating,
                    position: position,
                    quality: quality,
                    futbinPrice: futbinPrice,
                    estimatedPrice: estimatedPrice,
                    squadIndex: squadIndex
                });
            }
        }

        return players;
    }

    // =========================================================================
    // SI ESTAMOS EN FUTBIN.COM: EXTRACCIÓN Y SINCRONIZACIÓN DE SOLUCIONES SBC
    // =========================================================================
    if (window.location.hostname.includes('futbin.com')) {
        function initFutbinSbcModule() {
            if (window.__futbinSbcInitialized || document.getElementById('futbin-sbc-widget')) return;
            window.__futbinSbcInitialized = true;

            console.log("%c[FC 27 Helper] 🧩 Módulo FUTBIN SBC activo en:", "color:#00ff88; font-weight:bold;", window.location.href);

            // Inyectar estilos para el widget flotante en FUTBIN
            const style = document.createElement('style');
            style.id = 'futbin-sbc-helper-styles';
            style.innerHTML = `
                #futbin-sbc-widget {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 999999;
                    background: linear-gradient(135deg, rgba(14, 22, 33, 0.98), rgba(20, 31, 46, 0.98));
                    border: 2px solid #00ff88;
                    border-radius: 14px;
                    padding: 14px 18px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 255, 136, 0.35);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    color: #ffffff;
                    max-width: 380px;
                    backdrop-filter: blur(12px);
                    user-select: none;
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                #futbin-sbc-widget.auto-sync-centered {
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    transform: translate(-50%, -50%) !important;
                    z-index: 99999999 !important;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.95), 0 0 40px rgba(0, 255, 136, 0.5) !important;
                }
                #futbin-sbc-widget:hover {
                    box-shadow: 0 12px 45px rgba(0, 0, 0, 0.9), 0 0 25px rgba(0, 255, 136, 0.5);
                    border-color: #33ff9f;
                }
                .futbin-sbc-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    margin-bottom: 10px;
                }
                .futbin-sbc-title {
                    font-size: 13px;
                    font-weight: 800;
                    color: #00ff88;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .futbin-sbc-badge {
                    background: rgba(0, 255, 136, 0.18);
                    color: #00ff88;
                    border: 1px solid #00ff88;
                    border-radius: 6px;
                    padding: 1px 6px;
                    font-size: 10px;
                    font-weight: 800;
                }
                .futbin-sbc-content {
                    font-size: 12px;
                    color: #cbd5e1;
                    margin-bottom: 12px;
                    line-height: 1.4;
                }
                .futbin-sbc-controls {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 10px;
                }
                .futbin-sbc-select {
                    background: #111a26;
                    border: 1px solid #2d3f55;
                    color: #fff;
                    padding: 6px 10px;
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    outline: none;
                }
                .futbin-sbc-select:focus {
                    border-color: #00ff88;
                }
                .futbin-sbc-btn {
                    background: #00ff88;
                    color: #0c1218;
                    border: 1px solid #00ff88;
                    padding: 8px 14px;
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 800;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.2s;
                    text-decoration: none;
                }
                .futbin-sbc-btn:hover {
                    background: #2aff9f;
                    box-shadow: 0 0 15px rgba(0, 255, 136, 0.5);
                    transform: translateY(-1px);
                }
                .futbin-sbc-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    transform: none;
                    box-shadow: none;
                }
                .futbin-sbc-btn.secondary {
                    background: #1b2636;
                    color: #00ccff;
                    border-color: #00ccff;
                }
                .futbin-sbc-btn.secondary:hover {
                    background: #24354c;
                    box-shadow: 0 0 12px rgba(0, 204, 255, 0.4);
                }
                .futbin-sbc-progress {
                    margin-top: 8px;
                    font-size: 11px;
                    color: #ffaa00;
                    font-weight: 600;
                    display: none;
                }
            `;
            document.head.appendChild(style);

            const pathLower = window.location.pathname.toLowerCase();
            const isChallengePage = pathLower.includes('/squad-building-challenge') || pathLower.includes('/squad-building-challenges');
            const isIndividualSquad = /\/27\/squad\/\d+/i.test(pathLower);

            // Recolectar desafíos de la página de FUTBIN para el catálogo del selector en Web App
            if (isChallengePage) {
                try {
                    const anchors = Array.from(document.querySelectorAll('a[href*="/squad-building-challenges/Challenges/"], a[href*="/Challenges/"], a[href*="/challenges/"]'));
                    if (anchors.length > 0) {
                        const catalog = GM_getValue('futbin_sbc_catalog', []);
                        let added = 0;
                        for (const a of anchors) {
                            const rawHref = a.getAttribute('href') || a.href;
                            if (!rawHref || !rawHref.includes('/Challenges/')) continue;
                            const fullUrl = rawHref.startsWith('http') ? rawHref : `https://www.futbin.com${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;
                            const cleanUrl = fullUrl.split('?')[0].split('#')[0];
                            if (cleanUrl.toLowerCase().includes('/challenges/home') || cleanUrl.toLowerCase().endsWith('/home')) continue;
                            const nameEl = a.querySelector('.challenge-name, .sbc-name, h4, h5, span') || a;
                            let name = (nameEl.textContent || '').trim().replace(/\s+/g, ' ').replace(/sbc/i, '').trim();
                            if (name && name.length >= 2 && !catalog.some(c => c.url.toLowerCase() === cleanUrl.toLowerCase())) {
                                catalog.push({ title: name, url: cleanUrl });
                                added++;
                            }
                        }
                        if (added > 0) {
                            GM_setValue('futbin_sbc_catalog', catalog);
                            console.log(`[FC 27 Helper] 📚 Se agregaron ${added} desafíos al catálogo de FUTBIN.`);
                        }
                    }
                } catch (e) { }
            }

            if (!isChallengePage && !isIndividualSquad) {
                return;
            }

            function getChallengeTitle() {
                if (isIndividualSquad) {
                    const breadcrumb = document.querySelector('.breadcrumb, .sbc-title, h1');
                    return (breadcrumb && breadcrumb.textContent.trim()) || document.title.replace('| FUTBIN', '').trim();
                }
                const h1 = document.querySelector('h1, .challenge-name, .sbc-header-title');
                if (h1 && h1.textContent.trim()) {
                    return h1.textContent.replace(/sbc/i, '').trim();
                }
                const docTitle = document.title || '';
                const match = docTitle.match(/CHALLENGES\s*-\s*([^|]+)/i) || docTitle.match(/([^|]+)\|\s*FUTBIN/i);
                return (match && match[1].trim()) || 'SBC Challenge';
            }

            function getSolutionUrls(limit = 5) {
                if (isIndividualSquad) {
                    return [window.location.href];
                }
                const allLinks = Array.from(document.querySelectorAll('a[href*="/27/squad/"][href*="/sbc"], a[href*="/27/squad/"]'))
                    .map(a => a.href)
                    .filter(href => /\/27\/squad\/\d+/.test(href));

                const uniqueUrls = [];
                for (const rawUrl of allLinks) {
                    const cleanUrl = rawUrl.split('?')[0].split('#')[0];
                    const sbcUrl = cleanUrl.endsWith('/sbc') ? cleanUrl : cleanUrl + '/sbc';
                    if (!uniqueUrls.includes(sbcUrl)) {
                        uniqueUrls.push(sbcUrl);
                    }
                }
                return uniqueUrls.slice(0, limit);
            }

            async function waitForSolutionUrls(limit = 5, maxWaitMs = 8000) {
                const start = Date.now();
                while (Date.now() - start < maxWaitMs) {
                    const urls = getSolutionUrls(limit);
                    if (urls.length > 0) return urls;
                    await new Promise(r => setTimeout(r, 350));
                }
                return getSolutionUrls(limit);
            }

            function parsePlayersFromSquadDoc(doc, htmlText = '', squadIndex = 1) {
                const players = [];
                const seenInThisSquad = new Set();
                let squadData = null;

                // 1. Extraer directamente desde los tags <script> del DOM (si doc fue parseado)
                if (doc && typeof doc.querySelectorAll === 'function') {
                    const scripts = Array.from(doc.querySelectorAll('script'));
                    for (const s of scripts) {
                        const txt = (s.textContent || '').trim();
                        if (txt.includes('"squadData"') && txt.includes('"squad"')) {
                            try {
                                const parsed = JSON.parse(txt);
                                if (parsed && parsed.squadData && Array.isArray(parsed.squadData.squad)) {
                                    squadData = parsed.squadData;
                                    break;
                                }
                            } catch (e) { }
                        }
                    }
                }

                // 2. Si no se encontró en doc, extraer de htmlText mediante regex de scripts
                if (!squadData && htmlText) {
                    const scriptRegex = /<script[^>]*>([\s\S]*?"squadData"[\s\S]*?)<\/script>/gi;
                    let match;
                    while ((match = scriptRegex.exec(htmlText)) !== null) {
                        try {
                            const parsed = JSON.parse(match[1]);
                            if (parsed && parsed.squadData && Array.isArray(parsed.squadData.squad)) {
                                squadData = parsed.squadData;
                                break;
                            }
                        } catch (e) { }
                    }
                }

                // 3. Procesar datos 100% nativos del JSON estructurado de FUTBIN
                if (squadData && Array.isArray(squadData.squad)) {
                    for (const item of squadData.squad) {
                        if (!item || (!item.playerName && (!item.statsCard || !item.statsCard.cardname))) continue;

                        const name = (item.playerName || item.statsCard?.cardname || '').trim();
                        if (!name || name === 'Add Player' || name.includes('Coin')) continue;

                        const rating = parseInt(item.statsCard?.rating || item.rating || 0, 10);
                        const position = (item.statsCard?.playerPositions?.main || item.statsCard?.position || item.position?.value || '').toUpperCase();
                        const futbinId = item.id?.playerCardId?.value || item.baseId?.value || null;

                        // Extraer EA Asset ID real de las URLs oficiales de imagen de FUTBIN (/players/{eaId}.png)
                        let eaId = null;
                        const imgUrls = [
                            item.playerImage?.fixed?.url?.image1x,
                            item.playerImage?.fixed?.url?.image2x,
                            item.statsCard?.playerImages?.playerImage?.fixed?.url?.image1x,
                            item.statsCard?.playerImages?.playerImage?.fixed?.url?.image2x
                        ];
                        for (const u of imgUrls) {
                            if (typeof u === 'string') {
                                const m = u.match(/\/players\/(\d+)\.png/i);
                                if (m) {
                                    eaId = Number(m[1]);
                                    break;
                                }
                            }
                        }

                        if (!eaId && item.eaId) eaId = Number(item.eaId);
                        if (!eaId && item.resourceId) eaId = Number(item.resourceId);
                        if (!eaId && item.defId) eaId = Number(item.defId);
                        if (!eaId && futbinId && futbinId >= 50000) eaId = futbinId;

                        const uniqueKey = eaId || futbinId || name;
                        if (!uniqueKey || seenInThisSquad.has(uniqueKey)) continue;
                        seenInThisSquad.add(uniqueKey);

                        // Precio exacto reportado por FUTBIN para la plataforma (PlayStation/PC)
                        const futbinPrice = parseInt(item.priceCard?.priceData?.psPrice || item.priceCard?.priceData?.pcPrice || item.priceCard?.priceData?.price || 0, 10);
                        const quality = (rating > 0 && rating <= 64) ? 'bronze' : ((rating > 0 && rating <= 74) ? 'silver' : 'gold');
                        const estimatedPrice = futbinPrice > 0 ? futbinPrice : (quality === 'bronze' ? 200 : (quality === 'silver' ? 350 : 700));

                        players.push({
                            eaId: eaId || futbinId,
                            realEaId: eaId,
                            futbinId: futbinId,
                            name: name,
                            rating: rating,
                            position: position,
                            quality: quality,
                            futbinPrice: futbinPrice,
                            estimatedPrice: estimatedPrice,
                            squadIndex: squadIndex
                        });
                    }
                }

                // 4. Fallback ÚNICAMENTE a contenedores #cardlid1..11 si el JSON no estuviera disponible (ej. DOM completamente hidratado en vivo)
                // NUNCA buscar en a[href*="/player/"] a nivel global para no capturar jugadores del sidebar / trending como Huerta
                if (players.length === 0 && doc && typeof doc.querySelectorAll === 'function') {
                    const cardContainers = Array.from(doc.querySelectorAll('#cardlid1, #cardlid2, #cardlid3, #cardlid4, #cardlid5, #cardlid6, #cardlid7, #cardlid8, #cardlid9, #cardlid10, #cardlid11'));
                    for (const el of cardContainers) {
                        const nameEl = el.querySelector('.playercard-27-name, .card-name, .pcdisplay-name');
                        let name = (nameEl ? nameEl.textContent : '').trim().split('\n')[0].trim();
                        if (!name || name.includes('Coin') || name === 'Add Player') continue;

                        let eaId = null;
                        let futbinId = null;
                        const link = el.querySelector('a[href*="/player/"]');
                        if (link && link.href) {
                            const mLink = link.href.match(/\/player\/(\d+)/i);
                            if (mLink) futbinId = Number(mLink[1]);
                        }

                        const allImgs = Array.from(el.querySelectorAll('img, .playercard-27-base-img, [style*="/players/"]'));
                        for (const im of allImgs) {
                            const attrs = [im.getAttribute('src'), im.getAttribute('data-src'), im.getAttribute('srcset'), im.src, im.style ? im.style.backgroundImage : null];
                            for (const attr of attrs) {
                                if (attr) {
                                    const m = attr.match(/\/players\/(\d+)\.png/i);
                                    if (m) {
                                        eaId = Number(m[1]);
                                        break;
                                    }
                                }
                            }
                            if (eaId) break;
                        }

                        if (!eaId && futbinId && futbinId >= 50000) eaId = futbinId;
                        const uniqueKey = eaId || futbinId || name;
                        if (!uniqueKey || seenInThisSquad.has(uniqueKey)) continue;
                        seenInThisSquad.add(uniqueKey);

                        const ratingEl = el.querySelector('.playercard-27-rating, .card-rating, .pcdisplay-rat');
                        let rating = 0;
                        if (ratingEl) {
                            const rMatch = ratingEl.textContent.match(/\d+/);
                            if (rMatch) rating = parseInt(rMatch[0], 10);
                        }

                        const posEl = el.querySelector('.playercard-27-position, .card-position, .pcdisplay-pos');
                        const position = posEl ? posEl.textContent.trim().toUpperCase() : '';

                        const priceEl = el.querySelector('.price-segment, .player-price, .platform-price-wrapper-small, .price');
                        let futbinPrice = 0;
                        if (priceEl) {
                            const pText = priceEl.textContent.replace(/,/g, '').replace(/🪙/g, '').trim();
                            const pMatch = pText.match(/(\d+(\.\d+)?[kKmM]?)/);
                            if (pMatch) {
                                const rawVal = pMatch[1].toLowerCase();
                                if (rawVal.endsWith('k')) futbinPrice = Math.round(parseFloat(rawVal) * 1000);
                                else if (rawVal.endsWith('m')) futbinPrice = Math.round(parseFloat(rawVal) * 1000000);
                                else futbinPrice = parseInt(rawVal, 10);
                            }
                        }

                        const quality = (rating > 0 && rating <= 64) ? 'bronze' : ((rating > 0 && rating <= 74) ? 'silver' : 'gold');
                        const estimatedPrice = futbinPrice > 0 ? futbinPrice : (quality === 'bronze' ? 200 : (quality === 'silver' ? 350 : 700));

                        players.push({
                            eaId: eaId || futbinId,
                            realEaId: eaId,
                            futbinId: futbinId,
                            name: name,
                            rating: rating,
                            position: position,
                            quality: quality,
                            futbinPrice: futbinPrice,
                            estimatedPrice: estimatedPrice,
                            squadIndex: squadIndex
                        });
                    }
                }

                return players;
            }

            const challengeTitle = getChallengeTitle();
            const widget = document.createElement('div');
            widget.id = 'futbin-sbc-widget';
            widget.innerHTML = `
                <div class="futbin-sbc-header">
                    <div class="futbin-sbc-title">
                        <span>🧩 FC 27 SBC Helper</span>
                        <span class="futbin-sbc-badge">Web App Sync</span>
                    </div>
                    <button id="futbin-sbc-close-btn" style="background:transparent; border:none; color:#8fa0b5; cursor:pointer; font-size:16px;">&times;</button>
                </div>
                <div class="futbin-sbc-content">
                    SBC: <b style="color:#00ff88;">${challengeTitle}</b><br/>
                    <span style="font-size:11px; color:#8fa0b5;">Extrae jugadores requeridos (bronces y platas caros) y envíalos a la Web App para buscar en tu club.</span>
                </div>
                <div class="futbin-sbc-controls" id="futbin-sbc-controls-row">
                    ${!isIndividualSquad ? `
                        <label style="font-size:11px; color:#8fa0b5;">Top:</label>
                        <select id="futbin-sbc-count-select" class="futbin-sbc-select">
                            <option value="1">1 Solución</option>
                            <option value="3">3 Soluciones</option>
                            <option value="5" selected>5 Soluciones (Default)</option>
                            <option value="10">10 Soluciones</option>
                        </select>
                    ` : ''}
                    <button class="futbin-sbc-btn" id="futbin-sbc-sync-btn">
                        <span>⚡ Enviar a Web App</span>
                    </button>
                </div>
                <div id="futbin-sbc-progress" class="futbin-sbc-progress">Analizando soluciones...</div>
                <div id="futbin-sbc-result" style="display:none; margin-top:8px; font-size:11px; color:#00ff88; line-height:1.4;"></div>
            `;
            document.body.appendChild(widget);

            document.getElementById('futbin-sbc-close-btn').addEventListener('click', () => widget.remove());

            const syncBtn = document.getElementById('futbin-sbc-sync-btn');
            const progressEl = document.getElementById('futbin-sbc-progress');
            const resultEl = document.getElementById('futbin-sbc-result');
            const countSelect = document.getElementById('futbin-sbc-count-select');

            async function extractAndSyncSbcSolutions(count, isAutoSync = false) {
                if (syncBtn) syncBtn.disabled = true;
                const controlsRow = document.getElementById('futbin-sbc-controls-row');
                if (isAutoSync) {
                    widget.classList.add('auto-sync-centered');
                    if (controlsRow) controlsRow.style.display = 'none';
                }
                if (progressEl) {
                    progressEl.style.display = 'block';
                    progressEl.innerHTML = `<span style="font-size:13px; font-weight:800; color:#00ccff;">🧩 Sincronizando con EA Web App...</span><br/><span id="futbin-sbc-substatus" style="font-size:11px; color:#cbd5e1;">Buscando ${count} soluciones...</span>`;
                }
                if (resultEl) resultEl.style.display = 'none';

                try {
                    let solutionUrls = await waitForSolutionUrls(count);
                    if (solutionUrls.length === 0) {
                        // Comprobar si estamos en una página de grupo (ej. Marquesinas /59)
                        const subLinks = Array.from(document.querySelectorAll('a[href*="/Challenges/"], a[href*="/challenges/"]'));
                        for (const a of subLinks) {
                            const raw = a.getAttribute('href') || a.href;
                            if (raw && raw.includes('/Challenges/')) {
                                const full = raw.startsWith('http') ? raw : `https://www.futbin.com${raw.startsWith('/') ? '' : '/'}${raw}`;
                                const targetFirstUrl = `${full.split('?')[0].split('#')[0]}#fc27_auto_sync=${count}`;
                                console.log(`[FC 27 Helper] 🔀 Redirigiendo desde grupo a desafío individual: ${targetFirstUrl}`);
                                if (progressEl) {
                                    progressEl.innerHTML = `<span style="color:#00ccff; font-size:12px;">Página de grupo detectada. Abriendo primer desafío...</span>`;
                                }
                                window.location.href = targetFirstUrl;
                                return;
                            }
                        }
                        throw new Error("No se encontraron soluciones en esta página de FUTBIN.");
                    }

                    const subStatus = document.getElementById('futbin-sbc-substatus') || progressEl;
                    subStatus.textContent = `Descargando soluciones (0/${solutionUrls.length})...`;

                    const playerMap = new Map();
                    const parser = new DOMParser();

                    for (let i = 0; i < solutionUrls.length; i++) {
                        const url = solutionUrls[i];
                        if (subStatus) subStatus.textContent = `Descargando solución ${i + 1}/${solutionUrls.length}...`;

                        let doc = null;
                        let html = '';
                        if (isIndividualSquad && i === 0) {
                            doc = document;
                            html = document.documentElement ? document.documentElement.outerHTML : '';
                        } else {
                            const resp = await fetch(url, { credentials: 'include' });
                            if (!resp.ok) {
                                console.warn(`[FUTBIN SBC Helper] HTTP ${resp.status} al descargar solución: ${url}`);
                                continue;
                            }
                            html = await resp.text();
                            doc = parser.parseFromString(html, 'text/html');
                        }

                        const squadPlayers = parsePlayersFromSquadDoc(doc, html, i + 1);
                        for (const p of squadPlayers) {
                            if (!playerMap.has(p.eaId)) {
                                playerMap.set(p.eaId, {
                                    eaId: p.eaId,
                                    name: p.name,
                                    rating: p.rating,
                                    position: p.position,
                                    quality: p.quality,
                                    futbinPrice: p.futbinPrice,
                                    estimatedPrice: p.futbinPrice || (p.quality === 'bronze' ? 200 : (p.quality === 'silver' ? 350 : 700)),
                                    frequency: 1,
                                    solutions: [i + 1],
                                    squadUrl: url
                                });
                            } else {
                                const existing = playerMap.get(p.eaId);
                                existing.frequency += 1;
                                if (!existing.solutions.includes(i + 1)) {
                                    existing.solutions.push(i + 1);
                                }
                                if (p.futbinPrice > 0 && (!existing.futbinPrice || p.futbinPrice > existing.futbinPrice)) {
                                    existing.futbinPrice = p.futbinPrice;
                                    existing.estimatedPrice = p.futbinPrice;
                                }
                            }
                        }

                        if (i < solutionUrls.length - 1) {
                            await new Promise(r => setTimeout(r, 350));
                        }
                    }

                    const aggregatedPlayers = Array.from(playerMap.values());
                    aggregatedPlayers.sort((a, b) => {
                        if (b.frequency !== a.frequency) return b.frequency - a.frequency;
                        const qPrio = { 'bronze': 1, 'silver': 2, 'gold': 3 };
                        const qA = qPrio[a.quality] || 4;
                        const qB = qPrio[b.quality] || 4;
                        if (qA !== qB) return qA - qB;
                        return a.rating - b.rating;
                    });

                    const payload = {
                        challengeTitle: challengeTitle,
                        challengeUrl: window.location.href.split('#')[0],
                        solutionCount: count,
                        totalSolutionsFound: solutionUrls.length,
                        players: aggregatedPlayers,
                        updatedAt: Date.now()
                    };

                    GM_setValue('futbin_sbc_data', payload);
                    GM_setValue('futbin_sbc_sync_time', Date.now());
                    console.log("%c[FC 27 Helper] 💾 Soluciones SBC sincronizadas con éxito:", "color:#00ff88; font-weight:bold;", payload);

                    if (progressEl) progressEl.style.display = 'none';
                    if (resultEl) {
                        resultEl.style.display = 'block';
                        resultEl.innerHTML = `
                            ✅ <b>¡${aggregatedPlayers.length} jugadores extraídos!</b><br/>
                            Analizadas <b>${solutionUrls.length} soluciones</b>.<br/>
                            ${isAutoSync ? '<span style="color:#00ff88; font-size:11px; margin-top:4px; display:inline-block;">Sincronizado con éxito. Cerrando pestaña en 2s...</span>' : ''}
                            <a href="https://www.ea.com/ea-sports-fc/ultimate-team/web-app/" target="_blank" class="futbin-sbc-btn secondary" style="display:inline-flex; margin-top:8px; padding:5px 10px; font-size:11px;">
                                🚀 Abrir EA Web App & Buscar
                            </a>
                        `;
                    }

                    if (isAutoSync) {
                        setTimeout(() => {
                            try { window.close(); } catch (e) { }
                        }, 1800);
                    }
                } catch (err) {
                    console.error("[FUTBIN SBC Helper] Error:", err);
                    if (controlsRow) controlsRow.style.display = 'flex';
                    if (progressEl) progressEl.style.display = 'none';
                    if (resultEl) {
                        resultEl.style.display = 'block';
                        resultEl.style.color = '#ff4444';
                        resultEl.textContent = `❌ Error: ${err.message}`;
                    }
                } finally {
                    if (syncBtn) syncBtn.disabled = false;
                }
            }

            syncBtn.addEventListener('click', () => {
                const count = countSelect ? parseInt(countSelect.value, 10) : 1;
                extractAndSyncSbcSolutions(count, false);
            });

            // Si se detecta el hash de sincronización automática desde la Web App
            const autoSyncMatch = window.location.hash.match(/fc27_auto_sync=(\d+)/);
            if (autoSyncMatch) {
                const autoCount = parseInt(autoSyncMatch[1], 10) || 5;
                console.log(`[FC 27 Helper] 🚀 Auto-sync detectado desde EA Web App para ${autoCount} soluciones.`);
                setTimeout(() => {
                    extractAndSyncSbcSolutions(autoCount, true);
                }, 500);
            }
        }

        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(initFutbinSbcModule, 400);
        } else {
            window.addEventListener('DOMContentLoaded', () => setTimeout(initFutbinSbcModule, 400));
            window.addEventListener('load', () => setTimeout(initFutbinSbcModule, 800));
        }
        return; // No ejecutar la UI de la Web App en la web de futbin.com
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

    function randomDelay(min, max, cancelCheck = null) {
        const total = min + Math.random() * (max - min);
        return new Promise(resolve => {
            const interval = 80;
            let elapsed = 0;
            const timer = setInterval(() => {
                elapsed += interval;
                if (elapsed >= total || (cancelCheck && cancelCheck()) || State.forceCancelAllOperations) {
                    clearInterval(timer);
                    resolve();
                }
            }, interval);
        });
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
            criteria.maskedDefId = numId;
            criteria.defId = [];
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
        if (res.response && Array.isArray(res.response.auctionInfo)) return res.response.auctionInfo;
        if (res.data && Array.isArray(res.data.auctionInfo)) return res.data.auctionInfo;
        if (Array.isArray(res.auctionInfo)) return res.auctionInfo;
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
                                const errObj = response.error || {};
                                const msg = errObj.message || errObj.reason || response.statusText || (typeof errObj === 'string' ? errObj : "Error en servicio de EA");
                                const errorInstance = new Error(msg);
                                if (typeof errObj === 'object') Object.assign(errorInstance, errObj);
                                reject(errorInstance);
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
        activeTab: 'futgg',    // 'futgg' | 'futbin'
        futbinSbcData: null,   // Datos de soluciones SBC cargadas de FUTBIN
        futbinFilterOnlyBronzeSilver: true, // Filtro prioritario: sólo bronces y platas
        futbinFilterOnlyInClub: false, // Por defecto mostrar todas las cartas del SBC (se puede filtrar a sólo en club)
        futbinFilterHideMinimum: false, // Por defecto ver todas las cartas (no ocultar automáticamente)
        futbinSolutionsCount: 5, // Cantidad de soluciones analizadas por defecto (5)
        gems: [],              // Lista de cartas de FUT.GG
        clubMatches: {},       // eaId -> ItemData del club
        clubScanned: {},       // eaId -> boolean (si la carta ya fue buscada en el club en esta sesión)
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
        isScanningClub: false,
        forceCancelAllOperations: false,
        batchStatusText: '',
        searchCountSession: 0,
        lastSyncTimestamp: 0,
        nextSyncTimestamp: 0,
        newGemIds: new Set(),
        autoSyncTimer: null,
        syncCountdownInterval: null
    };

    const DEFAULT_FUTBIN_SBC_CATALOG = [
        // Spooky Nights y Scary Candy
        { group: "🎃 Eventos y Puzzles", title: "🎃 Spooky Nights", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/112/spooky-nights" },
        { group: "🎃 Eventos y Puzzles", title: "🎃 Scary Candy", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/113/scary-candy" },

        // Partidos de Marquesina (Marquee Matchups - Grupo 59 y sus 4 desafíos completos)
        { group: "⚽ Partidos de Marquesina", title: "⚽ Marquesina (Grupo Completo / 4 Desafíos)", url: "https://www.futbin.com/27/squad-building-challenge/59" },
        { group: "⚽ Partidos de Marquesina", title: "⚽ Marquesina 1: PSG v Olympique Lyonnais", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/96/psg-v-olympique-lyonnais" },
        { group: "⚽ Partidos de Marquesina", title: "⚽ Marquesina 2: SSC Napoli v AS Roma", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/97/ssc-napoli-v-as-roma" },
        { group: "⚽ Partidos de Marquesina", title: "⚽ Marquesina 3: Chelsea v Tottenham Hotspur", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/98/chelsea-v-tottenham-hotspur" },
        { group: "⚽ Partidos de Marquesina", title: "⚽ Marquesina 4: FC Barcelona v Real Madrid", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/99/fc-barcelona-v-real-madrid" },

        // Intro to Upgrade SBCs (Fundaciones / Mejoras fijas - otorgan sobres)
        { group: "📦 Intro to Upgrade SBCs", title: "📦 Intro to Upgrade: Room to Grow", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/13/room-to-grow" },
        { group: "📦 Intro to Upgrade SBCs", title: "📦 Intro to Upgrade: Build Up Play", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/14/build-up-play" },
        { group: "📦 Intro to Upgrade SBCs", title: "📦 Intro to Upgrade: Raw Power", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/15/raw-power" },

        // Híbrido de Ligas (Hybrid Leagues - 4 desafíos individuales)
        { group: "🧩 Híbrido de Ligas (Hybrid Leagues)", title: "🧩 Híbrido de Ligas: Give Me Five", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/1/give-me-five" },
        { group: "🧩 Híbrido de Ligas (Hybrid Leagues)", title: "🧩 Híbrido de Ligas: Seven-League Boots", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/2/seven-league-boots" },
        { group: "🧩 Híbrido de Ligas (Hybrid Leagues)", title: "🧩 Híbrido de Ligas: The Whole Nine Yards", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/3/the-whole-nine-yards" },
        { group: "🧩 Híbrido de Ligas (Hybrid Leagues)", title: "🧩 Híbrido de Ligas: First XI", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/4/first-xi" },

        // Híbrido de Países (Hybrid Nations - 4 desafíos individuales)
        { group: "🌍 Híbrido de Países (Hybrid Nations)", title: "🌍 Híbrido de Países: The Final Four", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/5/the-final-four" },
        { group: "🌍 Híbrido de Países (Hybrid Nations)", title: "🌍 Híbrido de Países: Six of the Best", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/6/six-of-the-best" },
        { group: "🌍 Híbrido de Países (Hybrid Nations)", title: "🌍 Híbrido de Países: Elite Eight", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/7/elite-eight" },
        { group: "🌍 Híbrido de Países (Hybrid Nations)", title: "🌍 Híbrido de Países: Around the World", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/8/around-the-world" },

        // League & Nation Advanced (Híbrido Liga y País - 4 desafíos individuales)
        { group: "⚔️ League & Nation Advanced", title: "⚔️ League & Nation: The Challenger", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/9/the-challenger" },
        { group: "⚔️ League & Nation Advanced", title: "⚔️ League & Nation: Advanced", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/10/advanced" },
        { group: "⚔️ League & Nation Advanced", title: "⚔️ League & Nation: Fiendish", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/11/fiendish" },
        { group: "⚔️ League & Nation Advanced", title: "⚔️ League & Nation: Master Puzzle", url: "https://www.futbin.com/27/squad-building-challenges/Challenges/12/master-puzzle" }
    ];

    function getFutbinSbcCatalog() {
        try {
            const saved = GM_getValue('futbin_sbc_catalog', null);
            let merged = [];
            if (Array.isArray(saved) && saved.length > 0) {
                // Filtrar entradas huérfanas o con URLs obsoletas/erróneas (incluyendo /home o 98/99 sin slug)
                merged = saved.filter(m => m && m.url &&
                    !m.url.toLowerCase().includes('/challenges/home') &&
                    !m.url.toLowerCase().endsWith('/home') &&
                    !m.url.includes('/squad-building-challenge/ea/') &&
                    !m.url.includes('/72/Spooky') &&
                    !m.url.includes('/72/spooky') &&
                    !m.url.includes('/Challenges/59') &&
                    !m.url.includes('/Challenges/60') &&
                    !m.url.endsWith('/60') &&
                    !m.url.endsWith('/Challenges/98') &&
                    !m.url.endsWith('/Challenges/99') &&
                    !m.url.endsWith('/squad-building-challenges/Challenges') &&
                    !m.url.endsWith('/squad-building-challenges/Challenges/') &&
                    !m.url.endsWith('/squad-building-challenges')
                );
            }
            for (const d of DEFAULT_FUTBIN_SBC_CATALOG) {
                const idx = merged.findIndex(m => m.title && m.title.toLowerCase().replace(/[^a-z0-9]/g, '') === d.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
                if (idx >= 0) {
                    merged[idx] = d;
                } else if (!merged.some(m => m.url.toLowerCase() === d.url.toLowerCase())) {
                    merged.push(d);
                }
            }
            GM_setValue('futbin_sbc_catalog', merged);
            return merged;
        } catch (e) {
            return DEFAULT_FUTBIN_SBC_CATALOG;
        }
    }

    function serializeItemForStorage(it) {
        if (!it) return null;
        return {
            id: it.id,
            resourceId: it.resourceId || it.definitionId,
            definitionId: it.definitionId || it.resourceId,
            rating: it.rating,
            quality: it.quality,
            untradeable: !isItemTradeable(it),
            _isTradeable: isItemTradeable(it),
            pile: it.pile || 1
        };
    }

    function persistFutbinState() {
        try {
            if (State.futbinSbcData) {
                GM_setValue('futbin_sbc_data', State.futbinSbcData);
            }
            GM_setValue('futbin_sbc_market_prices', State.marketPrices || {});
            GM_setValue('futbin_sbc_custom_prices', State.customPrices || {});
            GM_setValue('futbin_sbc_club_scanned', State.clubScanned || {});
            if (State.clubMatches) {
                const cleanMatches = {};
                for (const [k, v] of Object.entries(State.clubMatches)) {
                    cleanMatches[k] = serializeItemForStorage(v);
                }
                GM_setValue('futbin_sbc_club_matches', cleanMatches);
            }
            if (State.transferMatches) {
                const cleanTransfer = {};
                for (const [k, v] of Object.entries(State.transferMatches)) {
                    cleanTransfer[k] = serializeItemForStorage(v);
                }
                GM_setValue('futbin_sbc_transfer_matches', cleanTransfer);
            }
            if (State.sellingMatches) {
                const cleanSelling = {};
                for (const [k, v] of Object.entries(State.sellingMatches)) {
                    if (v) {
                        cleanSelling[k] = {
                            expires: v.expires,
                            expiresAt: v.expiresAt,
                            buyNow: v.buyNow,
                            item: serializeItemForStorage(v.item)
                        };
                    }
                }
                GM_setValue('futbin_sbc_selling_matches', cleanSelling);
            }
        } catch (e) {
            console.warn("[FC 27 Helper] Error guardando estado persistente:", e);
        }
    }

    function restoreFutbinState() {
        try {
            const savedData = GM_getValue('futbin_sbc_data', null);
            if (savedData && savedData.players) {
                State.futbinSbcData = savedData;
            }
            const savedMarket = GM_getValue('futbin_sbc_market_prices', null);
            if (savedMarket && typeof savedMarket === 'object') {
                State.marketPrices = Object.assign(State.marketPrices || {}, savedMarket);
            }
            const savedCustom = GM_getValue('futbin_sbc_custom_prices', null);
            if (savedCustom && typeof savedCustom === 'object') {
                State.customPrices = Object.assign(State.customPrices || {}, savedCustom);
            }
            const savedScanned = GM_getValue('futbin_sbc_club_scanned', null);
            if (savedScanned && typeof savedScanned === 'object') {
                State.clubScanned = Object.assign(State.clubScanned || {}, savedScanned);
            }
            const savedMatches = GM_getValue('futbin_sbc_club_matches', null);
            if (savedMatches && typeof savedMatches === 'object') {
                State.clubMatches = Object.assign(State.clubMatches || {}, savedMatches);
            }
            const savedTransfer = GM_getValue('futbin_sbc_transfer_matches', null);
            if (savedTransfer && typeof savedTransfer === 'object') {
                State.transferMatches = Object.assign(State.transferMatches || {}, savedTransfer);
            }
            const savedSelling = GM_getValue('futbin_sbc_selling_matches', null);
            if (savedSelling && typeof savedSelling === 'object') {
                State.sellingMatches = Object.assign(State.sellingMatches || {}, savedSelling);
            }
        } catch (e) {
            console.warn("[FC 27 Helper] Error restaurando estado:", e);
        }
    }

    // Validación para descartar pantallas genéricas de la Web App ("Home", "Inicio", "SBC", etc.)
    function isValidSbcName(name) {
        if (!name || typeof name !== 'string') return false;
        const clean = name.trim().toLowerCase();
        if (clean.length < 3) return false;
        const blacklist = [
            'home', 'inicio', 'sbc', 'sbcs', 'squad building challenges', 'desafíos de creación de plantillas',
            'transfers', 'transferencias', 'transfer market', 'mercado', 'mercado de transferencias',
            'club', 'mi club', 'stadium', 'estadio', 'store', 'tienda', 'settings', 'ajustes',
            'objectives', 'objetivos', 'evolutions', 'evoluciones', 'news', 'noticias', 'hub',
            'bad request', 'error', '404', '400', 'undefined', 'null'
        ];
        if (blacklist.includes(clean)) return false;
        return true;
    }

    // Detección automática del SBC que el usuario está viendo actualmente en la pantalla de la Web App
    function detectWebappCurrentSbc() {
        let detected = { name: '', id: null, setName: '' };

        try {
            // 1. Intentar inspeccionar los controladores de vista nativos de EA FC
            if (typeof getAppMain === 'function') {
                const root = getAppMain()?.getRootViewController();
                const presented = root?.getPresentedViewController();
                const current = presented?.getCurrentViewController();
                if (current) {
                    if (current._challenge && current._challenge.name && isValidSbcName(current._challenge.name)) {
                        detected.name = current._challenge.name;
                        detected.id = current._challenge.id;
                        if (current._set && current._set.name) detected.setName = current._set.name;
                    } else if (current._set && current._set.name && isValidSbcName(current._set.name)) {
                        detected.name = current._set.name;
                        detected.setName = current._set.name;
                        detected.id = current._set.id;
                    }
                }
            }
        } catch (e) { }

        // 2. Si no, inspeccionar filas o tarjetas seleccionadas de desafíos
        if (!detected.name) {
            const rowTitle = document.querySelector('.ut-sbc-challenge-table-row-view.selected .title, .ut-sbc-challenge-details-view .title, .ut-sbc-set-tile-view.selected .tileTitle');
            if (rowTitle && rowTitle.textContent && isValidSbcName(rowTitle.textContent)) {
                detected.name = rowTitle.textContent.trim();
            }
        }

        // 3. Inspeccionar el título del view de navegación SOLO si es un nombre específico de desafío
        if (!detected.name) {
            const titleEl = document.querySelector('.ut-navigation-bar-view .title');
            if (titleEl && titleEl.textContent && isValidSbcName(titleEl.textContent)) {
                detected.name = titleEl.textContent.trim();
            }
        }

        return (detected.name && isValidSbcName(detected.name)) ? detected : null;
    }

    // Consulta de los SBCs activos en la Web App que otorgan sobres (packs)
    async function getWebappActiveChallenges() {
        const results = [];
        try {
            if (typeof services === 'undefined' || !services.SBC) return results;
            let sets = [];
            if (services.SBC.repository && typeof services.SBC.repository.getSets === 'function') {
                const raw = services.SBC.repository.getSets();
                if (raw) sets = Array.isArray(raw) ? raw : (raw.values ? Array.from(raw.values()) : Object.values(raw));
            }
            if (sets.length === 0 && typeof services.SBC.requestSets === 'function') {
                const res = await new Promise((resolve) => {
                    const obs = services.SBC.requestSets();
                    if (!obs || typeof obs.observe !== 'function') return resolve(null);
                    obs.observe(this, (sender, response) => {
                        try { sender.unobserve(this); } catch (e) { }
                        resolve(response);
                    });
                });
                if (res && res.success && res.data && Array.isArray(res.data.sets)) {
                    sets = res.data.sets;
                }
            }

            for (const s of sets) {
                const sName = s.name || s.title || '';
                const chs = (typeof s.getChallenges === 'function' ? s.getChallenges() : s.challenges) || [];
                for (const ch of chs) {
                    const chName = ch.name || ch.title || '';
                    if (!chName) continue;
                    // Verificar si el desafío da sobres (awards con "pack" o "sobre")
                    let hasPackReward = false;
                    const awards = (ch.awards && Array.isArray(ch.awards) ? ch.awards : [])
                        .concat(s.awards && Array.isArray(s.awards) ? s.awards : []);
                    for (const a of awards) {
                        const valStr = JSON.stringify(a).toLowerCase();
                        if (valStr.includes('pack') || valStr.includes('sobre') || valStr.includes('players')) {
                            hasPackReward = true;
                            break;
                        }
                    }
                    results.push({
                        setName: sName,
                        challengeName: chName,
                        hasPackReward: hasPackReward,
                        isCompleted: typeof ch.isCompleted === 'function' ? ch.isCompleted() : false
                    });
                }
            }
        } catch (e) {
            console.warn("[FC 27 Helper] Error leyendo sets de Web App:", e);
        }
        return results;
    }

    async function fetchFutbinChallengesCatalogRemote() {
        return new Promise((resolve) => {
            const catalog = getFutbinSbcCatalog();
            if (typeof GM_xmlhttpRequest !== 'function') return resolve(catalog);

            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://www.futbin.com/27/squad-building-challenges',
                headers: {
                    'User-Agent': navigator.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                onload: async function (res) {
                    if (res.status === 200 && res.responseText) {
                        try {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(res.responseText, 'text/html');
                            const anchors = Array.from(doc.querySelectorAll('a[href*="/squad-building-challenges/"], a[href*="/squad-building-challenge/"]'));
                            let added = 0;
                            const groupUrlsToInspect = [];

                            for (const a of anchors) {
                                const href = a.getAttribute('href');
                                if (!href) continue;
                                const fullUrl = href.startsWith('http') ? href : `https://www.futbin.com${href.startsWith('/') ? '' : '/'}${href}`;
                                const cleanUrl = fullUrl.split('?')[0].split('#')[0];
                                const pathLower = cleanUrl.toLowerCase();

                                if (pathLower.endsWith('/squad-building-challenges') || pathLower.endsWith('/squad-building-challenges/')) continue;

                                const nameEl = a.querySelector('.challenge-name, .sbc-name, h4, h5, span') || a;
                                let name = (nameEl.textContent || '').trim().replace(/\s+/g, ' ').replace(/sbc/i, '').trim();

                                // Desafío individual con ID numérico en /Challenges/<id>
                                if (/\/challenges\/\d+/i.test(pathLower)) {
                                    if (name && name.length >= 2 && !catalog.some(c => c.url.toLowerCase() === cleanUrl.toLowerCase())) {
                                        catalog.push({ group: "📚 Desafíos Activos (FUTBIN)", title: name, url: cleanUrl });
                                        added++;
                                    }
                                } else if (pathLower.includes('/challenges/') || pathLower.includes('/marquee') || pathLower.includes('/foundations')) {
                                    // Página de grupo (Marquee Matchups, etc.)
                                    if (!groupUrlsToInspect.includes(cleanUrl)) {
                                        groupUrlsToInspect.push(cleanUrl);
                                    }
                                }
                            }

                            // Inspeccionar las páginas de grupo encontradas (ej: Marquee Matchups)
                            for (const gUrl of groupUrlsToInspect.slice(0, 4)) {
                                try {
                                    await new Promise(r => {
                                        GM_xmlhttpRequest({
                                            method: 'GET',
                                            url: gUrl,
                                            onload: function (gRes) {
                                                if (gRes.status === 200 && gRes.responseText) {
                                                    const gDoc = parser.parseFromString(gRes.responseText, 'text/html');
                                                    const gAnchors = Array.from(gDoc.querySelectorAll('a[href*="/squad-building-challenges/Challenges/"], a[href*="/Challenges/"]'));
                                                    const gTitleEl = gDoc.querySelector('h1, .challenge-name, .sbc-header-title');
                                                    const gTitle = gTitleEl ? gTitleEl.textContent.replace(/sbc/i, '').trim() : 'SBC Grupo';

                                                    for (const ga of gAnchors) {
                                                        const gh = ga.getAttribute('href');
                                                        if (!gh) continue;
                                                        const gFull = gh.startsWith('http') ? gh : `https://www.futbin.com${gh.startsWith('/') ? '' : '/'}${gh}`;
                                                        const gClean = gFull.split('?')[0].split('#')[0];
                                                        const subNameEl = ga.querySelector('.challenge-name, .sbc-name, h4, h5, span') || ga;
                                                        let subName = (subNameEl.textContent || '').trim().replace(/\s+/g, ' ').replace(/sbc/i, '').trim();
                                                        if (subName && subName.length >= 2 && !catalog.some(c => c.url.toLowerCase() === gClean.toLowerCase())) {
                                                            catalog.push({
                                                                group: gTitle,
                                                                title: `${gTitle}: ${subName}`,
                                                                url: gClean
                                                            });
                                                            added++;
                                                        }
                                                    }
                                                }
                                                r();
                                            },
                                            onerror: () => r()
                                        });
                                    });
                                } catch (eGrp) { }
                            }

                            // Sincronizar también con desafíos detectados en la Web App que otorgan sobres
                            try {
                                const webAppChallenges = await getWebappActiveChallenges();
                                for (const wch of webAppChallenges) {
                                    // Si no está ya en el catálogo, agregarlo con su slug tentativo
                                    const wSlug = wch.challengeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                                    const exists = catalog.some(c => {
                                        const cNorm = c.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                                        const wNorm = wch.challengeName.toLowerCase().replace(/[^a-z0-9]/g, '');
                                        return cNorm.includes(wNorm) || wNorm.includes(cNorm);
                                    });
                                    if (!exists) {
                                        const tag = wch.hasPackReward ? '🎁 [Sobre] ' : '';
                                        catalog.push({
                                            group: `🎮 Web App: ${wch.setName}`,
                                            title: `${tag}${wch.setName}: ${wch.challengeName}`,
                                            url: `https://www.futbin.com/27/squad-building-challenges/Challenges/${wSlug}`
                                        });
                                        added++;
                                    }
                                }
                            } catch (eWeb) { }

                            if (catalog.length > 0) {
                                GM_setValue('futbin_sbc_catalog', catalog);
                                resolve(catalog);
                                return;
                            }
                        } catch (e) { }
                    }
                    resolve(getFutbinSbcCatalog());
                },
                onerror: () => resolve(getFutbinSbcCatalog())
            });
        });
    }

    function renderFutbinSbcSelectOptions() {
        const select = document.getElementById('futbin-sbc-select');
        if (!select) return;
        const catalog = getFutbinSbcCatalog();
        const currentUrl = (State.futbinSbcData && State.futbinSbcData.challengeUrl) || (document.getElementById('futbin-sbc-url-input')?.value.trim()) || '';

        // Agrupar desafíos por optgroup
        const groups = {};
        for (const item of catalog) {
            const grp = item.group || "📚 Otros Desafíos";
            if (!groups[grp]) groups[grp] = [];
            groups[grp].push(item);
        }

        let html = `<option value="">-- Elige un SBC de la lista --</option>`;
        let matched = false;

        for (const grpName of Object.keys(groups)) {
            html += `<optgroup label="${grpName}">`;
            for (const item of groups[grpName]) {
                const isSelected = currentUrl && (currentUrl.toLowerCase() === item.url.toLowerCase() || (item.url.length > 25 && currentUrl.toLowerCase().includes(item.url.toLowerCase())));
                if (isSelected) matched = true;
                html += `<option value="${item.url}" ${isSelected ? 'selected' : ''}>${item.title}</option>`;
            }
            html += `</optgroup>`;
        }

        html += `<option value="custom" ${!matched && currentUrl ? 'selected' : ''}>✍️ Otra URL / Personalizado...</option>`;
        select.innerHTML = html;

        // Si hay una URL en State y el input está vacío, rellenarlo
        const urlInput = document.getElementById('futbin-sbc-url-input');
        if (urlInput && !urlInput.value && State.futbinSbcData && State.futbinSbcData.challengeUrl) {
            urlInput.value = State.futbinSbcData.challengeUrl;
        }
    }

    // Restaurar inmediatamente el último estado guardado al iniciar
    restoreFutbinState();

    function getItemMaxPrice(eaId, card) {
        const numId = Number(eaId);
        const item = State.transferMatches[numId] || State.clubMatches[numId] || (State.sellingMatches[numId] && State.sellingMatches[numId].item);
        if (item) {
            if (typeof item.getPriceLimits === 'function') {
                try {
                    const lim = item.getPriceLimits();
                    if (lim && lim.maximum > 0) return lim.maximum;
                } catch (e) { }
            }
            if (item._itemPriceLimits && item._itemPriceLimits.maximum > 0) {
                return item._itemPriceLimits.maximum;
            }
        }
        if (card) {
            if (card.maxPrice && card.maxPrice > 0) return card.maxPrice;
            if (card.futggMaxPrice && card.futggMaxPrice > 0) return card.futggMaxPrice;
        }
        // Fallback según calidad o rating si la carta aún no está en RAM:
        // En EA FC 27, la inmensa mayoría de bronces tienen un techo de 5.000 monedas.
        // Fijar 5.000 para bronces asegura que el 90% (4.500) nunca sobrepase el rango máximo ni sea rechazado por EA.
        const rating = card ? (card.rating || 0) : 0;
        const quality = card ? (card.quality || '') : '';
        if (quality === 'bronze' || (rating > 0 && rating <= 64)) {
            return 5000;
        }
        if (quality === 'silver' || (rating >= 65 && rating <= 74)) {
            return 10000;
        }
        return 10000;
    }

    function isMinimumPrice(player, market) {
        if (!market) return false;
        if (market.isExtinct) return false; // ¡Una carta extinta nunca está a precio mínimo!
        if (!market.lowestBin) return false;
        const bin = market.hasOutlier ? market.realisticBin : market.lowestBin;
        const quality = player.quality || (player.rating && player.rating <= 64 ? 'bronze' : (player.rating && player.rating <= 74 ? 'silver' : 'gold'));
        if (quality === 'bronze' || (player.rating && player.rating <= 64)) {
            return bin <= 250;
        }
        if (quality === 'silver' || (player.rating && player.rating >= 65 && player.rating <= 74)) {
            return bin <= 350;
        }
        return bin <= 500;
    }

    function isInflatedGem(player, market) {
        if (!market) return false;
        if (market.isExtinct) return true; // ¡Extinta es la joya máxima!
        if (!market.lowestBin) return false;
        const bin = market.hasOutlier ? market.realisticBin : market.lowestBin;
        const quality = player.quality || (player.rating && player.rating <= 64 ? 'bronze' : (player.rating && player.rating <= 74 ? 'silver' : 'gold'));
        if (quality === 'bronze' || (player.rating && player.rating <= 64)) {
            return bin >= 850;
        }
        if (quality === 'silver' || (player.rating && player.rating >= 65 && player.rating <= 74)) {
            return bin >= 1200;
        }
        return bin >= 2500;
    }

    function findAnyPlayerById(id) {
        if (!id) return null;
        const strId = String(id);
        if (State.activeTab === 'futbin' && State.futbinSbcData && State.futbinSbcData.players) {
            const p = State.futbinSbcData.players.find(x => String(x.eaId) === strId);
            if (p) return p;
        }
        const gem = State.gems.find(g => String(g.eaId) === strId);
        if (gem) return gem;
        if (State.futbinSbcData && State.futbinSbcData.players) {
            return State.futbinSbcData.players.find(x => String(x.eaId) === strId) || null;
        }
        return null;
    }

    function renderCurrentTable() {
        if (State.activeTab === 'futbin') {
            renderFutbinSbcTable();
        } else {
            renderGemsTable();
        }
    }

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
        const itemObj = it.itemData || it._item || it.item || it;
        const numEaId = Number(eaId || 0);
        const resId = Number(itemObj.resourceId || it.resourceId || 0);
        const defId = Number(itemObj.definitionId || it.definitionId || 0);
        const maskedId = typeof itemObj.getMaskedResourceId === 'function' ? Number(itemObj.getMaskedResourceId()) : (typeof it.getMaskedResourceId === 'function' ? Number(it.getMaskedResourceId()) : 0);
        const staticId = itemObj._staticData ? Number(itemObj._staticData.id || itemObj._staticData.defId || itemObj._staticData.assetId || 0) : (it._staticData ? Number(it._staticData.id || it._staticData.defId || it._staticData.assetId || 0) : 0);
        const assetId = Number(itemObj.assetId || it.assetId || 0);
        const conceptId = Number(itemObj.conceptId || it.conceptId || 0);
        const baseId = Number(itemObj.baseId || it.baseId || 0);

        // En EA FC, los 24 bits inferiores de resourceId o definitionId corresponden al assetId base
        const maskedBitwise = (resId > 0) ? (resId & 0x00FFFFFF) : 0;
        const defBitwise = (defId > 0) ? (defId & 0x00FFFFFF) : 0;

        // 1. Coincidencia directa por ID si se dispone de eaId (estricta e infalible)
        if (numEaId > 0) {
            return (resId === numEaId || defId === numEaId || maskedId === numEaId || staticId === numEaId || assetId === numEaId || conceptId === numEaId || baseId === numEaId || maskedBitwise === numEaId || defBitwise === numEaId);
        }

        // 2. Coincidencia por nombre exacto únicamente si NO se dispone de ningún eaId
        const dataObj = itemObj._staticData || it._staticData;
        if (name && dataObj) {
            const cleanTarget = name.toLowerCase().trim();
            if (cleanTarget.length >= 4) {
                const names = [
                    dataObj.name,
                    dataObj.lastName,
                    dataObj.firstName,
                    dataObj.commonName
                ].filter(Boolean).map(n => n.toLowerCase().trim());
                if (names.some(n => n === cleanTarget)) {
                    return true;
                }
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
                criteria.defId = [];

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
        const eaId = Number(gem.eaId);
        State.clubScanned[eaId] = true;
        if (item) {
            notificar(`🟢 ¡Encontrado ${gem.name} en tu cuenta!`, "#00ff88");
        } else {
            notificar(`⚪ ${gem.name} no se encontró en el club ni en transferibles`, "#ffaa00");
        }
        updateFutbinTabBadge();
        renderCurrentTable();
    }

    // =========================================================================
    // ESCANEO EN BLOQUE INTELIGENTE DE CLUB (PALETOOLS INTEGRATION + MULTI-DEFID)
    // =========================================================================
    async function findCardsInClubBatch(cardsToFind, isSilent = false) {
        if (!cardsToFind || cardsToFind.length === 0) return 0;
        const win = getAppWindow();
        let foundCount = 0;

        // 1. PRIORIDAD 1: Gancho directo a Paletools Club Index en memoria (0 peticiones a EA, 0ms)
        try {
            if (typeof win.clubIndexDebug === 'function') {
                const ptDebug = win.clubIndexDebug();
                if (ptDebug && ptDebug.loaded && Array.isArray(ptDebug.players) && ptDebug.players.length > 0) {
                    console.log(`%c[FC 27 Helper] ⚡ Paletools Club Index detectado (${ptDebug.players.length} jugadores en RAM). Sincronizando al instante...`, "color:#00ff88; font-weight:bold;");
                    const ptPlayers = ptDebug.players;
                    for (const card of cardsToFind) {
                        const eaId = Number(card.eaId);
                        if (State.sellingMatches[eaId] || State.soldMatches[eaId] || State.transferMatches[eaId]) continue;

                        const matched = ptPlayers.find(it => matchesCard(it, eaId, card.name));
                        if (matched) {
                            matched._isTradeable = isItemTradeable(matched);
                            State.clubMatches[eaId] = matched;
                            foundCount++;
                        }
                        State.clubScanned[eaId] = true;
                    }
                    if (!isSilent && foundCount > 0) {
                        notificar(`⚡ Sincronizado con Paletools (${foundCount} encontradas en memoria)`, "#00ff88");
                    }
                    return foundCount;
                }
            }
        } catch (ePt) {
            console.warn("[FC 27 Helper] Error al leer Paletools clubIndexDebug:", ePt);
        }

        // 2. PRIORIDAD 2: Búsqueda multicarta en EA vía services.Club.search con criteria.defId = [ids...] (Estilo Paletools)
        // Agrupa hasta 60 IDs por llamada (1 sola petición a EA en vez de 50 individuales)
        try {
            if (win.services && win.services.Club && typeof win.services.Club.search === 'function') {
                const missingCards = cardsToFind.filter(c => {
                    const id = Number(c.eaId);
                    return id > 0 && !State.sellingMatches[id] && !State.soldMatches[id] && !State.transferMatches[id];
                });

                if (missingCards.length > 0) {
                    const BATCH_SIZE = 60;
                    for (let i = 0; i < missingCards.length; i += BATCH_SIZE) {
                        const chunk = missingCards.slice(i, i + BATCH_SIZE);
                        const defIds = chunk.map(c => Number(c.eaId)).filter(id => id > 0);

                        if (defIds.length === 0) continue;

                        console.log(`[FC 27 Helper] 🚀 Consultando lote de ${defIds.length} cartas en el Club en 1 sola llamada a EA...`);
                        const criteria = createSearchCriteria();
                        criteria.count = 90;
                        criteria.offset = 0;
                        criteria.type = 'player';
                        criteria.defId = defIds;
                        criteria.maskedDefId = 0;

                        const res = await callEAService(win.services.Club.search(criteria));
                        const items = extractItemsFromEaResponse(res);

                        for (const card of chunk) {
                            const eaId = Number(card.eaId);
                            const match = items.find(it => matchesCard(it, eaId, card.name));
                            if (match) {
                                match._isTradeable = isItemTradeable(match);
                                State.clubMatches[eaId] = match;
                                foundCount++;
                            }
                            State.clubScanned[eaId] = true;
                        }

                        // Verificar en Almacenamiento/Storage de duplicados en bloque para las no encontradas
                        if (win.services && win.services.Item && typeof win.services.Item.searchStorageItems === 'function') {
                            try {
                                const stillMissing = chunk.filter(c => !State.clubMatches[Number(c.eaId)]);
                                const stillMissingIds = stillMissing.map(c => Number(c.eaId)).filter(id => id > 0);
                                if (stillMissingIds.length > 0) {
                                    const storCrit = createSearchCriteria();
                                    storCrit.count = 90;
                                    storCrit.offset = 0;
                                    storCrit.type = 'player';
                                    storCrit.defId = stillMissingIds;
                                    storCrit.maskedDefId = 0;
                                    const storRes = await callEAService(win.services.Item.searchStorageItems(storCrit));
                                    const storItems = extractItemsFromEaResponse(storRes);
                                    for (const card of stillMissing) {
                                        const eaId = Number(card.eaId);
                                        const match = storItems.find(it => matchesCard(it, eaId, card.name));
                                        if (match) {
                                            match._isTradeable = isItemTradeable(match);
                                            State.clubMatches[eaId] = match;
                                            foundCount++;
                                        }
                                    }
                                }
                            } catch (eStor) { }
                        }

                        if (i + BATCH_SIZE < missingCards.length) {
                            await randomDelay(400, 700);
                        }
                    }

                    return foundCount;
                }
            }
        } catch (eEa) {
            console.warn("[FC 27 Helper] Fallo en búsqueda en bloque de club, ejecutando fallback individual:", eEa);
        }

        // 3. FALLBACK: Consulta individual quirúrgica sólo si fallaron las anteriores
        for (const card of cardsToFind) {
            const eaId = Number(card.eaId);
            if (State.sellingMatches[eaId] || State.soldMatches[eaId] || State.transferMatches[eaId]) continue;
            const it = await findCardInAccount(card);
            if (it) foundCount++;
            State.clubScanned[eaId] = true;
        }
        return foundCount;
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

        // 2. Para las gemas restantes, buscarlas en bloque (Paletools en RAM o defId batch a EA)
        const gemsToScan = State.gems.filter(g => {
            const eaId = Number(g.eaId);
            return !State.sellingMatches[eaId] && !State.soldMatches[eaId] && !State.transferMatches[eaId];
        });
        await findCardsInClubBatch(gemsToScan, isSilent);

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
                criteria.defId = [];
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
            const buyNow = (item._auction && item._auction.buyNowPrice) || item.buyNowPrice || (item.auction && item.auction.buyNowPrice) || (item.itemData && item.itemData.buyNowPrice) || 0;
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
        State.abortMarketCrawl[eaId] = false;
        if (!isAutomated) State.forceCancelAllOperations = false;
        State.marketPrices[eaId] = {
            loading: true,
            crawling: true,
            filterLabel: forceOpen ? 'Abierto (sin tope)' : 'Iniciando...',
            filterType: forceOpen ? 'open' : 'tight',
            count: 0
        };
        State.openPriceBreakdowns[eaId] = false;
        renderCurrentTable();
        notificar(`🔍 Consultando mercado de ${gem.name}...`, "#00ccff");

        // Limpiar caché antes de la primera búsqueda
        if (services.Item && typeof services.Item.clearTransferMarketCache === 'function') {
            try { services.Item.clearTransferMarketCache(); } catch (e) { }
        }

        const estPrice = Number(gem.estimatedPrice || gem.futbinPrice || 0);

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
                if (State.abortMarketCrawl[eaId] || State.forceCancelAllOperations || (!State.isBatchRunning && isAutomated)) {
                    notificar(`⏹️ Verificación detenida por el usuario para ${gem.name}`, "#ffaa00");
                    break;
                }

                // Delay humano entre etapas o peticiones automatizadas
                if (stage > 1) {
                    await randomDelay(CONFIG.pageDelayMin || 1400, CONFIG.pageDelayMax || 2300, () => State.abortMarketCrawl[eaId] || State.forceCancelAllOperations);
                } else if (isAutomated) {
                    await randomDelay(CONFIG.minMarketDelay, CONFIG.maxMarketDelay, () => State.abortMarketCrawl[eaId] || State.forceCancelAllOperations);
                }

                if (State.abortMarketCrawl[eaId] || State.forceCancelAllOperations || (!State.isBatchRunning && isAutomated)) {
                    notificar(`⏹️ Verificación detenida por el usuario para ${gem.name}`, "#ffaa00");
                    break;
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
                criteria.maskedDefId = eaId;
                criteria.defId = [];
                if (targetMaxBuy > 0) {
                    criteria.maxBuy = targetMaxBuy;
                }

                // Rotación anti-caché de EA Market (Cache Buster):
                // En FC 27, el 100% de las cartas tienen Puja inicial >= 150 y Compra Ya >= 200.
                // Modificar dinámicamente estos parámetros neutros en cada búsqueda o refresco altera
                // la firma HTTP de la consulta (?mic=150 o ?mib=200), forzando a los servidores de EA
                // a consultar su base de datos real en vivo en lugar de devolver resultados cacheados de cartas ya vendidas.
                State.marketSearchNonce = (State.marketSearchNonce || 0) + 1;
                const busterStep = State.marketSearchNonce % 4;
                if (busterStep === 1) {
                    criteria.minBid = 150;
                } else if (busterStep === 2) {
                    criteria.minBuy = 200;
                } else if (busterStep === 3) {
                    criteria.minBid = 150;
                    criteria.minBuy = 200;
                } else {
                    delete criteria.minBid;
                    delete criteria.minBuy;
                }
                criteria.__futggCustomBusted = true;

                if (services.Item && typeof services.Item.clearTransferMarketCache === 'function') {
                    try { services.Item.clearTransferMarketCache(); } catch (e) { }
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
                    renderCurrentTable();
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

            // Verificación inteligente de piso real anti-orden de expiración de EA:
            // En EA FC, la API de mercado siempre devuelve cartas ordenadas por tiempo de expiración (ending soonest),
            // NO por precio de Compra Ya. Si obtuvimos una página llena (>= 21 cartas) o venimos de búsqueda abierta,
            // cartas a precio de descarte (200-400) que expiran en 50 min quedan ocultas detrás de cartas a 1500 que expiran en 5 min.
            // Verificamos si existen cartas más baratas que el precio mínimo aparente para encontrar el piso real:
            if (allItems.length > 0 && !forceOpen) {
                const tempLowest = Math.min(...allItems.map(it => (it._auction && it._auction.buyNowPrice) || it.buyNowPrice || (it.auction && it.auction.buyNowPrice) || (it.itemData && it.itemData.buyNowPrice) || 9999999));
                if (tempLowest > 250 && (allItems.length >= 21 || stage === 3 || estPrice <= 0)) {
                    const step = getBidStep(tempLowest);
                    const checkMaxBuy = Math.max(200, tempLowest - step);
                    console.log(`[FUT.GG Helper] 🔍 Verificando si existen cartas más baratas bajo ${formatCoins(tempLowest)} para ${gem.name} (maxBuy: ${checkMaxBuy})...`);

                    const subCriteria = createSearchCriteria(eaId);
                    subCriteria.count = 21;
                    subCriteria.type = (win.SearchType && win.SearchType.PLAYER) || 'player';
                    subCriteria.maskedDefId = eaId;
                    subCriteria.defId = [];
                    subCriteria.maxBuy = checkMaxBuy;
                    subCriteria.__futggCustomBusted = true;

                    await randomDelay(1000, 1500, () => State.abortMarketCrawl[eaId] || State.forceCancelAllOperations);
                    if (!State.abortMarketCrawl[eaId] && !State.forceCancelAllOperations && (State.isBatchRunning || !isAutomated)) {
                        const subRes = await callEAService(services.Item.searchTransferMarket(subCriteria, 1));
                        const subPageItems = extractItemsFromEaResponse(subRes);
                        const subValidItems = (subPageItems || []).filter(it => matchesCard(it, eaId, gem.name));
                        if (subValidItems.length > 0) {
                            allItems = subValidItems;
                            filterLabel = `≤ ${formatCoins(checkMaxBuy)} (piso verificado)`;
                            console.log(`[FUT.GG Helper] 🟢 ¡Piso más barato encontrado! ${subValidItems.length} cartas a ${filterLabel}`);
                        } else {
                            console.log(`[FUT.GG Helper] ✅ Confirmado: 0 cartas bajo ${formatCoins(checkMaxBuy)}. El piso real inicia en ${formatCoins(tempLowest)}.`);
                        }
                    }
                }
            }

            const wasAborted = State.abortMarketCrawl[eaId] || State.forceCancelAllOperations || (!State.isBatchRunning && isAutomated);
            if (wasAborted) {
                console.log(`[FUT.GG Helper] ⏹️ Verificación de mercado abortada/detenida para ${gem.name}`);
                if (State.marketPrices[eaId]) {
                    State.marketPrices[eaId].crawling = false;
                    State.marketPrices[eaId].loading = false;
                }
                return;
            }

            if (allItems.length === 0) {
                const maxPrice = getItemMaxPrice(eaId, gem);
                const safe90Price = roundToValidBid(Math.round(maxPrice * 0.90), 'down');

                State.marketPrices[eaId] = {
                    lowestBin: safe90Price,
                    realisticBin: safe90Price,
                    suggestedExtinctBin: safe90Price,
                    maxPrice: maxPrice,
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
                State.customPrices[eaId] = safe90Price;
                notificar(`💎 ${gem.name}: ¡Extinta en mercado! Sugerido 90% máx: ${formatCoins(safe90Price)} (evita ban por vender al 100%)`, "#ffaa00");
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
            if (State.marketPrices[eaId]) {
                State.marketPrices[eaId].crawling = false;
                State.marketPrices[eaId].loading = false;
            }
            renderCurrentTable();
        }
    }

    // Interceptar y cerrar automáticamente modales de "Destination full / Lista llena"
    function dismissEaDialogIfPresent() {
        try {
            const win = getAppWindow();
            const dialogs = document.querySelectorAll('.ea-dialog-view, .dialog-view, .Dialog, .view-modal-dialog, .ut-click-shield');
            let dismissedAny = false;

            dialogs.forEach(d => {
                const text = (d.textContent || '').toLowerCase();
                const isDestinationFull = text.includes('destination full') ||
                    text.includes('cannot move this item') ||
                    text.includes('destination is already full') ||
                    text.includes('destino lleno') ||
                    text.includes('no se puede mover este art') ||
                    text.includes('lista de transferibles est') ||
                    (text.includes('full') && (text.includes('destination') || text.includes('item') || text.includes('transfer')));

                if (isDestinationFull) {
                    dismissedAny = true;
                    console.warn("[FUT.GG Helper] 🛡️ Suprimiendo de inmediato diálogo falso de EA 'Destination full'");

                    // 1. Simular pulsación de Enter
                    try {
                        const enterEv = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
                        window.dispatchEvent(enterEv);
                        document.dispatchEvent(enterEv);
                        d.dispatchEvent(enterEv);
                    } catch (e) { }

                    // 2. Hacer click en el botón de confirmación/OK
                    const btn = d.querySelector('.btn-standard, button, .dialog-footer button, .close-btn');
                    if (btn) {
                        try { btn.click(); } catch (e) { }
                        try { btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) { }
                    }

                    // 3. Limpiar click-shield de fondo si persiste
                    const clickShield = d.classList.contains('ut-click-shield') ? d : d.closest('.ut-click-shield');
                    if (clickShield) {
                        clickShield.classList.remove('showing');
                    }
                    if (typeof d.remove === 'function' && !d.classList.contains('ut-click-shield')) {
                        try { d.remove(); } catch (e) { }
                    }
                }
            });

            if (dismissedAny && win.gNavManager) {
                if (typeof win.gNavManager.hasOpenDialog === 'function' && win.gNavManager.hasOpenDialog()) {
                    if (typeof win.gNavManager.popDialog === 'function') {
                        try { win.gNavManager.popDialog(); } catch (e) { }
                    }
                }
                const dialogController = typeof win.gNavManager.getDialogController === 'function' ? win.gNavManager.getDialogController() : null;
                if (dialogController && typeof dialogController.close === 'function') {
                    try { dialogController.close(); } catch (e) { }
                }
            }
        } catch (e) { }
    }

    function scheduleDismissEaDialog() {
        dismissEaDialogIfPresent();
        setTimeout(dismissEaDialogIfPresent, 50);
        setTimeout(dismissEaDialogIfPresent, 150);
        setTimeout(dismissEaDialogIfPresent, 300);
        setTimeout(dismissEaDialogIfPresent, 600);
        setTimeout(dismissEaDialogIfPresent, 1000);
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
        if (!item || !item.id) {
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

        const pile = (win.enums && win.enums.FUTItemPile && win.enums.FUTItemPile.TRANSFER) ||
            (win.enums && win.enums.ItemPile && win.enums.ItemPile.TRANSFER) ||
            (win.ItemPile && win.ItemPile.TRANSFER) ||
            2;

        // 5. Verificar si en el modelo de EA ya está en Transferibles
        const currentPile = item.pile || item._pile || (typeof item.getPile === 'function' ? item.getPile() : 0);
        if (currentPile === pile || (typeof item.isTransferList === 'function' && item.isTransferList())) {
            delete State.clubMatches[eaId];
            State.transferMatches[eaId] = item;
            renderCurrentTable();
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

        // 7. Mover a transferibles (firma oficial de EA Web App: Item.move(item, pile))
        try {
            console.log(`[FC 27 Helper] 📋 Moviendo ${gem.name} (ID de carta: ${item.id}, EA ID: ${eaId}) a Transferibles (pile ${pile})...`, item);
            let moved = false;
            if (services && services.Item && typeof services.Item.move === 'function') {
                try {
                    await callEAService(services.Item.move(item, pile));
                    moved = true;
                } catch (errSingle) {
                    console.warn("[FC 27 Helper] Intento directo Item.move(item, pile) falló, probando con [item]:", errSingle);
                    try {
                        await callEAService(services.Item.move([item], pile));
                        moved = true;
                    } catch (errArr) {
                        console.warn("[FC 27 Helper] Intento con array falló también:", errArr);
                        throw errSingle;
                    }
                }
            }

            if (!moved && win.communication && typeof win.communication.MoveItemDelegate === 'function') {
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
            persistFutbinState();
            renderCurrentTable();
            if (!silent) notificar(`📋 ${gem.name} movido a la Lista de Transferibles`, "#00ff88");
            return true;
        } catch (err) {
            console.error("Error al mover a transferibles:", err);
            scheduleDismissEaDialog();

            const errStr = String(err && (err.message || err.reason || err.statusText || err) || '').toLowerCase();
            if (errStr.includes('destination full') || errStr.includes('full') || (err && (err.status === 403 || err.code === 403))) {
                item.pile = pile;
                State.transferMatches[eaId] = item;
                delete State.clubMatches[eaId];
                renderCurrentTable();
                if (!silent) notificar(`⚠️ Tu lista de transferibles parece llena. Si ya tenías espacio, ${gem.name} quedó registrado en transferibles`, "#ffaa00");
                return true;
            }

            if (errStr.includes('squad') || errStr.includes('plantilla') || errStr.includes('active')) {
                if (!silent) notificar(`⚠️ ${gem.name} está asignado a tu plantilla activa. Quítalo de la plantilla para moverlo.`, "#ffaa00");
                return false;
            }

            if (!silent) {
                const detail = err && (err.message || err.reason || err.statusText || (typeof err === 'string' ? err : 'Error en servicio de EA'));
                notificar(`No se pudo mover ${gem.name}: ${detail}`, "#ff4444");
            }
            return false;
        }
    }

    async function listCardOnMarket(gem, overridePrice = null) {
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

        // Si la carta está en el Club o en Almacenamiento, asegurar movimiento previo a Transferibles
        // En EA FC Web App, listar directamente desde Club/Storage frecuentemente falla con "Destination full" o "Error en servicio de EA"
        const transferPile = (win.enums && win.enums.FUTItemPile && win.enums.FUTItemPile.TRANSFER) ||
            (win.enums && win.enums.ItemPile && win.enums.ItemPile.TRANSFER) || 2;
        const currentPile = item.pile || item._pile || (typeof item.getPile === 'function' ? item.getPile() : 0);

        if (currentPile !== transferPile && !State.transferMatches[eaId]) {
            console.log(`[FC 27 Helper] 📋 ${gem.name} está en el Club (pile ${currentPile}). Moviendo primero a Transferibles para listar con seguridad...`);
            const moved = await moveToTransferList(gem, true);
            if (!moved) {
                // Si no se pudo mover (ej. lista llena o en plantilla activa), la función moveToTransferList ya notificó la razón exacta
                return;
            }
            item = State.transferMatches[eaId] || item;
        }

        // Consultar límites oficiales de precio en tiempo real a EA si están disponibles
        if (services.Item && typeof services.Item.requestPriceLimits === 'function') {
            try {
                await callEAService(services.Item.requestPriceLimits([item]));
            } catch (e) { }
        }

        const realMaxPrice = getItemMaxPrice(eaId, gem);
        const market = State.marketPrices[eaId];
        let buyNow = overridePrice || State.customPrices[eaId];
        if (!buyNow) {
            if (market && market.isExtinct) {
                buyNow = roundToValidBid(Math.round(realMaxPrice * 0.90), 'down');
            } else if (market && market.lowestBin) {
                buyNow = Math.max(200, (market.hasOutlier ? market.realisticBin : market.lowestBin) - CONFIG.undercutAmount);
            } else {
                buyNow = gem.futggPrice || gem.estimatedPrice || (gem.futbinPrice || 1000);
            }
        }

        // Si la carta está extinta, asegurarse de que NO exceda el 90% del precio máximo para evitar baneos de EA
        if (market && market.isExtinct) {
            const safeCap = roundToValidBid(Math.round(realMaxPrice * 0.90), 'down');
            if (buyNow > safeCap) {
                console.log(`[FUT.GG Helper] 🛡️ Ajustando precio de ${gem.name} extinto de ${buyNow} a ${safeCap} (90% del máx) para evitar baneo`);
                buyNow = safeCap;
            }
        }

        // Validar estrictamente contra los Price Limits oficiales de EA del ítem para evitar rechazo 400
        const priceLimits = (typeof item.getPriceLimits === 'function' ? item.getPriceLimits() : null) || item._itemPriceLimits;
        const minLimit = (priceLimits && priceLimits.minimum > 0) ? priceLimits.minimum : 200;
        const maxLimit = (priceLimits && priceLimits.maximum > 0) ? priceLimits.maximum : (realMaxPrice > 0 ? realMaxPrice : 10000);

        if (maxLimit > 0 && buyNow > maxLimit) buyNow = maxLimit;
        if (minLimit > 0 && buyNow < minLimit) buyNow = minLimit;

        const validBuyNow = roundToValidBid(buyNow, 'down');
        let startBid = calculateStartBid(validBuyNow);
        if (minLimit > 0 && startBid < minLimit) startBid = minLimit;
        if (startBid >= validBuyNow) {
            startBid = Math.max(minLimit, validBuyNow - getBidStep(validBuyNow));
        }

        try {
            await callEAService(services.Item.list(item, startBid, validBuyNow, 3600));
            scheduleDismissEaDialog();

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
            State.focusedGemId = null; // Evitar scroll al fondo para mantener el foco en la carta siguiente
            persistFutbinState();
            renderCurrentTable();
            notificar(`🚀 ¡${gem.name} listado por ${formatCoins(validBuyNow)}! (Puja: ${formatCoins(startBid)})`, "#00ff88");
        } catch (err) {
            console.error("Error al listar:", err);
            scheduleDismissEaDialog();
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
        if (State.isBatchRunning) {
            cancelBatch();
            return;
        }
        State.isBatchRunning = true;
        State.forceCancelAllOperations = false;
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
            if (!State.isBatchRunning || State.forceCancelAllOperations) break;
            count++;
            updateBatchStatus(`Comparando precio ${count}/${gemsToCheck.length}: ${gem.name}...`);
            try {
                await checkMarketPrice(gem, true);
            } catch (e) {
                console.error("Error en batch market check:", e);
                break;
            }
            if (!State.isBatchRunning || State.forceCancelAllOperations) break;
        }

        State.isBatchRunning = false;
        updateBatchStatus(State.forceCancelAllOperations ? "⏹️ Verificación detenida por el usuario." : `Comparación de mercado completada.`);
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
            if (!State.isBatchRunning || State.forceCancelAllOperations) break;
            count++;
            const price = State.customPrices[gem.eaId] || gem.estimatedPrice;
            updateBatchStatus(`Listando ${count}/${gemsToList.length}: ${gem.name} por ${formatCoins(price)}...`);

            await listCardOnMarket(gem);
            await randomDelay(CONFIG.listDelay, CONFIG.listDelay + 1000, () => State.forceCancelAllOperations);
        }

        State.isBatchRunning = false;
        updateBatchStatus(`¡Finalizado! Se listaron ${count} cartas.`);
        renderBatchControls();
    }

    function cancelBatch() {
        State.isBatchRunning = false;
        State.forceCancelAllOperations = true;
        State.isScanningClub = false;
        if (State.abortMarketCrawl) {
            for (const id of Object.keys(State.abortMarketCrawl)) {
                State.abortMarketCrawl[id] = true;
            }
        }
        if (State.marketPrices) {
            for (const id of Object.keys(State.marketPrices)) {
                if (State.marketPrices[id] && (State.marketPrices[id].loading || State.marketPrices[id].crawling)) {
                    State.marketPrices[id].loading = false;
                    State.marketPrices[id].crawling = false;
                }
            }
        }
        updateBatchStatus("⏹️ Operación detenida por el usuario.");
        notificar("⏹️ Verificación de mercado detenida", "#ffaa00");
        renderBatchControls();
        renderCurrentTable();
    }

    // =========================================================================
    // FUNCIONES DE PROCESAMIENTO Y FILTRADO DE SOLUCIONES FUTBIN SBC
    // =========================================================================
    function getFilteredFutbinPlayers() {
        if (!State.futbinSbcData || !State.futbinSbcData.players) return [];
        return State.futbinSbcData.players.filter(p => {
            const eaId = Number(p.eaId);
            // 1. Filtro Bronces/Platas prioritario
            if (State.futbinFilterOnlyBronzeSilver) {
                if (p.quality !== 'bronze' && p.quality !== 'silver') return false;
            }
            // 2. Filtro En Mi Club prioritario
            if (State.futbinFilterOnlyInClub) {
                const inClub = State.clubMatches[eaId];
                const inTransfer = State.transferMatches[eaId];
                const selling = State.sellingMatches[eaId];
                const sold = State.soldMatches[eaId];
                if (!inClub && !inTransfer && !selling && !sold) return false;
            }
            // 3. Filtro Ocultar Precio Mínimo (si ya fue consultado y está a descarte)
            if (State.futbinFilterHideMinimum) {
                if (Number(State.focusedGemId) === eaId) return true; // Nunca ocultar la carta bajo interacción activa
                const market = State.marketPrices[eaId];
                if (market && !market.error && !market.loading && isMinimumPrice(p, market)) {
                    return false;
                }
            }
            return true;
        });
    }

    function updateFutbinTabBadge() {
        const badge = document.getElementById('futbin-tab-badge');
        if (!badge) return;
        if (!State.futbinSbcData || !State.futbinSbcData.players) {
            badge.textContent = '0';
            return;
        }
        let availableCount = 0;
        for (const p of State.futbinSbcData.players) {
            const eaId = Number(p.eaId);
            const inClub = State.clubMatches[eaId];
            const inTransfer = State.transferMatches[eaId];
            const selling = State.sellingMatches[eaId];
            const sold = State.soldMatches[eaId];
            if (!sold && !selling) {
                if (inTransfer || (inClub && isItemTradeable(inClub))) {
                    availableCount++;
                }
            }
        }
        badge.textContent = availableCount;
    }

    function switchTab(tab) {
        State.activeTab = tab;
        const tabFutgg = document.getElementById('futgg-tab-futgg');
        const tabFutbin = document.getElementById('futgg-tab-futbin');
        const tbFutgg = document.getElementById('futgg-toolbar');
        const tbFutbin = document.getElementById('futbin-sbc-toolbar');
        const hideSoldContainer = document.getElementById('futgg-hide-sold-container');
        const tokenBtn = document.getElementById('futgg-toggle-token-btn');

        if (tab === 'futgg') {
            if (tabFutgg) tabFutgg.classList.add('active');
            if (tabFutbin) tabFutbin.classList.remove('active');
            if (tbFutgg) tbFutgg.style.display = 'flex';
            if (tbFutbin) tbFutbin.style.display = 'none';
            if (hideSoldContainer) hideSoldContainer.style.display = 'inline-flex';
            if (tokenBtn) tokenBtn.style.display = 'inline-flex';
            renderGemsTable();
        } else {
            if (tabFutgg) tabFutgg.classList.remove('active');
            if (tabFutbin) tabFutbin.classList.add('active');
            if (tbFutgg) tbFutgg.style.display = 'none';
            if (tbFutbin) tbFutbin.style.display = 'flex';
            if (hideSoldContainer) hideSoldContainer.style.display = 'none';
            if (tokenBtn) tokenBtn.style.display = 'none';
            restoreFutbinState();
            matchFutbinPlayersWithKnownItems();
            renderFutbinSbcTable();
            renderFutbinSbcSelectOptions();
        }
    }

    function autoScanClubForFutbinPlayers() {
        if (!State.futbinSbcData || !State.futbinSbcData.players || State.futbinSbcData.players.length === 0) return;
        if (State.isScanningClub || State.isBatchRunning) return;

        matchFutbinPlayersWithKnownItems();

        const missing = State.futbinSbcData.players.filter(p => {
            const eaId = Number(p.eaId);
            return eaId > 0 && !State.sellingMatches[eaId] && !State.transferMatches[eaId] && !State.clubMatches[eaId] && !State.soldMatches[eaId] && !State.clubScanned[eaId];
        });

        if (missing.length > 0) {
            console.log(`[FUTBIN SBC] 🚀 Auto-escaneo de club iniciado para ${missing.length} cartas pendientes...`);
            scanClubForFutbinPlayers(true);
        }
    }

    function matchFutbinPlayersWithKnownItems() {
        if (!State.futbinSbcData || !State.futbinSbcData.players) return 0;
        let matched = 0;
        const win = getAppWindow();

        // 1. Cargar transferibles si están disponibles en RAM de EA
        if (win.repositories && win.repositories.Item && typeof win.repositories.Item.getTransferList === 'function') {
            try {
                const trItems = win.repositories.Item.getTransferList();
                if (trItems && trItems.length) {
                    for (const it of trItems) {
                        const itDefId = it.defId || it.resourceId;
                        if (itDefId) State.transferMatches[Number(itDefId)] = it;
                    }
                }
            } catch (e) { }
        }

        // 2. Comprobar al instante en el Club Index de Paletools si está cargado en RAM (0 peticiones a EA)
        try {
            if (typeof win.clubIndexDebug === 'function') {
                const ptDebug = win.clubIndexDebug();
                if (ptDebug && ptDebug.loaded && Array.isArray(ptDebug.players) && ptDebug.players.length > 0) {
                    for (const p of State.futbinSbcData.players) {
                        const eaId = Number(p.eaId);
                        if (eaId > 0 && !State.clubMatches[eaId] && !State.transferMatches[eaId] && !State.sellingMatches[eaId]) {
                            const match = ptDebug.players.find(it => matchesCard(it, eaId, p.name));
                            if (match) {
                                match._isTradeable = isItemTradeable(match);
                                State.clubMatches[eaId] = match;
                                State.clubScanned[eaId] = true;
                            }
                        }
                    }
                }
            }
        } catch (ePt) { }

        for (const p of State.futbinSbcData.players) {
            const eaId = Number(p.eaId);
            if (State.sellingMatches[eaId] || State.transferMatches[eaId] || State.clubMatches[eaId]) {
                matched++;
            }
            if (State.gems && State.gems.length > 0) {
                const ggGem = State.gems.find(g => Number(g.eaId) === eaId);
                if (ggGem) {
                    if (ggGem.estimatedPrice > 0) p.futggPrice = ggGem.estimatedPrice;
                    else if (ggGem.currentPrice > 0) p.futggPrice = ggGem.currentPrice;
                    if (ggGem.maxPrice > 0) p.futggMaxPrice = ggGem.maxPrice;
                }
            }
        }
        updateFutbinTabBadge();
        return matched;
    }

    async function scanClubForFutbinPlayers(isSilent = false) {
        if (!State.futbinSbcData || !State.futbinSbcData.players) {
            if (!isSilent) notificar("No hay soluciones SBC de FUTBIN cargadas.", "#ffaa00");
            return;
        }

        if (State.isScanningClub) {
            State.isScanningClub = false;
            State.forceCancelAllOperations = true;
            notificar("⏹️ Escaneo de club detenido por el usuario", "#ffaa00");
            renderBatchControls();
            return;
        }

        // 1. Coincidencia rápida en memoria RAM (0 peticiones de red)
        matchFutbinPlayersWithKnownItems();
        renderFutbinSbcTable();

        const missing = State.futbinSbcData.players.filter(p => {
            const eaId = Number(p.eaId);
            return eaId > 0 && !State.sellingMatches[eaId] && !State.transferMatches[eaId] && !State.clubMatches[eaId] && !State.soldMatches[eaId];
        });

        if (missing.length === 0) {
            if (!isSilent) notificar("✅ Todos los jugadores ya fueron verificados en tu cuenta", "#00ff88");
            return;
        }

        State.isScanningClub = true;
        State.forceCancelAllOperations = false;
        renderBatchControls();
        if (!isSilent) notificar(`🔍 Verificando ${missing.length} cartas en tu Club de forma ultrarrápida...`, "#00ccff");

        let found = 0;
        try {
            found = await findCardsInClubBatch(missing, isSilent);
        } finally {
            State.isScanningClub = false;
            updateFutbinTabBadge();
            persistFutbinState();
            renderFutbinSbcTable();
            renderBatchControls();
            if (found > 0 || !isSilent) {
                notificar(`✅ Escaneo de club completado: ${found} carta(s) encontrada(s)`, "#00ff88");
            }
        }
    }

    async function batchCheckFutbinMarketPrices() {
        if (State.isBatchRunning) {
            cancelBatch();
            return;
        }
        if (!State.futbinSbcData || !State.futbinSbcData.players) return;

        const playersToCheck = getFilteredFutbinPlayers();
        if (playersToCheck.length === 0) {
            notificar("No hay jugadores que coincidan con los filtros para consultar.", "#ffaa00");
            return;
        }

        State.isBatchRunning = true;
        State.forceCancelAllOperations = false;
        renderBatchControls();

        let count = 0;
        for (const p of playersToCheck) {
            if (!State.isBatchRunning || State.forceCancelAllOperations) break;
            count++;
            updateBatchStatus(`SBC (${count}/${playersToCheck.length}): Verificando ${p.name}...`);
            try {
                await checkMarketPrice(p, true);
            } catch (e) {
                console.error("Error en batch FUTBIN check:", e);
                break;
            }
            if (!State.isBatchRunning || State.forceCancelAllOperations) break;

            // Delay seguro y cancelable entre cartas para no saturar mercado
            await randomDelay(CONFIG.minMarketDelay, CONFIG.maxMarketDelay, () => !State.isBatchRunning || State.forceCancelAllOperations);
        }

        State.isBatchRunning = false;
        updateBatchStatus(State.forceCancelAllOperations ? "⏹️ Verificación detenida por el usuario." : "Comparación de mercado SBC completada.");
        persistFutbinState();
        renderBatchControls();
        renderFutbinSbcTable();
    }

    async function batchListFutbinProfitable() {
        if (State.isBatchRunning) return;
        if (!State.futbinSbcData || !State.futbinSbcData.players) return;

        const candidates = getFilteredFutbinPlayers().filter(p => {
            const eaId = Number(p.eaId);
            if (State.sellingMatches[eaId] || State.soldMatches[eaId]) return false;
            const inTransfer = State.transferMatches[eaId];
            const inClub = State.clubMatches[eaId];
            const isAvailable = inTransfer || (inClub && isItemTradeable(inClub));
            if (!isAvailable) return false;

            const market = State.marketPrices[eaId];
            if (!market || market.error || market.loading) return false;

            // Filtro clave: no listar si está a precio mínimo
            if (isMinimumPrice(p, market)) return false;

            return true;
        });

        if (candidates.length === 0) {
            notificar("No hay jugadores del SBC rentables listos para vender (o están a precio mínimo).", "#ffaa00");
            return;
        }

        State.isBatchRunning = true;
        renderBatchControls();

        let count = 0;
        for (const p of candidates) {
            if (!State.isBatchRunning || State.forceCancelAllOperations) break;
            count++;
            const market = State.marketPrices[p.eaId];
            const price = State.customPrices[p.eaId] || (market ? (market.isExtinct ? market.suggestedExtinctBin : Math.max(200, market.lowestBin - CONFIG.undercutAmount)) : 0);
            updateBatchStatus(`Listando ${count}/${candidates.length}: ${p.name} por ${formatCoins(price)}...`);

            await listCardOnMarket(p, price);
            await randomDelay(CONFIG.listDelay, CONFIG.listDelay + 1000, () => State.forceCancelAllOperations);
        }

        State.isBatchRunning = false;
        updateBatchStatus(`¡Listo! Se listaron ${count} cartas rentables del SBC.`);
        renderBatchControls();
        renderFutbinSbcTable();
    }

    function runFutbinAutoSyncBridge(cleanUrl, solutionCount = 5) {
        return new Promise((resolve, reject) => {
            const syncUrl = `${cleanUrl}${cleanUrl.includes('#') ? '&' : '#'}fc27_auto_sync=${solutionCount}`;
            const prevSyncTime = GM_getValue('futbin_sbc_sync_time', 0);

            notificar(`🔄 Sincronizando con tu sesión de FUTBIN en una pestaña rápida...`, "#00ccff");

            // Abrir la pestaña con la sesión activa de Chrome del usuario
            const syncWin = window.open(syncUrl, '_blank');

            let resolved = false;
            let listenerId = null;
            let pollInterval = null;
            let timeoutId = null;

            function cleanup() {
                if (listenerId && typeof GM_removeValueChangeListener === 'function') {
                    try { GM_removeValueChangeListener(listenerId); } catch (e) { }
                }
                if (pollInterval) clearInterval(pollInterval);
                if (timeoutId) clearTimeout(timeoutId);
            }

            function onDataReceived(data) {
                if (resolved) return;
                resolved = true;
                cleanup();

                if (data && data.players && data.players.length > 0) {
                    State.futbinSbcData = data;
                    persistFutbinState();
                    const badge = document.getElementById('futbin-tab-badge');
                    if (badge) badge.textContent = data.players.length;
                    notificar(`🟢 ¡${data.players.length} jugadores cargados del SBC "${data.challengeTitle || 'SBC'}"!`, "#00ff88");
                    matchFutbinPlayersWithKnownItems();
                    renderFutbinSbcTable();
                    renderFutbinSbcSelectOptions();
                    resolve(data);
                } else {
                    reject(new Error("No se recibieron cartas válidas de FUTBIN."));
                }
            }

            // 1. Escuchar actualización inmediata de almacenamiento de Tampermonkey
            if (typeof GM_addValueChangeListener === 'function') {
                try {
                    listenerId = GM_addValueChangeListener('futbin_sbc_sync_time', (name, oldVal, newVal) => {
                        if (newVal && newVal > prevSyncTime) {
                            const latest = GM_getValue('futbin_sbc_data', null);
                            if (latest) onDataReceived(latest);
                        }
                    });
                } catch (e) { }
            }

            // 2. Polling de respaldo cada 400ms por si el evento de storage se retrasa
            pollInterval = setInterval(() => {
                const currentSyncTime = GM_getValue('futbin_sbc_sync_time', 0);
                if (currentSyncTime > prevSyncTime) {
                    const latest = GM_getValue('futbin_sbc_data', null);
                    if (latest) onDataReceived(latest);
                }
            }, 400);

            // 3. Timeout prudente de 25s
            timeoutId = setTimeout(() => {
                if (!resolved) {
                    cleanup();
                    notificar("⚠️ Si la pestaña de FUTBIN quedó abierta, verifica que haya cargado y haz clic en '⚡ Enviar a Web App'.", "#ffaa00");
                    reject(new Error("Timeout al sincronizar con FUTBIN."));
                }
            }, 25000);
        });
    }

    // Descarga en segundo plano de soluciones comunitarias desde la Web App (sin abrir pestaña)
    function fetchFutbinSbcBackground(challengeUrl, solutionCount = 5) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                return reject(new Error("GM_xmlhttpRequest no disponible"));
            }

            console.log(`[FUTBIN Helper] ⚡ Iniciando descarga en segundo plano de: ${challengeUrl} (${solutionCount} soluciones)...`);
            updateBatchStatus(`Conectando con FUTBIN para ${solutionCount} soluciones...`);

            GM_xmlhttpRequest({
                method: 'GET',
                url: challengeUrl,
                headers: {
                    'User-Agent': navigator.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                onload: async function (res) {
                    if (res.status !== 200 || !res.responseText) {
                        return reject(new Error(`HTTP ${res.status} al conectar con página de desafío FUTBIN`));
                    }

                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(res.responseText, 'text/html');

                        // 1. Extraer título del desafío
                        const titleEl = doc.querySelector('h1, .challenge-name, .sbc-header-title');
                        let challengeTitle = titleEl ? titleEl.textContent.replace(/sbc/i, '').trim() : '';
                        if (!challengeTitle) {
                            const docTitle = doc.title || '';
                            const m = docTitle.match(/CHALLENGES\s*-\s*([^|]+)/i) || docTitle.match(/([^|]+)\|\s*FUTBIN/i);
                            challengeTitle = (m && m[1].trim()) || 'SBC Challenge';
                        }

                        // 2. Extraer URLs de soluciones comunitarias
                        const allLinks = Array.from(doc.querySelectorAll('a[href*="/27/squad/"][href*="/sbc"], a[href*="/27/squad/"]'))
                            .map(a => a.getAttribute('href') || a.href)
                            .filter(href => href && /\/27\/squad\/\d+/.test(href));

                        const uniqueUrls = [];
                        for (const raw of allLinks) {
                            const full = raw.startsWith('http') ? raw : `https://www.futbin.com${raw.startsWith('/') ? '' : '/'}${raw}`;
                            const clean = full.split('?')[0].split('#')[0];
                            const sbcUrl = clean.endsWith('/sbc') ? clean : clean + '/sbc';
                            if (!uniqueUrls.includes(sbcUrl)) {
                                uniqueUrls.push(sbcUrl);
                            }
                        }

                        const solutionUrls = uniqueUrls.slice(0, solutionCount);
                        if (solutionUrls.length === 0) {
                            // Verificar si es una página de Grupo de Desafíos (ej. Partidos de Marquesina /59)
                            const subLinks = Array.from(doc.querySelectorAll('a[href*="/Challenges/"], a[href*="/challenges/"], a[href*="/squad-building-challenges/Challenges/"]'));
                            const foundSubChallenges = [];
                            for (const a of subLinks) {
                                const rawHref = a.getAttribute('href') || a.href;
                                if (!rawHref || !rawHref.includes('/Challenges/')) continue;
                                const fullUrl = rawHref.startsWith('http') ? rawHref : `https://www.futbin.com${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;
                                const cleanUrl = fullUrl.split('?')[0].split('#')[0];
                                const nameEl = a.querySelector('.challenge-name, .sbc-name, h4, h5, span') || a;
                                let name = (nameEl.textContent || '').trim().replace(/\s+/g, ' ').replace(/sbc/i, '').trim();
                                if (name && cleanUrl && !foundSubChallenges.some(s => s.url.toLowerCase() === cleanUrl.toLowerCase())) {
                                    foundSubChallenges.push({
                                        group: `⚽ ${challengeTitle || 'Grupo SBC'}`,
                                        title: `⚽ ${name}`,
                                        url: cleanUrl
                                    });
                                }
                            }

                            if (foundSubChallenges.length > 0) {
                                console.log(`[FUTBIN Helper] 🌟 Se detectó página de grupo con ${foundSubChallenges.length} desafíos.`);
                                try {
                                    const catalog = getFutbinSbcCatalog();
                                    for (const sub of foundSubChallenges) {
                                        const existingIdx = catalog.findIndex(c => c.url.toLowerCase() === sub.url.toLowerCase());
                                        if (existingIdx >= 0) {
                                            catalog[existingIdx].title = sub.title;
                                            catalog[existingIdx].group = sub.group;
                                        } else {
                                            catalog.push(sub);
                                        }
                                    }
                                    GM_setValue('futbin_sbc_catalog', catalog);
                                    renderFutbinSbcSelectOptions();
                                } catch (e) { }

                                updateBatchStatus(`Grupo detectado (${foundSubChallenges.length} desafíos). Analizando el 1°: ${foundSubChallenges[0].title}...`);
                                notificar(`📋 Grupo con ${foundSubChallenges.length} desafíos. Analizando: ${foundSubChallenges[0].title}`, "#00ff88");

                                const sel = document.getElementById('futbin-sbc-select');
                                const urlInput = document.getElementById('futbin-sbc-url-input');
                                if (sel) sel.value = foundSubChallenges[0].url;
                                if (urlInput) urlInput.value = foundSubChallenges[0].url;

                                return resolve(await fetchFutbinSbcBackground(foundSubChallenges[0].url, solutionCount));
                            }

                            return reject(new Error("No se encontraron soluciones de plantilla en el HTML de FUTBIN"));
                        }

                        console.log(`[FUTBIN Helper] 📋 Se encontraron ${solutionUrls.length} soluciones comunitarias. Descargando...`);

                        const playerMap = new Map();

                        for (let i = 0; i < solutionUrls.length; i++) {
                            const sUrl = solutionUrls[i];
                            updateBatchStatus(`Descargando solución ${i + 1}/${solutionUrls.length}...`);

                            const sRes = await new Promise(r => {
                                GM_xmlhttpRequest({
                                    method: 'GET',
                                    url: sUrl,
                                    headers: {
                                        'User-Agent': navigator.userAgent,
                                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                                    },
                                    onload: r,
                                    onerror: () => r(null)
                                });
                            });

                            if (!sRes || sRes.status !== 200 || !sRes.responseText) {
                                console.warn(`[FUTBIN Helper] Error al descargar solución ${sUrl}`);
                                continue;
                            }

                            const sHtml = sRes.responseText;
                            const sDoc = parser.parseFromString(sHtml, 'text/html');
                            const squadPlayers = parsePlayersFromSquadDoc(sDoc, sHtml, i + 1);

                            for (const p of squadPlayers) {
                                if (!playerMap.has(p.eaId)) {
                                    playerMap.set(p.eaId, {
                                        eaId: p.eaId,
                                        name: p.name,
                                        rating: p.rating,
                                        position: p.position,
                                        quality: p.quality,
                                        futbinPrice: p.futbinPrice,
                                        estimatedPrice: p.futbinPrice || (p.quality === 'bronze' ? 200 : (p.quality === 'silver' ? 350 : 700)),
                                        frequency: 1,
                                        solutions: [i + 1],
                                        squadUrl: sUrl
                                    });
                                } else {
                                    const existing = playerMap.get(p.eaId);
                                    existing.frequency += 1;
                                    if (!existing.solutions.includes(i + 1)) {
                                        existing.solutions.push(i + 1);
                                    }
                                    if (p.futbinPrice > 0 && (!existing.futbinPrice || p.futbinPrice > existing.futbinPrice)) {
                                        existing.futbinPrice = p.futbinPrice;
                                        existing.estimatedPrice = p.futbinPrice;
                                    }
                                }
                            }

                            if (i < solutionUrls.length - 1) {
                                await new Promise(r => setTimeout(r, 200));
                            }
                        }

                        const aggregatedPlayers = Array.from(playerMap.values());
                        if (aggregatedPlayers.length === 0) {
                            return reject(new Error("No se pudieron extraer jugadores de las soluciones"));
                        }

                        aggregatedPlayers.sort((a, b) => {
                            if (b.frequency !== a.frequency) return b.frequency - a.frequency;
                            const qPrio = { 'bronze': 1, 'silver': 2, 'gold': 3 };
                            const qA = qPrio[a.quality] || 4;
                            const qB = qPrio[b.quality] || 4;
                            if (qA !== qB) return qA - qB;
                            return a.rating - b.rating;
                        });

                        const payload = {
                            challengeTitle: challengeTitle,
                            challengeUrl: challengeUrl,
                            solutionCount: solutionCount,
                            totalSolutionsFound: solutionUrls.length,
                            syncedAt: new Date().toLocaleTimeString(),
                            players: aggregatedPlayers
                        };

                        resolve(payload);
                    } catch (err) {
                        reject(err);
                    }
                },
                onerror: () => reject(new Error("Fallo de red en GM_xmlhttpRequest a FUTBIN"))
            });
        });
    }

    async function fetchFutbinSbcDirectly(rawUrl, solutionCount = 5) {
        if (!rawUrl) {
            notificar("Elige un desafío o pega una URL de FUTBIN", "#ffaa00");
            return;
        }

        let cleanUrl = rawUrl.trim();
        if (/^\d+$/.test(cleanUrl)) {
            cleanUrl = `https://www.futbin.com/27/squad-building-challenges/Challenges/${cleanUrl}`;
        } else if (!cleanUrl.startsWith('http')) {
            cleanUrl = `https://www.futbin.com${cleanUrl.startsWith('/') ? '' : '/'}${cleanUrl}`;
        }

        // Sanitizar URLs con IDs o slugs desactualizados
        if (cleanUrl.includes('/72/Spooky') || cleanUrl.includes('/72/spooky')) {
            cleanUrl = 'https://www.futbin.com/27/squad-building-challenges/Challenges/112/spooky-nights';
        } else if (cleanUrl.includes('/59')) {
            cleanUrl = 'https://www.futbin.com/27/squad-building-challenges/Challenges/96/psg-v-olympique-lyonnais';
        } else if (cleanUrl.includes('/60')) {
            cleanUrl = 'https://www.futbin.com/27/squad-building-challenges/Challenges/97/ssc-napoli-v-as-roma';
        }
        cleanUrl = cleanUrl.replace('/squad-building-challenge/', '/squad-building-challenges/');


        notificar(`⚡ Analizando soluciones de FUTBIN (${solutionCount} sol.)...`, "#00ccff");
        State.isBatchRunning = true;
        renderBatchControls();

        // 1. Intentar descarga en segundo plano directamente en este menú (sin abrir pestañas)
        try {
            updateBatchStatus(`Descargando datos del SBC desde FUTBIN...`);
            const data = await fetchFutbinSbcBackground(cleanUrl, solutionCount);
            if (data && data.players && data.players.length > 0) {
                State.isBatchRunning = false;
                renderBatchControls();
                State.futbinSbcData = data;
                persistFutbinState();
                updateFutbinTabBadge();
                matchFutbinPlayersWithKnownItems();
                renderFutbinSbcTable();
                renderFutbinSbcSelectOptions();
                notificar(`🟢 ¡${data.players.length} jugadores cargados del SBC "${data.challengeTitle || 'SBC'}"!`, "#00ff88");
                return;
            }
        } catch (eBg) {
            console.warn("[FUTBIN Helper] Descarga directa en segundo plano falló, recurriendo al puente de pestaña rápida:", eBg);
        } finally {
            State.isBatchRunning = false;
            renderBatchControls();
        }

        // 2. Si falló la descarga en segundo plano (ej: Cloudflare), recurrir a la pestaña rápida del usuario
        try {
            updateBatchStatus(`Sincronizando mediante pestaña activa de Chrome...`);
            await runFutbinAutoSyncBridge(cleanUrl, solutionCount);
        } catch (err) {
            console.error("[FUTBIN Helper] Error en puente de sincronización:", err);
            notificar("💡 Si no se abrió la pestaña, abre FUTBIN y haz clic en '⚡ Enviar a Web App'.", "#ffaa00");
        }
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
                overflow-x: auto;
                padding: 12px 14px;
            }
            .futgg-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
            }
            .futgg-table th {
                text-align: left;
                padding: 8px 6px;
                background: #131c28;
                color: #8fa0b5;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border-bottom: 1px solid #243346;
                position: sticky;
                top: -12px;
                z-index: 10;
                box-sizing: border-box;
            }
            .futgg-table td {
                padding: 8px 6px;
                border-bottom: 1px solid #1a2535;
                vertical-align: middle;
                box-sizing: border-box;
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
                gap: 6px;
            }
            .futgg-rating {
                font-weight: bold;
                font-size: 12px;
                padding: 2px 4px;
                border-radius: 4px;
                background: #202d3e;
                color: #00ff88;
                min-width: 20px;
                text-align: center;
                border: 1px solid #35475e;
                display: inline-block;
                flex-shrink: 0;
            }
            .futgg-rating.bronze {
                color: #cd7f32;
                border-color: #cd7f32;
                background: rgba(205, 127, 50, 0.18);
            }
            .futgg-rating.silver {
                color: #e2e8f0;
                border-color: #94a3b8;
                background: rgba(148, 163, 184, 0.18);
            }
            .futgg-rating.gold {
                color: #ffd700;
                border-color: #ffd700;
                background: rgba(255, 215, 0, 0.18);
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
                width: 58px !important;
                min-width: 50px !important;
                max-width: 65px !important;
                box-sizing: border-box !important;
                background: #131c28 !important;
                border: 1px solid #35475e !important;
                color: #fff !important;
                padding: 2px 4px !important;
                border-radius: 4px !important;
                font-size: 11px !important;
                font-weight: 700 !important;
                text-align: center !important;
                flex-shrink: 0 !important;
            }
            .futgg-price-input:focus { border-color: #00ff88 !important; outline: none !important; }

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

            /* PESTAÑAS DEL HEADER */
            .futgg-tab-bar {
                display: flex;
                align-items: center;
                gap: 4px;
                background: #0d1520;
                padding: 3px;
                border-radius: 10px;
                border: 1px solid #223348;
            }
            .futgg-tab-btn {
                background: transparent;
                border: none;
                color: #8fa0b5;
                padding: 6px 14px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
            }
            .futgg-tab-btn:hover {
                color: #ffffff;
                background: rgba(255, 255, 255, 0.05);
            }
            .futgg-tab-btn.active {
                background: #1f2e42;
                color: #00ff88;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            }
            .futgg-tab-badge {
                background: #00ff88;
                color: #0c1218;
                border-radius: 10px;
                padding: 1px 6px;
                font-size: 10px;
                font-weight: 800;
            }
            .futgg-quality-badge {
                font-size: 9px;
                font-weight: 800;
                padding: 2px 6px;
                border-radius: 4px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .futgg-quality-badge.bronze {
                background: rgba(205, 127, 50, 0.2);
                color: #cd7f32;
                border: 1px solid #cd7f32;
            }
            .futgg-quality-badge.silver {
                background: rgba(192, 192, 192, 0.2);
                color: #e2e8f0;
                border: 1px solid #a0aec0;
            }
            .futgg-quality-badge.gold {
                background: rgba(255, 215, 0, 0.2);
                color: #ffd700;
                border: 1px solid #ffd700;
            }
            .futgg-frequency-badge {
                background: rgba(255, 102, 0, 0.18);
                color: #ff7733;
                border: 1px solid #ff5500;
                border-radius: 6px;
                padding: 2px 7px;
                font-size: 11px;
                font-weight: 800;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .futgg-frequency-badge.hot {
                background: rgba(255, 68, 68, 0.22);
                color: #ff4444;
                border-color: #ff3333;
                box-shadow: 0 0 10px rgba(255, 68, 68, 0.35);
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
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="futgg-tab-bar">
                        <button class="futgg-tab-btn active" id="futgg-tab-futgg">💎 FUT.GG Hidden Gems (<span id="futgg-tab-badge">0</span>)</button>
                        <button class="futgg-tab-btn" id="futgg-tab-futbin">🧩 FUTBIN SBC Gems (<span id="futbin-tab-badge">0</span>)</button>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <label id="futgg-hide-sold-container" style="display:inline-flex; align-items:center; gap:6px; font-size:11px; color:#cbd5e1; cursor:pointer; background:#162232; border:1px solid #23344a; padding:4px 10px; border-radius:6px; user-select:none;" title="Ocultar jugadores que ya no tienes en tu club o que ya fueron vendidos">
                        <input type="checkbox" id="futgg-hide-sold-toggle" checked style="cursor:pointer; accent-color:#00ff88;" />
                        <span>Ocultar vendidas / fuera de club (<b id="futgg-hidden-count" style="color:#00ff88;">0</b>)</span>
                    </label>
                    <button class="futgg-btn" id="futgg-toggle-token-btn" style="padding:4px 10px; font-size:11px;" title="Configuración de Token JWT de FUT.GG">⚙️ Token</button>
                    <button class="futgg-close-btn" id="futgg-close-btn" title="Cerrar">&times;</button>
                </div>
            </div>

            <!-- Toolbar para FUT.GG -->
            <div id="futgg-toolbar" class="futgg-toolbar">
                <!-- Grupo Sincronización -->
                <div style="display:flex; gap:6px; align-items:center; background:#162232; padding:4px 6px; border-radius:8px; border:1px solid #23344a;">
                    <span style="font-size:10px; font-weight:700; color:#8fa0b5; text-transform:uppercase; margin-right:2px; letter-spacing:0.5px;">Sync:</span>
                    <button class="futgg-btn primary" id="futgg-refresh-btn" style="padding:5px 10px; font-size:11px;" title="Descarga de FUT.GG las joyas ocultas actuales (Auto-check cada 15 min)">🔄 Cargar Joyas</button>
                    <button class="futgg-btn" id="futgg-sync-club-remote-btn" style="padding:5px 10px; font-size:11px; border-color:#ff5500; color:#ff7733;" title="Envía la orden a FUT.GG para leer tu club de EA (Equivalente al botón Sync Club de su web)">☁️ Sync Club</button>
                    <button class="futgg-btn" id="futgg-scan-club-btn" style="padding:5px 10px; font-size:11px;" title="Comprueba si las joyas están en tu inventario local (Club, Transferibles, Sin Asignar)">🔍 Escanear Club</button>
                </div>

                <!-- Grupo Acciones en Lote -->
                <div style="display:flex; gap:6px; align-items:center; background:#162232; padding:4px 6px; border-radius:8px; border:1px solid #23344a;">
                    <span style="font-size:10px; font-weight:700; color:#8fa0b5; text-transform:uppercase; margin-right:2px; letter-spacing:0.5px;">Acciones:</span>
                    <button class="futgg-btn" id="futgg-batch-move-btn" style="padding:5px 10px; font-size:11px;" title="Mueve todas las joyas que tienes en el club a tu Lista de Transferibles">📥 Mover Todas</button>
                    <button class="futgg-btn" id="futgg-batch-check-btn" style="padding:5px 10px; font-size:11px;" title="Revisa el precio de mercado de todas las cartas de forma inteligente y segura (Tecla V)">📊 Chequear Mercado</button>
                    <button class="futgg-btn" id="futgg-batch-list-btn" style="padding:5px 10px; font-size:11px; border-color:#00ff88; color:#00ff88; font-weight:700;" title="Pone a la venta en el mercado las cartas revisadas">🚀 Listar Todas</button>
                </div>
            </div>

            <!-- Toolbar para Soluciones SBC de FUTBIN -->
            <div id="futbin-sbc-toolbar" class="futgg-toolbar" style="display:none; flex-wrap:wrap; gap:8px; justify-content:space-between; align-items:center;">
                <!-- Selección y Análisis Directo de Desafío SBC -->
                <div style="display:flex; align-items:center; gap:6px; background:#162232; padding:4px 8px; border-radius:8px; border:1px solid #23344a; flex-wrap:wrap;">
                    <span style="font-size:10px; font-weight:800; color:#00ff88; text-transform:uppercase;">🏆 Desafío:</span>
                    <select id="futbin-sbc-select" style="background:#101924; border:1px solid #2e4157; color:#fff; padding:4px 8px; border-radius:6px; font-size:11px; min-width:180px; max-width:240px; cursor:pointer;" title="Selecciona un desafío de FUTBIN">
                        <!-- Rellenado dinámicamente -->
                    </select>
                    <button class="futgg-btn" id="futbin-sbc-detect-btn" style="padding:4px 8px; font-size:11px; color:#00ccff; border-color:#00ccff; font-weight:700;" title="Detectar automáticamente el SBC que tienes abierto en pantalla en la Web App">🎯 Detectar</button>
                    <span style="font-size:10px; font-weight:700; color:#8fa0b5;">Soluciones:</span>
                    <select id="futbin-sbc-sol-count-select" style="background:#101924; border:1px solid #2e4157; color:#fff; padding:4px 6px; border-radius:6px; font-size:11px; cursor:pointer;" title="Cantidad de soluciones comunitarias más baratas a analizar">
                        <option value="1">Top 1</option>
                        <option value="3">Top 3</option>
                        <option value="5" selected>Top 5 (Recomendado)</option>
                        <option value="10">Top 10</option>
                    </select>
                    <button class="futgg-btn primary" id="futbin-sbc-fetch-btn" style="padding:4px 12px; font-size:11px; font-weight:700; white-space:nowrap;" title="Descargar y analizar soluciones comunitarias directamente desde este menú">⚡ Analizar SBC</button>
                    <button class="futgg-btn" id="futbin-sbc-open-web-btn" style="padding:4px 8px; font-size:11px;" title="Abrir página del desafío en FUTBIN en una nueva pestaña">🌐 Abrir Web</button>
                    <button class="futgg-btn" id="futbin-sbc-refresh-catalog-btn" style="padding:4px 8px; font-size:11px;" title="Actualizar lista de desafíos desde FUTBIN y Web App">🔄</button>
                    <button class="futgg-btn" id="futbin-reload-sbc-btn" style="padding:4px 8px; font-size:11px;" title="Restaurar último estado guardado del SBC">📥</button>
                </div>

                <!-- Input para URL personalizada (opcional) -->
                <div style="display:flex; align-items:center; gap:4px; background:#162232; padding:4px 6px; border-radius:8px; border:1px solid #23344a;">
                    <input type="text" id="futbin-sbc-url-input" placeholder="O pega URL de FUTBIN (opcional)..." style="width:190px; background:#101924; border:1px solid #2e4157; color:#fff; padding:4px 8px; border-radius:6px; font-size:11px;" title="Pega cualquier URL de desafío o plantilla de FUTBIN" />
                </div>

                <!-- Filtros requeridos por el usuario -->
                <div style="display:flex; align-items:center; gap:8px; background:#162232; padding:4px 8px; border-radius:8px; border:1px solid #23344a;">
                    <label style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:#cbd5e1; cursor:pointer;" title="Mostrar únicamente cartas de Bronce (≤64) y Plata (65-74) que son las que más suben de precio">
                        <input type="checkbox" id="futbin-filter-bronze-silver" checked style="cursor:pointer; accent-color:#00ff88;" />
                        <span>Bronces / Platas</span>
                    </label>
                    <label style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:#cbd5e1; cursor:pointer;" title="Mostrar únicamente jugadores que tienes en tu Club o Transferibles">
                        <input type="checkbox" id="futbin-filter-in-club" style="cursor:pointer; accent-color:#00ff88;" />
                        <span>En Mi Club</span>
                    </label>
                    <label style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:#cbd5e1; cursor:pointer;" title="Ocultar cartas que están a precio mínimo de descarte (no rentables para vender)">
                        <input type="checkbox" id="futbin-filter-hide-minimum" style="cursor:pointer; accent-color:#00ff88;" />
                        <span>Ocultar precio mín.</span>
                    </label>
                </div>

                <!-- Acciones en lote para FUTBIN SBC -->
                <div style="display:flex; gap:6px; align-items:center; background:#162232; padding:4px 6px; border-radius:8px; border:1px solid #23344a;">
                    <button class="futgg-btn" id="futbin-scan-club-btn" style="padding:5px 8px; font-size:11px;" title="Escanear tu club para ver cuáles de estos jugadores tienes">🔍 Buscar en Club</button>
                    <button class="futgg-btn" id="futbin-check-market-btn" style="padding:5px 8px; font-size:11px;" title="Revisar el precio de mercado real progresivo de estas cartas">📊 Chequear Mercado</button>
                    <button class="futgg-btn primary" id="futbin-list-profitable-btn" style="padding:5px 10px; font-size:11px;" title="Listar únicamente las cartas rentables que NO estén a precio mínimo">🚀 Listar Rentables</button>
                </div>
            </div>

            <!-- Banner Universal de Estado de Operación / Batch (visible en cualquier pestaña activa) -->
            <div id="futgg-batch-controls" style="display:none; align-items:center; justify-content:space-between; background:#1e293b; border:1px solid #ffaa00; padding:6px 12px; margin:6px 0; border-radius:8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:14px;">⏳</span>
                    <span id="futgg-batch-status" style="font-size:12px; color:#ffaa00; font-weight:bold;">Procesando...</span>
                </div>
                <button class="futgg-btn danger" id="futgg-cancel-batch-btn" style="padding:4px 12px; font-size:11px; font-weight:bold; background:#ef4444; color:#fff; border:none; cursor:pointer;" title="Detener inmediatamente la verificación o escaneo actual">⏹️ Detener Operación</button>
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

        // Pestañas
        document.getElementById('futgg-tab-futgg').onclick = () => switchTab('futgg');
        document.getElementById('futgg-tab-futbin').onclick = () => switchTab('futbin');

        // Controles de FUT.GG
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

        // Controles de FUTBIN SBC
        const sbcSelect = document.getElementById('futbin-sbc-select');
        if (sbcSelect) {
            sbcSelect.onchange = () => {
                const val = sbcSelect.value;
                const urlInput = document.getElementById('futbin-sbc-url-input');
                if (val === 'custom') {
                    if (urlInput) {
                        urlInput.focus();
                        urlInput.select();
                    }
                } else if (val && urlInput) {
                    let clean = val;
                    if (clean.includes('/72/Spooky') || clean.includes('/72/spooky')) {
                        clean = 'https://www.futbin.com/27/squad-building-challenges/Challenges/112/spooky-nights';
                    }
                    urlInput.value = clean;
                }
            };
        }

        const detectBtn = document.getElementById('futbin-sbc-detect-btn');
        if (detectBtn) {
            detectBtn.onclick = () => {
                const detected = detectWebappCurrentSbc();
                if (!detected || !detected.name || !isValidSbcName(detected.name)) {
                    notificar("⚠️ No estás dentro de un desafío SBC en la Web App (estás en la pantalla Inicio). Manteniendo el SBC seleccionado.", "#ffaa00");
                    return; // MANTENER LA SELECCIÓN ACTUAL DEL USUARIO, NUNCA CAMBIAR A HOME!
                }

                const dName = detected.name;
                const catalog = getFutbinSbcCatalog();
                const norm = dName.toLowerCase().replace(/[^a-z0-9]/g, '');

                // 1. Buscar en el catálogo por título normalizado
                let match = catalog.find(c => {
                    const cNorm = (c.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    return cNorm.includes(norm) || norm.includes(cNorm);
                });

                // 2. Buscar por palabras clave relevantes
                if (!match) {
                    const words = dName.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['desafio', 'challenge', 'partido', 'match', 'para'].includes(w));
                    if (words.length > 0) {
                        match = catalog.find(c => {
                            const cLower = (c.title || '').toLowerCase();
                            return words.some(w => cLower.includes(w));
                        });
                    }
                }

                const sel = document.getElementById('futbin-sbc-select');
                const urlInput = document.getElementById('futbin-sbc-url-input');

                if (match) {
                    if (sel) sel.value = match.url;
                    if (urlInput) urlInput.value = match.url;
                    notificar(`🎯 SBC detectado: ${match.title}`, "#00ff88");
                } else {
                    const slug = dName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    if (!slug || slug === 'home' || slug === 'inicio' || slug === 'sbc') {
                        notificar("⚠️ No se detectó un SBC específico abierto.", "#ffaa00");
                        return;
                    }
                    const tentativeUrl = `https://www.futbin.com/27/squad-building-challenges/Challenges/${slug}`;
                    const newEntry = {
                        group: "🎯 Detectados de Web App",
                        title: `🎯 ${detected.setName ? detected.setName + ': ' : ''}${dName}`,
                        url: tentativeUrl
                    };
                    catalog.unshift(newEntry);
                    GM_setValue('futbin_sbc_catalog', catalog);
                    renderFutbinSbcSelectOptions();
                    if (sel) sel.value = tentativeUrl;
                    if (urlInput) urlInput.value = tentativeUrl;
                    notificar(`🎯 Detectado: "${dName}". Listo para analizar o abrir en web.`, "#00ff88");
                }
            };
        }

        const openWebBtn = document.getElementById('futbin-sbc-open-web-btn');
        if (openWebBtn) {
            openWebBtn.onclick = () => {
                const urlInput = document.getElementById('futbin-sbc-url-input');
                const sel = document.getElementById('futbin-sbc-select');
                let targetUrl = (sel && sel.value && sel.value !== 'custom' ? sel.value : '') || (urlInput && urlInput.value.trim()) || (State.futbinSbcData && State.futbinSbcData.challengeUrl) || 'https://www.futbin.com/27/squad-building-challenges';
                if (targetUrl.includes('/72/Spooky') || targetUrl.includes('/72/spooky')) {
                    targetUrl = 'https://www.futbin.com/27/squad-building-challenges/Challenges/112/spooky-nights';
                }
                window.open(targetUrl, '_blank');
            };
        }

        const refreshCatalogBtn = document.getElementById('futbin-sbc-refresh-catalog-btn');
        if (refreshCatalogBtn) {
            refreshCatalogBtn.onclick = async () => {
                notificar("🔄 Consultando desafíos activos en FUTBIN y Web App...", "#00ccff");
                const list = await fetchFutbinChallengesCatalogRemote();
                renderFutbinSbcSelectOptions();
                if (list && list.length > 0) {
                    notificar(`🟢 ¡${list.length} desafíos SBC disponibles en el selector!`, "#00ff88");
                } else {
                    notificar("No se pudo conectar directamente con FUTBIN. Abre la web y se guardarán automáticamente.", "#ffaa00");
                }
            };
        }

        const futbinReloadBtn = document.getElementById('futbin-reload-sbc-btn');
        if (futbinReloadBtn) {
            futbinReloadBtn.onclick = () => {
                try {
                    restoreFutbinState();
                    if (State.futbinSbcData && State.futbinSbcData.players && State.futbinSbcData.players.length > 0) {
                        notificar(`🟢 SBC "${State.futbinSbcData.challengeTitle || 'SBC'}" restaurado (${State.futbinSbcData.players.length} jugadores)`, "#00ff88");
                        matchFutbinPlayersWithKnownItems();
                        renderFutbinSbcTable();
                        renderFutbinSbcSelectOptions();
                    } else {
                        notificar("No hay datos de soluciones válidos guardados aún de FUTBIN", "#ffaa00");
                    }
                } catch (e) { }
            };
        }

        const futbinFetchBtn = document.getElementById('futbin-sbc-fetch-btn');
        if (futbinFetchBtn) {
            futbinFetchBtn.onclick = () => {
                const urlInput = document.getElementById('futbin-sbc-url-input');
                const sel = document.getElementById('futbin-sbc-select');
                const countSelect = document.getElementById('futbin-sbc-sol-count-select');
                const count = countSelect ? parseInt(countSelect.value, 10) : 5;
                let targetUrl = (sel && sel.value && sel.value !== 'custom' ? sel.value : '') || (urlInput && urlInput.value.trim()) || (State.futbinSbcData && State.futbinSbcData.challengeUrl) || '';
                if (targetUrl.includes('/72/Spooky') || targetUrl.includes('/72/spooky')) {
                    targetUrl = 'https://www.futbin.com/27/squad-building-challenges/Challenges/112/spooky-nights';
                }
                if (targetUrl) {
                    fetchFutbinSbcDirectly(targetUrl, count);
                } else {
                    notificar("Elige un SBC de la lista o pega una URL de FUTBIN", "#ffaa00");
                }
            };
        }

        renderFutbinSbcSelectOptions();
        updateFutbinTabBadge();

        const fBronzeSilver = document.getElementById('futbin-filter-bronze-silver');
        if (fBronzeSilver) {
            fBronzeSilver.onchange = (e) => {
                State.futbinFilterOnlyBronzeSilver = e.target.checked;
                renderFutbinSbcTable();
            };
        }

        const fInClub = document.getElementById('futbin-filter-in-club');
        if (fInClub) {
            fInClub.onchange = (e) => {
                State.futbinFilterOnlyInClub = e.target.checked;
                renderFutbinSbcTable();
            };
        }

        const fHideMin = document.getElementById('futbin-filter-hide-minimum');
        if (fHideMin) {
            fHideMin.onchange = (e) => {
                State.futbinFilterHideMinimum = e.target.checked;
                renderFutbinSbcTable();
            };
        }

        const fScanClub = document.getElementById('futbin-scan-club-btn');
        if (fScanClub) fScanClub.onclick = scanClubForFutbinPlayers;
        const fCheckMarket = document.getElementById('futbin-check-market-btn');
        if (fCheckMarket) fCheckMarket.onclick = batchCheckFutbinMarketPrices;
        const fListProfitable = document.getElementById('futbin-list-profitable-btn');
        if (fListProfitable) fListProfitable.onclick = batchListFutbinProfitable;

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

            const gem = findAnyPlayerById(eaId);

            if (action === 'check-market') {
                if (gem) checkMarketPrice(gem, false, false);
            } else if (action === 'search-market-open') {
                if (gem) checkMarketPrice(gem, false, true);
            } else if (action === 'stop-market-crawl') {
                State.abortMarketCrawl[eaId] = true;
                if (State.marketPrices[eaId]) {
                    State.marketPrices[eaId].crawling = false;
                    State.marketPrices[eaId].loading = false;
                }
                notificar(`⏹️ Deteniendo análisis de mercado para ${gem ? gem.name : 'carta'}...`, "#ffaa00");
                renderCurrentTable();
            } else if (action === 'toggle-breakdown') {
                State.openPriceBreakdowns[eaId] = !State.openPriceBreakdowns[eaId];
                renderCurrentTable();
            } else if (action === 'pick-price') {
                const price = parseInt(btn.getAttribute('data-price'), 10);
                if (price && eaId) {
                    State.focusedGemId = eaId;
                    State.customPrices[eaId] = price;
                    renderCurrentTable();
                    notificar(`🎯 Precio seleccionado para ${gem ? gem.name : 'jugador'}: ${formatCoins(price)} (Puja: ${formatCoins(calculateStartBid(price))})`, "#00ff88");
                }
            } else if (action === 'open-in-webapp') {
                if (gem) openMarketSearchInWebApp(gem);
            } else if (action === 'move') {
                if (gem) moveToTransferList(gem);
            } else if (action === 'list') {
                if (gem) {
                    const row = btn.closest('tr');
                    const priceInput = row ? row.querySelector('.futgg-price-input') : null;
                    const priceVal = priceInput ? parseInt(priceInput.value.replace(/[^0-9]/g, ''), 10) : null;
                    const chosenPrice = (priceVal && priceVal > 0) ? priceVal : (State.customPrices[eaId] || null);
                    listCardOnMarket(gem, chosenPrice);
                }
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
                persistFutbinState();
                const cell = e.target.closest('td');
                if (cell) {
                    const b = cell.querySelector('b');
                    if (b) b.textContent = formatCoins(calculateStartBid(val));
                }
            }
        });

        setupFutbinSbcSyncListener();
    }

    // Listener reactivo global para sincronizaciones emitidas desde FUTBIN
    function setupFutbinSbcSyncListener() {
        if (State.futbinSyncListenerRegistered) return;
        if (typeof GM_addValueChangeListener === 'function') {
            try {
                State.futbinSyncListenerRegistered = true;
                GM_addValueChangeListener('futbin_sbc_sync_time', (name, oldVal, newVal) => {
                    const latest = GM_getValue('futbin_sbc_data', null);
                    if (latest && latest.players) {
                        State.futbinSbcData = latest;
                        persistFutbinState();
                        const badge = document.getElementById('futbin-tab-badge');
                        if (badge) badge.textContent = latest.players.length;
                        if (State.activeTab === 'futbin') {
                            notificar(`🧩 Soluciones del SBC "${latest.challengeTitle || 'SBC'}" actualizadas desde FUTBIN`, "#00ff88");
                            matchFutbinPlayersWithKnownItems();
                            renderFutbinSbcTable();
                            renderFutbinSbcSelectOptions();
                        }
                    }
                });
            } catch (e) {
                console.warn("[FUTBIN Helper] Error al registrar GM_addValueChangeListener:", e);
            }
        }
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
        const isRunning = State.isBatchRunning || State.isScanningClub;
        if (batchControls) {
            batchControls.style.display = isRunning ? 'flex' : 'none';
        }

        // Botón Chequear Mercado en pestaña FUT.GG
        const hgBtn = document.getElementById('futgg-batch-check-btn');
        if (hgBtn) {
            if (State.isBatchRunning && State.activeTab === 'futgg') {
                hgBtn.innerHTML = '⏹️ Detener Mercado';
                hgBtn.style.borderColor = '#ff4444';
                hgBtn.style.color = '#ff6666';
            } else {
                hgBtn.innerHTML = '📊 Chequear Mercado';
                hgBtn.style.borderColor = '';
                hgBtn.style.color = '';
            }
        }

        // Botón Chequear Mercado en pestaña FUTBIN
        const fbBtn = document.getElementById('futbin-check-market-btn');
        if (fbBtn) {
            if (State.isBatchRunning && State.activeTab === 'futbin') {
                fbBtn.innerHTML = '⏹️ Detener Mercado';
                fbBtn.style.borderColor = '#ff4444';
                fbBtn.style.color = '#ff6666';
            } else {
                fbBtn.innerHTML = '📊 Chequear Mercado';
                fbBtn.style.borderColor = '';
                fbBtn.style.color = '';
            }
        }

        // Botón Buscar en Club en pestaña FUTBIN
        const fbScanBtn = document.getElementById('futbin-scan-club-btn');
        if (fbScanBtn) {
            if (State.isScanningClub) {
                fbScanBtn.innerHTML = '⏹️ Detener Escaneo';
                fbScanBtn.style.borderColor = '#ff4444';
                fbScanBtn.style.color = '#ff6666';
            } else {
                fbScanBtn.innerHTML = '🔍 Buscar en Club';
                fbScanBtn.style.borderColor = '';
                fbScanBtn.style.color = '';
            }
        }
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

            // Sincronizar precios de FUT.GG con jugadores SBC de FUTBIN si existen
            matchFutbinPlayersWithKnownItems();
            if (State.activeTab === 'futbin') {
                renderFutbinSbcTable();
            }

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
        let current = State.customPrices[eaId];
        if (!current) {
            const player = findAnyPlayerById(eaId);
            const market = State.marketPrices[eaId];
            if (market && market.lowestBin) {
                current = (market.hasOutlier ? market.realisticBin : market.lowestBin) - CONFIG.undercutAmount;
            } else if (player) {
                current = player.estimatedPrice || player.futggPrice || player.futbinPrice;
            }
            if (!current || current <= 0) current = 1000;
        }
        const step = getBidStep(current);
        const nextPrice = direction > 0 ? current + step : Math.max(200, current - step);
        State.customPrices[eaId] = roundToValidBid(nextPrice, direction > 0 ? 'up' : 'down');
        persistFutbinState();
        renderCurrentTable();
    }

    function renderGemsTable() {
        const container = document.getElementById('futgg-table-container');
        if (!container) return;

        if (State.activeTab === 'futbin') {
            renderFutbinSbcTable();
            return;
        }

        const scrollContainer = document.getElementById('futgg-body') || container;
        const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

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
                        <th style="width:20%; min-width:125px;">Jugador</th>
                        <th style="width:10%; min-width:75px;">Ref. FUT.GG</th>
                        <th style="width:4%; min-width:36px; text-align:center;" title="Estado en tu Club">Club</th>
                        <th style="width:26%; min-width:145px;">Mercado en Vivo</th>
                        <th style="width:18%; min-width:125px; white-space:nowrap;">Precio Venta</th>
                        <th style="width:22%; min-width:160px; text-align:center; white-space:nowrap;">Acción</th>
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
            let customPrice = State.customPrices[eaId];
            if (!customPrice) {
                if (market && market.isExtinct) {
                    customPrice = market.suggestedExtinctBin || roundToValidBid(Math.round(getItemMaxPrice(eaId, gem) * 0.90), 'down');
                    State.customPrices[eaId] = customPrice;
                } else {
                    customPrice = gem.estimatedPrice || 0;
                }
            }

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

            // Estado del club (solo emojis con tooltip)
            let clubStatusHtml = '';
            if (selling) {
                const remainingSec = selling.expiresAt ? Math.max(0, Math.floor((selling.expiresAt - Date.now()) / 1000)) : (selling.expires || 0);
                const timeStr = formatTimeRemaining(remainingSec);
                clubStatusHtml = `
                    <div style="text-align:center;" title="En venta activa (expira en ${timeStr})">
                        <span style="font-size:16px; cursor:help;">🚀</span>
                        <div style="font-size:9px; color:#00ccff; white-space:nowrap; line-height:1; margin-top:1px;">${timeStr}</div>
                    </div>
                `;
            } else if (inTransfer) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="En Lista de Transferibles (listo para listar)">📋</span></div>`;
            } else if (inClub) {
                const isTradeable = isItemTradeable(inClub);
                clubStatusHtml = isTradeable
                    ? `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="En tu Club (Tradeable / Transferible)">🟢</span></div>`
                    : `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="En tu Club (Intransferible)">🔒</span></div>`;
            } else if (sold) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="Ya vendido">✅</span></div>`;
            } else if (hasScanned) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; opacity:0.35; cursor:help;" title="Fuera del Club">⚪</span></div>`;
            } else {
                clubStatusHtml = `
                    <div style="text-align:center;">
                        <button class="futgg-btn" style="padding:2px 5px; font-size:10px;" data-action="search-club" data-eaid="${eaId}" title="Buscar en mi club">🔍</button>
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
                marketHtml = `
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="color:#ffaa00; font-weight:bold; font-size:11px;">⏳ Buscando...</span>
                        <button class="futgg-btn danger" style="padding:2px 6px; font-size:10px;" data-action="stop-market-crawl" data-eaid="${eaId}">⏹️ Parar</button>
                    </div>
                `;
            } else if (market && market.listed) {
                marketHtml = `<span style="color:#00ff88; font-weight:bold;">🚀 Listado a ${formatCoins(market.price)}</span>`;
            } else if (market && market.isExtinct) {
                const extinctPrice = market.suggestedExtinctBin || market.lowestBin || State.customPrices[eaId] || roundToValidBid(Math.round(getItemMaxPrice(eaId, gem) * 0.90), 'down');
                marketHtml = `
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span class="futgg-tag extinct" style="background:rgba(239, 68, 68, 0.2); border:1px solid #ef4444; color:#fca5a5; font-weight:800;" title="No hay cartas activas en el mercado. Sugerimos vender al 90% del rango máx (${formatCoins(market.maxPrice || getItemMaxPrice(eaId, gem))}) para evitar baneos">💎 ¡Extinta! (90% máx: ${formatCoins(extinctPrice)})</span>
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
                    <div style="display:flex; flex-direction:column; gap:2px; min-width:115px;">
                        <div style="display:inline-flex; align-items:center; gap:2px; flex-wrap:nowrap;">
                            <button class="futgg-btn" style="padding:2px 6px; font-size:11px; flex-shrink:0; font-weight:bold; line-height:1;" data-action="adjust-price" data-dir="-1" data-eaid="${eaId}">-</button>
                            <input type="text" class="futgg-price-input" data-eaid="${eaId}" value="${customPrice}" style="width:58px !important; min-width:50px; max-width:65px; flex-shrink:0; text-align:center;" />
                            <button class="futgg-btn" style="padding:2px 6px; font-size:11px; flex-shrink:0; font-weight:bold; line-height:1;" data-action="adjust-price" data-dir="1" data-eaid="${eaId}">+</button>
                        </div>
                        <div style="font-size:10px; color:#8fa0b5; white-space:nowrap; margin-top:2px;">
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
                const isExtinct = market && market.isExtinct;
                actionHtml = `
                    <div style="display:inline-flex; gap:4px; align-items:center; justify-content:center; flex-wrap:nowrap; white-space:nowrap;">
                        <button class="futgg-btn ${isExtinct ? '' : 'primary'}" style="padding:3px 9px; font-size:11px; flex-shrink:0; white-space:nowrap; ${isExtinct ? 'background:#b91c1c; border-color:#ef4444; color:#fff; font-weight:bold;' : ''}" data-action="list" data-eaid="${eaId}" title="${isExtinct ? `Listar carta extinta al 90% del máximo (${formatCoins(customPrice)})` : 'Listar en el mercado por el precio elegido'}">${isExtinct ? '💎 Listar (90%)' : '🚀 Listar'}</button>
                    </div>
                `;
            } else if (inClub && isItemTradeable(inClub)) {
                const isExtinct = market && market.isExtinct;
                actionHtml = `
                    <div style="display:inline-flex; gap:4px; align-items:center; justify-content:center; flex-wrap:nowrap; white-space:nowrap;">
                        <button class="futgg-btn" style="padding:3px 7px; font-size:11px; flex-shrink:0; white-space:nowrap;" data-action="move" data-eaid="${eaId}" title="Mover a Transferibles">📥 Mover</button>
                        <button class="futgg-btn ${isExtinct ? '' : 'primary'}" style="padding:3px 9px; font-size:11px; flex-shrink:0; white-space:nowrap; ${isExtinct ? 'background:#b91c1c; border-color:#ef4444; color:#fff; font-weight:bold;' : ''}" data-action="list" data-eaid="${eaId}" title="${isExtinct ? `Listar carta extinta al 90% del máximo (${formatCoins(customPrice)})` : 'Listar directamente en el mercado'}">${isExtinct ? '💎 Listar (90%)' : '🚀 Listar'}</button>
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
                            <span class="futgg-rating ${gem.quality || (gem.rating <= 64 ? 'bronze' : (gem.rating <= 74 ? 'silver' : 'gold'))}">${gem.rating || '---'}</span>
                            <div style="min-width:0;">
                                <div style="font-weight:700; color:#fff; display:flex; align-items:center; gap:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    <span style="overflow:hidden; text-overflow:ellipsis;">${gem.name}</span>
                                    ${selling ? '<span class="futgg-tag selling" style="font-size:9px; font-weight:800; padding:1px 4px; flex-shrink:0;">🚀 VENTA</span>' : ''}
                                    ${State.newGemIds && State.newGemIds.has(eaId) ? '<span class="futgg-new-badge" style="flex-shrink:0;">✨</span>' : ''}
                                </div>
                                <div style="font-size:10px; color:#8fa0b5; margin-top:1px;">${gem.club || 'Club'} (ID: ${eaId})</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="font-weight:700; color:#ffcc00;">${formatCoins(gem.estimatedPrice)}</div>
                        <div style="font-size:10px; color:#00ff88;">+${formatCoins(gem.profit)} benef.</div>
                    </td>
                    <td style="text-align:center; padding:6px 2px;">${clubStatusHtml}</td>
                    <td>${marketHtml}</td>
                    <td style="white-space:nowrap; min-width:125px;">${priceColHtml}</td>
                    <td style="text-align:center; white-space:nowrap; min-width:160px;">${actionHtml}</td>
                </tr>
            `;
        }

        html += `</tbody></table>`;
        container.innerHTML = html;

        // Mantener la posición exacta de scroll para continuar con la siguiente carta sin saltos
        if (scrollContainer) {
            scrollContainer.scrollTop = savedScrollTop;
        }
    }

    // =========================================================================
    // RENDERIZADO DE TABLA DE SOLUCIONES FUTBIN SBC
    // =========================================================================
    function renderFutbinSbcTable() {
        const container = document.getElementById('futgg-table-container');
        if (!container) return;

        const scrollContainer = document.getElementById('futgg-body') || container;
        const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

        // Si no hay datos de FUTBIN SBC
        if (!State.futbinSbcData || !State.futbinSbcData.players || State.futbinSbcData.players.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding: 60px 20px; color:#8fa0b5;">
                    <div style="font-size:36px; margin-bottom:12px;">🧩</div>
                    <div style="font-size:16px; font-weight:700; color:#fff; margin-bottom:8px;">No hay Soluciones SBC de FUTBIN cargadas</div>
                    <div style="font-size:13px; max-width:550px; margin:0 auto 20px auto; line-height:1.6; color:#cbd5e1;">
                        Puedes cargar las soluciones de 2 formas muy sencillas:<br/>
                        1. Abre cualquier desafío en <a href="https://www.futbin.com/27/squad-building-challenges/Challenges/112/spooky-nights" target="_blank" style="color:#00ff88; font-weight:bold; text-decoration:underline;">FUTBIN</a> y presiona el botón flotante <b>"⚡ Enviar a Web App"</b>.<br/>
                        2. O pega la URL del SBC en el campo de arriba y haz clic en <b>"⚡ Analizar"</b>.
                    </div>
                    <div style="display:flex; justify-content:center; gap:10px;">
                        <button class="futgg-btn primary" onclick="window.open('https://www.futbin.com/27/squad-building-challenges/Challenges/112/spooky-nights', '_blank')">🌐 Abrir Spooky Nights en FUTBIN</button>
                    </div>
                </div>
            `;
            return;
        }

        const sbc = State.futbinSbcData;
        const activeTitleEl = document.getElementById('futbin-sbc-active-title');
        if (activeTitleEl) {
            activeTitleEl.textContent = `${sbc.challengeTitle || 'SBC'} (${sbc.solutionCount || 5} sol.)`;
            activeTitleEl.title = `${sbc.challengeTitle} - ${sbc.solutionCount} soluciones analizadas`;
        }

        updateFutbinTabBadge();

        const displayedPlayers = getFilteredFutbinPlayers();

        // Si los filtros excluyeron todo
        if (displayedPlayers.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding: 50px 20px; color:#8fa0b5;">
                    <div style="font-size:32px; margin-bottom:10px;">🔍</div>
                    <div style="font-size:15px; font-weight:700; color:#fff; margin-bottom:6px;">Ningún jugador coincide con los filtros activos</div>
                    <div style="font-size:12px; color:#cbd5e1; max-width:480px; margin:0 auto 16px auto;">
                        Tienes activos los filtros:
                        ${State.futbinFilterOnlyBronzeSilver ? '<b>[Bronces/Platas]</b> ' : ''}
                        ${State.futbinFilterOnlyInClub ? '<b>[En Mi Club]</b> ' : ''}
                        ${State.futbinFilterHideMinimum ? '<b>[Ocultar Mínimo]</b> ' : ''}.<br/>
                        Desmarca "En Mi Club" para ver todas las cartas requeridas por el SBC o haz clic en <b>"🔍 Buscar en Club"</b> para comprobar si las tienes.
                    </div>
                    <button class="futgg-btn primary" id="futbin-reset-filters-btn" style="padding:6px 14px; font-size:12px;">Desactivar filtro "En Mi Club"</button>
                </div>
            `;
            const rBtn = document.getElementById('futbin-reset-filters-btn');
            if (rBtn) {
                rBtn.onclick = () => {
                    State.futbinFilterOnlyInClub = false;
                    const chk = document.getElementById('futbin-filter-in-club');
                    if (chk) chk.checked = false;
                    renderFutbinSbcTable();
                };
            }
            return;
        }

        // Ordenamiento inteligente:
        // 1. Cartas ya en venta activa van al final
        // 2. Disponibles para vender (en transferibles o en club tradeable)
        // 3. Si ya fue consultado en mercado: mayor valor de mercado / ganancia real
        // 4. Frecuencia en soluciones (los más repetidos en squads)
        // 5. Menor rating (bronces y platas primero)
        displayedPlayers.sort((a, b) => {
            const eaIdA = Number(a.eaId);
            const eaIdB = Number(b.eaId);
            const sellingA = !!State.sellingMatches[eaIdA];
            const sellingB = !!State.sellingMatches[eaIdB];

            if (sellingA && !sellingB) return 1;
            if (!sellingA && sellingB) return -1;

            const inClubA = State.clubMatches[eaIdA];
            const inClubB = State.clubMatches[eaIdB];
            const inTransferA = State.transferMatches[eaIdA];
            const inTransferB = State.transferMatches[eaIdB];
            const isAvailA = inTransferA || (inClubA && isItemTradeable(inClubA));
            const isAvailB = inTransferB || (inClubB && isItemTradeable(inClubB));

            if (isAvailA && !isAvailB) return -1;
            if (!isAvailA && isAvailB) return 1;

            const marketA = State.marketPrices[eaIdA];
            const marketB = State.marketPrices[eaIdB];
            const isMinA = marketA && !marketA.error && !marketA.loading && isMinimumPrice(a, marketA);
            const isMinB = marketB && !marketB.error && !marketB.loading && isMinimumPrice(b, marketB);

            // Si una carta ya fue consultada y está a precio mínimo de descarte, mandarla al fondo de las disponibles
            if (!isMinA && isMinB) return -1;
            if (isMinA && !isMinB) return 1;

            const priceA = marketA && !marketA.error ? (marketA.hasOutlier ? marketA.realisticBin : (marketA.lowestBin || 0)) : (a.futggPrice || a.futbinPrice || a.estimatedPrice || 0);
            const priceB = marketB && !marketB.error ? (marketB.hasOutlier ? marketB.realisticBin : (marketB.lowestBin || 0)) : (b.futggPrice || b.futbinPrice || b.estimatedPrice || 0);

            if (priceB !== priceA) return priceB - priceA;
            if (b.frequency !== a.frequency) return b.frequency - a.frequency;
            return a.rating - b.rating;
        });

        const gemsCountEl = document.getElementById('futgg-gems-count');
        if (gemsCountEl) {
            gemsCountEl.textContent = `SBC: ${displayedPlayers.length} cartas mostradas (de ${sbc.players.length} en ${sbc.solutionCount || 5} soluciones)`;
        }

        let html = `
            <table class="futgg-table">
                <thead>
                    <tr>
                        <th style="width:16%; min-width:115px;">Jugador SBC</th>
                        <th style="width:4%; min-width:36px; text-align:center;" title="Estado en tu Club">Club</th>
                        <th style="width:9%; min-width:66px;">Frec. SBC</th>
                        <th style="width:9%; min-width:65px;">Ref. GG</th>
                        <th style="width:25%; min-width:145px;">Mercado Real (EA)</th>
                        <th style="width:17%; min-width:125px; white-space:nowrap;">Listar Por</th>
                        <th style="width:20%; min-width:155px; text-align:center; white-space:nowrap;">Acción</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (const p of displayedPlayers) {
            const eaId = Number(p.eaId);
            const inClub = State.clubMatches[eaId];
            const inTransfer = State.transferMatches[eaId];
            const selling = State.sellingMatches[eaId];
            const sold = State.soldMatches[eaId];
            const market = State.marketPrices[eaId];

            // Estado en Club (solo emojis con tooltip)
            let clubStatusHtml = '';
            if (selling) {
                const expiresMin = formatTimeRemaining(selling.expires);
                clubStatusHtml = `
                    <div style="text-align:center;" title="En venta activa por ${formatCoins(selling.buyNow)} (expira en ${expiresMin})">
                        <span style="font-size:16px; cursor:help;">🚀</span>
                        <div style="font-size:9px; color:#00ccff; white-space:nowrap; line-height:1; margin-top:1px;">${expiresMin}</div>
                    </div>
                `;
            } else if (inTransfer) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="En Lista de Transferibles (listo para listar)">📋</span></div>`;
            } else if (inClub && isItemTradeable(inClub)) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="En tu Club (Tradeable / Transferible)">🟢</span></div>`;
            } else if (inClub && !isItemTradeable(inClub)) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="En tu Club (Intransferible)">🔒</span></div>`;
            } else if (sold) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="Ya vendido">✅</span></div>`;
            } else if (State.isScanningClub && !State.clubScanned[eaId]) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; cursor:help;" title="Comprobando club...">⏳</span></div>`;
            } else if (State.clubScanned[eaId]) {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; opacity:0.35; cursor:help;" title="No encontrado en tu club">⚪</span></div>`;
            } else {
                clubStatusHtml = `<div style="text-align:center;"><span style="font-size:16px; opacity:0.35; cursor:help;" title="Pendiente de comprobar">❓</span></div>`;
            }

            // Frecuencia en Soluciones
            const freqPercent = Math.round((p.frequency / (sbc.solutionCount || 5)) * 100);
            const isHot = p.frequency >= 3;
            const solList = (p.solutions || []).map(s => `#${s}`).join(', ');
            const freqHtml = `
                <div class="futgg-frequency-badge ${isHot ? 'hot' : ''}" title="Aparece en las soluciones ${solList} (${freqPercent}%)">
                    <span>${isHot ? '🔥' : '🧩'} ${p.frequency}/${sbc.solutionCount || 5} Sol.</span>
                </div>
                <div style="font-size:10px; color:#8fa0b5; margin-top:2px;">Sol: ${solList}</div>
            `;

            // Calidad
            const qClass = p.quality || (p.rating <= 64 ? 'bronze' : (p.rating <= 74 ? 'silver' : 'gold'));
            const qBadge = `<span class="futgg-quality-badge ${qClass}">${qClass}</span>`;

            // Columna Mercado Real
            let marketHtml = '';
            if (!market) {
                marketHtml = `
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button class="futgg-btn" style="padding:4px 8px; font-size:11px;" data-action="check-market" data-eaid="${eaId}" title="Buscar en mercado con filtro progresivo">🔍 Consultar</button>
                        <button class="futgg-btn" style="padding:4px 6px; font-size:10px; color:#8fa0b5;" data-action="search-market-open" data-eaid="${eaId}" title="Búsqueda abierta sin tope de precio">🌐 Sin tope</button>
                    </div>
                `;
            } else if (market.loading || market.crawling) {
                marketHtml = `
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-size:11px; color:#00ccff; font-weight:bold;">⏳ Buscando...</span>
                        <button class="futgg-btn danger" style="padding:2px 6px; font-size:10px;" data-action="stop-market-crawl" data-eaid="${eaId}" title="Detener búsqueda">⏹️ Parar</button>
                    </div>
                    <div style="font-size:10px; color:#8fa0b5; margin-top:2px;">Filtro: ${market.filterLabel || 'Iniciando...'}</div>
                `;
            } else if (market.error) {
                marketHtml = `
                    <div style="color:#ff5555; font-size:11px;">⚠️ Error mercado</div>
                    <button class="futgg-btn" style="padding:2px 6px; font-size:10px; margin-top:2px;" data-action="check-market" data-eaid="${eaId}">Reintentar</button>
                `;
            } else if (market.isExtinct) {
                const extinctPrice = market.suggestedExtinctBin || market.lowestBin || State.customPrices[eaId] || roundToValidBid(Math.round(getItemMaxPrice(eaId, p) * 0.90), 'down');
                marketHtml = `
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span class="futgg-tag extinct" style="background:rgba(239, 68, 68, 0.2); border:1px solid #ef4444; color:#fca5a5; font-weight:800;" title="No hay cartas activas en el mercado (0 listadas). Rango máx: ${formatCoins(market.maxPrice || getItemMaxPrice(eaId, p))}. Sugerimos listar al 90% para evitar baneo por venta al techo máximo.">💎 ¡Extinta! (90% máx: ${formatCoins(extinctPrice)})</span>
                        <button class="futgg-btn" style="padding:4px 8px; font-size:12px;" data-action="check-market" data-eaid="${eaId}" title="Reintentar">🔄</button>
                    </div>
                `;
            } else if (market.lowestBin) {
                const isBreakdownOpen = !!State.openPriceBreakdowns[eaId];
                const diff = (market.hasOutlier ? market.realisticBin : market.lowestBin) - (p.estimatedPrice || p.futbinPrice || 0);
                const diffColor = diff >= 0 ? '#00ff88' : '#ff5555';
                const hasMore = market.hasMore;
                const isMin = isMinimumPrice(p, market);
                const isInflated = isInflatedGem(p, market);

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
                                    const isSel = State.customPrices[eaId] === t.price;
                                    return `
                                        <div class="futgg-tier-row ${t.isOutlier ? 'outlier' : ''} ${isSel ? 'selected' : ''}" data-action="pick-price" data-eaid="${eaId}" data-price="${t.price}" title="Clic para elegir vender a ${formatCoins(t.price)}">
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
                                    : `<b style="color:${isInflated ? '#00ff88' : (isMin ? '#ffaa00' : '#fff')}; font-size:13px;">Min BIN: ${formatCoins(market.lowestBin)}</b>`
                                }
                                <div style="font-size:10px; color:#8fa0b5; display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin-top:2px;">
                                    <span>${market.count}${hasMore ? '+' : ''} activas ${market.filterLabel ? `<span style="color:#38bdf8;">(${market.filterLabel})</span>` : ''}</span>
                                    ${isMin ? '<span class="futgg-tag none" style="border:1px solid #ffaa00; color:#ffaa00; font-weight:700;">⚠️ Precio Mínimo</span>' : ''}
                                    ${isInflated ? '<span class="futgg-tag club" style="border:1px solid #00ff88; color:#00ff88; font-weight:800;">🔥 ¡GEMA INFLADA!</span>' : ''}
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
                marketHtml = `
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button class="futgg-btn" style="padding:4px 8px; font-size:11px;" data-action="check-market" data-eaid="${eaId}">🔍 Consultar</button>
                        <button class="futgg-btn" style="padding:4px 6px; font-size:10px; color:#8fa0b5;" data-action="search-market-open" data-eaid="${eaId}">🌐 Sin tope</button>
                    </div>
                `;
            }

            // Columna Precio de Venta
            let priceColHtml = '';
            let suggested = State.customPrices[eaId];
            if (!suggested && market) {
                if (market.isExtinct) {
                    suggested = market.suggestedExtinctBin || roundToValidBid(Math.round(getItemMaxPrice(eaId, p) * 0.90), 'down');
                    State.customPrices[eaId] = suggested;
                } else if (market.lowestBin) {
                    suggested = Math.max(200, (market.hasOutlier ? market.realisticBin : market.lowestBin) - CONFIG.undercutAmount);
                }
            }
            if (!suggested) {
                suggested = p.futggPrice || p.futbinPrice || (p.quality === 'bronze' ? 200 : (p.quality === 'silver' ? 350 : 700));
            }

            if (suggested > 0) {
                const isMin = market ? isMinimumPrice(p, market) : false;
                const isExtinct = market && market.isExtinct;
                const borderStyle = isExtinct ? 'border:1px solid #ef4444; color:#fca5a5; font-weight:bold;' : (isMin ? 'border-color:#ffaa00; color:#ffaa00;' : '');
                priceColHtml = `
                    <div style="display:inline-flex; align-items:center; gap:3px; flex-wrap:nowrap;">
                        <button class="futgg-btn" style="padding:2px 6px; font-size:11px; flex-shrink:0; font-weight:bold; line-height:1;" data-action="adjust-price" data-dir="-1" data-eaid="${eaId}">-</button>
                        <input type="text" class="futgg-price-input" data-eaid="${eaId}" value="${suggested}" style="width:58px; min-width:50px; flex-shrink:0; ${borderStyle}" />
                        <button class="futgg-btn" style="padding:2px 6px; font-size:11px; flex-shrink:0; font-weight:bold; line-height:1;" data-action="adjust-price" data-dir="1" data-eaid="${eaId}">+</button>
                    </div>
                    <div style="font-size:10px; color:${isExtinct ? '#fca5a5' : '#8fa0b5'}; margin-top:2px; white-space:nowrap;">
                        ${isExtinct ? '🛡️ 90% Máx | ' : ''}Puja: <b>${formatCoins(calculateStartBid(suggested))}</b>
                    </div>
                `;
            } else {
                priceColHtml = `<span style="color:#64748b; font-size:11px; white-space:nowrap;">Consultar mercado</span>`;
            }

            // Columna Acciones
            let actionHtml = '';
            const isMin = market ? isMinimumPrice(p, market) : false;
            const isExtinct = market && market.isExtinct;
            if (selling) {
                actionHtml = `<span style="font-size:11px; color:#00ccff; font-weight:bold; white-space:nowrap;">🚀 En venta</span>`;
            } else if (inTransfer) {
                if (isExtinct) {
                    actionHtml = `
                        <button class="futgg-btn" style="padding:4px 10px; font-size:11px; background:#b91c1c; border-color:#ef4444; color:#fff; font-weight:bold; flex-shrink:0; white-space:nowrap;" data-action="list" data-eaid="${eaId}" title="Listar carta extinta al 90% del rango máximo (${formatCoins(suggested)})">💎 Listar (90%)</button>
                    `;
                } else if (isMin) {
                    actionHtml = `
                        <button class="futgg-btn" style="padding:4px 8px; font-size:10px; border-color:#ffaa00; color:#ffaa00; flex-shrink:0; white-space:nowrap;" data-action="list" data-eaid="${eaId}" title="⚠️ Carta a precio mínimo de descarte. Si la vendes no da beneficio.">⚠️ Mínimo</button>
                    `;
                } else {
                    actionHtml = `
                        <button class="futgg-btn primary" style="padding:4px 10px; font-size:11px; flex-shrink:0; white-space:nowrap;" data-action="list" data-eaid="${eaId}" title="Listar de inmediato por ${formatCoins(suggested)}">🚀 Listar</button>
                    `;
                }
            } else if (inClub && isItemTradeable(inClub)) {
                if (isExtinct) {
                    actionHtml = `
                        <div style="display:inline-flex; gap:4px; align-items:center; justify-content:center; flex-wrap:nowrap;">
                            <button class="futgg-btn" style="padding:3px 6px; font-size:10px; flex-shrink:0; white-space:nowrap;" data-action="move" data-eaid="${eaId}" title="Mover a Transferibles">📥 Mover</button>
                            <button class="futgg-btn" style="padding:3px 8px; font-size:10px; background:#b91c1c; border-color:#ef4444; color:#fff; font-weight:bold; flex-shrink:0; white-space:nowrap;" data-action="list" data-eaid="${eaId}" title="Listar carta extinta al 90% del rango máximo (${formatCoins(suggested)})">💎 Listar (90%)</button>
                        </div>
                    `;
                } else if (isMin) {
                    actionHtml = `
                        <div style="display:inline-flex; gap:4px; align-items:center; justify-content:center; flex-wrap:nowrap;">
                            <button class="futgg-btn" style="padding:3px 6px; font-size:10px; flex-shrink:0; white-space:nowrap;" data-action="move" data-eaid="${eaId}" title="Mover a Transferibles">📥 Mover</button>
                            <span style="font-size:10px; color:#ffaa00; align-self:center; white-space:nowrap;" title="Precio mínimo de descarte">⚠️ Mínimo</span>
                        </div>
                    `;
                } else {
                    actionHtml = `
                        <div style="display:inline-flex; gap:4px; align-items:center; justify-content:center; flex-wrap:nowrap;">
                            <button class="futgg-btn" style="padding:3px 6px; font-size:10px; flex-shrink:0; white-space:nowrap;" data-action="move" data-eaid="${eaId}" title="Mover a Transferibles">📥 Mover</button>
                            <button class="futgg-btn primary" style="padding:3px 8px; font-size:10px; flex-shrink:0; white-space:nowrap;" data-action="list" data-eaid="${eaId}" title="Listar de inmediato">🚀 Listar</button>
                        </div>
                    `;
                }
            } else if (inClub && !isItemTradeable(inClub)) {
                actionHtml = `<span style="font-size:11px; color:#64748b; font-style:italic; white-space:nowrap;">🔒 Intransferible</span>`;
            } else if (sold) {
                actionHtml = `<span style="font-size:11px; color:#64748b; white-space:nowrap;">✅ Ya Vendido</span>`;
            } else {
                actionHtml = `
                    <button class="futgg-btn" style="padding:3px 8px; font-size:10px; flex-shrink:0; white-space:nowrap;" data-action="search-club" data-eaid="${eaId}" title="Buscar en mi club">🔍 Escanear</button>
                `;
            }

            const isFocused = State.focusedGemId && Number(State.focusedGemId) === eaId;
            const rowClass = `${selling ? 'row-selling' : ''} ${isFocused ? 'futgg-row-focused' : ''}`.trim();

            html += `
                <tr class="${rowClass}" data-eaid="${eaId}" id="futgg-row-${eaId}">
                    <td>
                        <div class="futgg-player-cell">
                            <span class="futgg-rating ${qClass}">${p.rating || '---'}</span>
                            <div style="min-width:0;">
                                <div style="font-weight:700; color:#fff; display:flex; align-items:center; gap:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${p.name} (${p.position || ''})">
                                    <span style="overflow:hidden; text-overflow:ellipsis;">${p.name}</span>
                                    <span style="font-size:10px; color:#00ff88; font-weight:800; flex-shrink:0;">${p.position || ''}</span>
                                </div>
                                <div style="font-size:10px; color:#8fa0b5; margin-top:1px;">ID: ${eaId}</div>
                            </div>
                        </div>
                    </td>
                    <td style="text-align:center; padding:6px 2px;">${clubStatusHtml}</td>
                    <td>${freqHtml}</td>
                    <td>
                        ${(p.futggPrice && p.futggPrice > 0) ? `
                            <div style="font-weight:700; color:#00ff88; display:flex; align-items:center; gap:4px;" title="Precio de mercado en FUT.GG">
                                <span>${formatCoins(p.futggPrice)}</span>
                                <span style="font-size:9px; background:rgba(0, 255, 136, 0.2); color:#00ff88; border:1px solid #00ff88; border-radius:3px; padding:0 3px; font-weight:800;">GG</span>
                            </div>
                        ` : (p.futbinPrice && p.futbinPrice > 0) ? `
                            <div style="font-weight:700; color:#ffcc00; display:flex; align-items:center; gap:4px;" title="Precio estimado de FUTBIN">
                                <span>${formatCoins(p.futbinPrice)}</span>
                                <span style="font-size:9px; background:rgba(255, 204, 0, 0.2); color:#ffcc00; border:1px solid #ffcc00; border-radius:3px; padding:0 3px; font-weight:800;">BIN</span>
                            </div>
                        ` : `
                            <span style="color:#8fa0b5; font-size:11px;" title="Precio mínimo base de mercado para esta calidad">${p.quality === 'bronze' ? '200 (Mín)' : (p.quality === 'silver' ? '350 (Mín)' : '700 (Mín)')}</span>
                        `}
                    </td>
                    <td>${marketHtml}</td>
                    <td style="white-space:nowrap; min-width:125px;">${priceColHtml}</td>
                    <td style="text-align:center; white-space:nowrap; min-width:155px;">${actionHtml}</td>
                </tr>
            `;
        }

        html += `</tbody></table>`;
        container.innerHTML = html;

        // Mantener la posición exacta de scroll para continuar con la siguiente carta sin saltos
        if (scrollContainer) {
            scrollContainer.scrollTop = savedScrollTop;
        }
    }

    // Auto-actualización periódica de tiempos restantes en vivo cada 15s si el panel está visible
    setInterval(() => {
        if (State.isOpen && Object.keys(State.sellingMatches).length > 0) {
            renderCurrentTable();
        }
    }, 15000);

    // Exponer globalmente también en window y unsafeWindow
    const win = getAppWindow();
    win.__futggCheckMarket = (id) => {
        const gem = findAnyPlayerById(id);
        if (gem) checkMarketPrice(gem, false);
    };
    win.__futggMoveToTransfer = (id) => {
        const gem = findAnyPlayerById(id);
        if (gem) moveToTransferList(gem);
    };
    win.__futggListCard = (id) => {
        const gem = findAnyPlayerById(id);
        if (gem) listCardOnMarket(gem);
    };

    // Interceptor activo de modales: suprime de inmediato carteles de "Destination full / Lista llena"
    try {
        const dialogObserver = new MutationObserver((mutations) => {
            let shouldCheck = false;
            for (const m of mutations) {
                if (m.addedNodes && m.addedNodes.length > 0) {
                    shouldCheck = true;
                    break;
                }
                if (m.type === 'attributes' && m.target && m.target.classList && m.target.classList.contains('ut-click-shield')) {
                    shouldCheck = true;
                    break;
                }
            }
            if (shouldCheck) {
                scheduleDismissEaDialog();
            }
        });
        dialogObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

        // Intervalo de seguridad para cerrar modales fantasma de Destination Full
        setInterval(dismissEaDialogIfPresent, 600);
    } catch (e) { }

    // Atajo de teclado global: Alt + G para abrir/cerrar el panel
    window.addEventListener('keydown', function (e) {
        if (e.altKey && (e.key === 'g' || e.key === 'G')) {
            e.preventDefault();
            togglePanel();
        }
    });

    // Inicializar UI y listeners
    setupPackOpeningListener();
    setupFutbinSbcSyncListener();

    // Gancho de auto-sincronización cuando Paletools carga su índice de club en RAM
    try {
        const win = getAppWindow();
        win.addEventListener('clubIndexLoaded', () => {
            console.log("%c[FC 27 Helper] ⚡ Evento 'clubIndexLoaded' de Paletools recibido. Sincronizando jugadores del club en RAM...", "color:#00ff88; font-weight:bold;");
            if (State.activeTab === 'futbin') {
                matchFutbinPlayersWithKnownItems();
                renderFutbinSbcTable();
            } else if (State.gems && State.gems.length > 0) {
                findCardsInClubBatch(State.gems, true).then(() => {
                    renderGemsTable();
                });
            }
        });
    } catch (e) { }

    window.addEventListener('load', () => {
        setTimeout(createUI, 2000);
    });

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(createUI, 2000);
    }

})();
