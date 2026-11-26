import { Router } from "express";
import { success, errorFromCause } from "@/lib/responseFormat";

/**
 * CapCut 在线曲库的默认/推荐歌单（未搜索时展示）。
 * 桌面客户端走内嵌 CapCut webview；非桌面降级到 puppeteer 代理。
 */
export default Router().get("/", async (req, res) => {
  try {
    const capcut = req.app.locals.desktop?.capcutMusic;
    const result = capcut ? await capcut.recommend() : await (await import("@toonflow/tool-browser/capcutMusic")).recommendMusic();
    res.set("Cache-Control", "no-store").json(success(result));
  } catch (error) {
    res.status(500).json(errorFromCause(error));
  }
});
