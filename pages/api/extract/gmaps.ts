import type { NextApiRequest, NextApiResponse } from "next";
import { scrapeGoogleMapsLive } from "@/lib/gmaps-scraper";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow CORS for Chatwoot & Frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { niche, city, country = "ES", limit = 15 } = req.body || {};

    if (!niche && !city) {
      return res.status(400).json({ error: "Parámetros 'niche' y 'city' requeridos." });
    }

    const leads = await scrapeGoogleMapsLive(
      niche || "Empresas",
      city || "Centro",
      country,
      Number(limit) || 15
    );

    return res.status(200).json({
      status: "success",
      query: `${niche} en ${city}, ${country}`,
      total_extracted: leads.length,
      leads,
    });
  } catch (error: any) {
    console.error("GMaps API Handler Error:", error);
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
}
