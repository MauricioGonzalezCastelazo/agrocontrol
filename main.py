"""Start React + the authorized SQLite API, or the private backend with --api."""

import argparse
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Iniciar AgroControl en este equipo.")
    parser.add_argument(
        "--api",
        action="store_true",
        help="Iniciar solo la API privada (requiere PostgreSQL y Supabase).",
    )
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parent
    executable = (
        project_root
        / ".venv"
        / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )
    python = str(executable) if executable.is_file() else sys.executable
    if args.api:
        return subprocess.call(
            [
                python,
                "-m",
                "uvicorn",
                "app.main:app",
                "--app-dir",
                str(project_root / "backend"),
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            cwd=project_root,
        )

    node = shutil.which("node")
    if not node:
        print("Instala Node.js para iniciar la interfaz.", flush=True)
        return 1
    frontend = project_root / "frontend"
    if not (frontend / "node_modules" / "vite" / "bin" / "vite.js").is_file():
        print("Primero ejecuta: cd frontend; npm ci", flush=True)
        return 1
    # Keep the browser origin stable so phase 3 can inspect the original IndexedDB.
    for port in (5174, 8000):
        with socket.socket() as connection:
            if connection.connect_ex(("127.0.0.1", port)) == 0:
                print(
                    f"El puerto {port} está ocupado. Detén el arranque anterior y ejecuta otra vez python main.py. Conserva la dirección 127.0.0.1:5174 para detectar tus datos anteriores.",
                    flush=True,
                )
                return 1
    checked = subprocess.run(
        [python, "-c", "import fastapi, sqlalchemy, alembic, uvicorn"],
        capture_output=True,
        check=False,
    )
    if checked.returncode:
        print(
            "Instala el backend: python -m venv .venv; después instala backend[dev] con backend/requirements.lock. Consulta README.md.",
            flush=True,
        )
        return 1
    token = secrets.token_urlsafe(32)
    api_environment = os.environ.copy()
    api_environment["AGROCONTROL_BOOTSTRAP"] = token
    frontend_environment = os.environ.copy()
    frontend_environment.pop("AGROCONTROL_BOOTSTRAP", None)
    frontend_environment.update(
        {
            "VITE_ENABLE_LOCAL_WORKSPACE": "true",
            "VITE_LEGACY_LOCAL_TESTS": "false",
            "VITE_LOCAL_API_URL": "http://127.0.0.1:8000/api/v1",
            "VITE_SUPABASE_URL": "",
            "VITE_SUPABASE_PUBLISHABLE_KEY": "",
            "VITE_ORGANIZATION_ID": "",
        }
    )
    print(
        "AgroControl: http://127.0.0.1:5174/\nGuardado local en SQLite. Respaldo externo pendiente.\nEl navegador se abrirá con una autorización temporal. IndexedDB se conserva sin migrar.\nPara detener: Ctrl+C.",
        flush=True,
    )
    processes = []
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    try:
        api = subprocess.Popen(
            [python, "-m", "app.local.cli", "serve"],
            cwd=project_root / "backend",
            env=api_environment,
            creationflags=flags,
        )
        processes.append(api)
        # Integrity scans and verified pre-migration copies can take minutes.
        # Keep waiting while the API process is alive; never kill a healthy copy at 45s.
        wait_for("http://127.0.0.1:8000/health/live", api, timeout=None)
        web = subprocess.Popen(
            [
                node,
                str(frontend / "node_modules/vite/bin/vite.js"),
                "--host",
                "127.0.0.1",
                "--port",
                "5174",
                "--strictPort",
            ],
            cwd=frontend,
            env=frontend_environment,
            creationflags=flags,
        )
        processes.append(web)
        wait_for("http://127.0.0.1:5174/", web)
        # Fragment stays out of HTTP request URLs and access logs; React consumes it once.
        webbrowser.open(f"http://127.0.0.1:5174/#agrocontrol-bootstrap={token}")
        while all(process.poll() is None for process in processes):
            time.sleep(0.25)
        print(
            "Un proceso se detuvo. Se cerrará AgroControl; conserva las capturas no confirmadas.",
            flush=True,
        )
        return 1
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError) as error:
        print(str(error), flush=True)
        return 1
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                try:
                    process.send_signal(
                        signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT
                    )
                    process.wait(timeout=8)
                except (OSError, subprocess.TimeoutExpired):
                    process.terminate()
                    process.wait(timeout=5)


def wait_for(url, process, *, timeout=45):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = None if timeout is None else time.monotonic() + timeout
    while deadline is None or time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                "No se pudo iniciar AgroControl. Revisa el error mostrado en la terminal."
            )
        try:
            with opener.open(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError("El arranque tardó demasiado. No se confirmó ningún guardado.")


if __name__ == "__main__":
    raise SystemExit(main())
