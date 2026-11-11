import os
import sys
from pathlib import Path


def data_directory() -> Path:
    if configured := os.environ.get("AGROCONTROL_DATA_DIR"):
        path = Path(configured).expanduser()
        if not path.is_absolute():
            raise ValueError("AGROCONTROL_DATA_DIR must be absolute")
        return path
    if sys.platform == "win32":
        return (
            Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "AgroControl"
        )
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "AgroControl"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "agrocontrol"
