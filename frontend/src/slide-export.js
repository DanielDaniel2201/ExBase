import { slidesHTML } from "./slides.js";

export function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read slide image"));
    reader.readAsDataURL(blob);
  });
}

export async function slidesPPT(slides, title) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const ppt = new PptxGenJS();
  ppt.title = title; ppt.author = "ExBase";
  const ratio = slides[0].width / slides[0].height;
  const width = 13.333333 * Math.min(1, ratio), height = width / ratio;
  ppt.defineLayout({ name: "FRAMES", width, height });
  ppt.layout = "FRAMES";
  for (const slide of slides) {
    const page = ppt.addSlide();
    page.addImage({ data: slide.dataURL, x: 0, y: 0, w: width, h: height, sizing: { type: "contain", w: width, h: height }, altText: slide.name });
    page.addNotes(slide.name);
  }
  return ppt.write({ outputType: "base64", compression: true });
}

export async function slidesHTMLBase64(slides, title) {
  const url = await blobBase64(new Blob([slidesHTML(slides, title)], { type: "text/html;charset=utf-8" }));
  return url.slice(url.indexOf(",") + 1);
}
