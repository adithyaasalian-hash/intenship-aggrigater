"""
Résumé PDF -> structured profile.

Scanned PDFs and image résumés are OCR'd with Tesseract before the normal
structured-profile parser runs.
"""

from __future__ import annotations

import io
import logging
import re
from datetime import date

logging.getLogger("pdfminer").setLevel(logging.ERROR)  # pdfplumber is chatty
log = logging.getLogger(__name__)

MIN_CHARS_FOR_TEXT_LAYER = 120

RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
RE_PHONE = re.compile(r"(?:\+?\d{1,3}[\s-]?)?(?:\d{10}|\d{5}[\s-]\d{5})")
RE_URL = re.compile(r"(?:https?://)?(?:www\.)?((?:github|linkedin|gitlab)\.com/[\w\-./]+)", re.I)
RE_CGPA = re.compile(
    r"(?:cgpa|gpa|sgpa)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:/\s*(\d{1,2}))?", re.I
)
RE_PERCENT = re.compile(r"(\d{2}(?:\.\d{1,2})?)\s*%")
RE_YEAR = re.compile(r"(19|20)\d{2}")

DEGREE_PATTERNS = [
    (r"\b(b\.?\s?tech|bachelor of technology)\b", "B.Tech"),
    (r"\b(b\.?\s?e\.?|bachelor of engineering)\b", "B.E."),
    (r"\b(m\.?\s?tech|master of technology)\b", "M.Tech"),
    (r"\b(b\.?\s?sc|bachelor of science)\b", "B.Sc"),
    (r"\b(m\.?\s?sc|master of science)\b", "M.Sc"),
    (r"\b(b\.?\s?c\.?a)\b", "BCA"),
    (r"\b(m\.?\s?c\.?a)\b", "MCA"),
    (r"\b(mba|master of business)\b", "MBA"),
    (r"\b(b\.?\s?com)\b", "B.Com"),
    (r"\b(ph\.?\s?d|doctorate)\b", "PhD"),
    (r"\b(diploma)\b", "Diploma"),
    (r"\b(class\s*(?:xii|12)|higher secondary|intermediate)\b", "Class XII"),
]

SECTION_HEADINGS = {
    "education": r"education|academic|qualification",
    "experience": r"experience|employment|work history|internship",
    "skills": r"skills?|technical skills?|technologies|competenc",
    "projects": r"projects?|personal projects?",
    "certifications": r"certification|courses?|training",
}

MONTHS = {
    m: i
    for i, m in enumerate(
        "jan feb mar apr may jun jul aug sep oct nov dec".split(), start=1
    )
}
# "Jun 2025 - Dec 2025", "06/2025 to present", "2024 - 2025"
RE_DATE_RANGE = re.compile(
    r"(?P<from>(?:[a-z]{3,9}\.?\s*)?(?:\d{1,2}[/-])?(?:19|20)\d{2})"
    r"\s*(?:-|–|—|to|until)\s*"
    r"(?P<to>present|current|now|ongoing|(?:[a-z]{3,9}\.?\s*)?(?:\d{1,2}[/-])?(?:19|20)\d{2})",
    re.I,
)


class ScannedResumeError(Exception):
    """PDF has no extractable text layer -- almost certainly a scan or photo."""


# ------------------------------------------------------------------- extract


def extract_text(pdf_bytes: bytes, content_type: str | None = None) -> str:
    """pdfplumber first, PyMuPDF as a second opinion.

    They fail on different things: pdfplumber struggles with some Canva and
    LaTeX exports, PyMuPDF with some heavily-styled Word templates. Trying both
    costs milliseconds and materially raises the hit rate on real résumés,
    which arrive in every template imaginable.
    """
    text = _try_pdfplumber(pdf_bytes)
    if len(text.strip()) < MIN_CHARS_FOR_TEXT_LAYER:
        alternative = _try_pymupdf(pdf_bytes)
        if len(alternative.strip()) > len(text.strip()):
            text = alternative

    minimum_chars = 20 if content_type != "application/pdf" else MIN_CHARS_FOR_TEXT_LAYER
    if len(text.strip()) < minimum_chars:
        text = _try_ocr(pdf_bytes, content_type)
    if len(text.strip()) < minimum_chars:
        raise ScannedResumeError(
            "We could not read enough text from this résumé image. Try a clearer image or enter your skills manually."
        )
    return text


