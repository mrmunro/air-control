import { getGeminiClient } from "./src/llm-client";

async function main() {
  console.log("Calling Gemini...");
  try {
    const geminiClient = getGeminiClient("DUMMY");
    const stream = await geminiClient.chat.completions.create({
      model: "gemini-3.5-flash",
      stream: true,
      messages: [{ role: "user", content: "Hello" }],
    });

    const readable = stream.toReadableStream();
    const reader = readable.getReader();
    const { value, done } = await reader.read();
    console.log("Stream chunk type:", typeof value);
    if (value instanceof Uint8Array) {
      console.log("Decoded:", new TextDecoder().decode(value));
    } else {
      console.log("Value:", value);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

main();
