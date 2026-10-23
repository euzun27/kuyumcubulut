from __future__ import annotations

import contextlib
import importlib
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path

APP_NAME = "Kuyumcu Takip"
HOST = "127.0.0.1"
STARTUP_TIMEOUT_SECONDS = 20


def resource_path(relative_path: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative_path


def desktop_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "KuyumcuTakip"
    if os.name == "nt":
        return Path(os.getenv("APPDATA", Path.home())) / "KuyumcuTakip"
    return Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "KuyumcuTakip"


def prepare_database_path() -> None:
    data_dir = desktop_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "kuyumcu.db"
    os.environ.setdefault("DB_PATH", str(db_path))


prepare_database_path()

import uvicorn  # noqa: E402

import main as backend  # noqa: E402


@dataclass
class DesktopServer:
    server: uvicorn.Server
    thread: threading.Thread
    url: str


def find_free_port() -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind((HOST, 0))
        return int(sock.getsockname()[1])


def wait_until_ready(url: str, timeout_seconds: int = STARTUP_TIMEOUT_SECONDS) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as response:
                if response.status < 500:
                    return
        except Exception as exc:  # noqa: BLE001 - startup probe should keep retrying.
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"Uygulama baslatilamadi: {last_error}")


def start_backend() -> DesktopServer:
    port = find_free_port()
    url = f"http://{HOST}:{port}"
    config = uvicorn.Config(
        backend.app,
        host=HOST,
        port=port,
        log_level="warning",
        access_log=False,
        lifespan="on",
        log_config=None,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="kuyumcu-backend", daemon=True)
    thread.start()
    wait_until_ready(f"{url}/login")
    return DesktopServer(server=server, thread=thread, url=url)


def stop_backend(desktop_server: DesktopServer) -> None:
    desktop_server.server.should_exit = True


def windows_browser_candidates() -> list[Path]:
    local_appdata = Path(os.getenv("LOCALAPPDATA", ""))
    program_files = Path(os.getenv("PROGRAMFILES", ""))
    program_files_x86 = Path(os.getenv("PROGRAMFILES(X86)", ""))
    return [
        local_appdata / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        program_files / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        program_files_x86 / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        local_appdata / "Google" / "Chrome" / "Application" / "chrome.exe",
        program_files / "Google" / "Chrome" / "Application" / "chrome.exe",
        program_files_x86 / "Google" / "Chrome" / "Application" / "chrome.exe",
    ]


def launch_windows_browser_app(url: str) -> subprocess.Popen[bytes] | None:
    profile_dir = desktop_data_dir() / "browser-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    for browser in windows_browser_candidates():
        if browser.exists():
            return subprocess.Popen(
                [
                    str(browser),
                    f"--app={url}",
                    f"--user-data-dir={profile_dir}",
                    "--no-first-run",
                    "--disable-default-apps",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    webbrowser.open(url)
    return None


def show_windows_fallback_window() -> None:
    import tkinter as tk
    from tkinter import ttk

    root = tk.Tk()
    root.title(APP_NAME)
    root.geometry("360x120")
    root.resizable(False, False)
    ttk.Label(root, text="Kuyumcu Takip acik.").pack(pady=(22, 6))
    ttk.Label(root, text="Kapatmak icin bu pencereyi kapatin.").pack(pady=(0, 12))
    ttk.Button(root, text="Kapat", command=root.destroy).pack()
    root.mainloop()


def run_windows() -> None:
    desktop_server = start_backend()
    browser_process = launch_windows_browser_app(desktop_server.url)
    try:
        if browser_process is None:
            show_windows_fallback_window()
        else:
            browser_process.wait()
    finally:
        stop_backend(desktop_server)


def run_pywebview() -> None:
    webview = importlib.import_module("webview")
    webview.settings["ALLOW_DOWNLOADS"] = True
    desktop_server = start_backend()
    window = webview.create_window(
        APP_NAME,
        desktop_server.url,
        width=1280,
        height=820,
        min_size=(1040, 700),
        confirm_close=True,
    )
    window.events.closed += lambda: stop_backend(desktop_server)
    webview.start(debug=False)


def run() -> None:
    if os.name == "nt":
        run_windows()
        return
    run_pywebview()


if __name__ == "__main__":
    run()
