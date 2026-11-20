export const BOOK_COLUMNS = 'id,isbn13,title,author_text,source,provider_item_id,is_shelved,shelf_note,version,cover_path,spine_path';

export function yes24ImageURL(book, kind = 'SIDE') {
  if (kind === 'SIDE' && book?.spine_url) return book.spine_url;
  if (kind === 'COVER' && book?.cover_url) return book.cover_url;
  if (book?.source !== 'yes24' || !/^[1-9]\d*$/.test(book.provider_item_id || '')) return null;
  const suffix = kind === 'SIDE' ? 'SIDE/L' : 'L';
  return `https://image.yes24.com/goods/${book.provider_item_id}/${suffix}`;
}

export const looksLikeBookSpine = (width, height) => height > 0 && width / height < 0.35;

export async function saveShelfNote(client, book, content, requestId) {
  const { data, error } = await client.rpc('save_shelf_note', {
    p_book_id: book.id, p_expected_version: book.version,
    p_request_id: requestId, p_content: content,
  });
  if (error) throw error;
  if (!data || !['saved', 'conflict'].includes(data.status) || !Number.isInteger(data.version))
    throw new Error('서버가 메모 저장을 확인하지 못했어요.');
  return data;
}

export function validateBook({ isbn, title }) {
  const normalizedIsbn = isbn.trim().replaceAll(/[-\s]/g, '');
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return '제목을 입력해 주세요.';
  if (normalizedIsbn && !validIsbn(normalizedIsbn)) return '올바른 ISBN-10 또는 ISBN-13을 입력해 주세요.';
  return null;
}

function validIsbn(isbn) {
  if (/^\d{9}[\dX]$/i.test(isbn)) return [...isbn.toUpperCase()].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11 === 0;
  if (/^\d{13}$/.test(isbn)) return [...isbn.slice(0, 12)].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === (10 - Number(isbn[12])) % 10;
  return false;
}

export async function addBook(client, input) {
  const error = validateBook(input);
  if (error) throw new Error(error);
  const isbn = input.isbn.trim().replaceAll(/[-\s]/g, '') || null;
  const { data, error: rpcError } = await client.rpc('put_manual_book', {
    p_book_id: input.bookId, p_isbn: isbn, p_title: input.title.trim(),
    p_author_text: input.author.trim() || null,
  });
  if (rpcError) throw rpcError;
  if (!data?.id) throw new Error('서버가 책 저장을 확인하지 못했습니다.');
  const { data: books, error: readError } = await client.from('books').select(BOOK_COLUMNS).order('created_at', { ascending: false });
  if (readError) throw readError;
  return { bookId: data.id, books };
}

export async function startManualReading(client, input, startedOn, recordId) {
  const { bookId } = await addBook(client, input);
  const { data, error } = await client.rpc('start_manual_reading', {
    p_record_id: recordId, p_book_id: bookId, p_started_on: startedOn,
  });
  if (error) throw error;
  if (!data?.record_id || !data?.started_on) throw new Error('서버가 시작일 저장을 확인하지 못했어요.');
  return data;
}
