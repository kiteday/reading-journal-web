export async function searchYes24(baseURL, query) {
  const url = new URL('books/search', `${baseURL.replace(/\/$/, '')}/`);
  url.searchParams.set('q', query.trim());
  let response;
  try { response = await fetch(url); }
  catch { throw new Error('책 검색 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw new Error(response.status === 429 ? '검색 요청이 많아요. 잠시 후 다시 시도해 주세요.' : '책 검색에 실패했어요. 다시 시도해 주세요.');
  const body = await response.json();
  if (!Array.isArray(body.items)) throw new Error('검색 결과를 읽지 못했어요.');
  // shortcut: title-based set filtering; use a catalog field if YES24 adds one.
  return body.items.filter(item => !/세트|전집|묶음/.test(item.title));
}

export async function saveCompletion(client, book, completedOn, reflection, recordId, bookId) {
  const { data, error } = await client.rpc('put_completion', {
    p_record_id: recordId, p_book_id: bookId, p_isbn: book.isbn,
    p_title: book.title, p_author_text: book.authorText,
    p_provider_item_id: book.id, p_completed_on: completedOn,
    p_reflection: reflection.trim() || null,
  });
  if (error) throw error;
  if (!data?.record_id || !data?.book_id) throw new Error('서버가 독서 기록 저장을 확인하지 못했습니다.');
  return data;
}

export async function startReading(client, book, startedOn, recordId, bookId) {
  const { data, error } = await client.rpc('start_reading', {
    p_record_id: recordId, p_book_id: bookId, p_isbn: book.isbn,
    p_title: book.title, p_author_text: book.authorText,
    p_provider_item_id: book.id, p_started_on: startedOn,
  });
  if (error) throw error;
  if (!data?.record_id || !data?.book_id || !data?.started_on)
    throw new Error('서버가 시작일 저장을 확인하지 못했어요.');
  return data;
}

export async function finishReading(client, recordId, completedOn) {
  const { data, error } = await client.rpc('finish_reading', {
    p_record_id: recordId, p_completed_on: completedOn,
  });
  if (error) throw error;
  if (!data?.record_id || !data?.completed_on)
    throw new Error('서버가 완독일 저장을 확인하지 못했어요.');
  return data;
}

export async function saveReflection(client, record, content, requestId) {
  const { data, error } = await client.rpc('save_reflection', {
    p_record_id: record.id, p_expected_version: record.version,
    p_request_id: requestId, p_content: content,
  });
  if (error) throw error;
  if (!data || !['saved', 'conflict'].includes(data.status) || !Number.isInteger(data.version))
    throw new Error('서버가 독서글 저장을 확인하지 못했어요.');
  return data;
}
