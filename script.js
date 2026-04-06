import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  addDoc,
  collection,
  doc,
  getFirestore,
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
  apiKey: "AIzaSyD_EB8n9NBCeRcSNZeSE3MHq2xVloLRarE",
  authDomain: "pathfinder-ai-cb7c1.firebaseapp.com",
  projectId: "pathfinder-ai-cb7c1",
  storageBucket: "pathfinder-ai-cb7c1.firebasestorage.app",
  messagingSenderId: "440797266159",
  appId: "1:440797266159:web:ca867df5bdcd4e7460db1a",
  measurementId: "G-77NX7FJ2MG"
};

const GEMINI_API_KEY = "AIzaSyBulN1hSyhZ4i29qyN5HfZSarC3SBJFSg8";
const GEMINI_MODEL = "gemini-2.5-flash";
const COLLECTION_NAME = "learning_paths";
const PDF_FOLDER = "learning-path-pdfs";
const GENERATION_COOLDOWN_MS = 60000;

const firebaseReady = !Object.values(firebaseConfig).some((value) => value.startsWith("YOUR_"));
const geminiReady = !GEMINI_API_KEY.startsWith("YOUR_");

const app = firebaseReady ? initializeApp(firebaseConfig) : null;
const db = firebaseReady ? getFirestore(app) : null;
const storage = firebaseReady ? getStorage(app) : null;

const userId = getOrCreateUserId();
let currentPath = null;
let lastSavedDocId = null;
let nextGenerateAllowedAt = 0;
let cooldownTimeoutId = null;

