"""
Skill extraction by curated taxonomy + longest-match token scan.

Why not a trained NER model: we have no labelled data, no time to label any,
and -- most importantly -- explainability IS the product here. When a judge
asks "why does this say 82%?", we point at the exact matched tokens. A neural
extractor cannot do that, which makes it the wrong tool for this job even
where it would score marginally better.

Why not spaCy's PhraseMatcher: it works fine, but it drags in spaCy plus a
~12 MB language model for what is 60 lines of dictionary lookup. On a 512 MB
free-tier container that memory matters.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

DATA = Path(__file__).parent / "data" / "skills.yaml"

# Sections in a job description that describe optional skills rather than
# required ones. Matched against a line of text, case-insensitively.
_PREFERRED_HEADING = re.compile(
    r"(nice[- ]to[- ]have|good[- ]to[- ]have|preferred|bonus|plus(?:es)?\b|"
    r"desirable|would be a plus|advantage)",
    re.I,
)
_REQUIRED_HEADING = re.compile(
    r"(requirement|required|must[- ]have|qualification|what you.{0,10}(need|bring)|"
    r"skills? (?:you|we).{0,20}|eligibility|who (?:can|should) apply)",
    re.I,
)


def normalize(text: str) -> list[str]:
    """Lowercase and tokenize.

    Applied identically to taxonomy aliases and to raw text, so the two sides
    always agree. The two explicit replacements exist because '+' and '#' carry
    meaning in language names and would otherwise be stripped as punctuation:

        "C++"      -> ["cplusplus"]
        "C#"       -> ["csharp"]
        "Node.js"  -> ["node", "js"]
        "CI/CD"    -> ["ci", "cd"]
        "Python."  -> ["python"]
    """
    text = text.lower().replace("++", "plusplus").replace("#", "sharp")
    return re.sub(r"[^a-z0-9]+", " ", text).split()


@dataclass
class Taxonomy:
    alias_to_canonical: dict[str, str]
    canonical_to_category: dict[str, str]
    max_alias_tokens: int

    @property
    def size(self) -> int:
        return len(self.canonical_to_category)


def load_taxonomy(path: Path = DATA) -> Taxonomy:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    alias_to_canonical: dict[str, str] = {}
    canonical_to_category: dict[str, str] = {}
    max_tokens = 1

    for category, entries in raw.items():
        for canonical, aliases in (entries or {}).items():
            canonical_to_category[canonical] = category
            # the canonical name itself is always an alias
            for alias in [canonical.replace("_", " "), *(aliases or [])]:
                tokens = normalize(str(alias))
                if not tokens:
                    continue
                key = " ".join(tokens)
                # first definition wins, so a specific skill is never
                # overwritten by a later generic one
                alias_to_canonical.setdefault(key, canonical)
                max_tokens = max(max_tokens, len(tokens))

    return Taxonomy(alias_to_canonical, canonical_to_category, max_tokens)


TAXONOMY = load_taxonomy()


def extract(text: str, taxonomy: Taxonomy = TAXONOMY) -> dict[str, int]:
    """Return {canonical_skill: times_mentioned}.

    Greedy longest-match: "machine learning" is consumed as one skill rather
    than matching "machine" and then "learning" separately, and the tokens it
    consumed are not reconsidered.
    """
    tokens = normalize(text)
    counts: dict[str, int] = {}
    i, n = 0, len(tokens)

    while i < n:
        for length in range(min(taxonomy.max_alias_tokens, n - i), 0, -1):
            key = " ".join(tokens[i : i + length])
            canonical = taxonomy.alias_to_canonical.get(key)
            if canonical:
                counts[canonical] = counts.get(canonical, 0) + 1
                i += length
                break
        else:
            i += 1

    return counts


def extract_list(text: str, taxonomy: Taxonomy = TAXONOMY) -> list[str]:
    """Skills ordered by how often they are mentioned, then alphabetically."""
    counts = extract(text, taxonomy)
    return sorted(counts, key=lambda s: (-counts[s], s))


def split_sections(text: str) -> tuple[str, str]:
    """Split a job description into (required_part, preferred_part).

    Walks the text line by line tracking which heading was seen most recently.
    Anything before the first recognised heading counts as required, because a
    skill named in the opening paragraph is almost never optional.
    """
    required: list[str] = []
    preferred: list[str] = []
    bucket = required

    for line in text.splitlines():
        stripped = line.strip()
        # a heading is short and contains one of the marker phrases
        if len(stripped) <= 80:
            if _PREFERRED_HEADING.search(stripped):
                bucket = preferred
            elif _REQUIRED_HEADING.search(stripped):
                bucket = required
        bucket.append(line)

    return "\n".join(required), "\n".join(preferred)


def extract_job_skills(
    text: str, taxonomy: Taxonomy = TAXONOMY
) -> tuple[list[str], list[str]]:
    """Return (required, preferred) for a job description.

    A skill that appears in both sections counts as required -- if they ask for
    it in the requirements, calling it 'nice to have' elsewhere does not make it
    optional.
    """
    required_text, preferred_text = split_sections(text)
    required = extract_list(required_text, taxonomy)
    preferred = [s for s in extract_list(preferred_text, taxonomy) if s not in required]
    return required, preferred


def category_of(skill: str, taxonomy: Taxonomy = TAXONOMY) -> str:
    return taxonomy.canonical_to_category.get(skill, "other")


def pretty(skill: str) -> str:
    """Canonical name -> something a human wants to read on a chip."""
    special = {
        "cpp": "C++",
        "csharp": "C#",
        "nodejs": "Node.js",
        "nextjs": "Next.js",
        "nestjs": "NestJS",
        "fastapi": "FastAPI",
        "graphql": "GraphQL",
        "postgresql": "PostgreSQL",
        "mongodb": "MongoDB",
        "aws": "AWS",
        "gcp": "GCP",
        "sql": "SQL",
        "nlp": "NLP",
        "llm": "LLM",
        "ci_cd": "CI/CD",
        "rest_api": "REST APIs",
        "ui_design": "UI design",
        "ux_design": "UX design",
        "html": "HTML",
        "css": "CSS",
        "seo": "SEO",
        "oop": "OOP",
        "etl": "ETL",
        "mlops": "MLOps",
        "powerbi": "Power BI",
        "dbt": "dbt",
        "web3": "Web3",
        "crm": "CRM",
        "grpc": "gRPC",
        "r": "R",
    }
    if skill in special:
        return special[skill]
    return skill.replace("_", " ").title()
