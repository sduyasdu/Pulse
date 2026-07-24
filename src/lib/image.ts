/** Read an image File, downscale it to a square `size`px (center-cropped), and
 * return a JPEG data URI. Keeps avatars tiny (a few KB) so they fit comfortably
 * inside the Firestore user doc — no Storage bucket needed. */
export function fileToAvatarDataUrl(file: File, size = 160, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Couldn't process this image."));
        return;
      }
      // Center-crop to a square, then draw scaled into the canvas.
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read this image."));
    };
    img.src = url;
  });
}
