import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { action, payload } = await request.json();
    const apiKey = process.env.GEMINI_API_KEY;

    // Fallback Mock implementation if API Key is not set
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not set. Using smart mock fallback.");
      
      if (action === "generate-questions") {
        const notes = payload || "";
        return NextResponse.json({
          success: true,
          mocked: true,
          questions: [
            {
              question: `Review Question: ${notes.substring(0, 40) || "Presentation Topic"}?`,
              options: ["Key point discussed", "Incorrect alternative", "Irrelevant point", "None of the above"],
              correctOptionIndex: 0
            },
            {
              question: "Which of the following best summarizes this slide's core message?",
              options: ["Main conclusion", "Supporting statistic", "Initial premise", "Future research direction"],
              correctOptionIndex: 0
            }
          ]
        });
      }

      if (action === "cluster-responses") {
        const items = (payload as string[]) || [];
        return NextResponse.json({
          success: true,
          mocked: true,
          clusters: [
            {
              category: "Core Feedback",
              responses: items.slice(0, Math.ceil(items.length / 2))
            },
            {
              category: "Alternative Perspectives",
              responses: items.slice(Math.ceil(items.length / 2))
            }
          ]
        });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Call Real Google Gemini 1.5 Flash API
    if (action === "generate-questions") {
      const prompt = `
        Read the following presenter slide notes:
        "${payload}"
        
        Generate 2 multiple choice quiz questions based on the notes.
        Format the output strictly as a JSON array of objects with the fields:
        "question" (string), "options" (array of 4 strings), and "correctOptionIndex" (number 0-3).
        Do not add markdown formatting outside the JSON code block.
      `;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        }
      );

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      return NextResponse.json({
        success: true,
        questions: JSON.parse(text)
      });
    }

    if (action === "cluster-responses") {
      const prompt = `
        Look at this list of open text answers submitted by an audience:
        ${JSON.stringify(payload)}

        Cluster these responses into 2 or 3 thematic categories.
        Format the output strictly as a JSON array of objects with the fields:
        "category" (string name of theme) and "responses" (array of strings belonging to this category).
        Do not add markdown formatting outside the JSON code block.
      `;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        }
      );

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      return NextResponse.json({
        success: true,
        clusters: JSON.parse(text)
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  } catch (err: any) {
    console.error("AI Route Error:", err);
    return NextResponse.json({ error: err.message || "Failed to call Gemini AI API" }, { status: 500 });
  }
}
