import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, errorFromCause } from "@/lib/responseFormat";

/** 代理下载 CapCut 的音频/封面（CDN 直链本身匿名可取，这里转一手避开浏览器 CORS，并限制在白名单域）。 */
export default Router().get("/", validateFields({ url: z.string().min(1).max(2048) }, "query"), async (req, res) => {
  try {
    const { assertAllowedMediaUrl } = await import("@toonflow/tool-browser/capcutMusic");
    const url = assertAllowedMediaUrl(String(req.query.url));
    const upstream = await fetch(url.href);
    if (!upstream.ok || !upstream.body) {
      res.status(502).json(error("下载失败", null, 502));
      return;
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (cause) {
    res.status(400).json(errorFromCause(cause));
  }
});
