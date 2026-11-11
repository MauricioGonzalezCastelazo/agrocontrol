import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest


def launcher():
    specification = importlib.util.spec_from_file_location(
        "synthetic_launcher", Path(__file__).resolve().parents[2] / "main.py"
    )
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def slow_start(monkeypatch, module, failures):
    clock = SimpleNamespace(value=0, attempts=0)

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def open_url(url, timeout):
        clock.attempts += 1
        if clock.attempts <= failures:
            raise OSError("Synthetic copy still running")
        return Response()

    monkeypatch.setattr(
        module.urllib.request, "build_opener", lambda *args: SimpleNamespace(open=open_url)
    )
    monkeypatch.setattr(module.time, "monotonic", lambda: clock.value)
    monkeypatch.setattr(
        module.time, "sleep", lambda seconds: setattr(clock, "value", clock.value + 2)
    )
    return clock


def test_launcher_allows_long_integrity_copy_without_terminating_api(monkeypatch):
    module = launcher()
    clock = slow_start(monkeypatch, module, failures=60)
    module.wait_for(
        "http://synthetic.invalid/health", SimpleNamespace(poll=lambda: None), timeout=None
    )
    assert clock.value == 120 and clock.attempts == 61


def test_frontend_start_still_has_a_bounded_wait(monkeypatch):
    module = launcher()
    clock = slow_start(monkeypatch, module, failures=1000)
    with pytest.raises(RuntimeError, match="tardó demasiado"):
        module.wait_for("http://synthetic.invalid/frontend", SimpleNamespace(poll=lambda: None))
    assert clock.value < 60
