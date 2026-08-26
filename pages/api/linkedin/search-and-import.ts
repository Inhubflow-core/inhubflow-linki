import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import {
  searchLinkedInProfiles,
  saveProfilesToList,
  SearchProgressEvent,
  SearchLead,
} from "@/lib/linkedin/search";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    accountId,
    title,
    location,
    company,
    keywords,
    limit = 25,
    listName,
    stream = true,
  } = req.body || {};

  if (!accountId) {
    return res.status(400).json({ error: "Se requiere accountId de LinkedIn." });
  }

  if (!title && !location && !company && !keywords) {
    return res.status(400).json({
      error: "Debes ingresar al menos un criterio de búsqueda (Cargo, Ubicación, Empresa o Palabras Clave).",
    });
  }

  const numericLimit = Math.min(Math.max(parseInt(String(limit), 10) || 25, 5), 100);
  const cleanListName =
    listName?.trim() ||
    `${title ? title.trim() : "Prospectos"} ${location ? location.trim() : ""} - ${new Date().toLocaleDateString(
      "es-ES",
      { month: "short", year: "numeric" }
    )}`.trim();

  // If streaming is requested (via body or Accept header)
  if (stream || req.headers.accept?.includes("text/event-stream")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendEvent = (event: string, data: unknown) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        // @ts-expect-error Next.js flush if available
        if (typeof res.flush === "function") res.flush();
      } catch {
        /* client disconnected */
      }
    };

    sendEvent("init", {
      message: "Conectado al motor de búsqueda de LinkedIn...",
      filters: { title, location, company, keywords },
      limit: numericLimit,
      listName: cleanListName,
    });

    try {
      const db = getDb();
      const profiles: SearchLead[] = await searchLinkedInProfiles(
        {
          accountId,
          filters: { title, location, company, keywords },
          limit: numericLimit,
        },
        (progress: SearchProgressEvent) => {
          sendEvent("progress", progress);
          if (progress.currentLead) {
            sendEvent("lead", progress.currentLead);
          }
        }
      );

      sendEvent("saving", {
        message: `Guardando ${profiles.length} prospectos en la lista "${cleanListName}"...`,
        totalFound: profiles.length,
      });

      let saveResult = { listId: "", listName: cleanListName, importedCount: 0, updatedCount: 0 };
      if (profiles.length > 0) {
        saveResult = saveProfilesToList(db, {
          listName: cleanListName,
          description: `Búsqueda Lead Finder: ${[title, location, company].filter(Boolean).join(" | ")}`,
          profiles,
        });
      }

      sendEvent("complete", {
        success: true,
        listId: saveResult.listId,
        listName: saveResult.listName,
        importedCount: saveResult.importedCount,
        updatedCount: saveResult.updatedCount,
        totalFound: profiles.length,
        profiles,
        message:
          profiles.length > 0
            ? `¡Lista "${cleanListName}" creada exitosamente con ${profiles.length} prospectos!`
            : "No se encontraron perfiles con estos criterios específicos. Prueba simplificando la búsqueda.",
      });

      res.end();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error durante la búsqueda y extracción de prospectos";
      sendEvent("error", { error: message });
      res.end();
    }
    return;
  }

  // Non-streaming JSON response
  try {
    const db = getDb();
    const profiles = await searchLinkedInProfiles({
      accountId,
      filters: { title, location, company, keywords },
      limit: numericLimit,
    });

    let saveResult = { listId: "", listName: cleanListName, importedCount: 0, updatedCount: 0 };
    if (profiles.length > 0) {
      saveResult = saveProfilesToList(db, {
        listName: cleanListName,
        description: `Búsqueda Lead Finder: ${[title, location, company].filter(Boolean).join(" | ")}`,
        profiles,
      });
    }

    return res.status(200).json({
      success: true,
      listId: saveResult.listId,
      listName: saveResult.listName,
      importedCount: saveResult.importedCount,
      updatedCount: saveResult.updatedCount,
      totalFound: profiles.length,
      profiles,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error durante la búsqueda de prospectos";
    return res.status(500).json({ error: message });
  }
}
