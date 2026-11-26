import { Router } from "express";
import desktopRequest from "@/lib/desktop";
import u from "@/utils";
import { success, errorFromCause } from "@/lib/responseFormat";

/** 内嵌 CapCut 曲库是否可用 / 是否已登录（仅桌面客户端；用 POST 复用 desktopRequest 的同源校验）。 */
export default Router().post("/", desktopRequest, async (req, res) => {
  try {
    const capcut = u.desktop.getDesktopRuntime(req).capcutMusic;
    const loggedIn = capcut ? await capcut.loggedIn() : false;
    res.set("Cache-Control", "no-store").json(success({ available: !!capcut, loggedIn }));
  } catch (cause) {
    res.status(500).json(errorFromCause(cause));
  }
});
