import 'dotenv/config';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createSupabaseClient } from './db/supabaseClient.js';

const env = loadEnv();
const supabase = createSupabaseClient(env);
const app = buildApp({ env, supabase });

async function start(): Promise<void> {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    // HQ承認(2026-10-21)「サーバー起動開始からlisten完了までの時間」: process.uptime() は
    // プロセスの起動(モジュールの読み込みを含む)からの秒数。Render の起動直後かを見分ける目印にもなる。
    app.log.info({ event: 'startup_timing', listen_ms: Math.round(process.uptime() * 1000) }, 'startup timing');
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void start();
