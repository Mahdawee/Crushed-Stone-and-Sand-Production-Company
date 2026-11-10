/**
 * اجرای حالت توسعه با پیام‌های روشن فارسی
 *
 *   npm run dev      →  API (پورت ۴۳۱۷) + رابط کاربری (پورت ۵۱۷۳)
 *
 * کارهایی که این اسکریپت انجام می‌دهد و `concurrently` خالی نمی‌داد:
 *  • چند ثانیه بعد از بالا آمدن، هر دو پورت را چک می‌کند و یک «کارت شروع»
 *    با آدرس‌های قابل کلیک چاپ می‌کند (بدون اینکه در لاگ‌ها گم شود).
 *  • اگر رابط کاربری بالا نیامد، صریح می‌گوید چه دستوری را اجرا کنید.
 *  • با Ctrl+C هر دو پروسه با هم بسته می‌شوند.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';

const API_PORT = Number(process.env.FD_PORT || 4317);
const WEB_PORT = Number(process.env.FD_WEB_PORT || 5173);
const isWin = process.platform === 'win32';

const procs = [];
let bannerShown = false;

function start(name, cmd, args, color) {
  const p = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,          /* npm روی ویندوز به shell نیاز دارد */
    detached: !isWin,      /* تا بتوانیم کل گروه پروسه را ببندیم (بدون پروسه یتیم) */
    env: {
      ...process.env,
      /* هر دو پروسه همیشه با هم جفت شوند — حتی اگر پورت‌ها را عوض کنید */
      FD_WEB_PORT: String(WEB_PORT),
      FD_PORT: String(API_PORT),
      FD_API_BASE: process.env.FD_API_BASE || `http://127.0.0.1:${API_PORT}`,
    },
  });
  procs.push({ name, p });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        /* خط‌های آماده‌بودن را کوتاه نشان بده تا ترمینال شلوغ نشود */
        if (line.includes('FARDAY_API_READY')) {
          console.log(`${tag}آماده — سرویس داخلی روی پورت ${API_PORT}`);
          maybeBanner();
          continue;
        }
        if (line.includes('FARDAY_OPEN_UI')) {
          console.log(`${tag}[1mبرنامه اینجاست → ${line.split('FARDAY_OPEN_UI')[1].trim()}[0m`);
          maybeBanner();
          continue;
        }
        if (line.includes('FARDAY_WEB_READY')) { maybeBanner(); continue; }
        if (/Local:\s+http/.test(line)) {
          maybeBanner();
          continue;
        }
        console.log(tag + line);
      }
    });
  };
  pipe(p.stdout);
  pipe(p.stderr);
  p.on('exit', (code) => {
    if (code && code !== 0) console.log(`${tag}با خطا بسته شد (کد ${code})`);
    /* اگر یکی از دو طرف بمیرد، دیگری را هم می‌بندیم تا ترمینال گیر نکند */
    if (code) shutdown(code);
  });
  return p;
}

const waitPort = (port, timeoutMs = 90_000) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => {
      s.destroy();
      if (Date.now() - t0 > timeoutMs) resolve(false);
      else setTimeout(tick, 400);
    });
  };
  tick();
});

async function maybeBanner() {
  if (bannerShown) return;
  const [api, web] = await Promise.all([waitPort(API_PORT), waitPort(WEB_PORT)]);
  if (!api || !web || bannerShown) return;
  bannerShown = true;
  const line = '─'.repeat(58);
  console.log(`\n\x1b[36m${line}\x1b[0m`);
  console.log('  \x1b[1mبرنامه آماده است — یکی از این آدرس‌ها را باز کنید:\x1b[0m');
  console.log(`  \x1b[36m➜  رابط کاربری :\x1b[0m  http://localhost:${WEB_PORT}/   \x1b[2m(with hot reload)\x1b[0m`);
  console.log(`  \x1b[36m➜  نسخه یک‌آدرس:\x1b[0m  http://127.0.0.1:${API_PORT}/   \x1b[2m(نیاز به build دارد)\x1b[0m`);
  console.log(`  \x1b[36m➜  سرویس API :\x1b[0m  http://127.0.0.1:${API_PORT}/api`);
  console.log(`  \x1b[36m➜  ورود:\x1b[0m         admin / admin123`);
  console.log(`\x1b[36m${line}\x1b[0m\n`);
}

const api = start('API', 'npm', ['run', 'dev', '-w', '@farday/api'], '36');
const web = start('WEB', 'npm', ['run', 'dev', '-w', '@farday/web'], '35');

/* هر ۲ ثانیه یک بار وضعیت را چک کن تا کارت شروع دیرتر هم چاپ شود */
const beat = setInterval(maybeBanner, 2000);
setTimeout(() => clearInterval(beat), 120_000);

function shutdown(code = 0) {
  for (const { p } of procs) {
    try {
      if (isWin) p.kill();
      else process.kill(-p.pid, 'SIGTERM');   /* کل گروه: npm → nest/vite */
    } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(code), 250);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

