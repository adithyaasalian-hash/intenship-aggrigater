# InternshipMatch

An internship aggregator that does the second half: every listing carries a fit
score out of 100 and a plain sentence explaining it.

> *7 of 9 required skills · missing Docker, GraphQL · posted 3 days ago*

Aggregating listings is table stakes — several teams will build a job board.
What is hard, useful, and demoable in a week is turning a pile of listings into
a ranked, explained shortlist for one specific student, and then telling them
which missing skill unlocks the most roles.

---

## Run it

```bash
cp .env.example .env
docker compose up --build
```

That is the whole setup. No signups, no API keys, no cloud accounts.

| | |
|---|---|
| Web | http://localhost:5173 |
| API | http://localhost:4000/api/health |
| ML  | http://localhost:8000/health |

The first build takes 3–6 minutes, almost all of it downloading the embedding
model into the `ml` image. After that `docker compose up` is seconds. On boot
the API notices an empty database and ingests immediately — you should have a
few hundred listings within a minute.

Then: register → drop a résumé PDF → your feed is ranked and explained.

```bash
make ingest    # pull from every enabled source now
make seed      # load only the 40 committed listings
make test      # run the ML unit tests
make health    # check both services
make clean     # stop everything and wipe the database
```

---

## How it works

Two pipelines produce the same kind of object — a 384-dimension vector plus a
list of canonical skill names — and they meet in the scorer. That convergence
is what lets every card carry both a number and a reason.

```
 job sources ──▶ ingest worker ──▶ opportunities ──┐
 (6 adapters)     normalise           +embedding   │
                  fingerprint                      ├──▶ scorer ──▶ ranked feed
                                                   │    FastAPI
 résumé PDF ───▶ ML /parse ──────▶ profile ────────┘
                  pdfplumber        +skills[]
                  + matcher         +embedding
```

### Services

| Service | Stack | Owns |
|---|---|---|
| `web` | React 18, Vite, Tailwind, TanStack Query | All UI |
| `api` | Node 20, Express 4, Mongoose | Auth, CRUD, ingestion, the only thing the browser talks to |
| `ml` | Python 3.11, FastAPI, fastembed | Parsing, embeddings, scoring, recommendations |
| `mongo` | MongoDB 7 | Everything persistent |

The split exists because the ML libraries are Python, not for architectural
fashion. `ml` reads MongoDB directly (read-only); `api` owns every write.

### The score

```
fit = 100 × ( 0.45·skill_coverage
            + 0.25·semantic
            + 0.12·seniority
            + 0.10·location
            + 0.08·freshness )
```

- **skill_coverage** — weighted overlap; a required skill counts 1.0, a
  preferred one 0.4.
- **semantic** — cosine between the résumé and the job description, both
  embedded with `all-MiniLM-L6-v2`. This is what catches a résumé saying "built
  a recommendation system" against a posting asking for "collaborative
  filtering experience", where no keyword matches.
- **seniority / location / freshness** — tie-breakers among roles you are
  already qualified for.

Weights live in `.env` (`W_SKILLS`, `W_SEMANTIC`, …) and are normalised at
load, so they need not sum to 1 by hand.

**Be ready to defend them**, because a good judge will ask. They are a
considered prior, not a fitted result: skills dominate because that is what a
human screener filters on first. Saying so is stronger than implying the
numbers were learned. If you want to go further, collect thumbs up/down on feed
cards during demo day and show how logistic regression would shift them.

### Two decisions worth explaining

**Skill extraction is a dictionary, not a model.** `ml/app/data/skills.yaml`
holds ~130 skills with ~380 aliases, matched by a longest-first token scan. No
training, no labelled data, and — the actual reason — when a judge asks "why
82%?" you can point at the exact matched tokens. A neural extractor cannot do
that, which makes it the wrong tool here even where it would score slightly
better. **This file is the highest-leverage thing in the repo**: two hours
adding the skills that appear in *your* listings beats any amount of tuning.

**Embeddings run on ONNX, not PyTorch.** `fastembed` runs the same
all-MiniLM-L6-v2 weights in ~150 MB of disk and ~120 MB of RAM;
`sentence-transformers` needs ~1.2 GB and ~700 MB. Render's free tier gives you
512 MB, so the PyTorch version OOMs on deploy and this one does not. The output
vectors are identical.

---

## Where things are

```
api/src/
  ingest/           source adapters, normalisation, fingerprint dedup
  models/index.js   all four collections in one file
  routes/feed.js    GET /api/feed — the demo endpoint
  services/         ML client (times out, fails soft) + profile shaping
ml/app/
  skills.py         taxonomy matcher
  scoring.py        the five components + the reason string
  resume.py         PDF → structured profile
  store.py          in-memory vector index over MongoDB
web/src/
  components/Fit.jsx   FitBadge + FitBreakdown — the component that matters
  pages/Onboarding.jsx the magic moment: drop a PDF, see your skills
  pages/Feed.jsx       the money screen
```

### The response shape everything hangs off

Agree this on day one and all four tracks can work in parallel against mock
data. It is worth more than any library choice.

