"""
Unit tests for the parts that carry the product: skill extraction, the scoring
formula, and résumé parsing.

Run with:  cd ml && python -m pytest tests -q
      or:  cd ml && python tests/test_core.py     (no pytest needed)
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

from app import scoring  # noqa: E402
from app.embedder import HashingEmbedder  # noqa: E402
from app.resume import (  # noqa: E402
    guess_name, parse_contact, parse_education, parse_experience_months, split_sections,
)
from app.skills import extract_job_skills, extract_list, normalize  # noqa: E402

NOW = datetime(2026, 9, 6, tzinfo=timezone.utc)
failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label} {detail}".strip())
        print(f"  FAIL {label} {detail}")


# --------------------------------------------------------------- tokenisation

def test_normalize() -> None:
    print("\nnormalize()")
    check("C++ survives punctuation stripping", normalize("C++") == ["cplusplus"])
    check("C# survives", normalize("C#") == ["csharp"])
    check("trailing period dropped", normalize("We use Python.") == ["we", "use", "python"])
    check("slashes split", normalize("CI/CD") == ["ci", "cd"])
    check("dots split", normalize("Node.js") == ["node", "js"])


def test_skill_extraction() -> None:
    print("\nskill extraction")
    jd = """ML Engineering Intern

    Requirements:
    - Strong Python and SQL
    - PyTorch, pandas, NumPy
    - Machine learning fundamentals, Git, Linux

    Nice to have:
    - Docker, Kubernetes, GraphQL
    """
    required, preferred = extract_job_skills(jd)
    check("required found", {"python", "sql", "pytorch", "git"} <= set(required), required)
    check("preferred found", {"docker", "kubernetes", "graphql"} <= set(preferred), preferred)
    check("no overlap between buckets", not set(required) & set(preferred))
    check(
        "multi-word skill matched whole",
        "machine_learning" in required and "learning" not in required,
    )
    check("bare 'go' does not fire on prose", "go" not in extract_list("we are going to build"))
    check("bare 'r' does not fire on prose", "r" not in extract_list("our team is great"))
    check("'react' does not fire on 'reactive'", "react" not in extract_list("a reactive system"))


# -------------------------------------------------------------------- scoring

def test_components() -> None:
    print("\nscoring components")
    coverage, matched, missing = scoring.skill_coverage(
        {"python", "sql", "git"}, ["python", "sql", "docker"], ["kubernetes"]
    )
    check("coverage is weighted", abs(coverage - 2 / 3.4) < 1e-6, f"got {coverage:.4f}")
    check("missing lists only required", missing == ["docker"], missing)
    check("matched excludes unheld preferred", set(matched) == {"python", "sql"}, matched)

    empty, _, _ = scoring.skill_coverage({"python"}, [], [])
    check("no listed skills is neutral, not zero", empty == 0.5)

    check("exact seniority match", scoring.seniority_fit(6, 6) == 1.0)
    check("unstated requirement is neutral", scoring.seniority_fit(None, 0) == 1.0)
    check("far miss floors at 0", scoring.seniority_fit(0, 240) == 0.0)

    check("remote job is a perfect location fit",
          scoring.location_fit({"remote": True}, {"remoteOk": True}) == 1.0)
    check("no stated preference does not punish",
          scoring.location_fit({"city": "pune"}, {}) == scoring.NEUTRAL_LOCATION)
    check("same city beats same state",
          scoring.location_fit({"city": "pune", "state": "maharashtra"}, {"locations": ["pune"]})
          > scoring.location_fit({"city": "nashik", "state": "maharashtra"},
                                 {"locations": ["maharashtra"]}))

    check("today is fresh", scoring.freshness(NOW, NOW) == 1.0)
    check("decays with age", scoring.freshness(NOW - timedelta(days=21), NOW) < 0.4)
    check("never negative", scoring.freshness(NOW - timedelta(days=400), NOW) >= 0.0)


def test_score_is_bounded_and_ordered() -> None:
    print("\nend-to-end score")
    profile = {
        "skills": ["python", "sql", "pytorch", "pandas", "numpy", "git", "linux"],
        "experienceMonths": 6,
        "preferences": {"locations": ["bengaluru"], "remoteOk": True},
        "embedding": None,
    }
    strong = {
        "id": "a", "title": "ML Intern", "company": "Zerodha",
        "skillsRequired": ["python", "sql", "pytorch", "pandas", "numpy", "git", "linux"],
        "skillsPreferred": ["docker"],
        "location": {"city": "bengaluru", "remote": False},
        "postedAt": NOW - timedelta(days=2), "requiredMonths": 6,
    }
    weak = {
        "id": "b", "title": "Android Intern", "company": "Acme",
        "skillsRequired": ["kotlin", "java", "flutter", "swift"],
        "skillsPreferred": [],
        "location": {"city": "delhi", "remote": False},
        "postedAt": NOW - timedelta(days=180), "requiredMonths": 24,
    }

    results = scoring.score_many(profile, [weak, strong], now=NOW)
    check("best match ranks first", results[0]["opportunityId"] == "a", results[0])
    check("scores stay in 0..100", all(0 <= r["score"] <= 100 for r in results))
    check("strong band assigned", results[0]["band"] in {"strong", "good"}, results[0]["band"])

    # The rule this whole file exists to protect.
    top = results[0]
    n_missing = len(top["missing"])
    check("reason agrees with the number",
          (n_missing == 0) == ("all " in top["reason"]),
          f"score={top['score']} missing={n_missing} reason={top['reason']!r}")
    print(f"       strong -> {top['score']}  {top['reason']}")
    print(f"       weak   -> {results[1]['score']}  {results[1]['reason']}")

    check("missing skills are named in the reason",
          "kotlin" in results[1]["reason"].lower(), results[1]["reason"])


def test_skill_gap() -> None:
    print("\nskill gap")
    profile = {"skills": ["python"]}
    scored = [
        {"score": 70, "missing": ["docker", "aws"], "title": "A", "company": "X"},
        {"score": 65, "missing": ["docker"], "title": "B", "company": "Y"},
        {"score": 20, "missing": ["rust"], "title": "C", "company": "Z"},
    ]
    gaps = scoring.skill_gap(profile, scored, min_score=35)
    check("most blocking skill ranks first", gaps[0]["skill"] == "docker", gaps)
    check("low-scoring roles excluded", all(g["skill"] != "rust" for g in gaps), gaps)
    check("examples attached", len(gaps[0]["examples"]) == 2, gaps[0])


# -------------------------------------------------------------------- résumé

RESUME = """Sri Harsha Kumar
Bengaluru, India | hsrikanth@example.com | +91 98765 43210
github.com/sriharsha | linkedin.com/in/sriharsha

