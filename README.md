# Margin PDF Cropper

一个完全在浏览器本地运行的 PDF 可视化裁切工具。拖入 PDF、框选要保留的区域，然后另存为新的 PDF。文件不会上传到服务器，也不需要后端。

## 开发

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run build
npm run preview
```

`dist/` 是可直接部署的静态网站，可托管在 GitHub Pages、Cloudflare Pages、Vercel 或任意静态 Web 服务器。

支持 PWA 安装和离线再次使用。PDF 内容只在浏览器内存中读取和处理，不会上传到服务器。
