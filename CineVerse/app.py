import os
import sqlite3
import re
import time
from functools import wraps
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session, g
from werkzeug.security import generate_password_hash, check_password_hash
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Optional semantic search support.
# CineVerse still works with TF-IDF if this library is unavailable.
try:
    from sentence_transformers import SentenceTransformer
    SEMANTIC_SEARCH_AVAILABLE = True
except ImportError:
    SentenceTransformer = None
    SEMANTIC_SEARCH_AVAILABLE = False

# Load the model only when Smart Search first needs it.
_SEMANTIC_MODEL = None
_EMBEDDING_CACHE = {}
_CANDIDATE_CACHE = {"created": 0.0, "items": []}
CANDIDATE_CACHE_SECONDS = 20 * 60


def get_semantic_model():
    global _SEMANTIC_MODEL

    if not SEMANTIC_SEARCH_AVAILABLE:
        return None

    if _SEMANTIC_MODEL is None:
        _SEMANTIC_MODEL = SentenceTransformer(
            "all-MiniLM-L6-v2"
        )

    return _SEMANTIC_MODEL


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "cineverse.db"
TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE = "https://image.tmdb.org/t/p/"

app = Flask(__name__)
app.secret_key = os.getenv(
    "FLASK_SECRET_KEY", "change-this-development-secret"
)
app.config["JSON_SORT_KEYS"] = False
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "").strip()


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      preferences TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      poster_path TEXT,
      release_date TEXT,
      rating REAL,
      UNIQUE(user_id, media_id, media_type),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plot_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      query_text TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      feedback TEXT NOT NULL CHECK(feedback IN ('relevant','not_relevant','correct_title')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.commit()
    conn.close()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({
                "error": "Please sign in to use this feature."
            }), 401
        return fn(*args, **kwargs)
    return wrapper


def tmdb_get(path, params=None):
    if not TMDB_API_KEY:
        raise RuntimeError(
            "TMDB_API_KEY is missing. Add your TMDB API key to the .env file."
        )

    query = dict(params or {})
    query["api_key"] = TMDB_API_KEY

    response = requests.get(
        f"{TMDB_BASE}/{path.lstrip('/')}",
        params=query,
        timeout=12
    )

    if response.status_code == 401:
        raise RuntimeError(
            "TMDB rejected the API key. Check TMDB_API_KEY in .env."
        )

    response.raise_for_status()
    return response.json()


def normalize_item(item, media_type=None):
    kind = (
        media_type
        or item.get("media_type")
        or (
            "person"
            if "known_for_department" in item
            else "movie"
        )
    )

    title = item.get("title") or item.get("name") or "Untitled"
    date = item.get("release_date") or item.get("first_air_date") or ""

    return {
        "id": item.get("id"),
        "media_type": kind,
        "title": title,
        "overview": item.get("overview") or "",
        "poster": (
            f"{TMDB_IMAGE}w500{item['poster_path']}"
            if item.get("poster_path") else None
        ),
        "backdrop": (
            f"{TMDB_IMAGE}w1280{item['backdrop_path']}"
            if item.get("backdrop_path") else None
        ),
        "profile": (
            f"{TMDB_IMAGE}w342{item['profile_path']}"
            if item.get("profile_path") else None
        ),
        "release_date": date,
        "year": date[:4] if date else "—",
        "rating": item.get("vote_average"),
        "vote_count": item.get("vote_count"),
        "original_language": item.get("original_language"),
        "genre_ids": item.get("genre_ids") or [],
        "known_for_department": item.get("known_for_department"),
        "known_for": [
            normalize_item(x, x.get("media_type", "movie"))
            for x in (item.get("known_for") or [])[:3]
        ] if kind == "person" else []
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/config")
def config():
    return jsonify({
        "configured": bool(TMDB_API_KEY),
        "image_attribution": "Movie and TV data provided by TMDB."
    })


@app.get("/api/trending")
def trending():
    kind = request.args.get("type", "all")

    if kind not in ("all", "movie", "tv", "person"):
        kind = "all"

    try:
        data = tmdb_get(f"trending/{kind}/week", {"page": 1})
        items = [normalize_item(x) for x in data.get("results", [])]

        return jsonify({
            "results": items,
            "page": data.get("page", 1)
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.get("/api/hero-featured")
def hero_featured():
    """Return Spider-Man when available, otherwise a trending movie."""
    try:
        data = tmdb_get("search/movie", {
            "query": "Spider-Man",
            "include_adult": "false",
            "page": 1,
        })

        results = data.get("results", [])

        featured = next(
            (
                item for item in results
                if item.get("backdrop_path") and item.get("overview")
            ),
            None
        )

        if not featured:
            trending_data = tmdb_get(
                "trending/movie/week",
                {"page": 1}
            )

            featured = next(
                (
                    item for item in trending_data.get("results", [])
                    if item.get("backdrop_path") and item.get("overview")
                ),
                None
            )

        if not featured:
            return jsonify({
                "error": "No featured movie found."
            }), 404

        return jsonify(normalize_item(featured, "movie"))

    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.get("/api/discover")
def discover():
    kind = request.args.get("type", "movie")

    if kind not in ("movie", "tv"):
        return jsonify({
            "error": "Type must be movie or tv."
        }), 400

    params = {
        "page": request.args.get("page", "1"),
        "sort_by": "popularity.desc"
    }

    filter_keys = (
        "with_genres",
        "with_original_language",
        "primary_release_year",
        "first_air_date_year",
        "vote_average.gte"
    )

    for key in filter_keys:
        value = request.args.get(key)
        if value:
            params[key] = value

    region = request.args.get("region")
    if region and kind == "movie":
        params["region"] = region

    try:
        data = tmdb_get(f"discover/{kind}", params)

        return jsonify({
            "results": [
                normalize_item(x, kind)
                for x in data.get("results", [])
            ],
            "page": data.get("page"),
            "total_pages": data.get("total_pages")
        })

    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.get("/api/search")
def search():
    query = request.args.get("q", "").strip()
    kind = request.args.get("type", "multi")

    if not query:
        return jsonify({"results": []})

    if kind not in ("multi", "movie", "tv", "person"):
        kind = "multi"

    try:
        data = tmdb_get(f"search/{kind}", {
            "query": query,
            "include_adult": "false",
            "page": 1
        })

        results = [
            normalize_item(item)
            for item in data.get("results", [])
        ]

        return jsonify({
            "results": results,
            "total_results": data.get("total_results", 0)
        })

    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    
def _get_plot_candidates(force_refresh=False):
    """Get a broader candidate set and cache it briefly between searches."""
    now = time.time()
    if (
        not force_refresh
        and _CANDIDATE_CACHE["items"]
        and now - _CANDIDATE_CACHE["created"] < CANDIDATE_CACHE_SECONDS
    ):
        return [dict(item) for item in _CANDIDATE_CACHE["items"]]


    candidates, seen = [], set()

    # Popular/trending lists plus genre-specific discovery improve coverage
    # for less globally popular titles, including Tamil horror-comedies.
    sources = [
        ("trending/all/week", None, {}),
        ("movie/popular", "movie", {}),
        ("tv/popular", "tv", {}),
        ("discover/movie", "movie", {"with_genres": "27,35"}),
        ("discover/movie", "movie", {
            "with_genres": "27",
            "with_original_language": "ta"
        }),
        ("discover/tv", "tv", {"with_genres": "9648,10765"}),
    ]

    for path, kind, extra in sources:
        for page in (1, 2):
            try:
                payload = tmdb_get(path, {"page": page, **extra})
            except Exception as exc:
                app.logger.warning(
                    "Candidate source %s page %s failed: %s",
                    path, page, exc
                )
                continue

            for raw in payload.get("results", []):
                item = normalize_item(raw, kind)
                item_kind = item.get("media_type")
                item_id = item.get("id")
                overview = (item.get("overview") or "").strip()

                if (
                    item_kind not in ("movie", "tv")
                    or not item_id
                    or len(overview) < 20
                ):
                    continue

                key = (item_kind, item_id)

                if key in seen:
                    continue

                seen.add(key)
                item["_search_text"] = (
                    f"{item.get('title', '')}. {overview}"
                )
                candidates.append(item)

    _CANDIDATE_CACHE["created"] = now
    _CANDIDATE_CACHE["items"] = [
        dict(item) for item in candidates
    ]

    return candidates


def _explain_match(query, title, overview, limit=4):
    """Return transparent keyword evidence, not a fabricated explanation."""
    stop = {
        "about", "after", "again", "against", "also", "and", "are",
        "around", "because", "been", "before", "being", "between",
        "could", "different", "from", "have", "into", "just", "more",
        "must", "over", "same", "some", "than", "that", "their",
        "them", "then", "there", "these", "they", "this", "through",
        "under", "very", "were", "what", "when", "where", "which",
        "while", "with", "would", "your", "people", "movie", "story",
        "group"
    }

    q_terms = {
        term.lower()
        for term in re.findall(r"[A-Za-z]{3,}", query)
        if term.lower() not in stop
    }

    text = f"{title} {overview}".lower()

    hits = [
        term
        for term in sorted(q_terms, key=lambda x: (-len(x), x))
        if term in text
    ]

    return hits[:limit]


@app.get("/api/plot-search")
def plot_search():
    """Hybrid story search with semantic and lexical ranking."""
    query = request.args.get("q", "").strip()

    if len(query) < 4:
        return jsonify({
            "error": "Describe the plot in at least 4 characters."
        }), 400

    try:
        candidates = _get_plot_candidates(
            force_refresh=(
                request.args.get("refresh", "false").lower() == "true"
            )
        )

        if not candidates:
            return jsonify({
                "results": [],
                "method": "No candidates available",
                "note": (
                    "TMDB returned no usable plot descriptions. "
                    "Check your API key and connection."
                ),
                "candidate_count": 0,
                "matched_count": 0
            })

        documents = [
            item["_search_text"] for item in candidates
        ]

        vectorizer = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            max_features=20000,
            sublinear_tf=True
        )

        matrix = vectorizer.fit_transform(documents + [query])

        lexical_scores = cosine_similarity(
            matrix[-1],
            matrix[:-1]
        ).ravel()

        semantic_scores = None

        try:
            model = get_semantic_model()

            if model is not None:
                query_embedding = model.encode(
                    [query],
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                    show_progress_bar=False
                )[0]

                doc_vectors = []
                missing_items = []

                for item in candidates:
                    cache_key = (
                        f"{item['media_type']}:{item['id']}:"
                        f"{hash(item['_search_text'])}"
                    )

                    if cache_key in _EMBEDDING_CACHE:
                        doc_vectors.append(
                            _EMBEDDING_CACHE[cache_key]
                        )
                    else:
                        doc_vectors.append(None)
                        missing_items.append((
                            len(doc_vectors) - 1,
                            cache_key,
                            item["_search_text"]
                        ))

                if missing_items:
                    encoded = model.encode(
                        [
                            entry[2]
                            for entry in missing_items
                        ],
                        normalize_embeddings=True,
                        convert_to_numpy=True,
                        show_progress_bar=False,
                        batch_size=32
                    )

                    for (idx, cache_key, _), vector in zip(
                        missing_items, encoded
                    ):
                        _EMBEDDING_CACHE[cache_key] = vector
                        doc_vectors[idx] = vector

                import numpy as np

                semantic_scores = np.dot(
                    np.vstack(doc_vectors),
                    query_embedding
                ).clip(0.0, 1.0)

        except Exception as exc:
            app.logger.warning(
                "Semantic model unavailable; using TF-IDF: %s",
                exc
            )

        if semantic_scores is not None:
            combined_scores = (
                0.70 * semantic_scores
                + 0.30 * lexical_scores
            )

            method = "Hybrid semantic embeddings + TF-IDF"

            note = (
                "Ranked by plot meaning and keyword overlap. "
                "Match scores are relative similarity scores, "
                "not probabilities or verified accuracy."
            )
        else:
            combined_scores = lexical_scores
            method = "TF-IDF + cosine similarity (fallback)"

            note = (
                "Semantic embeddings were unavailable, so keyword "
                "similarity was used. Scores are relative similarity "
                "scores, not probabilities."
            )

        ranked = []

        for item, score in zip(candidates, combined_scores):
            score = float(score)

            result = {
                key: value
                for key, value in item.items()
                if not key.startswith("_")
            }

            result["match_score"] = round(
                max(0.0, score) * 100,
                1
            )

            terms = _explain_match(
                query,
                result.get("title", ""),
                result.get("overview", "")
            )

            result["match_reasons"] = terms

            result["explanation"] = (
                "Shared plot terms: " + ", ".join(terms)
                if terms
                else (
                    "This result was ranked by overall text similarity; "
                    "no strong shared keywords were detected."
                )
            )

            ranked.append(result)

        ranked.sort(
            key=lambda item: item["match_score"],
            reverse=True
        )

        # Return top results even when scores are low; a hard threshold
        # can hide the correct title. The UI can label low scores as
        # tentative matches.
        return jsonify({
            "results": ranked[:12],
            "method": method,
            "note": note,
            "candidate_count": len(candidates),
            "matched_count": len(ranked),
            "cache_seconds": CANDIDATE_CACHE_SECONDS
        })

    except Exception:
        app.logger.exception("Smart plot search failed")

        return jsonify({
            "error": (
                "Smart Search could not complete. "
                "Check the Flask terminal for details."
            )
        }), 502


@app.post("/api/plot-feedback")
def plot_feedback():
    """Store explicit relevance feedback for future analysis."""
    data = request.get_json(silent=True) or {}

    query = str(data.get("query", "")).strip()
    title = str(data.get("title", "")).strip()
    feedback = str(data.get("feedback", "")).strip().lower()
    media_type = str(
        data.get("media_type", "movie")
    ).strip().lower()

    try:
        media_id = int(data.get("media_id"))
    except (TypeError, ValueError):
        return jsonify({
            "error": "media_id must be an integer."
        }), 400

    if len(query) < 4 or not title:
        return jsonify({
            "error": "query and title are required."
        }), 400

    if feedback not in {
        "relevant",
        "not_relevant",
        "correct_title"
    }:
        return jsonify({
            "error": (
                "feedback must be relevant, not_relevant, "
                "or correct_title."
            )
        }), 400

    if media_type not in {"movie", "tv"}:
        return jsonify({
            "error": "media_type must be movie or tv."
        }), 400

    db().execute(
        """
        INSERT INTO plot_feedback(
            user_id, query_text, media_id, media_type, title, feedback
        )
        VALUES(?,?,?,?,?,?)
        """,
        (
            session.get("user_id"),
            query,
            media_id,
            media_type,
            title,
            feedback
        )
    )

    db().commit()

    return jsonify({
        "ok": True,
        "message": "Feedback saved for evaluation."
    })


@app.get("/api/plot-feedback/stats")
def plot_feedback_stats():
    rows = db().execute(
        """
        SELECT feedback, COUNT(*) AS count
        FROM plot_feedback
        GROUP BY feedback
        """
    ).fetchall()

    totals = {
        row["feedback"]: row["count"]
        for row in rows
    }

    total = sum(totals.values())

    return jsonify({
        "total_feedback": total,
        "counts": totals,
        "note": (
            "Feedback counts are not model accuracy. Use a labelled "
            "test set to calculate ranking metrics."
        )
    })
@app.get("/api/detail/<kind>/<int:item_id>")
def detail(kind, item_id):
    if kind not in ("movie", "tv", "person"):
        return jsonify({
            "error": "Unsupported detail type."
        }), 400

    try:
        if kind == "person":
            raw = tmdb_get(
                f"person/{item_id}",
                {"append_to_response": "combined_credits"}
            )

            result = normalize_item(raw, "person")
            result["biography"] = raw.get("biography", "")
            result["known_for_department"] = raw.get(
                "known_for_department"
            )

            result["filmography"] = [
                normalize_item(x, x.get("media_type", "movie"))
                for x in (
                    raw.get("combined_credits", {}).get("cast") or []
                )[:30]
            ]

        else:
            raw = tmdb_get(
                f"{kind}/{item_id}",
                {"append_to_response": "credits,recommendations"}
            )

            result = normalize_item(raw, kind)

            result["genres"] = [
                genre["name"]
                for genre in raw.get("genres", [])
            ]

            result["status"] = raw.get("status")

            result["runtime"] = (
                raw.get("runtime")
                or (raw.get("episode_run_time") or [None])[0]
            )

            result["tagline"] = raw.get("tagline", "")

            result["cast"] = [
                {
                    "id": person.get("id"),
                    "name": person.get("name"),
                    "character": person.get("character"),
                    "profile": (
                        f"{TMDB_IMAGE}w185{person['profile_path']}"
                        if person.get("profile_path")
                        else None
                    )
                }
                for person in (
                    raw.get("credits", {}).get("cast") or []
                )[:12]
            ]

            result["recommendations"] = [
                normalize_item(item, kind)
                for item in (
                    raw.get("recommendations", {}).get("results") or []
                )[:8]
            ]

        return jsonify(result)

    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


# --------------------------------------------------
# REGISTER
# --------------------------------------------------

@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}

    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if len(username) < 2 or "@" not in email or len(password) < 8:
        return jsonify({
            "error": (
                "Enter a username, valid email, and password "
                "with at least 8 characters."
            )
        }), 400

    try:
        cursor = db().execute(
            """
            INSERT INTO users(username, email, password_hash)
            VALUES(?,?,?)
            """,
            (
                username,
                email,
                generate_password_hash(password)
            )
        )

        db().commit()

        session["user_id"] = cursor.lastrowid
        session["username"] = username

        return jsonify({"username": username})

    except sqlite3.IntegrityError:
        return jsonify({
            "error": "That username or email is already registered."
        }), 409


# --------------------------------------------------
# LOGIN
# --------------------------------------------------

@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}

    identifier = str(
        data.get("identifier", "")
    ).strip().lower()

    password = str(data.get("password", ""))

    user = db().execute(
        """
        SELECT * FROM users
        WHERE lower(email)=? OR lower(username)=?
        """,
        (identifier, identifier)
    ).fetchone()

    if not user or not check_password_hash(
        user["password_hash"], password
    ):
        return jsonify({
            "error": "Incorrect username/email or password."
        }), 401

    session["user_id"] = user["id"]
    session["username"] = user["username"]

    return jsonify({"username": user["username"]})


# --------------------------------------------------
# LOGOUT
# --------------------------------------------------

@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


# --------------------------------------------------
# CURRENT USER
# --------------------------------------------------

@app.get("/api/me")
def me():
    if not session.get("user_id"):
        return jsonify({"signed_in": False})

    user = db().execute(
        "SELECT username, preferences FROM users WHERE id=?",
        (session["user_id"],)
    ).fetchone()

    if not user:
        session.clear()
        return jsonify({"signed_in": False})

    import json

    return jsonify({
        "signed_in": True,
        "username": user["username"],
        "preferences": json.loads(
            user["preferences"] or "{}"
        )
    })


# --------------------------------------------------
# USER PREFERENCES
# --------------------------------------------------

@app.put("/api/preferences")
@login_required
def save_preferences():
    import json

    preferences = request.get_json(silent=True) or {}

    db().execute(
        "UPDATE users SET preferences=? WHERE id=?",
        (
            json.dumps(preferences),
            session["user_id"]
        )
    )

    db().commit()

    return jsonify({"ok": True})


# --------------------------------------------------
# GET WATCHLIST
# --------------------------------------------------

@app.get("/api/watchlist")
@login_required
def get_watchlist():
    rows = db().execute(
        """
        SELECT media_id AS id, media_type, title, poster_path,
               release_date, rating
        FROM watchlist
        WHERE user_id=?
        ORDER BY id DESC
        """,
        (session["user_id"],)
    ).fetchall()

    return jsonify({
        "results": [
            {
                "id": row["id"],
                "media_type": row["media_type"],
                "title": row["title"],
                "poster": (
                    f"{TMDB_IMAGE}w500{row['poster_path']}"
                    if row["poster_path"]
                    else None
                ),
                "release_date": row["release_date"],
                "year": (
                    (row["release_date"] or "")[:4] or "—"
                ),
                "rating": row["rating"]
            }
            for row in rows
        ]
    })


# --------------------------------------------------
# ADD TO WATCHLIST
# --------------------------------------------------

@app.post("/api/watchlist")
@login_required
def add_watchlist():
    item = request.get_json(silent=True) or {}

    try:
        db().execute(
            """
            INSERT OR IGNORE INTO watchlist(
                user_id, media_id, media_type, title,
                poster_path, release_date, rating
            )
            VALUES(?,?,?,?,?,?,?)
            """,
            (
                session["user_id"],
                int(item["id"]),
                item["media_type"],
                item["title"],
                item.get("poster_path"),
                item.get("release_date"),
                item.get("rating")
            )
        )

        db().commit()

        return jsonify({"ok": True})

    except (KeyError, TypeError, ValueError):
        return jsonify({
            "error": "Invalid watchlist item."
        }), 400


# --------------------------------------------------
# REMOVE FROM WATCHLIST
# --------------------------------------------------

@app.delete("/api/watchlist/<kind>/<int:item_id>")
@login_required
def remove_watchlist(kind, item_id):
    db().execute(
        """
        DELETE FROM watchlist
        WHERE user_id=? AND media_id=? AND media_type=?
        """,
        (session["user_id"], item_id, kind)
    )

    db().commit()

    return jsonify({"ok": True})


# --------------------------------------------------
# ERROR HANDLING
# --------------------------------------------------

@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found."}), 404

    return render_template("index.html"), 404


# Create database tables when the application starts.
init_db()


if __name__ == "__main__":
    app.run(
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        port=int(os.getenv("PORT", "5000"))
    )