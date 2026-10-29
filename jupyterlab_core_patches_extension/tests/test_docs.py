from pathlib import Path

PROJECT_ROOT = Path(__file__).parents[2]
SLUGS = [
    "change-ui-font-size",
    "file-browser-column-width",
    "jump-to-definition",
    "markdown-switch-tab-scrolling",
    "markdown-syntax-rendering",
    "markdown-viewer-toc",
    "other-file-type-menu",
    "restore-terminals",
    "server-proxy-launcher",
    "terminal-cpr-escape",
]
REQUIRED_LABELS = [
    "**Switch**",
    "**Plugin id**",
    "**Patched member**",
    "**Guard**",
    "**Source**",
    "**Jest test**",
    "**Galata test**",
]


def test_each_patch_has_a_documented_page():
    for slug in SLUGS:
        page = PROJECT_ROOT / "docs" / f"{slug}.md"
        assert page.is_file(), f"missing {page}"
        text = page.read_text(encoding="utf-8")
        for label in REQUIRED_LABELS:
            assert label in text, f"{page} has no {label}"


def test_readme_links_every_page():
    readme = (PROJECT_ROOT / "README.md").read_text(encoding="utf-8")
    for slug in SLUGS:
        assert f"docs/{slug}.md" in readme, f"README has no docs/{slug}.md"
