import {vi, describe, beforeEach, expect, it} from "vitest";
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { LinkChecker } from './LinkChecker';
import { Logger } from 'winston';

describe('LinkChecker', () => {
    let mock: MockAdapter;
    let client = axios.create();
    let loggerMock: any;
    const targetUrl = 'https://example.com';

    beforeEach(() => {
        // Axiosインスタンスとモックアダプターの初期化
        mock = new MockAdapter(client);

        // Loggerの最小限のモック
        loggerMock = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as Logger;

        // テストごとにモックをリセット
        mock.reset();
    });

    it('同一ドメイン内のリンクを再帰的に抽出し、巡回すること', async () => {
        const rootUrl = 'https://example.com/';
        const subUrl = 'https://example.com/page1';

        // 1. ルート（https://example.com/）のモック
        mock.onHead(rootUrl).reply(200, {}, {
            'Content-Type': 'text/html; charset=utf-8'
        });
        mock.onGet(rootUrl).reply(200, `
    <html>
      <body>
        <a href="/page1">Link to Page 1</a>
      </body>
    </html>
  `);

        // 2. 抽出されたリンク（https://example.com/page1）のモック
        // ここが呼ばれないと length は 1 のままになります
        mock.onHead(subUrl).reply(200, {}, {
            'Content-Type': 'text/html; charset=utf-8'
        });
        mock.onGet(subUrl).reply(200, '<html>Sub Page</html>');

        const checker = new LinkChecker(client, loggerMock, rootUrl, {
            concurrency: 1,
            interval: 0
        });

        await checker.run();

        // デバッグ用：もし落ちる場合はこれを出力してみてください
        // console.log('GET history:', mock.history.get.map(r => r.url));

        expect(mock.history.head).toHaveLength(2);
        expect(mock.history.head[0].url).toBe(rootUrl);
        expect(mock.history.head[1].url).toBe(subUrl);
    });

    it('外部ドメインのリンクはHEADリクエストのみ送り、GET（解析）はしないこと', async () => {
        const options = { concurrency: 1, interval: 0 };

        // トップページに外部リンクを仕込む
        mock.onHead('https://example.com/').reply(200, {}, { 'content-type': 'text/html' });
        mock.onGet('https://example.com/').reply(200,
            `<html><body><a href="https://external.com">External</a></body></html>`
        );

        // 外部リンクのHEADレスポンス
        mock.onHead('https://external.com').reply(200, {}, { 'content-type': 'text/html' });

        const checker = new LinkChecker(client, loggerMock, targetUrl, options);
        await checker.run();

        // 検証:
        // 内部ドメインは GET まで呼ばれる
        expect(mock.history.get.some(r => r.url === 'https://example.com/')).toBe(true);
        // 外部ドメインは HEAD は呼ばれるが GET は呼ばれない
        expect(mock.history.head.some(r => r.url === 'https://external.com')).toBe(true);
        expect(mock.history.get.some(r => r.url === 'https://external.com')).toBe(false);
    });

    it('404エラーが発生した場合、エラーをキャッチして処理を継続すること', async () => {
        const options = { concurrency: 1, interval: 0 };

        mock.onHead('https://example.com/').reply(404);

        const checker = new LinkChecker(client, loggerMock, targetUrl, options);

        // エラーが投げられずに正常終了することを確認
        await expect(checker.run()).resolves.not.toThrow();
        expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('404'));
    });

    it('並行処理が動作し、キューが空になるまで待機すること', async () => {
        const options = { concurrency: 2, interval: 10 }; // 2並行

        // 複数のURLへのレスポンスを設定
        mock.onHead(/.*/).reply(200, {}, { 'content-type': 'text/plain' });

        const checker = new LinkChecker(client, loggerMock, targetUrl, options);

        // 手動でキューを増やす（テスト用のハック）
        (checker as any).queue.push('https://example.com/a', 'https://example.com/b');

        await checker.run();

        // すべてのURLが処理されたか
        expect(mock.history.head.length).toBe(3); // base + a + b
    });
});