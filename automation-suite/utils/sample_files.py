"""
Sample-file generators for upload-driven tests (e.g. /api/requirements/parse).

Generated files live in `automation-suite/tmp/` (gitignored) so each test
controls its own inputs.

Owner: ZAC Platform QA
"""

from __future__ import annotations

from pathlib import Path

TMP_DIR = Path(__file__).resolve().parents[1] / "tmp"


def _ensure_tmp() -> Path:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    return TMP_DIR


SAMPLE_SRS_TXT = """\
Software Requirements Specification - ZAC Demo

REQ-1: The system shall allow a user to register with email and password.
REQ-2: The system shall enforce a minimum password length of 8 characters.
REQ-3: The system shall send a confirmation email after successful registration.
REQ-4: The system shall lock an account after 5 failed login attempts.
REQ-5: As a user, I want to reset my password via email so that I can recover access.

1.1 The application must validate email format on the client side.
1.2 The application should remember a user across sessions via secure cookies.
"""


def write_sample_srs_txt(name: str = "srs-sample.txt") -> Path:
    path = _ensure_tmp() / name
    path.write_text(SAMPLE_SRS_TXT, encoding="utf-8")
    return path


def write_empty_txt(name: str = "empty.txt") -> Path:
    path = _ensure_tmp() / name
    path.write_text("", encoding="utf-8")
    return path


def write_unsupported_binary(name: str = "evil.exe") -> Path:
    path = _ensure_tmp() / name
    path.write_bytes(b"MZ\x90\x00\x03\x00\x00\x00")  # fake DOS/PE header
    return path
