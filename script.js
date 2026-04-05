import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const APP_CONFIG = {
  serverlessApiUrl: "YOUR_SERVERLESS_ENDPOINT_URL",
  openAIModel: "gpt-4o-mini",
  geminiModel: "gemini-1.5-flash",
  pdfFolder: "learning-path-pdfs"
};

const firebaseReady = !Object.values(firebaseConfig).some((value) => value.startsWith("YOUR_"));
const serverlessReady =
  APP_CONFIG.serverlessApiUrl &&
  !APP_CONFIG.serverlessApiUrl.includes("YOUR_SERVERLESS");

const app = firebaseReady ? initializeApp(firebaseConfig) : null;
const db = firebaseReady ? getFirestore(app) : null;
const storage = firebaseReady ? getStorage(app) : null;

const userId = getOrCreateUserId();
let currentPath = null;
let lastSavedDocId = null;

const form = document.getElementById("pathForm");
const goalInput = document.getElementById("goalInput");
const difficultyInput = document.getElementById("difficultyInput");
const generateBtn = document.getElementById("generateBtn");
const exportBtn = document.getElementById("exportBtn");
const roadmapCard = document.getElementById("roadmapCard");
const jsonOutput = document.getElementById("jsonOutput");
const statusMessage = document.getElementById("statusMessage");
const lastGeneratedAt = document.getElementById("lastGeneratedAt");
const communityFeed = document.getElementById("communityFeed");
const communityCount = document.getElementById("communityCount");
const userIdBadge = document.getElementById("userIdBadge");
const storageStatus = document.getElementById("storageStatus");

userIdBadge.textContent = userId;

form.addEventListener("submit", handleGeneratePath);
exportBtn.addEventListener("click", exportCurrentPathAsPdf);

if (firebaseReady) {
  subscribeToCommunityPaths();
} else {
  communityFeed.innerHTML = `
    <div class="community-empty">
      Add your Firebase config in <code>script.js</code> to enable Firestore and realtime community updates.
    </div>
  `;
  communityCount.textContent = "Firebase not configured";
  storageStatus.textContent = "Awaiting Firebase setup";
}

async function handleGeneratePath(event) {
  event.preventDefault();

  const goal = goalInput.value.trim();
  const difficulty = difficultyInput.value;

  if (!goal) {
    setStatus("Please enter a learning goal first.", "error");
    return;
  }

  toggleGenerationState(true);
  setStatus("Generating a 5-step roadmap through the serverless AI function...", "loading");

  try {
    const generatedPath = await requestLearningPath({ goal, difficulty, userId });
    currentPath = normalizePath(generatedPath, goal, difficulty);
    renderRoadmap(currentPath);

    if (firebaseReady) {
      const docRef = await addDoc(collection(db, "learningPaths"), {
        userId,
        goal: currentPath.goal,
        difficulty: currentPath.difficulty,
        createdAt: serverTimestamp(),
        steps: currentPath.steps,
        provider: currentPath.provider,
        metadata: currentPath.metadata
      });

      lastSavedDocId = docRef.id;
      exportBtn.disabled = false;
    } else {
      lastSavedDocId = null;
      exportBtn.disabled = true;
    }

    const generatedAt = new Date();
    lastGeneratedAt.textContent = `Generated ${generatedAt.toLocaleString()}`;
    setStatus(
      firebaseReady
        ? "Roadmap generated and saved to Firestore successfully."
        : "Roadmap generated in demo mode. Add Firebase config to save and sync it.",
      "success"
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed to generate the learning path.", "error");
  } finally {
    toggleGenerationState(false);
  }
}

async function requestLearningPath(payload) {
  const prompt = {
    instruction:
      "Create a personalized learning roadmap as valid JSON only. Return exactly 5 ordered steps. Each step must include title, description, duration, and outcome.",
    schema: {
      goal: "string",
      difficulty: "string",
      steps: [
        {
          step: 1,
          title: "string",
          description: "string",
          duration: "string",
          outcome: "string"
        }
      ]
    },
    input: payload
  };

  if (!serverlessReady) {
    return buildDemoRoadmap(payload);
  }

  const response = await fetch(APP_CONFIG.serverlessApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...payload,
      provider: "openai-or-gemini",
      openAIModel: APP_CONFIG.openAIModel,
      geminiModel: APP_CONFIG.geminiModel,
      prompt
    })
  });

  if (!response.ok) {
    throw new Error(`Serverless function failed with status ${response.status}.`);
  }

  const data = await response.json();
  return data.path || data;
}

