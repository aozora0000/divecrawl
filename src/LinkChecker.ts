// --- Crawler Engine ---
import type {AxiosInstance} from "axios";
import * as cheerio from 'cheerio';
import { URL } from 'url';
import type {CrawlerOptions, CrawlResult} from "../@types";
import {Logger} from "winston";

export class LinkChecker {
    private visited = new Set<string>();
    private queue: string[] = [];
    private results = new Map<string, CrawlResult>();
    private client: AxiosInstance;
    private logger: Logger;
    private baseUrl: URL;
    private activeWorkers = 0; // 現在稼働中のワーカー数

    constructor(client: AxiosInstance, logger: Logger, targetUrl: string, private options: CrawlerOptions) {
        this.client = client;
        this.logger = logger;
        this.baseUrl = new URL(targetUrl);
        this.options = options;
    }

    /**
     * メイン実行: 並行ワーカーを起動
     */
    async run() {
        this.logger.info(`--- 🚀 クローリング開始 (並行数: ${this.options.concurrency}, タイムアウト: ${this.client.defaults.timeout}ms) ---`);
        this.queue.push(this.baseUrl.href);

        // キューが空になり、かつ実行中のワーカーがいなくなるまで待機するPromise
        await new Promise<void>((resolve) => {
            const check = async () => {
                // ワーカーを追加投入できるか確認
                while (this.activeWorkers < this.options.concurrency && this.queue.length > 0) {
                    const url = this.queue.shift()!;
                    if (!url) continue;

                    this.activeWorkers++;

                    // 非同期で処理を開始（awaitしないのがポイント）
                    this.processUrl(url).finally(() => {
                        this.activeWorkers--;
                        check(); // 完了したら次のタスクを探す
                    });
                }

                // 終了判定: キューが空かつ、動いているワーカーがゼロ
                if (this.queue.length === 0 && this.activeWorkers === 0) {
                    resolve();
                }
            };

            check();
        });

        this.printReport();
    }

    private async processUrl(url: string) {
        // 1. 訪問済みチェックを最初に行う（レースコンディション対策）
        if (this.visited.has(url)) return;
        this.visited.add(url);

        try {
            // クロール間隔の待機
            if (this.options.interval > 0) {
                await new Promise(r => setTimeout(r, this.options.interval));
            }

            this.logger.info(`[Workers: ${this.activeWorkers}] 巡回中: ${url}`);

            // HEADリクエスト
            const headRes = await this.client.head(url);
            const finalUrl = headRes.request.responseUrl || url;

            // リダイレクト先が既に訪問済みならスキップ
            if (finalUrl !== url && this.visited.has(finalUrl)) return;
            if (finalUrl !== url) this.visited.add(finalUrl);

            const currentUrl = new URL(finalUrl);
            const isInternal = currentUrl.hostname === this.baseUrl.hostname;
            const contentType = headRes.headers['content-type'] || '';
            const status = headRes.status;

            this.results.set(finalUrl, { url: finalUrl, status, isExternal: !isInternal });

            // HTML解析
            if (isInternal && contentType.includes('text/html') && status === 200) {
                const getRes = await this.client.get(finalUrl);
                const links = this.extractLinks(getRes.data, finalUrl);

                for (const link of links) {
                    if (!this.visited.has(link)) {
                        this.logger.debug(`[QUEUE] add ${link}`)
                        this.queue.push(link);
                    }
                }
                await this.options.screenshot(finalUrl, getRes.data);
            }
        } catch (err: any) {
            this.logger.error(`エラー (${url}): ${err.message}`);
            this.results.set(url, { url, status: `ERR: ${err.message}`, isExternal: false });
        }
    }

    private extractLinks(html: string, baseUrl: string): string[] {
        const $ = cheerio.load(html);
        const discovered: string[] = [];
        const fileExclusionCheck = (url: URL): boolean =>
            /\.(png|jpe?g|gif|svg|pdf|zip|gz|exe|docx?|xlsx?|pptx?|mp3|mp4|mov|css|js|txt)$/i.test(url.origin + url.pathname.replace(/\/+$/, ""))
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;

            try {
                const abs = new URL(href, baseUrl);
                abs.hash = ''; // ハッシュ除去
                const normalized = abs.href;
                if (abs.hostname === this.baseUrl.hostname && !fileExclusionCheck(new URL(normalized))) {
                    discovered.push(normalized);
                }
            } catch {
                this.logger.debug(`URLパース失敗: ${href}`);
            }
        });

        return [...new Set(discovered)]; // 重複除去
    }

    private printReport() {
        this.logger.info('--- 📊 最終レポート ---');
        const sortedResults = Array.from(this.results.values())
            .sort((a, b) => a.url.localeCompare(b.url));

        for (const res of sortedResults) {
            const isOk = typeof res.status === 'number' && res.status < 400;
            const icon = isOk ? '✅' : '❌';
            const tag = res.isExternal ? '[External]' : '[Internal]';
            console.log(`${icon} [${res.status}] ${tag} ${res.url}`);
        }
    }
}