/*
CineVerse RecallAI frontend integration example.
Adapt the call to your existing Smart Search result renderer rather than replacing app.js.
After each result card is rendered, add a button with:
<button class="recall-feedback" data-feedback="relevant"
 data-query="..." data-id="123" data-kind="movie" data-title="...">Relevant</button>
and another with data-feedback="not_relevant".
For the exact correct title use data-feedback="correct_title".
Load this file after your current app.js.
*/
document.addEventListener("click", async (event) => {
  const button = event.target.closest(".recall-feedback");
  if (!button) return;
  const payload = {
    query: button.dataset.query || "",
    media_id: Number(button.dataset.id),
    media_type: button.dataset.kind || "movie",
    title: button.dataset.title || "",
    feedback: button.dataset.feedback || "relevant"
  };
  if (!payload.query || !payload.media_id || !payload.title) {
    console.warn("RecallAI feedback button is missing data attributes.");
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch("/api/plot-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save feedback");
    button.textContent = "Feedback saved";
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = "Try again";
  }
});
