"""
Skip helpers for tests that depend on optional system tools (mvn, npm, k6).
These tests should not fail CI when the tool is genuinely missing - they
should *skip*, with the reason surfaced in the Allure report.

Owner: ZAC Platform QA
"""

from __future__ import annotations

import shutil

import pytest


def require_command(name: str) -> None:
    """Skip the test if `name` is not on $PATH."""
    if shutil.which(name) is None:
        pytest.skip(f"system tool '{name}' is not installed; skipping")