function normalizePath(data, goal, difficulty) {
  const steps = Array.isArray(data.steps) ? data.steps.slice(0, 5) : [];

  if (steps.length !== 5) {
    throw new Error("The AI response did not contain exactly 5 steps.");
  }

  return {
    goal: data.goal || goal,
    difficulty: data.difficulty || difficulty,
    provider: data.provider || "serverless-demo",
    metadata: data.metadata || {
      model: data.model || APP_CONFIG.openAIModel,
      source: "cloud-function"
    },
    steps: steps.map((step, index) => ({
      step: index + 1,
      title: step.title || `Step ${index + 1}`,
      description: step.description || "Description not provided.",
      duration: step.duration || "1 week",
      outcome: step.outcome || "Solid conceptual progress."
    }))
  };
}

function renderRoadmap(path) {
  roadmapCard.classList.remove("empty");
  roadmapCard.innerHTML = `
    <div class="roadmap-list">
      ${path.steps.map((step) => `
        <article class="roadmap-step">
          <div class="step-index">${step.step}</div>
          <div>
            <h3>${escapeHtml(step.title)}</h3>
            <p>${escapeHtml(step.description)}</p>
            <p><strong>Duration:</strong> ${escapeHtml(step.duration)}</p>
            <p><strong>Outcome:</strong> ${escapeHtml(step.outcome)}</p>
          </div>
        </article>
      `).join("")}
    </div>
  `;

  jsonOutput.textContent = JSON.stringify(path, null, 2);
}

async function exportCurrentPathAsPdf() {
  if (!currentPath) {
    setStatus("Generate a learning path before exporting.", "error");
    return;
  }

  if (!firebaseReady) {
    setStatus("Add Firebase Storage config before exporting PDFs to the cloud.", "error");
    return;
  }

  exportBtn.disabled = true;
  storageStatus.textContent = "Generating PDF...";
  setStatus("Creating the PDF and uploading it to Firebase Storage...", "loading");

  try {
    const pdfBlob = buildPdfBlob(currentPath);
    const fileName = `${sanitizeForFileName(currentPath.goal)}-${Date.now()}.pdf`;
    const storageRef = ref(storage, `${APP_CONFIG.pdfFolder}/${userId}/${fileName}`);

    await uploadBytes(storageRef, pdfBlob, {
      contentType: "application/pdf"
    });

    const downloadUrl = await getDownloadURL(storageRef);

    if (lastSavedDocId) {
      await updateDoc(doc(db, "learningPaths", lastSavedDocId), {
        pdfUrl: downloadUrl,
        pdfFileName: fileName,
        exportedAt: serverTimestamp()
      });
    }

    storageStatus.textContent = "PDF uploaded to cloud storage";
    setStatus("PDF exported and saved to Firebase Storage successfully.", "success");
    window.open(downloadUrl, "_blank", "noopener");
  } catch (error) {
    console.error(error);
    storageStatus.textContent = "Export failed";
    setStatus(error.message || "Failed to export the PDF.", "error");
  } finally {
    exportBtn.disabled = false;
  }
}

function buildPdfBlob(path) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let y = 20;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text("PathFinder AI Learning Path", 14, y);

  y += 10;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.text(`Goal: ${path.goal}`, 14, y);
  y += 8;
  pdf.text(`Difficulty: ${path.difficulty}`, 14, y);
  y += 8;
  pdf.text(`User ID: ${userId}`, 14, y);
  y += 12;

  path.steps.forEach((step) => {
    if (y > 250) {
      pdf.addPage();
      y = 20;
    }

    pdf.setFont("helvetica", "bold");
    pdf.text(`${step.step}. ${step.title}`, 14, y);
    y += 7;

    pdf.setFont("helvetica", "normal");
    const bodyLines = pdf.splitTextToSize(step.description, 180);
    pdf.text(bodyLines, 14, y);
    y += bodyLines.length * 6 + 2;
    pdf.text(`Duration: ${step.duration}`, 14, y);
    y += 7;
    pdf.text(`Outcome: ${step.outcome}`, 14, y);
    y += 12;
  });

  return pdf.output("blob");
}