def _try_ocr(payload: bytes, content_type: str | None) -> str:
    try:
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR
        from PIL import Image

        if content_type == "application/pdf" or payload[:4] == b"%PDF":
            import fitz

            with fitz.open(stream=payload, filetype="pdf") as doc:
                images = []
                for page in doc:
                    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                    images.append(Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples))
        else:
            images = [Image.open(io.BytesIO(payload))]
        ocr = RapidOCR()
        text = []
        for image in images:
            result, _ = ocr(np.asarray(image.convert("RGB")))
            if result:
                text.extend(item[1] for item in result)
        return "\n".join(text)
    except Exception as exc:  # noqa: BLE001
        log.warning("OCR failed: %s", exc)
        return ""


def _try_pdfplumber(pdf_bytes: bytes) -> str:
    try:
        import pdfplumber

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            return "\n".join((page.extract_text() or "") for page in pdf.pages)
    except Exception as exc:  # noqa: BLE001
        log.warning("pdfplumber failed: %s", exc)
        return ""


def _try_pymupdf(pdf_bytes: bytes) -> str:
    try:
        import fitz  # PyMuPDF, optional

        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            return "\n".join(page.get_text() for page in doc)
    except Exception as exc:  # noqa: BLE001
        log.debug("pymupdf unavailable or failed: %s", exc)
        return ""


# ----------------------------------------------------------------- sectionize


def split_sections(text: str) -> dict[str, str]:
    """Bucket lines under the most recent recognised heading.

    A heading is a short line (résumés put them on their own line) that matches
    one of the known section words.
    """
    sections: dict[str, list[str]] = {name: [] for name in SECTION_HEADINGS}
    sections["header"] = []
    current = "header"

    for line in text.splitlines():
        stripped = line.strip()
        if 0 < len(stripped) <= 42:
            lowered = stripped.lower()
            for name, pattern in SECTION_HEADINGS.items():
                if re.fullmatch(rf"[^a-z]*(?:{pattern})[^a-z]*", lowered):
                    current = name
                    break
            else:
                sections[current].append(line)
                continue
            continue
        sections[current].append(line)

    return {name: "\n".join(lines).strip() for name, lines in sections.items()}


# --------------------------------------------------------------------- fields


def parse_contact(text: str) -> dict:
    email = RE_EMAIL.search(text)
    phone = RE_PHONE.search(text)
    links = list(dict.fromkeys(m.group(1) for m in RE_URL.finditer(text)))[:3]
    return {
        "email": email.group(0) if email else None,
        "phone": phone.group(0).strip() if phone else None,
        "links": links,
    }


def guess_name(text: str) -> str | None:
    """The first line that reads like a person's name.

    Résumés almost universally lead with the name in a larger font, which comes
    through as the first non-empty line. We reject lines carrying an email,
    digits, or too many words.
    """
    for line in text.splitlines()[:6]:
        candidate = line.strip()
        if not (2 <= len(candidate.split()) <= 4):
            continue
        if RE_EMAIL.search(candidate) or any(ch.isdigit() for ch in candidate):
            continue
        if len(candidate) > 45:
            continue
        letters = [c for c in candidate if c.isalpha()]
        if letters and sum(c.isupper() for c in letters) / len(letters) > 0.9:
            return candidate.title()  # ALL CAPS name
        if candidate[0].isupper():
            return candidate
    return None


