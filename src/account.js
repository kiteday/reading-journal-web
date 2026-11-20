export async function deleteAccount(client, userId) {
  const photos = client.storage.from('book-photos');
  while (true) {
    const { data: folders, error: listError } = await photos.list(userId, { limit: 100 });
    if (listError) throw listError;
    if (!folders.length) break;
    const paths = [];
    for (const folder of folders) {
      if (folder.id) { paths.push(`${userId}/${folder.name}`); continue; }
      const { data: files, error } = await photos.list(`${userId}/${folder.name}`, { limit: 100 });
      if (error) throw error;
      paths.push(...files.map(file => `${userId}/${folder.name}/${file.name}`));
    }
    if (!paths.length) throw new Error('사진 목록을 확인하지 못했어요. 다시 시도해 주세요.');
    const { error } = await photos.remove(paths);
    if (error) throw error;
  }
  const { error } = await client.rpc('delete_my_account');
  if (error) throw error;
}
