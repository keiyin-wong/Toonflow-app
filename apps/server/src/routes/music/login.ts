import { Router } from "express";
import desktopRequest from "@/lib/desktop";
import u from "@/utils";
import { success, error, errorFromCause } from "@/lib/responseFormat";

/** 在内嵌 CapCut webview 里显示登录窗口，等用户登录曲库成功后自行隐藏（仅桌面客户端）。 */
export default Router().post("/", desktopRequest, async (req, res) => {
  try {
    const capcut = u.desktop.getDesktopRuntime(req).capcutMusic;
    if (!capcut) {
      res.status(404).json(error("当前客户端不支持内嵌 CapCut 曲库", null, 404));
      return;
    }
    await capcut.login();
    res.set("Cache-Control", "no-store").json(success({ loggedIn: true }));
  } catch (cause) {
    res.status(500).json(errorFromCause(cause));
  }
});
