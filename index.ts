import axios, {type CreateAxiosDefaults} from 'axios';

import { program } from 'commander';
import winston from 'winston';
import type {CrawlerOptions} from "./@types";
import {LinkChecker} from "./src/LinkChecker";
import puppeteer from "puppeteer";
import * as fs from "node:fs";
import * as path from "node:path";

// --- CLI Entry Point ---
program
    .version('2.0.0')
    .argument('<url>', '開始URL')
    .option('-u, --username <user>', 'Basic認証ユーザー名')
    .option('-p, --password <pass>', 'Basic認証パスワード')
    .option('-t, --timeout <ms>', 'タイムアウト(ms)', '10000')
    .option('-i, --interval <ms>', 'クエリ間隔(ms)', '100')
    .option('-c, --concurrency <number>', '同時実行数', '1')
    .option('-s, --screenshot <directory>', 'スクリーンショットディレクトリ')
    .option('-v, --verbose', 'デバッグログを表示')
    .action(async (targetUrl: string, opts: any) => {
        const logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
            ),
            transports: [new winston.transports.Console()]
        });
        if (opts.verbose) logger.level = 'debug';

        const config: CrawlerOptions = {
            interval: parseInt(opts.interval, 10),
            concurrency: parseInt(opts.concurrency, 10),
            screenshot: () => new Promise((resolve) => resolve()),
        };

        if(opts.screenshot) {
            fs.mkdirSync(opts.screenshot, { recursive: true });
            const browser = await puppeteer.launch({
                headless: 'shell',
                channel: 'chrome',
                args: [`--lang=ja`, '--window-size=1920,1080'],
            });
            config.screenshot = (url: string, html: string) => new Promise(async (resolve) => {
                const filepath = path.join(
                    opts.screenshot,
                    url
                        .replace(/\/+$/, "")
                        .replace(/^https?:\/\//, '')
                        .replace(/[\/\\?%*:|"<>]/g, '_') + '.webp'
                );
                if(!fs.existsSync(filepath)) {
                    logger.debug(`[puppeteer] file exists ${filepath}`)
                    return resolve();
                }
                const page = await browser.newPage({});
                await page.setViewport({
                    width: 1920,
                    height: 0,
                })
                if(opts.username && opts.password) {
                    logger.debug(`[puppeteer] Set Auth Header ${url}`);
                    await page.authenticate({
                        username: opts.username,
                        password: opts.password
                    });
                }
                logger.debug(`[puppeteer] Goto page ${url}`);
                await page.setContent(html, {waitUntil: 'domcontentloaded'})

                logger.info(`[puppeteer] CreateScreenShot ${filepath}`);
                await page.screenshot({
                    path: filepath,
                    fullPage: true,
                })
                resolve();
            });
        }

        // 1. 基本設定を定義
        const axiosConfig: CreateAxiosDefaults = {
            timeout: parseInt(opts.timeout, 10),
            validateStatus: () => true,
            headers: {
                'User-Agent': 'BunCrawler/2.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };
        // 2. 認証情報の注入
        if (opts.username && opts.password) {
            axiosConfig.auth = {
                username: opts.username,
                password: opts.password
            };
        }


        const checker = new LinkChecker(axios.create(axiosConfig), logger, targetUrl, config);
        await checker.run();
    });

program.parse();