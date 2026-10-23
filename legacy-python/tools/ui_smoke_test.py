from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import uvicorn
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import main  # noqa: E402


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_json(url: str, timeout: float = 20) -> object:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.load(response)
        except Exception:
            time.sleep(0.2)
    raise RuntimeError(f"Timeout: {url}")


class Cdp:
    def __init__(self, url: str):
        self.ws = connect(url, origin="http://localhost")
        self.next_id = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        call_id = self.next_id
        self.ws.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == call_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message["result"]

    def evaluate(self, expression: str, await_promise: bool = False):
        result = self.call("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": await_promise,
            "returnByValue": True,
        })
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result["result"].get("value")

    def wait_for(self, expression: str, timeout: float = 15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.evaluate(expression):
                return
            time.sleep(0.2)
        raise AssertionError(f"UI condition failed: {expression}")


def run(chrome: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="kuyumcu-ui-") as temp:
        main.DB_PATH = Path(temp) / "data" / "kuyumcu.db"
        main.sessions.clear()
        app_port = free_port()
        debug_port = free_port()
        server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=app_port, log_level="error"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        wait_json(f"http://127.0.0.1:{app_port}/api/session")

        profile = Path(temp) / "chrome"
        browser = subprocess.Popen([
            str(chrome), "--headless=new", "--disable-gpu", "--no-first-run",
            "--remote-allow-origins=*", f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={profile}", f"http://127.0.0.1:{app_port}/login",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            pages = wait_json(f"http://127.0.0.1:{debug_port}/json")
            page = next(item for item in pages if item["type"] == "page")
            cdp = Cdp(page["webSocketDebuggerUrl"])
            cdp.wait_for("document.querySelector('.logo') !== null")
            assert cdp.evaluate("document.querySelector('input[type=password]') === null")
            cdp.wait_for("location.pathname === '/' && document.querySelector('[data-view=alis]') !== null")
            assert cdp.evaluate("document.querySelector('#logoutBtn') === null")
            requested_theme = os.getenv("UI_THEME_MODE", "light")
            assert cdp.evaluate("document.documentElement.dataset.theme==='light'")
            logo_size = cdp.evaluate("(()=>{const r=document.querySelector('#themeToggle').getBoundingClientRect();return [r.width,r.height];})()")
            light_surface = cdp.evaluate("getComputedStyle(document.body).backgroundColor")
            cdp.evaluate("document.querySelector('#themeToggle').click()")
            assert cdp.evaluate("document.documentElement.dataset.theme==='dark' && document.querySelector('#themeToggle').getAttribute('aria-pressed')==='true'")
            assert cdp.evaluate("getComputedStyle(document.body).backgroundColor") != light_surface
            assert cdp.evaluate("(()=>{const r=document.querySelector('#themeToggle').getBoundingClientRect();return [r.width,r.height];})()") == logo_size
            cdp.call("Page.reload")
            cdp.wait_for("document.querySelector('.dashboard-root')!==null")
            assert cdp.evaluate("document.documentElement.dataset.theme==='dark'")
            if requested_theme == "light":
                cdp.evaluate("document.querySelector('#themeToggle').click()")
                assert cdp.evaluate("getComputedStyle(document.body).backgroundColor") == light_surface


            payload = json.dumps({
                "tarih": "2026-10-03", "tedarikci": "ARANACAK TEDARIKCI",
                "cinsi": "BILEZIK", "ayar": "22", "adet": 1, "gram": 10,
                "milyem": 916, "has_fiyati": 3000,
            })
            result = cdp.evaluate(
                f"fetch('/api/alis',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:{json.dumps(payload)}}}).then(r=>r.json())",
                await_promise=True,
            )
            assert result["status"] == "ok", result

            cdp.evaluate("document.querySelector('[data-view=alis]').click()")
            cdp.wait_for("document.querySelector('tbody tr') !== null")
            cdp.evaluate("(()=>{const s=document.querySelector('#search');s.value='aranacak';s.dispatchEvent(new Event('input',{bubbles:true}))})()")
            cdp.wait_for("document.querySelectorAll('tbody tr').length === 1 && document.body.innerText.includes('ARANACAK TEDARIKCI')")
            cdp.evaluate("(()=>{const s=document.querySelector('#search');s.value='bulunmayan';s.dispatchEvent(new Event('input',{bubbles:true}))})()")
            cdp.wait_for("document.querySelector('.empty')?.innerText.includes('Kayıt yok')")

            cdp.evaluate("document.querySelector('[data-view=stok]').click()")
            cdp.wait_for("[...document.querySelectorAll('.page-tab')].some(b=>b.innerText==='HURDA STOK')")
            cdp.evaluate("[...document.querySelectorAll('.page-tab')].find(b=>b.innerText==='HURDA STOK').click()")
            cdp.wait_for("[...document.querySelectorAll('.page-tab.active')].some(b=>b.innerText==='HURDA STOK')")

            account_name = "ARANACAK TEDARIKCI"
            for customer, paid in [(account_name, "HAS"), ("CARI POZITIF", "ODEME_YOK"), ("CARI SIFIR", "TAM_KAPAT")]:
                sale = {"tarih": "2026-10-03", "musteri": customer, "alis_id": result["data"]["id"], "cinsi": "BILEZIK", "ayar": "22", "gram": 1, "satis_milyem": 940, "odeme_tipi": paid, "odenen_has": "0.100"}
                response = cdp.evaluate(f"fetch('/api/satis',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:{json.dumps(json.dumps(sale))}}}).then(r=>r.json())", await_promise=True)
                assert response["status"] == "ok", response
            for direction in ["ODEME", "TAHSILAT"]:
                payment = {"tarih": "2026-10-03", "isim": account_name, "odeme_tipi": "HAS", "odenen_has": "0.500", "yon": direction}
                response = cdp.evaluate(f"fetch('/api/cari/odeme',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:{json.dumps(json.dumps(payment))}}}).then(r=>r.json())", await_promise=True)
                assert response["status"] == "ok", response
            zero_purchase = {"tedarikci": "ZERO STOCK", "cinsi": "YUZUK", "ayar": "18", "gram": 1, "milyem": 750}
            response = cdp.evaluate(f"fetch('/api/alis',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:{json.dumps(json.dumps(zero_purchase))}}}).then(r=>r.json())", await_promise=True)
            assert response["status"] == "ok", response
            zero_sale = {"musteri": account_name, "alis_id": response["data"]["id"], "cinsi": "YUZUK", "ayar": "18", "gram": 1, "satis_milyem": 800, "odeme_tipi": "TAM_KAPAT"}
            response = cdp.evaluate(f"fetch('/api/satis',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:{json.dumps(json.dumps(zero_sale))}}}).then(r=>r.json())", await_promise=True)
            assert response["status"] == "ok", response
            cdp.evaluate("state.stokFilter='normal';document.querySelector('[data-view=stok]').click()")
            cdp.wait_for("document.querySelector('[data-table-type=stok]') !== null")
            assert cdp.evaluate("[...document.querySelectorAll('[data-table-type=stok] [data-col=kalan_gram]')].every(cell=>Number(cell.textContent.replace(',','.'))!==0)")
            accounts_before = cdp.evaluate("fetch('/api/cari').then(r=>r.json()).then(r=>JSON.stringify(r.data))", await_promise=True)
            cdp.evaluate("document.querySelector('[data-view=cari]').click()")
            cdp.wait_for("document.querySelector('[data-table-type=kisiCari] tbody') !== null")
            assert cdp.evaluate("document.querySelectorAll('#content>.table-section').length === 1")
            assert cdp.evaluate("formatValue('net_bakiye_has', 2768.17-2766.177) === '+1,99' && formatValue('net_bakiye_has', 1993) === '+1.993' && formatValue('net_bakiye_has', -1.993) === '-1,99'")
            assert cdp.evaluate("[...document.querySelectorAll('#content .cari-net-balance')].every(cell=>!cell.textContent.includes('has') && !cell.textContent.includes('gr'))")
            assert cdp.evaluate("(()=>{const table=document.querySelector('#content>.cari-table');return table.getBoundingClientRect().width >= document.querySelector('#content').clientWidth-2 && getComputedStyle(table.querySelector('.table-wrap')).maxHeight==='none';})()")
            assert cdp.evaluate("document.querySelectorAll('#content [role=tab]').length === 4")
            assert cdp.evaluate("document.querySelectorAll('#content .cari-net-balance.pos').length === 1")
            assert cdp.evaluate("document.querySelectorAll('#content .cari-net-balance.neg').length === 2")
            assert cdp.evaluate("document.querySelectorAll('#content .cari-net-balance.balance-zero').length === 1")
            assert cdp.evaluate("document.querySelector('#content .balance-zero').classList.contains('pos') === false")
            assert cdp.evaluate("[...document.querySelectorAll('#content .cari-detail-btn')].every(button=>button.querySelector('svg') && button.getAttribute('aria-label') && !button.textContent.trim())")
            cdp.evaluate("document.querySelector('#content .cari-detail-btn').click()")
            cdp.wait_for("document.querySelector('[data-table-type=cariHistory] tbody') !== null")
            assert cdp.evaluate("document.querySelector('.cari-reconciliation')===null && document.querySelector('.cari-detail-help')!==null")
            assert cdp.evaluate("columnLabel('kisiCari','net_bakiye_has')==='NET HAS BAK\u0130YES\u0130 (gr)' && columnLabel('cariHistory','has').endsWith('(gr)')")
            assert cdp.evaluate("(()=>{const c=document.querySelector('.cari-net-balance');return getComputedStyle(c).fontSize===getComputedStyle(c.parentElement.querySelector('td')).fontSize;})()")
            detail_size = cdp.evaluate("(()=>{const r=document.querySelector('.cari-detail-box').getBoundingClientRect();return [r.width,r.height];})()")
            cdp.evaluate("document.querySelector('.cari-detail-help').click()")
            cdp.wait_for("document.querySelector('.note-dialog')!==null")
            assert cdp.evaluate("document.querySelector('.note-full').textContent.includes('has gram') && document.querySelector('.note-full').textContent.includes('=')")
            cdp.evaluate("document.querySelector('.note-dialog button').click()")
            assert cdp.evaluate("document.querySelector('.cari-detail-modal')!==null")
            assert cdp.evaluate("document.querySelector('.cari-detail-close svg') !== null && document.querySelector('.cari-detail-close').getAttribute('aria-label') !== null")
            assert cdp.evaluate("getComputedStyle(document.querySelector('.cari-detail-close')).position === 'absolute'")
            assert cdp.evaluate("document.querySelector('.cari-detail-modal h2').textContent === 'ARANACAK TEDARIKCI'")
            assert cdp.evaluate("document.querySelectorAll('[data-table-type=cariHistory] tbody tr').length === 7")
            assert cdp.evaluate("new Set([...document.querySelectorAll('[data-table-type=cariHistory] [data-col=hareket]')].map(td=>td.textContent)).size === 4")
            cdp.evaluate("document.querySelector('.cari-detail-modal button').click()")
            assert cdp.evaluate("document.querySelector('.cari-detail-modal') === null")
            cdp.evaluate("openCariDetail('CARI SIFIR')")
            cdp.wait_for("document.querySelector('.cari-detail-body .cards')!==null")
            assert cdp.evaluate("(()=>{const r=document.querySelector('.cari-detail-box').getBoundingClientRect();return [r.width,r.height];})()") == detail_size
            cdp.evaluate("document.querySelector('.cari-detail-close').click()")

            cdp.evaluate("document.querySelector('#content .kebab-btn').click()")
            assert cdp.evaluate("document.querySelector('.cari-actions-modal .cari-dialog-close svg') !== null")
            cdp.evaluate("document.querySelector('.cari-actions-modal .cari-dialog-close').click()")
            assert cdp.evaluate("document.querySelector('.cari-actions-modal') === null")
            for filter_name, table_type in [("musteri", "musteriCari"), ("tedarikci", "tedarikciCari"), ("odeme", "cariOdeme"), ("all", "kisiCari")]:
                cdp.evaluate(f"document.querySelector('[data-filter={filter_name}]').click()")
                cdp.wait_for(f"document.querySelector('[data-table-type={table_type}] tbody') !== null")
                assert cdp.evaluate("document.querySelectorAll('#content>.table-section').length === 1"), filter_name
                assert cdp.evaluate("[...document.querySelectorAll('#content tbody tr')].every(row=>row.querySelector('.cari-detail-btn'))"), filter_name
                if filter_name == "musteri":
                    assert cdp.evaluate("columns.musteriCari.includes('toplam_alis_has') === false")
                if filter_name == "odeme":
                    cdp.evaluate("document.querySelector('#content .icon-edit').click()")
                    assert cdp.evaluate("document.querySelector('.cari-person-modal .cari-dialog-close svg') !== null")
                    cdp.evaluate("document.querySelector('.cari-person-modal .cari-dialog-close').click()")
                    assert cdp.evaluate("document.querySelector('.cari-person-modal') === null")
                if filter_name == "tedarikci":
                    assert cdp.evaluate("document.querySelectorAll('#content tbody tr').length === 2")
            accounts_after = cdp.evaluate("fetch('/api/cari').then(r=>r.json()).then(r=>JSON.stringify(r.data))", await_promise=True)
            assert accounts_before == accounts_after, "Read-only account UI changed balances"
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            if os.getenv("UI_CARI_SCREENSHOT_PATH"):
                import base64
                screenshot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
                Path(os.environ["UI_CARI_SCREENSHOT_PATH"]).write_bytes(base64.b64decode(screenshot["data"]))
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": False})
            assert cdp.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Account overview overflows mobile width"
            cdp.evaluate("document.querySelector('#content .cari-detail-btn').click()")
            cdp.wait_for("document.querySelector('[data-table-type=cariHistory] tbody') !== null")
            assert cdp.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Account detail overflows mobile width"
            cdp.evaluate("document.querySelector('.cari-detail-modal button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
            assert cdp.evaluate("document.querySelector('.cari-detail-modal') === null")
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 800, "height": 600, "deviceScaleFactor": 1, "mobile": False})


            cdp.evaluate("document.querySelector('[data-view=giderler]').click()")
            cdp.wait_for("document.querySelector('input[name=tutar]') !== null")
            cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');f.elements.tutar.value='0,125';f.elements.kategori.value='Yemek';f.elements.notlar.value='UI test';f.requestSubmit()})()")
            cdp.wait_for("document.querySelector('tbody')?.innerText.includes('UI test')")
            cdp.evaluate("document.querySelector('button.icon-edit').click()")
            cdp.wait_for("document.querySelector('input[name=tutar]')?.value === '0.125'")
            cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');f.elements.tutar.value='0,350';f.requestSubmit()})()")
            cdp.wait_for("document.querySelector('tbody')?.innerText.includes('0,35')")
            cdp.evaluate("document.querySelector('[data-view=alis]').click()")
            cdp.wait_for("document.querySelector('input[name=gram]') !== null")
            assert cdp.evaluate("['has_fiyati','iscilik','ek_masraf','ek_ucret','indirim'].every(name=>!document.querySelector(`.entry-form [name=${name}]`))")
            cdp.evaluate("(()=>{const i=document.querySelector('[name=cinsi]'); i.value=''; i.focus();})()")
            cdp.wait_for("document.querySelector('[name=cinsi]').getAttribute('aria-expanded') === 'true'")
            assert cdp.evaluate("!document.querySelector('[name=cinsi]').hasAttribute('list')")
            assert cdp.evaluate("document.querySelectorAll('.suggest-box:not(.hidden)').length === 1")
            assert cdp.evaluate("document.querySelector('[name=cinsi]').parentElement.querySelectorAll('.suggest-box').length === 1")
            assert cdp.evaluate("document.querySelector('.suggest-box:not(.hidden)').children.length === new Set(state.suggestions.products.map(normalize)).size")
            cdp.evaluate("(()=>{const i=document.querySelector('[name=cinsi]');i.value='BILE';i.dispatchEvent(new Event('input',{bubbles:true}));})()")
            assert cdp.evaluate("document.querySelector('.suggest-box:not(.hidden)').children.length === 1")
            cdp.evaluate("document.querySelector('.suggest-box:not(.hidden) button').click()")
            assert cdp.evaluate("document.querySelector('[name=cinsi]').value.length > 0 && document.querySelectorAll('.suggest-box:not(.hidden)').length === 0")
            cdp.evaluate("(()=>{const i=document.querySelector('[name=cinsi]');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()")
            assert cdp.evaluate("document.querySelectorAll('.suggest-box:not(.hidden)').length === 0")
            cdp.evaluate("(()=>{const i=document.querySelector('[name=cinsi]');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()")
            assert cdp.evaluate("document.querySelectorAll('.suggest-box:not(.hidden)').length === 0")
            cdp.evaluate("document.querySelector('[data-view=satis]').click()")
            cdp.wait_for("document.querySelector('input[name=satis_milyem]') !== null")
            cdp.evaluate("document.querySelector('.purchase-actions button').click()")
            cdp.wait_for("document.querySelector('.modal-box-wide tbody button') !== null")
            cdp.evaluate("document.querySelector('.modal-box-wide tbody button').click()")
            assert cdp.evaluate("document.querySelector('.purchase-remaining').textContent === '7 gr'")
            assert cdp.evaluate("parseFloat(getComputedStyle(document.querySelector('.purchase-remaining')).fontSize) <= parseFloat(getComputedStyle(document.querySelector('.purchase-note')).fontSize)*1.1")

            assert cdp.evaluate("['has_fiyati','iscilik','ek_masraf','ek_ucret','indirim'].every(name=>!document.querySelector(`.entry-form [name=${name}]`))")
            cdp.evaluate("document.querySelector('[data-view=hurda_alis]').click()")
            cdp.wait_for("document.querySelector('[name=islem_turu]') !== null")
            assert cdp.evaluate("['has_fiyati','iscilik','ek_masraf','ek_ucret','indirim'].every(name=>!document.querySelector(`.entry-form [name=${name}]`))")

            cdp.evaluate("document.querySelector('[data-view=dashboard]').click()")
            cdp.wait_for("document.querySelector('#pageTitle')?.innerText === 'Dashboard'")
            cdp.wait_for("document.querySelector('.dashboard-root') !== null")
            dashboard = cdp.evaluate("fetch('/api/dashboard').then(r=>r.json()).then(r=>r.data)", await_promise=True)
            assert dashboard["toplam_gider"] == 0.350
            assert round(dashboard["genel_milyem_kari"] - dashboard["toplam_gider"], 3) == dashboard["net_kar"]
            assert cdp.evaluate("document.querySelectorAll('.dashboard-root .expense-profit-summary').length === 0")
            assert cdp.evaluate("document.querySelector('.dashboard-root').children.length === 3")
            cdp.evaluate("document.querySelector('[data-view=giderler]').click()")
            cdp.wait_for("document.querySelector('.expenses-layout') !== null")
            cards = cdp.evaluate("[...document.querySelectorAll('.expense-profit-summary')].find(p=>p.textContent.includes('Toplam Gider'))?.textContent")
            assert cards and "0,35" in cards, cards
            assert "Toplam Milyem K\u00e2r\u0131" in cards, cards
            assert "Kalan Net K\u00e2r" in cards, cards
            assert "Net K\u00e2r" in cards, cards
            baseline = json.loads((ROOT / "tools" / "original_ui.json").read_text(encoding="utf-8"))
            actual_forms = cdp.evaluate("forms")
            actual_columns = cdp.evaluate("columns")
            for name, fields in baseline["forms"].items():
                assert actual_forms[name] == fields, (name, actual_forms[name])
            for name, fields in baseline["columns"].items():
                if name in {"kisiCari", "musteriCari", "tedarikciCari"}:
                    assert actual_columns[name][1] == "net_bakiye_has", name
                    continue
                assert actual_columns[name] == fields, (name, actual_columns[name])
            expected_nav = list(baseline["views"]) + ["giderler"]
            for view in expected_nav:
                cdp.evaluate(f"document.querySelector('[data-view={view}]').click()")
                cdp.wait_for("document.querySelector('#content').children.length > 0")
                cdp.wait_for(f"document.querySelector('#pageTitle').textContent === views[{json.dumps(view)}].title")
                body = cdp.evaluate("document.querySelector('#content').textContent")
                assert "(TL)" not in body and "TL /" not in body and "\u20ba" not in body, (view, body)
                assert "Parasal rapor" not in body, view
                if view in {"alis", "satis", "hurda_alis", "hurda_satis"}:
                    assert cdp.evaluate("['has_fiyati','iscilik','ek_masraf','ek_ucret','indirim'].every(name=>!document.querySelector(`.entry-form [name=${name}]`))"), view
                assert cdp.evaluate("[...document.querySelectorAll('#content textarea[name=notlar]')].every(input=>input.maxLength===500 && input.rows===(input.closest('.expense-form')?2:1) && getComputedStyle(input).resize==='vertical' && parseFloat(getComputedStyle(input).maxHeight)===(input.closest('.expense-form')?110:74) && input.getBoundingClientRect().height===(input.closest('.expense-form')?56:38))"), view
                assert cdp.evaluate("document.documentElement.dataset.theme") == requested_theme
                if requested_theme == "dark":
                    assert cdp.evaluate("[...document.querySelectorAll('#content *')].every(el=>{if(!el.getBoundingClientRect().height)return true;const c=getComputedStyle(el).backgroundColor.match(/[0-9.]+/g)?.map(Number);return !c || (c.length===4 && c[3]<.9) || (c[0]+c[1]+c[2])/3<195;})"), (view,"Bright surface leaked into dark theme")
                print(f"Page checked: {view}")
            cdp.evaluate("document.querySelector('[data-view=stok]').click()")
            cdp.wait_for("document.querySelector('.stock-table-heading')!==null")
            for stock_filter in ["normal", "hurda"]:
                cdp.evaluate(f"(async()=>{{state.stokFilter={json.dumps(stock_filter)};await render();}})()", await_promise=True)
                assert cdp.evaluate(f"fetch('/api/stok/{stock_filter}').then(r=>r.json()).then(r=>['gram','has'].every(key=>document.querySelector(`[data-stock-total=${{key}}]`).textContent===formatValue(key,r.data.reduce((sum,row)=>sum+Number(row[`kalan_${{key}}`]||0),0))+' '+(key==='gram'?'gr':'has')))", await_promise=True)
                assert cdp.evaluate("(()=>{const h=document.querySelector('.stock-table-heading h2').getBoundingClientRect();const s=document.querySelector('.stock-heading-summary').getBoundingClientRect();return s.left>=h.right && Math.abs(h.top-s.top)<15;})()"), "Stock totals must sit beside the heading on desktop"
                assert cdp.evaluate("(()=>{const items=[...document.querySelectorAll('.stock-heading-summary>span')];return items.every(item=>{const label=item.querySelector('.stock-summary-label').getBoundingClientRect();const value=item.querySelector('strong').getBoundingClientRect();return value.left>=label.right && Math.abs(value.bottom-label.bottom)<5;}) && Math.abs(items[0].getBoundingClientRect().top-items[1].getBoundingClientRect().top)<2;})()"), "Stock totals must stay on one line"
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
            assert cdp.evaluate("document.querySelector('.stock-heading-summary').getBoundingClientRect().right<=innerWidth"), "Stock totals overflow mobile"
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            cdp.evaluate("(async()=>{const jobs=[];for(const view of ['alis','satis','giderler']){state.view=view;jobs.push(render());}await Promise.all(jobs);})()", await_promise=True)
            assert cdp.evaluate("document.querySelectorAll('#content [data-table-type=alis], #content [data-table-type=satis]').length === 0"), "Stale page responses leaked into the expenses page"
            assert cdp.evaluate("document.querySelectorAll('#content [data-table-type=giderler]').length === 1")
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            cdp.wait_for("document.querySelector('.expenses-layout').getBoundingClientRect().width > 900")
            assert cdp.evaluate("(()=>{const a=document.querySelector('.expenses-main').getBoundingClientRect();const b=document.querySelector('.expenses-layout>.expense-profit-summary').getBoundingClientRect();return b.left>=a.right;})()")
            assert cdp.evaluate("[...document.querySelectorAll('.expense-summary-card')].every(card=>card.querySelector('strong').getBoundingClientRect().top-card.querySelector('span').getBoundingClientRect().bottom<=6)"), "Summary label/value gap is too large"
            assert cdp.evaluate("document.querySelector('.expense-form-panel').getBoundingClientRect().height < 420"), "Expense form is unnecessarily tall"
            assert cdp.evaluate("document.querySelector('#content').scrollHeight <= document.querySelector('#content').clientHeight+1"), str(cdp.evaluate("['content','.expenses-layout','.table-wrap'].map(s=>{const e=document.querySelector(s==='content'?'#content':s),r=e.getBoundingClientRect();return [s,r.top,r.bottom,e.clientHeight,e.scrollHeight,getComputedStyle(e).marginBottom,e.style.height];})"))
            assert cdp.evaluate("document.querySelector('.expenses-layout .table-wrap').scrollWidth <= document.querySelector('.expenses-layout .table-wrap').clientWidth+1"), "Expense table has horizontal scrolling"
            assert cdp.evaluate("document.querySelector('.expenses-layout>.expense-profit-summary').getBoundingClientRect().left-document.querySelector('.expenses-main').getBoundingClientRect().right<=14"), "Expense form/summary gap is too wide"
            assert cdp.evaluate("Math.abs(document.querySelector('.expenses-main').getBoundingClientRect().top-document.querySelector('.expenses-layout>.expense-profit-summary').getBoundingClientRect().top)<2")
            assert cdp.evaluate("Math.abs(document.querySelector('.expenses-layout').getBoundingClientRect().width-document.querySelector('#content').clientWidth)<10"), "Expense layout must fill available content width"
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 720, "deviceScaleFactor": 1, "mobile": False})
            cdp.wait_for("document.querySelector('#content').scrollHeight <= document.querySelector('#content').clientHeight+1")
            assert cdp.evaluate("document.querySelector('.expenses-layout .table-wrap').scrollWidth <= document.querySelector('.expenses-layout .table-wrap').clientWidth+1"), "Expense table needs horizontal scrolling at 1280x720"
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 1024, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            for form_view in ["alis", "satis", "giderler"]:
                cdp.evaluate(f"document.querySelector('[data-view={form_view}]').click()")
                if form_view != "giderler":
                    cdp.wait_for("document.querySelector('.entry-form') !== null")
                    assert cdp.evaluate("document.querySelector('.expense-profit-summary') === null"), form_view
                    continue
                cdp.wait_for("document.querySelector('.expenses-layout') !== null")
                assert cdp.evaluate("(()=>{const layout=document.querySelector('.form-summary-layout');const form=layout.firstElementChild.getBoundingClientRect();const summary=layout.querySelector('.expense-profit-summary').getBoundingClientRect();return summary.left>=form.right && Math.abs(summary.top-form.top)<2 && Math.abs(summary.height-form.height)<3;})()"), form_view
                assert cdp.evaluate("document.querySelectorAll('.form-summary-layout>.expense-profit-summary .expense-summary-card').length === 3"), form_view
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            cdp.evaluate("document.querySelectorAll('.toast').forEach(toast => toast.remove())")
            if os.getenv("UI_SCREENSHOT_PATH"):
                import base64
                screenshot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
                Path(os.environ["UI_SCREENSHOT_PATH"]).write_bytes(base64.b64decode(screenshot["data"]))
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": False})
            cdp.wait_for("document.querySelector('.expenses-layout>.expense-profit-summary').getBoundingClientRect().top >= document.querySelector('.expenses-main').getBoundingClientRect().bottom")
            assert cdp.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Expense page overflows mobile width"
            cdp.evaluate("document.querySelector('[data-view=dashboard]').click()")
            cdp.wait_for("document.querySelector('.dashboard-restored .dashboard-hero') !== null")
            assert cdp.evaluate("document.querySelectorAll('.dashboard-hero-metrics>.metric-card').length === 4")
            assert cdp.evaluate("document.querySelector('.dashboard-hero-text')===null")
            assert cdp.evaluate("getComputedStyle(document.querySelector('#content')).scrollbarWidth==='none'")
            assert cdp.evaluate("document.querySelectorAll('.dashboard-groups-top>.dashboard-panel').length === 2")
            assert cdp.evaluate("[...document.querySelectorAll('.dashboard-groups-top .dashboard-panel-grid')].every(grid=>grid.children.length===4)")
            assert cdp.evaluate("document.querySelectorAll('.dashboard-groups-bottom>.dashboard-panel').length === 2")
            assert cdp.evaluate("document.querySelector('.dashboard-groups-bottom .dashboard-panel-grid').children.length===3")
            assert cdp.evaluate("document.querySelectorAll('.dashboard-stock-metrics .metric-card').length===8")
            assert cdp.evaluate("!document.querySelector('.dashboard-restored').textContent.includes('Genel \u00d6zet')")
            assert cdp.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Dashboard overflows mobile width"
            assert cdp.evaluate("!document.querySelector('#dataMenu').open && !document.querySelector('#backupBtn').checkVisibility()")
            cdp.evaluate("document.querySelector('#dataMenu summary').click()")
            assert cdp.evaluate("document.querySelector('#dataMenu').open && [...document.querySelectorAll('.toolbar-menu-panel button')].every(button=>button.getBoundingClientRect().width>0)")
            assert cdp.evaluate("document.querySelector('.toolbar-menu-panel').getBoundingClientRect().right<=innerWidth")
            cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27})
            assert cdp.evaluate("!document.querySelector('#dataMenu').open && document.activeElement===document.querySelector('#dataMenu summary')")
            cdp.evaluate("document.querySelector('#dataMenu summary').click();document.querySelector('#pageTitle').click()")
            assert cdp.evaluate("!document.querySelector('#dataMenu').open")
            dashboard_before_layout = cdp.evaluate("fetch('/api/dashboard').then(r=>r.json()).then(r=>JSON.stringify(r.data))", await_promise=True)
            for width, height in [(1920, 1080), (1536, 864), (1366, 768), (1280, 720)]:
                cdp.call("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
                assert cdp.evaluate("new Set([...document.querySelectorAll('.dashboard-hero-metrics>.metric-card')].map(card=>Math.round(card.getBoundingClientRect().top))).size === 1"), (width, "KPIs must share one row")
                assert cdp.evaluate("new Set([...document.querySelectorAll('.dashboard-groups-top>section')].map(panel=>Math.round(panel.getBoundingClientRect().top))).size === 1"), (width, "Panels must share one row")
                assert cdp.evaluate("[...document.querySelectorAll('.dashboard-groups-top>.dashboard-panel')].every(panel=>panel.getBoundingClientRect().height<350)"), (width, "Dashboard panels must remain compact")
                assert cdp.evaluate("document.querySelector('#content').scrollHeight <= document.querySelector('#content').clientHeight+1"), (width, "Dashboard requires vertical scrolling")
                assert cdp.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, "Dashboard horizontal overflow")
            if os.getenv("UI_DASHBOARD_SCREENSHOT_PATH"):
                import base64
                screenshot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
                Path(os.environ["UI_DASHBOARD_SCREENSHOT_PATH"]).write_bytes(base64.b64decode(screenshot["data"]))
            dashboard_after_layout = cdp.evaluate("fetch('/api/dashboard').then(r=>r.json()).then(r=>JSON.stringify(r.data))", await_promise=True)
            assert dashboard_before_layout == dashboard_after_layout, "Dashboard layout changed financial values"
            for sale_view in ['satis','hurda_satis']:
                cdp.evaluate(f"document.querySelector('[data-view={sale_view}]').click()")
                cdp.wait_for("document.querySelector('.sale-summary-row')!==null")
                for width,height in [(1280,720),(390,844)]:
                    cdp.call("Emulation.setDeviceMetricsOverride", {"width":width,"height":height,"deviceScaleFactor":1,"mobile":False})
                    assert cdp.evaluate("(()=>{const a=document.querySelector('.sale-summary-row>.has-preview').getBoundingClientRect();const b=document.querySelector('.sale-summary-row>.payment-action-box').getBoundingClientRect();return (innerWidth>680 ? Math.abs(a.top-b.top)<2 && b.left>=a.right : b.top>=a.bottom) && b.right<=innerWidth;})()"), (sale_view,width,'Sale summary boxes must share one row')
                    assert cdp.evaluate("document.documentElement.scrollWidth<=innerWidth"), (sale_view,width,'Sale summary overflow')
                    assert cdp.evaluate("(()=>{const form=document.querySelector('.entry-form');const preview=document.querySelector('.sale-summary-row>.has-preview');const columns=getComputedStyle(form).gridTemplateColumns.split(' ').map(parseFloat);const gap=parseFloat(getComputedStyle(form).columnGap);const span=innerWidth<=680?columns.length:innerWidth<=1024?3:innerWidth<=1180?4:3;const expected=columns.slice(0,span).reduce((a,b)=>a+b,0)+gap*(span-1);return Math.abs(preview.getBoundingClientRect().width-expected)<2;})()"), (sale_view,width,'Calculated Has width changed')
                cdp.call("Emulation.setDeviceMetricsOverride", {"width":1280,"height":720,"deviceScaleFactor":1,"mobile":False})
            # Summary amounts follow visible rows and keep financial directions separate.
            assert cdp.evaluate("(()=>{const old=state.search;try{state.search='';const cases=[['alis',[{gram:1,has:.9},{gram:2,has:1.8}],[],['3 gr','2,7 has']],['hurdaAlis',[{gram:1,has:.75},{gram:2,has:1.5}],[],['3 gr','2,25 has']],['satis',[{gram:1,milyem_kari:.1},{gram:2,milyem_kari:-.025}],[],['3 gr','0,07 has']],['hurdaSatis',[{gram:1,milyem_kari:.1},{gram:2,milyem_kari:-.025}],[],['3 gr','0,07 has']],...['kisiCari','musteriCari','tedarikciCari'].map(type=>[type,[{net_bakiye_has:2},{net_bakiye_has:-.5},{net_bakiye_has:1}],[],['3 has','0,5 has']]),['cariOdeme',[{yon:'TAHSILAT',odenen_has:.7},{yon:'ODEME',odenen_has:.5}],[],['0,7 has','0,5 has']]];return cases.every(([type,rows,unused,expected])=>{const panel=renderTable(type,rows,'Test');return JSON.stringify([...panel.querySelectorAll('[data-summary-metric]')].map(el=>el.textContent))===JSON.stringify(expected);});}finally{state.search=old;}})()"), "Table summaries mixed quantities, profit, or account/payment directions"
            assert cdp.evaluate("(()=>{const old=state.search;try{const rows=[{tedarikci:'MATCH',gram:1,has:.9},{tedarikci:'OTHER',gram:2,has:1.8}];state.search='MATCH';const filtered=renderTable('alis',rows,'Test');if(filtered.querySelector('[data-summary-metric=gram]').textContent!=='1 gr'||filtered.querySelector('[data-summary-metric=has]').textContent!=='0,9 has')return false;state.search='NO RESULTS';const empty=renderTable('alis',rows,'Test');return empty.querySelector('.empty')!==null && [...empty.querySelectorAll('[data-summary-metric]')].every(el=>el.textContent.startsWith('0 '));}finally{state.search=old;}})()"), "Summary does not follow search or empty results"
            for view in ['alis','satis','hurda_alis','hurda_satis','cari']:
                cdp.evaluate(f"document.querySelector('[data-view={view}]').click()")
                cdp.wait_for("document.querySelector('.table-heading-summary')!==null")
                assert cdp.evaluate("document.querySelectorAll('#content [data-summary-metric]').length===2"), view
                cdp.call("Emulation.setDeviceMetricsOverride", {"width":390,"height":844,"deviceScaleFactor":1,"mobile":False})
                assert cdp.evaluate("document.querySelector('.table-heading-summary').getBoundingClientRect().right<=innerWidth"), (view,'Summary mobile overflow')
                cdp.call("Emulation.setDeviceMetricsOverride", {"width":1280,"height":720,"deviceScaleFactor":1,"mobile":False})
            # Exercise the unified scrap sale form against the isolated test database.
            assert cdp.evaluate("(()=>{const fields=form=>[...form.querySelectorAll('.field-main')].map(field=>[field.firstChild.textContent,field.querySelector('input,textarea').readOnly]);return JSON.stringify(fields(renderForm('satis')))===JSON.stringify(fields(renderForm('hurda','SATIS')));})()"), "Sale forms have different visible labels or readonly behavior"
            scrap = cdp.evaluate("api('/api/hurda',{method:'POST',body:JSON.stringify({islem_turu:'ALIS',kisi:'UI SCRAP SUPPLIER',cinsi:'UI SCRAP',ayar:'18',gram:2,milyem:750})})", await_promise=True)
            cdp.evaluate("document.querySelector('[data-view=hurda_satis]').click()")
            cdp.wait_for("document.querySelector('.entry-form [name=alis_milyem]')!==null")
            cdp.evaluate("document.querySelector('.purchase-actions button').click()")
            cdp.wait_for("document.querySelector('.modal-box-wide tbody button')!==null")
            cdp.evaluate("[...document.querySelectorAll('.modal-box-wide tbody tr')].find(row=>row.textContent.includes('UI SCRAP')).querySelector('button').click()")
            assert cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');return f.elements.alis_milyem.value==='750' && f.elements.alis_milyem.readOnly && f.elements.milyem.value==='' && f.elements.cinsi.readOnly && f.elements.ayar.readOnly;})()")
            cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');f.elements.kisi.value='UI SCRAP CUSTOMER';f.elements.gram.value='1';f.elements.milyem.value='800';f.elements.milyem.dispatchEvent(new Event('input'));})()")
            assert cdp.evaluate("document.querySelector('[data-has]').textContent==='0,8'")
            form_before_theme = cdp.evaluate("JSON.stringify(Object.fromEntries(new FormData(document.querySelector('.entry-form'))))")
            for _ in range(2):
                cdp.evaluate("document.querySelector('#themeToggle').click()")
                assert cdp.evaluate("JSON.stringify(Object.fromEntries(new FormData(document.querySelector('.entry-form'))))") == form_before_theme, "Theme toggle changed an unfinished sale"
            assert cdp.evaluate("document.documentElement.dataset.theme") == requested_theme

            cdp.evaluate("document.querySelector('.payment-open-btn').click()")
            cdp.wait_for("document.querySelector('.transaction-payment-modal')!==null")
            cdp.evaluate("document.querySelector('.payment-type-tab[data-value=HAS]').click();document.querySelector('.transaction-paid-field input').value='0,1';document.querySelector('.transaction-paid-field input').dispatchEvent(new Event('input'))")
            cdp.evaluate("[...document.querySelectorAll('.transaction-payment-modal button')].at(-1).click()")
            cdp.evaluate("document.querySelector('.entry-form').requestSubmit()")
            cdp.wait_for("document.querySelector('.confirm-ok')!==null")
            cdp.evaluate("document.querySelector('.confirm-ok').click()")
            cdp.wait_for("document.querySelector('[data-table-type=hurdaSatis] tbody tr')!==null")
            saved_scrap = cdp.evaluate("api('/api/hurda').then(r=>r.kayitlar.find(row=>row.kisi==='UI SCRAP CUSTOMER'))", await_promise=True)
            assert saved_scrap['hurda_alis_id'] is None and saved_scrap['stoktan'] == 1
            assert saved_scrap['stok_dagilimi'][0]['purchase_id'] == scrap['id']
            assert saved_scrap['alis_milyem'] == 750 and saved_scrap['satis_milyem'] == 800
            assert saved_scrap['has'] == 0.8 and saved_scrap['milyem_kari'] == 0.05 and saved_scrap['odenen_has'] == 0.1
            cdp.evaluate("[...document.querySelectorAll('[data-table-type=hurdaSatis] tbody tr')].find(row=>row.textContent.includes('UI SCRAP CUSTOMER')).querySelector('.icon-edit').click()")
            cdp.wait_for("document.querySelector('.entry-form [name=kisi]')?.value==='UI SCRAP CUSTOMER'")
            assert cdp.evaluate("document.querySelector('[name=alis_milyem]').value==='750' && document.querySelector('[name=milyem]').value==='800'")
            cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');f.elements.gram.value='0,5';f.elements.gram.dispatchEvent(new Event('input'));f.requestSubmit();})()")
            cdp.wait_for("document.querySelector('.confirm-ok')!==null")
            cdp.evaluate("document.querySelector('.confirm-ok').click()")
            cdp.wait_for("document.querySelector('[name=kisi]')?.value===''")
            updated_scrap = cdp.evaluate("api('/api/hurda').then(r=>r.kayitlar.find(row=>row.kisi==='UI SCRAP CUSTOMER'))", await_promise=True)
            assert updated_scrap['gram'] == 0.5 and updated_scrap['has'] == 0.4 and updated_scrap['milyem_kari'] == 0.025
            assert updated_scrap['odenen_has'] == 0.1 and updated_scrap['hurda_alis_id'] is None
            assert updated_scrap['stok_dagilimi'][0]['purchase_id'] == scrap['id']
            if os.getenv("UI_THEME_SCREENSHOT_DIR"):
                import base64
                shots = Path(os.environ["UI_THEME_SCREENSHOT_DIR"])
                shots.mkdir(exist_ok=True)
                def capture(name):
                    screenshot = cdp.call("Page.captureScreenshot", {"format":"png","captureBeyondViewport":True})
                    (shots/name).write_bytes(base64.b64decode(screenshot["data"]))
                capture("sale-"+requested_theme+".png")
                cdp.evaluate("document.querySelector('.payment-open-btn').click()")
                cdp.wait_for("document.querySelector('.transaction-payment-modal')!==null")
                capture("payment-"+requested_theme+".png")
                if requested_theme == "dark":
                    assert cdp.evaluate("[...document.querySelectorAll('.transaction-payment-modal input')].every(el=>{const c=getComputedStyle(el).backgroundColor.match(/[0-9.]+/g).map(Number);return (c[0]+c[1]+c[2])/3<150;})"), "Dark payment inputs are light"
                cdp.evaluate("[...document.querySelectorAll('.transaction-payment-modal button')].at(-2).click()")
                cdp.evaluate("document.querySelector('[data-view=dashboard]').click()")
                cdp.wait_for("document.querySelector('.dashboard-root')!==null")
                capture("dashboard-"+requested_theme+".png")
                cdp.evaluate("document.querySelector('[data-view=hurda_satis]').click()")
                cdp.wait_for("document.querySelector('.sale-summary-row')!==null")
            for width, height in [(1280,720),(390,844)]:
                cdp.call("Emulation.setDeviceMetricsOverride", {"width":width,"height":height,"deviceScaleFactor":1,"mobile":False})
                assert cdp.evaluate("document.documentElement.scrollWidth<=innerWidth"), "Scrap sale form overflows"
            if os.getenv("UI_SCRAP_SALE_SCREENSHOT_PATH"):
                import base64
                screenshot = cdp.call("Page.captureScreenshot", {"format":"png","captureBeyondViewport":True})
                Path(os.environ["UI_SCRAP_SALE_SCREENSHOT_PATH"]).write_bytes(base64.b64decode(screenshot["data"]))
            # Sell a combined pool larger than either supplier's individual receipt.
            for kind,view in [('normal','satis'),('hurda','hurda_satis')]:
                cdp.call("Emulation.setDeviceMetricsOverride", {"width":1280,"height":820,"deviceScaleFactor":1,"mobile":False})
                product = 'UI NORMAL POOL' if kind=='normal' else 'UI SCRAP POOL'
                for index,gram,milyem in [(1,.4,900),(2,.6,920)]:
                    receipt = {'cinsi':product,'ayar':'22','gram':gram,'milyem':milyem,'tarih':f'2026-10-0{index}'}
                    receipt.update({'tedarikci':f'POOL SUPPLIER {index}'} if kind=='normal' else {'kisi':f'POOL SUPPLIER {index}','islem_turu':'ALIS'})
                    endpoint = '/api/alis' if kind=='normal' else '/api/hurda'
                    cdp.evaluate(f"api({json.dumps(endpoint)},{{method:'POST',body:{json.dumps(json.dumps(receipt))}}})", await_promise=True)
                cdp.evaluate(f"document.querySelector('[data-view={view}]').click()")
                cdp.wait_for("document.querySelector('.purchase-actions button')!==null")
                cdp.evaluate("document.querySelector('.purchase-actions button').click()")
                cdp.wait_for("document.querySelector('.modal-box-wide tbody button')!==null")
                assert cdp.evaluate(f"[...document.querySelectorAll('.modal-box-wide tbody tr')].filter(row=>row.textContent.includes({json.dumps(product)})).length===1"), 'Stock picker repeated suppliers instead of combining stock'
                cdp.evaluate(f"[...document.querySelectorAll('.modal-box-wide tbody tr')].find(row=>row.textContent.includes({json.dumps(product)})).querySelector('button').click()")
                assert cdp.evaluate("document.querySelector('.purchase-remaining').textContent==='1 gr'")
                person = 'musteri' if kind=='normal' else 'kisi'
                purity = 'satis_milyem' if kind=='normal' else 'milyem'
                cdp.evaluate(f"(()=>{{const f=document.querySelector('.entry-form');f.elements[{json.dumps(person)}].value='POOL CUSTOMER';f.elements.gram.value='1';f.elements[{json.dumps(purity)}].value='950';f.elements.gram.dispatchEvent(new Event('input'));}})()")
                assert cdp.evaluate("document.querySelector('[name=alis_milyem]').value==='912'")
                cdp.evaluate("document.querySelector('.entry-form').requestSubmit()")
                cdp.wait_for("document.querySelector('.confirm-ok')!==null")
                cdp.evaluate("document.querySelector('.confirm-ok').click()")
                cdp.wait_for("document.querySelector('[name=gram]')?.value===''")
                endpoint = '/api/satis' if kind=='normal' else '/api/hurda'
                pool_rows = cdp.evaluate(f"api({json.dumps(endpoint)})", await_promise=True)
                if kind=='hurda': pool_rows = pool_rows['kayitlar']
                pool_sale = next(row for row in pool_rows if row['cinsi']==product and row.get('stoktan'))
                assert pool_sale['gram']==1 and pool_sale['milyem_kari']==.038 and len(pool_sale['stok_dagilimi'])==2
                cdp.evaluate(f"[...document.querySelectorAll('#content tbody tr')].find(r=>r.textContent.includes({json.dumps(product)})).querySelector('.icon-edit').click()")
                cdp.wait_for("document.querySelector('[name=gram]')?.value==='1'")
                cdp.evaluate("(()=>{const i=document.querySelector('[name=has_override]');i.value='0.98';i.dispatchEvent(new Event('input'));})()")
                assert cdp.evaluate("Number((document.querySelector('[name=satis_milyem]')||document.querySelector('[name=milyem]')).value)===980 && document.querySelector('[name=gram]').value==='1' && document.querySelector('[name=alis_milyem]').value==='912'")
                cdp.evaluate("document.querySelector('.entry-form').requestSubmit()")
                cdp.wait_for("document.querySelector('.confirm-ok')!==null")
                cdp.evaluate("document.querySelector('.confirm-ok').click()")
                cdp.wait_for("document.querySelector('[name=gram]')?.value===''")
                result = cdp.evaluate(f"api({json.dumps(endpoint)})",await_promise=True)
                edited = next(r for r in (result if kind=='normal' else result['kayitlar']) if r['id']==pool_sale['id'])
                assert edited['gram']==1 and edited['has']==.98 and edited['milyem_kari']==.068 and edited['alis_milyem']==912 and edited['satis_milyem']==980
                assert edited['stok_dagilimi']==pool_sale['stok_dagilimi']


            # Shared UI changes use a disposable database, never customer records.
            cdp.call("Emulation.setDeviceMetricsOverride", {"width":1440,"height":1000,"deviceScaleFactor":1,"mobile":False})
            cdp.evaluate("document.querySelector('[data-view=alis]').click()")
            cdp.wait_for("document.querySelector('[name=tedarikci]')!==null")
            assert cdp.evaluate("formatValue('has',1234.555)==='1.234,55' && formatValue('has',-1234.555)==='-1.234,55' && formatValue('has',0.009)==='0'")
            cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');f.elements.tedarikci.value='UI MANUAL HAS';f.elements.cinsi.value='UI MANUAL PRODUCT';f.elements.ayar.value='22';f.elements.gram.value='10';f.elements.milyem.value='900';f.elements.notlar.value='N'.repeat(500);f.elements.gram.dispatchEvent(new Event('input'));})()")
            assert cdp.evaluate("document.querySelector('[data-has]').textContent==='9'")
            cdp.evaluate("(()=>{const i=document.querySelector('[name=has_override]');i.value='8.12345';i.dispatchEvent(new Event('input'));})()")
            assert cdp.evaluate("document.querySelector('[data-has]').textContent==='8,12' && Number(document.querySelector('[name=milyem]').value)===812.345 && document.querySelector('[name=gram]').value==='10'")
            cdp.evaluate("document.querySelector('.has-auto').click()")
            assert cdp.evaluate("document.querySelector('[name=has_override]').value==='' && document.querySelector('[data-has]').textContent==='9'")
            cdp.evaluate("(()=>{const i=document.querySelector('[name=has_override]');i.value='8.12345';i.dispatchEvent(new Event('input'));document.querySelector('.entry-form').requestSubmit();})()")
            cdp.wait_for("document.querySelector('.confirm-ok')!==null")
            cdp.evaluate("document.querySelector('.confirm-ok').click()")
            cdp.wait_for("document.querySelector('[name=tedarikci]')?.value===''")
            record = cdp.evaluate("api('/api/alis').then(rows=>rows.find(r=>r.tedarikci==='UI MANUAL HAS'))",await_promise=True)
            assert float(record['has_override'])==8.12345 and len(record['not'])==500 and record['milyem']==812.345 and record['gram']==10
            cdp.evaluate("[...document.querySelectorAll('[data-table-type=alis] tbody tr')].find(r=>r.textContent.includes('UI MANUAL HAS')).querySelector('.note-preview').click()")
            assert cdp.evaluate("document.querySelector('.note-full').textContent.length===500")
            cdp.evaluate("document.querySelector('.note-dialog button').click()")
            cdp.evaluate("[...document.querySelectorAll('[data-table-type=alis] tbody tr')].find(r=>r.textContent.includes('UI MANUAL HAS')).querySelector('.icon-edit').click()")
            cdp.wait_for("document.querySelector('[name=has_override]')?.value==='8.12345'")
            cdp.evaluate("document.querySelector('[name=gram]').value='999';document.querySelector('.entry-form .form-bottom-actions .secondary').click()")
            cdp.wait_for("document.querySelector('[name=gram]')?.value===''")
            assert cdp.evaluate(f"api('/api/alis').then(rows=>rows.find(r=>r.id==={record['id']}).gram)",await_promise=True)==10
            # Overflow happens inside the table, while headers keep their position.
            cdp.evaluate(f"(()=>{{const row={json.dumps(record)};document.querySelector('#content>.table-section').replaceWith(renderTable('alis',Array.from({{length:80}},()=>row),'Records'));fitPageTable();}})()")
            assert cdp.evaluate("(()=>{const w=document.querySelector('[data-table-type=alis] .table-wrap'),h=w.querySelector('th');const y=h.getBoundingClientRect().top;w.scrollTop=500;return w.scrollHeight>w.clientHeight && Math.abs(h.getBoundingClientRect().top-y)<2 && document.querySelector('#content').scrollHeight<=document.querySelector('#content').clientHeight+1;})()")
            # Cari history opens the original purchase, then cancel leaves it unchanged.
            cdp.evaluate("document.querySelector('[data-view=cari]').click()")
            cdp.wait_for("document.querySelector('[data-table-type=kisiCari]')!==null")
            cdp.evaluate("openCariDetail('UI MANUAL HAS')")
            cdp.wait_for("document.querySelector('[data-table-type=cariHistory] .actions-cell button')!==null")
            cdp.evaluate("document.querySelector('[data-table-type=cariHistory] .actions-cell button').click()")
            cdp.wait_for("document.querySelector('[name=tedarikci]')?.value==='UI MANUAL HAS'")
            assert cdp.evaluate("state.view==='alis' && document.querySelector('.cari-detail-modal')===null")
            cdp.evaluate("document.querySelector('.entry-form .form-bottom-actions .secondary').click()")

            for person, source, expected_view in [("ARANACAK TEDARIKCI", "Cari", "payment"), ("ARANACAK TEDARIKCI", "Normal", "satis"), ("UI SCRAP CUSTOMER", "Hurda", "hurda_satis"), ("UI SCRAP SUPPLIER", "Hurda", "hurda_alis")]:
                cdp.evaluate(f"openCariDetail({json.dumps(person)})")
                cdp.wait_for("document.querySelector('[data-table-type=cariHistory] .actions-cell button')!==null")
                if expected_view == "satis":
                    selector = "[...document.querySelectorAll('[data-table-type=cariHistory] tbody tr')].find(r=>r.querySelector('[data-col=kaynak]').textContent==='Normal' && r.querySelector('[data-col=hareket]').textContent===String.fromCodePoint(83,97,116,305,351))"
                else:
                    selector = f"[...document.querySelectorAll('[data-table-type=cariHistory] tbody tr')].find(r=>r.querySelector('[data-col=kaynak]').textContent==={json.dumps(source)})"
                cdp.evaluate(selector+".querySelector('.actions-cell button').click()")
                if expected_view == "payment":
                    cdp.wait_for("document.querySelector('.cari-payment-form')?.dataset.editPaymentId")
                    cdp.evaluate("document.querySelector('.cari-dialog-close').click()")
                else:
                    cdp.wait_for(f"state.view==={json.dumps(expected_view)} && document.querySelector('.entry-form .form-bottom-actions .secondary')!==null")
                    cdp.evaluate("document.querySelector('.entry-form .form-bottom-actions .secondary').click()")

            # All four forms derive only transaction purity, never purchase purity or grams.
            for view in ["alis", "satis", "hurda_alis", "hurda_satis"]:
                cdp.evaluate(f"document.querySelector('[data-view={view}]').click()")
                cdp.wait_for("document.querySelector('[name=has_override]')!==null")
                assert cdp.evaluate("(()=>{const row=document.querySelector('.sale-summary-row');if(!row)return false;const h=row.querySelector('.has-preview').getBoundingClientRect(),p=row.querySelector('.payment-action-box').getBoundingClientRect();return Math.abs(h.top-p.top)<2 && p.left>h.left;})()"),view

                cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');const p=f.elements.satis_milyem||f.elements.milyem;f.elements.gram.value='10';p.value='900';if(f.elements.alis_milyem)f.elements.alis_milyem.value='850';f.elements.has_override.value='9.16';f.elements.has_override.dispatchEvent(new Event('input'));})()")
                assert cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');return f.elements.gram.value==='10' && Number((f.elements.satis_milyem||f.elements.milyem).value)===916 && (!f.elements.alis_milyem||f.elements.alis_milyem.value==='850');})()"),view
                cdp.evaluate("(()=>{const f=document.querySelector('.entry-form');f.elements.gram.value='0';f.elements.gram.dispatchEvent(new Event('input'));})()")
                assert cdp.evaluate("!document.querySelector('[name=has_override]').checkValidity()"),view
                cdp.evaluate("document.querySelector('.has-auto').click()")
                assert cdp.evaluate("document.querySelector('[name=has_override]').checkValidity() && (document.querySelector('[name=satis_milyem]')||document.querySelector('[name=milyem]')).value==='900'"),view
            # Settings changes are explicit, persistent and independent of financial data.
            before_settings = cdp.evaluate("api('/api/dashboard').then(JSON.stringify)",await_promise=True)
            cdp.evaluate("document.querySelector('#dataMenu').open=true;document.querySelector('#settingsBtn').click()")
            cdp.wait_for("document.querySelector('.settings-form button[type=submit]')?.disabled===false")
            assert cdp.evaluate("!document.querySelector('#dataMenu').open && document.querySelector('.settings-about').textContent.length>10")
            cdp.evaluate("document.querySelector('.settings-form [name=backup_frequency]').value='startup';document.querySelector('.settings-form .secondary').click()")
            assert cdp.evaluate("api('/api/uygulama-ayarlari').then(r=>r.backup_frequency)",await_promise=True)=='daily'
            cdp.evaluate("openSettings()")
            cdp.wait_for("document.querySelector('.settings-form button[type=submit]')?.disabled===false")
            cdp.evaluate("document.querySelector('.settings-form [name=backup_frequency]').value='startup';document.querySelector('.settings-form [name=theme]').value=document.documentElement.dataset.theme==='dark'?'light':'dark';document.querySelector('.settings-form').requestSubmit()")
            cdp.wait_for("document.querySelector('.settings-modal')===null")
            assert cdp.evaluate("api('/api/uygulama-ayarlari').then(r=>r.backup_frequency)",await_promise=True)=='startup'
            assert cdp.evaluate("api('/api/dashboard').then(JSON.stringify)",await_promise=True)==before_settings
            cdp.evaluate("openSettings()")
            cdp.wait_for("document.querySelector('.settings-form button[type=submit]')?.disabled===false")
            assert cdp.evaluate("document.querySelector('.settings-form [name=backup_frequency]').value==='startup' && document.querySelector('.settings-form [name=theme]').value===document.documentElement.dataset.theme")
            cdp.evaluate("document.querySelector('.settings-form .secondary').click()")
            cdp.evaluate("openSettings()")
            cdp.wait_for("document.querySelector('.settings-form button[type=submit]')?.disabled===false")
            for width,height in [(1280,820),(390,844)]:
                cdp.call("Emulation.setDeviceMetricsOverride", {"width":width,"height":height,"deviceScaleFactor":1,"mobile":False})
                assert cdp.evaluate("(()=>{const r=document.querySelector('.settings-box').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()"),"Settings dialog overflows viewport"
                assert cdp.evaluate("(()=>{const box=document.querySelector('.settings-box');return [...box.querySelectorAll('select')].every(el=>el.getBoundingClientRect().width>box.clientWidth*.75) && box.scrollHeight<=box.clientHeight+1;})()"),"Settings fields must fill one column without unnecessary scrolling"
                if os.getenv("UI_THEME_SCREENSHOT_DIR"):
                    import base64
                    target=Path(os.environ["UI_THEME_SCREENSHOT_DIR"])
                    target.mkdir(exist_ok=True)
                    (target/f"settings-{requested_theme}-{width}.png").write_bytes(base64.b64decode(cdp.call("Page.captureScreenshot", {"format":"png"})["data"]))
            cdp.evaluate("document.querySelector('.settings-form .secondary').click()")


            cdp.evaluate("openCariDetail('UI MANUAL HAS')")
            cdp.wait_for("document.querySelector('.cari-detail-body .cards')!==null")
            for width,height in [(1280,820),(390,844)]:
                cdp.call("Emulation.setDeviceMetricsOverride", {"width":width,"height":height,"deviceScaleFactor":1,"mobile":False})
                assert cdp.evaluate("(()=>{const b=document.querySelector('.cari-detail-box'),r=b.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && getComputedStyle(document.querySelector('.cari-detail-body')).overflowY==='auto';})()")
                if os.getenv("UI_THEME_SCREENSHOT_DIR"):
                    import base64
                    target=Path(os.environ["UI_THEME_SCREENSHOT_DIR"])
                    (target/f"cari-{requested_theme}-{width}.png").write_bytes(base64.b64decode(cdp.call("Page.captureScreenshot", {"format":"png"})["data"]))
            cdp.evaluate("document.querySelector('.cari-detail-help').click()")
            assert cdp.evaluate("(()=>{const r=document.querySelector('.note-dialog').getBoundingClientRect();return r.width<=innerWidth && r.height<innerHeight*.8;})()")
            if os.getenv("UI_THEME_SCREENSHOT_DIR"):
                (target/f"note-{requested_theme}.png").write_bytes(base64.b64decode(cdp.call("Page.captureScreenshot", {"format":"png"})["data"]))
            cdp.evaluate("document.querySelector('.note-dialog button').click();document.querySelector('.cari-detail-close').click()")
            # An old backend must not block local appearance preferences.
            original_theme = cdp.evaluate("document.documentElement.dataset.theme")
            cdp.evaluate("window.__realApi=api;api=async function(path,options){if(path==='/api/uygulama-ayarlari')throw new Error('Sunucu endpointi bulunamadi.');return window.__realApi(path,options);};openSettings()")
            cdp.wait_for("document.querySelector('.settings-form button[type=submit]')?.disabled===false")
            assert cdp.evaluate("document.querySelector('.settings-form [name=backup_frequency]').disabled && !document.querySelector('.settings-modal').textContent.includes('endpoint')")
            cdp.evaluate("document.querySelector('.settings-form [name=theme]').value=document.documentElement.dataset.theme==='dark'?'light':'dark';document.querySelector('.settings-form').requestSubmit()")
            cdp.wait_for("document.querySelector('.settings-modal')===null")
            assert cdp.evaluate("document.documentElement.dataset.theme")!=original_theme
            assert cdp.evaluate("localStorage.getItem('dunyatek-theme')===document.documentElement.dataset.theme")
            cdp.evaluate("api=window.__realApi;delete window.__realApi")
            print("New UI checks passed: manual has persistence, automatic reset, 500-character notes, note popup, cancel, internal scroll, sticky header, history navigation")
            print("UI smoke test passed: passwordless entry, all pages, original forms and columns, no added currency labels, expense create/edit, dashboard totals")
        finally:
            try:
                cdp.call("Browser.close")
            except Exception:
                pass
            try:
                browser.wait(timeout=5)
            except subprocess.TimeoutExpired:
                browser.terminate()
                browser.wait(timeout=5)
            server.should_exit = True
            thread.join(timeout=5)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python tools/ui_smoke_test.py <chrome-path>")
    run(Path(sys.argv[1]))
