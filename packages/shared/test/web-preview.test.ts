import { test, expect } from 'vitest';
import { parseWebPreview, webPreviewUrl } from '../src/web-preview';
import { streamingEngineeringText } from '../src/engineering/activity';

test('coding stream keeps the surrounding explanation without leaking card JSON', () => {
  expect(streamingEngineeringText('Try this.\n```nmpreview\n{"url":')).toBe('Try this.\n');
  expect(streamingEngineeringText('Before\n```nmpreview\n{"url":"http://localhost:3000"}\n```\nAfter')).toBe('Before\n\nAfter');
});

test('accepts actual web addresses, including local development and IPv6', () => {
  for (const url of ['https://example.com/app?q=hi#demo', 'http://127.0.0.1:4321/', 'http://[::1]:4000', 'https://例え.jp/']) {
    expect(parseWebPreview(JSON.stringify({ url, title: ' TaskGarden ', description: 'Try adding a task' }))).toEqual({ url: new URL(url).href, title: 'TaskGarden', description: 'Try adding a task' });
  }
  expect(parseWebPreview('{"url":"https://example.com"}')?.title).toBe('Web preview');
});

test('rejects credentials, executable protocols, ambiguous and malformed addresses', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', '//example.com', 'https:example.com', 'https://', 'https://user:secret@example.com', 'http://user@localhost', ' https://example.com', 'https://example.com\n', 'http://example.com/a b', null, 123]) expect(webPreviewUrl(url)).toBeNull();
});

test('malformed, incomplete and oversized cards stay available as source text', () => {
  for (const input of ['{', 'null', '[]', '{}', '{"url":"https://example.com","title":3}', '{"url":"https://example.com","title":" "}', JSON.stringify({ url: 'https://example.com', title: 'a'.repeat(121) }), JSON.stringify({ url: 'https://example.com', description: {} }), JSON.stringify({ url: 'https://example.com', description: 'a'.repeat(241) }), JSON.stringify({ url: 'https://example.com/' + 'a'.repeat(4096) })]) expect(parseWebPreview(input)).toBeNull();
});
