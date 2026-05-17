"""
Retry helpers with exponential backoff for flaky assertions / network calls.

Wrap any flaky-prone block:

    from utils.retry import retry_assert

    @retry_assert()
    def _check():
        assert page.locator("#status").inner_text() == "Ready"

    _check()

Owner: ZAC Platform QA
"""

from __future__ import annotations

from typing import Callable, TypeVar

from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

T = TypeVar("T")


def retry_assert(
    attempts: int = 4,
    base_seconds: float = 0.25,
    max_seconds: float = 4.0,
    exceptions: tuple[type[BaseException], ...] = (AssertionError,),
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Retry an assertion-style check with exponential backoff."""
    return retry(
        reraise=True,
        stop=stop_after_attempt(attempts),
        wait=wait_exponential(multiplier=base_seconds, max=max_seconds),
        retry=retry_if_exception_type(exceptions),
    )


def retry_network(attempts: int = 5) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Retry a transient network call (connection reset, 5xx, timeouts)."""
    import requests

    return retry(
        reraise=True,
        stop=stop_after_attempt(attempts),
        wait=wait_exponential(multiplier=0.5, max=8.0),
        retry=retry_if_exception_type(
            (
                requests.ConnectionError,
                requests.Timeout,
            )
        ),
    )
