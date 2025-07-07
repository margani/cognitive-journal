const fs = require("fs");
const path = require("path");
const fm = require("front-matter");

const embeddingModelName = "nomic-embed-text";
const llmModelName = "llama3.1:8b";

async function getEmbedding(text, model = embeddingModelName) {
  try {
    const response = await fetch("http://localhost:11434/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.error("Error getting embedding:", error);
    throw error;
  }
}
async function getLLMResponse(prompt, model = llmModelName) {
  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error("Error getting LLM response:", error);
    throw error;
  }
}
function cosineSimilarity(vec1, vec2) {
  if (vec1.length !== vec2.length) {
    throw new Error("Vectors must have the same dimension");
  }
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    magnitude1 += vec1[i] * vec1[i];
    magnitude2 += vec2[i] * vec2[i];
  }
  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);
  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }
  return dotProduct / (magnitude1 * magnitude2);
}

async function runProactiveAnalysis(recentEntries) {
  console.log("--- Starting Proactive AI Analysis ---");

  if (!recentEntries || recentEntries.length === 0) {
    console.log("No journal entries to analyze.");
    return;
  }

  const topicDetectionPrompt = `
    Analyze the following journal entries and identify the most important topics or concerns the user has addressed during this period.
    Return only the main topics in a bulleted list. Express each topic in a short word or phrase.
    Example: "Mental Health", "Work", "Finances", "Shopping and Consumption".
    ---
    ${recentEntries.map((entry) => `- ${entry.text}`).join("\n")}
    ---
    Identified topics:
    `;

  console.log("Detecting topics from journal entries...");
  const rawTopics = await getLLMResponse(topicDetectionPrompt);

  const topics = rawTopics
    .split("\n")
    .filter((line) => line.startsWith("•"))
    .map((line) => line.substring(2).trim());

  console.log("Identified topics:", topics);

  const analysisResults = {};

  for (const topic of topics) {
    console.log(`\nGenerating report for topic: "${topic}"`);

    const topicEmbedding = await getEmbedding(topic);
    const relevantEntriesForTopic = [];
    for (const entry of recentEntries) {
      if (entry.embedding) {
        const similarity = cosineSimilarity(topicEmbedding, entry.embedding);
        if (similarity > 0.6) {
          relevantEntriesForTopic.push({ ...entry, similarity });
        }
      }
    }
    relevantEntriesForTopic.sort((a, b) => b.similarity - a.similarity);
    const topRelevantTextsForTopic = relevantEntriesForTopic
      .slice(0, 5)
      .map((entry) => entry.text)
      .join("\n- ");

    let topicSpecificPrompt = "";
    if (topRelevantTextsForTopic) {
      topicSpecificPrompt += `\nHere is relevant information regarding the topic "${topic}" from the user's past journal entries:\n- ${topRelevantTextsForTopic}\n\n`;
    } else {
      topicSpecificPrompt += `\nTopic "${topic}" was identified, but fewer relevant entries were found.\n\n`;
    }

    switch (topic.toLowerCase()) {
      case "mental health":
      case "anxiety":
      case "stress":
        topicSpecificPrompt += `
                Based on the journal entries related to mental health, please:
                1. Analyze the user's overall emotional trend during this period.
                2. Are there any specific events or factors mentioned that impacted the user's mental state?
                3. Do you have any suggestions for improving the user's mental health based on their writings?
                `;
        break;
      case "work":
      case "projects":
        topicSpecificPrompt += `
                Based on the journal entries related to work, please:
                1. List important work tasks and projects the user has mentioned.
                2. Is there any progress observed in these projects?
                3. Are there any challenges or strengths evident in the user's work environment?
                `;
        break;
      case "finances":
      case "financial management":
      case "money":
        topicSpecificPrompt += `
                Based on the journal entries related to finances, please:
                1. Summarize any expenses or incomes the user has mentioned.
                2. Is there a specific pattern in the user's spending or financial management?
                3. Do you have any financial advice based on the user's writings?
                `;
        break;
      case "shopping and consumption":
      case "shopping":
      case "consumption":
      case "purchases":
        topicSpecificPrompt += `
                Based on the journal entries related to shopping and consumption, please:
                1. List important items the user intended to buy or has already bought.
                2. Is there a specific consumption pattern for recurring items (like milk or peanut butter)?
                3. Are there any reminders for purchasing items that might be running out?
                `;
        break;
      case "health":
      case "exercise":
      case "well-being":
        topicSpecificPrompt += `
                Based on the journal entries related to health and well-being, please:
                1. Summarize the user's physical activity levels.
                2. Are there any indications of physical discomfort or recovery?
                3. Do you have any general health-related observations or suggestions?
                `;
        break;
      default:
        topicSpecificPrompt += `
                Based on the journal entries related to the topic "${topic}", please provide a general summary and any interesting insights that can be inferred from the user's writings.
                `;
        break;
    }

    topicSpecificPrompt += `
      Please provide it in Persian, in a concise and clear manner, focusing on actionable insights and observations.
    `;

    const topicAnalysisResult = await getLLMResponse(topicSpecificPrompt);
    analysisResults[topic] = topicAnalysisResult;
    console.log(`Report for "${topic}":\n`, topicAnalysisResult);
  }

  console.log("\n--- Proactive AI Analysis Completed ---");
  return analysisResults;
}

async function readJournalEntries() {
  const journalDir = path.join(__dirname, "journal");
  const entries = [];

  try {
    const files = fs.readdirSync(journalDir);
    for (const file of files) {
      if (file.endsWith(".md")) {
        const filePath = path.join(journalDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const frontMatter = fm(content);
        const date = frontMatter.attributes.date || null;
        const text = frontMatter.body.trim();
        if (date && text) {
          entries.push({ date, text, embedding: null });
        }
      }
    }
  } catch (error) {
    console.error("Error reading journal entries:", error);
  }

  return entries;
}

async function populateEmbeddingsForExample(journalEntries) {
  console.log("Pre-calculating embeddings for sample journal entries...");
  for (const entry of journalEntries) {
    if (!entry.embedding) {
      entry.embedding = await getEmbedding(entry.text);
    }
  }
  console.log("Embeddings populated.");
}

(async () => {
  const journalEntries = await readJournalEntries();
  await populateEmbeddingsForExample(journalEntries);
  await runProactiveAnalysis(journalEntries);
})();
