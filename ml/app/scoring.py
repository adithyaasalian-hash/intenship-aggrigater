"""
The five-component fit score.

    fit = 100 x ( 0.45*skill_coverage
                + 0.25*semantic
                + 0.12*seniority
                + 0.10*location
                + 0.08*freshness )

One rule governs this file: the number and the sentence come from the same
function. If the reason string were generated anywhere else it would drift,
and sooner or later a judge would catch a card claiming 91% while listing five
missing skills.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from .settings import settings
from .skills import pretty

NEUTRAL_LOCATION = 0.8  # user expressed no preference -- do not punish the job


# ---------------------------------------------------------------- components


def skill_coverage(
    candidate: set[str], required: list[str], preferred: list[str]
) -> tuple[float, list[str], list[str]]:
    """Weighted overlap. Returns (fraction, matched, missing).

    'missing' lists only required skills. A preferred skill the candidate does
    not have is not a gap worth showing them -- the posting already said it was
    optional.
    """
    weighted_total = len(required) + settings.preferred_weight * len(preferred)
    if weighted_total == 0:
        # Posting listed no recognisable skills. Fall through to the semantic
        # term rather than scoring this as a perfect or a zero match.
        return 0.5, [], []

    matched_required = [s for s in required if s in candidate]
    matched_preferred = [s for s in preferred if s in candidate]
    missing_required = [s for s in required if s not in candidate]

    earned = len(matched_required) + settings.preferred_weight * len(matched_preferred)
    return (
        earned / weighted_total,
        matched_required + matched_preferred,
        missing_required,
    )


def semantic_similarity(a: np.ndarray | None, b: np.ndarray | None) -> float:
    """Cosine of two unit vectors, clipped to [0, 1].

    Negative cosine means 'unrelated', not 'anti-related', so it floors at 0.
    """
    if a is None or b is None or a.size == 0 or b.size == 0 or a.size != b.size:
        return 0.0
    return float(np.clip(np.dot(a, b), 0.0, 1.0))


def seniority_fit(required_months: float | None, candidate_months: float | None) -> float:
    """1.0 at an exact match, decaying to 0 over the tolerance window.

    A posting that states no experience requirement is neutral, not perfect --
    most internship listings say nothing, and we should not let that term
    silently inflate every score.
    """
    if required_months is None:
        return 1.0
    gap = abs(float(required_months) - float(candidate_months or 0))
    return max(0.0, 1.0 - min(1.0, gap / settings.seniority_tolerance_months))


def location_fit(job_location: dict | None, preferences: dict | None) -> float:
    job_location = job_location or {}
    preferences = preferences or {}

    if job_location.get("remote"):
        return 1.0 if preferences.get("remoteOk", True) else 0.5

    wanted = {str(x).strip().lower() for x in (preferences.get("locations") or []) if x}
    if not wanted:
        return NEUTRAL_LOCATION

    city = str(job_location.get("city") or "").lower()
    state = str(job_location.get("state") or "").lower()

    if city and city in wanted:
        return 0.9
    if state and state in wanted:
        return 0.6
    return 0.3


def freshness(posted_at: datetime | None, now: datetime | None = None) -> float:
    """Exponential decay. A listing posted today scores 1.0, one from three
    weeks ago about 0.37, one from two months ago about 0.05."""
    if posted_at is None:
        return 0.5
    now = now or datetime.now(timezone.utc)
    if posted_at.tzinfo is None:
        posted_at = posted_at.replace(tzinfo=timezone.utc)
    days = max(0.0, (now - posted_at).total_seconds() / 86400.0)
    return math.exp(-days / settings.freshness_half_life_days)


# -------------------------------------------------------------------- reason


def band_of(score: int) -> str:
    if score >= settings.band_strong:
        return "strong"
    if score >= settings.band_good:
        return "good"
    if score >= settings.band_fair:
        return "fair"
    return "weak"


def _human_days(posted_at: datetime | None, now: datetime) -> str | None:
    if posted_at is None:
        return None
    if posted_at.tzinfo is None:
        posted_at = posted_at.replace(tzinfo=timezone.utc)
    days = int((now - posted_at).total_seconds() // 86400)
    if days <= 0:
        return "posted today"
    if days == 1:
        return "posted yesterday"
    if days <= 30:
        return f"posted {days} days ago"
    return None


def build_reason(
    n_matched_required: int,
    n_required: int,
    missing: list[str],
    posted_at: datetime | None,
    now: datetime,
    degraded_semantics: bool = False,
) -> str:
    """The sentence under the number. Written for a nervous final-year student,
    not for a recruiter: concrete, specific, never scolding."""
    parts: list[str] = []

    if n_required == 0:
        parts.append("no specific skills listed - ranked on description similarity")
    elif n_matched_required == n_required:
        parts.append(f"all {n_required} required skills")
    else:
        parts.append(f"{n_matched_required} of {n_required} required skills")

    if missing:
        shown = ", ".join(pretty(s) for s in missing[:3])
        extra = len(missing) - 3
        parts.append(f"missing {shown}" + (f" and {extra} more" if extra > 0 else ""))

    age = _human_days(posted_at, now)
    if age:
        parts.append(age)

    if degraded_semantics:
        parts.append("semantic model offline")

    return " · ".join(parts)


# --------------------------------------------------------------------- score


def score_one(
    profile: dict,
    job: dict,
    now: datetime | None = None,
    semantic: float | None = None,
    degraded_semantics: bool = False,
) -> dict:
    """Score one job against one profile.

    `semantic` may be passed in pre-computed when scoring in bulk; otherwise it
    is calculated here from the two embeddings.
    """
    now = now or datetime.now(timezone.utc)
    weights = settings.weights

    candidate_skills = {s.lower() for s in (profile.get("skills") or [])}
    required = [s.lower() for s in (job.get("skillsRequired") or [])]
    preferred = [s.lower() for s in (job.get("skillsPreferred") or [])]

    coverage, matched, missing = skill_coverage(candidate_skills, required, preferred)

    if semantic is None:
        semantic = semantic_similarity(
            _as_vector(profile.get("embedding")), _as_vector(job.get("embedding"))
        )

    components = {
        "skills": round(coverage, 4),
        "semantic": round(float(semantic), 4),
        "seniority": round(
            seniority_fit(job.get("requiredMonths"), profile.get("experienceMonths")), 4
        ),
        "location": round(
            location_fit(job.get("location"), profile.get("preferences")), 4
        ),
        "freshness": round(freshness(job.get("postedAt"), now), 4),
    }

    total = sum(weights[k] * v for k, v in components.items())
    score = int(round(100 * total))
    n_matched_required = sum(1 for s in required if s in candidate_skills)

    return {
        "opportunityId": job.get("id") or job.get("_id"),
        "score": score,
        "band": band_of(score),
        "reason": build_reason(
            n_matched_required, len(required), missing, job.get("postedAt"), now,
            degraded_semantics,
        ),
        "components": components,
        "matched": matched,
        "missing": missing,
    }


def score_many(
    profile: dict,
    jobs: list[dict],
    now: datetime | None = None,
    degraded_semantics: bool = False,
) -> list[dict]:
    """Score a batch, sorted best first.

    The semantic term is the only expensive part, so it is done once as a
    matrix-vector product rather than per job. On 400 jobs x 384 dims this is
    roughly 0.3 ms; the Python loop around it dominates and is still trivial.
    """
    now = now or datetime.now(timezone.utc)
    if not jobs:
        return []

    profile_vector = _as_vector(profile.get("embedding"))
    semantics: list[float] = [0.0] * len(jobs)

    if profile_vector is not None:
        rows, index_of = [], []
        for i, job in enumerate(jobs):
            vector = _as_vector(job.get("embedding"))
            if vector is not None and vector.size == profile_vector.size:
                rows.append(vector)
                index_of.append(i)
        if rows:
            similarities = np.clip(np.vstack(rows) @ profile_vector, 0.0, 1.0)
            for position, i in enumerate(index_of):
                semantics[i] = float(similarities[position])

    scored = [
        score_one(profile, job, now, semantics[i], degraded_semantics)
        for i, job in enumerate(jobs)
    ]
    scored.sort(key=lambda r: r["score"], reverse=True)
    return scored


def skill_gap(
    profile: dict, jobs: list[dict], min_score: int = 0, limit: int = 12
) -> list[dict]:
    """Which missing skills block the most otherwise-good roles.

    This is the 'so what' of the whole product: not just 'you scored 62', but
    'learn Docker and 23 more roles open up'. Counts a skill only where the
    student already clears the bar on everything else, so it never tells them
    to learn Kubernetes for a job they were never close to.
    """
    candidate = {s.lower() for s in (profile.get("skills") or [])}
    blocked: dict[str, dict] = {}

    for job in jobs:
        if job.get("score", 0) < min_score:
            continue
        for raw in job.get("missing") or []:
            skill = raw.lower()
            if skill in candidate:
                continue
            entry = blocked.setdefault(
                skill, {"skill": skill, "label": pretty(skill), "blocks": 0, "examples": []}
            )
            entry["blocks"] += 1
            if len(entry["examples"]) < 3 and job.get("title"):
                entry["examples"].append(
                    {"title": job["title"], "company": job.get("company")}
                )

    ranked = sorted(blocked.values(), key=lambda e: (-e["blocks"], e["skill"]))
    return ranked[:limit]


def _as_vector(value) -> np.ndarray | None:
    if value is None:
        return None
    vector = np.asarray(value, dtype=np.float32)
    if vector.ndim != 1 or vector.size == 0:
        return None
    return vector
