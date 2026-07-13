# Margin PDF Cropper

Margin is a privacy-friendly visual PDF cropper that runs entirely in the browser. Open a PDF, adjust the default crop area, and export a new document. Files are processed locally and are never uploaded to a server.

**Live demo:** [https://oduan.github.io/PdfCropper/](https://oduan.github.io/PdfCropper/)

## Features

- Local, browser-only PDF processing
- One adjustable crop area applied to every page
- Drag to move and use the corner handles to resize
- True PDF page cropping on export
- Installable PWA with offline support
- No backend or account required

## Local development

Requirements: Node.js 22 and npm.

```bash
npm ci
npm run dev
```

Create and preview a production build:

```bash
npm run build
npm run preview
```

The production files are written to `dist/` and can be hosted by any static web server.

## Docker

Build and run the image directly:

```bash
docker build -t margin-pdf-cropper .
docker run --rm -p 8080:80 margin-pdf-cropper
```

Or start it with Docker Compose:

```bash
docker compose up -d --build
```

Open [http://localhost:8080](http://localhost:8080) after the container starts. To stop the Compose deployment, run:

```bash
docker compose down
```

## GitHub Pages deployment

GitHub Actions builds and deploys the site only when a tag matching `v*` is pushed. Create a release deployment with:

```bash
git tag v0.1
git push origin v0.1
```

The workflow installs dependencies with `npm ci`, runs `npm run build`, and deploys the generated `dist/` directory to GitHub Pages.

## Privacy

PDF files are read and processed in browser memory. The application does not send document contents to a backend.