function subscribeToCommunityPaths() {
  const communityQuery = query(
    collection(db, "learningPaths"),
    orderBy("createdAt", "desc"),
    limit(8)
  );

  onSnapshot(communityQuery, (snapshot) => {
    if (snapshot.empty) {
      communityFeed.innerHTML = '<div class="community-empty">No community paths yet. Generate the first one.</div>';
      communityCount.textContent = "0 live paths";
      return;
    }

    const docs = snapshot.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data()
    }));

    communityCount.textContent = `${docs.length} live paths`;
    communityFeed.innerHTML = docs.map((item) => {
      const createdAt = item.createdAt?.toDate ? item.createdAt.toDate().toLocaleString() : "Just now";
      const previewSteps = Array.isArray(item.steps) ? item.steps.slice(0, 3) : [];

      return `
        <article class="community-card">
          <header>
            <div>
              <h3>${escapeHtml(item.goal || "Untitled Goal")}</h3>
              <p>${escapeHtml(item.difficulty || "Unknown difficulty")}</p>
            </div>
            <span class="pill">${escapeHtml(createdAt)}</span>
          </header>
          <p><strong>User:</strong> ${escapeHtml(item.userId || "anonymous")}</p>
          <ul>
            ${previewSteps.map((step) => `<li>${escapeHtml(step.title || `Step ${step.step}`)}</li>`).join("")}
          </ul>
        </article>
      `;
    }).join("");
  }, (error) => {
    console.error(error);
    setStatus("Realtime community feed failed to load. Check Firestore indexes and rules.", "error");
  });
}

function buildDemoRoadmap({ goal, difficulty }) {
  const trackTone = difficulty === "Advanced"
    ? "with project depth, optimization, and system design focus"
    : difficulty === "Intermediate"
      ? "with steady practice and portfolio building"
      : "from fundamentals to confidence-building practice";

  return {
    goal,
    difficulty,
    provider: "demo-fallback",
    metadata: {
      model: "local-demo",
      source: "frontend-fallback"
    },
    steps: [
      {
        title: `Build the foundation for ${goal}`,
        description: `Start ${trackTone}. Learn the core concepts, vocabulary, and setup needed to begin effectively.`,
        duration: "Week 1",
        outcome: "A clear understanding of the basics and a working environment."
      },
      {
        title: "Practice guided exercises",
        description: "Work through beginner-friendly or progressively harder exercises that reinforce each core concept with repetition.",
        duration: "Week 2",
        outcome: "Improved fluency through structured hands-on practice."
      },
      {
        title: "Create a mini project",
        description: `Apply ${goal} in a small but complete project to connect theory with real-world implementation.`,
        duration: "Week 3",
        outcome: "A tangible proof-of-learning project for your portfolio."
      },
      {
        title: "Expand into advanced use cases",
        description: "Study tooling, debugging, best practices, and more realistic scenarios that mirror professional workflows.",
        duration: "Week 4",
        outcome: "Broader problem-solving ability and stronger practical confidence."
      },
      {
        title: "Ship a capstone and review",
        description: "Finish with a polished capstone, document what you learned, and identify your next specialization steps.",
        duration: "Week 5",
        outcome: "A complete roadmap cycle with reflection and next-step readiness."
      }
    ]
  };
}

function getOrCreateUserId() {
  const storageKey = "pathfinder-ai-user-id";
  const existing = localStorage.getItem(storageKey);

  if (existing) {
    return existing;
  }

  const generated = `user-${crypto.randomUUID().slice(0, 8)}`;
  localStorage.setItem(storageKey, generated);
  return generated;
}

function toggleGenerationState(isLoading) {
  generateBtn.disabled = isLoading;
  generateBtn.textContent = isLoading ? "Generating..." : "Generate Path";
}

function setStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.style.background =
    type === "error"
      ? "rgba(185, 28, 28, 0.12)"
      : type === "success"
        ? "rgba(22, 163, 74, 0.12)"
        : "rgba(15, 118, 110, 0.08)";
  statusMessage.style.color =
    type === "error"
      ? "#8f1d1d"
      : type === "success"
        ? "#166534"
        : "#0a4f4b";
}

function sanitizeForFileName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
