const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 2000;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed." });
  }

  const { goal = "", difficulty = "Beginner" } = request.body || {};
  const normalizedGoal = String(goal).trim();
  const normalizedDifficulty = String(difficulty).trim() || "Beginner";

  if (!normalizedGoal) {
    return response.status(400).json({ error: "Goal is required." });
  }

  try {
    const roadmap = await generateLearningPath(normalizedGoal, normalizedDifficulty);
    return response.status(200).json(roadmap);
  } catch (error) {
    console.error("Generation API failed:", error);
    return response.status(200).json(buildFallbackRoadmap(normalizedGoal, normalizedDifficulty));
  }
}

async function generateLearningPath(goal, difficulty) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return buildFallbackRoadmap(goal, difficulty);
  }

  const prompt = `Create a 5-step roadmap for ${goal} at a ${difficulty} level.
Return ONLY a JSON array of 5 objects with "title" and "description".
IMPORTANT: Do NOT include the words "Step 1", "Step 2", etc. in the "title" field.
Example title: "Basics of Variables" instead of "Step 1: Basics of Variables".
Each step MUST be technically specific to ${goal}.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  let geminiResponse;

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    geminiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json"
        }
      })
    });

    if (geminiResponse.ok) {
      break;
    }

    if (geminiResponse.status === 429 && attempt === MAX_RETRY_ATTEMPTS) {
      return buildFallbackRoadmap(goal, difficulty);
    }

    if (geminiResponse.status >= 500 && attempt === MAX_RETRY_ATTEMPTS) {
      return buildFallbackRoadmap(goal, difficulty);
    }

    if (!geminiResponse.ok) {
  const errorText = await geminiResponse.text();
  console.error("Gemini status:", geminiResponse.status);
  console.error("Gemini response body:", errorText);

  if (geminiResponse.status === 429 && attempt === MAX_RETRY_ATTEMPTS) {
    return buildFallbackRoadmap(goal, difficulty);
  }

  if (geminiResponse.status >= 500 && attempt === MAX_RETRY_ATTEMPTS) {
    return buildFallbackRoadmap(goal, difficulty);
  }

  if (geminiResponse.status !== 429 && geminiResponse.status < 500) {
    throw new Error(`Gemini request failed with status ${geminiResponse.status}: ${errorText}`);
  }
}


    await wait(INITIAL_RETRY_DELAY_MS * (2 ** attempt));
  }

  const payload = await geminiResponse.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    return buildFallbackRoadmap(goal, difficulty);
  }

  try {
    const parsed = JSON.parse(text);
    const steps = Array.isArray(parsed) ? parsed : parsed?.steps;

    if (!Array.isArray(steps) || steps.length !== 5) {
      return buildFallbackRoadmap(goal, difficulty);
    }

    const normalizedSteps = steps.map((step, index) => ({
      title: step?.title || `Step ${index + 1}`,
      description: step?.description || "Description not provided."
    }));

    return {
      title: `${goal} Learning Roadmap`,
      description: `A focused 5-step roadmap to master ${goal} at a ${difficulty} level.`,
      source: "gemini",
      steps: normalizedSteps
    };
  } catch (error) {
    return buildFallbackRoadmap(goal, difficulty);
  }
}

function buildFallbackRoadmap(goal, difficulty) {
  const tone = difficulty === "Advanced"
    ? "with deeper system design, optimization, and production-style tradeoffs."
    : difficulty === "Intermediate"
      ? "with hands-on projects and steady skill-building."
      : "from fundamentals through confidence-building practice.";

  return {
    title: `${goal} Learning Roadmap`,
    description: `A practical 5-step backup roadmap for learning ${goal} ${tone}`,
    source: "fallback",
    steps: [
      {
        title: `Learn the fundamentals of ${goal}`,
        description: `Start with the core concepts, vocabulary, and tools needed to begin ${goal} successfully.`
      },
      {
        title: "Follow guided practice",
        description: "Use tutorials, exercises, and small drills to reinforce the basics with repetition."
      },
      {
        title: "Build a small project",
        description: `Apply what you learned in a focused mini project so ${goal} becomes practical instead of purely theoretical.`
      },
      {
        title: "Handle real-world scenarios",
        description: "Study debugging, best practices, edge cases, and more realistic workflows to grow confidence."
      },
      {
        title: "Create a polished capstone",
        description: "Finish with a stronger portfolio-ready project and review what to learn next."
      }
    ]
  };
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
