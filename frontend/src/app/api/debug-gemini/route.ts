import { NextResponse } from "next/server";

/**
 * GET /api/debug-gemini
 * Quick diagnostic: lists all Gemini models available for your API key.
 * Visit http://localhost:3000/api/debug-gemini in your browser.
 */
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      error: "GEMINI_API_KEY is not set in .env.local",
    }, { status: 500 });
  }

  const results: Record<string, unknown> = {
    key_prefix: apiKey.substring(0, 8) + "...",
  };

  for (const version of ["v1beta", "v1"]) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${version}/models?key=${apiKey}`
      );
      const data = await res.json();

      if (!res.ok) {
        results[version] = { status: res.status, error: data };
        continue;
      }

      const models = (data.models ?? []) as Array<{
        name: string;
        displayName: string;
        supportedGenerationMethods: string[];
      }>;

      const generateModels = models
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => ({
          id: m.name.replace("models/", ""),
          displayName: m.displayName,
          methods: m.supportedGenerationMethods,
        }));

      results[version] = {
        status: res.status,
        total_models: models.length,
        generateContent_models: generateModels,
      };
    } catch (err) {
      results[version] = { error: String(err) };
    }
  }

  return NextResponse.json(results, {
    headers: { "Content-Type": "application/json" },
  });
}
