import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {AxiosInstance, AxiosResponse} from 'axios';
import { Logger } from 'winston';
import { LinkChecker } from './LinkChecker'; // 修正: 実際のファイルパスに合わせて変更

// モック用のAxiosInstanceを生成
const createMockAxios = (): AxiosInstance => {
    const mock = {
        head: vi.fn(),
        get: vi.fn(),
        defaults: { timeout: 5000 },
    } as unknown as AxiosInstance;

    return mock;
};

// モック用のLoggerを生成
const createMockLogger = (): Logger => {
    const mock = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    } as unknown as Logger;

    return mock;
};

describe('LinkChecker', () => {
    let axiosMock: AxiosInstance;
    let loggerMock: Logger;
    let linkChecker: LinkChecker;

    beforeEach(() => {
        axiosMock = createMockAxios();
        loggerMock = createNoneLogger();
        linkChecker = new LinkChecker(axiosMock, loggerMock, 'https://example.com', {
            concurrency: 2,
            interval: 1000,
            screenshot: vi.fn(),
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // モック用のLoggerを作成
    function createNoneLogger(): Logger {
        return {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as Logger;
    }

    // モック用のAxiosレスポンスを返す
    function createMockResponse(status: number, data?: string): AxiosResponse {
        return {
            status,
            headers: {},
            data,
            request: { responseUrl: 'https://example.com' },
        };
    }

    // 成功ケース: 内部リンクの処理
    it('should process internal links successfully', async () => {
        // モック設定: 初期URL → /page1 → /page2 の順に処理
        axiosMock.head
            .mockResolvedValueOnce(createMockResponse(200, '<a href="/page1">Page 1</a>')) // 初期URL
            .mockResolvedValueOnce(createMockResponse(200, '<a href="/page2">Page 2</a>')) // /page1
            .mockResolvedValueOnce(createMockResponse(200, '')); // /page2

        // GETリクエストのモック追加
        axiosMock.get
            .mockResolvedValueOnce(createMockResponse(200, '<a href="/page2">Page 2</a>')) // /page1のGET
            .mockResolvedValueOnce(createMockResponse(200, '')); // /page2のGET

        await linkChecker.run();

        expect(linkChecker.results.size).toBe(3); // 初期URL + 2つの内部リンク
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 1] 巡回中: https://example.com');
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 2] 巡回中: https://example.com/page1');
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 1] 巡回中: https://example.com/page2');
    });

    // エラーレスポンスケース
    it('should handle error responses', async () => {
        axiosMock.head.mockRejectedValueOnce(new Error('404 Not Found'));

        await linkChecker.run();

        expect(linkChecker.results.size).toBe(1);
        expect(loggerMock.error).toHaveBeenCalledWith(`エラー (https://example.com/): 404 Not Found`);
    });

    // リダイレクト処理テスト
    it('should handle redirects', async () => {
        axiosMock.head.mockResolvedValueOnce(createMockResponse(301, ''));
        axiosMock.head.mockResolvedValueOnce(createMockResponse(200, '<a href="/page2">Page 2</a>'));

        await linkChecker.run();

        expect(linkChecker.results.size).toBe(2);
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 1] 巡回中: https://example.com');
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 2] 巡回中: https://example.com');
    });

    // 外部リンクの検出テスト
    it('should detect external links', async () => {
        axiosMock.head.mockResolvedValueOnce(createMockResponse(200, '<a href="https://external.com">External</a>'));

        await linkChecker.run();

        expect(linkChecker.results.size).toBe(1);
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 1] 巡回中: https://example.com');
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 0] 巡回中: https://example.com');
    });

    // コンカレンシー処理テスト
    it('should handle concurrency correctly', async () => {
        axiosMock.head.mockResolvedValueOnce(createMockResponse(200, '<a href="/page1">Page 1</a>'));
        axiosMock.head.mockResolvedValueOnce(createMockResponse(200, '<a href="/page2">Page 2</a>'));

        await linkChecker.run();

        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 1] 巡回中: https://example.com');
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 2] 巡回中: https://example.com/page1');
        expect(loggerMock.info).toHaveBeenCalledWith('[Workers: 1] 巡回中: https://example.com/page2');
    });
});