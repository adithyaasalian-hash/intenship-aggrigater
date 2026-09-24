from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import scoring
from .embedder import Embedder
from .resume import ScannedResumeError, parse as parse_resume
from .schemas import (
    EmbedRequest, EmbedResponse, ExtractRequest, ExtractResponse, ExtractedSkills,
    HealthResponse, ParseResponse, RecommendRequest, ScoreRequest, ScoreResponse,
    SkillGapResponse,
)
from .settings import settings
from .skills import TAXONOMY, extract_job_skills
from .store import OpportunityIndex

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)
log = logging.getLogger("ml")

MAX_RESUME_BYTES = 8 * 1024 * 1024

index = OpportunityIndex(
    os.getenv("MONGO_URI", "mongodb://mongo:27017"),
    os.getenv("MONGO_DB", "internships"),
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the model at boot, not on the first request. A free-tier container
    # that wakes from sleep already costs the user 30 seconds; making them wait
    # for a lazy model load on top of that is what turns a demo into an
    # awkward silence.
    embedder = Embedder.get()
    log.info("embedder=%s dim=%d degraded=%s", embedder.name, embedder.dim, embedder.degraded)
    try:
        index.refresh(force=True)
    except Exception as exc:  # noqa: BLE001 - Mongo may not be up yet
        log.warning("initial index build skipped: %s", exc)
    yield


app = FastAPI(title="Internship Aggregator ML", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------- meta


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """The warm-up ping. The frontend hits this on app load so the model is
    already resident by the time anyone uploads a résumé."""
    embedder = Embedder.get()
    return HealthResponse(
        ok=True,
        modelLoaded=True,
        model=embedder.name,
        dim=embedder.dim,
        degraded=embedder.degraded,
        taxonomySize=TAXONOMY.size,
        indexedOpportunities=len(index.jobs),
        indexAgeSeconds=index.stale_seconds,
        indexError=index.error,
        parsedAt=datetime.now(timezone.utc),
    )


@app.post("/reindex")
def reindex() -> dict:
    """Called by the API right after an ingestion run, so new listings are
    searchable immediately instead of at the next 5-minute refresh."""
    return {"indexed": index.refresh(force=True), "error": index.error}


# ----------------------------------------------------------------- embedding


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest) -> EmbedResponse:
    """Batched at ingestion time -- one call per few hundred listings, never
    one call per listing."""
    embedder = Embedder.get()
    vectors = embedder.encode(request.texts)
    return EmbedResponse(
        vectors=vectors.tolist(),
        dim=embedder.dim,
        model=embedder.name,
        degraded=embedder.degraded,
    )


@app.post("/extract-skills", response_model=ExtractResponse)
def extract_skills(request: ExtractRequest) -> ExtractResponse:
    """Run the same extractor over job descriptions that we run over résumés.

    This is what makes the overlap arithmetic mean anything: both sides end up
    speaking one vocabulary of canonical skill names.
    """
    results = []
    for text in request.texts:
        if request.splitRequiredPreferred:
            required, preferred = extract_job_skills(text or "")
        else:
            from .skills import extract_list

            required, preferred = extract_list(text or ""), []
        results.append(ExtractedSkills(required=required, preferred=preferred))
    return ExtractResponse(results=results, taxonomySize=TAXONOMY.size)


# -------------------------------------------------------------------- résumé


@app.post("/parse", response_model=ParseResponse)
async def parse(file: UploadFile = File(...)) -> ParseResponse:
    payload = await file.read()
    if not payload:
        raise HTTPException(400, "Empty file.")
    if len(payload) > MAX_RESUME_BYTES:
        raise HTTPException(413, "Résumé is larger than 8 MB.")

    try:
        parsed = parse_resume(payload, content_type=file.content_type, filename=file.filename)
    except ScannedResumeError as exc:
        # 422 rather than 500: nothing is broken, this PDF just has no text.
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("résumé parse failed")
        raise HTTPException(400, f"Could not read this PDF: {exc}") from exc

    embedder = Embedder.get()
    return ParseResponse(
        name=parsed["name"],
        email=parsed["email"],
        phone=parsed["phone"],
        links=parsed["links"],
        skills=parsed["skills"],
        education=parsed["education"],
        experienceMonths=parsed["experienceMonths"],
        embedding=embedder.encode_one(parsed["text"]).tolist(),
        charCount=parsed["charCount"],
        degraded=embedder.degraded,
    )


# -------------------------------------------------------------------- scoring


@app.post("/score", response_model=ScoreResponse)
def score(request: ScoreRequest) -> ScoreResponse:
    """Score a known set of listings -- the detail page, and the tracker."""
    embedder = Embedder.get()
    jobs = index.by_ids(request.opportunityIds)
    profile = request.profile.model_dump()

    # by_ids() strips embeddings out of the index copy, so re-attach them
    for job in jobs:
        job["embedding"] = None
    matrix_lookup = {job["id"]: i for i, job in enumerate(index.jobs)}
    if index.matrix is not None and profile.get("embedding"):
        query = np.asarray(profile["embedding"], dtype=np.float32)
        for job in jobs:
            row = matrix_lookup.get(job["id"])
            if row is not None and index.matrix.shape[1] == query.size:
                job["_semantic"] = float(np.clip(index.matrix[row] @ query, 0.0, 1.0))

    items = [
        _decorate(scoring.score_one(profile, job, semantic=job.get("_semantic"),
                                    degraded_semantics=embedder.degraded), job)
        for job in jobs
    ]
    items.sort(key=lambda item: item["score"], reverse=True)
    return ScoreResponse(items=items, scannedCandidates=len(jobs), degraded=embedder.degraded)


@app.post("/recommend", response_model=ScoreResponse)
def recommend(request: RecommendRequest) -> ScoreResponse:
    """Two stages, because scoring the whole database per request is wasteful.

    1. Retrieve  - filter, then nearest neighbours by cosine. Cheap, vectorised.
    2. Re-rank   - the full five-component score over those few hundred only.
    """
    embedder = Embedder.get()
    profile = request.profile.model_dump()
    query = _query_vector(profile)

    filters = {
        "remoteOnly": request.remoteOnly,
        "locations": {loc.strip().lower() for loc in request.locations if loc.strip()},
        "minStipend": request.minStipend,
        "skills": {s.lower() for s in request.skills},
        "excludeIds": set(request.excludeIds),
    }

    candidates = index.candidates(query, filters, settings.retrieve_top_k)
    items = [
        _decorate(
            scoring.score_one(profile, job, semantic=job.get("_semantic"),
                              degraded_semantics=embedder.degraded),
            job,
        )
        for job in candidates
    ]
    items.sort(key=lambda item: item["score"], reverse=True)

    return ScoreResponse(
        items=items[: request.limit],
        scannedCandidates=len(candidates),
        degraded=embedder.degraded,
    )


@app.post("/skill-gap", response_model=SkillGapResponse)
def skill_gap(request: RecommendRequest) -> SkillGapResponse:
    """Which missing skills block the most roles you are otherwise close to.

    This is the answer to "so what?" from the judging panel: not a score, but
    a next action.
    """
    embedder = Embedder.get()
    profile = request.profile.model_dump()
    query = _query_vector(profile)
    filters = {
        "remoteOnly": request.remoteOnly,
        "locations": {loc.strip().lower() for loc in request.locations if loc.strip()},
        "minStipend": request.minStipend,
    }

    candidates = index.candidates(query, filters, settings.retrieve_top_k)
    scored = [
        _decorate(
            scoring.score_one(profile, job, semantic=job.get("_semantic"),
                              degraded_semantics=embedder.degraded),
            job,
        )
        for job in candidates
    ]
    # Only count roles the student is already in striking distance of.
    gaps = scoring.skill_gap(profile, scored, min_score=settings.band_fair)
    return SkillGapResponse(gaps=gaps, consideredRoles=len(scored))


# ------------------------------------------------------------------- helpers


def _query_vector(profile: dict) -> np.ndarray | None:
    """Résumé vector, nudged toward what the student has actually saved.

        query = 0.7 * résumé + 0.3 * mean(saved listings)

    Saves are the only honest signal of intent we have on day one, and they
    cost the student nothing to give.
    """
    raw = profile.get("embedding")
    if not raw:
        return None

    vector = np.asarray(raw, dtype=np.float32)
    saved = index.vectors_for(profile.get("savedOpportunityIds") or [])
    if saved is not None and saved.size == vector.size:
        weight = settings.saved_job_weight
        vector = (1 - weight) * vector + weight * saved

    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 1e-9 else vector


def _decorate(item: dict, job: dict) -> dict:
    """Attach the human-facing fields so the API can hand the frontend
    something it renders directly, with no reshaping on the client."""
    item["title"] = job.get("title")
    item["company"] = job.get("company")
    return item
