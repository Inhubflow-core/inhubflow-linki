import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { sendWelcomeEmail } from "@/lib/email/welcome-email";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userRole = (session?.user as { role?: string })?.role;
  const isSuperAdmin =
    userRole === "admin" ||
    (session?.user as { email?: string })?.email?.trim().toLowerCase() === "inhubflow@gmail.com";

  if (!isSuperAdmin) {
    return res.status(403).json({ error: "Acceso denegado. Se requiere SuperAdmin." });
  }

  const { to, companyName, password, planTier = "business", slotsLimit = 10 } = req.body;

  if (!to) {
    return res.status(400).json({ error: "El correo destinatario es requerido" });
  }

  const result = await sendWelcomeEmail({
    to,
    companyName: companyName || "Empresa de Prueba B2B",
    password: password || "InHubFlow2026!",
    planTier,
    slotsLimit: Number(slotsLimit) || 10,
  });

  if (!result.success) {
    return res.status(500).json({ error: result.error || "No se pudo enviar el correo de prueba" });
  }

  return res.status(200).json({
    success: true,
    message: `Correo enviado exitosamente a ${to}`,
    emailId: result.id,
  });
}
