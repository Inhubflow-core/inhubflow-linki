import type { NextApiRequest, NextApiResponse } from "next";
import handler from "./search-and-import";

export default function searchHandler(req: NextApiRequest, res: NextApiResponse) {
  return handler(req, res);
}
