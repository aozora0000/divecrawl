export interface CrawlerOptions {
    interval: number;
    concurrency: number; // 並行処理数を追加
}

export interface CrawlResult {
    url: string;
    status: number | string;
    isExternal: boolean;
}
