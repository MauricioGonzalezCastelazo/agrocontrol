import json
from pathlib import Path

POLICY = json.loads(Path(__file__).with_name("attachment-policy.json").read_text(encoding="utf-8"))


def allowed_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in POLICY["extensions"]
