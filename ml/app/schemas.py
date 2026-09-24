from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class Preferences(BaseModel):
    locations: list[str] = Field(default_factory=list)
    remoteOk: bool = True
    minStipend: int | None = None
    domains: list[str] = Field(default_factory=list)


class Profile(BaseModel):
    skills: list[str] = Field(default_factory=list)
    experienceMonths: int = 0
    preferences: Preferences = Field(default_factory=Preferences)
    embedding: list[float] | None = None
    savedOpportunityIds: list[str] = Field(default_factory=list)


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    dim: int
    model: str
    degraded: bool


class ExtractRequest(BaseModel):
    texts: list[str]
    splitRequiredPreferred: bool = True


class ExtractedSkills(BaseModel):
    required: list[str]
    preferred: list[str]


class ExtractResponse(BaseModel):
    results: list[ExtractedSkills]
    taxonomySize: int


class ScoreComponents(BaseModel):
    skills: float
    semantic: float
    seniority: float
    location: float
    freshness: float


class ScoredItem(BaseModel):
    opportunityId: str
    score: int
    band: str
    reason: str
    components: ScoreComponents
    matched: list[str]
    missing: list[str]
    title: str | None = None
    company: str | None = None


class ScoreRequest(BaseModel):
    profile: Profile
    opportunityIds: list[str]


class RecommendRequest(BaseModel):
    profile: Profile
    limit: int = 20
    remoteOnly: bool = False
    locations: list[str] = Field(default_factory=list)
    minStipend: int | None = None
    skills: list[str] = Field(default_factory=list)
    excludeIds: list[str] = Field(default_factory=list)


class ScoreResponse(BaseModel):
    items: list[ScoredItem]
    scannedCandidates: int
    degraded: bool


class SkillGapEntry(BaseModel):
    skill: str
    label: str
    blocks: int
    examples: list[dict]


class SkillGapResponse(BaseModel):
    gaps: list[SkillGapEntry]
    consideredRoles: int


class Education(BaseModel):
    degree: str | None = None
    institution: str | None = None
    year: int | None = None
    cgpa: float | None = None


class ParseResponse(BaseModel):
    name: str | None
    email: str | None
    phone: str | None
    links: list[str]
    skills: list[str]
    education: list[Education]
    experienceMonths: int
    embedding: list[float]
    charCount: int
    degraded: bool


class HealthResponse(BaseModel):
    ok: bool
    modelLoaded: bool
    model: str
    dim: int
    degraded: bool
    taxonomySize: int
    indexedOpportunities: int
    indexAgeSeconds: float
    indexError: str | None = None
    parsedAt: datetime | None = None
