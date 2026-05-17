"""
Suite : project_management
Layer : Security
Owner : ZAC Platform QA

Verifies the security envelope around `/api/projects/*`:

    - Helmet response headers (CSP, X-Frame-Options, X-Content-Type-Options)
    - CORS allow-list rejects disallowed origins
    - Strict rate limiter on POST /api/projects (10 req / 5 min) returns 429
    - Input validation rejects path-traversal / injection IDs

These tests intentionally hit the live server; in CI they run after the
service is up via the `services:` block.
"""

from __future__ import annotations

import os
import uuid

import allure
import pytest
import requests

from utils.api_client import ZacApiClient


def _api_url() -> str:
    return os.getenv("ZAC_API_BASE_URL", "http://localhost:3000/api").rstrip("/")


# ============================================================
#                       SECURITY HEADERS
# ============================================================


@pytest.mark.security
@pytest.mark.smoke
@allure.title("Security headers (Helmet) are present on /api/health")
def test_helmet_headers_present() -> None:
    resp = requests.get(f"{_api_url()}/health", timeout=10)
    assert resp.status_code == 200

    headers = {k.lower(): v for k, v in resp.headers.items()}

    assert "content-security-policy" in headers, "CSP header missing"
    assert headers.get("x-content-type-options", "").lower() == "nosniff"
    assert "x-frame-options" in headers or "frame-ancestors" in headers.get(
        "content-security-policy", ""
    )
    assert "strict-transport-security" in headers or os.getenv("ZAC_ENV", "dev") == "dev"


# ============================================================
#                            CORS
# ============================================================


@pytest.mark.security
@allure.title("CORS preflight rejects unlisted origin")
def test_cors_rejects_unlisted_origin() -> None:
    resp = requests.options(
        f"{_api_url()}/projects",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
        timeout=10,
    )
    allow = resp.headers.get("Access-Control-Allow-Origin", "")
    assert allow != "https://evil.example.com", (
        f"Server echoed disallowed origin: {allow}"
    )


@pytest.mark.security
@allure.title("CORS preflight allows configured origin")
def test_cors_allows_listed_origin() -> None:
    origin = "http://localhost:3000"
    resp = requests.options(
        f"{_api_url()}/projects",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
        timeout=10,
    )
    assert resp.status_code in {200, 204}
    assert resp.headers.get("Access-Control-Allow-Origin") == origin


# ============================================================
#                        RATE LIMITING
# ============================================================


@pytest.mark.security
@pytest.mark.flaky_quarantine
@allure.title("Strict rate limiter on POST /projects returns 429 after 10 hits")
def test_strict_rate_limit_post_projects(
    api_client: ZacApiClient, cleanup_projects: list[str]
) -> None:
    """
    NOTE: this test is in quarantine because the per-IP counter is shared with
    other tests; run it in isolation (`pytest -m security`) or in a dedicated
    CI lane. We keep it for security regression coverage.
    """
    saw_429 = False
    for i in range(15):
        name = f"RL Probe {uuid.uuid4().hex[:6]}-{i}"
        resp = api_client.create_project({"name": name})
        if resp.status_code == 429:
            saw_429 = True
            break
        if resp.status_code == 200:
            cleanup_projects.append(resp.json()["project"]["id"])

    assert saw_429, "Expected 429 within 15 POSTs against strict rate limiter"


# ============================================================
#                   INPUT VALIDATION (deep)
# ============================================================


@pytest.mark.security
@pytest.mark.parametrize(
    "bad_id",
    [
        "../../etc/passwd",
        "..%2F..%2Fetc%2Fpasswd",
        "<script>alert(1)</script>",
        "; DROP TABLE projects;",
        "id with space",
        "id/with/slash",
    ],
)
@allure.title("Project ID validator rejects malicious input: {bad_id}")
def test_project_id_validator(api_client: ZacApiClient, bad_id: str) -> None:
    resp = api_client.get_project(bad_id)
    assert resp.status_code in {400, 404}, (
        f"Server should reject '{bad_id}', got {resp.status_code}"
    )
