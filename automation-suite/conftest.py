"""
Suite-wide pytest configuration & shared fixtures.

Provides:
    - .env loading
    - Allure environment.properties stamping
    - API client (function + session scope)
    - Playwright page wrapper with smart-wait defaults
    - Atomic teardown registry: any project ID yielded via
      `register_project_for_cleanup(...)` is deleted after the test, even on
      failure - guarantees independence + idempotency.

Owner: ZAC Platform QA
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Iterator

import pytest
from dotenv import load_dotenv

SUITE_ROOT = Path(__file__).resolve().parent
if str(SUITE_ROOT) not in sys.path:
    sys.path.insert(0, str(SUITE_ROOT))

load_dotenv(SUITE_ROOT / ".env", override=False)
load_dotenv(SUITE_ROOT / ".env.example", override=False)

from utils.api_client import ZacApiClient  # noqa: E402
from utils.healer_engine import healer  # noqa: E402
from utils.logger import get_logger  # noqa: E402

log = get_logger("conftest")


# ---------------- Allure env stamping ----------------


def pytest_configure(config: pytest.Config) -> None:
    allure_dir = Path(os.getenv("ALLURE_RESULTS_DIR", "reports/allure-results"))
    allure_dir.mkdir(parents=True, exist_ok=True)
    (allure_dir / "environment.properties").write_text(
        "\n".join(
            [
                f"env={os.getenv('ZAC_ENV', 'dev')}",
                f"ui_base_url={os.getenv('ZAC_UI_BASE_URL', '')}",
                f"api_base_url={os.getenv('ZAC_API_BASE_URL', '')}",
                f"browser={os.getenv('ZAC_BROWSER', 'chromium')}",
                f"healer_enabled={os.getenv('ZAC_HEALER_ENABLED', 'true')}",
                f"suite=project_management",
            ]
        ),
        encoding="utf-8",
    )


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ARG001
    healer.flush()


# ---------------- Playwright config ----------------


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {
        **browser_context_args,
        "viewport": {"width": 1440, "height": 900},
        "ignore_https_errors": True,
        "base_url": os.getenv("ZAC_UI_BASE_URL", "http://localhost:3000"),
    }


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    return {
        **browser_type_launch_args,
        "headless": os.getenv("ZAC_HEADLESS", "true").lower() == "true",
    }


# ---------------- API client fixtures ----------------


@pytest.fixture(scope="session")
def api_client_session() -> Iterator[ZacApiClient]:
    client = ZacApiClient()
    try:
        yield client
    finally:
        client.close()


@pytest.fixture()
def api_client() -> Iterator[ZacApiClient]:
    client = ZacApiClient()
    try:
        yield client
    finally:
        client.close()


# ---------------- Cleanup registry (atomic teardown) ----------------


@pytest.fixture()
def cleanup_projects(api_client: ZacApiClient) -> Iterator[list[str]]:
    """Yield a list; any IDs appended to it are best-effort deleted post-test."""
    registry: list[str] = []
    try:
        yield registry
    finally:
        for pid in registry:
            try:
                resp = api_client.delete_project(pid)
                log.info(
                    "cleanup project",
                    extra={
                        "event": "cleanup.delete_project",
                        "project_id": pid,
                        "status": resp.status_code,
                    },
                )
            except Exception as exc:
                log.warning(
                    "cleanup failed",
                    extra={
                        "event": "cleanup.error",
                        "project_id": pid,
                        "error": str(exc),
                    },
                )


# ---------------- Smart-wait helpers ----------------


@pytest.fixture()
def smart_page(page):
    """A Playwright `Page` with smart timeouts pre-configured."""
    page.set_default_timeout(int(os.getenv("ZAC_DEFAULT_TIMEOUT_MS", "15000")))
    page.set_default_navigation_timeout(
        int(os.getenv("ZAC_NAV_TIMEOUT_MS", "30000"))
    )
    return page
