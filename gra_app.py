# Europa 1400 jako aplikacja z własnym oknem (bez przeglądarki).
# Okno używa WebView2, czyli silnika, który jest już w Windows 10/11.
import sys
from pathlib import Path

import webview

base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
game = base / "GRA.html"


def main():
    webview.create_window(
        "Europa 1400",
        str(game),
        width=1600,
        height=1000,
        min_size=(1024, 700),
    )
    webview.start()


if __name__ == "__main__":
    main()
