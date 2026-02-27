export interface CrawlerOptions {
    interval: number;
    concurrency: number;
    screenshot: (url: string, html: string) => Promise<void>,
}

export interface CrawlResult {
    url: string;
    status: number | string;
    isExternal: boolean;
}

declare module 'puppeteer-full-page-screenshot';