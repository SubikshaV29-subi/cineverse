CineVerse RecallAI additions
What is included
Updated `app.py`: broadens Smart Search candidate sources, caches candidate lists and embeddings, returns transparent keyword explanations, and adds feedback endpoints.
`test_queries.json`: starter labelled examples; manually verify/edit labels before reporting metrics.
`evaluate_search.py`: computes Precision@5, Recall@5 and nDCG@5 against your running Flask API.
`frontend_integration.js`: optional delegated feedback handler; adapt your existing result cards to include the required `data-*` attributes.
Install
Activate your existing venv, then run:
```bash
pip install -r requirements.txt
python app.py
```
Use your existing `.env` and TMDB API key. Do not share the `.env` file.
Evaluate
Keep Flask running in one terminal. In a second terminal from the project root:
```bash
python ml/evaluate_search.py
```
You may need to wait for the semantic model to load/download on first search. To use another local URL, set `CINEVERSE_URL`.
Feedback UI
The backend is ready, but your current `static/js/app.js` has not been included in this bundle because its exact result-rendering function was not supplied. To add buttons, place the provided `.recall-feedback` buttons inside each Smart Search result card and populate `data-query`, `data-id`, `data-kind`, `data-title`, and `data-feedback`. Load `ml/frontend_integration.js` via a script tag or copy its handler into your existing JS. Do not replace all of `app.js` with the example.
Notes
Match scores are relative similarity scores, not probabilities.
Feedback counts are not accuracy. Use a manually verified labelled test set for evaluation.
Candidate lists are cached in memory for 20 minutes. Restarting Flask clears that cache.
TMDB API availability and the semantic model download are required for full functionality.