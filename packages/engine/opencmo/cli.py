"""Giao diện dòng lệnh: kiểm tra môi trường của worker.

The clip command went with the clipping tool (owner, 2026-10-20); the worker runs every job.
"""

from __future__ import annotations

import logging
import sys

import typer
from rich.console import Console
from rich.logging import RichHandler

from .config import Config

app = typer.Typer(add_completion=False, help="OpenCMO engine — worker checks.")
console = Console()


@app.callback()
def _root() -> None:
    """OpenCMO engine."""


@app.command()
def doctor() -> None:
    """Kiểm tra môi trường: ffmpeg, khoá speech-to-text."""
    logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[RichHandler(console=console)])
    from .media.ffmpeg import require_binaries

    cfg = Config()
    ok = True
    try:
        require_binaries()
        console.print("  [green]✓[/green] ffmpeg + ffprobe")
    except Exception as exc:  # noqa: BLE001
        console.print(f"  [red]✗[/red] {exc}")
        ok = False

    console.print(f"  [dim]Python {sys.version_info.major}.{sys.version_info.minor}[/dim]")
    if cfg.elevenlabs_api_key:
        console.print("  [green]✓[/green] ELEVENLABS_API_KEY")
    else:
        console.print("  [red]✗[/red] missing ELEVENLABS_API_KEY")
        ok = False

    console.print()
    console.print("[green]Sẵn sàng.[/green]" if ok else "[red]Còn thiếu, xem ở trên.[/red]")
    if not ok:
        raise typer.Exit(code=1)


def main() -> None:
    app()


if __name__ == "__main__":
    sys.exit(app())