EDUCATION
B.Tech Computer Science, R V College of Engineering, 2027. CGPA: 8.62/10
Class XII, Narayana Junior College, 2023. 94.2%

SKILLS
Python, JavaScript, React, Node.js, MongoDB, Express, SQL, Git, Linux, pandas, NumPy, Docker

EXPERIENCE
Backend Intern, Acme Systems — Jun 2025 - Dec 2025
Built REST APIs with FastAPI and PostgreSQL.
Open Source Contributor — Jan 2026 - present

PROJECTS
Movie recommender using collaborative filtering and scikit-learn.
"""


def test_resume_fields() -> None:
    print("\nrésumé parsing (from text)")
    check("name found", guess_name(RESUME) == "Sri Harsha Kumar", guess_name(RESUME))

    contact = parse_contact(RESUME)
    check("email found", contact["email"] == "hsrikanth@example.com", contact)
    check("phone found", contact["phone"] is not None, contact)
    check("links found", len(contact["links"]) == 2, contact["links"])

    sections = split_sections(RESUME)
    check("sections split", {"education", "skills", "experience"} <= set(sections), list(sections))

    education = parse_education(sections.get("education", ""), RESUME)
    degrees = {e["degree"] for e in education}
    check("degree found", "B.Tech" in degrees, degrees)
    btech = next(e for e in education if e["degree"] == "B.Tech")
    check("cgpa normalised to /10", btech["cgpa"] == 8.62, btech)
    check("institution found", btech["institution"] is not None, btech)
    check("graduation year found", btech["year"] == 2027, btech)

    months = parse_experience_months(sections.get("experience", ""))
    check("experience months plausible", 6 <= months <= 20, months)

    skills = extract_list(RESUME)
    check("résumé skills extracted",
          {"python", "react", "nodejs", "mongodb", "docker"} <= set(skills), skills)


def test_hashing_embedder() -> None:
    print("\nfallback embedder")
    embedder = HashingEmbedder()
    vectors = embedder.encode(["python backend developer", "python backend engineer", "figma"])
    check("rows are unit length", np.allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=1e-5))
    similar = float(vectors[0] @ vectors[1])
    different = float(vectors[0] @ vectors[2])
    check("similar text scores higher than unrelated",
          similar > different, f"{similar:.3f} vs {different:.3f}")
    check("deterministic", np.allclose(vectors, embedder.encode(
        ["python backend developer", "python backend engineer", "figma"])))


if __name__ == "__main__":
    for test in [
        test_normalize, test_skill_extraction, test_components,
        test_score_is_bounded_and_ordered, test_skill_gap,
        test_resume_fields, test_hashing_embedder,
    ]:
        test()

    print()
    if failures:
        print(f"{len(failures)} FAILED:")
        for failure in failures:
            print("  -", failure)
        sys.exit(1)
    print("all checks passed")
