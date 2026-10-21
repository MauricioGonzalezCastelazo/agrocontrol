"""Start the usable local workspace, or the private backend with --api."""

import argparse
import os
import shutil
import socket
import subprocess
import sys
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
    if args.api:
        return subprocess.call(
            [
                sys.executable,
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

    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        print("Instala Node.js para iniciar la interfaz.", flush=True)
        return 1
    frontend = project_root / "frontend"
    if not (frontend / "node_modules" / "vite" / "bin" / "vite.js").is_file():
        print("Primero ejecuta: cd frontend; npm ci", flush=True)
        return 1
    # Keep this origin stable: browser storage belongs to host + port.
    with socket.socket() as connection:
        if connection.connect_ex(("127.0.0.1", 5174)) == 0:
            print(
                "El puerto 5174 ya está en uso. Si AgroControl está abierto, entra en http://127.0.0.1:5174/. No cambies de puerto para buscar tus datos locales.",
                flush=True,
            )
            return 1
    environment = os.environ.copy()
    environment["VITE_ENABLE_LOCAL_WORKSPACE"] = "true"
    print(
        "AgroControl: http://127.0.0.1:5174/\nModo local: clientes, pedidos y archivos se guardan en este navegador.\nPara detener: Ctrl+C.",
        flush=True,
    )
    try:
        return subprocess.call(
            [npm, "run", "dev", "--", "--port", "5174", "--strictPort"],
            cwd=frontend,
            env=environment,
        )
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