const form = document.getElementById("pathForm");
const goalInput = document.getElementById("goalInput");
const difficultyInput = document.getElementById("difficultyInput");
const generateBtn = document.getElementById("generateBtn");
const exportBtn = document.getElementById("exportBtn");
const roadmapCard = document.getElementById("roadmapCard");
const jsonOutput = document.getElementById("jsonOutput");
const statusMessage = document.getElementById("statusMessage");
const lastGeneratedAt = document.getElementById("lastGeneratedAt");
const storageStatus = document.getElementById("storageStatus");
const stepModal = document.getElementById("stepModal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

if (modalClose && stepModal) {
  modalClose.addEventListener("click", closeStepModal);
  stepModal.addEventListener("click", (event) => {
    if (event.target === stepModal) {
      closeStepModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeStepModal();
    }
  });
}

form.addEventListener("submit", handleGeneratePath);
exportBtn.addEventListener("click", exportCurrentPathAsPdf);

async function handleGeneratePath(event) {
  event.preventDefault();

  const goal = goalInput.value.trim();
  const difficulty = difficultyInput.value;

  if (!goal) {
    setStatus("Please enter a learning goal first.", "error");
    return;
  }

  if (!geminiReady) {
    setStatus("The Gemini API key is missing.", "error");
    return;
  }

  if (Date.now() < nextGenerateAllowedAt) {
    const secondsRemaining = Math.ceil((nextGenerateAllowedAt - Date.now()) / 1000);
    setStatus(`Rate limit guard active. Please wait ${secondsRemaining} seconds.`, "error");
    return;
  }

  setGeneratingState("AI is thinking...");
  setStatus("Generating your learning path with Gemini...", "loading");

  try {
    const content = await generateLearningPath(goal, difficulty);
    currentPath = {
      goal,
      difficulty,
      content
    };

    renderRoadmap(currentPath);
    exportBtn.disabled = false;

    if (firebaseReady) {
      const docRef = await addDoc(collection(db, COLLECTION_NAME), {
        goal,
        difficulty,
        content,
        timestamp: serverTimestamp(),
        userId
      });

      lastSavedDocId = docRef.id;
    }

    lastGeneratedAt.textContent = `Generated ${new Date().toLocaleString()}`;
    setStatus(
      firebaseReady
        ? "Learning path generated and saved successfully."
        : "Learning path generated successfully.",
      "success"
    );
  } catch (error) {
    console.error(error);
    if (error.status === 429) {
      setStatus("Rate limit reached. Please wait 60 seconds.", "error");
    } else {
      setStatus(error.message || "Unable to generate the learning path.", "error");
    }
  } finally {
    startGenerateCooldown();
  }
}

async function generateLearningPath(goal, difficulty) {
  const prompt = `Create a structured 5-step learning path for ${goal} at ${difficulty} level. Return strictly as JSON with "title", "description", and "steps" array. Each item in "steps" must include "title" and "description".`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
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

  if (!response.ok) {
    const error = new Error(`Gemini request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini did not return any content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("Gemini returned invalid JSON.");
  }

  if (!parsed.title || !parsed.description || !Array.isArray(parsed.steps) || parsed.steps.length !== 5) {
    throw new Error("Gemini response did not match the required 5-step JSON format.");
  }

  return {
    title: parsed.title,
    description: parsed.description,
    steps: parsed.steps.map((step, index) => ({
      title: step.title || `Step ${index + 1}`,
      description: step.description || "Description not provided."
    }))
  };
}

function renderRoadmap(pathData) {
  const { content } = pathData;
  const shortDescription = truncateText(content.description, 140);

  roadmapCard.classList.remove("empty");
  roadmapCard.innerHTML = `
    <div class="roadmap-list">
      <article class="roadmap-summary">
        <div class="step-index">AI</div>
        <div>
          <h3>${escapeHtml(content.title)}</h3>
          <p>${escapeHtml(shortDescription)}</p>
        </div>
      </article>
      ${content.steps.map((step, index) => `
        <button
          class="roadmap-accordion"
          type="button"
          data-step-title="${escapeHtml(step.title)}"
          data-step-description="${escapeHtml(step.description)}"
        >
          <div class="step-index">${index + 1}</div>
          <div>
            <h3>Step ${index + 1}: ${escapeHtml(step.title)}</h3>
          </div>
          <span class="accordion-icon">+</span>
        </button>
      `).join("")}
    </div>
  `;

  setupStepPopupBehavior();

  jsonOutput.textContent = JSON.stringify({
    goal: pathData.goal,
    difficulty: pathData.difficulty,
    content
  }, null, 2);
}

async function exportCurrentPathAsPdf() {
  if (!currentPath) {
    setStatus("Generate a learning path before exporting it.", "error");
    return;
  }

  const { content, goal, difficulty } = currentPath;
  const pdfBlob = buildPdfBlob(goal, difficulty, content);

  const downloadUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `${sanitizeForFileName(goal)}-pathfinder-ai.pdf`;
  link.click();
  URL.revokeObjectURL(downloadUrl);

  if (!firebaseReady) {
    if (storageStatus) {
      storageStatus.textContent = "Downloaded";
    }
    setStatus("PDF downloaded successfully.", "success");
    return;
  }

  try {
    if (storageStatus) {
      storageStatus.textContent = "Uploading PDF...";
    }
    const fileName = `${sanitizeForFileName(goal)}-${Date.now()}.pdf`;
    const storageRef = ref(storage, `${PDF_FOLDER}/${userId}/${fileName}`);

    await uploadBytes(storageRef, pdfBlob, {
      contentType: "application/pdf"
    });

    const uploadedUrl = await getDownloadURL(storageRef);

    if (lastSavedDocId) {
      await updateDoc(doc(db, COLLECTION_NAME, lastSavedDocId), {
        pdfUrl: uploadedUrl
      });
    }

    if (storageStatus) {
      storageStatus.textContent = "PDF uploaded";
    }
    setStatus("PDF downloaded and uploaded to Firebase Storage.", "success");
  } catch (error) {
    console.error(error);
    if (storageStatus) {
      storageStatus.textContent = "Upload failed";
    }
    setStatus("PDF downloaded locally, but Firebase Storage upload failed.", "error");
  }
}

function buildPdfBlob(goal, difficulty, content) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let y = 20;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text("PathFinder AI", 14, y);
  y += 10;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.text(`Goal: ${goal}`, 14, y);
  y += 8;
  pdf.text(`Difficulty: ${difficulty}`, 14, y);
  y += 10;

  pdf.setFont("helvetica", "bold");
  pdf.text(content.title, 14, y);
  y += 8;
  pdf.setFont("helvetica", "normal");
  const introLines = pdf.splitTextToSize(content.description, 180);
  pdf.text(introLines, 14, y);
  y += introLines.length * 6 + 8;

  content.steps.forEach((step, index) => {
    if (y > 255) {
      pdf.addPage();
      y = 20;
    }

    pdf.setFont("helvetica", "bold");
    pdf.text(`${index + 1}. ${step.title}`, 14, y);
    y += 7;

    pdf.setFont("helvetica", "normal");
    const lines = pdf.splitTextToSize(step.description, 180);
    pdf.text(lines, 14, y);
    y += lines.length * 6 + 6;
  });

  return pdf.output("blob");
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

function setGeneratingState(label) {
  generateBtn.disabled = true;
  generateBtn.textContent = label;
}

function startGenerateCooldown() {
  nextGenerateAllowedAt = Date.now() + GENERATION_COOLDOWN_MS;

  if (cooldownTimeoutId) {
    clearTimeout(cooldownTimeoutId);
  }

  generateBtn.disabled = true;
  generateBtn.textContent = "Wait 60s";

  cooldownTimeoutId = window.setTimeout(() => {
    nextGenerateAllowedAt = 0;
    cooldownTimeoutId = null;
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Path";
  }, GENERATION_COOLDOWN_MS);
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

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function setupStepPopupBehavior() {
  if (!stepModal || !modalTitle || !modalBody) {
    return;
  }

  const stepButtons = roadmapCard.querySelectorAll(".roadmap-accordion");

  stepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openStepModal(
        button.dataset.stepTitle || "Step",
        button.dataset.stepDescription || "No description available."
      );
    });
  });
}

function openStepModal(title, description) {
  if (!stepModal || !modalTitle || !modalBody) {
    return;
  }

  modalTitle.textContent = title;
  modalBody.textContent = description;
  stepModal.classList.add("open");
  stepModal.setAttribute("aria-hidden", "false");
}

function closeStepModal() {
  if (!stepModal) {
    return;
  }

  stepModal.classList.remove("open");
  stepModal.setAttribute("aria-hidden", "true");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
