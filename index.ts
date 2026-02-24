import axios, { AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { program } from 'commander';
import winston from 'winston';

// --- ロガーの設定 ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
    ),
    transports: [new winston.transports.Console()]
});

interface CrawlerOptions {
    username?: string;
    password?: string;
    verbose?: boolean;
    interval?: string;
}

program
    .version('1.0.0')
    .description('高速リンクチェッカー')
    .argument('<url>', '開始URL')
    .option('-u, --username <user>', 'Basic認証ユーザー名')
    .option('-p, --password <pass>', 'Basic認証パスワード')
    .option('-i, --interval <interval>', 'クロール間隔(ms)', "0")
    .option('-v, --verbose', 'デバッグログを表示')
    .action(async (targetUrl: string, options: CrawlerOptions) => {
        if (options.verbose) logger.level = 'debug';
        await runCrawler(targetUrl, options);
    });

program.parse();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runCrawler(targetUrl: string, options: CrawlerOptions) {
    const baseUrl = new URL(targetUrl);
    const visited = new Set<string>();
    const results = new Map<string, number | string>();
    const interval = parseInt(options.interval || '0', 10);

    const config: AxiosRequestConfig = {
        timeout: 8000, // 少し長めに設定
        validateStatus: () => true,
        headers: { 'User-Agent': 'BunCrawler/1.0' }
    };

    if (options.username && options.password) {
        config.auth = { username: options.username, password: options.password };
        logger.debug('Basic認証が設定されました');
    }

    async function crawl(url: string) {
        try {
            const currentUrl = new URL(url);
            if (currentUrl.hostname !== baseUrl.hostname) {
                logger.debug(`スキップ (外部ドメイン): ${url}`);
                return;
            }
            if (visited.has(url)) {
                logger.debug(`スキップ (既訪): ${url}`);
                return;
            }
            if (interval > 0) {
                logger.debug(`待機中... (${interval}ms)`);
                await sleep(interval);
            }


            visited.add(url);
            logger.info(`巡回中: ${url}`);

            // HEADリクエスト
            logger.debug(`HEADリクエスト送信: ${url}`);
            const headRes = await axios.head(url, config);
            results.set(url, headRes.status);
            logger.debug(`ステータスコード [${headRes.status}]: ${url}`);
            logger.debug(`ContentType: [${headRes.headers['content-type'] || 'undefined'}]: ${url}`);
            const contentType = headRes.headers['content-type'] || '';

            // スコープ内かつHTMLなら解析
            if (contentType.includes('text/html') && headRes.status === 200) {
                logger.debug(`HTML解析開始 (GET): ${url}`);
                const getRes = await axios.get(url, config);

                const $ = cheerio.load(getRes.data);
                const links: string[] = [];

                $('a[href]').each((_, el) => {
                    try {
                        const href = $(el).attr('href');
                        if (!href) return;
                        const abs = new URL(href, url);
                        abs.hash = '';
                        const finalUrl = abs.href;

                        if (!visited.has(finalUrl) && abs.hostname === baseUrl.hostname) {
                            links.push(finalUrl);
                        }
                    } catch (e) {
                        logger.debug(`URLパース失敗: ${$(el).attr('href')}`);
                    }
                });

                logger.debug(`新規リンク発見: ${links.length} 件`);
                for (const link of links) {
                    await crawl(link);
                }
            } else {
                logger.debug(`スコープ外のため巡回中止: ${url}`);
                results.delete(url)
            }
        } catch (err: any) {
            logger.error(`エラー発生 (${url}): ${err.message}`);
            results.set(url, `ERR: ${err.message}`);
        }
    }

    logger.info('--- 🚀 クローリング開始 ---');
    await crawl(targetUrl);

    logger.info('--- 📊 最終レポート ---');
    Array.from(results.entries()).sort().forEach(([url, status]) => {
        const ok = typeof status === 'number' && status < 400;
        console.log(`${ok ? '✅' : '❌'} [${status}] ${url}`);
    });
}
