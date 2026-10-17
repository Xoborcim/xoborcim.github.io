# xoborcim.github.io

The Xoborcim games site: a home page for all the games, a page per game with its own support
and privacy pages, and the `app-ads.txt` that AdMob checks. Plain HTML and CSS, no build step.
House style follows Hewn (IM FELL English, parchment and ink, light and dark).

```
/                          home: every game as a "plate", each with a tiny playable teaser (home.js)
/games/hewn/               Hewn: about, support.html, privacy.html
/games/pocket-quilt/       Pocket Quilt: about, support.html, privacy.html
/app-ads.txt               AdMob seller line (one publisher covers both games)
/hewn/                     NOT here: Hewn's playable web version, published from the Xoborcim/hewn repo
```

## Contact email
Pages show `xoborcim.games@gmail.com`. To change it:

```sh
grep -rl xoborcim.games@gmail.com --include="*.html" . | xargs sed -i '' 's/xoborcim.games@gmail.com/new@address/g'
```

## Publish
1. On GitHub, create a **public** repository named exactly `xoborcim.github.io` under the Xoborcim account.
2. Push this folder to it:
   ```sh
   git remote add origin https://github.com/Xoborcim/xoborcim.github.io.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
4. Check `https://xoborcim.github.io/app-ads.txt` shows the Google line, and `https://xoborcim.github.io/hewn/` still opens Hewn.

## Adding a game
1. Put a 360px icon in `img/`.
2. Copy `games/pocket-quilt/` to `games/<slug>/` and edit the three pages.
3. Add a new `<article class="plate">` to `index.html` (Plate III, …).
4. If it shows AdMob ads from another publisher account, add that publisher's line to `app-ads.txt`.

## App Store Connect URLs
| Game | Privacy Policy URL | Support URL | Marketing URL |
|---|---|---|---|
| Hewn | `https://xoborcim.github.io/games/hewn/privacy.html` | `…/games/hewn/support.html` | `https://xoborcim.github.io` |
| Pocket Quilt | `https://xoborcim.github.io/games/pocket-quilt/privacy.html` | `…/games/pocket-quilt/support.html` | `https://xoborcim.github.io` |

The Marketing URL matters: AdMob reads `app-ads.txt` from the developer website on the App Store listing.

Fonts: IM FELL English by Igino Marini, SIL Open Font License (`fonts/OFL.txt`).
