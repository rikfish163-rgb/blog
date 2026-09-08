#!/usr/bin/env python3
"""
视觉与交互验证工具。

用系统已装的 Chrome（不下载 Playwright 自带浏览器，省磁盘），
可以做单纯 --screenshot 做不到的事：
  - 真正模拟 prefers-color-scheme / prefers-reduced-motion
  - 写 localStorage 走主题切换的真实路径
  - 收集 console 错误与失败请求
  - 触发点击，验证墨滴涟漪确实画上了像素

用法：
  python3 scripts/shoot.py <url> <输出图> [--dark] [--reduced] [--click] [--full] [--mobile]
"""
import sys
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

CHROME = "/home/hetaisheng/.local/bin/google-chrome"


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    url, out = sys.argv[1], sys.argv[2]
    flags = set(sys.argv[3:])
    dark = "--dark" in flags
    reduced = "--reduced" in flags
    click = "--click" in flags
    full = "--full" in flags
    mobile = "--mobile" in flags

    errors: list[str] = []
    failed: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
        )
        page = browser.new_page(
            viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 900},
            device_scale_factor=2,  # 2x 截图，看得清字形细节
            color_scheme="dark" if dark else "light",
            reduced_motion="reduce" if reduced else "no-preference",
        )

        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "requestfailed",
            lambda r: failed.append(f"{r.url} :: {r.failure}"),
        )

        page.goto(url, wait_until="load")
        # 等字体就位再截图，否则会拍到 fallback 字形
        page.evaluate("() => document.fonts.ready")
        page.wait_for_timeout(900)

        if click:
            # 点在正文空白处，避免触发导航
            page.mouse.click(900, 700)
            page.wait_for_timeout(160)  # 涟漪正处于最盛期

        page.screenshot(path=out, full_page=full)

        # 顺手把几项关键状态一起报回来，省得再跑一次
        state = page.evaluate(
            """() => ({
                theme: document.documentElement.dataset.theme,
                armed: document.documentElement.classList.contains('reveal-armed'),
                revealed: document.querySelectorAll('[data-reveal].is-in').length,
                revealTotal: document.querySelectorAll('[data-reveal]').length,
                motionBound: !!window.__motionBound,
                inkRipple: !!window.__inkRipple,
                blobAnims: [...document.querySelectorAll('[data-ink-blob]')]
                    .map(el => el.getAnimations().length),
                cjkFonts: performance.getEntriesByType('resource')
                    .filter(r => /lxgw/i.test(r.name)).length,
            })"""
        )
        browser.close()

    print(json.dumps(state, ensure_ascii=False, indent=2))
    if errors:
        print("\n控制台错误:")
        for e in errors[:10]:
            print("  ", e)
    if failed:
        print("\n请求失败:")
        for f in failed[:10]:
            print("  ", f)
    if not errors and not failed:
        print("\n无控制台错误、无失败请求")

    print(f"\n→ {out} ({Path(out).stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
