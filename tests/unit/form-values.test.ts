import { expect, test } from 'vitest';
import { formValues } from '@/lib/form-values';

test('введённые значения возвращаются в форму, пароли и ключи — нет', () => {
  const f = new FormData();
  f.set('url', ' http://q:8080 ');
  f.set('username', 'admin');
  f.set('password', 'секрет');
  f.set('apiKey', 'KEY');
  f.set('intent', 'check');
  expect(formValues(f, ['url', 'username'])).toEqual({ url: 'http://q:8080', username: 'admin' });
});
