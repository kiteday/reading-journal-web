const BUCKET = 'book-photos';

export async function photoBlob(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('촬영한 사진을 읽지 못했어요. 다시 촬영해 주세요.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size > 5242880) throw new Error('사진을 처리하지 못했어요. 다시 촬영해 주세요.');
    return blob;
  } finally { bitmap.close(); }
}

export function cropRect(imageWidth, imageHeight, aspect, scale, centerX, centerY) {
  const width = Math.min(imageWidth, imageHeight * aspect) * scale;
  const height = width / aspect;
  return {
    x: Math.max(0, Math.min(imageWidth - width, imageWidth * centerX - width / 2)),
    y: Math.max(0, Math.min(imageHeight - height, imageHeight * centerY - height / 2)),
    width, height,
  };
}

export function visibleVideoRect(videoWidth, videoHeight, frameWidth, frameHeight) {
  const aspect = frameWidth / frameHeight;
  const width = Math.min(videoWidth, videoHeight * aspect);
  const height = width / aspect;
  return { x: (videoWidth - width) / 2, y: (videoHeight - height) / 2, width, height };
}

export async function uploadBookPhoto(client, userId, bookId, kind, blob) {
  const path = `${userId}/${bookId}/${kind}.jpg`;
  const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data, error: saveError } = await client.rpc('set_book_photo', { p_book_id: bookId, p_kind: kind });
  if (saveError) throw saveError;
  if (data?.path !== path) throw new Error('서버가 사진 저장을 확인하지 못했어요.');
}

export async function attachBookPhotos(client, books) {
  const paths = [...new Set(books.flatMap(book => [book.cover_path, book.spine_path]).filter(Boolean))];
  if (!paths.length) return books;
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) return books;
  const urls = new Map(data.filter(item => item.signedUrl).map(item => [item.path, item.signedUrl]));
  return books.map(book => ({ ...book, cover_url: urls.get(book.cover_path), spine_url: urls.get(book.spine_path) }));
}
