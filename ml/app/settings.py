from __future__ import annotations

import os
from dataclasses import dataclass, field


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    # --- embedding -----------------------------------------------------
    # Empty string means "use whatever fastembed's default is", which is always
    # a valid model id. Set EMBED_MODEL to pin a specific one.
    embed_model: str = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    max_chars_per_doc: int = _i("MAX_CHARS_PER_DOC", 4000)

    # --- scoring weights ----------------------------------------------
    # These are a considered prior, not a fitted result. Skills dominate
    # because that is what a human screener filters on first. If you collect
    # thumbs up/down during the demo, fit them and say that you did.
    # They are normalised at load, so they do not have to sum to 1 by hand.
    w_skills: float = _f("W_SKILLS", 0.45)
    w_semantic: float = _f("W_SEMANTIC", 0.25)
    w_seniority: float = _f("W_SENIORITY", 0.12)
    w_location: float = _f("W_LOCATION", 0.10)
    w_freshness: float = _f("W_FRESHNESS", 0.08)

    # a preferred ("nice to have") skill counts this much of a required one
    preferred_weight: float = _f("PREFERRED_WEIGHT", 0.4)
    # months of experience difference at which the seniority term hits zero
    seniority_tolerance_months: float = _f("SENIORITY_TOLERANCE_MONTHS", 12.0)
    # e-folding time for the recency decay
    freshness_half_life_days: float = _f("FRESHNESS_DAYS", 21.0)

    # --- retrieval -----------------------------------------------------
    retrieve_top_k: int = _i("RETRIEVE_TOP_K", 200)
    saved_job_weight: float = _f("SAVED_JOB_WEIGHT", 0.3)

    # --- bands ---------------------------------------------------------
    band_strong: int = _i("BAND_STRONG", 75)
    band_good: int = _i("BAND_GOOD", 55)
    band_fair: int = _i("BAND_FAIR", 35)

    @property
    def weights(self) -> dict[str, float]:
        raw = {
            "skills": self.w_skills,
            "semantic": self.w_semantic,
            "seniority": self.w_seniority,
            "location": self.w_location,
            "freshness": self.w_freshness,
        }
        total = sum(raw.values()) or 1.0
        return {k: v / total for k, v in raw.items()}


settings = Settings()
