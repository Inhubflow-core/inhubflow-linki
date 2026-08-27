import type { NextApiRequest, NextApiResponse } from "next";
import { sdrAgentBridge, type SdrModuleStatus } from "@/lib/sdr-agent";

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<SdrModuleStatus | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json(sdrAgentBridge.getStatus());
}
