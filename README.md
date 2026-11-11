# Cat Simulator

A browser-based 3D cat built with [Three.js](https://threejs.org/). The cat follows your pointer, comes when you call it, purrs when you pet it, and can sit, loaf, sleep, groom, pounce and more. Its sounds are generated with the Web Audio API, so the project has no audio files.

There is no build step and nothing to install. The app is plain HTML, CSS and ES modules, and Three.js is loaded from a CDN through an import map.

## Getting started

### Requirements

- A modern browser with WebGL and ES module support (current Chrome, Firefox, Safari or Edge)
- Any static file server (examples below)
- An internet connection the first time you load the page, to fetch Three.js from `cdn.jsdelivr.net`

### Run it locally

Browsers block ES modules on `file://` URLs, so opening `index.html` directly won't work. Serve the folder over HTTP instead. Pick whichever of these you have installed:

```bash
# Python 3
python3 -m http.server 8000

# Node.js
npx serve .            # or: npx http-server -p 8000

# PHP
php -S localhost:8000
```

Then open <http://localhost:8000> in your browser. (`npx serve` uses port 3000 by default, so open <http://localhost:3000> if you used it.)

The VS Code **Live Server** extension also works: right-click `index.html` and choose **Open with Live Server**.

## How to play

| Input | What it does |
| --- | --- |
| Move the pointer | The cat follows it (turn this off with **Follow pointer**) |
| Click the floor | Calls the cat to that spot |
| Click the cat | Pets it (it purrs) |
| `Space` | Gets the cat up and following you again |
| Fur swatches (top right) | Changes the coat. Your choice is saved in the browser |
| **Sound** button | Mutes or unmutes the cat |

### Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `S` | Sit | `T` | Stretch |
| `L` | Lie down | `R` | Roll over |
| `F` | Loaf | `J` | Jump |
| `Z` | Sleep | `P` | Pounce |
| `G` | Groom | `M` | Meow |
| | | `U` | Purr |

Sit, Lie down, Loaf and Sleep hold until you give another command. The other actions play once, then the cat goes back to standing.

Browsers only allow audio after you interact with the page, so the cat stays silent until your first click or key press.

## Project structure

```
index.html       Page layout, UI panels and the Three.js import map
style.css        UI styling
src/main.js      Scene, camera, lighting, UI wiring and input handling
src/cat.js       Cat 3D model and fur presets
src/behavior.js  Poses, actions and movement (the cat's state machine)
src/audio.js     Synthesised meow and purr sounds
```

## Deploying

The project is a static site, so any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages and so on). Publish the repository root as-is. No build command is needed.
