export const MAX_AVATAR_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_AVATAR_DATA_URL_LENGTH = 65000;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read the selected image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
    img.src = src;
  });
}

function renderSquareAvatarDataUrl(
  img: HTMLImageElement,
  sizePx: number,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number
): string {
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Image processing is not available in this browser.');
  }

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    throw new Error('Selected image has invalid dimensions.');
  }

  // Center square cover-crop
  const cropSide = Math.min(srcW, srcH);
  const sx = Math.floor((srcW - cropSide) / 2);
  const sy = Math.floor((srcH - cropSide) / 2);

  // Fill white backing before JPEG export in case source PNG/WebP has transparency
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, sizePx, sizePx);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, sizePx, sizePx);

  return canvas.toDataURL(mimeType, quality);
}

/**
 * Validates, center-crops into a crisp square avatar, and compresses an uploaded
 * image into a compact data URI safe for Firestore profile storage.
 */
export async function processProfilePhotoFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPEG, PNG, or WebP).');
  }
  if (file.size > MAX_AVATAR_FILE_BYTES) {
    throw new Error('Photo must be smaller than 12 MB.');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);

  const attempts: Array<{ size: number; mime: 'image/jpeg' | 'image/webp'; quality: number }> = [
    { size: 192, mime: 'image/webp', quality: 0.86 },
    { size: 192, mime: 'image/jpeg', quality: 0.84 },
    { size: 192, mime: 'image/jpeg', quality: 0.72 },
    { size: 192, mime: 'image/jpeg', quality: 0.58 },
    { size: 144, mime: 'image/jpeg', quality: 0.65 },
    { size: 144, mime: 'image/jpeg', quality: 0.48 },
  ];

  for (const attempt of attempts) {
    const out = renderSquareAvatarDataUrl(img, attempt.size, attempt.mime, attempt.quality);
    if (
      (out.startsWith('data:image/jpeg;base64,') || out.startsWith('data:image/webp;base64,')) &&
      out.length <= MAX_AVATAR_DATA_URL_LENGTH
    ) {
      return out;
    }
  }

  throw new Error('Image is too complex after compression. Please try a simpler or smaller photo.');
}
