"""
FUT.GG Hidden Gems Inspector & Club Sync CLI for FC 27
Permite consultar las joyas ocultas (Hidden Gems) de tu club en FUT.GG,
verificar el estado de sincronización y exportar los datos.
"""

import os
import sys
import json
import csv
from datetime import datetime
import requests

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

COOKIES_PATH = os.path.join(os.path.dirname(__file__), 'cookies', 'www.fut.gg_cookies (1).txt')

def load_cookies(filepath):
    cookies = {}
    if not os.path.exists(filepath):
        print(f"[!] No se encontró el archivo de cookies en: {filepath}")
        return cookies
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) >= 7:
                cookies[parts[5]] = parts[6]
    return cookies

def get_headers(cookies):
    jwt_token = cookies.get('futgg_jwt')
    headers = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    }
    if jwt_token:
        headers['Authorization'] = f'Bearer {jwt_token}'
    return headers

def check_sync_status(cookies, headers):
    url = 'https://www.fut.gg/api/gg-club/sync-status/'
    try:
        res = requests.get(url, headers=headers, cookies=cookies, timeout=10)
        if res.status_code == 200:
            data = res.json().get('data', {})
            last_sync = data.get('lastSyncedAt')
            status = data.get('syncStatus')
            in_progress = data.get('isSyncInProgress')
            print(f"\n[+] Estado de Sincronización FUT.GG:")
            print(f"    - Estado actual: {status} {'(En progreso)' if in_progress else ''}")
            print(f"    - Última sincronización: {last_sync}")
            print(f"    - Próxima sincronización disponible: {data.get('nextSyncAt') or '¡Ya disponible!'}")
            return data
        else:
            print(f"[-] Error al consultar estado de sincronización: HTTP {res.status_code}")
    except Exception as e:
        print(f"[-] Excepción al consultar sincronización: {e}")
    return None

def trigger_sync(cookies, headers):
    url = 'https://www.fut.gg/api/gg-club/sync/'
    try:
        res = requests.post(url, headers=headers, cookies=cookies, json={}, timeout=10)
        if res.status_code in [200, 201, 202]:
            print("[+] ¡Sincronización con FUT.GG iniciada con éxito!")
            return True
        else:
            print(f"[-] No se pudo sincronizar: HTTP {res.status_code} - {res.text}")
    except Exception as e:
        print(f"[-] Excepción al sincronizar: {e}")
    return False

def get_hidden_gems(cookies, headers):
    url = 'https://www.fut.gg/api/gg-club/hidden-gems/'
    try:
        res = requests.get(url, headers=headers, cookies=cookies, timeout=10)
        if res.status_code == 200:
            return res.json().get('data', {})
        else:
            print(f"[-] Error al obtener Hidden Gems: HTTP {res.status_code}")
    except Exception as e:
        print(f"[-] Excepción: {e}")
    return None

def display_gems(data):
    if not data:
        print("[-] No hay datos de Hidden Gems.")
        return []
    
    total = data.get('total', 0)
    total_val = data.get('totalValue', 0)
    items = data.get('items', [])
    
    print("\n" + "=" * 80)
    print(f"💎 FUT.GG HIDDEN GEMS (Total: {total} jugadores | Valor estimado: {total_val:,} monedas)")
    print("=" * 80)
    
    if not items:
        print("\n  [i] No hay jugadores en Hidden Gems actualmente.")
        print("      Si acabas de sincronizar tu club o lo harás en unos minutos,")
        print("      vuelve a ejecutar este comando para ver las nuevas cartas detectadas.\n")
        return []

    print(f"{'Nombre':<24} | {'Med':<4} | {'Pos':<4} | {'Club':<18} | {'Precio Est.':<12} | {'Beneficio':<10} | {'EA ID':<8}")
    print("-" * 95)
    
    parsed_gems = []
    for it in items:
        player = it.get('player', {})
        pdef = player.get('playerDef', {})
        name = pdef.get('commonName') or f"{pdef.get('firstName', '')} {pdef.get('lastName', '')}".strip() or pdef.get('searchableName') or 'Desconocido'
        rating = pdef.get('overall') or pdef.get('overallRating') or pdef.get('rating') or 0
        pos = pdef.get('mainPosition') or pdef.get('position') or 'N/A'
        club = pdef.get('club', {}).get('name', 'N/A')
        val = it.get('value', 0)
        profit = it.get('profit', 0)
        is_extinct = it.get('isExtinct', False)
        ea_id = it.get('eaId') or player.get('eaId') or pdef.get('eaId') or player.get('id')
        
        price_str = f"{val:,} 🪙" if val else "N/A"
        if is_extinct:
            price_str += " [EXTINTA]"
        profit_str = f"+{profit:,}" if profit and profit > 0 else f"{profit:,}" if profit else "0"
        
        print(f"{name[:23]:<24} | {rating:<4} | {pos:<4} | {club[:17]:<18} | {price_str:<12} | {profit_str:<10} | {ea_id}")
        parsed_gems.append({
            'eaId': ea_id,
            'name': name,
            'rating': rating,
            'position': pos,
            'club': club,
            'estimatedPrice': val,
            'profit': profit,
            'isExtinct': is_extinct,
            'count': it.get('count', 1)
        })
    print("-" * 95)
    return parsed_gems

def export_gems(parsed_gems, filename='hidden_gems.json'):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(parsed_gems, f, indent=2, ensure_ascii=False)
    print(f"[+] Guardado en {filename}")

def main():
    cookies = load_cookies(COOKIES_PATH)
    if not cookies:
        print("[-] Error: No se pudieron cargar las cookies de FUT.GG.")
        return
    headers = get_headers(cookies)
    
    if len(sys.argv) > 1 and sys.argv[1] == '--sync':
        print("[*] Solicitando sincronización de club con FUT.GG...")
        trigger_sync(cookies, headers)
    
    check_sync_status(cookies, headers)
    data = get_hidden_gems(cookies, headers)
    gems = display_gems(data)
    if gems:
        export_gems(gems)

if __name__ == '__main__':
    main()
