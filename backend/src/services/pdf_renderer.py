"""Playwright PDF Renderer --- Browser 单例 + 信号量"""

import asyncio
import logging

logger = logging.getLogger(__name__)

# Module-level singletons
_browser = None
_semaphore = asyncio.Semaphore(1)
_playwright_instance = None


async def init_browser():
    """在 lifespan 中调用，初始化浏览器单例"""
    global _browser, _playwright_instance
    try:
        from playwright.async_api import async_playwright
        _playwright_instance = await async_playwright().start()
        _browser = await _playwright_instance.chromium.launch(
            headless=True,
            args=["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
        )
        logger.info("Playwright Chromium launched (singleton)")
    except Exception as e:
        logger.warning(f"Playwright init failed: {e}")
        _browser = None


async def shutdown_browser():
    """在 lifespan 关闭时调用"""
    global _browser, _playwright_instance
    if _playwright_instance:
        try:
            await _playwright_instance.stop()
        except Exception:
            pass


def get_browser():
    return _browser


def get_semaphore():
    return _semaphore
