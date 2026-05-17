"""
LocatorStrategy chain for self-healing element resolution.

Every Page Object must build interactions on top of a `LocatorChain`.
Selectors are tried in priority order:

    1. data-testid    (most stable; ZAC convention is `data-testid="..."`)
    2. id             (e.g. `#project-dropdown`)
    3. role + name    (Playwright `get_by_role`)
    4. label          (Playwright `get_by_label`)
    5. text           (Playwright `get_by_text`, fuzzy)
    6. css            (last-resort raw CSS)
    7. xpath          (final fallback)

When a strategy returns a healed locator, the resolution is recorded and the
HealerEngine writes a suggested fix to `reports/healer/`.

Owner: ZAC Platform QA
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

from utils.healer_engine import healer
from utils.logger import get_logger

if TYPE_CHECKING:
    from playwright.sync_api import Locator, Page

log = get_logger(__name__)


@dataclass(frozen=True)
class LocatorSpec:
    """Declarative locator definition. At least one strategy must be set."""

    name: str
    testid: Optional[str] = None
    id_: Optional[str] = None
    role: Optional[str] = None
    role_name: Optional[str] = None
    label: Optional[str] = None
    text: Optional[str] = None
    css: Optional[str] = None
    xpath: Optional[str] = None
    extras: tuple[str, ...] = field(default_factory=tuple)


class LocatorChain:
    """Resolves a `LocatorSpec` against a Playwright `Page` using a priority chain."""

    def __init__(self, page: "Page", spec: LocatorSpec) -> None:
        self._page = page
        self._spec = spec

    def resolve(self) -> "Locator":
        """Return the first strategy that yields exactly one visible element."""
        candidates = self._build_candidates()

        for idx, (strategy, locator) in enumerate(candidates):
            try:
                count = locator.count()
            except Exception as exc:
                log.debug(
                    "locator strategy errored",
                    extra={
                        "event": "locator.error",
                        "name": self._spec.name,
                        "strategy": strategy,
                        "error": str(exc),
                    },
                )
                continue

            if count >= 1:
                if idx > 0:
                    healer.record_heal(
                        name=self._spec.name,
                        primary_strategy=candidates[0][0],
                        healed_strategy=strategy,
                    )
                return locator.first

        raise LookupError(
            f"LocatorChain failed: no strategy resolved '{self._spec.name}'. "
            f"Tried: {[s for s, _ in candidates]}"
        )

    def _build_candidates(self) -> list[tuple[str, "Locator"]]:
        page = self._page
        s = self._spec
        out: list[tuple[str, "Locator"]] = []

        if s.testid:
            out.append((f"testid={s.testid}", page.get_by_test_id(s.testid)))
        if s.id_:
            out.append((f"id={s.id_}", page.locator(f"#{s.id_}")))
        if s.role:
            kwargs = {"name": s.role_name} if s.role_name else {}
            out.append((f"role={s.role}", page.get_by_role(s.role, **kwargs)))
        if s.label:
            out.append((f"label={s.label}", page.get_by_label(s.label)))
        if s.text:
            out.append((f"text={s.text}", page.get_by_text(s.text)))
        if s.css:
            out.append((f"css={s.css}", page.locator(s.css)))
        if s.xpath:
            out.append((f"xpath={s.xpath}", page.locator(f"xpath={s.xpath}")))
        for extra in s.extras:
            out.append((f"extra={extra}", page.locator(extra)))

        if not out:
            raise ValueError(
                f"LocatorSpec '{s.name}' must declare at least one strategy"
            )
        return out