def parse_education(section: str, whole: str) -> list[dict]:
    """Degree, institution, year, and grade where we can find them."""
    source = section or whole
    entries: list[dict] = []

    for line in source.splitlines():
        stripped = line.strip()
        if len(stripped) < 4:
            continue

        degree = None
        for pattern, label in DEGREE_PATTERNS:
            if re.search(pattern, stripped, re.I):
                degree = label
                break
        if not degree:
            continue

        years = [int(m.group(0)) for m in RE_YEAR.finditer(stripped)]
        cgpa_match = RE_CGPA.search(stripped)
        cgpa = None
        if cgpa_match:
            value = float(cgpa_match.group(1))
            scale = float(cgpa_match.group(2) or (10 if value <= 10 else 100))
            cgpa = round(value * 10 / scale, 2)  # normalise to /10
        elif (pct := RE_PERCENT.search(stripped)) :
            cgpa = round(float(pct.group(1)) / 10, 2)

        entries.append(
            {
                "degree": degree,
                "institution": _institution_from(stripped),
                "year": max(years) if years else None,
                "cgpa": cgpa,
            }
        )

    # de-duplicate on (degree, year), keeping the richest row
    seen: dict[tuple, dict] = {}
    for entry in entries:
        key = (entry["degree"], entry["year"])
        if key not in seen or sum(v is not None for v in entry.values()) > sum(
            v is not None for v in seen[key].values()
        ):
            seen[key] = entry
    return list(seen.values())[:4]


def _institution_from(line: str) -> str | None:
    match = re.search(
        r"([A-Z][\w.&'-]*(?:\s+[A-Z&][\w.&'-]*){0,5}\s*"
        r"(?:University|Institute|College|School|Academy|IIT|NIT|IIIT|BITS))",
        line,
    )
    return match.group(1).strip() if match else None


def parse_experience_months(section: str) -> int:
    """Sum the date ranges in the experience section.

    Overlapping ranges are merged, because a student who did two concurrent
    internships has done six months of work, not twelve.
    """
    intervals: list[tuple[int, int]] = []
    today = date.today()
    today_index = today.year * 12 + today.month

    for match in RE_DATE_RANGE.finditer(section or ""):
        start = _month_index(match.group("from"))
        raw_end = match.group("to").lower()
        end = (
            today_index
            if raw_end in {"present", "current", "now", "ongoing"}
            else _month_index(raw_end)
        )
        if start is None or end is None or end < start:
            continue
        if end - start > 120:  # >10 years in a student résumé is a parse error
            continue
        intervals.append((start, end))

    if not intervals:
        return 0

    intervals.sort()
    merged = [list(intervals[0])]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    return int(sum(end - start for start, end in merged))


def _month_index(raw: str) -> int | None:
    raw = raw.strip().lower()
    year_match = RE_YEAR.search(raw)
    if not year_match:
        return None
    year = int(year_match.group(0))

    month = 1
    for name, number in MONTHS.items():
        if name in raw:
            month = number
            break
    else:
        if numeric := re.match(r"(\d{1,2})[/-]", raw):
            month = max(1, min(12, int(numeric.group(1))))

    return year * 12 + month


# ------------------------------------------------------------------- pipeline


def parse(pdf_bytes: bytes, content_type: str | None = None, filename: str | None = None) -> dict:
    """PDF bytes -> everything we can learn, minus the embedding.

    Raises ScannedResumeError when the PDF has no text layer.
    """
    from .skills import extract_list  # local import keeps the module graph flat

    text = extract_text(pdf_bytes, content_type)
    sections = split_sections(text)

    return {
        "name": guess_name(text),
        **parse_contact(text),
        "skills": extract_list(text),
        "education": parse_education(sections.get("education", ""), text),
        "experienceMonths": parse_experience_months(
            sections.get("experience", "") or text
        ),
        "sections": {k: v for k, v in sections.items() if v},
        "text": text,
        "charCount": len(text),
    }
