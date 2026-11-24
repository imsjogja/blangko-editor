export interface PreparedImage {
  contentBase64: string;
  width: number;
  height: number;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size > 12 * 1024 * 1024) throw new Error("Ukuran aset maksimal 12 MB.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Gunakan aset PNG, JPG, atau WebP.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("File tidak dapat dibaca."));
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Format gambar tidak dapat dibaca."));
    image.src = dataUrl;
  });
  return { contentBase64: dataUrl.split(",")[1], ...dimensions };
}
