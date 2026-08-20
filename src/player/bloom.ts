// Ambient bloom: the frame reads as a light source rather than a pasted
// rectangle. The 2014 films are shot against black, where spill is faint and a
// fixed glow works. A bright frame — the Cedric Price photograph that opens the
// archive, say — would otherwise flood the whole page with white.
//
// So the glow is measured against the picture: the brighter the frame, the
// less of it is let through, holding the spill at roughly constant strength.

export function makeBloom(canvas: HTMLCanvasElement | null) {
  const ctx = canvas?.getContext("2d", { alpha: false, willReadFrequently: true }) ?? null;
  if (canvas) { canvas.width = 96; canvas.height = 54; }
  let dead = false;        // tainted canvas: cannot measure, so stay conservative
  let opacity = 0.34;

  function paint(video: HTMLVideoElement | null | undefined): void {
    if (!ctx || !canvas || !video || video.readyState < 2) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      dead = true;
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      canvas.style.opacity = "0.22";
      return;
    }
    if (dead) return;
    try {
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      // every 8th pixel is plenty at this size
      for (let i = 0; i < data.length; i += 32) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
      const luma = sum / (data.length / 32) / 255;          // 0..1
      const target = Math.min(0.42, Math.max(0.07, 0.115 / (0.12 + luma * 1.5)));
      opacity += (target - opacity) * 0.25;                  // ease, don't flicker
      canvas.style.opacity = opacity.toFixed(3);
    } catch {
      dead = true;                                           // cross-origin frame
      canvas.style.opacity = "0.20";
    }
  }

  return { paint };
}
