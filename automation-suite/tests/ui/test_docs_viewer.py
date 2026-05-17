"""
Suite : docs_viewer
Layer : UI + API (HTTP)
Owner : ZAC Platform QA

Verifies that the markdown viewer shell renders AND that all five known
documentation routes return non-trivial markdown content.
"""

from __future__ import annotations

import os
from pathlib import Path

import allure
import pytest
import requests
import yaml

from pages.docs_viewer_page import DocsViewerPage

FIX = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "fixtures/docs_viewer.yaml").read_text()
)


def _ui_base() -> str:
    return os.getenv("ZAC_UI_BASE_URL", "http://localhost:3000").rstrip("/")


@pytest.mark.ui
@pytest.mark.docs_viewer
@pytest.mark.smoke
@pytest.mark.positive
@allure.title("Markdown viewer shell renders")
def test_viewer_shell_renders(smart_page) -> None:
    page = DocsViewerPage(smart_page).open().assert_loaded()
    assert page.find(page.LOC_HEADING).is_visible()


@pytest.mark.api
@pytest.mark.docs_viewer
@pytest.mark.positive
@pytest.mark.parametrize("doc", FIX["served_docs"], ids=lambda d: d["route"])
@allure.title("Doc {doc[route]} returns non-trivial markdown")
def test_served_doc(doc: dict) -> None:
    resp = requests.get(_ui_base() + doc["route"], timeout=10)
    assert resp.status_code == 200, resp.text[:200]
    assert len(resp.content) >= doc["min_bytes"], (
        f"{doc['route']} only returned {len(resp.content)} bytes"
    )
    text = resp.text
    for needle in doc["must_contain"]:
        assert needle.lower() in text.lower(), (
            f"{doc['route']} missing expected token '{needle}'"
        )


@pytest.mark.api
@pytest.mark.docs_viewer
@pytest.mark.negative
@pytest.mark.parametrize("route", FIX["absent_docs"])
@allure.title("Unknown doc route returns 404")
def test_absent_doc(route: str) -> None:
    resp = requests.get(_ui_base() + route, timeout=5)
    assert resp.status_code == 404
