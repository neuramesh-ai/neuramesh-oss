// A rich email body (plan I13): one text that the card, the agent tools and the MIME build read the same way. Asset
// blocks hold references only, move and come out by block, and the plain part keeps every word and every link.
import { describe, expect, it } from 'vitest';
import {
  EMAIL_ASSET_CAP, assetMarker, assetsLine, bodyIsRich, bodyRefusal, emailAssets, emailBlocks, emailBodyOf, emailHtml, emailPlainText, gifWidth,
  insertAsset, moveBlock, oembedUrl, safeLink, videoShown,
} from '../src/email-body';

const IMG = 'f1111111-1111-4111-8111-111111111111';
const BODY = `Hi Lena,\n\nField Sync is **live** today. See [pricing](https://acme.test/pricing).\n\n![The offline sync screen](file:${IMG})\n\n![The whole demo](video:https://www.loom.com/share/abc)\n\nGeorge`;

describe('the body', () => {
  it('reads text and asset blocks, and writes them back the same', () => {
    const blocks = emailBlocks(BODY);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'text', 'asset', 'asset', 'text']);
    expect(emailAssets(BODY)).toEqual([{ alt: 'The offline sync screen', file: IMG }, { alt: 'The whole demo', video: 'https://www.loom.com/share/abc' }]);
    expect(emailBodyOf(blocks)).toBe(BODY);
  });

  it('moves, puts in and removes a block', () => {
    const blocks = emailBlocks(BODY);
    const up = emailBodyOf(moveBlock(blocks, 2, -1));
    expect(up.indexOf('![The offline')).toBeLessThan(up.indexOf('Field Sync'));
    expect(emailBodyOf(blocks.filter((_, i) => i !== 3))).not.toContain('video:');
    expect(moveBlock(blocks, 0, -1)).toEqual(blocks);
    const plain = emailBlocks('Hi Lena,\n\nThe news.\n\nGeorge');
    expect(emailBodyOf(insertAsset(plain, { alt: 'Logo', file: IMG }))).toBe(`Hi Lena,\n\nThe news.\n\n![Logo](file:${IMG})\n\nGeorge`);
    expect(emailBodyOf(insertAsset(plain, { alt: 'Logo', file: IMG }, 0))).toBe(`Hi Lena,\n\n![Logo](file:${IMG})\n\nThe news.\n\nGeorge`);
  });

  it('keeps alt text from breaking a marker, and refuses a body with no alt text or too many assets', () => {
    expect(assetMarker({ alt: "a [b]\nc", file: IMG })).toBe(`![a b c](file:${IMG})`);
    expect(bodyRefusal(`![](file:${IMG})`)).toMatch(/alt text/);
    expect(bodyRefusal(Array.from({ length: EMAIL_ASSET_CAP + 1 }, () => `![x](file:${IMG})`).join('\n\n'))).toMatch(/at most 10/);
    expect(bodyRefusal(BODY)).toBeNull();
  });

  it('makes a plain part with every word and link, and an HTML part with the assets in place', () => {
    expect(emailPlainText(BODY)).toBe('Hi Lena,\n\nField Sync is live today. See pricing (https://acme.test/pricing).\n\n[Image: The offline sync screen]\n\nThe whole demo: https://www.loom.com/share/abc\n\nGeorge');
    const html = emailHtml(BODY, [{ cid: 'nm-asset-1@neuramesh' }, { video: 'https://www.loom.com/share/abc', posterCid: 'nm-asset-2@neuramesh', label: 'The whole demo' }]);
    expect(html).toContain('<b>live</b>');
    expect(html).toContain('<a href="https://acme.test/pricing">pricing</a>');
    expect(html).toContain('<img src="cid:nm-asset-1@neuramesh" alt="The offline sync screen"');
    expect(html).toContain('<a href="https://www.loom.com/share/abc"><img src="cid:nm-asset-2@neuramesh"');
    expect(emailHtml('<script>x</script> [a](javascript:alert(1))', [])).not.toMatch(/<script>|href="javascript/);
    expect(emailHtml('- one\n- two', [])).toContain('<ul><li>one</li><li>two</li></ul>');
  });

  it('knows a rich body, the video hosts, a safe link and a GIF\'s width', () => {
    expect(bodyIsRich('Hi Lena,\n\nGeorge')).toBe(false);
    expect(bodyIsRich(BODY)).toBe(true);
    expect(bodyIsRich('Hi **Lena**')).toBe(true);
    expect(bodyIsRich('Hi **Lena**')).toBe(true); // twice: no global regex state between calls
    expect(oembedUrl('https://youtu.be/x')).toMatch(/^https:\/\/www\.youtube\.com\/oembed/);
    expect(oembedUrl('https://www.loom.com/share/abc')).toMatch(/^https:\/\/www\.loom\.com\/v1\/oembed/);
    expect(oembedUrl('https://example.com/v')).toBeNull();
    expect(safeLink('http://x.test')).toBeNull();
    expect(safeLink('https://loom.com/share/a')).toBe('https://loom.com/share/a');
    expect(videoShown('https://www.loom.com/share/field-sync-demo')).toBe('loom.com/share/field-sync-demo');
    expect(gifWidth(new Uint8Array([71, 73, 70, 56, 57, 97, 0x58, 0x02, 1, 0]))).toBe(600);
    expect(gifWidth(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(assetsLine(3, 3.04 * 1024 * 1024)).toBe('3 assets · 3.0 MB of 20 MB');
  });
});
