// ==UserScript==
// @name         varoFCtools FC 27
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Grid 2 columnas con nombres y stats gigantes, atajos y calculadora EA Tax
// @author       varo
// @license      MIT
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("%c[varoFCtools FC 27] v5.1 - 2 Columnas con nombre y stats gigantes", "color: #00ff88; font-weight: bold; font-size: 14px;");

    // ==========================================
    // CONFIGURACIÓN Y LOCALSTORAGE
    // ==========================================
    const DEFAULT_BINDS = {
        comprarYa: 'b',
        pujar: 'p',
        compararPrecio: 'c',
        anadirTransferibles: 'l',
        buscar: 'Enter',
        volverAtras: 'Escape',
        cartaArriba: 'ArrowUp',
        cartaAbajo: 'ArrowDown',
        pagAnterior: 'ArrowLeft',
        pagSiguiente: 'ArrowRight',
        toggleGrid: 'g',
        pujaMinDec: '1',
        pujaMinInc: '2',
        pujaMaxDec: '3',
        pujaMaxInc: '4',
        compraMinDec: '5',
        compraMinInc: '6',
        compraMaxDec: '7',
        compraMaxInc: '8',
        reiniciarFiltros: 'r'
    };

    const ETIQUETAS = {
        comprarYa: 'Comprar Ya',
        pujar: 'Pujar',
        compararPrecio: 'Comparar Precio',
        anadirTransferibles: 'Añadir a Transferibles',
        buscar: 'Buscar en Mercado',
        volverAtras: 'Volver Atrás',
        toggleGrid: 'Alternar Vista Grid',
        cartaArriba: 'Seleccionar Carta Arriba',
        cartaAbajo: 'Seleccionar Carta Abajo',
        pagAnterior: 'Página Anterior',
        pagSiguiente: 'Página Siguiente',
        pujaMinDec: 'Puja Mínima (-)',
        pujaMinInc: 'Puja Mínima (+)',
        pujaMaxDec: 'Puja Máxima (-)',
        pujaMaxInc: 'Puja Máxima (+)',
        compraMinDec: 'Compra Ya Mín. (-)',
        compraMinInc: 'Compra Ya Mín. (+)',
        compraMaxDec: 'Compra Ya Máx. (-)',
        compraMaxInc: 'Compra Ya Máx. (+)',
        reiniciarFiltros: 'Reiniciar Filtros'
    };

    function cargarBinds() {
        try {
            const guardados = localStorage.getItem('varofctools_keybinds');
            if (guardados) return Object.assign({}, DEFAULT_BINDS, JSON.parse(guardados));
        } catch(e){}
        return Object.assign({}, DEFAULT_BINDS);
    }

    function guardarBinds(binds) {
        localStorage.setItem('varofctools_keybinds', JSON.stringify(binds));
    }

    let KeyBinds = cargarBinds();
    let gridActivo = localStorage.getItem('varofctools_grid') !== 'false';

    function formatearNombreTecla(tecla) {
        if (!tecla) return '---';
        if (tecla === ' ') return 'Espacio';
        if (tecla === 'ArrowUp') return '↑';
        if (tecla === 'ArrowDown') return '↓';
        if (tecla === 'ArrowLeft') return '←';
        if (tecla === 'ArrowRight') return '→';
        if (tecla === 'Escape') return 'Esc';
        return tecla.toUpperCase();
    }

    // ==========================================
    // ESTILOS DE 2 COLUMNAS FIJAS Y STATS GIGANTES
    // ==========================================
    const customStyle = document.createElement('style');
    customStyle.id = 'vfc-styles';
    customStyle.innerHTML = `
        .ut-navigation-container-view--content {
            max-width: 100% !important;
            width: 100% !important;
        }
        .ut-split-view {
            max-width: 100% !important;
        }
        .ut-split-view.sidebar-right .ut-content {
            flex: 1 1 auto !important;
            max-width: none !important;
        }

        /* 2 COLUMNAS FIJAS Y AMPLIAS */
        .vfc-grid-on .paginated-item-list ul.paginated,
        .vfc-grid-on ul.itemList {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 14px !important;
            padding: 10px 0 !important;
        }

        /* TARJETA ESPACIOSA */
        .vfc-grid-on li.listFUTItem {
            position: relative !important;
            display: block !important;
            width: 100% !important;
            height: 138px !important;
            margin: 0 !important;
            padding: 0 !important;
            border-radius: 10px !important;
            background: rgba(16, 24, 38, 0.95) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            transition: border-color 0.15s ease, background 0.15s ease !important;
        }

        .vfc-grid-on li.listFUTItem:hover {
            border-color: #00ff88 !important;
            background: rgba(22, 34, 52, 0.95) !important;
        }

        .vfc-grid-on li.listFUTItem.selected {
            border-color: #00ff88 !important;
            background: rgba(16, 45, 50, 0.95) !important;
            box-shadow: 0 0 12px rgba(0, 255, 136, 0.4) !important;
        }

        .vfc-grid-on li.listFUTItem .rowContent {
            position: relative !important;
            width: 100% !important;
            height: 100% !important;
        }

        /* 1. Cromo a la izquierda a tamaño nativo y nítido */
        .vfc-grid-on li.listFUTItem .entityContainer {
            position: absolute !important;
            left: 14px !important;
            top: 50% !important;
            transform: translateY(-50%) scale(1.02) !important;
            transform-origin: left center !important;
        }

        /* 2. Nombre del futbolista (Gigante en 22px) */
        .vfc-grid-on li.listFUTItem .name {
            position: absolute !important;
            left: 125px !important;
            top: 16px !important;
            font-size: 22px !important;
            font-weight: 800 !important;
            color: #ffffff !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            max-width: calc(100% - 215px) !important;
            margin: 0 !important;
            letter-spacing: 0.4px !important;
            text-shadow: 0 2px 4px rgba(0,0,0,0.6) !important;
        }

        /* 3. Bloque de estadísticas gigante ocupando el espacio horizontal */
        .vfc-grid-on li.listFUTItem .player-stats-data-component {
            position: absolute !important;
            left: 125px !important;
            bottom: 16px !important;
            width: 390px !important;
            max-width: calc(100% - 215px) !important;
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .vfc-grid-on li.listFUTItem .player-stats-data-component ul {
            display: flex !important;
            flex-direction: row !important;
            justify-content: space-between !important;
            align-items: center !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            list-style: none !important;
        }

        .vfc-grid-on li.listFUTItem .player-stats-data-component li {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            min-width: 44px !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .vfc-grid-on li.listFUTItem .player-stats-data-component li .label {
            font-size: 13px !important;
            font-weight: 700 !important;
            color: #94a3b8 !important;
            text-transform: uppercase !important;
            margin-bottom: 4px !important;
            line-height: 1 !important;
            letter-spacing: 0.5px !important;
        }

        .vfc-grid-on li.listFUTItem .player-stats-data-component li .value {
            font-size: 22px !important;
            font-weight: 900 !important;
            color: #ffffff !important;
            line-height: 1 !important;
            text-shadow: 0 2px 4px rgba(0,0,0,0.8) !important;
        }

        /* 4. Precios bien visibles y elegantes a la derecha */
        .vfc-grid-on li.listFUTItem .auction {
            position: absolute !important;
            right: 20px !important;
            top: 50% !important;
            transform: translateY(-50%) !important;
            width: 175px !important;
            min-width: 175px !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            align-items: flex-end !important;
            padding-left: 18px !important;
            border-left: 1px solid rgba(255, 255, 255, 0.15) !important;
            box-sizing: border-box !important;
        }

        .vfc-grid-on li.listFUTItem .auction > div {
            display: flex !important;
            flex-direction: row !important;
            justify-content: space-between !important;
            width: 100% !important;
            margin: 2px 0 !important;
            font-size: 13px !important;
        }

        .vfc-grid-on li.listFUTItem .auction .label {
            font-size: 12px !important;
            color: #94a3b8 !important;
            margin-right: 6px !important;
        }

        .vfc-grid-on li.listFUTItem .auction .value {
            font-weight: 800 !important;
            color: #ffcc00 !important;
            font-size: 15px !important;
        }

        .vfc-grid-on li.listFUTItem .auction .time {
            color: #00ccff !important;
            font-size: 13px !important;
            font-weight: 700 !important;
        }

        /* Botones de cálculo automático de precio */
        .vfc-tax-btn {
            flex: 1;
            background: #192333;
            color: #00ff88;
            border: 1px solid #2d415b;
            border-radius: 5px;
            padding: 6px 4px;
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            text-align: center;
            user-select: none;
            transition: all 0.15s ease;
        }
        .vfc-tax-btn:hover {
            background: #223249;
            border-color: #00ff88;
            transform: translateY(-1px);
        }
        .vfc-tax-btn:active {
            transform: scale(0.96);
        }
    `;
    document.head.appendChild(customStyle);

    function aplicarEstadoGrid() {
        if (gridActivo) {
            document.body.classList.add('vfc-grid-on');
        } else {
            document.body.classList.remove('vfc-grid-on');
        }
        localStorage.setItem('varofctools_grid', gridActivo);
        const btnGrid = document.getElementById('vfc-btn-grid');
        if (btnGrid) {
            btnGrid.textContent = gridActivo ? '⊞ Grid: ON [G]' : '☰ Lista: ON [G]';
            btnGrid.style.color = gridActivo ? '#00ff88' : '#aaa';
            btnGrid.style.borderColor = gridActivo ? '#00ff88' : '#3a475d';
        }
    }

    function toggleGrid() {
        gridActivo = !gridActivo;
        aplicarEstadoGrid();
        notificar(gridActivo ? "⊞ Grid 2 Columnas Activado" : "☰ Lista Normal", "#00ff88");
    }

    // ==========================================
    // SIMULADOR DE CLIC Y NOTIFICACIONES
    // ==========================================
    function pulsarElemento(el) {
        if (!el) return false;
        if (el.disabled || el.classList.contains('disabled')) return false;

        try { el.focus(); } catch(e){}
        const tipos = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        tipos.forEach(tipo => {
            el.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true }));
        });
        if (typeof el.click === 'function') el.click();
        return true;
    }

    function notificar(texto, color = '#00ff88') {
        let toast = document.getElementById('varofctools-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'varofctools-toast';
            Object.assign(toast.style, {
                position: 'fixed',
                top: '70px',
                right: '25px',
                backgroundColor: 'rgba(12, 18, 28, 0.95)',
                color: '#fff',
                padding: '10px 18px',
                borderRadius: '8px',
                fontFamily: 'Segoe UI, sans-serif',
                fontSize: '13px',
                fontWeight: 'bold',
                zIndex: '1000000',
                borderLeft: `5px solid ${color}`,
                boxShadow: '0 4px 15px rgba(0,0,0,0.6)',
                transition: 'opacity 0.25s ease',
                pointerEvents: 'none',
                opacity: '0'
            });
            document.body.appendChild(toast);
        }
        toast.style.borderLeftColor = color;
        toast.innerHTML = texto;
        toast.style.opacity = '1';
        clearTimeout(toast.timeout);
        toast.timeout = setTimeout(() => { toast.style.opacity = '0'; }, 1500);
    }

    function redondearAlPasoFUT(precio) {
        if (precio <= 150) return 150;
        let paso = 50;
        if (precio < 1000) paso = 50;
        else if (precio < 10000) paso = 100;
        else if (precio < 50000) paso = 250;
        else if (precio < 100000) paso = 500;
        else paso = 1000;

        return Math.ceil(precio / paso) * paso;
    }

    function calcularSiguientePaso(precioActual, direccion) {
        let actual = parseInt(precioActual, 10);
        if (isNaN(actual) || actual < 150) return direccion > 0 ? 150 : 0;

        let paso = 50;
        if (direccion > 0) {
            if (actual < 1000) paso = 50;
            else if (actual < 10000) paso = 100;
            else if (actual < 50000) paso = 250;
            else if (actual < 100000) paso = 500;
            else paso = 1000;
            return actual + paso;
        } else {
            if (actual <= 150) return 0;
            if (actual <= 1000) paso = 50;
            else if (actual <= 10000) paso = 100;
            else if (actual <= 50000) paso = 250;
            else if (actual <= 100000) paso = 500;
            else paso = 1000;
            return Math.max(0, actual - paso);
        }
    }

    function setInputValor(input, valor) {
        if (!input) return;
        input.focus();
        input.value = valor === 0 ? '' : valor.toString();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function parseMonedas(texto) {
        if (!texto) return 0;
        return parseInt(texto.toString().replace(/[^0-9]/g, ''), 10) || 0;
    }

    function formatoMonedas(num) {
        return num.toLocaleString('es-ES');
    }

    function aplicarPrecioObjetivo(porcentajeBeneficio) {
        const elemAdquirido = document.querySelector('.boughtPrice .boughtPriceValue')
                           || document.querySelector('.auctionInfo .subContent');
        const costeCompra = elemAdquirido ? parseMonedas(elemAdquirido.textContent) : 0;

        if (costeCompra <= 0) {
            notificar("⚠️ Carta de coste 0 (Sobre o 1er Propietario)", "#ffaa00");
            return;
        }

        const netoDeseado = costeCompra * (1 + porcentajeBeneficio);
        const precioBruto = netoDeseado / 0.95;
        const precioCompraYa = redondearAlPasoFUT(precioBruto);

        const pasoInferior = calcularSiguientePaso(precioCompraYa, -1);
        const precioInicial = Math.max(150, pasoInferior);

        const panelListing = document.querySelector('.ut-quick-list-panel-view .panelActions.open');
        if (!panelListing) return;

        const inputsPrecios = panelListing.querySelectorAll('.ut-numeric-input-spinner-control input');
        if (inputsPrecios.length >= 2) {
            setInputValor(inputsPrecios[0], precioInicial);
            setInputValor(inputsPrecios[1], precioCompraYa);

            actualizarCalculadoraTax();
            const pctLabel = porcentajeBeneficio === 0 ? '0% (Sin pérdidas)' : `+${Math.round(porcentajeBeneficio * 100)}% neto`;
            notificar(`🎯 Cajas fijadas para ${pctLabel} (${formatoMonedas(precioCompraYa)})`, "#00ff88");
        }
    }

    function actualizarCalculadoraTax() {
        const panelListing = document.querySelector('.ut-quick-list-panel-view .panelActions.open');
        if (!panelListing) return;

        let contenedorTax = document.getElementById('varofctools-tax-container');
        if (!contenedorTax) {
            contenedorTax = document.createElement('div');
            contenedorTax.id = 'varofctools-tax-container';
            Object.assign(contenedorTax.style, {
                margin: '8px 0',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: '#121924',
                border: '1px solid #29384d',
                fontFamily: 'Segoe UI, sans-serif',
                fontSize: '12px',
                color: '#e0e0e0',
                transition: 'border-color 0.2s ease'
            });

            const btnListar = panelListing.querySelector('button.btn-standard.primary');
            if (btnListar) panelListing.insertBefore(contenedorTax, btnListar);
            else panelListing.appendChild(contenedorTax);
        }

        const elemAdquirido = document.querySelector('.boughtPrice .boughtPriceValue')
                           || document.querySelector('.auctionInfo .subContent');
        const costeCompra = elemAdquirido ? parseMonedas(elemAdquirido.textContent) : 0;

        const inputsPrecios = panelListing.querySelectorAll('.ut-numeric-input-spinner-control input');
        const inputCompraYa = inputsPrecios.length >= 2 ? inputsPrecios[1] : inputsPrecios[0];
        const precioVenta = inputCompraYa ? parseMonedas(inputCompraYa.value) : 0;

        if (precioVenta === 0) {
            contenedorTax.innerHTML = `<span style="color:#888;">Introduce un precio de venta para calcular margen...</span>`;
            contenedorTax.style.borderColor = '#29384d';
            return;
        }

        const eaTax = Math.ceil(precioVenta * 0.05);
        const netoRecibido = precioVenta - eaTax;
        const beneficio = netoRecibido - costeCompra;

        let color = '#00ff88';
        let icono = '🟢';
        let textoEstado = 'GANANCIA';

        if (costeCompra > 0) {
            if (beneficio < 0) {
                color = '#ff3b30';
                icono = '🔴';
                textoEstado = 'PÉRDIDA';
            } else if (beneficio === 0) {
                color = '#ffcc00';
                icono = '🟡';
                textoEstado = 'EMPATE (0)';
            }
        } else {
            textoEstado = '1er Propietario / Sobre (Coste 0)';
        }

        contenedorTax.style.borderColor = color;
        const porcentaje = costeCompra > 0 ? ((beneficio / costeCompra) * 100).toFixed(1) : '100';

        contenedorTax.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:11px; color:#aaa;">
                <span>Adquirido: <b>${costeCompra > 0 ? formatoMonedas(costeCompra) : 'Gratis'}</b></span>
                <span>EA Tax (-5%): <b style="color:#ff8888;">-${formatoMonedas(eaTax)}</b></span>
                <span>Recibes neto: <b style="color:#fff;">${formatoMonedas(netoRecibido)}</b></span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #222d3d; padding-top:6px; margin-top:4px;">
                <span style="font-weight:bold; color:${color}; font-size:13px;">${icono} ${textoEstado}</span>
                <span style="font-weight:bold; font-size:13px; color:${color};">
                    ${beneficio >= 0 ? '+' : ''}${formatoMonedas(beneficio)} monedas (${beneficio >= 0 ? '+' : ''}${porcentaje}%)
                </span>
            </div>
            <div style="display:flex; gap:6px; margin-top:8px; border-top:1px solid #222d3d; padding-top:8px;">
                <button id="vfc-btn-auto-0" class="vfc-tax-btn" style="color:#ffcc00;">🛡️ 0% (Empate)</button>
                <button id="vfc-btn-auto-5" class="vfc-tax-btn" style="color:#00ff88;">⚡ +5% Neto</button>
                <button id="vfc-btn-auto-10" class="vfc-tax-btn" style="color:#00ff88;">🚀 +10% Neto</button>
            </div>
        `;

        document.getElementById('vfc-btn-auto-0').onclick = (e) => { e.preventDefault(); aplicarPrecioObjetivo(0.00); };
        document.getElementById('vfc-btn-auto-5').onclick = (e) => { e.preventDefault(); aplicarPrecioObjetivo(0.05); };
        document.getElementById('vfc-btn-auto-10').onclick = (e) => { e.preventDefault(); aplicarPrecioObjetivo(0.10); };
    }

    // ==========================================
    // CONTROLADORES DE ACCIONES
    // ==========================================
    const Control = {
        buscar: function() {
            let btn = document.querySelector('.ut-market-search-filters-view .button-container button.primary')
                   || document.querySelector('.button-container button.btn-standard.primary');
            if (!btn) {
                const botones = document.querySelectorAll('button');
                for (let b of botones) {
                    if (b.textContent && b.textContent.trim().toLowerCase() === 'buscar') {
                        btn = b;
                        break;
                    }
                }
            }
            if (btn) {
                pulsarElemento(btn);
                notificar("🔍 Buscando...", "#00ff88");
            }
        },

        reiniciarFiltros: function() {
            const botones = document.querySelectorAll('.button-container button');
            for (let b of botones) {
                if (b.textContent && b.textContent.toLowerCase().includes('reiniciar')) {
                    pulsarElemento(b);
                    notificar("🔄 Filtros reiniciados", "#ffaa00");
                    return;
                }
            }
        },

        volverAtras: function() {
            const btn = document.querySelector('button.ut-navigation-button-control');
            if (btn) {
                pulsarElemento(btn);
                notificar("↩ Volver atrás", "#00ccff");
            }
        },

        anadirTransferibles: function() {
            const btn = document.querySelector('.ut-quick-list-panel-view button.btn-standard.primary');
            if (btn) {
                pulsarElemento(btn);
                notificar("📋 Añadido a transferibles", "#00ff88");
            }
        },

        comprarYa: function() {
            let btn = document.querySelector('.DetailPanel .bidOptions button.buyButton');
            if (!btn) {
                const botones = document.querySelectorAll('.DetailPanel button');
                for (let b of botones) {
                    if (b.textContent && b.textContent.toLowerCase().includes('comprar ya')) {
                        btn = b;
                        break;
                    }
                }
            }
            if (btn) {
                if (btn.disabled || btn.classList.contains('disabled')) {
                    notificar("❌ Monedas insuficientes", "#ff4444");
                    return;
                }
                pulsarElemento(btn);
                notificar("🛒 Comprar Ya pulsado", "#00ff88");
                setTimeout(() => {
                    const btnOk = document.querySelector('.ea-dialog-view--body .btn-standard.primary, .ea-dialog-view button.btn-standard:not(.negative)');
                    if (btnOk) pulsarElemento(btnOk);
                }, 100);
            }
        },

        pujar: function() {
            let btn = document.querySelector('.DetailPanel .bidOptions button.bidButton');
            if (!btn) {
                const botones = document.querySelectorAll('.DetailPanel button');
                for (let b of botones) {
                    if (b.textContent && b.textContent.trim().toLowerCase() === 'pujar') {
                        btn = b;
                        break;
                    }
                }
            }
            if (btn) {
                if (btn.disabled || btn.classList.contains('disabled')) {
                    notificar("⚠️ Puja no disponible", "#ffaa00");
                    return;
                }
                pulsarElemento(btn);
                notificar("🔨 Puja enviada", "#00ff88");
            }
        },

        compararPrecio: function() {
            const botones = document.querySelectorAll('.DetailPanel button');
            for (let b of botones) {
                if (b.textContent && b.textContent.toLowerCase().includes('comparar precio')) {
                    pulsarElemento(b);
                    notificar("📊 Comparar Precio", "#00ccff");
                    return;
                }
            }
        },

        siguientePagina: function() {
            const btn = document.querySelector('.pagingContainer button.pagination.next')
                     || document.querySelector('button.pagination.next');
            if (btn && btn.style.display !== 'none' && !btn.disabled) {
                pulsarElemento(btn);
                notificar("▶ Siguiente", "#00ccff");
            }
        },

        anteriorPagina: function() {
            const btn = document.querySelector('.pagingContainer button.pagination.prev')
                     || document.querySelector('button.pagination.prev');
            if (btn && btn.style.display !== 'none' && !btn.disabled) {
                pulsarElemento(btn);
                notificar("◀ Anterior", "#00ccff");
            }
        },

        seleccionarJugador: function(delta) {
            const items = Array.from(document.querySelectorAll('.SearchResults ul.paginated li.listFUTItem, .itemList li.listFUTItem'));
            if (!items.length) return;

            let idx = items.findIndex(li => li.classList.contains('selected'));
            let nuevoIdx = idx + delta;
            if (idx === -1) nuevoIdx = 0;
            else if (nuevoIdx < 0) nuevoIdx = 0;
            else if (nuevoIdx >= items.length) nuevoIdx = items.length - 1;

            const clickable = items[nuevoIdx].querySelector('.rowContent') || items[nuevoIdx];
            pulsarElemento(clickable);
            items[nuevoIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            notificar(`Carta ${nuevoIdx + 1} de ${items.length}`, "#ffffff");
        },

        ajustarPrecio: function(filtroIdx, direccion, nombreLabel) {
            const filtros = document.querySelectorAll('.search-prices .price-filter, .ut-quick-list-panel-view .panelActionRow');
            if (filtros && filtros[filtroIdx]) {
                const contenedor = filtros[filtroIdx];
                const input = contenedor.querySelector('input');
                const btnSpinner = direccion > 0 ? contenedor.querySelector('.increment-value') : contenedor.querySelector('.decrement-value');

                let pulsado = false;
                if (btnSpinner && !btnSpinner.disabled && !btnSpinner.classList.contains('disabled')) {
                    pulsado = pulsarElemento(btnSpinner);
                }

                setTimeout(() => {
                    const valorActual = input ? input.value.replace(/[^0-9]/g, '') : '0';
                    if (!pulsado || valorActual === '' || valorActual === '0') {
                        const nuevo = calcularSiguientePaso(valorActual, direccion);
                        setInputValor(input, nuevo);
                        notificar(`${nombreLabel}: ${nuevo === 0 ? 'Todos' : nuevo}`, "#00ff88");
                    } else {
                        notificar(`${nombreLabel}: ${input.value}`, "#00ff88");
                    }
                    actualizarCalculadoraTax();
                }, 50);
            }
        }
    };

    // ==========================================
    // ESCUCHA DE TECLADO
    // ==========================================
    function coincideTecla(evento, teclaGuardada) {
        if (!teclaGuardada) return false;
        if (teclaGuardada === ' ' && evento.key === ' ') return true;
        if (teclaGuardada.toLowerCase() === evento.key.toLowerCase()) return true;
        if (teclaGuardada === evento.code) return true;
        return false;
    }

    window.addEventListener('keydown', (e) => {
        if (document.getElementById('varofctools-config-modal')) return;
        const activo = document.activeElement;
        if (activo && activo.matches('.ut-player-search-control input')) return;

        const enFiltros = !!document.querySelector('.ut-market-search-filters-view');
        const enResultados = !!document.querySelector('.SearchResults');
        const enPanelVenta = !!document.querySelector('.ut-quick-list-panel-view');

        if (coincideTecla(e, KeyBinds.toggleGrid)) {
            e.preventDefault();
            toggleGrid();
            return;
        }

        if (e.key === 'Enter') {
            const btnOk = document.querySelector('.ea-dialog-view--body .btn-standard.primary, .ea-dialog-view button.btn-standard:not(.negative)');
            if (btnOk) {
                e.preventDefault();
                pulsarElemento(btnOk);
                return;
            }
        }

        if (enPanelVenta && coincideTecla(e, KeyBinds.anadirTransferibles)) {
            e.preventDefault();
            Control.anadirTransferibles();
            return;
        }

        if (enFiltros) {
            if (coincideTecla(e, KeyBinds.buscar)) { e.preventDefault(); Control.buscar(); }
            else if (coincideTecla(e, KeyBinds.reiniciarFiltros)) { e.preventDefault(); Control.reiniciarFiltros(); }
            else if (coincideTecla(e, KeyBinds.pujaMinDec)) { e.preventDefault(); Control.ajustarPrecio(0, -1, 'Puja Mín'); }
            else if (coincideTecla(e, KeyBinds.pujaMinInc)) { e.preventDefault(); Control.ajustarPrecio(0, 1, 'Puja Mín'); }
            else if (coincideTecla(e, KeyBinds.pujaMaxDec)) { e.preventDefault(); Control.ajustarPrecio(1, -1, 'Puja Máx'); }
            else if (coincideTecla(e, KeyBinds.pujaMaxInc)) { e.preventDefault(); Control.ajustarPrecio(1, 1, 'Puja Máx'); }
            else if (coincideTecla(e, KeyBinds.compraMinDec)) { e.preventDefault(); Control.ajustarPrecio(2, -1, 'Comp. Mín'); }
            else if (coincideTecla(e, KeyBinds.compraMinInc)) { e.preventDefault(); Control.ajustarPrecio(2, 1, 'Comp. Mín'); }
            else if (coincideTecla(e, KeyBinds.compraMaxDec)) { e.preventDefault(); Control.ajustarPrecio(3, -1, 'Comp. Máx'); }
            else if (coincideTecla(e, KeyBinds.compraMaxInc)) { e.preventDefault(); Control.ajustarPrecio(3, 1, 'Comp. Máx'); }
        }

        if (enResultados || enPanelVenta) {
            if (coincideTecla(e, KeyBinds.comprarYa)) { e.preventDefault(); Control.comprarYa(); }
            else if (coincideTecla(e, KeyBinds.pujar)) { e.preventDefault(); Control.pujar(); }
            else if (coincideTecla(e, KeyBinds.compararPrecio)) { e.preventDefault(); Control.compararPrecio(); }
            else if (coincideTecla(e, KeyBinds.cartaArriba)) { e.preventDefault(); Control.seleccionarJugador(-1); }
            else if (coincideTecla(e, KeyBinds.cartaAbajo)) { e.preventDefault(); Control.seleccionarJugador(1); }
            else if (coincideTecla(e, KeyBinds.pagSiguiente)) { e.preventDefault(); Control.siguientePagina(); }
            else if (coincideTecla(e, KeyBinds.pagAnterior)) { e.preventDefault(); Control.anteriorPagina(); }
            else if (coincideTecla(e, KeyBinds.volverAtras)) { e.preventDefault(); Control.volverAtras(); }
        }
    }, true);

    // ==========================================
    // MODAL DE CONFIGURACIÓN DE TECLAS
    // ==========================================
    function abrirModalConfiguracion() {
        if (document.getElementById('varofctools-config-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'varofctools-config-modal';
        Object.assign(modal.style, {
            position: 'fixed',
            inset: '0',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            zIndex: '1000001',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            fontFamily: 'Segoe UI, sans-serif'
        });

        let filasHtml = '';
        for (let accion in KeyBinds) {
            filasHtml += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #202b3c;">
                    <span style="font-size:13px; color:#e0e0e0;">${ETIQUETAS[accion] || accion}</span>
                    <button class="vfc-bind-btn" data-accion="${accion}" style="background:#1b2535; border:1px solid #3d4f6b; color:#00ff88; font-weight:bold; padding:4px 10px; border-radius:4px; cursor:pointer; min-width:60px;">
                        ${formatearNombreTecla(KeyBinds[accion])}
                    </button>
                </div>
            `;
        }

        modal.innerHTML = `
            <div style="background:#0e1520; width:450px; max-height:85vh; border-radius:12px; border:1px solid #00ff88; box-shadow:0 10px 30px rgba(0,0,0,0.8); display:flex; flex-direction:column; overflow:hidden;">
                <div style="padding:14px 18px; border-bottom:1px solid #202b3c; display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0; color:#00ff88; font-size:16px;">⚙ Configurar Teclas varoFCtools</h3>
                    <span id="varofctools-modal-close" style="color:#aaa; cursor:pointer; font-size:18px; font-weight:bold;">&times;</span>
                </div>
                <div style="padding:12px 18px; overflow-y:auto; flex:1;">
                    <p style="font-size:12px; color:#888; margin-top:0;">Haz clic en cualquier botón y presiona la nueva tecla en tu teclado.</p>
                    ${filasHtml}
                </div>
                <div style="padding:12px 18px; border-top:1px solid #202b3c; display:flex; justify-content:space-between;">
                    <button id="varofctools-btn-reset-defaults" style="background:#ff3b30; color:#fff; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">Restablecer por defecto</button>
                    <button id="varofctools-btn-save-modal" style="background:#00ff88; color:#000; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">Listo / Guardar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        let capturandoAccion = null;
        let botonActivo = null;

        modal.querySelectorAll('.vfc-bind-btn').forEach(btn => {
            btn.onclick = function() {
                if (botonActivo) {
                    botonActivo.textContent = formatearNombreTecla(KeyBinds[capturandoAccion]);
                    botonActivo.style.borderColor = '#3d4f6b';
                }
                capturandoAccion = this.dataset.accion;
                botonActivo = this;
                this.textContent = 'Pulsa tecla...';
                this.style.borderColor = '#ffcc00';
            };
        });

        const keyHandler = (e) => {
            if (!capturandoAccion) return;
            e.preventDefault();
            e.stopPropagation();

            KeyBinds[capturandoAccion] = e.key;
            guardarBinds(KeyBinds);
            if (botonActivo) {
                botonActivo.textContent = formatearNombreTecla(e.key);
                botonActivo.style.borderColor = '#3d4f6b';
            }
            capturandoAccion = null;
            botonActivo = null;
            actualizarLeyendaHUD();
        };

        window.addEventListener('keydown', keyHandler, true);

        function cerrarModal() {
            window.removeEventListener('keydown', keyHandler, true);
            modal.remove();
        }

        document.getElementById('varofctools-modal-close').onclick = cerrarModal;
        document.getElementById('varofctools-btn-save-modal').onclick = cerrarModal;
        document.getElementById('varofctools-btn-reset-defaults').onclick = function() {
            if (confirm("¿Restablecer todos los atajos a los de fábrica?")) {
                KeyBinds = Object.assign({}, DEFAULT_BINDS);
                guardarBinds(KeyBinds);
                cerrarModal();
                abrirModalConfiguracion();
                actualizarLeyendaHUD();
                notificar("Atajos restablecidos a fábrica", "#ffcc00");
            }
        };
    }

    // ==========================================
    // HUD Y PANEL FLOTANTE
    // ==========================================
    function actualizarLeyendaHUD() {
        const hudBody = document.getElementById('varofctools-body-legend');
        if (!hudBody) return;

        hudBody.innerHTML = `
            <div style="display:grid; grid-template-columns: 1fr auto; gap:3px 10px; font-size: 11px; margin-bottom: 10px; color: #ccc; line-height: 1.4;">
                <span>⊞ Vista Grid / Lista:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.toggleGrid)}]</b>
                <span>🛒 Comprar Ya:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.comprarYa)}]</b>
                <span>🔨 Pujar:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.pujar)}]</b>
                <span>📊 Comparar:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.compararPrecio)}]</b>
                <span>📋 Listar carta:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.anadirTransferibles)}]</b>
                <span>🔍 Buscar:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.buscar)}]</b>
                <span>🔄 Reiniciar:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.reiniciarFiltros)}]</b>
                <span>↩ Volver:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.volverAtras)}]</b>
                <span>🃏 Subir / Bajar:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.cartaArriba)}] / [${formatearNombreTecla(KeyBinds.cartaAbajo)}]</b>
                <span>📑 Pág. Ant / Sig:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.pagAnterior)}] / [${formatearNombreTecla(KeyBinds.pagSiguiente)}]</b>
                <span>💰 Compra Máx - / +:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.compraMaxDec)}] / [${formatearNombreTecla(KeyBinds.compraMaxInc)}]</b>
                <span>🪙 Puja Máx - / +:</span><b style="color:#00ff88;">[${formatearNombreTecla(KeyBinds.pujaMaxDec)}] / [${formatearNombreTecla(KeyBinds.pujaMaxInc)}]</b>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                <button id="vfc-btn-grid" class="vfc-btn" style="grid-column: span 2; background:#182838; font-weight:bold; color:#00ff88;">⊞ Grid: ON [G]</button>
                <button id="vfc-btn-buscar" class="vfc-btn" style="grid-column: span 2; background:#00ff88; color:#000; font-weight:bold; padding:7px;">🔍 BUSCAR</button>
                <button id="vfc-btn-compra-dec" class="vfc-btn">C. Ya -</button>
                <button id="vfc-btn-compra-inc" class="vfc-btn">C. Ya +</button>
                <button id="vfc-btn-puja-dec" class="vfc-btn">Puja -</button>
                <button id="vfc-btn-puja-inc" class="vfc-btn">Puja +</button>
                <button id="vfc-btn-comprar" class="vfc-btn" style="background:#e5a93c; color:#000; font-weight:bold;">🛒 Comprar</button>
                <button id="vfc-btn-pujar" class="vfc-btn" style="background:#2a75d3; color:#fff; font-weight:bold;">🔨 Pujar</button>
                <button id="vfc-btn-listar" class="vfc-btn" style="background:#00d26a; color:#000; font-weight:bold;">📋 Listar</button>
                <button id="vfc-btn-comparar" class="vfc-btn" style="background:#4a5568;">📊 Comparar</button>
                <button id="vfc-btn-atras" class="vfc-btn" style="grid-column: span 2; background:#333;">↩ Volver</button>
            </div>
        `;

        document.getElementById('vfc-btn-grid').onclick = toggleGrid;
        document.getElementById('vfc-btn-buscar').onclick = () => Control.buscar();
        document.getElementById('vfc-btn-compra-dec').onclick = () => Control.ajustarPrecio(3, -1, 'Compra Máx');
        document.getElementById('vfc-btn-compra-inc').onclick = () => Control.ajustarPrecio(3, 1, 'Compra Máx');
        document.getElementById('vfc-btn-puja-dec').onclick = () => Control.ajustarPrecio(1, -1, 'Puja Máx');
        document.getElementById('vfc-btn-puja-inc').onclick = () => Control.ajustarPrecio(1, 1, 'Puja Máx');
        document.getElementById('vfc-btn-comprar').onclick = () => Control.comprarYa();
        document.getElementById('vfc-btn-pujar').onclick = () => Control.pujar();
        document.getElementById('vfc-btn-listar').onclick = () => Control.anadirTransferibles();
        document.getElementById('vfc-btn-comparar').onclick = () => Control.compararPrecio();
        document.getElementById('vfc-btn-atras').onclick = () => Control.volverAtras();

        aplicarEstadoGrid();
    }

    function renderHUD() {
        if (document.getElementById('varofctools-hud')) return;

        const hud = document.createElement('div');
        hud.id = 'varofctools-hud';
        hud.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #202b3c; padding-bottom:6px;">
                <span style="font-weight: bold; color: #00ff88; font-size:13px;">⚡ varoFCtools FC 27</span>
                <div>
                    <span id="vfc-btn-open-config" style="font-size:11px; color:#00ccff; cursor:pointer; margin-right:8px;" title="Configurar atajos">⚙ Teclas</span>
                    <span style="font-size:11px; color:#aaa; cursor:pointer;" id="vfc-toggle">[- Min]</span>
                </div>
            </div>
            <div id="varofctools-body-legend"></div>
        `;

        Object.assign(hud.style, {
            position: 'fixed',
            bottom: '15px',
            right: '15px',
            backgroundColor: 'rgba(12, 16, 24, 0.96)',
            color: '#ffffff',
            padding: '12px 14px',
            borderRadius: '10px',
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '12px',
            zIndex: '999999',
            boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
            border: '1px solid rgba(0, 255, 136, 0.4)',
            minWidth: '235px'
        });

        const styleTag = document.createElement('style');
        styleTag.innerHTML = `
            .vfc-btn {
                background: #1e2635;
                color: #fff;
                border: 1px solid #3a475d;
                border-radius: 4px;
                padding: 6px 4px;
                font-size: 11px;
                cursor: pointer;
                user-select: none;
            }
            .vfc-btn:hover {
                filter: brightness(1.25);
                border-color: #00ff88;
            }
            .vfc-btn:active {
                transform: scale(0.95);
            }
        `;
        document.head.appendChild(styleTag);
        document.body.appendChild(hud);

        document.getElementById('vfc-btn-open-config').onclick = abrirModalConfiguracion;

        let min = false;
        document.getElementById('vfc-toggle').onclick = () => {
            min = !min;
            document.getElementById('varofctools-body-legend').style.display = min ? 'none' : 'block';
            document.getElementById('vfc-toggle').textContent = min ? '[+ Max]' : '[- Min]';
        };

        actualizarLeyendaHUD();
        aplicarEstadoGrid();
    }

    // Intervalo de actualización de la calculadora de EA Tax
    setInterval(() => {
        actualizarCalculadoraTax();
    }, 250);

    // Inicialización del HUD en cuanto cargue la interfaz
    const checkInterval = setInterval(() => {
        if (document.querySelector('.ut-tab-bar') || document.querySelector('.ut-navigation-bar-view')) {
            renderHUD();
            clearInterval(checkInterval);
        }
    }, 1000);

})();