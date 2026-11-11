import hashlib
import os
import zipfile
from pathlib import Path

from fastapi import HTTPException


def verify_file(path, size, sha256):
    try:
        with path.open("rb") as source:
            return (
                path.stat().st_size == size
                and hashlib.file_digest(source, "sha256").hexdigest() == sha256
            )
    except OSError:
        return False


def validate_type(path, filename):
    suffix = Path(filename).suffix.lower()
    with path.open("rb") as source:
        head = source.read(32)
    signatures = {
        ".pdf": (b"%PDF-",),
        ".png": (b"\x89PNG\r\n\x1a\n",),
        ".jpg": (b"\xff\xd8\xff",),
        ".jpeg": (b"\xff\xd8\xff",),
        ".xls": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
        ".doc": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    }
    valid = True
    if suffix in signatures:
        valid = head.startswith(signatures[suffix])
    elif suffix == ".webp":
        valid = head.startswith(b"RIFF") and head[8:12] == b"WEBP"
    elif suffix in (".heic", ".heif"):
        valid = head[4:8] == b"ftyp" and any(
            brand in head[8:] for brand in (b"heic", b"heix", b"mif1", b"hevc")
        )
    elif suffix in (".xlsx", ".docx", ".odt", ".ods"):
        try:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                valid = (
                    len(names) <= 10000
                    and sum(i.file_size for i in archive.infolist()) <= 100 * 1024 * 1024
                )
                valid = valid and not any("vbaproject" in name.lower() for name in names)
                if suffix in (".xlsx", ".docx"):
                    valid = (
                        valid
                        and "[Content_Types].xml" in names
                        and any(
                            name.startswith("xl/" if suffix == ".xlsx" else "word/")
                            for name in names
                        )
                    )
                else:
                    valid = (
                        valid
                        and "mimetype" in names
                        and archive.getinfo("mimetype").file_size < 200
                    )
                    if valid:
                        valid = archive.read("mimetype") == (
                            b"application/vnd.oasis.opendocument.spreadsheet"
                            if suffix == ".ods"
                            else b"application/vnd.oasis.opendocument.text"
                        )
        except (zipfile.BadZipFile, OSError, KeyError):
            valid = False
    elif suffix in (".txt", ".csv"):
        valid = b"\x00" not in head or head.startswith((b"\xff\xfe", b"\xfe\xff"))
    else:
        valid = False
    if not valid:
        raise HTTPException(422, "El contenido no corresponde al tipo de documento seleccionado")


def durable_replace(temporary, destination):
    with temporary.open("r+b") as source:
        os.fsync(source.fileno())
    os.replace(temporary, destination)
    if os.name != "nt":
        descriptor = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
