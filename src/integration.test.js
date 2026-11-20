import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;

test('local auth, books RPC, and owner isolation', { skip: !url || !key }, async () => {
  const clients = [createClient(url, key), createClient(url, key), createClient(url, key)];
  const users = [];
  let firstCredentials;
  try {
    for (let index = 0; index < 2; index++) {
      const email = `phase1-${randomUUID()}@example.test`;
      const password = `${randomUUID()}A!`;
      if (index === 0) firstCredentials = { email, password };
      const { error: signupError } = await clients[index].auth.signUp({ email, password });
      assert.ifError(signupError);
      const { data, error } = await clients[index].auth.signInWithPassword({ email, password });
      assert.ifError(error);
      assert.ok(data.session);
      users.push(data.user.id);
    }

    const bookId = randomUUID();
    const isbn = '9780306406157';
    const add = () => clients[0].rpc('put_book', {
      p_book_id: bookId, p_isbn: isbn, p_title: 'Integration test book',
      p_author_text: 'Test author', p_source: 'manual', p_provider_item_id: null,
    });
    const { data: inserted, error: insertError } = await add();
    assert.ifError(insertError);
    assert.equal(inserted.id, bookId);

    const { data: repeated, error: repeatedError } = await add();
    assert.ifError(repeatedError);
    assert.equal(repeated.id, inserted.id);

    const { data: ownBooks, error: ownError } = await clients[0]
      .from('books').select('id,isbn13,title,author_text,is_shelved,version,owner_id').eq('id', bookId);
    assert.ifError(ownError);
    assert.equal(ownBooks.length, 1);
    assert.equal(ownBooks[0].owner_id, users[0]);
    assert.equal(ownBooks[0].isbn13, isbn);

    const { data: otherBooks, error: otherError } = await clients[1]
      .from('books').select('id').eq('id', bookId);
    assert.ifError(otherError);
    assert.deepEqual(otherBooks, []);

    const { error: secondSessionError } = await clients[2].auth.signInWithPassword(firstCredentials);
    assert.ifError(secondSessionError);
    const { data: sameAccountBooks, error: sameAccountError } = await clients[2]
      .from('books').select('id').eq('id', bookId);
    assert.ifError(sameAccountError);
    assert.deepEqual(sameAccountBooks.map(book => book.id), [bookId]);

    const concurrent = await Promise.all([clients[0], clients[2]].map(client => client.rpc('put_book', {
      p_book_id: randomUUID(), p_isbn: '9780131103627', p_title: 'Concurrent book',
      p_author_text: '', p_source: 'manual', p_provider_item_id: null,
    })));
    concurrent.forEach(({ error }) => assert.ifError(error));
    assert.equal(concurrent[0].data.id, concurrent[1].data.id);
  } finally {
    await Promise.all(clients.map(client => client.auth.signOut()));
  }
});
