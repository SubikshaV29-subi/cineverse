# CineVerse — Real-time Entertainment Discovery + ML Plot Search

CineVerse is a Python/Flask web application with a responsive dark-themed interface. It uses **live TMDB API data** for movies, TV series, trending titles, people, posters, cast, ratings, and recommendations. It also includes a working **TF-IDF + cosine-similarity plot search** feature.

> Important: the source material supplied for this build was a project improvement prompt, not the existing source code. This ZIP is a structured implementation based on that prompt; it does not preserve unknown code from an existing application.

## Features

- Live title search against TMDB (movies, TV shows, people, or all)
- Trending titles and popular movies / TV shows / people
- Detail pages with overview, original language, release year, available rating, genres, cast, and recommendations
- Filters for genre, original language, year, and minimum rating
- ML plot search: TF-IDF vectorization and cosine similarity rank real descriptions fetched from TMDB
- Account registration and sign-in using hashed passwords
- SQLite-backed watchlist and saved user preferences
- Responsive dark UI, keyboard focus states, loading/error/empty states, and poster fallback
- API keys stay on the Python backend in `.env`; the frontend never receives the TMDB key

## Requirements

- Python 3.10 or later (Python 3.11 is a good choice)
- Internet connection
- TMDB API key

## Setup on Windows

1. Extract the ZIP.
2. Open the extracted `CineVerse` folder in VS Code.
3. Open a terminal in that folder.
4. Create a virtual environment:

   ```powershell
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

   If PowerShell blocks activation, use Command Prompt and run:

   ```bat
   .venv\Scripts\activate.bat
   ```

5. Install dependencies:

   ```powershell
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

6. Copy `.env.example` to `.env`. On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

7. Get a TMDB API key from https://www.themoviedb.org/settings/api and put it in `.env`:

   ```env
   TMDB_API_KEY=your_actual_key_here
   FLASK_SECRET_KEY=put_a_long_random_secret_here
   FLASK_DEBUG=false
   PORT=5000
   ```

   Do not include quote marks around the key. Do not upload `.env` to GitHub.

8. Start the app:

   ```powershell
   python app.py
   ```

9. Open http://127.0.0.1:5000 in your browser.

The SQLite database `cineverse.db` is created automatically on first launch.

## How the ML feature works

1. The user describes a story or plot in natural language.
2. The backend fetches a set of current trending and popular movie/TV descriptions from TMDB.
3. `TfidfVectorizer` converts each description and the user query into weighted text vectors.
4. Cosine similarity scores how close the query is to each description.
5. The app returns the highest-scoring candidates with a similarity percentage.

**ML limitation:** this is a lightweight text-similarity model, not a pretrained language model. It can miss matches when the user's description uses very different wording, and it only compares against the fetched candidate set. For a stronger future version, index a larger licensed metadata dataset and consider sentence-transformer embeddings.

## API routes

| Route | Purpose |
|---|---|
| `GET /api/config` | Check whether TMDB is configured |
| `GET /api/trending?type=all` | Trending content |
| `GET /api/discover?type=movie` | Popular movies; accepts genre/language/year/rating filters |
| `GET /api/search?q=...&type=multi` | Live TMDB search |
| `GET /api/plot-search?q=...` | ML similarity search |
| `GET /api/detail/<movie\|tv\|person>/<id>` | Real metadata and detail |
| `POST /api/auth/register` | Create an account |
| `POST /api/auth/login` | Sign in |
| `POST /api/auth/logout` | Sign out |
| `GET /api/me` | Current account and preferences |
| `PUT /api/preferences` | Save account preferences |
| `GET/POST /api/watchlist` | Read or add watchlist items |
| `DELETE /api/watchlist/<kind>/<id>` | Remove a watchlist item |

## Notes and honest limitations

- A TMDB API key is required. Without it, the app will show an actionable API configuration error instead of inventing titles.
- TMDB provides movie, TV, and people metadata. **Music and music-video discovery are not implemented** because this project does not yet connect to a separate music metadata provider.
- Streaming availability is not claimed. No provider availability integration is configured.
- Country and original-language filters are supported through TMDB discover metadata. Nationality is not inferred for people.
- Preference settings are saved to the account. This starter build saves them but does not yet use every preference as a full ranking signal on the home page.
- Account authentication is suitable as a learning/demo baseline, not a production security audit. Before deployment, add HTTPS, CSRF protection, rate limiting, email verification, secure cookie settings, password reset, and stronger operational logging.
- TMDB attribution: this product uses the TMDB API but is not endorsed or certified by TMDB. Review TMDB's current API terms and attribution requirements before public release.
- The home hero uses an original CSS gradient rather than unlicensed movie footage.

## Troubleshooting

- **TMDB key missing:** confirm `.env` is in the same folder as `app.py`, and the variable is named exactly `TMDB_API_KEY`.
- **401 from TMDB:** check that the API key is active and correctly copied.
- **Port already in use:** set `PORT=5001` in `.env`, restart, and open `http://127.0.0.1:5001`.
- **Packages not found:** activate `.venv` and run `pip install -r requirements.txt`.
- **Search results empty:** try another spelling or switch the search type to Everything.
