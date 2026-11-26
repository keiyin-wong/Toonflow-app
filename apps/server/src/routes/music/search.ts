import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success, errorFromCause } from "@/lib/responseFormat";

/**
 * 搜索 CapCut 在线音乐曲库，返回带 previewUrl 的歌曲列表。
 * 桌面客户端走内嵌 CapCut webview（不再拉起外部浏览器）；非桌面（独立 server / 浏览器开发）降级到 puppeteer 代理。
 */
export default Router().post("/", validateFields({ keyword: z.string().min(1).max(100) }), async (req, res) => {
  try {
    const keyword = String(req.body.keyword);
    const capcut = req.app.locals.desktop?.capcutMusic;
    const result = capcut ? await capcut.search(keyword) : await (await import("@toonflow/tool-browser/capcutMusic")).searchMusic(keyword);
    res.set("Cache-Control", "no-store").json(success(result));
  } catch (error) {
    res.status(500).json(errorFromCause(error));
  }
});