```jsonc
// GET /api/feed
{
  "items": [{
    "opportunity": { "id": "…", "title": "ML Engineering Intern",
                     "company": "Zerodha", "location": { "city": "bengaluru" },
                     "stipend": { "min": 40000, "max": 55000 } },
    "fit": {
      "score": 82,
      "band": "strong",
      "reason": "7 of 9 required skills · missing Docker, GraphQL",
      "components": { "skills": 0.78, "semantic": 0.71, "seniority": 1.0,
                      "location": 0.9, "freshness": 0.87 },
      "matched": ["python", "pytorch", "sql", "…"],
      "missing": ["docker", "graphql"]
    }
  }],
  "nextCursor": 20,
  "meta": { "cached": true, "degraded": false, "total": 118 }
}
```

No raw vectors, no model names, no floats the UI has to reformat.

---

## Data sources

Keyless ones are on by default and need nothing from you.

| Source | Auth | Notes |
|---|---|---|
| `seed.csv` | — | 40 curated listings, committed to the repo |
| RemoteOK | none | Remote tech. Index 0 of its response is a legal notice, not a job |
| Remotive | none | Remote, tech-heavy |
| Arbeitnow | none | Europe-leaning, has a visa-sponsorship flag |
| Adzuna | key | India via `ADZUNA_COUNTRY=in`; ~1,000 calls/month free |
| Greenhouse | none | Per company. `GREENHOUSE_BOARDS=stripe,figma` |
| Lever | none | Per company. `LEVER_BOARDS=netflix,shopify` |

Adding a source is one file in `api/src/ingest/sources/` plus one line in the
`SOURCES` array. Adapters are pure functions — fetch, map, return; they never
touch the database.

**Expand `seed.csv` as you go.** It is the reason your demo works when a source
rate-limits you at 10 a.m. on judging day. 300 rows is the target.

Dedup is `sha1(title | company | first-word-of-city)`, unique-indexed, so
re-running ingestion every six hours is idempotent.

---

## Deploying

| Service | Where | The thing that will bite you |
|---|---|---|
| web | Vercel | `VITE_API_URL` is read at **build** time, not runtime |
| api | Render | CORS `credentials: true` **and** cookie `SameSite=None; Secure` |
| ml | Render / HF Spaces | Model must be baked into the image, not fetched at boot |
| mongo | Atlas M0 | Allow-list `0.0.0.0/0` for the hackathon, and say so in your report |

Set `JWT_SECRET` and `ADMIN_KEY` to real values. `NODE_ENV=production` is what
flips the cookie to `SameSite=None; Secure`, which you need once web and api
are on different domains — and which breaks local development if you set it
too early.

---

## Known limitations

Say these out loud before a judge finds them. Volunteering a limitation buys
more credibility than any feature.

- **Collaborative filtering is not implemented.** The retrieval query vector
  does fold in saved listings (`0.7 · résumé + 0.3 · saved`), but with a dozen
  demo users the co-save matrix would be far too sparse to mean anything. The
  hook is in `ml/app/main.py:_query_vector`.
- **No OCR.** A scanned résumé returns a 422 and the UI offers a manual skill
  form. Five-minute fallback versus a five-hour rabbit hole; roughly one résumé
  in fifty needs it.
- **Stipend parsing is best-effort** and returns `null` rather than guessing. A
  wrong number on a card is worse than no number, because a student decides on it.
- **Retrieval is a NumPy matrix multiply**, not a vector database. At 10,000
  listings that is ~15 MB of RAM and ~4 ms. Swap `store.py:candidates()` for an
  Atlas `$vectorSearch` stage when you outgrow it; nothing else changes.
- **Skill extraction misses anything not in the taxonomy.** That is a feature
  (explainability) with a cost (recall). Grow the YAML.

---

## Troubleshooting

**Feed shows "Showing newest first"** — the ML container is not answering.
`docker compose logs ml`. On a free tier it may just be waking up; the frontend
pings `/health` on load to warm it.

**Scores look flat / everything is 60-ish** — check `GET /health` on the ML
service for `"degraded": true`. That means `fastembed` could not load its model
and it fell back to hashed bag-of-words. Rebuild `ml` with network access.

**Signed in, then immediately signed out** — the auth cookie is not coming
back. In development check the Vite proxy is running (`vite.config.js`); in
production check CORS `credentials` and `SameSite=None; Secure` together.

**Zero listings after boot** — `docker compose exec api npm run ingest:seed`.
If that works, a live source is blocked from your network; if it does not,
check `docker compose logs api` for the Mongo connection.

**`make test` fails on a fresh clone** — run it inside the container
(`docker compose exec ml python tests/test_core.py`); it needs numpy and pyyaml.

---

## Tests

```bash
cd ml && python -m pytest tests -q      # or: python tests/test_core.py
```

40 checks over the parts that carry the product: tokenisation edge cases
(`C++`, `C#`, `CI/CD`, `Node.js`), required-vs-preferred skill splitting, every
scoring component, résumé field extraction, and the invariant that matters
most — **the score and the reason string can never disagree**, because they are
produced by the same function.
