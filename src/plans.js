export async function addReadingPlan(client, ownerId, book, plannedOn, id) {
  if (!/^[1-9]\d*$/.test(String(book.id)) || !/^\d{4}-\d{2}-\d{2}$/.test(plannedOn)) throw new Error('책과 읽을 날짜를 확인해 주세요.');
  const { data, error } = await client.from('reading_plans').insert({ id, owner_id: ownerId, provider_item_id: String(book.id), isbn: book.isbn || null, title: book.title, author_text: book.authorText || '', planned_on: plannedOn }).select().single();
  if (error?.code === '23505') throw new Error('이미 읽을 책 목록에 있어요.');
  if (error) throw error;
  if (!data?.id) throw new Error('읽을 책 저장을 확인하지 못했어요.');
  return data;
}

export async function changeReadingPlanDate(client, id, plannedOn) {
  const { data, error } = await client.from('reading_plans').update({ planned_on: plannedOn }).eq('id', id).select().single();
  if (error) throw error;
  if (!data?.id) throw new Error('읽을 날짜 변경을 확인하지 못했어요.');
  return data;
}

export async function removeReadingPlan(client, id) {
  const { data, error } = await client.from('reading_plans').delete().eq('id', id).select('id').single();
  if (error) throw error;
  if (!data?.id) throw new Error('읽을 책 삭제를 확인하지 못했어요.');
}
